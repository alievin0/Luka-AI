// The lidar fan is drawn twice, from one scan, by two renderers. These tests
// hold the convention they both have to follow — and each of them was written
// against a bug that was actually on screen.

import test from "node:test";
import assert from "node:assert/strict";

import { beamAngle, beamLocal, beams, classify, localToWorld, beamWorld } from "../../../app/robots/_lib/beams.ts";
import { createSimRig } from "../index.ts";

const FOV = Math.PI * 1.5;

test("beam angles span exactly the field of view", () => {
  const count = 61;
  const stride = 3;
  assert.equal(beamAngle(FOV, stride, count, 0), -FOV / 2);
  assert.ok(Math.abs(beamAngle(FOV, stride, count, count - 1) - FOV / 2) < 1e-12);
});

test("a single-sample scan does not divide by zero", () => {
  assert.equal(beamAngle(FOV, 1, 1, 0), -FOV / 2);
});

test("the 3D local frame, rotated by the robot's heading, lands where the 2D renderer draws", () => {
  // The bug this catches: negating the z component reflects the whole scan
  // about the robot's forward axis. With a symmetric field of view the fan
  // keeps its shape, so it looks plausible — a wall measured on the left is
  // simply drawn on the right.
  const scan = { ranges: [1, 2.5, 4, 12, 0.7], fov: FOV, stride: 4, maxRange: 12 };
  for (const theta of [0, 0.4, -1.2, 2.9, Math.PI]) {
    const robot = { x: 3.25, y: 1.75, theta };
    for (const beam of beams(scan)) {
      const direct = beamWorld(robot, beam);
      const viaGroup = localToWorld(robot, beamLocal(beam));
      assert.ok(
        Math.hypot(direct.x - viaGroup.x, direct.y - viaGroup.y) < 1e-12,
        `theta=${theta} angle=${beam.angle}: ${JSON.stringify(direct)} vs ${JSON.stringify(viaGroup)}`,
      );
    }
  }
});

test("an asymmetric scan would expose a reflected fan", () => {
  // Proof that the test above has teeth: with the sign flipped, a beam that is
  // not on the axis of symmetry lands somewhere else entirely.
  const beam = { kind: "hit" as const, angle: 0.9, reach: 3 };
  const robot = { x: 0, y: 0, theta: 0 };
  const mirrored = localToWorld(robot, { x: Math.cos(0.9) * 3, z: -Math.sin(0.9) * 3 });
  assert.ok(Math.hypot(mirrored.x - beamWorld(robot, beam).x, mirrored.y - beamWorld(robot, beam).y) > 1);
});

test("a missing return, a clear return and a hit are three different things", () => {
  assert.equal(classify(Number.NaN, 12), "missing");
  assert.equal(classify(12, 12), "clear");
  assert.equal(classify(11.96, 12), "clear"); // inside the 0.05 m ceiling band
  assert.equal(classify(11.9, 12), "hit"); // and just outside it is a measurement
  assert.equal(classify(4.2, 12), "hit");
});

test("a dropped beam never becomes a range", () => {
  // The adapter reports NaN for a beam that did not come back. Neither renderer
  // may turn that into a drawn endpoint: "no return" is not "clear to 12 m".
  const scan = { ranges: [3, Number.NaN, 12], fov: FOV, stride: 1, maxRange: 12 };
  const kinds = beams(scan).map((b) => b.kind);
  assert.deepEqual(kinds, ["hit", "missing", "clear"]);
});

test("the fan the renderers draw matches the scan the adapter cast", () => {
  // End to end against the real simulator: every beam the renderer would place
  // must sit on the ray the adapter measured, at the range it measured.
  const rig = createSimRig({ scenario: "cluttered-office", seed: 7 });
  for (let i = 0; i < 40; i += 1) rig.world.step(0.05);
  const scan = rig.robot.lidar();
  const { pose } = rig.world.snapshot().robots[0];
  const robot = { x: pose.x, y: pose.y, theta: pose.theta };

  const stride = 3;
  const sampled = scan.ranges.filter((_, i) => i % stride === 0);
  const drawn = beams({ ranges: sampled, fov: scan.fov, stride, maxRange: scan.maxRange });

  assert.ok(drawn.length > 10);
  drawn.forEach((beam, i) => {
    const original = scan.ranges[i * stride];
    if (!Number.isFinite(original)) {
      assert.equal(beam.kind, "missing");
      return;
    }
    // Same angle the adapter cast this beam at.
    const cast = robot.theta - scan.fov / 2 + i * stride * (scan.fov / (scan.ranges.length - 1));
    assert.ok(Math.abs((robot.theta + beam.angle) - cast) < 1e-9, `beam ${i}: ${robot.theta + beam.angle} vs ${cast}`);

    const world = localToWorld(robot, beamLocal(beam));
    const range = Math.hypot(world.x - robot.x, world.y - robot.y);
    assert.ok(Math.abs(range - beam.reach) < 1e-9);
  });
});
