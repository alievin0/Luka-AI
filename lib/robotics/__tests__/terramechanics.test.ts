// The experiment that killed the first ARC-2 hypothesis, kept as a test so
// nobody proposes it again without meeting the numbers first.
//
// The hypothesis: "wheels turning, body still" has several causes with opposite
// correct responses, and a wheel-leg robot can tell them apart because it can
// change the normal load on a wheel and so measure dDP/dW, which a passive
// suspension cannot. The falsifiable prediction was that the derivative is
// positive on a rigid low-friction surface and turns negative on loose soil.
//
// It is false, and the reasoning was backwards. These tests record both.
//
// Everything here is a property of the Bekker–Wong model, not of a robot. What
// the model leaves out is listed in `arc2/terramechanics.ts` and the first
// omission is the one that actually strands machines: repeated passes deepening
// a rut.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SOILS,
  drawbarPull,
  sinkage,
  type Soil,
} from "../arc2/terramechanics.ts";

/** Heavily slipping, which is the state the robot is in when it asks. */
const SLIP = 0.4;
/** Per-wheel loads a 40–60 kg machine can actually transfer between contacts. */
const LOADS = [20, 40, 60, 80, 100, 130, 160, 200, 250, 300];

const slope = (W: number, soil: Soil | null) =>
  (drawbarPull(W + 1, soil, SLIP) - drawbarPull(W - 1, soil, SLIP)) / 2;
const curvature = (W: number, soil: Soil | null) =>
  (drawbarPull(W + 5, soil, SLIP) - 2 * drawbarPull(W, soil, SLIP) + drawbarPull(W - 5, soil, SLIP)) /
  25;

test("the prediction that made the hypothesis worth testing is false", () => {
  // dDP/dW was supposed to change sign on loose soil inside the load range a
  // robot can transfer. On dry sand it falls from 0.348 to 0.048 across
  // 20–300 N and stays positive the whole way.
  const sand = SOILS.find((s) => s.name === "dry sand");
  assert.ok(sand);
  const slopes = LOADS.map((W) => slope(W, sand));
  assert.ok(
    slopes.every((d) => d > 0),
    `the derivative went negative somewhere, which would have supported the hypothesis: ${slopes.map((d) => d.toFixed(3)).join(", ")}`,
  );
  // It does fall a long way, which is the weaker signature that survives.
  assert.ok(slopes[0] / slopes[slopes.length - 1] > 5, "the derivative barely moved");
});

test("and the reasoning behind it was backwards: equal load is already optimal", () => {
  // Load transfer is zero-sum — the only way to add load to one wheel is to
  // take it off another. Drawbar pull is concave in load on every soil, so the
  // total across two wheels is maximised by splitting it equally. Which is what
  // a passive rocker-bogie does by design, without any actuation at all.
  //
  // So on uniform ground, being able to redistribute load buys nothing. The
  // advantage is real only where the two contacts are on different stuff, and
  // that is Grand et al., IJRR 2004.
  const total = (front: number, soil: Soil | null) =>
    drawbarPull(front, soil, SLIP) + drawbarPull(200 - front, soil, SLIP);

  for (const soil of SOILS) {
    const equal = total(100, soil);
    for (const front of [120, 140, 160, 180, 195]) {
      assert.ok(
        total(front, soil) < equal,
        `on ${soil.name} a ${front}/${200 - front} split beat the equal one`,
      );
    }
  }
  // On a rigid surface it makes no difference whatsoever, because the relation
  // is exactly linear.
  for (const front of [120, 160, 195]) {
    assert.ok(Math.abs(total(front, null) - total(100, null)) < 1e-9);
  }
});

test("curvature separates some soils from rigid ground, and not all of them", () => {
  // Exactly zero on a rigid surface, which is the one clean fact here. On dry
  // sand it is strongly negative. On sandy loam it is nearly zero and changes
  // sign with load — positive at 40 N, negative by 80 N — so by this signature
  // a sandy loam is very nearly a rigid floor.
  //
  // Which is worse for the hypothesis than a wrong sign would have been: the
  // discriminator is not just second-order and noisy, it is not even
  // consistently signed across the soils it is supposed to discriminate.
  for (const W of [40, 80, 130, 200, 250]) {
    assert.ok(Math.abs(curvature(W, null)) < 1e-9, "a rigid surface should be exactly linear");
  }

  const sand = SOILS.find((s) => s.name === "dry sand");
  const loam = SOILS.find((s) => s.name === "sandy loam");
  assert.ok(sand && loam);

  assert.ok(
    [40, 80, 130, 200, 250].every((W) => curvature(W, sand) < -4e-4),
    "dry sand stopped being clearly concave, which was the one soil this worked on",
  );

  const loamCurvatures = [40, 80, 130, 200, 250].map((W) => curvature(W, loam));
  assert.ok(
    loamCurvatures.some((k) => k > 0) && loamCurvatures.some((k) => k < 0),
    `sandy loam kept one sign across the load range: ${loamCurvatures.map((k) => (k * 1000).toFixed(3)).join(", ")}`,
  );
  assert.ok(
    Math.max(...loamCurvatures.map(Math.abs)) < Math.abs(curvature(130, sand)) / 4,
    "sandy loam's curvature is not small compared to dry sand's, so this test proves nothing",
  );
});

test("and a cheaper measurement gets the same answer, which is what kills it", () => {
  // Static sinkage under the robot's own weight separates rigid from soft in
  // one reading, with no load transfer, no second morphology and no derivative.
  // Anything with suspension travel or a view of its own wheel has it already.
  //
  // By the rule this project works to: if an ordinary sensor gives the same
  // information faster and cheaper, the capability does not get built.
  for (const soil of SOILS) {
    const z = sinkage(100, soil);
    assert.ok(z > 0.003, `${soil.name} sank only ${(z * 1000).toFixed(1)} mm under 100 N`);
  }
  // Dry sand at a nominal per-wheel load is tens of millimetres against zero.
  const sand = SOILS.find((s) => s.name === "dry sand");
  assert.ok(sand);
  assert.ok(sinkage(100, sand) > 0.02, "the easy signal is not actually easy");
});

test("the model cannot represent the failure that motivated any of this", () => {
  // Spirit was not lost because one wheel could not generate drawbar pull. It
  // was lost because repeated slipping dug a rut it could not climb out of, and
  // this model has no memory of previous passes: drawbar pull is positive and
  // rising at every load on every soil here, so nothing in it ever gets stuck.
  //
  // Which is the honest reason the surviving hypothesis is the other one. What
  // a leg buys is not force, it is the ability to put a contact somewhere the
  // wheel cannot reach — including out of the hole the wheel dug.
  for (const soil of SOILS) {
    for (const W of LOADS) {
      assert.ok(
        drawbarPull(W, soil, SLIP) > 0,
        `${soil.name} at ${W} N produced no net pull, which this model should not be able to say`,
      );
    }
  }
});
