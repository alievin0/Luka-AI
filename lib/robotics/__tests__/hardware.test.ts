import { test } from "node:test";
import assert from "node:assert/strict";

import { createSimRig, SIMULATED_ROVER, GENERIC_ROVER_TEMPLATE } from "../index.ts";
import {
  validateProfile,
  auditProfile,
  limitsFrom,
  abilityFitness,
  metricallyTrustworthy,
  linkSupportsControl,
  CRAWL_PROFILE,
  CRAWL_LINEAR,
  type RobotProfile,
} from "../hal/profile.ts";
import { Deadman } from "../hal/deadman.ts";
import type { CheckoutInput, CheckoutReport } from "../abilities/checkout.ts";

test("the shipped profiles are internally consistent", () => {
  assert.deepEqual(validateProfile(SIMULATED_ROVER), []);
  assert.deepEqual(validateProfile(GENERIC_ROVER_TEMPLATE), []);
});

test("profile validation catches configurations that describe a fiction", () => {
  const gripperWithoutArm: RobotProfile = {
    ...GENERIC_ROVER_TEMPLATE,
    capabilities: ["drive", "gripper"],
  };
  assert.match(validateProfile(gripperWithoutArm).join(" "), /gripper with no arm/);

  const optimisticBrakes: RobotProfile = {
    ...GENERIC_ROVER_TEMPLATE,
    maxAccel: 0.3,
    maxDecel: 4,
  };
  assert.match(validateProfile(optimisticBrakes).join(" "), /maxDecel/);

  const tooFast: RobotProfile = { ...GENERIC_ROVER_TEMPLATE, maxLinear: 3, maxDecel: 0.4 };
  assert.match(validateProfile(tooFast).join(" "), /to stop/);
});

test("separation limits cover both bodies, not just the robot", () => {
  const limits = limitsFrom(SIMULATED_ROVER);
  assert.ok(
    (limits.minSeparation ?? 0) >= SIMULATED_ROVER.footprintRadius + 0.25,
    `minSeparation ${limits.minSeparation} does not leave room for a person`,
  );
  assert.equal(limits.maxLinear, SIMULATED_ROVER.maxLinear);
  assert.equal(limits.reactionTime, SIMULATED_ROVER.reactionTimeMs / 1000);
});

test("an ability is refused by name when the platform lacks the hardware", () => {
  const fitness = abilityFitness(GENERIC_ROVER_TEMPLATE, ["arm", "gripper"]);
  assert.equal(fitness.runnable, false);
  assert.deepEqual(fitness.missing, ["arm", "gripper"]);
  assert.match(fitness.reason ?? "", /has no arm, gripper/);

  assert.equal(abilityFitness(SIMULATED_ROVER, ["arm", "gripper"]).runnable, true);
});

test("a profile makes the governor's limits about this robot", () => {
  const slow: RobotProfile = { ...SIMULATED_ROVER, id: "slow", maxLinear: 0.3 };
  const rig = createSimRig({ scenario: "empty-hall", profile: slow });
  assert.equal(rig.governor.limits.maxLinear, 0.3);
  assert.ok(rig.governor.allowedSpeed(Number.POSITIVE_INFINITY) <= 0.3);
});

test("checkout clears a healthy robot", async () => {
  const rig = createSimRig({ scenario: "empty-hall", profile: SIMULATED_ROVER });
  const result = await rig.runtime.run<CheckoutInput, CheckoutReport>(
    "hardware.checkout",
    {},
  );

  assert.equal(result.ok, true, result.summary);
  assert.equal(result.data?.failures, 0);
  const names = result.data?.checks.map((c) => c.name) ?? [];
  for (const required of ["profile", "lidar", "imu", "battery", "emergency-stop", "brakes"]) {
    assert.ok(names.includes(required), `no ${required} check ran`);
  }
});

test("checkout refuses a profile that claims hardware the robot does not have", async () => {
  const rig = createSimRig({
    scenario: "empty-hall",
    profile: SIMULATED_ROVER,
    capabilities: ["drive", "lidar"],
  });
  const result = await rig.runtime.run<CheckoutInput, CheckoutReport>(
    "hardware.checkout",
    { staticOnly: true },
  );

  assert.equal(result.ok, false);
  assert.equal(result.failure, "precondition");
  const capabilities = result.data?.checks.find((c) => c.name === "capabilities");
  assert.equal(capabilities?.status, "fail");
  assert.match(capabilities?.detail ?? "", /does not expose/);
});

test("checkout notices a sensor that never changes", async () => {
  // A noiseless world produces bit-identical scans from a stationary robot,
  // which is exactly what a frozen driver looks like. The check is expected to
  // say so rather than wave it through.
  const rig = createSimRig({ scenario: "empty-hall", profile: SIMULATED_ROVER });
  rig.world.robot("luka-1").commandedLinear = 0;
  const noiseless = createSimRig({
    scenario: "empty-hall",
    profile: SIMULATED_ROVER,
    limits: {},
  });
  // The simulator's noise is part of the world, so build one without it.
  const world = noiseless.world as unknown as { noise: number };
  world.noise = 0;

  const result = await noiseless.runtime.run<{ staticOnly: boolean }, CheckoutReport>(
    "hardware.checkout",
    { staticOnly: true },
  );

  const lidar = result.data?.checks.find((c) => c.name === "lidar");
  assert.ok(lidar, "no lidar check ran");
  assert.notEqual(lidar.status, "pass", "identical scans must not be reported as healthy");
  assert.match(lidar.detail, /identical/);
});

test("checkout will not test the brakes while an emergency stop is latched", async () => {
  const rig = createSimRig({ scenario: "empty-hall", profile: SIMULATED_ROVER });
  rig.governor.emergencyStop("test");

  const result = await rig.runtime.run<CheckoutInput, CheckoutReport>(
    "hardware.checkout",
    {},
  );

  // The ability itself is motion-class, so a latched stop refuses it outright —
  // which is the correct answer and the one a real operator needs to see.
  assert.equal(result.ok, false);
  assert.match(result.summary, /emergency stop|not cleared/i);
});

// ── the deadman ────────────────────────────────────────────────────────────
// The failure being tested is the one that hurts people: a velocity command
// that outlives whatever sent it. Every test below abandons a command on
// purpose and checks what the guard does about it.

test("an abandoned velocity command expires and latches the base", () => {
  const rig = createSimRig({ scenario: "empty-hall", profile: SIMULATED_ROVER });
  let clock = 0;
  const events: string[] = [];
  const deadman = new Deadman(rig.runtime.robot, {
    commandTimeoutMs: 200,
    stopBurstMs: 100,
    now: () => clock,
    onEvent: (e) => events.push(e.kind),
  });
  const guarded = deadman.guard();

  guarded.drive(0.5, 0);
  clock = 150;
  deadman.tick();
  assert.equal(deadman.state().latched, false, "expired while still fresh");

  // Now let it go stale, as a dead sender would.
  clock = 250;
  deadman.tick();

  assert.equal(deadman.state().latched, true, "a stale motion command did not latch");
  assert.ok(events.includes("expired"));
  assert.ok(events.includes("latched"));
  assert.equal(deadman.state().expiries, 1);
});

test("a latched guard refuses further motion instead of silently dropping it", () => {
  const rig = createSimRig({ scenario: "empty-hall", profile: SIMULATED_ROVER });
  let clock = 0;
  const refusals: string[] = [];
  const deadman = new Deadman(rig.runtime.robot, {
    commandTimeoutMs: 100,
    now: () => clock,
    onEvent: (e) => {
      if (e.kind === "refused") refusals.push(e.reason);
    },
  });
  const guarded = deadman.guard();

  guarded.drive(0.4, 0);
  clock = 200;
  deadman.tick();
  assert.equal(deadman.state().latched, true);

  clock = 500; // past the stop burst
  guarded.drive(0.4, 0);
  assert.equal(refusals.length, 1, "the refusal was not reported");
  assert.match(refusals[0], /went 200 ms without renewal/);
  assert.equal(rig.world.robot("luka-1").commandedLinear, 0);
});

test("a stopped robot is not treated as a stale command", () => {
  // Standing still is a legitimate state, not an abandoned order. A guard that
  // latches on idleness would make every pause require a re-arm.
  const rig = createSimRig({ scenario: "empty-hall", profile: SIMULATED_ROVER });
  let clock = 0;
  const deadman = new Deadman(rig.runtime.robot, {
    commandTimeoutMs: 100,
    now: () => clock,
  });
  const guarded = deadman.guard();

  guarded.drive(0, 0);
  for (clock = 0; clock < 2000; clock += 50) deadman.tick();

  assert.equal(deadman.state().latched, false, "idling latched the base");
  assert.equal(deadman.state().expiries, 0);
});

test("re-arming is refused while the robot is still rolling", async () => {
  const rig = createSimRig({ scenario: "empty-hall", profile: SIMULATED_ROVER });
  let clock = 0;
  const deadman = new Deadman(rig.runtime.robot, {
    commandTimeoutMs: 100,
    now: () => clock,
  });
  const guarded = deadman.guard();

  guarded.drive(0.6, 0);
  // Let the simulated base actually get up to speed.
  for (let i = 0; i < 40; i += 1) rig.world.step(0.02);
  assert.ok(Math.abs(rig.runtime.robot.velocity().linear) > 0.05, "the base never moved");

  clock = 300;
  deadman.tick();
  assert.equal(deadman.state().latched, true);

  const early = deadman.rearm();
  assert.equal(early.ok, false, "re-armed a robot that was still moving");
  assert.match(early.reason ?? "", /still moving/);

  // Let it come to rest, then re-arm.
  rig.runtime.robot.stop();
  for (let i = 0; i < 200; i += 1) rig.world.step(0.02);
  const late = deadman.rearm();
  assert.equal(late.ok, true, late.reason);
  assert.equal(deadman.state().latched, false);
});

test("the guard never resumes on its own", () => {
  // The whole point. Auto-resume on the next command means the robot starts
  // moving again while nobody has decided that it should.
  const rig = createSimRig({ scenario: "empty-hall", profile: SIMULATED_ROVER });
  let clock = 0;
  const deadman = new Deadman(rig.runtime.robot, {
    commandTimeoutMs: 100,
    stopBurstMs: 50,
    now: () => clock,
  });
  const guarded = deadman.guard();

  guarded.drive(0.3, 0);
  clock = 200;
  deadman.tick();

  // A well-behaved sender comes back and starts commanding again.
  for (let i = 0; i < 20; i += 1) {
    clock += 20;
    guarded.drive(0.3, 0);
    deadman.tick();
  }

  assert.equal(deadman.state().latched, true, "the guard resumed without a deliberate re-arm");
  assert.equal(rig.world.robot("luka-1").commandedLinear, 0);
});

test("the crawl profile is what an unknown platform gets", () => {
  // There is deliberately no permissive default: an unidentified robot moves
  // slowly enough that being wrong about it is a bump.
  assert.deepEqual(validateProfile(CRAWL_PROFILE), []);
  assert.equal(CRAWL_PROFILE.maxLinear, CRAWL_LINEAR);
  assert.deepEqual(CRAWL_PROFILE.capabilities, ["drive"]);

  const metric = metricallyTrustworthy(CRAWL_PROFILE);
  assert.equal(metric.ok, false, "assumed kinematics were treated as trustworthy");
  assert.match(metric.reason ?? "", /assumed/);

  // Crawling slowly is what makes the missing watchdog survivable, so it warns
  // rather than blocks — at 0.05 m/s a runaway is walkable-after.
  const findings = auditProfile(CRAWL_PROFILE);
  const watchdog = findings.find((f) => f.code === "no-robot-watchdog");
  assert.equal(watchdog?.level, "warn");
});

test("a fast robot with no robot-side watchdog is blocked, not warned", () => {
  const reckless: RobotProfile = {
    ...GENERIC_ROVER_TEMPLATE,
    id: "reckless",
    maxLinear: 1.2,
    link: {
      kind: "wireless",
      controlPeriodMs: 50,
      maxRoundTripP99Ms: 40,
      robotSideWatchdogMs: null,
    },
  };

  const blocking = auditProfile(reckless).filter((f) => f.level === "block");
  assert.equal(blocking.length, 1, "a 1.2 m/s robot with no firmware watchdog was let through");
  assert.equal(blocking[0].code, "no-robot-watchdog");
  assert.match(blocking[0].message, /1\.20 m\/s/);

  // The same robot is fine once the base can stop itself.
  const fixed: RobotProfile = {
    ...reckless,
    link: { ...reckless.link!, robotSideWatchdogMs: 100 },
  };
  assert.equal(auditProfile(fixed).filter((f) => f.level === "block").length, 0);
});

test("a link whose tail is longer than the control period cannot close a loop", () => {
  const laggy: RobotProfile = {
    ...GENERIC_ROVER_TEMPLATE,
    id: "laggy",
    link: {
      kind: "wireless",
      controlPeriodMs: 20,
      maxRoundTripP99Ms: 180,
      robotSideWatchdogMs: 100,
    },
  };

  const verdict = linkSupportsControl(laggy);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason ?? "", /p99 round trip is 180 ms/);

  // A measurement overrides the declared figure in both directions.
  assert.equal(linkSupportsControl(laggy, 8).ok, true);
  assert.equal(linkSupportsControl(SIMULATED_ROVER, 400).ok, false);
});
