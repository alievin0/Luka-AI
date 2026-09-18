import { test } from "node:test";
import assert from "node:assert/strict";

import { clamp, wrapAngle, angleDiff, Pid, RunningStats, makeRng } from "../core/math.ts";
import { fitDmp, rolloutDmp, trajectoryRmse, type DemoPoint } from "../core/dmp.ts";
import { validate } from "../core/schema.ts";
import { AbilityRegistry } from "../core/registry.ts";
import { createMemory, createInMemoryBackend } from "../core/memory.ts";
import { SafetyGovernor } from "../safety/governor.ts";
import { createRegistry } from "../abilities/index.ts";
import type { Ability } from "../core/types.ts";

test("angles wrap into [-pi, pi) and stay congruent", () => {
  for (const a of [3 * Math.PI, -3 * Math.PI, 7.1, -12.4, 0.3]) {
    const wrapped = wrapAngle(a);
    assert.ok(wrapped >= -Math.PI - 1e-12 && wrapped < Math.PI, `${a} wrapped to ${wrapped}`);
    const turns = (a - wrapped) / (2 * Math.PI);
    assert.ok(Math.abs(turns - Math.round(turns)) < 1e-9, `${a} changed angle, not just turns`);
  }
  assert.ok(Math.abs(angleDiff(0.1, -0.1) + 0.2) < 1e-9);
  // Going from 170° to -170° is a 20° turn, not 340°.
  assert.ok(Math.abs(angleDiff(2.967, -2.967)) < 0.36);
});

test("PID saturates without winding up", () => {
  const pid = new Pid(2, 5, 0, 1);
  let last = 0;
  for (let i = 0; i < 200; i += 1) last = pid.step(10, 0.02);
  assert.ok(last <= 1 + 1e-9, `output ${last} exceeded the limit`);
  // After a long saturation, the error reversing should reverse the output
  // quickly — that only happens if the integral did not run away.
  const reversed = pid.step(-10, 0.02);
  assert.ok(reversed < 0.5, `wound up: ${reversed}`);
});

test("RunningStats matches the batch computation", () => {
  const samples = [2, 4, 4, 4, 5, 5, 7, 9];
  const stats = new RunningStats();
  for (const s of samples) stats.push(s);
  assert.equal(stats.mean, 5);
  assert.ok(Math.abs(stats.stdDev - 2.138) < 0.01);
});

test("the RNG is deterministic for a seed and differs across seeds", () => {
  const a = makeRng(42);
  const b = makeRng(42);
  const c = makeRng(43);
  const first = [a(), a(), a()];
  assert.deepEqual(first, [b(), b(), b()]);
  assert.notDeepEqual(first, [c(), c(), c()]);
});

// --- DMP -------------------------------------------------------------------

function arcDemo(): DemoPoint[] {
  const demo: DemoPoint[] = [];
  for (let i = 0; i <= 120; i += 1) {
    const s = i / 120;
    demo.push({ t: s * 2, values: [s, 0.45 * Math.sin(Math.PI * s), 0.2 + 0.3 * s] });
  }
  return demo;
}

test("a fitted DMP reproduces its own demonstration", () => {
  const demo = arcDemo();
  const replay = rolloutDmp(fitDmp(demo));
  assert.ok(
    trajectoryRmse(demo, replay) < 0.03,
    `reproduction error ${trajectoryRmse(demo, replay)}`,
  );
});

test("a DMP generalises to a new goal while keeping the demonstrated shape", () => {
  const demo = arcDemo();
  const model = fitDmp(demo);
  const goal = [1.6, 0.3, 0.9];
  const replay = rolloutDmp(model, { goal });
  const end = replay[replay.length - 1].values;

  for (let d = 0; d < goal.length; d += 1) {
    assert.ok(Math.abs(end[d] - goal[d]) < 0.05, `dimension ${d} ended at ${end[d]}`);
  }
  // The arc has to survive: a straight line between start and goal would never
  // rise above the endpoint value in y.
  const peak = Math.max(...replay.map((p) => p.values[1]));
  assert.ok(peak > 0.4, `the demonstrated bulge was flattened (peak ${peak})`);
});

test("a DMP replays at a different speed without changing where it ends", () => {
  const model = fitDmp(arcDemo());
  const fast = rolloutDmp(model, { tau: 1 });
  const slow = rolloutDmp(model, { tau: 4 });
  assert.ok(Math.abs(fast[fast.length - 1].t - 1) < 0.05);
  assert.ok(Math.abs(slow[slow.length - 1].t - 4) < 0.05);
  for (let d = 0; d < 3; d += 1) {
    assert.ok(
      Math.abs(fast[fast.length - 1].values[d] - slow[slow.length - 1].values[d]) < 0.06,
      `endpoint moved with playback speed in dimension ${d}`,
    );
  }
});

// --- schema ----------------------------------------------------------------

test("schema validation fills defaults and rejects what it should", () => {
  const schema = {
    type: "object" as const,
    properties: {
      x: { type: "number" as const },
      mode: { type: "string" as const, enum: ["a", "b"], default: "a" },
      deep: {
        type: "object" as const,
        properties: { n: { type: "number" as const, minimum: 0 } },
        required: ["n"],
      },
    },
    required: ["x"],
  };

  const ok = validate<{ x: number; mode: string }>(schema, { x: 3 });
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.value.mode, "a");

  const missing = validate(schema, {});
  assert.equal(missing.ok, false);

  const badEnum = validate(schema, { x: 1, mode: "z" });
  assert.equal(badEnum.ok, false);

  const badNested = validate(schema, { x: 1, deep: { n: -5 } });
  assert.equal(badNested.ok, false);
});

// --- registry --------------------------------------------------------------

const stub = (id: string, requires: string[] = []): Ability<never, never> =>
  ({
    manifest: {
      id,
      version: "1.0.0",
      name: { en: id, ar: id },
      summary: { en: "", ar: "" },
      rationale: "",
      tags: [],
      risk: "passive",
      requires,
      typicalDurationMs: 0,
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    run: async () => ({ ok: true, summary: "" }),
  }) as unknown as Ability<never, never>;

test("the registry rejects bad ids and duplicates", () => {
  const registry = new AbilityRegistry();
  registry.register(stub("a.b"));
  assert.throws(() => registry.register(stub("a.b")), /already registered/);
  assert.throws(() => registry.register(stub("NotDotted")), /dotted lowercase/);
  assert.throws(() => registry.require("nope.nope"), /Unknown ability/);
});

test("the registry filters by the hardware a robot actually has", () => {
  const registry = new AbilityRegistry();
  registry.register(stub("x.one", ["drive"]));
  registry.register(stub("x.two", ["drive", "arm"]));

  const runnable = registry.runnableOn(["drive"]).map((m) => m.id);
  assert.deepEqual(runnable, ["x.one"]);
  assert.deepEqual(registry.missingFor("x.two", ["drive"]), ["arm"]);
});

test("every shipped ability has a complete, coherent manifest", () => {
  for (const manifest of createRegistry().manifests()) {
    assert.ok(manifest.name.ar.trim().length > 0, `${manifest.id} has no Arabic name`);
    assert.ok(manifest.summary.ar.trim().length > 0, `${manifest.id} has no Arabic summary`);
    assert.ok(
      manifest.rationale.length > 120,
      `${manifest.id} does not explain why it exists`,
    );
    assert.ok(manifest.tags.length > 0, `${manifest.id} has no tags`);
    assert.equal(manifest.inputSchema.type, "object");
    for (const required of manifest.inputSchema.required ?? []) {
      assert.ok(
        manifest.inputSchema.properties?.[required],
        `${manifest.id} requires "${required}" but never declares it`,
      );
    }
    // Daemons never finish on their own, so a duration would be a lie.
    if (manifest.daemon) assert.equal(manifest.typicalDurationMs, 0);
  }
});

// --- memory ----------------------------------------------------------------

test("memory namespaces keep two robots apart", () => {
  const backend = createInMemoryBackend();
  const one = createMemory("luka-1", backend);
  const two = createMemory("luka-2", backend);

  one.set("spatial:mug", { at: 1 });
  assert.equal(two.get("spatial:mug"), undefined);
  assert.deepEqual(one.keys("spatial:"), ["spatial:mug"]);
});

// --- safety ----------------------------------------------------------------

test("allowed speed falls monotonically as a person gets closer", () => {
  const governor = new SafetyGovernor();
  const distances = [8, 4, 3, 2, 1.5, 1, 0.8, 0.6, 0.4];
  let previous = Number.POSITIVE_INFINITY;
  for (const d of distances) {
    const speed = governor.allowedSpeed(d);
    assert.ok(speed <= previous + 1e-9, `speed rose as distance fell at ${d} m`);
    previous = speed;
  }
  assert.equal(governor.allowedSpeed(0.3), 0);
  assert.equal(governor.allowedSpeed(Number.POSITIVE_INFINITY), governor.limits.maxLinear);
});

test("the separation model is self-consistent", () => {
  const governor = new SafetyGovernor();
  // Whatever speed is allowed at a distance, the protective distance that speed
  // demands must fit inside it.
  for (const d of [1, 1.5, 2, 3, 5]) {
    const speed = governor.allowedSpeed(d);
    if (speed <= 0) continue;
    assert.ok(
      governor.protectiveDistance(speed) <= d + 1e-6,
      `at ${d} m the governor allowed ${speed} m/s, which needs ${governor.protectiveDistance(speed)} m`,
    );
  }
});

test("an emergency stop latches until it is explicitly cleared", () => {
  const governor = new SafetyGovernor();
  governor.emergencyStop("test");
  assert.equal(governor.isStopped(), true);
  assert.equal(governor.permitContact("anything"), false);
  governor.clearEmergencyStop();
  assert.equal(governor.isStopped(), false);
});
