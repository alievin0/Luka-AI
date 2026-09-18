// Braking authority: the physics that makes the assumption falsifiable, and the
// capability that measures it.
//
// `safety.stoppable` has always named the failure that matters — "the assumed
// figure being optimistic" — and until the simulator had friction there was no
// way for it to happen. The body's speed was a function of the wheel speed at
// that instant, so a robot commanded to zero was stopped in the same tick, from
// any speed, on any floor. Every stopping distance in this repository was
// computed by the safety governor and never once tested against physics.

import { test } from "node:test";
import assert from "node:assert/strict";

import { SimWorld, ROBOT_RADIUS, GRAVITY } from "../sim/world.ts";
import { SimRobotAdapter } from "../sim/adapter.ts";
import { SafetyGovernor, DEFAULT_LIMITS } from "../safety/governor.ts";
import { GripMonitor, forwardRange, DEFAULT_GRIP_THRESHOLDS } from "../core/grip.ts";

const DT = 0.05;
/** The drive's own ramp — below this the floor is not the limiting thing. */
const DRIVE_RAMP = 1.4;

function corridor(options: {
  mu: number;
  seed?: number;
  startX?: number;
  watchGrip?: boolean;
  maxDecel?: number;
  people?: Array<{ x: number; to?: number; speed?: number }>;
  stance?: "dynamic" | "static";
  /** Leave the far wall out, to make a person the only thing ahead. */
  bare?: boolean;
}) {
  const world = new SimWorld({
    width: 40,
    height: 6,
    seed: options.seed ?? 5,
    noise: 1,
    surfaceFriction: options.mu,
    obstacles: options.bare
      ? []
      : [{ id: "wall", kind: "box", at: { x: 30, y: 3 }, width: 1.2, height: 6 }],
    humans: (options.people ?? []).map((p, i) => ({
      id: `p${i}`,
      at: { x: p.x, y: 3 },
      waypoints: p.to === undefined ? [] : [{ x: p.to, y: 3 }],
      speed: p.speed ?? 0,
      attentive: false,
    })),
  });
  const governor = new SafetyGovernor({
    limits: { ...DEFAULT_LIMITS, maxDecel: options.maxDecel ?? DEFAULT_LIMITS.maxDecel },
    watchConflicts: false,
    watchGrip: options.watchGrip ?? false,
  });
  const robot = new SimRobotAdapter(world, "luka", governor, {});
  world.addRobot("luka", { x: options.startX ?? 18, y: 3 }, 0, { stance: options.stance ?? "dynamic" });
  const self = world.robot("luka");
  // A control loop runs before anything is asked of it, which is what lets the
  // grip monitor know the thing ahead is a wall rather than somebody standing.
  const settle = (ticks = 12) => {
    for (let i = 0; i < ticks; i += 1) {
      robot.drive(0, 0);
      world.step(DT);
    }
  };
  settle();
  return { world, governor, robot, self, settle };
}

/** Drive flat out until stopped or stopping, and report the outcome. */
function chargeTheWall(rig: ReturnType<typeof corridor>) {
  let minClearance = Infinity;
  for (let tick = 0; tick < 1200; tick += 1) {
    rig.robot.drive(DEFAULT_LIMITS.maxLinear, 0);
    rig.world.step(DT);
    minClearance = Math.min(minClearance, 30 - 0.6 - rig.self.pose.x - ROBOT_RADIUS);
    if (rig.self.collisions > 0) break;
    if (Math.abs(rig.self.bodySpeed) < 0.005 && tick > 60 && rig.self.pose.x > 20) break;
  }
  return { collided: rig.self.collisions > 0, minClearance };
}

// ── the physics ─────────────────────────────────────────────────────────────

test("stopping distance is friction-limited, and matches the closed form", () => {
  // d = v₀²/(2·µ·g) wherever the floor is the binding constraint. Above
  // µ = 1.4/9.81 = 0.143 the drive's own ramp is slower than the tyres and the
  // closed form no longer applies — which is itself worth asserting, because a
  // model where the floor always wins would be as wrong as one where it never
  // does.
  const stop = (mu: number) => {
    const world = new SimWorld({ width: 60, height: 8, seed: 7, noise: 0, surfaceFriction: mu });
    const robot = world.addRobot("r", { x: 2, y: 4 }, 0);
    robot.commandedLinear = 0.8;
    for (let i = 0; i < 400 && Math.abs(robot.bodySpeed - 0.8) > 1e-4; i += 1) world.step(0.02);
    const from = robot.bodySpeed;
    const at = robot.pose.x;
    robot.commandedLinear = 0;
    for (let i = 0; i < 5000 && Math.abs(robot.bodySpeed) > 1e-4; i += 1) world.step(0.02);
    return { from, distance: robot.pose.x - at };
  };

  for (const mu of [0.08, 0.06, 0.04]) {
    const { from, distance } = stop(mu);
    const theory = (from * from) / (2 * mu * GRAVITY);
    assert.ok(
      Math.abs(distance - theory) / theory < 0.03,
      `at µ=${mu} the robot stopped in ${distance.toFixed(3)} m against a predicted ${theory.toFixed(3)} m`,
    );
  }

  // Above the crossover the answer stops depending on the floor at all.
  const good = stop(0.8).distance;
  const damp = stop(0.2).distance;
  assert.ok(
    Math.abs(good - damp) < 1e-6,
    `the drive is the limit on both of these floors, so they should stop identically: ${good} vs ${damp}`,
  );
});

test("a good floor behaves exactly as it did before the body had momentum", () => {
  // The whole change has to be invisible where it should be. µ·g on dry
  // concrete is 7.8 m/s², five times anything this drive can ask for, so the
  // body follows the wheels to the last bit.
  // On a statically stable chassis, where the pitch that a balancer uses to
  // hold itself up does not come into it.
  const world = new SimWorld({ width: 40, height: 8, seed: 3, noise: 0, surfaceFriction: 0.8 });
  const robot = world.addRobot("r", { x: 2, y: 4 }, 0, { stance: "static" });
  let worst = 0;
  for (let i = 0; i < 300; i += 1) {
    robot.commandedLinear = i < 100 ? 1.2 : i < 200 ? 0 : -0.6;
    world.step(0.02);
    worst = Math.max(worst, Math.abs(robot.bodySpeed - robot.linear));
  }
  assert.ok(worst < 1e-9, `the body drifted ${worst} m/s from the wheels on a floor that can carry it`);
});

test("the default safety limits are a claim about the floor, and it is checkable", () => {
  // `maxDecel = 1.2` says the floor gives at least µ = 0.122. Nothing in the
  // configuration says so, and the number is the entire basis of every
  // protective distance in the kernel.
  const impliedMu = DEFAULT_LIMITS.maxDecel / GRAVITY;
  assert.ok(impliedMu > 0.11 && impliedMu < 0.13, `implied µ is ${impliedMu.toFixed(3)}`);

  // Just under it, the robot gets away with it. Just over, it does not.
  assert.equal(chargeTheWall(corridor({ mu: 0.12 })).collided, false);
  assert.equal(chargeTheWall(corridor({ mu: 0.06 })).collided, true);
});

// ── the sensor that can see it ──────────────────────────────────────────────

test("the IMU reports specific force, not the difference between two things it cannot see", () => {
  // `accel` used to be `commandedLinear - linear`: the gap between what the
  // motor controller was asked for and what the wheels were doing. Wrong units,
  // and computed from two quantities an accelerometer has no access to. Nothing
  // read it, which is why it survived seventeen other findings of the same kind.
  const rig = corridor({ mu: 0.06, stance: "static" });
  // Drive until the wheels have reached the speed they were asked for while the
  // body is still a long way short of it. That instant separates the two
  // quantities structurally rather than by luck: the command tracking error is
  // now zero, and the body is still accelerating at everything the floor has.
  let found = false;
  for (let i = 0; i < 300; i += 1) {
    rig.robot.drive(1.2, 0);
    rig.world.step(DT);
    if (rig.self.linear >= 1.19 && rig.self.bodySpeed < 0.8) {
      found = true;
      break;
    }
  }
  assert.ok(found, "the wheels never got ahead of the body, so there is nothing to tell apart");

  const trackingError = rig.self.commandedLinear - rig.self.linear;
  assert.ok(Math.abs(trackingError) < 0.02, `the wheels have not settled: ${trackingError.toFixed(3)}`);

  const reading = rig.robot.imu().accel;
  assert.ok(
    Math.abs(reading - 0.06 * GRAVITY) < 0.25,
    `on a µ=0.06 floor the body accelerates at 0.59 m/s²; the IMU said ${reading.toFixed(3)}`,
  );
  // Which is the whole point: the old channel would be reporting zero here,
  // on a robot that is still gaining half a metre per second every second.
  assert.ok(
    Math.abs(reading - trackingError) > 0.3,
    `the IMU is indistinguishable from the tracking error (${trackingError.toFixed(3)} vs ${reading.toFixed(3)})`,
  );
});

test("on a balancing robot the accelerometer cannot answer this question at all", () => {
  // Worth asserting because it is the reason the measurement is taken from the
  // lidar instead, and because the failure is a confident wrong number rather
  // than a refusal.
  //
  // A balancer pitches until the specific force lies along its own body axis.
  // The forward channel then reads the pitch rather than the acceleration, and
  // the fused attitude that would remove the gravity term is itself derived
  // from that same accelerometer. Measured across µ from 0.8 down to 0.1, the
  // uncompensated reading barely moves — a robot using it would conclude its
  // brakes were fine on a floor giving a sixth of the assumed grip.
  const peak = (mu: number) => {
    const rig = corridor({ mu, stance: "dynamic" });
    let best = 0;
    for (let i = 0; i < 60; i += 1) {
      rig.robot.drive(1.2, 0);
      rig.world.step(DT);
      if (i > 4) best = Math.max(best, rig.robot.imu().accel);
    }
    return best;
  };
  const dry = peak(0.8);
  const slick = peak(0.1);
  assert.ok(
    Math.abs(dry - slick) < 0.3,
    `the accelerometer distinguished a µ=0.8 floor (${dry.toFixed(2)}) from a µ=0.1 floor ` +
      `(${slick.toFixed(2)}), which would make it usable here and this test wrong`,
  );
  // The same platform, measured the way the capability actually measures it,
  // gets the right answer.
  const rig = corridor({ mu: 0.1, stance: "dynamic", watchGrip: true });
  for (let i = 0; i < 100; i += 1) {
    rig.robot.drive(1.2, 0);
    rig.world.step(DT);
    if (rig.governor.gripEvidence().measured !== null) break;
  }
  const measured = rig.governor.gripEvidence().measured;
  assert.ok(measured !== null && Math.abs(measured - 0.1 * GRAVITY) < 0.25, `lidar said ${measured}`);
});

test("the accelerometer carries a bias that does not average away", () => {
  // Which is why every IMU driver zeroes itself while the machine is standing
  // still, and why a capability that integrates this channel has to do the same.
  const biases: number[] = [];
  for (let seed = 1; seed <= 12; seed += 1) {
    const world = new SimWorld({ width: 20, height: 8, seed, noise: 1 });
    const governor = new SafetyGovernor({ watchConflicts: false, watchGrip: false });
    const robot = new SimRobotAdapter(world, "r", governor, {});
    world.addRobot("r", { x: 5, y: 4 }, 0, { stance: "static" });
    const rest: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      robot.drive(0, 0);
      world.step(DT);
      rest.push(robot.imu().accel);
    }
    biases.push(rest.reduce((a, b) => a + b, 0) / rest.length);
  }
  const spread = Math.max(...biases) - Math.min(...biases);
  assert.ok(spread > 0.05, `every unit reported the same offset (${spread.toFixed(4)}), which is not a bias`);
  assert.ok(
    biases.every((b) => Math.abs(b) < 0.25),
    `a bias of ${Math.max(...biases.map(Math.abs)).toFixed(3)} m/s² is not an ordinary consumer part`,
  );
});

// ── the measurement ─────────────────────────────────────────────────────────

test("a stop on a bad floor measures what the floor gave, to within a tenth", () => {
  for (const mu of [0.06, 0.08, 0.1]) {
    const rig = corridor({ mu, watchGrip: true, startX: 16 });
    for (let i = 0; i < 400 && rig.self.pose.x < 22; i += 1) {
      rig.robot.drive(1.2, 0);
      rig.world.step(DT);
    }
    for (let i = 0; i < 300; i += 1) {
      rig.robot.drive(0, 0);
      rig.world.step(DT);
      if (rig.governor.gripEvidence().measured !== null) break;
    }
    const measured = rig.governor.gripEvidence().measured;
    assert.ok(measured !== null, `no measurement at µ=${mu}`);
    assert.ok(
      Math.abs(measured - mu * GRAVITY) < 0.1,
      `at µ=${mu} the floor gives ${(mu * GRAVITY).toFixed(3)} m/s² and the robot measured ${measured.toFixed(3)}`,
    );
    // Wrong low rather than wrong high, by construction: the distance is taken
    // against the closest the surface ever came, and a noisy minimum runs long.
    assert.ok(measured <= mu * GRAVITY + 0.02, "the measurement read optimistic, which is the one direction that is not allowed");
  }
});

test("the stop ends when the body stops, not when the wheels do", () => {
  // The regression that matters most here, because it fails safe-looking. An
  // earlier version called the stop finished when the wheel speed reached zero
  // — the encoder's opinion of when the robot stopped, from the one channel
  // this capability exists because it cannot be trusted. Measured at µ=0.06:
  // 0.857 m/s² against a true 0.589, because it stopped counting before the
  // body had finished sliding.
  const rig = corridor({ mu: 0.06, watchGrip: true, startX: 16 });
  for (let i = 0; i < 400 && rig.self.pose.x < 22; i += 1) {
    rig.robot.drive(1.2, 0);
    rig.world.step(DT);
  }
  const wheelsStoppedAt: { x: number | null } = { x: null };
  for (let i = 0; i < 300; i += 1) {
    rig.robot.drive(0, 0);
    rig.world.step(DT);
    if (wheelsStoppedAt.x === null && rig.self.linear === 0) wheelsStoppedAt.x = rig.self.pose.x;
    if (rig.governor.gripEvidence().measured !== null) break;
  }
  const sample = rig.governor.gripEvidence().samples.at(-1);
  assert.ok(sample, "no measurement");
  assert.ok(wheelsStoppedAt.x !== null, "the wheels never stopped");
  const slidAfter = rig.self.pose.x - wheelsStoppedAt.x;
  assert.ok(slidAfter > 0.2, `the body only slid ${slidAfter.toFixed(3)} m after the wheels stopped, so this proves nothing`);
  assert.ok(
    sample.distance > sample.wheelDistance,
    `the measured travel (${sample.distance.toFixed(3)} m) did not exceed what the wheels claimed ` +
      `(${sample.wheelDistance.toFixed(3)} m), so the slide was not counted`,
  );
});

test("a launch measures the same floor as a stop, and arrives first", () => {
  // The chicken and egg, and why it is not one. A robot has to brake hard to
  // find out it cannot brake hard — and the first hard brake is the dangerous
  // one. It does not have to: the drive ramps at its own limit on the way *up*
  // too, so a floor that cannot carry that saturates on the first metre of the
  // mission, before anything is at stake.
  const rig = corridor({ mu: 0.06, watchGrip: true, startX: 18 });
  let firstAt = 0;
  for (let i = 0; i < 100; i += 1) {
    rig.robot.drive(1.2, 0);
    rig.world.step(DT);
    if (rig.governor.gripEvidence().measured !== null) {
      firstAt = i * DT;
      break;
    }
  }
  const evidence = rig.governor.gripEvidence();
  assert.ok(evidence.measured !== null, "the launch taught it nothing");
  assert.equal(evidence.samples.at(-1)?.source, "launch");
  assert.ok(firstAt < 1.5, `it took ${firstAt.toFixed(2)} s to find out, which is most of a corridor`);
  // The launch reads low — the entry speed comes off the wheels, which are
  // already ahead of the body on a floor like this, and an over-stated entry
  // speed lowers the answer. Low is the direction to be wrong in.
  assert.ok(
    evidence.measured < 0.06 * GRAVITY + 0.02,
    `the launch read optimistic: ${evidence.measured.toFixed(3)} against 0.589`,
  );
  assert.ok(
    evidence.measured > 0.06 * GRAVITY - 0.2,
    `the launch said ${evidence.measured.toFixed(3)} m/s² where the floor gives 0.589, which is not a measurement`,
  );
});

test("it refuses to measure its braking against something that is walking", () => {
  // A stopping distance measured against a moving surface is not a stopping
  // distance. Measured before this check existed, against a person walking in
  // at 1.6 m/s: 0.16 m/s² where the floor was giving 0.59 — wrong by a factor
  // of four. Conservative, and still a fabricated number in a safety envelope.
  const rig = corridor({
    mu: 0.06,
    watchGrip: true,
    startX: 8,
    bare: true,
    people: [{ x: 20, to: 0, speed: 1.6 }],
  });
  for (let i = 0; i < 300; i += 1) {
    rig.robot.drive(1.2, 0);
    rig.world.step(DT);
  }
  for (let i = 0; i < 200; i += 1) {
    rig.robot.drive(0, 0);
    rig.world.step(DT);
  }
  assert.equal(
    rig.governor.gripEvidence().measured,
    null,
    "it measured its brakes against a person and believed the answer",
  );
});

test("no surface ahead means no measurement, not a comfortable default", () => {
  const world = new SimWorld({ width: 60, height: 8, seed: 4, noise: 1, surfaceFriction: 0.06 });
  const governor = new SafetyGovernor({ watchConflicts: false, watchGrip: true });
  const robot = new SimRobotAdapter(world, "luka", governor, {});
  world.addRobot("luka", { x: 20, y: 4 }, 0);
  for (let i = 0; i < 40; i += 1) { robot.drive(0, 0); world.step(DT); }
  for (let i = 0; i < 120; i += 1) { robot.drive(1.2, 0); world.step(DT); }
  for (let i = 0; i < 200; i += 1) { robot.drive(0, 0); world.step(DT); }

  const evidence = governor.gripEvidence();
  assert.equal(evidence.measured, null, "it produced a figure with nothing to measure against");
  // And says so rather than quietly substituting the configured number.
  assert.equal(evidence.inUse, evidence.assumed);
  assert.equal(forwardRange(robot.lidar(), DEFAULT_GRIP_THRESHOLDS), null);
});

// ── what it is for ──────────────────────────────────────────────────────────

test("a good floor produces no measurement at all, and costs nothing", () => {
  // The failure that would matter most in practice, because it would be
  // permanent: a capability that quietly slows every healthy robot. A
  // measurement may only tighten the envelope, so one false low reading is a
  // tax for as long as the window holds it.
  //
  // The gate that prevents it is not a fudge factor, it is the question the
  // event actually answers. On a floor that can deliver what the drive asks
  // for, the body tracks the wheels and the stop measures the drive's own ramp
  // — which establishes "at least that much", and that is already more than the
  // configured figure. The only events worth recording are the ones where the
  // two came apart.
  //
  // Measured before the gate existed, across `cluttered-office` and
  // `long-patrol` on a perfectly good floor: five launches in twenty-four came
  // out below the configured 1.20 m/s², worst 1.126, and the robot spent a
  // third of its ticks under a tightened envelope for nothing.
  const governor = new SafetyGovernor({ watchConflicts: false, watchGrip: true });
  assert.equal(governor.effectiveDecel(), DEFAULT_LIMITS.maxDecel);

  for (const seed of [1, 2, 3, 4]) {
    const rig = corridor({ mu: 0.8, seed, watchGrip: true, startX: 16 });
    const before = rig.governor.protectiveDistance(1.0);
    // Launch, run, stop, and do it again — the shape of any mission.
    for (const leg of [0, 1]) {
      const until = 20 + leg * 3;
      for (let i = 0; i < 400 && rig.self.pose.x < until; i += 1) {
        rig.robot.drive(1.2, 0);
        rig.world.step(DT);
      }
      for (let i = 0; i < 120; i += 1) {
        rig.robot.drive(0, 0);
        rig.world.step(DT);
      }
    }
    const evidence = rig.governor.gripEvidence();
    assert.equal(
      evidence.measured,
      null,
      `a µ=0.8 floor produced a figure of ${evidence.measured} m/s², which would slow the robot for nothing`,
    );
    assert.equal(evidence.inUse, DEFAULT_LIMITS.maxDecel);
    assert.equal(rig.governor.protectiveDistance(1.0), before);
  }
});

test("the envelope can only ever be tightened by what is measured", () => {
  // Stated as a property rather than an example: whatever the monitor has seen,
  // the figure in use is never above the one that was configured.
  const monitor = new GripMonitor();
  assert.equal(monitor.authority(0), null);
  for (const mu of [0.06, 0.1, 0.8]) {
    const rig = corridor({ mu, watchGrip: true, startX: 16 });
    for (let i = 0; i < 400 && rig.self.pose.x < 22; i += 1) {
      rig.robot.drive(1.2, 0);
      rig.world.step(DT);
    }
    for (let i = 0; i < 200; i += 1) {
      rig.robot.drive(0, 0);
      rig.world.step(DT);
    }
    const evidence = rig.governor.gripEvidence();
    assert.ok(
      evidence.inUse <= DEFAULT_LIMITS.maxDecel,
      `at µ=${mu} the robot talked itself into ${evidence.inUse.toFixed(3)} m/s² of braking`,
    );
    if (evidence.measured !== null) {
      assert.equal(evidence.inUse, Math.min(DEFAULT_LIMITS.maxDecel, evidence.measured));
    }
  }
});

test("the separation model still inverts exactly with a measured deceleration in force", () => {
  // `allowedSpeed` is the closed-form inverse of `protectiveDistance`. Swapping
  // the constant for a measured number in one and not the other would be a very
  // quiet way to break it.
  const rig = corridor({ mu: 0.06, watchGrip: true, startX: 18 });
  for (let i = 0; i < 120; i += 1) {
    rig.robot.drive(1.2, 0);
    rig.world.step(DT);
    if (rig.governor.gripEvidence().measured !== null) break;
  }
  assert.ok(rig.governor.effectiveDecel() < DEFAULT_LIMITS.maxDecel, "nothing was learned, so this proves nothing");
  let checked = 0;
  for (const distance of [1.5, 2.5, 4, 8]) {
    const v = rig.governor.allowedSpeed(distance);
    if (v <= 0 || v >= DEFAULT_LIMITS.maxLinear) continue;
    // `allowedSpeed` spends its budget from `distance - minSeparation`, so that
    // is what the protective distance comes back as.
    const target = distance - DEFAULT_LIMITS.minSeparation;
    assert.ok(
      Math.abs(rig.governor.protectiveDistance(v) - target) < 1e-9,
      `round trip at ${distance} m gave ${rig.governor.protectiveDistance(v)}, wanted ${target}`,
    );
    checked += 1;
  }
  assert.ok(checked >= 2, "every distance was clamped, so nothing was checked");
});

test("knowing the number is the difference between stopping and not", () => {
  // The whole point, as ground truth. Same floor, same geometry, same seeds —
  // the only difference is whether the robot found out what it was standing on.
  const charge = (watchGrip: boolean) => {
    let hits = 0;
    let clearance = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const rig = corridor({ mu: 0.06, seed, watchGrip, startX: 18 });
      const result = chargeTheWall(rig);
      if (result.collided) hits += 1;
      clearance += result.minClearance;
    }
    return { hits, clearance: clearance / 20 };
  };

  const blind = charge(false);
  const measuring = charge(true);
  assert.equal(blind.hits, 20, `assuming 1.2 m/s² on a 0.59 m/s² floor should hit the wall every time, got ${blind.hits}/20`);
  assert.equal(measuring.hits, 0, `measuring it should stop every time, got ${20 - measuring.hits}/20`);
  assert.ok(
    measuring.clearance > 0.2,
    `it stopped, but with only ${measuring.clearance.toFixed(3)} m to spare, which is not the designed margin`,
  );
});
