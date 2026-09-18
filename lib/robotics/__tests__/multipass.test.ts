// The rig's arithmetic, and the rule that keeps a simulated number from being
// reported as a physical one.

import test from "node:test";
import assert from "node:assert/strict";

import {
  earlyWarning,
  estimateAccumulation,
  passBudget,
  refused,
  sinkageAtPass,
  type PassRecord,
} from "../arc2/multipass.ts";
import { unreadyChannels, type RigConfiguration } from "../arc2/rig.ts";

function series(exponent: number, first: number, count: number, provenance: "measured" | "simulated" = "measured"): PassRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    pass: i + 1,
    sinkage: first * Math.pow(i + 1, exponent),
    load: 300,
    provenance,
  }));
}

test("one pass constrains nothing about accumulation", () => {
  // The whole reason the rig exists: a single pass cannot tell you what the
  // second will do, and a model fitted to one point is the failure this
  // project is about.
  const one = estimateAccumulation(series(0.4, 0.01, 1));
  assert.ok(refused(one));
});

test("repeating the same pass number is not more information", () => {
  const same: PassRecord[] = [
    { pass: 3, sinkage: 0.02, load: 300, provenance: "measured" },
    { pass: 3, sinkage: 0.021, load: 300, provenance: "measured" },
  ];
  assert.ok(refused(estimateAccumulation(same)));
});

test("the fit recovers an exponent the data was built with", () => {
  const fit = estimateAccumulation(series(0.45, 0.012, 8));
  assert.ok(!refused(fit));
  assert.ok(Math.abs(fit.exponent - 0.45) < 1e-9, `got ${fit.exponent}`);
  assert.ok(Math.abs(fit.firstPass - 0.012) < 1e-9);
  assert.ok(fit.fitQuality > 0.999);
});

test("a simulated pass makes the whole estimate simulated", () => {
  // No partial credit. A fit is only as physical as its worst input, and this
  // is the rule that stops a bench model being reported as a hardware result.
  const mixed = [...series(0.4, 0.01, 3, "measured"), ...series(0.4, 0.01, 1, "simulated").map((p) => ({ ...p, pass: 4 }))];
  const fit = estimateAccumulation(mixed);
  assert.ok(!refused(fit));
  assert.equal(fit.provenance, "simulated");

  const budget = passBudget(fit, { limit: 0.08, completed: 4 });
  assert.ok(!refused(budget));
  assert.equal(budget.provenance, "simulated");
});

test("ground that does not deepen has no pass budget, and says so", () => {
  const flat = estimateAccumulation(series(0, 0.01, 5));
  assert.ok(!refused(flat));
  const budget = passBudget(flat, { limit: 0.08, completed: 5 });
  assert.ok(refused(budget));
  assert.match(budget.reason, /never be reached|non-positive/i);
});

test("a first pass already past the limit was never a budget", () => {
  const fit = estimateAccumulation(series(0.5, 0.09, 4));
  assert.ok(!refused(fit));
  const budget = passBudget(fit, { limit: 0.08, completed: 4 });
  assert.ok(refused(budget));
});

test("the predicted critical pass is the first one over the limit", () => {
  const fit = estimateAccumulation(series(0.5, 0.01, 4));
  assert.ok(!refused(fit));
  const budget = passBudget(fit, { limit: 0.04, completed: 4 });
  assert.ok(!refused(budget));
  // z_1 = 0.01, a = 0.5, limit 0.04 ⟹ N = (4)^2 = 16.
  assert.equal(budget.criticalPass, 16);
  // The boundary itself, with a tolerance for the fit's own round trip through
  // logs — the claim is that 16 is the first pass at the limit, not that the
  // arithmetic is exact to the last bit.
  assert.ok(sinkageAtPass(fit, 16) >= 0.04 * (1 - 1e-9));
  assert.ok(sinkageAtPass(fit, 15) < 0.04);
  assert.equal(budget.leadPasses, 12);
});

test("early warning is only worth having if it arrives before the stranding", () => {
  // This is the kill condition in code. Two passes, a limit the series really
  // does reach, and the question of whether the prediction beat the event.
  const passes = series(0.6, 0.008, 20);
  const limit = 0.03;
  const warning = earlyWarning(passes, limit, 2);
  assert.ok(!refused(warning));
  assert.ok(warning.observedCritical !== null);
  assert.ok(warning.leadPasses > 0, `no lead time: ${JSON.stringify(warning)}`);
  assert.equal(warning.error, 0, "a clean power law should be predicted exactly");
});

test("a prediction cannot be made from fewer than two passes", () => {
  assert.ok(refused(earlyWarning(series(0.5, 0.01, 5), 0.04, 1)));
});

test("an uncalibrated channel is not a measurement, whatever it is labelled", () => {
  const configuration: RigConfiguration = {
    soil: "quartz sand 0.1–0.6 mm",
    moisture: 0.04,
    wheel: { radius: 0.12, width: 0.08, grousers: 0 },
    load: 300,
    slip: 0.2,
    channels: [
      { quantity: "sinkage", unit: "m", instrument: "VL53L5CX 8x8 ToF", resolution: 0.001, calibrated: false },
      { quantity: "load", unit: "N", instrument: "dead weight, class M1", resolution: 0.5, calibrated: true },
    ],
  };
  const unready = unreadyChannels(configuration);
  assert.equal(unready.length, 1);
  assert.match(unready[0], /sinkage/);
});
