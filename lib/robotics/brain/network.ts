// A spiking network you can actually run in a control loop.
//
// This is the substrate, not a brain: leaky integrate-and-fire neurons wired by
// a sparse synapse matrix, integrated deterministically at a fixed step. What
// makes it useful for robotics rather than for neuroscience is that it is
// event-driven — only the neurons that spiked this step touch memory — so a
// network that is mostly quiet costs almost nothing, which is the regime real
// nervous systems live in.
//
// Everything is typed arrays and integer indices. No objects per neuron, no
// allocation in the step, and the same seed gives the same spikes.

import { makeRng } from "../core/math.ts";

export type NeuronParams = {
  /** Membrane time constant, ms. Bigger = longer memory of its inputs. */
  tauM: number;
  /** Resting potential, mV. */
  vRest: number;
  /** Spike threshold, mV. */
  vThreshold: number;
  /** Where it resets to after spiking, mV. */
  vReset: number;
  /** Dead time after a spike, ms. */
  refractoryMs: number;
  /** Synaptic current decay constant, ms. */
  tauSyn: number;
  /** Membrane resistance, MΩ — scales input current into voltage. */
  resistance: number;
};

export const DEFAULT_NEURON: NeuronParams = {
  tauM: 20,
  vRest: -65,
  vThreshold: -50,
  vReset: -70,
  refractoryMs: 2,
  tauSyn: 5,
  resistance: 10,
};

/** One synapse, before the network is compiled into sparse arrays. */
export type Synapse = {
  from: number;
  to: number;
  /**
   * Positive excites, negative inhibits. A connectome gives you the wire and
   * often a predicted neurotransmitter; the number here is still a modelling
   * choice, and pretending otherwise is the central dishonesty in this area.
   */
  weight: number;
  /** Axonal delay, ms. Rounded to the integration step. */
  delayMs?: number;
};

export type NetworkSpec = {
  neuronCount: number;
  synapses: Synapse[];
  /** Per-neuron overrides, sparse. */
  params?: Map<number, Partial<NeuronParams>>;
  defaults?: Partial<NeuronParams>;
  /** Integration step, ms. 0.5–1 ms is the usual range. */
  stepMs?: number;
  seed?: number;
  /** Optional names, for readable probes and debugging. */
  labels?: string[];
};

export type StepStats = {
  /** Neurons that spiked this step. */
  spikes: Int32Array;
  spikeCount: number;
  timeMs: number;
};

export class SpikingNetwork {
  readonly neuronCount: number;
  readonly stepMs: number;
  readonly labels: string[];

  /** Membrane potential, mV. */
  readonly v: Float32Array;
  /** Synaptic current, arbitrary units. */
  readonly current: Float32Array;
  /** External drive injected by sensors this step. */
  readonly drive: Float32Array;

  timeMs = 0;

  // Compressed sparse row over *presynaptic* neurons: row i lists the synapses
  // leaving neuron i, so a spike is one contiguous scan.
  private readonly rowStart: Int32Array;
  private readonly target: Int32Array;
  private readonly weight: Float32Array;
  private readonly delaySteps: Int16Array;

  private readonly refractoryUntil: Float32Array;
  private readonly tauM: Float32Array;
  private readonly vRest: Float32Array;
  private readonly vThreshold: Float32Array;
  private readonly vReset: Float32Array;
  private readonly refractoryMs: Float32Array;
  private readonly resistance: Float32Array;
  private readonly decaySyn: number;

  /** Ring buffer of pending synaptic input, indexed [step][neuron]. */
  private readonly pending: Float32Array;
  private readonly maxDelaySteps: number;
  private ring = 0;

  private readonly spikeBuffer: Int32Array;
  private readonly rng: () => number;

  /** Rolling spike counts, for rate readout without storing every spike. */
  private readonly spikeCount: Int32Array;

  constructor(spec: NetworkSpec) {
    this.neuronCount = spec.neuronCount;
    this.stepMs = spec.stepMs ?? 1;
    this.labels = spec.labels ?? [];
    this.rng = makeRng(spec.seed ?? 7);

    const defaults = { ...DEFAULT_NEURON, ...spec.defaults };

    this.v = new Float32Array(this.neuronCount);
    this.current = new Float32Array(this.neuronCount);
    this.drive = new Float32Array(this.neuronCount);
    this.refractoryUntil = new Float32Array(this.neuronCount);
    this.spikeBuffer = new Int32Array(this.neuronCount);
    this.spikeCount = new Int32Array(this.neuronCount);

    this.tauM = new Float32Array(this.neuronCount);
    this.vRest = new Float32Array(this.neuronCount);
    this.vThreshold = new Float32Array(this.neuronCount);
    this.vReset = new Float32Array(this.neuronCount);
    this.refractoryMs = new Float32Array(this.neuronCount);
    this.resistance = new Float32Array(this.neuronCount);

    for (let i = 0; i < this.neuronCount; i += 1) {
      const p = { ...defaults, ...(spec.params?.get(i) ?? {}) };
      this.tauM[i] = p.tauM;
      this.vRest[i] = p.vRest;
      this.vThreshold[i] = p.vThreshold;
      this.vReset[i] = p.vReset;
      this.refractoryMs[i] = p.refractoryMs;
      this.resistance[i] = p.resistance;
      this.v[i] = p.vRest;
    }
    this.decaySyn = Math.exp(-this.stepMs / defaults.tauSyn);

    // Compile the synapse list into CSR, sorted by presynaptic neuron.
    const sorted = [...spec.synapses].sort((a, b) => a.from - b.from || a.to - b.to);
    this.rowStart = new Int32Array(this.neuronCount + 1);
    this.target = new Int32Array(sorted.length);
    this.weight = new Float32Array(sorted.length);
    this.delaySteps = new Int16Array(sorted.length);

    let maxDelay = 1;
    let cursor = 0;
    for (let neuron = 0; neuron < this.neuronCount; neuron += 1) {
      this.rowStart[neuron] = cursor;
      while (cursor < sorted.length && sorted[cursor].from === neuron) {
        const synapse = sorted[cursor];
        this.target[cursor] = synapse.to;
        this.weight[cursor] = synapse.weight;
        const steps = Math.max(1, Math.round((synapse.delayMs ?? this.stepMs) / this.stepMs));
        this.delaySteps[cursor] = steps;
        if (steps > maxDelay) maxDelay = steps;
        cursor += 1;
      }
    }
    this.rowStart[this.neuronCount] = cursor;

    this.maxDelaySteps = maxDelay + 1;
    this.pending = new Float32Array(this.maxDelaySteps * this.neuronCount);
  }

  get synapseCount(): number {
    return this.target.length;
  }

  /**
   * Deliver a synaptic event to one neuron on the next step.
   *
   * This is an *event*, not a current: it lands in the synaptic filter and
   * decays with tauSyn. Injecting the same amount every step therefore settles
   * at amount/(1 − decay), which is much larger than the amount — use
   * `sustain()` when you mean a steady current.
   */
  inject(neuron: number, amount: number): void {
    if (neuron >= 0 && neuron < this.neuronCount) this.drive[neuron] += amount;
  }

  /**
   * Hold a neuron at a given synaptic current, accounting for the filter decay.
   * This is the one to use for sensory drive, where the input is a level rather
   * than a stream of events.
   */
  sustain(neuron: number, current: number): void {
    this.inject(neuron, current * (1 - this.decaySyn));
  }

  sustainAll(neurons: readonly number[], current: number): void {
    for (const neuron of neurons) this.sustain(neuron, current);
  }

  /** The steady-state membrane voltage a sustained current would produce. */
  steadyStateVoltage(neuron: number, current: number): number {
    return this.vRest[neuron] + this.resistance[neuron] * current;
  }

  /** The smallest sustained current that makes a neuron fire at all. */
  rheobase(neuron: number): number {
    return (this.vThreshold[neuron] - this.vRest[neuron]) / this.resistance[neuron];
  }

  /** Inject into a whole population at once. */
  injectAll(neurons: readonly number[], amount: number): void {
    for (const neuron of neurons) this.inject(neuron, amount);
  }

  /**
   * One integration step.
   *
   * Exponential Euler on the membrane, which is exact for the leak term and so
   * stays stable at step sizes where forward Euler would ring.
   */
  step(noise = 0): StepStats {
    const slot = this.ring * this.neuronCount;
    let spikeCount = 0;

    for (let i = 0; i < this.neuronCount; i += 1) {
      // Synaptic current: decays, then takes this step's arrivals and drive.
      this.current[i] = this.current[i] * this.decaySyn + this.pending[slot + i] + this.drive[i];
      this.pending[slot + i] = 0;
      this.drive[i] = 0;

      if (this.timeMs < this.refractoryUntil[i]) {
        this.v[i] = this.vReset[i];
        continue;
      }

      const target = this.vRest[i] + this.resistance[i] * this.current[i];
      const decay = Math.exp(-this.stepMs / this.tauM[i]);
      let next = target + (this.v[i] - target) * decay;
      if (noise > 0) next += (this.rng() - 0.5) * noise;

      if (next >= this.vThreshold[i]) {
        this.v[i] = this.vReset[i];
        this.refractoryUntil[i] = this.timeMs + this.refractoryMs[i];
        this.spikeBuffer[spikeCount] = i;
        spikeCount += 1;
        this.spikeCount[i] += 1;
      } else {
        this.v[i] = next;
      }
    }

    // Deliver: only the rows of neurons that actually spiked are touched.
    for (let s = 0; s < spikeCount; s += 1) {
      const neuron = this.spikeBuffer[s];
      const end = this.rowStart[neuron + 1];
      for (let k = this.rowStart[neuron]; k < end; k += 1) {
        const arrival = (this.ring + this.delaySteps[k]) % this.maxDelaySteps;
        this.pending[arrival * this.neuronCount + this.target[k]] += this.weight[k];
      }
    }

    this.ring = (this.ring + 1) % this.maxDelaySteps;
    this.timeMs += this.stepMs;

    return {
      spikes: this.spikeBuffer.subarray(0, spikeCount),
      spikeCount,
      timeMs: this.timeMs,
    };
  }

  /** Run for a stretch of simulated time, returning every spike time. */
  run(durationMs: number, noise = 0): Array<{ neuron: number; timeMs: number }> {
    const spikes: Array<{ neuron: number; timeMs: number }> = [];
    const steps = Math.round(durationMs / this.stepMs);
    for (let s = 0; s < steps; s += 1) {
      const result = this.step(noise);
      for (let i = 0; i < result.spikeCount; i += 1) {
        spikes.push({ neuron: result.spikes[i], timeMs: result.timeMs });
      }
    }
    return spikes;
  }

  /** Spikes per second for one neuron since the last reset. */
  rate(neuron: number, overMs: number): number {
    return overMs > 0 ? (this.spikeCount[neuron] * 1000) / overMs : 0;
  }

  /** Mean firing rate of a population, spikes per second. */
  populationRate(neurons: readonly number[], overMs: number): number {
    if (neurons.length === 0 || overMs <= 0) return 0;
    let total = 0;
    for (const neuron of neurons) total += this.spikeCount[neuron];
    return (total * 1000) / (overMs * neurons.length);
  }

  resetCounts(): void {
    this.spikeCount.fill(0);
  }

  /** Back to rest, keeping the wiring. */
  reset(): void {
    this.v.set(this.vRest);
    this.current.fill(0);
    this.drive.fill(0);
    this.refractoryUntil.fill(0);
    this.pending.fill(0);
    this.spikeCount.fill(0);
    this.timeMs = 0;
    this.ring = 0;
  }
}

/** Fully connect two populations with a fixed weight. */
export function connect(
  from: readonly number[],
  to: readonly number[],
  weight: number,
  delayMs?: number,
): Synapse[] {
  const synapses: Synapse[] = [];
  for (const source of from) {
    for (const sink of to) {
      if (source === sink) continue;
      synapses.push({ from: source, to: sink, weight, delayMs });
    }
  }
  return synapses;
}

/** Connect two populations with a given probability, deterministically. */
export function connectRandom(
  from: readonly number[],
  to: readonly number[],
  probability: number,
  weight: number,
  seed = 11,
  delayMs?: number,
): Synapse[] {
  const rng = makeRng(seed);
  const synapses: Synapse[] = [];
  for (const source of from) {
    for (const sink of to) {
      if (source === sink) continue;
      if (rng() < probability) synapses.push({ from: source, to: sink, weight, delayMs });
    }
  }
  return synapses;
}

/** A contiguous block of neuron indices — the usual way populations are built. */
export function population(start: number, size: number): number[] {
  return Array.from({ length: size }, (_, i) => start + i);
}
