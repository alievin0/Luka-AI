// The capability gate, and what it catches that a hardware list cannot.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createSimRig } from "../index.ts";
import { gatherEvidence, summariseEvidence } from "../core/evidence.ts";
import { evaluateGate, type EvidenceRequirement } from "../core/gate.ts";

test("a declared lidar that reports nothing usable is not a lidar", async () => {
  // The whole reason the gate exists. `requires: ["drive", "lidar"]` asks
  // whether the part is bolted on, and a driver publishing NaN across every
  // beam passes that question while telling the robot the room is empty.
  const rig = createSimRig({ scenario: "cluttered-office" });
  const robot = rig.runtime.rawRobot;
  const real = robot.lidar();

  assert.ok(robot.capabilities.includes("lidar"), "the hardware is declared present");

  Object.assign(robot, { lidar: () => ({ ...real, ranges: real.ranges.map(() => Number.NaN) }) });

  const result = await rig.runtime.run("navigate.to", { x: 9, y: 6, timeoutMs: 20_000 });
  assert.equal(result.ok, false, "navigated on a lidar that reports nothing");
  assert.equal(result.failure, "precondition");
  // The refusal has to name the requirement and the reading, not a boolean.
  assert.match(result.summary, /lidar/);
  assert.match(result.summary, /not one carries data/);
});

test("evidence tells absent, invalid and degraded apart", () => {
  const full = createSimRig({ scenario: "cluttered-office" });
  const healthy = gatherEvidence(full.runtime.rawRobot, full.world.timeMs);
  assert.equal(healthy.get("lidar")?.quality, "good");
  assert.equal(healthy.get("people")?.quality, "good");

  // No camera: people are absent, which is different from nobody being there.
  const blind = createSimRig({ scenario: "busy-corridor", capabilities: ["drive", "lidar"] });
  const noEyes = gatherEvidence(blind.runtime.rawRobot, blind.world.timeMs);
  assert.equal(noEyes.get("people")?.quality, "absent");
  assert.match(noEyes.get("people")?.reason ?? "", /nobody is looking/);

  // A driver publishing nothing usable is running, so it is invalid rather
  // than absent — the two mean different things to whoever has to fix it.
  const robot = full.runtime.rawRobot;
  const real = robot.lidar();
  Object.assign(robot, { lidar: () => ({ ...real, ranges: real.ranges.map(() => Number.NaN) }) });
  assert.equal(gatherEvidence(robot, full.world.timeMs).get("lidar")?.quality, "invalid");

  // Half the beams answering is degraded, not broken.
  Object.assign(robot, {
    lidar: () => ({
      ...real,
      ranges: real.ranges.map((r, i) => (i % 2 === 0 ? r : Number.NaN)),
    }),
  });
  const half = gatherEvidence(robot, full.world.timeMs).get("lidar");
  assert.equal(half?.quality, "degraded");
  assert.ok(half!.completeness > 0.4 && half!.completeness < 0.6, `${half?.completeness}`);
});

test("a timestamp of zero is a timestamp", () => {
  // Written after the gate refused every run at world time zero. The age check
  // used `t > 0` to decide whether a timestamp existed, so the first instant of
  // a run was indistinguishable from an unstamped reading — which is the exact
  // confusion this whole layer exists to prevent, committed inside it.
  const rig = createSimRig({ scenario: "empty-hall" });
  assert.equal(rig.world.timeMs, 0, "this test needs a world that has not stepped");

  const evidence = gatherEvidence(rig.runtime.rawRobot, rig.world.timeMs);
  const lidar = evidence.get("lidar");
  assert.equal(lidar?.clock, "sensor");
  assert.equal(lidar?.ageMs, 0, "a stamped reading at time zero was read as having no age");

  const fresh: EvidenceRequirement[] = [
    { source: "lidar", because: "test", maxAgeMs: 100 },
  ];
  assert.equal(evaluateGate(fresh, evidence).admitted, true);
});

test("a requirement with no measurable age fails rather than passing", () => {
  // An age that cannot be established is not an age of zero.
  const rig = createSimRig({ scenario: "empty-hall" });
  const evidence = gatherEvidence(rig.runtime.rawRobot, rig.world.timeMs);
  const unstamped = evidence.get("lidar")!;
  evidence.set("lidar", { ...unstamped, ageMs: null, clock: "arrival" });

  const verdict = evaluateGate(
    [{ source: "lidar", because: "it plans from the scan", maxAgeMs: 200 }],
    evidence,
  );
  assert.equal(verdict.admitted, false);
  assert.match(verdict.refusal ?? "", /cannot be established/);
});

test("degraded evidence is admitted only where a capability asked for it", () => {
  const rig = createSimRig({ scenario: "cluttered-office" });
  const robot = rig.runtime.rawRobot;
  const real = robot.lidar();
  Object.assign(robot, {
    lidar: () => ({ ...real, ranges: real.ranges.map((r, i) => (i % 2 === 0 ? r : Number.NaN)) }),
  });
  const evidence = gatherEvidence(robot, rig.world.timeMs);

  const strict = evaluateGate([{ source: "lidar", because: "needs a full scan" }], evidence);
  assert.equal(strict.admitted, false, "a capability got degraded evidence without asking");
  assert.match(strict.refusal ?? "", /does not accept degraded/);

  const tolerant = evaluateGate(
    [{ source: "lidar", because: "works on a partial scan", acceptDegraded: true }],
    evidence,
  );
  assert.equal(tolerant.admitted, true);
  // Admitted, and the caller is told it is running on less than it wanted.
  assert.equal(tolerant.degraded, true, "running degraded was not flagged");
});

test("a verdict carries every check, not just the answer", () => {
  // `admitted` exists for the caller that only wants to branch, and it is
  // derived from the checks so the two cannot disagree. A refusal nobody can
  // act on is not a refusal.
  // A rover with no arm, so one of the three requirements genuinely fails.
  const rig = createSimRig({
    scenario: "cluttered-office",
    capabilities: ["drive", "lidar", "imu", "battery"],
  });
  const evidence = gatherEvidence(rig.runtime.rawRobot, rig.world.timeMs);

  const verdict = evaluateGate(
    [
      { source: "lidar", because: "sees obstacles" },
      { source: "arm", because: "needs to reach" },
      { source: "pose", because: "needs to know where it is" },
    ],
    evidence,
  );

  assert.equal(verdict.checks.length, 3, "checks were dropped once one failed");
  assert.equal(verdict.checks.filter((c) => c.passed).length, 2);
  assert.equal(verdict.admitted, verdict.checks.every((c) => c.passed));
  for (const check of verdict.checks) {
    assert.ok(check.detail.length > 0, `${check.requirement} gave no detail`);
  }
  assert.ok(summariseEvidence(evidence).includes("good"));
});
