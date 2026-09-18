// A detector that cannot fire is not a detector.
//
// The contradiction machinery compares two independent measurements of one
// quantity, and only says something when the quantity is big enough that a
// failed source would differ by more than the threshold. Measured over ordinary
// navigation, the turning check is in that position for 0.8% of ticks, with
// unbroken blind runs of 591 ticks. A robot can carry a dead gyro through a
// whole mission while a detector that works perfectly reports nothing wrong.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createSimRig } from "../index.ts";

/** Drive a mission, optionally with the gyro dead and the self-test running. */
async function mission(opts: { selfTest: boolean; gyroDead: boolean; seed: number }) {
  const rig = createSimRig({ scenario: "cluttered-office", seed: opts.seed });
  const robot = rig.world.robot(rig.robot.id);
  const goal = { x: robot.pose.x + 6, y: robot.pose.y + 2 };

  if (opts.gyroDead) {
    // A gyro that has stopped reports a perfectly well-formed zero. Fresh,
    // complete, in range, and wrong.
    const real = rig.robot.imu.bind(rig.robot);
    Object.assign(rig.robot, { imu: () => ({ ...real(), yawRate: 0 }) });
  }

  let detected = false;
  const step = rig.world.step.bind(rig.world);
  Object.assign(rig.world, {
    step: (dt: number) => {
      step(dt);
      if (rig.governor.standingConflicts().some((c) => c.kind === "turning")) detected = true;
    },
  });

  const daemon = opts.selfTest ? rig.runtime.start("sense.self-test", {}) : null;
  const nav = await rig.runtime.run("navigate.to", { x: goal.x, y: goal.y, tolerance: 0.4 });
  await rig.runtime.stopDaemons("test over");
  const report = daemon ? await daemon.wait() : null;
  return { detected, arrived: nav.ok === true, probes: (report?.metrics?.probes ?? 0) as number };
}

test("agreeing while nothing is happening is not a verification", () => {
  // Three outcomes, not two, and the same shape as the evidence layer's. A
  // check that agrees because neither source had anything to say has not
  // cleared its pair; it has been silent about it. Treating that as health is
  // how a robot concludes it is fine from having driven in a straight line.
  const rig = createSimRig({ scenario: "empty-hall", seed: 1 });
  const robot = rig.world.robot(rig.robot.id);

  // Straight ahead, briskly: plenty of motion, no turning at all.
  for (let tick = 0; tick < 60; tick += 1) {
    const command = rig.governor.govern(rig.robot, 0.6, 0);
    rig.robot.drive(command.linear, command.angular);
    rig.world.step(0.05);
  }

  const checks = rig.governor.verifiability();
  const turning = checks.find((c) => c.name === "turning");
  const motion = checks.find((c) => c.name === "self-motion");

  assert.ok(turning, "no turning check is reported at all");
  assert.equal(turning.excited, false, "a robot driving straight was said to be testing its gyro");
  assert.ok(
    turning.unverifiedForMs === null || turning.unverifiedForMs > 1000,
    "the turning check claimed a recent verification from a robot that never turned",
  );
  assert.ok(turning.excitedBy.length > 10, "it does not say what would let it speak");

  // And the one that ordinary driving does exercise, as a control: if this were
  // also unverified the test would be measuring nothing.
  assert.equal(motion?.excited, true, "driving at 0.6 m/s did not exercise the self-motion check");
  assert.ok((motion?.unverifiedForMs ?? Infinity) < 500);
});

test("a dead gyro survives a whole mission unnoticed without the self-test", async () => {
  // The hole this capability exists for, asserted rather than described.
  let detected = 0;
  for (let seed = 1; seed <= 5; seed += 1) {
    const r = await mission({ selfTest: false, gyroDead: true, seed });
    if (r.detected) detected += 1;
    assert.equal(r.arrived, true, "the control robot did not finish, so it proves nothing");
  }
  assert.equal(
    detected,
    0,
    "the gyro fault was noticed without any self-test, which would make this capability pointless",
  );
});

test("the self-test finds what the mission never would", async () => {
  for (let seed = 1; seed <= 5; seed += 1) {
    const r = await mission({ selfTest: true, gyroDead: true, seed });
    assert.equal(r.detected, true, `seed ${seed}: the gyro was dead and nothing noticed`);
    assert.ok(r.probes >= 1, "it claimed a detection without ever probing");
    assert.equal(r.arrived, true, `seed ${seed}: finding the fault cost the mission`);
  }
});

test("a healthy robot is not accused, and is not probed to a standstill", async () => {
  // The other half. A self-test that cries fault on a working sensor is worse
  // than none, and one that spends the mission testing itself is a robot that
  // does not do its job.
  for (let seed = 1; seed <= 5; seed += 1) {
    const r = await mission({ selfTest: true, gyroDead: false, seed });
    assert.equal(r.detected, false, `seed ${seed}: a healthy gyro was reported as contradicted`);
    assert.equal(r.arrived, true, `seed ${seed}: self-testing a healthy robot cost the mission`);
    assert.ok(r.probes <= 3, `${r.probes} probes on a short mission is a tic, not a test`);
  }
});

test("a check that has answered is not asked again", async () => {
  // The first version missed this and it is the difference between a self-test
  // and a tic. With a dead gyro the check never verifies, so it stays stale, so
  // it was probed again on the next tick: 69 probes in one run and not a single
  // mission completed. A contradiction is the answer, not a reason to repeat
  // the question.
  const r = await mission({ selfTest: true, gyroDead: true, seed: 2 });
  assert.equal(r.detected, true);
  assert.ok(r.probes <= 3, `${r.probes} probes — it kept asking a question already answered`);
});

test("the probe outlasts the window the detector needs to be sure", () => {
  // Not a tuning preference. A conflict is only raised after the sources have
  // disagreed for 300 ms, deliberately, so one noisy tick is not a fault — and
  // the turn has to ramp past the threshold before the disagreement even
  // starts. A 300 ms probe ends as the evidence begins accumulating, and
  // measured, it detected nothing at all on a single probe.
  const rig = createSimRig({ scenario: "empty-hall", seed: 1 });
  const manifest = rig.registry.manifests().find((m) => m.id === "sense.self-test");
  assert.ok(manifest, "sense.self-test is not registered");
  const probeMs = manifest.inputSchema.properties?.probeMs?.default as number;
  assert.ok(
    probeMs >= 600,
    `a ${probeMs} ms probe cannot outlast a 300 ms persistence window plus the ramp`,
  );
});
