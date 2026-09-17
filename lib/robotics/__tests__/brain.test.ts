import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SpikingNetwork,
  connect,
  connectRandom,
  population,
  DEFAULT_NEURON,
} from "../brain/network.ts";
import {
  EscapeCircuit,
  ESCAPE_EDGES,
  FLY_FAITHFUL_TUNING,
  angularSize,
} from "../brain/circuits/escape.ts";
import { signOf } from "../brain/connectome.ts";
import {
  CompassCircuit,
  COMPASS_CELL_COUNTS,
  COMPASS_EDGES,
  WEDGES,
  layOutCompass,
  angleDelta,
} from "../brain/circuits/compass.ts";
import { createSimRig } from "../index.ts";
import { selfMotionExpansion, type LoomingReport } from "../abilities/looming.ts";

test("a neuron does not fire below its rheobase and does above it", () => {
  const net = new SpikingNetwork({ neuronCount: 1, synapses: [], stepMs: 0.5 });
  const rheobase = net.rheobase(0);
  assert.ok(Math.abs(rheobase - 1.5) < 1e-6, `rheobase was ${rheobase}`);

  const rateAt = (current: number) => {
    net.reset();
    const steps = 2000;
    for (let i = 0; i < steps; i += 1) {
      net.sustain(0, current);
      net.step();
    }
    return net.rate(0, steps * 0.5);
  };

  assert.equal(rateAt(rheobase * 0.9), 0, "below rheobase it must be silent");
  assert.ok(rateAt(rheobase * 1.4) > 5, "above rheobase it must fire");
});

test("firing rate rises with current and never exceeds the refractory ceiling", () => {
  const net = new SpikingNetwork({ neuronCount: 1, synapses: [], stepMs: 0.5 });
  const ceiling = 1000 / DEFAULT_NEURON.refractoryMs;

  let previous = -1;
  for (const current of [2, 3, 5, 9, 20, 60]) {
    net.reset();
    const steps = 2000;
    for (let i = 0; i < steps; i += 1) {
      net.sustain(0, current);
      net.step();
    }
    const rate = net.rate(0, steps * 0.5);
    assert.ok(rate >= previous, `rate fell from ${previous} to ${rate} at I=${current}`);
    assert.ok(rate <= ceiling + 1, `rate ${rate} exceeded the ${ceiling} Hz refractory ceiling`);
    previous = rate;
  }
});

test("a spike reaches its target, and inhibition silences it", () => {
  const excitatory = new SpikingNetwork({
    neuronCount: 2,
    synapses: [{ from: 0, to: 1, weight: 6 }],
    stepMs: 0.5,
  });
  for (let i = 0; i < 1000; i += 1) {
    excitatory.sustain(0, 4);
    excitatory.step();
  }
  assert.ok(excitatory.rate(0, 500) > 10, "the driven neuron should fire");
  assert.ok(excitatory.rate(1, 500) > 1, "its target should fire too");

  const inhibited = new SpikingNetwork({
    neuronCount: 3,
    synapses: [
      { from: 0, to: 2, weight: 6 },
      { from: 1, to: 2, weight: -12 },
    ],
    stepMs: 0.5,
  });
  for (let i = 0; i < 1000; i += 1) {
    inhibited.sustain(0, 4);
    inhibited.sustain(1, 4);
    inhibited.step();
  }
  assert.ok(inhibited.rate(2, 500) < 2, "inhibition should hold the target down");
});

test("axonal delay actually delays", () => {
  const net = new SpikingNetwork({
    neuronCount: 2,
    synapses: [{ from: 0, to: 1, weight: 40, delayMs: 10 }],
    stepMs: 0.5,
  });

  const spikes = [];
  for (let i = 0; i < 200; i += 1) {
    net.sustain(0, 5);
    const step = net.step();
    for (let s = 0; s < step.spikeCount; s += 1) {
      spikes.push({ neuron: step.spikes[s], timeMs: step.timeMs });
    }
  }

  const firstSource = spikes.find((s) => s.neuron === 0);
  const firstTarget = spikes.find((s) => s.neuron === 1);
  assert.ok(firstSource && firstTarget, "both neurons should fire");
  assert.ok(
    firstTarget.timeMs - firstSource.timeMs >= 10,
    `target fired ${firstTarget.timeMs - firstSource.timeMs} ms after the source, expected at least 10`,
  );
});

test("the same seed gives the same spikes, a different one does not", () => {
  const build = (seed: number) => {
    const net = new SpikingNetwork({
      neuronCount: 60,
      synapses: connectRandom(population(0, 30), population(30, 30), 0.25, 3, 5),
      stepMs: 0.5,
      seed,
    });
    const trace: number[] = [];
    for (let i = 0; i < 600; i += 1) {
      net.sustainAll(population(0, 30), 2.2);
      const step = net.step(0.8);
      trace.push(step.spikeCount);
    }
    return trace.join(",");
  };

  assert.equal(build(3), build(3));
  assert.notEqual(build(3), build(4));
});

test("a quiet network costs almost nothing to run", () => {
  const size = 5000;
  const synapses = connectRandom(population(0, size), population(0, size), 0.002, 0.5, 2);
  const net = new SpikingNetwork({ neuronCount: size, synapses, stepMs: 0.5, seed: 1 });

  const started = Date.now();
  for (let i = 0; i < 400; i += 1) net.step();
  const elapsed = Date.now() - started;

  // 200 ms of simulated time with no input at all. This is the regime that
  // matters: event-driven delivery means silence is nearly free.
  assert.ok(elapsed < 2000, `200 ms of a silent ${size}-neuron network took ${elapsed} ms`);
  assert.equal(net.populationRate(population(0, size), 200), 0);
});

test("full connection wires every pair except self-connections", () => {
  const synapses = connect(population(0, 4), population(0, 4), 1);
  assert.equal(synapses.length, 12);
  assert.ok(!synapses.some((s) => s.from === s.to));
});

test("population rate averages over the population", () => {
  const net = new SpikingNetwork({ neuronCount: 4, synapses: [], stepMs: 0.5 });
  for (let i = 0; i < 1000; i += 1) {
    net.sustain(0, 5);
    net.sustain(1, 5);
    net.step();
  }
  const driven = net.populationRate([0, 1], 500);
  const all = net.populationRate([0, 1, 2, 3], 500);
  assert.ok(driven > 0);
  assert.ok(Math.abs(all - driven / 2) < 1e-6, "silent neurons must pull the average down");
});

// ── the fly's escape circuit ───────────────────────────────────────────────
// These tests check two different things and it is worth keeping them apart:
// that the wiring matches what the connectome measured, and that the dynamics
// behave the way the published physiology says. The first is a data claim and
// must be exact. The second is a modelling claim and is only ever approximate.

test("the escape circuit is wired to the measured cell counts", () => {
  const circuit = new EscapeCircuit();
  const census = circuit.census();

  // 367 cells, eye to jump muscle, as counted in MaleCNS v1.0.
  const total = Object.values(census).reduce((a, b) => a + b, 0);
  assert.equal(total, 367);
  assert.equal(census.LC4, 126);
  assert.equal(census.LPLC2, 185);
  assert.equal(census.DNp01, 2, "the Giant Fibre is one cell per hemisphere and no more");
  assert.equal(census.TTMn, 2);

  // The measured quantity is the type-to-type synapse total, so that is what
  // has to survive being spread over a projection.
  const declared = ESCAPE_EDGES.reduce((sum, e) => sum + e.synapses, 0);
  assert.ok(
    Math.abs(circuit.compiled.stats.contacts - declared) / declared < 0.01,
    `contacts drifted: ${circuit.compiled.stats.contacts.toFixed(0)} vs ${declared} measured`,
  );
});

test("glutamate is wired inhibitory, as it is in the fly", () => {
  // PVLP010 is the circuit's only brake. In the fly, glutamate acting on GluClα
  // is inhibitory — the opposite of the vertebrate default — and getting this
  // backwards turns the brake into an accelerator.
  assert.equal(signOf({ id: "x", transmitter: "glutamate" }), -1);
  assert.equal(signOf({ id: "y", transmitter: "acetylcholine" }), 1);

  const circuit = new EscapeCircuit();
  assert.ok(
    circuit.compiled.stats.inhibitory > 0,
    "no inhibitory edges survived, so the feed-forward brake is missing",
  );
});

test("the circuit fires for an approach and stays quiet for everything else", () => {
  const approach = (speed: number, radius = 0.25, start = 8) => {
    const circuit = new EscapeCircuit();
    let previous = angularSize(radius, start);
    for (let t = 20; t < 20_000; t += 20) {
      const range = start - speed * (t / 1000);
      if (range <= 0.05) break;
      const theta = angularSize(radius, range);
      const stimulus = { theta, dTheta: (theta - previous) / 0.02 };
      previous = theta;
      if (circuit.advance(20, { L: stimulus, R: stimulus }).triggered) return range;
    }
    return null;
  };

  assert.ok((approach(1.5) ?? 0) > 1, "did not fire for a 1.5 m/s approach");
  assert.ok((approach(1.0) ?? 0) > 1, "did not fire for a 1.0 m/s approach");

  // Receding, static and slowly drifting objects must not trigger an escape.
  const steady = (theta: number, dTheta: number) => {
    const circuit = new EscapeCircuit();
    for (let i = 0; i < 200; i += 1) {
      if (circuit.advance(20, { L: { theta, dTheta }, R: { theta, dTheta } }).triggered) return true;
    }
    return false;
  };
  assert.equal(steady(0.8, 0), false, "fired at a stationary object");
  assert.equal(steady(0.8, -2), false, "fired at a receding object");
  assert.equal(steady(1.4, 0), false, "fired at something large but not moving");
});

test("the escape is directional: the side that fires is the side the threat is on", () => {
  const drive = (side: "L" | "R") => {
    const circuit = new EscapeCircuit();
    const quiet = { theta: 0, dTheta: 0 };
    let previous = angularSize(0.25, 8);
    for (let t = 20; t < 12_000; t += 20) {
      const range = 8 - 1.5 * (t / 1000);
      if (range <= 0.05) break;
      const theta = angularSize(0.25, range);
      const stimulus = { theta, dTheta: (theta - previous) / 0.02 };
      previous = theta;
      const verdict = circuit.advance(20, {
        L: side === "L" ? stimulus : quiet,
        R: side === "R" ? stimulus : quiet,
      });
      if (verdict.triggered) return verdict;
    }
    return null;
  };

  const left = drive("L");
  assert.equal(left?.side, "L");
  assert.equal(left?.giantFibre.R, 0, "the quiet side fired too");

  const right = drive("R");
  assert.equal(right?.side, "R");
  assert.equal(right?.giantFibre.L, 0);
});

test("time to contact at firing is roughly constant across approach speeds", () => {
  // This is the property that makes the circuit worth borrowing, and it is not
  // coded anywhere: the drive is linear in expansion rate and Gaussian in size,
  // and a near-constant time-to-contact threshold falls out of the combination.
  const ttcAt = (speed: number) => {
    const circuit = new EscapeCircuit();
    const start = Math.max(8, speed * 5);
    let previous = angularSize(0.25, start);
    for (let t = 20; t < 30_000; t += 20) {
      const range = start - speed * (t / 1000);
      if (range <= 0.05) break;
      const theta = angularSize(0.25, range);
      const stimulus = { theta, dTheta: (theta - previous) / 0.02 };
      previous = theta;
      if (circuit.advance(20, { L: stimulus, R: stimulus }).triggered) return range / speed;
    }
    return null;
  };

  const speeds = [1.0, 1.5, 2.0, 2.5];
  const times = speeds.map(ttcAt);
  for (const [i, t] of times.entries()) {
    assert.ok(t !== null, `never fired at ${speeds[i]} m/s`);
    assert.ok(t! > 0.4 && t! < 2.0, `${speeds[i]} m/s fired at ${t?.toFixed(2)} s to contact`);
  }

  // Over a 2.5x range of speeds, the firing range must grow — that is what
  // keeps the time margin from collapsing at speed.
  const ranges = speeds.map((v, i) => times[i]! * v);
  assert.ok(
    ranges[ranges.length - 1] > ranges[0],
    `firing range shrank with speed: ${ranges.map((r) => r.toFixed(2)).join(", ")}`,
  );
});

test("at the fly's own sensitivity the threshold matches the published range", () => {
  // Calibration check against the animal, not against this implementation.
  // Published takeoff data puts the giant-fibre angular-size threshold between
  // about 39 deg and 67 deg. At sensitivity 1 this circuit should land there for
  // ordinary approach speeds — if it does not, the model has drifted off the
  // physiology it claims to reproduce.
  const thresholdDeg = (speed: number) => {
    const circuit = new EscapeCircuit({ tuning: FLY_FAITHFUL_TUNING });
    const start = 8;
    let previous = angularSize(0.25, start);
    for (let t = 20; t < 30_000; t += 20) {
      const range = start - speed * (t / 1000);
      if (range <= 0.05) break;
      const theta = angularSize(0.25, range);
      const stimulus = { theta, dTheta: (theta - previous) / 0.02 };
      previous = theta;
      if (circuit.advance(20, { L: stimulus, R: stimulus }).triggered) {
        return (theta * 180) / Math.PI;
      }
    }
    return null;
  };

  for (const speed of [1.0, 1.5, 2.0]) {
    const deg = thresholdDeg(speed);
    assert.ok(deg !== null, `never fired at ${speed} m/s`);
    assert.ok(
      deg! >= 35 && deg! <= 70,
      `at ${speed} m/s the Giant Fibre fired at ${deg?.toFixed(0)} deg, outside the published 39-67 deg range`,
    );
  }

  // And the robot default must be more cautious than the fly, not less.
  const flyRange = (() => {
    const circuit = new EscapeCircuit({ tuning: FLY_FAITHFUL_TUNING });
    let previous = angularSize(0.25, 8);
    for (let t = 20; t < 30_000; t += 20) {
      const range = 8 - 1.5 * (t / 1000);
      if (range <= 0.05) break;
      const theta = angularSize(0.25, range);
      const stimulus = { theta, dTheta: (theta - previous) / 0.02 };
      previous = theta;
      if (circuit.advance(20, { L: stimulus, R: stimulus }).triggered) return range;
    }
    return 0;
  })();
  assert.ok(flyRange < 0.8, `the fly-faithful tuning fired at ${flyRange.toFixed(2)} m, further out than expected`);
});

test("reflex.looming pulls the robot away from someone walking into it", async () => {
  const rig = createSimRig({ scenario: "empty-hall" });
  const robot = rig.world.robot("luka-1");
  rig.world.humans.push({
    id: "threat",
    at: { x: robot.pose.x + 7, y: robot.pose.y + 0.8 },
    waypoints: [{ x: robot.pose.x - 3, y: robot.pose.y + 0.2 }],
    speed: 1.5,
    attentive: false,
  });

  const daemon = rig.runtime.startDaemon<Record<string, never>, LoomingReport>(
    "reflex.looming",
    {},
  );

  const probe = (async () => {
    for (let i = 0; i < 260; i += 1) await rig.runtime.sleep(20);
  })();
  await rig.runtime.settle(probe);
  await rig.runtime.stopDaemons();
  const report = await daemon.promise;

  assert.equal(report.ok, true, report.summary);
  assert.ok((report.data?.escapes ?? 0) > 0, "never escaped from someone walking straight at it");
  assert.ok(
    (report.data?.circuit.cells ?? 0) === 367,
    "the reported circuit is not the one that was measured",
  );
  // The robot is not allowed to have driven into the person while escaping.
  assert.equal(rig.world.robot("luka-1").collisions, 0);
});

test("a large stationary object does not trigger an escape", () => {
  // The failure this guards against: a size channel that responds to size
  // rather than to looming makes a robot escape from a wall it is parked
  // beside. Measured before it was fixed — seven escapes crossing one room,
  // every one triggered by something stationary at 28-64 degrees.
  const circuit = new EscapeCircuit();
  let fired = false;
  for (let i = 0; i < 400; i += 1) {
    // Right at the size the circuit is most sensitive to, and not moving.
    if (circuit.advance(20, {
      L: { theta: 0.79, dTheta: 0 },
      R: { theta: 0.79, dTheta: 0 },
    }).triggered) {
      fired = true;
      break;
    }
  }
  assert.equal(fired, false, "escaped from a stationary object at peak size tuning");
});

test("the reflex subtracts the expansion the robot's own motion explains", () => {
  // A robot driving at a stationary wall. Nothing is approaching it, but the
  // wall grows in the scan exactly like something charging, and an uncorrected
  // circuit escapes from its own destination.
  const driveAtWall = (speed: number, cancel: boolean) => {
    const circuit = new EscapeCircuit();
    const radius = 0.25;
    let previous = angularSize(radius, 6);
    for (let t = 20; t < 20_000; t += 20) {
      const range = 6 - speed * (t / 1000);
      if (range <= 0.3) break;
      const theta = angularSize(radius, range);
      let dTheta = (theta - previous) / 0.02;
      previous = theta;
      if (cancel) dTheta -= selfMotionExpansion({ range, angle: 0 }, radius, speed, 0);
      const stimulus = { theta, dTheta };
      if (circuit.advance(20, { L: stimulus, R: stimulus }).triggered) return range;
    }
    return null;
  };

  for (const speed of [0.5, 0.8, 1.2]) {
    assert.ok(
      driveAtWall(speed, false) !== null,
      `the uncorrected circuit somehow ignored a wall approached at ${speed} m/s`,
    );
    assert.equal(
      driveAtWall(speed, true),
      null,
      `escaped from a stationary wall while driving at it at ${speed} m/s`,
    );
  }
});

test("the reflex still lets the robot cross a cluttered room", async () => {
  // End to end, with everything on. The reflex firing occasionally while
  // manoeuvring near obstacles is acceptable; preventing the trip is not.
  const rig = createSimRig({ scenario: "cluttered-office" });
  const daemon = rig.runtime.startDaemon<Record<string, never>, LoomingReport>(
    "reflex.looming",
    {},
  );
  const trip = await rig.runtime.run("navigate.to", { x: 9, y: 6, timeoutMs: 60_000 });
  await rig.runtime.stopDaemons();
  const report = await daemon.promise;

  assert.equal(trip.ok, true, `the reflex blocked the trip: ${trip.summary}`);
  assert.equal(rig.world.robot("luka-1").collisions, 0);
  assert.ok(
    (report.data?.suppressedBySelfMotion ?? 0) > 50,
    `only ${report.data?.suppressedBySelfMotion} expansions were explained by self-motion`,
  );
});

// ── the central complex, and an honest negative result ─────────────────────
// These tests pin down a circuit that does NOT work. They exist so the claim
// in compass.ts stays true: if someone later finds parameters that hold a bump,
// the negative test fails and the documentation has to be rewritten. A negative
// result nobody checks rots into a wrong comment.

test("the compass is wired to the measured cell counts", () => {
  const circuit = new CompassCircuit();
  const census = circuit.census();
  assert.equal(census.EPG, 47);
  assert.equal(census.Delta7, 42);
  assert.equal(census.PFL3, 24);
  assert.equal(
    Object.values(census).reduce((a, b) => a + b, 0),
    Object.values(COMPASS_CELL_COUNTS).reduce((a, b) => a + b, 0),
  );

  // Every edge says where it came from, because some of this is measured and
  // some is only published anatomy with a modelled strength.
  const measured = COMPASS_EDGES.filter((e) => e.provenance === "measured");
  assert.ok(measured.length > COMPASS_EDGES.length / 2, "most edges should be measured");
  for (const edge of COMPASS_EDGES.filter((e) => e.provenance === "described")) {
    assert.ok(edge.note, `${edge.from}->${edge.to} is described but does not say why`);
  }
});

test("the ring is laid out evenly, with hemisphere independent of wedge", () => {
  // Both of these were bugs, and both produced a circuit that looked like it
  // worked. Uneven wedges gave a false bump wherever the cells piled up; tying
  // the hemisphere to the wedge index meant every even wedge held only
  // left-side cells, so a shifted bump landed somewhere with no shifter to
  // move it on and stopped dead.
  const cells = layOutCompass();
  for (const type of ["EPG", "PEN_a", "PEN_b"]) {
    const ofType = cells.filter((c) => c.type === type);
    const perWedge = new Array(WEDGES).fill(0);
    for (const c of ofType) perWedge[c.wedge] += 1;
    const spread = Math.max(...perWedge) - Math.min(...perWedge);
    assert.ok(spread <= 2, `${type} occupancy varies by ${spread} across wedges: ${perWedge}`);
  }

  // The ring itself has to be occupied everywhere, or activity pools where the
  // cells are and the pooling reads as a heading.
  const ring = cells.filter((c) => c.type === "EPG");
  for (let w = 0; w < WEDGES; w += 1) {
    assert.ok(ring.some((c) => c.wedge === w), `EPG wedge ${w} is empty`);
  }

  // Every wedge must be reachable by a shifter of each hemisphere, or the bump
  // can move into a wedge it cannot move out of.
  const shifters = cells.filter((c) => c.type === "PEN_a" || c.type === "PEN_b");
  for (const side of ["L", "R"] as const) {
    const covered = new Set(shifters.filter((c) => c.side === side).map((c) => c.wedge));
    assert.equal(covered.size, WEDGES, `${side} shifters cover only ${covered.size} of ${WEDGES} wedges`);
  }
});

test("a driven bump is read back at the bearing it was driven to", () => {
  // The readout works, whatever the dynamics do. This is the part of the
  // circuit that is sound.
  for (const bearing of [0, Math.PI / 2, -Math.PI / 2, 2.5]) {
    const circuit = new CompassCircuit();
    circuit.seed(bearing);
    const reading = circuit.advance(100, 0);
    assert.ok(reading.strength > 0.6, `no bump at ${bearing}: strength ${reading.strength}`);
    assert.ok(
      Math.abs(angleDelta(reading.heading, bearing)) < 0.35,
      `read ${reading.heading.toFixed(2)} for a bump driven to ${bearing}`,
    );
  }
});

test("driving one hemisphere's shifters does make them asymmetric", () => {
  // The rotation mechanism is wired correctly even though there is no bump for
  // it to act on: turning one way drives one side and leaves the other quiet.
  const circuit = new CompassCircuit({ tuning: { shiftGain: 40 } }) as unknown as {
    seed(b: number): void;
    advance(ms: number, rate: number): unknown;
    network: { resetCounts(): void; populationRate(n: readonly number[], ms: number): number };
    shifters: { L: number[]; R: number[] };
  };
  circuit.seed(0);
  circuit.advance(100, 0);
  circuit.network.resetCounts();
  for (let i = 0; i < 20; i += 1) circuit.advance(50, 0.4);

  const left = circuit.network.populationRate(circuit.shifters.L, 1000);
  const right = circuit.network.populationRate(circuit.shifters.R, 1000);
  assert.ok(left > right * 2, `driven side ${left.toFixed(1)} Hz vs idle ${right.toFixed(1)} Hz`);
});

test("the ring does NOT hold a bump on its own — the documented negative result", () => {
  // If this test starts failing, someone has found a working parameter set and
  // the warning at the top of compass.ts is now wrong. Fix the documentation,
  // do not delete the test.
  const settings = [
    { weightScale: 0.6, tonicDrive: 1.2 },
    { weightScale: 0.9, tonicDrive: 1.2 },
    { weightScale: 1.5, tonicDrive: 1.45 },
    { weightScale: 4, tonicDrive: 1.2 },
  ];

  for (const tuning of settings) {
    const circuit = new CompassCircuit({ tuning });
    circuit.seed(0);
    circuit.advance(100, 0);
    let reading = circuit.advance(100, 0);
    for (let i = 0; i < 20; i += 1) reading = circuit.advance(100, 0);

    assert.ok(
      reading.strength < 0.5,
      `a bump survived 2 s at ${JSON.stringify(tuning)} with strength ` +
        `${reading.strength.toFixed(3)} — the compass may actually work now, ` +
        "which means the negative result documented in compass.ts needs rewriting.",
    );
  }
});
