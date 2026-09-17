// What a scan cannot see, as opposed to how many of its beams answered.
//
// `scanQuality` counts beams. Counting cannot tell apart the two ways a lidar
// half-fails, and measured on the same navigation task at an identical 70% of
// beams answering, the two produced 0 collisions and 2,814.

import { test } from "node:test";
import assert from "node:assert/strict";

import { scanCoverage, nearestObstacle, scanQuality } from "../safety/governor.ts";
import { createSimRig } from "../index.ts";
import { lookFirst } from "../abilities/look-first.ts";
import type { LidarScan } from "../core/types.ts";

const FOV = Math.PI * 1.5;
const BEAMS = 181;

/** A scan where `blind(angle)` decides which beams return nothing. */
const scan = (range: (angle: number) => number, blind?: (angle: number) => boolean): LidarScan => ({
  ranges: Array.from({ length: BEAMS }, (_, i) => {
    const angle = -FOV / 2 + (FOV * i) / (BEAMS - 1);
    return blind?.(angle) ? Number.NaN : range(angle);
  }),
  fov: FOV,
  maxRange: 12,
  t: 0,
});

test("an unanswered beam does not become a clear path", () => {
  // The defect this file exists for. Every comparison against NaN is false, so
  // an unanswered beam falls through each guard in `nearestObstacle` in turn
  // and leaves the nearest obstacle at maximum range. Nobody wrote "treat a
  // dead beam as clear" — it is what NaN arithmetic does when nothing asks.
  const wall = (angle: number) => (Math.abs(angle) < 0.9 ? 1.2 / Math.cos(angle) : 12);
  const seen = scan(wall);
  const blinded = scan(wall, (angle) => Math.abs(angle) < 0.5);

  assert.ok(nearestObstacle(seen) < 1.0, "a wall 1.2 m ahead should be close");
  // Unchanged, and that is the point: `nearestObstacle` reports the nearest
  // *return*, and there are none. It is not lying; it is being asked the wrong
  // question.
  assert.equal(nearestObstacle(blinded), 12);
  assert.ok(scanQuality(blinded) > 0.7, "and the beam count says the sensor is fine");

  // The question that catches it: how close could the thing I cannot see be?
  const coverage = scanCoverage(blinded);
  assert.ok(
    Number.isFinite(coverage.hiddenNearest),
    "a wall-sized hole straight ahead reported nothing could be hiding in it",
  );
  assert.ok(coverage.hiddenNearest < 1.0);
});

test("scattered dropout hides nothing, and the geometry says so on its own", () => {
  // Derived rather than tuned: one missing beam out of 181 across 270° spans
  // about 0.0145 rad, and a 0.15 m obstacle only fits inside that from
  // 2·0.15/0.0145 ≈ 20 m — past the sensor's range. This is why uniform
  // thinning measured identically to a healthy robot, and it should fall out of
  // the arithmetic rather than being special-cased.
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const thinned = scan(() => 8, () => random() < 0.3);

  assert.ok(scanQuality(thinned) < 0.8, "this test needs a meaningfully thinned scan");
  assert.equal(
    scanCoverage(thinned).hiddenNearest,
    Number.POSITIVE_INFINITY,
    "scattered single-beam gaps were treated as though something could hide in them",
  );
});

test("a contiguous arc of the same size can hide something, and is reported", () => {
  const wedge = scan(() => 8, (angle) => Math.abs(angle - 0.6) <= (FOV * 0.3) / 2);
  const coverage = scanCoverage(wedge);

  assert.ok(coverage.largestGap > 1.0, "an 80° wedge should read as a wide gap");
  assert.ok(
    Number.isFinite(coverage.hiddenNearest),
    "a wedge wide enough to swallow a person reported nothing could hide in it",
  );
  assert.ok(Math.abs(coverage.gapCentre - 0.6) < 0.2, "the gap should be reported where it is");
});

test("a hiding place inside the robot's own body is not a hiding place", () => {
  // The first version of this reported concealment at 0.23 m on a robot of
  // radius 0.28 — a point the robot is already occupying. The governor read it
  // as an obstacle inside its stopping clearance and refused to move at all,
  // across every wedge geometry tested. A robot that will not move is not a
  // degraded robot.
  const wedge = scan(() => 8, (angle) => Math.abs(angle - 0.6) <= (FOV * 0.3) / 2);
  const coverage = scanCoverage(wedge, 0.28, 0.15);
  assert.ok(
    coverage.hiddenNearest >= 0.28,
    `something cannot hide at ${coverage.hiddenNearest.toFixed(2)} m from a robot of radius 0.28`,
  );
});

test("a gap behind the robot is not a reason to slow down", () => {
  // Honest about the limit as much as the capability: this measure speaks only
  // to what the robot is driving into, so a robot reversing gets nothing from
  // it. Stated in a test so the limitation cannot be forgotten and then relied
  // on the other way round.
  const behind = scan(() => 8, (angle) => Math.abs(angle) > 2.0);
  assert.equal(scanCoverage(behind).hiddenNearest, Number.POSITIVE_INFINITY);
});

test("the same beam count, two different robots", () => {
  // The headline, as a test. Both scans lose 30% of their beams. One is a robot
  // that can see everywhere a little less densely; the other has a direction it
  // is blind in. `scanQuality` gives them the same number.
  let seed = 11;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const thinned = scan(() => 8, () => random() < 0.3);
  const wedge = scan(() => 8, (angle) => Math.abs(angle - 0.6) <= (FOV * 0.3) / 2);

  assert.ok(
    Math.abs(scanQuality(thinned) - scanQuality(wedge)) < 0.1,
    "this test needs the two failures to look the same to a beam count",
  );
  assert.equal(scanCoverage(thinned).hiddenNearest, Number.POSITIVE_INFINITY);
  assert.ok(Number.isFinite(scanCoverage(wedge).hiddenNearest));
});

test("the governor slows for what it cannot see, and only for that", () => {
  // End to end. A robot whose scan has a blind wedge should be held to a speed
  // it can stop from within the nearest place something could be hiding — and a
  // robot whose scan is merely thin should not be held to anything.
  const healthy = createSimRig({ scenario: "cluttered-office", seed: 2 });
  const thin = createSimRig({ scenario: "cluttered-office", seed: 2, beamDropout: 0.3 });
  const blind = createSimRig({
    scenario: "cluttered-office",
    seed: 2,
    blindSector: { centre: 0.6, width: FOV * 0.3 },
  });

  const speedOf = (rig: ReturnType<typeof createSimRig>) =>
    rig.governor.govern(rig.robot, 1.2, 0).linear;

  const healthySpeed = speedOf(healthy);
  assert.ok(
    speedOf(thin) >= healthySpeed - 1e-6,
    "a thinned scan was penalised even though nothing can hide in it",
  );
  assert.ok(
    speedOf(blind) < healthySpeed,
    "a robot with a blind wedge was allowed the same speed as one that can see",
  );
  assert.ok(speedOf(blind) > 0, "it should be slowed, not stopped — degradation is not a halt");
});

// ── The idea that was measured and not shipped ─────────────────────────────
//
// `sense.look-first` is kept in the tree as a negative result and is
// deliberately not in the registry. These tests hold the reasons in place so
// the write-up cannot quietly stop being true.

test("look-first is not registered, because measuring it said not to", () => {
  // Collisions fell from 23 to 2 and from 604 to 101, and arrival fell from
  // 20/20 to 0/20 on two geometries that used to get through. A robot that
  // stops colliding by not going anywhere has been switched off, not made safe.
  const rig = createSimRig({ scenario: "empty-hall", seed: 1 });
  assert.equal(
    rig.registry.get("sense.look-first"),
    undefined,
    "look-first was registered — if the measurements changed, change the file's header too",
  );
});

test("look-first still declares itself an idea rather than a result", () => {
  assert.equal(lookFirst.manifest.proof?.status, "IDEA");
  assert.ok(
    lookFirst.manifest.proof?.failureModes.length ?? 0 > 0,
    "a capability with no known failure modes is a capability nobody has run",
  );
});
