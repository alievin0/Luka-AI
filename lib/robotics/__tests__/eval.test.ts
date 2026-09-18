import { test } from "node:test";
import assert from "node:assert/strict";

import {
  wilson,
  mcNemar,
  requiredEpisodes,
  resolvableDifference,
  binomialTail,
  summarise,
  fingerprint,
  runSuite,
  compare,
  report,
  sweep,
  type Protocol,
} from "../eval/index.ts";
import { createSimRig } from "../index.ts";

const PROTOCOL: Protocol = {
  name: "test protocol",
  scenario: "empty-hall",
  seeds: [1, 2, 3, 4, 5],
  timeLimitMs: 10_000,
  criterion: { id: "reached", version: "1.0.0", description: "got there" },
};

test("Wilson intervals match the published values", () => {
  const a = wilson(9, 10);
  assert.ok(Math.abs(a.low - 0.596) < 0.002, `low was ${a.low}`);
  assert.ok(Math.abs(a.high - 0.982) < 0.002, `high was ${a.high}`);

  // And it stays inside [0, 1] where the normal approximation would not.
  const perfect = wilson(20, 20);
  assert.ok(perfect.high <= 1 && perfect.low > 0.8, JSON.stringify(perfect));
  const none = wilson(0, 20);
  assert.ok(none.low >= 0 && none.high < 0.2, JSON.stringify(none));
});

test("a binomial tail sums to one across its range", () => {
  assert.ok(Math.abs(binomialTail(0, 12, 0.5) - 1) < 1e-9);
  assert.ok(binomialTail(13, 12, 0.5) === 0);
  assert.ok(Math.abs(binomialTail(6, 12, 0.5) - 0.6128) < 0.001);
});

test("sample size matches the standard two-proportion formula", () => {
  assert.equal(requiredEpisodes(0.5, 0.7), 93);
  assert.equal(requiredEpisodes(0.5, 0.6), 388);
  assert.ok(requiredEpisodes(0.5, 0.52) > 9000);
  assert.equal(requiredEpisodes(0.5, 0.5), Number.POSITIVE_INFINITY);

  // And the inverse agrees with it.
  const resolvable = resolvableDifference(93);
  assert.ok(Math.abs(resolvable - 0.2) < 0.02, `93 episodes resolve ${resolvable}`);
});

test("paired comparison calls a 12-4 split what it is: unresolved", () => {
  const a = [...Array(12).fill(true), ...Array(4).fill(false), ...Array(30).fill(true)];
  const b = [...Array(12).fill(false), ...Array(4).fill(true), ...Array(30).fill(true)];
  const result = mcNemar(a, b);

  assert.equal(result.aOnly, 12);
  assert.equal(result.bOnly, 4);
  assert.equal(result.agreed, 30);
  assert.ok(Math.abs(result.pValue - 0.0768) < 0.001, `p = ${result.pValue}`);
  assert.equal(result.significant, false, "12 vs 4 is not significant and must not be reported as a win");
});

test("paired comparison does find a real difference", () => {
  const a = [...Array(20).fill(true), ...Array(2).fill(false)];
  const b = [...Array(20).fill(false), ...Array(2).fill(true)];
  const result = mcNemar(a, b);
  assert.equal(result.significant, true, result.summary);
});

test("identical outcomes produce no verdict rather than a false one", () => {
  const same = [true, false, true, true];
  const result = mcNemar(same, same);
  assert.equal(result.pValue, 1);
  assert.equal(result.significant, false);
});

test("a protocol fingerprint changes when anything about the measurement does", () => {
  const base = fingerprint(PROTOCOL);
  assert.equal(base, fingerprint({ ...PROTOCOL }));
  assert.notEqual(base, fingerprint({ ...PROTOCOL, seeds: [1, 2, 3, 4, 6] }));
  assert.notEqual(base, fingerprint({ ...PROTOCOL, timeLimitMs: 10_001 }));
  assert.notEqual(
    base,
    fingerprint({ ...PROTOCOL, criterion: { ...PROTOCOL.criterion, version: "1.0.1" } }),
  );
  assert.notEqual(base, fingerprint({ ...PROTOCOL, conditions: { shield: "off" } }));
  // Condition order must not matter — only content.
  assert.equal(
    fingerprint({ ...PROTOCOL, conditions: { a: 1, b: 2 } }),
    fingerprint({ ...PROTOCOL, conditions: { b: 2, a: 1 } }),
  );
});

test("results from different protocols refuse to be compared", async () => {
  const runner = async () => ({ success: true, durationMs: 100, metrics: {} });
  const a = await runSuite(PROTOCOL, runner);
  const b = await runSuite({ ...PROTOCOL, timeLimitMs: 20_000 }, runner);
  assert.throws(() => compare(a, b), /different protocols/);
});

test("a suite reports the interval and its own resolution limit", async () => {
  const result = await runSuite(PROTOCOL, async (seed, index) => ({
    success: index < 4,
    durationMs: 1000 + index,
    metrics: { travelled: 10 + index },
    failure: index < 4 ? undefined : "timeout",
  }));

  assert.equal(result.successes, 4);
  assert.equal(result.trials, 5);
  assert.ok(result.interval.low < 0.5 && result.interval.high > 0.9, "the interval should be wide at n=5");
  assert.equal(result.failures.timeout, 1);
  assert.ok(result.resolvablePercentagePoints > 40, "n=5 cannot resolve small differences");
  assert.equal(result.metrics.travelled.n, 5);

  const text = report(result);
  assert.match(text, /95% CI/);
  assert.match(text, /reached@1\.0\.0/);
  assert.match(text, new RegExp(result.fingerprint));
});

test("a sweep reports a curve and finds the breaking point", async () => {
  const result = await sweep(
    PROTOCOL,
    { name: "push", levels: [1, 2, 3], unit: "rad/s" },
    async (seed, level) => ({ success: level < 3 }),
  );

  assert.equal(result.points.length, 3);
  assert.equal(result.points[0].successRate, 1);
  assert.equal(result.points[2].successRate, 0);
  assert.equal(result.breakingPoint, 3);
});

test("summarise reports spread, not just a mean", () => {
  const stats = summarise([1, 2, 3, 4, 100]);
  assert.equal(stats.n, 5);
  assert.equal(stats.median, 3);
  assert.equal(stats.max, 100);
  assert.ok(stats.stdDev > 40, "an outlier has to show up in the spread");
});

// --- the stoppability monitor -----------------------------------------------

test("safety.stoppable is quiet during ordinary driving", async () => {
  const rig = createSimRig({ scenario: "cluttered-office" });
  const monitor = rig.runtime.startDaemon<Record<string, never>, {
    unstoppableFraction: number;
    minHeadroomSeconds: number;
  }>("safety.stoppable", {});
  rig.runtime.startDaemon("reflex.shield", {});

  await rig.runtime.run("navigate.to", { x: 12, y: 8 });
  await rig.runtime.stopDaemons();
  const result = await monitor.promise;

  assert.equal(result.ok, true, result.summary);
  assert.equal(result.data?.unstoppableFraction, 0, result.summary);
  assert.ok((result.data?.minHeadroomSeconds ?? 0) > 0.5, result.summary);
});

test("safety.stoppable notices a robot that is already committed", async () => {
  const rig = createSimRig({ scenario: "empty-hall" });
  const monitor = rig.runtime.startDaemon<Record<string, never>, {
    unstoppableFraction: number;
    minBalanceMarginRad: number;
  }>("safety.stoppable", {});

  rig.world.applyTiltImpulse("luka-1", 3);
  await rig.runtime.run("balance.recover", {});
  await rig.runtime.stopDaemons();
  const result = await monitor.promise;

  assert.equal(result.ok, false, "a falling robot is not in a stoppable state");
  assert.ok((result.data?.unstoppableFraction ?? 0) > 0.2, result.summary);
  assert.ok((result.data?.minBalanceMarginRad ?? 1) < 0, result.summary);
});

// --- the latency-aware separation model -------------------------------------

test("the separation model widens when the real latency exceeds its budget", async () => {
  const { SafetyGovernor } = await import("../safety/governor.ts");

  const local = new SafetyGovernor();
  const baseline = local.allowedSpeed(2);
  for (let i = 0; i < 300; i += 1) local.observeLatency(0.02);
  assert.equal(
    local.allowedSpeed(2),
    baseline,
    "a control loop faster than the budget must not change the model",
  );

  const remote = new SafetyGovernor();
  for (let i = 0; i < 300; i += 1) remote.observeLatency(0.25);
  assert.ok(remote.effectiveReactionTime() > 0.2, "measured latency should win");
  assert.ok(
    remote.allowedSpeed(2) < baseline - 0.1,
    `a slow link must slow the robot: ${remote.allowedSpeed(2)} vs ${baseline}`,
  );
  assert.ok(remote.protectiveDistance(1.2) > local.protectiveDistance(1.2) + 0.2);
});
