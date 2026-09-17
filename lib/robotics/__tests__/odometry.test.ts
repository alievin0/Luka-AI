// The robot does not know where it is.
//
// Until dead reckoning existed here, it did. `pose()` returned the true
// position plus zero-mean noise, so the error stayed around four centimetres
// however far the robot drove and a closed loop brought it home exactly. Every
// capability that plans in world coordinates was developed against a robot with
// a perfect position estimate, which is the single most flattering thing a
// wheeled-robot simulator can do — drift is the dominant error of the platform
// and the reason SLAM exists.
//
// `explore.frontier` even lists "odometry drift accumulates into the map" among
// its failure modes. That was written from knowing it is true, not from having
// seen it, because the simulator could not produce it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createSimRig } from "../index.ts";

/** Drive a straight-and-turn route and report where things ended up. */
function route(seed: number, ticks = 700) {
  const rig = createSimRig({ scenario: "empty-hall", seed });
  const robot = rig.world.robot(rig.robot.id);
  const samples: Array<{ travelled: number; error: number }> = [];

  for (let tick = 0; tick < ticks; tick += 1) {
    const straight = Math.floor(tick / 80) % 2 === 0;
    robot.commandedLinear = straight ? 0.6 : 0.1;
    robot.commandedAngular = straight ? 0 : 0.7;
    rig.world.step(0.05);
    samples.push({
      travelled: robot.distanceTravelled,
      error: Math.hypot(robot.odom.x - robot.pose.x, robot.odom.y - robot.pose.y),
    });
  }
  return { rig, robot, samples };
}

test("the position estimate gets worse the further the robot drives", () => {
  // The property that separates drift from noise. Bounded noise has the same
  // error at twelve metres as at three; drift does not, and a robot that plans
  // a long trip on it is planning on something that has quietly stopped being
  // true.
  let early = 0;
  let late = 0;
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

  for (const seed of seeds) {
    const { samples } = route(seed);
    const at = (metres: number) =>
      samples.find((s) => s.travelled >= metres)?.error ?? samples[samples.length - 1].error;
    early += at(3);
    late += at(12);
  }

  early /= seeds.length;
  late /= seeds.length;
  assert.ok(
    late > early * 1.5,
    `error at 12 m (${late.toFixed(3)} m) is not meaningfully worse than at 3 m ` +
      `(${early.toFixed(3)} m) — this is noise, not drift`,
  );
});

test("driving a loop back to the start does not bring the estimate home", () => {
  // Most odometry error is systematic — a wheel radius two per cent off, a
  // wheelbase measured a centimetre wide — so it accumulates in the same
  // direction rather than averaging out. A robot that returns to where it
  // started still believes it is somewhere else, which is exactly why a
  // remembered world coordinate goes stale.
  const rig = createSimRig({ scenario: "empty-hall", seed: 3 });
  const robot = rig.world.robot(rig.robot.id);

  for (let tick = 0; tick < 1000; tick += 1) {
    const leg = Math.floor(tick / 60) % 4;
    robot.commandedLinear = leg % 2 === 0 ? 0.6 : 0;
    robot.commandedAngular = leg % 2 === 1 ? Math.PI / 2 / (60 * 0.05) : 0;
    rig.world.step(0.05);
  }

  const disagreement = Math.hypot(robot.odom.x - robot.pose.x, robot.odom.y - robot.pose.y);
  assert.ok(
    disagreement > 0.05,
    `after a closed loop the estimate came back to within ${disagreement.toFixed(3)} m, ` +
      "which means the error is cancelling and is therefore not systematic",
  );
});

test("wheels that spin without moving the robot wreck the estimate specifically", () => {
  // The consequence of a self-motion conflict, as ground truth rather than as
  // arithmetic done on the side. Odometry integrates wheel speed, so a floor
  // that will not carry the robot produces distance that was never travelled.
  const rig = createSimRig({ scenario: "empty-hall", seed: 4 });
  const robot = rig.world.robot(rig.robot.id);

  for (let tick = 0; tick < 60; tick += 1) {
    if (tick === 20) robot.groundTraction = 0;
    robot.commandedLinear = 0.6;
    rig.world.step(0.1);
  }

  const believed = Math.hypot(robot.odom.x, robot.odom.y);
  const error = Math.hypot(robot.odom.x - robot.pose.x, robot.odom.y - robot.pose.y);
  assert.ok(error > 1.0, `the wheels spun for four seconds and the estimate is only ${error.toFixed(2)} m out`);
  assert.ok(believed > 0, "sanity: the robot believes it went somewhere");
});

test("what a sensor measures does not inherit the odometry error", () => {
  // A camera measures a bearing and a range. That measurement is relative to
  // the robot and carries no dead-reckoning error at all; world coordinates
  // only appear when the robot composes it with its own believed pose.
  //
  // Reporting true world positions while the pose drifts counts the error
  // twice, and the robot computes a relative geometry that is wrong by the
  // drift when it is the one thing that should be right. Measured before this
  // was fixed: a robot could not grasp an object it was standing beside.
  const rig = createSimRig({ scenario: "cluttered-office", seed: 2 });
  const robot = rig.world.robot(rig.robot.id);

  // Drive far enough for the estimate to be meaningfully wrong.
  for (let tick = 0; tick < 200; tick += 1) {
    robot.commandedLinear = 0.5;
    robot.commandedAngular = tick > 100 ? 0.3 : 0;
    rig.world.step(0.05);
  }
  const drift = Math.hypot(robot.odom.x - robot.pose.x, robot.odom.y - robot.pose.y);
  assert.ok(drift > 0.02, "this test needs the estimate to have drifted");

  const seen = rig.robot.detectObjects();
  if (seen.length === 0) return; // nothing in view on this seed; the claim is untestable here

  const believedPose = rig.robot.pose();
  for (const detection of seen) {
    const reportedRange = Math.hypot(detection.at.x - believedPose.x, detection.at.y - believedPose.y);
    // The true range from the true pose to the true object.
    const truth = rig.world.objects.find((o) => o.id === detection.id);
    if (!truth) continue;
    const trueRange = Math.hypot(truth.at.x - robot.pose.x, truth.at.y - robot.pose.y);
    assert.ok(
      Math.abs(reportedRange - trueRange) < 0.25,
      `the robot thinks ${detection.id} is ${reportedRange.toFixed(2)} m away and it is ` +
        `${trueRange.toFixed(2)} m away, a relative error that should not exist`,
    );
  }
});

test("the dock beacon is a measurement, not a memory", () => {
  // Dead reckoning does not put a robot on a charging contact: over the
  // distances the power lifeline exists for, the accumulated error is most of a
  // metre and the dock needs a third of one. Every real docking system solves
  // this with something that does not go through odometry, and so does this.
  const rig = createSimRig({ scenario: "empty-hall", seed: 6 });
  const robot = rig.world.robot(rig.robot.id);
  const beacons = rig.robot as unknown as {
    dockBeacon(): { at: { x: number; y: number }; distance: number } | null;
  };

  // Out of range from the spawn, wherever that is relative to the dock.
  robot.pose.x = rig.world.dock.x + 8;
  robot.pose.y = rig.world.dock.y;
  assert.equal(beacons.dockBeacon(), null, "the beacon answered from eight metres away");

  // Close in, with a deliberately corrupted estimate: the beacon must still be
  // right about how far away the dock is.
  robot.pose.x = rig.world.dock.x + 1.5;
  robot.odom.x = robot.pose.x + 0.9;
  robot.odom.y = robot.pose.y - 0.6;
  const fix = beacons.dockBeacon();
  assert.ok(fix, "the beacon did not answer from a metre and a half away");
  assert.ok(
    Math.abs(fix.distance - 1.5) < 0.1,
    `the beacon reported ${fix.distance.toFixed(2)} m where the dock is 1.50 m away`,
  );
  // And the world position it gives must be consistent with what the robot
  // believes, so driving to it actually arrives.
  const believed = rig.robot.pose();
  const impliedRange = Math.hypot(fix.at.x - believed.x, fix.at.y - believed.y);
  assert.ok(
    Math.abs(impliedRange - 1.5) < 0.15,
    `driving to the reported dock position would cover ${impliedRange.toFixed(2)} m, not 1.50`,
  );
});

// ── The fuel gauge ─────────────────────────────────────────────────────────

test("the fuel gauge is not a fuel meter", () => {
  // State of charge is inferred, not measured. The usual inference is a voltage
  // curve that is nearly flat through the middle of a lithium discharge, so a
  // small voltage error is a large charge error, and it carries a systematic
  // offset per pack and per cell age.
  //
  // This reported the true coulomb state to within 0.2% before, which is a
  // better gauge than exists. `power.lifeline` decides when to abandon a
  // mission from this number, so how wrong it can be is the whole question.
  const rig = createSimRig({ scenario: "empty-hall", seed: 5 });
  const robot = rig.world.robot(rig.robot.id);
  const gauge = rig.robot as unknown as { trueCharge(): number };

  const errors: number[] = [];
  for (let tick = 0; tick < 400; tick += 1) {
    robot.commandedLinear = tick % 100 < 70 ? 0.7 : 0;
    rig.world.step(0.1);
    errors.push(rig.robot.battery().charge - gauge.trueCharge());
  }

  const worst = Math.max(...errors.map(Math.abs));
  assert.ok(worst > 0.005, `the gauge is accurate to ${(worst * 100).toFixed(2)}%, which no gauge is`);
  assert.ok(worst < 0.15, `the gauge is off by ${(worst * 100).toFixed(0)}%, which is not a gauge either`);
});

test("a driving robot reads lower than the same robot standing still", () => {
  // Terminal voltage sags under load, so the indicated charge drops when the
  // motors pull and recovers when they stop — with the same energy in the pack
  // either way. It is why a robot that pauses to think about returning finds it
  // has more charge than it did while moving, and it is the artifact most
  // likely to make a power policy dither.
  const rig = createSimRig({ scenario: "empty-hall", seed: 5 });
  const robot = rig.world.robot(rig.robot.id);

  // Driving first and resting second, so the comparison is unambiguous: by the
  // time the robot stops it has *less* energy left, and if the gauge still
  // reads higher then the difference can only be the load coming off.
  //
  // Averaged, because the sag here is under two per cent and a single reading
  // carries one per cent of noise. A test that samples once passes or fails on
  // the noise, which is a test of the seed.
  const mean = (samples: number[]) => samples.reduce((a, b) => a + b, 0) / samples.length;

  robot.commandedLinear = 1.0;
  const driving: number[] = [];
  for (let i = 0; i < 40; i += 1) {
    rig.world.step(0.05);
    if (i >= 20) driving.push(rig.robot.battery().charge);
  }

  robot.commandedLinear = 0;
  const resting: number[] = [];
  for (let i = 0; i < 40; i += 1) {
    rig.world.step(0.05);
    if (i >= 20) resting.push(rig.robot.battery().charge);
  }

  assert.ok(
    mean(resting) > mean(driving),
    `at rest the gauge read ${(mean(resting) * 100).toFixed(2)}% and while driving ` +
      `${(mean(driving) * 100).toFixed(2)}%, with less energy left at rest — so there is no ` +
      "load sag and the gauge is better than a real one",
  );
});

test("the reported draw is the draw, including the arm", () => {
  // The adapter used to recompute the wattage with its own copy of the
  // constants and leave the arm out, so a robot moving its manipulator reported
  // a figure missing 22 W against an idle of 12 — and `hardware.checkout`
  // printed it to a person. Two implementations of one calculation agree until
  // they do not, which is why there is now one.
  const rig = createSimRig({ scenario: "kitchen-fetch", seed: 1 });
  const robot = rig.world.robot(rig.robot.id);

  const idle = rig.robot.battery().drawWatts;
  robot.armTarget = { x: robot.pose.x + 0.4, y: robot.pose.y };
  const reaching = rig.robot.battery().drawWatts;

  assert.ok(
    reaching > idle + 10,
    `moving the arm changed the reported draw from ${idle.toFixed(1)} W to ${reaching.toFixed(1)} W, ` +
      "which does not account for a manipulator",
  );
});

// ── The IMU ────────────────────────────────────────────────────────────────

test("the IMU reports a fused estimate, because that is what an IMU has", () => {
  // An IMU does not measure tilt. It measures angular rate and specific force,
  // and tilt is a fusion of the two — the gyro integrated because it is smooth
  // and fast, pulled slowly toward what gravity says because the gyro drifts.
  // The simulator used to hand out the true tilt with three milliradians of
  // noise, which is not a sensor, it is the answer.
  const rig = createSimRig({ scenario: "empty-hall", seed: 3 });
  const truth = rig.robot as unknown as { trueTilt(): number };

  rig.world.applyTiltImpulse(rig.robot.id, 1.6);
  let worst = 0;
  for (let i = 0; i < 150; i += 1) {
    rig.world.step(0.02);
    worst = Math.max(worst, Math.abs(rig.robot.imu().tilt - truth.trueTilt()));
  }

  assert.ok(worst > 0.004, `the tilt estimate is accurate to ${worst.toFixed(4)} rad, which is the answer`);
  // And bounded: an estimate that runs away is a bug in the filter, not realism.
  assert.ok(worst < 0.1, `the tilt estimate was ${worst.toFixed(3)} rad out, which is not a filter`);
});

test("a robot on the floor has stopped falling", () => {
  // The tilt was clamped at ninety degrees and the tilt *rate* was not, so a
  // robot that had already landed kept accumulating rate at fourteen radians
  // per second squared for as long as the simulation ran. Every test read the
  // tilt, which is clamped and looked right. It surfaced only when an IMU model
  // started integrating the rate and reported a tilt of 905 degrees.
  const rig = createSimRig({ scenario: "empty-hall", seed: 1 });
  const robot = rig.world.robot(rig.robot.id);

  rig.world.applyTiltImpulse(rig.robot.id, 6);
  for (let i = 0; i < 300; i += 1) rig.world.step(0.02);

  assert.ok(Math.abs(robot.tilt) > 1.5, "the robot did not fall, so this proves nothing");
  assert.ok(
    Math.abs(robot.tiltRate) < 0.001,
    `a robot lying on the floor is still tipping at ${robot.tiltRate.toFixed(1)} rad/s`,
  );
});

test("a gyro carries a bias, which is what makes an unaided estimate walk", () => {
  // Every MEMS gyro has a constant offset, typically half a degree to two
  // degrees per second. It is why integrating a rate without a reference does
  // not stay pointing at anything.
  const rig = createSimRig({ scenario: "empty-hall", seed: 2 });
  const robot = rig.world.robot(rig.robot.id);

  let reported = 0;
  for (let i = 0; i < 50; i += 1) {
    rig.world.step(0.02);
    reported += rig.robot.imu().yawRate;
  }
  const mean = reported / 50;

  assert.equal(robot.angular, 0, "this test needs a robot that is not turning");
  assert.ok(
    Math.abs(mean) > 1e-4,
    "a stationary robot's gyro averaged to zero over fifty samples, which no gyro does",
  );
  assert.ok(
    Math.abs(mean) < 0.05,
    `the gyro reads ${mean.toFixed(3)} rad/s at rest, which is broken rather than biased`,
  );
});

test("gyro bias does not trip the contradiction detector", () => {
  // Worth checking against my own work: the world-state detector compares wheel
  // odometry to the gyro at a 0.5 rad/s threshold, and a real gyro now disagrees
  // with the wheels by its bias at all times. If that bias were near the
  // threshold the detector would cry fault on every healthy robot.
  const rig = createSimRig({ scenario: "cluttered-office", seed: 4 });
  for (let tick = 0; tick < 200; tick += 1) {
    const command = rig.governor.govern(rig.robot, 0.4, tick % 60 < 30 ? 0 : 0.5);
    rig.robot.drive(command.linear, command.angular);
    rig.world.step(0.05);
    assert.equal(
      rig.governor.standingConflicts().length,
      0,
      `a healthy robot with an ordinary gyro bias was accused of ` +
        `${rig.governor.standingConflicts().map((c) => c.kind).join(", ")}`,
    );
  }
});
