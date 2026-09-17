// Does the simulator integrate the physics it says it integrates?
//
// Everything this kernel measures about balance is measured inside this
// integrator. `balance.recover` "holds to 1.6 rad/s and fails at 2.0" is, in
// the first instance, a statement about the arithmetic in `stepRobot` — and an
// integrator that drifts turns a physical claim into a claim about its own
// error. Tests elsewhere check that abilities behave; this checks that the
// world they behave in is the one it claims to be.
//
// ── What this does and does not establish ──────────────────────────────────
//
// It checks the simulator against the closed-form behaviour of its own model:
// a linear inverted pendulum with a centre of pressure that saturates at the
// edge of the foot. Passing means the code implements those equations.
//
// It does not establish that those equations describe any particular robot.
// `COM_HEIGHT = 0.55` and `FOOT_HALF = 0.11` are constants for a machine that
// does not exist, and a real platform's mass distribution, compliance and
// wheel slip are all absent. That gap does not close from this side of the
// keyboard.

import { test } from "node:test";
import assert from "node:assert/strict";

import { SimWorld } from "../sim/world.ts";
import { SafetyGovernor } from "../safety/governor.ts";

// The model's own constants. Duplicated deliberately: a test that imported them
// would pass if somebody changed the model and the constants together, which is
// exactly the change worth catching.
const GRAVITY = 9.81;
const COM_HEIGHT = 0.55;
const FOOT_HALF = 0.11;
const OMEGA_SQUARED = GRAVITY / COM_HEIGHT;
/** Where the saturated pendulum balances: sin θ* = u/L. */
const FIXED_POINT = Math.asin(FOOT_HALF / COM_HEIGHT);
/** Growth rate of a perturbation about it: sqrt(ω₀²·cos θ*). */
const GROWTH = Math.sqrt(OMEGA_SQUARED * Math.cos(FIXED_POINT));

function tipping(startTilt: number, startRate: number) {
  const world = new SimWorld({ width: 30, height: 30, seed: 1, noise: 0 });
  world.addRobot("r", { x: 15, y: 15 }, 0, { stance: "dynamic" });
  const robot = world.robot("r");
  robot.tilt = startTilt;
  robot.tiltRate = startRate;
  return { world, robot };
}

/**
 * First integral of the saturated dynamics θ̈ = ω₀²(sin θ − u/L):
 * E = ½θ̇² + ω₀²cos θ + ω₀²(u/L)θ, constant along any trajectory.
 */
const energy = (tilt: number, rate: number) =>
  0.5 * rate * rate +
  OMEGA_SQUARED * Math.cos(tilt) +
  OMEGA_SQUARED * (FOOT_HALF / COM_HEIGHT) * tilt;

test("the tilt integrator conserves what the model says is conserved", () => {
  // At the production substep, over a complete fall from the tip angle to the
  // floor. Measured at 3.65%, which is what a first-order method costs and is
  // small against anything the balance claims turn on.
  const { world, robot } = tipping(0.25, 0);
  const start = energy(robot.tilt, robot.tiltRate);
  let worst = 0;

  for (let i = 0; i < 200 && Math.abs(robot.tilt) < 1.4; i += 1) {
    world.step(0.02);
    // The invariant only holds while the ankle is saturated at the foot edge.
    if (Math.abs(2.0 * robot.tilt + 0.5 * robot.tiltRate) < FOOT_HALF) break;
    worst = Math.max(worst, Math.abs(energy(robot.tilt, robot.tiltRate) - start) / Math.abs(start));
  }

  assert.ok(robot.tilt > 1.0, "the robot did not actually fall, so nothing was integrated");
  assert.ok(worst < 0.05, `energy drifted ${(worst * 100).toFixed(2)}% over one fall`);
});

test("halving the timestep halves the error, which is what says it converges", () => {
  // The property that separates a first-order integrator from a wrong one. A
  // scheme that is simply incorrect does not improve as the step shrinks, and
  // a single drift figure cannot tell the two apart.
  const drift = (dt: number) => {
    const { world, robot } = tipping(0.25, 0);
    const start = energy(robot.tilt, robot.tiltRate);
    let worst = 0;
    for (let i = 0; i < 20000 && Math.abs(robot.tilt) < 1.4; i += 1) {
      world.step(dt);
      if (Math.abs(2.0 * robot.tilt + 0.5 * robot.tiltRate) < FOOT_HALF) break;
      worst = Math.max(worst, Math.abs(energy(robot.tilt, robot.tiltRate) - start) / Math.abs(start));
    }
    return worst;
  };

  const coarse = drift(0.02);
  const fine = drift(0.01);
  const finer = drift(0.005);

  assert.ok(coarse / fine > 1.7 && coarse / fine < 2.3, `error ratio ${(coarse / fine).toFixed(2)} is not first order`);
  assert.ok(fine / finer > 1.7 && fine / finer < 2.3, `error ratio ${(fine / finer).toFixed(2)} is not first order`);
});

test("a falling robot diverges at the rate the physics says it should", () => {
  // Seeded in the pure growing mode, because released from rest the solution is
  // a cosh rather than an exponential — fitting a log-slope through that
  // transient reads about 12% low, which looks exactly like a broken model and
  // is a broken measurement. The distinction cost a round of chasing the wrong
  // thing, so it is written down here.
  const perturbation = 0.02;
  const { world, robot } = tipping(FIXED_POINT + perturbation, GROWTH * perturbation);
  const samples: Array<{ t: number; logDeviation: number }> = [];

  for (let i = 1; i <= 2000 && robot.tilt < 1.2; i += 1) {
    world.step(0.002);
    const deviation = robot.tilt - FIXED_POINT;
    if (deviation > perturbation && deviation < 0.15) {
      samples.push({ t: i * 0.002, logDeviation: Math.log(deviation) });
    }
  }
  assert.ok(samples.length > 50, "not enough of the trajectory landed in the small-angle window");

  const meanT = samples.reduce((a, s) => a + s.t, 0) / samples.length;
  const meanX = samples.reduce((a, s) => a + s.logDeviation, 0) / samples.length;
  let covariance = 0;
  let variance = 0;
  for (const s of samples) {
    covariance += (s.t - meanT) * (s.logDeviation - meanX);
    variance += (s.t - meanT) ** 2;
  }
  const measured = covariance / variance;

  assert.ok(
    Math.abs(measured / GROWTH - 1) < 0.02,
    `the simulated robot falls at ${measured.toFixed(3)} rad/s where the model says ` +
      `${GROWTH.toFixed(3)} — a ${((measured / GROWTH - 1) * 100).toFixed(1)}% error`,
  );
});

test("the simulator has no terrain, and nothing should pretend otherwise", () => {
  // Written as a test rather than a comment because it is the boundary that
  // decides what can honestly be developed here.
  //
  // The world is two-dimensional. Obstacles are circles and boxes that block;
  // `height` on a box is its extent in Y, not elevation. There is no height
  // field, no slope, no ground normal, no foot contact and no leg. A capability
  // about crossing a threshold, changing gait, or adapting to a surface cannot
  // be measured here at all — and a number produced for one would describe
  // nothing.
  const world = new SimWorld({
    width: 10,
    height: 10,
    seed: 1,
    obstacles: [{ id: "box", kind: "box", at: { x: 5, y: 5 }, width: 1, height: 1 }],
  });
  world.addRobot("r", { x: 5, y: 3 }, Math.PI / 2, { stance: "dynamic" });
  const robot = world.robot("r");

  // Drive straight at the obstacle for long enough to climb anything climbable.
  robot.commandedLinear = 0.5;
  for (let i = 0; i < 200; i += 1) world.step(0.02);

  assert.ok(robot.collisions > 0, "the robot never reached the obstacle, so this proves nothing");
  assert.ok(
    robot.pose.y < 5,
    "the robot passed through or over a blocking obstacle, which would mean the world " +
      "has gained geometry this test was written to say it does not have",
  );
});

// ── The other piece of maths a person's safety rests on ────────────────────
//
// `allowedSpeed` is the closed-form inverse of `protectiveDistance`: given how
// far away somebody is, how fast may the robot go. Written out by hand, and a
// hand-derived inverse is exactly the kind of thing that is nearly right.

test("the speed limit is the exact inverse of the separation distance", () => {
  // Not "conservative" — exact. A closed form that is merely close in the safe
  // direction hides an algebra error that will not stay in the safe direction
  // when a constant changes.
  const governor = new SafetyGovernor();
  const { minSeparation } = governor.limits;

  for (const speed of [0.05, 0.1, 0.25, 0.5, 0.75, 1.0, 1.2]) {
    const distance = governor.protectiveDistance(speed) + minSeparation;
    const recovered = governor.allowedSpeed(distance);
    assert.ok(
      Math.abs(recovered - speed) < 1e-9,
      `at ${speed} m/s the model wants ${distance.toFixed(4)} m, and that distance permits ` +
        `${recovered.toFixed(4)} m/s`,
    );
  }
});

test("more room never permits less speed", () => {
  // A non-monotonic speed limit is a robot that speeds up as somebody gets
  // closer, somewhere in the middle of its range, and nothing else here would
  // notice.
  const governor = new SafetyGovernor();
  let previous = -1;
  for (let distance = 0; distance <= 8; distance += 0.005) {
    const speed = governor.allowedSpeed(distance);
    assert.ok(
      speed >= previous - 1e-12,
      `allowed speed fell from ${previous.toFixed(4)} to ${speed.toFixed(4)} at ${distance.toFixed(3)} m`,
    );
    previous = speed;
  }
});

test("a longer measured latency always costs speed, never gains it", () => {
  // The separation model uses whichever is worse, the budgeted reaction time or
  // the measured one. A cloud policy adding a quarter of a second has to make
  // the robot slower at every distance, not at some of them.
  const quick = new SafetyGovernor();
  const slow = new SafetyGovernor();
  slow.observeLatency(0.4);
  for (let i = 0; i < 200; i += 1) slow.observeLatency(0.4);

  assert.ok(slow.effectiveReactionTime() > quick.effectiveReactionTime());
  for (let distance = 0.5; distance <= 6; distance += 0.05) {
    assert.ok(
      slow.allowedSpeed(distance) <= quick.allowedSpeed(distance) + 1e-12,
      `at ${distance.toFixed(2)} m the slower link was allowed more speed`,
    );
  }
});

test("a stopped robot still needs room, which is what minSeparation is for", () => {
  // At zero speed the model still demands the human-travel term, the
  // uncertainty and the separation floor. That is not the robot failing to stop
  // in time — it is the model saying somebody is already too close, and the
  // only thing a robot can do about it is not be moving.
  const governor = new SafetyGovernor();
  const { minSeparation, humanSpeed, uncertainty } = governor.limits;
  const floor = governor.protectiveDistance(0) + minSeparation;

  assert.ok(floor > minSeparation, "a stationary robot was given no margin at all");
  assert.ok(
    Math.abs(floor - (humanSpeed * governor.effectiveReactionTime() + uncertainty + minSeparation)) < 1e-9,
  );
  assert.equal(governor.allowedSpeed(floor * 0.9), 0, "inside the floor, anything but zero is wrong");
});
