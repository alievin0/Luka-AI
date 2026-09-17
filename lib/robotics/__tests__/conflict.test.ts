// Contradiction detection, tested on constructed samples rather than on
// whatever a scenario happens to produce.
//
// The first version of these detectors fired twenty-five times on a healthy
// crossing and stayed silent on an injected fault, and a scenario test would
// not have told me which half was wrong. Synthetic samples put the detector
// under a known input, which is the only way to separate "the detector is
// broken" from "the fault injection missed".

import { test } from "node:test";
import assert from "node:assert/strict";

import { ConflictMonitor, worstResponse, type MotionSample } from "../core/conflict.ts";
import { gatherEvidence } from "../core/evidence.ts";
import { createSimRig, SimRobotAdapter } from "../index.ts";
import { SafetyGovernor } from "../safety/governor.ts";

const rig = createSimRig({ scenario: "empty-hall" });
const evidence = gatherEvidence(rig.runtime.rawRobot, 0);

const sample = (over: Partial<MotionSample>, at: number): MotionSample => ({
  commanded: { linear: 0, angular: 0 },
  odometry: { linear: 0, angular: 0 },
  gyroYawRate: 0,
  scanClosure: null,
  at,
  ...over,
});

/** Feed the monitor the same reading for a while and collect what it reports. */
function sustain(monitor: ConflictMonitor, reading: Partial<MotionSample>, ms = 600) {
  const found = [];
  for (let at = 0; at <= ms; at += 50) {
    found.push(...monitor.check(sample(reading, at), evidence));
  }
  return found;
}

test("a robot doing exactly what it was told reports nothing", () => {
  const monitor = new ConflictMonitor();
  const quiet = sustain(monitor, {
    commanded: { linear: 0.6, angular: 0.2 },
    odometry: { linear: 0.6, angular: 0.2 },
    gyroYawRate: 0.2,
    scanClosure: 0.6,
  });
  assert.deepEqual(quiet, [], `a healthy robot produced ${quiet.map((c) => c.kind).join(", ")}`);
});

test("wheels and gyro disagreeing about turning is caught, once it persists", () => {
  const monitor = new ConflictMonitor();

  // One tick of disagreement is noise and must not be reported.
  const blip = monitor.check(
    sample({ odometry: { linear: 0, angular: 1.2 }, gyroYawRate: 0 }, 0),
    evidence,
  );
  assert.deepEqual(blip, [], "a single tick of disagreement was reported as a fault");

  const found = sustain(monitor, { odometry: { linear: 0, angular: 1.2 }, gyroYawRate: 0 });
  const turning = found.find((c) => c.kind === "turning");
  assert.ok(turning, "a wheel encoder turning against a silent gyro went unreported");

  // The report has to name both sources and their claims, not just fire.
  assert.equal(turning.sources.length, 2);
  assert.ok(turning.sources.some((s) => s.source === "wheel odometry" && s.value === 1.2));
  assert.ok(turning.sources.some((s) => s.source === "IMU gyro" && s.value === 0));
  assert.ok(turning.disagreement > 1, `${turning.disagreement}`);
  assert.ok(turning.affects.includes("navigate.to"));
  // It reports the disagreement without picking a winner — a slipping wheel
  // and a loose IMU are identical from here, and choosing is how a robot ends
  // up navigating confidently on the broken one.
  assert.match(turning.summary, /One of them is wrong/);
});

test("wheels turning while the world stays put is caught", () => {
  const monitor = new ConflictMonitor();
  const found = sustain(monitor, {
    commanded: { linear: 0.8, angular: 0 },
    odometry: { linear: 0.8, angular: 0 },
    // The scan says nothing is getting closer: jacked up, on a lip, or
    // spinning on a wet floor.
    scanClosure: 0,
  });
  const motion = found.find((c) => c.kind === "self-motion");
  assert.ok(motion, "odometry adding up distance it never travelled went unreported");
  assert.match(motion.summary, /never travelled/);
  assert.equal(motion.response, "degrade");
});

test("accelerating is not disobeying", () => {
  // The first version compared commanded against actual directly and flagged
  // every acceleration — four times per healthy crossing. What matters is not
  // whether the robot has reached the command but whether it is getting there.
  const monitor = new ConflictMonitor();
  const found = [];
  let actual = 0;
  for (let at = 0; at <= 800; at += 50) {
    actual = Math.min(0.8, actual + 0.06); // closing on the command
    found.push(
      ...monitor.check(
        sample({ commanded: { linear: 0.8, angular: 0 }, odometry: { linear: actual, angular: 0 } }, at),
        evidence,
      ),
    );
  }
  assert.deepEqual(
    found.filter((c) => c.kind === "obedience"),
    [],
    "a robot accelerating toward its command was called disobedient",
  );
});

test("a gap that stops closing is disobeying, and that one stops the robot", () => {
  const monitor = new ConflictMonitor();
  const found = sustain(monitor, {
    commanded: { linear: 0.8, angular: 0 },
    odometry: { linear: 0.05, angular: 0 },
  });
  const obedience = found.find((c) => c.kind === "obedience");
  assert.ok(obedience, "a robot ignoring its command went unreported");
  assert.equal(obedience.response, "stop", "a robot not obeying was given more to do");
  assert.match(obedience.summary, /not the same as an action happening/);
  assert.equal(worstResponse(found), "stop");
});

test("a turning robot abstains from the scan comparison rather than guessing", () => {
  // Turning sweeps the beams across near and far surfaces, so ranges change
  // fast for reasons that have nothing to do with travelling. The first version
  // treated that as forward motion and fired on every corner. A robot that is
  // turning does not get a second opinion this way, and abstaining is the
  // honest answer.
  //
  // The cluttered office is deliberate: its forward sector has surfaces in it,
  // so an abstention here is attributable to the turn rather than to there
  // being nothing to measure against.
  const office = createSimRig({ scenario: "cluttered-office", seed: 1 });
  const monitor = new ConflictMonitor();

  monitor.sampleScan(office.robot, 0, 0);
  assert.ok(
    monitor.sampleScan(office.robot, 100, 0) !== null,
    "a straight-running robot with surfaces in front of it got no scan estimate",
  );

  monitor.reset();
  monitor.sampleScan(office.robot, 0, 0.9);
  assert.equal(
    monitor.sampleScan(office.robot, 100, 0.9),
    null,
    "a turning robot was given a forward-speed estimate the measurement cannot support",
  );
});

test("a robot with nothing in range reports no speed rather than zero speed", () => {
  // Every forward beam in the empty hall sits clamped at its maximum range,
  // which is the sensor saying "nothing within twelve metres" and not "a
  // surface twelve metres away". Differencing two of those gives exactly zero,
  // and a confident zero here means "not moving" — measured, that made the
  // detector report 0.00 m/s forty-one times while the robot drove at 0.50.
  //
  // Missing is not zero. With nothing to measure against there is no second
  // opinion, and the answer is to say so.
  const hall = createSimRig({ scenario: "empty-hall", seed: 1 });
  const scan = hall.robot.lidar();
  const forward = scan.ranges.filter((_, i) => {
    const angle = -scan.fov / 2 + (scan.fov * i) / Math.max(1, scan.ranges.length - 1);
    return Math.abs(angle) <= 0.35;
  });
  assert.ok(
    forward.every((r) => r >= scan.maxRange - 0.1),
    "this test needs a robot whose forward beams are all saturated",
  );

  const monitor = new ConflictMonitor();
  monitor.sampleScan(hall.robot, 0, 0);
  assert.equal(
    monitor.sampleScan(hall.robot, 100, 0),
    null,
    "a saturated scan produced a speed estimate, which can only be a fabricated zero",
  );
});

// ── Simulation ─────────────────────────────────────────────────────────────
//
// The synthetic tests above drive `check` with constructed numbers, which is
// the only way to know whether the detector itself works. They cannot tell you
// whether a real fault produces those numbers.
//
// These run the whole path instead: a fault in the simulated world or in a
// sensor, the ordinary readers on top of it, and the detector reading whatever
// they return. The fault injection is the part worth being careful about. An
// earlier attempt overrode `velocity()` to 0.8 while the robot genuinely moved
// at 0.8, which fabricated no disagreement at all and looked like a detector
// that had stopped working.
//
// So the faults here are physical. `groundTraction = 0` is a floor that will
// not carry the wheels — ice, or a chassis jacked up on a threshold. The wheels
// keep turning, the encoders keep reporting it, and the robot goes nowhere;
// nothing in the sensing path is touched. The stuck gyro is injected at the
// reading because that is where a gyro fails.

/** Drive the robot and feed the monitor, the way a control loop would. */
function crossing(
  rig: ReturnType<typeof createSimRig>,
  options: {
    ticks?: number;
    linear?: number;
    angular?: number;
    /** Tick at which the fault starts. */
    faultAt?: number;
    onFault?: () => void;
    /** Replace the gyro reading, to simulate one that has stopped. */
    gyro?: (real: number, tick: number) => number;
  } = {},
) {
  const {
    ticks = 60,
    linear = 0.5,
    angular = 0,
    faultAt = Number.POSITIVE_INFINITY,
    onFault,
    gyro,
  } = options;
  const monitor = new ConflictMonitor();
  const seen = new Map<string, number>();
  let responseAfterFault: string = "none";

  // Commands go straight to the wheels rather than through `drive`, which
  // governs them. The governor now slows a robot whose senses contradict each
  // other, and a slowed robot has a smaller odometry gap — so driving normally
  // here would have the safety response quietly suppress the fault these tests
  // exist to detect. Detection is tested on an ungoverned robot; the governor
  // acting on it is tested further down.
  const wheels = rig.world.robot(rig.robot.id);

  for (let tick = 0; tick < ticks; tick += 1) {
    if (tick === faultAt) onFault?.();
    wheels.commandedLinear = linear;
    wheels.commandedAngular = angular;
    rig.world.step(0.1);

    const now = rig.world.timeMs;
    const odometry = rig.robot.velocity();
    const real = rig.robot.imu().yawRate;
    const conflicts = monitor.check(
      {
        commanded: { linear, angular },
        odometry,
        gyroYawRate: gyro ? gyro(real, tick) : real,
        scanClosure: monitor.sampleScan(rig.robot, now, odometry.angular),
        at: now,
      },
      gatherEvidence(rig.robot, now),
    );
    for (const conflict of conflicts) {
      seen.set(conflict.kind, (seen.get(conflict.kind) ?? 0) + 1);
    }
    if (tick > faultAt && conflicts.length > 0) {
      responseAfterFault = worstResponse(conflicts);
    }
  }
  return { seen, responseAfterFault };
}

test("a healthy robot crossing a real room reports no contradictions", () => {
  // The test that matters most, because every mistake this file has caught so
  // far was a detector firing on a robot that was working. Two rooms, several
  // seeds, sensor noise on: anything reported here is a false positive.
  for (const scenario of ["empty-hall", "cluttered-office"] as const) {
    for (const seed of [1, 4, 9]) {
      const { seen } = crossing(createSimRig({ scenario, seed }));
      assert.equal(
        seen.size,
        0,
        `${scenario} seed ${seed}: a healthy robot was accused of ` +
          `${[...seen.keys()].join(", ")}`,
      );
    }
  }
});

test("wheels spinning on a floor that will not carry them is caught in simulation", () => {
  // Odometry keeps integrating distance the robot never travels. Nothing in the
  // reading is malformed, stale, or missing — this is the failure that gets
  // through every check that asks whether a channel is reporting.
  const rig = createSimRig({ scenario: "cluttered-office", seed: 3 });
  const self = rig.world.robot(rig.robot.id);

  const { seen, responseAfterFault } = crossing(rig, {
    faultAt: 25,
    onFault: () => {
      self.groundTraction = 0;
    },
  });

  assert.ok(
    (seen.get("self-motion") ?? 0) > 0,
    "the robot's wheels turned for three seconds without it moving and nothing noticed",
  );
  assert.equal(responseAfterFault, "degrade");

  // The wheels are doing exactly what they were told; it is the floor that is
  // failing. A detector that cannot tell those apart is not worth having.
  assert.equal(
    seen.get("obedience") ?? 0,
    0,
    "the robot was accused of disobeying a command its wheels were following",
  );
});

test("noticing the contradiction cuts the distance the robot gets wrong", () => {
  // Why any of this is worth building, measured as ground truth: the gap
  // between where the robot believes it is and where it is.
  //
  // The comparison is against the same robot with the contradiction check
  // switched off, because "odometry over-claims on ice" is true either way.
  // What the check buys is how much.
  const drift = (watchConflicts: boolean) => {
    const rig = createSimRig({ scenario: "cluttered-office", seed: 3 });
    const governor = new SafetyGovernor({ limits: rig.governor.limits, watchConflicts });
    const robot = new SimRobotAdapter(rig.world, rig.robot.id, governor);
    const self = rig.world.robot(rig.robot.id);
    let believed = 0;

    for (let tick = 0; tick < 60; tick += 1) {
      if (tick === 25) self.groundTraction = 0;
      robot.drive(0.5, 0);
      rig.world.step(0.1);
      believed += Math.abs(robot.velocity().linear) * 0.1;
    }
    return believed - self.distanceTravelled;
  };

  const unwatched = drift(false);
  const watched = drift(true);

  assert.ok(
    unwatched > 1.0,
    `a robot that never checks should over-claim by more than a metre, got ${unwatched.toFixed(2)} m`,
  );
  assert.ok(
    watched < unwatched * 0.6,
    `noticing the contradiction should have cut the error substantially: ` +
      `${watched.toFixed(2)} m against ${unwatched.toFixed(2)} m`,
  );
});

test("a gyro that stops reporting while the robot turns is caught in simulation", () => {
  // A stuck gyro reads a perfectly well-formed zero. Fresh, complete, in range,
  // and wrong — the wheels are the only thing that can say so.
  const rig = createSimRig({ scenario: "cluttered-office", seed: 5 });

  const { seen, responseAfterFault } = crossing(rig, {
    linear: 0.15,
    angular: 0.8,
    faultAt: 25,
    gyro: (real, tick) => (tick >= 25 ? 0 : real),
  });

  assert.ok(
    (seen.get("turning") ?? 0) > 0,
    "the gyro flatlined while the robot kept turning and nothing noticed",
  );
  assert.equal(responseAfterFault, "degrade");
});

test("a turning robot with a healthy gyro is not accused of anything", () => {
  // The control for the test above: same manoeuvre, working sensor.
  const { seen } = crossing(createSimRig({ scenario: "cluttered-office", seed: 5 }), {
    linear: 0.15,
    angular: 0.8,
  });
  assert.equal(seen.size, 0, `a healthy turn was reported as ${[...seen.keys()].join(", ")}`);
});

// ── The governor acting on it ──────────────────────────────────────────────
//
// A detector nothing consults is a log line. These check that a contradiction
// reaches the wheel.

test("a contradiction reaches the wheel, not just the log", () => {
  const rig = createSimRig({ scenario: "cluttered-office", seed: 3 });
  const self = rig.world.robot(rig.robot.id);
  const governor = rig.governor;
  let beforeFault = 0;
  let afterFault = Number.POSITIVE_INFINITY;
  let reported: readonly unknown[] = [];

  for (let tick = 0; tick < 60; tick += 1) {
    if (tick === 25) self.groundTraction = 0;
    const command = governor.govern(rig.robot, 0.5, 0);
    rig.robot.drive(command.linear, command.angular);
    rig.world.step(0.1);
    if (tick === 24) beforeFault = command.linear;
    if (tick === 59) {
      afterFault = command.linear;
      reported = command.verdict.conflicts ?? [];
    }
  }

  assert.ok(beforeFault > 0.3, `a healthy robot was already slowed to ${beforeFault.toFixed(2)} m/s`);
  assert.ok(
    afterFault <= governor.limits.conflictSpeed + 1e-6,
    `the wheels spun for three seconds without the robot moving and it was still ` +
      `allowed ${afterFault.toFixed(2)} m/s`,
  );
  assert.ok(reported.length > 0, "the verdict did not carry the conflict an operator would need");
});

test("the verdict names the sources and their readings, not just a level", () => {
  // A refusal an operator cannot act on is a refusal that gets overridden. The
  // conflict travels with the verdict so whoever reads it gets both claims,
  // their timestamps and what they invalidate.
  const rig = createSimRig({ scenario: "cluttered-office", seed: 3 });
  const self = rig.world.robot(rig.robot.id);

  for (let tick = 0; tick < 60; tick += 1) {
    if (tick === 25) self.groundTraction = 0;
    const command = rig.governor.govern(rig.robot, 0.5, 0);
    rig.robot.drive(command.linear, command.angular);
    rig.world.step(0.1);
  }

  const [conflict] = rig.governor.standingConflicts();
  assert.ok(conflict, "no conflict was standing after three seconds of spinning wheels");
  assert.equal(conflict.kind, "self-motion");
  assert.equal(conflict.sources.length, 2);
  assert.deepEqual(
    conflict.sources.map((source) => source.source).sort(),
    ["scan closure", "wheel odometry"],
  );
  assert.ok(conflict.affects.length > 0, "a conflict that invalidates nothing is not a conflict");
  assert.ok(conflict.sources.every((source) => Number.isFinite(source.at)));
});

test("a healthy robot driven through the governor is never slowed for a contradiction", () => {
  // The false-positive test at the level that matters: if this fires, every
  // robot in the fleet crawls for no reason somebody can see.
  for (const scenario of ["empty-hall", "cluttered-office"] as const) {
    for (const seed of [1, 4, 9]) {
      const rig = createSimRig({ scenario, seed });
      for (let tick = 0; tick < 60; tick += 1) {
        const command = rig.governor.govern(rig.robot, 0.5, 0);
        rig.robot.drive(command.linear, command.angular);
        rig.world.step(0.1);
        assert.equal(
          rig.governor.standingConflicts().length,
          0,
          `${scenario} seed ${seed} tick ${tick}: healthy robot accused of ` +
            `${rig.governor.standingConflicts().map((c) => c.kind).join(", ")}`,
        );
      }
    }
  }
});

test("the response to a contradiction does not erase the evidence for it", () => {
  // The first version of the governor integration oscillated at about 3 Hz.
  // Slowing down is the response to a self-motion conflict, a slower robot has
  // a smaller odometry gap, and a smaller gap is within threshold of a scan
  // that says the robot is not moving — so the conflict cleared because the
  // robot had obeyed it, the speed came back, and the gap reopened. A robot on
  // ice surged and crawled, which is worse than either.
  //
  // A conflict is held until the senses positively agree at a magnitude that
  // proves something. On a floor that never recovers, that never happens.
  const rig = createSimRig({ scenario: "cluttered-office", seed: 3 });
  const self = rig.world.robot(rig.robot.id);
  let changes = 0;
  let previous = rig.governor.verdict().level;

  for (let tick = 0; tick < 90; tick += 1) {
    if (tick === 25) self.groundTraction = 0;
    rig.robot.drive(0.5, 0);
    rig.world.step(0.1);
    const level = rig.governor.verdict().level;
    if (level !== previous) changes += 1;
    previous = level;
  }

  assert.equal(changes, 1, `the safety level changed ${changes} times on one unrecovered fault`);
  assert.ok(
    rig.governor.standingConflicts().length > 0,
    "the conflict cleared itself on a floor that never recovered",
  );
  assert.ok(
    rig.governor.standingConflicts()[0].held,
    "a conflict kept past the moment of disagreement should say that it is being held",
  );
});

test("a floor that recovers clears the conflict without anyone intervening", () => {
  // The other half: held is not latched forever. The robot is kept at the
  // contradiction speed, which is deliberately fast enough for it to prove the
  // floor grips again, and then it goes back to work on its own.
  const rig = createSimRig({ scenario: "cluttered-office", seed: 3 });
  const self = rig.world.robot(rig.robot.id);
  let raised = false;

  for (let tick = 0; tick < 90; tick += 1) {
    if (tick === 25) self.groundTraction = 0;
    if (tick === 50) self.groundTraction = 1;
    rig.robot.drive(0.5, 0);
    rig.world.step(0.1);
    if (rig.governor.standingConflicts().length > 0) raised = true;
  }

  assert.ok(raised, "the fault was never noticed, so clearing it proves nothing");
  assert.equal(
    rig.governor.standingConflicts().length,
    0,
    "the floor gripped again and the robot stayed slowed anyway",
  );
  assert.equal(rig.governor.verdict().level, "clear");
});

test("an operator can re-arm a robot that cannot clear itself", () => {
  // An obedience conflict stops the wheels, and a stopped robot can never
  // demonstrate that its motors work. Something has to be able to decide to try
  // again — and it should re-raise immediately if the fault is still there.
  const rig = createSimRig({ scenario: "cluttered-office", seed: 3 });
  const self = rig.world.robot(rig.robot.id);

  for (let tick = 0; tick < 60; tick += 1) {
    if (tick === 25) self.groundTraction = 0;
    rig.robot.drive(0.5, 0);
    rig.world.step(0.1);
  }
  assert.ok(rig.governor.standingConflicts().length > 0, "no conflict to re-arm from");

  rig.governor.clearConflicts();
  assert.equal(rig.governor.standingConflicts().length, 0, "re-arming did not clear the conflict");

  // Still on ice, so it should come straight back.
  for (let tick = 0; tick < 20; tick += 1) {
    rig.robot.drive(0.5, 0);
    rig.world.step(0.1);
  }
  assert.ok(
    rig.governor.standingConflicts().length > 0,
    "re-arming onto an unfixed fault left the robot running at full speed",
  );
});
