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
