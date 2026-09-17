import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SpikingNetwork,
  connect,
  connectRandom,
  population,
  DEFAULT_NEURON,
} from "../brain/network.ts";

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
