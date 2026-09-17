// The fly's escape reflex, wired the way the fly is wired.
//
// A looming object — something growing in the visual field because it is
// heading at you — triggers one of the best-studied circuits in neuroscience:
//
//   LC4, LPLC2  →  DNp01 (the Giant Fibre)  →  GFC2, PSI  →  TTMn, DLM
//   visual          one decision cell          relays        jump and wing muscle
//
// Two visual projection populations measure different things about the looming
// object. LC4 encodes how fast it is growing; LPLC2 encodes how big it is. They
// converge on a single cell per hemisphere, and when that cell fires, the fly
// leaves.
//
// This is worth borrowing for a robot for a reason that is not sentimental. The
// circuit's two input variables are angular size θ and expansion rate dθ/dt. A
// fly has to estimate both from optic flow across a compound eye. A robot with
// a lidar gets range directly, so θ = 2·atan(r/d) falls out immediately and
// dθ/dt is a difference between two scans. The robot computes the exact
// quantities the real neurons encode, more directly than the fly does.
//
// ── What is measured here and what is modelled ─────────────────────────────
//
// MEASURED, from the MaleCNS v1.0 connectome (Berg et al., Cell 2026; data
// CC-BY 4.0, released 8 June 2026):
//   · which cell types connect to which
//   · how many cells there are of each type
//   · how many synaptic contacts each type→type connection has
//
// MODELLED — every number below that is not one of those three:
//   · all weights. A synapse count says two populations are strongly coupled.
//     It does not say by how many millivolts. One global scale converts counts
//     to weights and it is fitted here, not measured.
//   · all time constants and thresholds. Under 1% of fly cell types have been
//     characterised physiologically. Everything here is the LIF default.
//   · the sparsity of each projection. Type→type totals were measured; which
//     individual cell contacts which individual cell was not available, so the
//     total is spread across a seeded projection that preserves it.
//   · the tuning curves (a_v, a_s, θ₀, σ). These have the shape published by
//     Ache et al. 2019 and the values fitted here.
//
// PREDICTED, not measured — the excitatory/inhibitory signs. They come from a
// transmitter classifier applied to electron micrographs. Its accuracy is about
// 90% at the cell-type level, and per-cell confidence varies a great deal: in
// this arc the Giant Fibre itself is listed at confidence 0.50, which is a coin
// flip on the single most important cell in the circuit.
//
// ── Three things this is not ───────────────────────────────────────────────
//
// 1. This is the VISUAL escape pathway. LC4 and LPLC2 are about 99% of the
//    Giant Fibre's *visual* input and only about 31% of its input overall. The
//    real cell also hears — Johnston's organ projects onto it — and receives
//    substantial inhibition this model does not include.
// 2. Synapse counts are not physical ground truth. Automated detection on the
//    same brain has produced counts around 3× lower than manual tracing.
// 3. The fly is not in here. What is in here is the fly's wiring diagram, a
//    neuron model that is wrong for most of the fly's brain, and five constants
//    that were fitted to make it behave.

import type { ConnectomeData, ConnectomeEdge, ConnectomeNeuron } from "../connectome.ts";

export type Side = "L" | "R";

/**
 * Cell counts per type, both hemispheres, measured in MaleCNS v1.0.
 * They sum to 367, which is the whole arc from eye to jump muscle.
 */
export const ESCAPE_CELL_COUNTS: Record<string, number> = {
  // Visual projection neurons — the two feature channels.
  LC4: 126, // angular velocity
  LPLC2: 185, // angular size
  // Descending neurons.
  DNp01: 2, // the Giant Fibre itself: one per hemisphere
  DNp11: 2,
  DNp70: 2,
  // Feed-forward inhibition onto the Giant Fibre.
  PVLP010: 2,
  // Giant Fibre coupled relays.
  GFC1: 3,
  GFC2: 10,
  GFC3: 13,
  GFC4: 8,
  PSI: 2, // peripherally synapsing interneuron
  // Motor neurons.
  TTMn: 2, // tergotrochanteral — the jump muscle
  "DLMn/a": 2,
  "DLM1-4": 8, // wing depressors
};

/**
 * Transmitter per type, from the connectome's predictions.
 *
 * Note PVLP010: glutamate. In the fly, glutamate acting on GluClα is commonly
 * *inhibitory* — the opposite of the vertebrate default. Getting this one sign
 * backwards turns the circuit's only feed-forward brake into an accelerator.
 */
export const ESCAPE_TRANSMITTERS: Record<string, ConnectomeNeuron["transmitter"]> = {
  LC4: "acetylcholine",
  LPLC2: "acetylcholine",
  DNp01: "acetylcholine",
  DNp11: "acetylcholine",
  DNp70: "acetylcholine",
  PVLP010: "glutamate",
  GFC1: "acetylcholine",
  GFC2: "acetylcholine",
  GFC3: "acetylcholine",
  GFC4: "acetylcholine",
  PSI: "acetylcholine",
  TTMn: "acetylcholine",
  "DLMn/a": "acetylcholine",
  "DLM1-4": "acetylcholine",
};

export type TypeEdge = {
  from: string;
  to: string;
  /** Total synaptic contacts between the two populations. Measured. */
  synapses: number;
  /**
   * Whether the projection crosses the midline. Almost none of this circuit
   * does — an object looming on the left is a left-side problem — except the
   * descending neurons, which couple bilaterally so the two sides can disagree
   * about which way to go and settle it.
   */
  crossing?: boolean;
};

/**
 * Type→type synapse totals, measured in MaleCNS v1.0.
 *
 * The largest single term in the whole arc is LPLC2→LPLC2, the lateral coupling
 * inside the optic glomerulus. It is tempting to drop it as "just recurrence"
 * and it is the term that keeps the population response from saturating.
 */
export const ESCAPE_EDGES: TypeEdge[] = [
  // Stage 1 — parallel feature extraction with lateral coupling.
  { from: "LPLC2", to: "LPLC2", synapses: 24355 },
  { from: "LC4", to: "LC4", synapses: 9814 },
  { from: "LPLC2", to: "LC4", synapses: 953 },

  // Stage 2 — convergence onto one decision cell per side.
  { from: "LC4", to: "DNp01", synapses: 6362 },
  { from: "LPLC2", to: "DNp01", synapses: 4836 },
  { from: "LC4", to: "DNp11", synapses: 3632 },
  { from: "DNp70", to: "DNp01", synapses: 1416 },
  // The brake: glutamatergic, and therefore inhibitory here.
  { from: "LC4", to: "PVLP010", synapses: 2127 },
  { from: "PVLP010", to: "DNp01", synapses: 711 },
  // Bilateral coupling between the descending neurons.
  { from: "DNp01", to: "DNp11", synapses: 107, crossing: true },

  // Stage 3 — fan-out to the motor neurons.
  { from: "DNp01", to: "GFC2", synapses: 133 },
  { from: "DNp01", to: "GFC4", synapses: 99 },
  { from: "DNp01", to: "GFC3", synapses: 75 },
  { from: "DNp01", to: "TTMn", synapses: 90 },
  { from: "GFC2", to: "GFC2", synapses: 1015 },
  { from: "GFC2", to: "TTMn", synapses: 471 },
  { from: "GFC2", to: "DLM1-4", synapses: 438 },
  { from: "GFC2", to: "DLMn/a", synapses: 322 },
  { from: "GFC3", to: "PSI", synapses: 88 },
  { from: "PSI", to: "DLM1-4", synapses: 406 },
];

/**
 * How much of a projection is realised as individual connections.
 *
 * Measured data gives the type→type total; it does not say which cell contacts
 * which. Converging onto a two-cell population, every source really does reach
 * both, so that is wired fully. A large population coupling to itself does not,
 * so it gets a seeded sparse projection. Either way the measured total is
 * preserved and spread across whatever pairs exist — the sparsity is a modelling
 * choice and the synapse count is not.
 */
const DENSE_TARGET_LIMIT = 4;
const SPARSE_DENSITY = 0.25;

/**
 * Expand the measured type-level graph into individual cells, split by side.
 *
 * Odd cell counts put the extra cell on the left; for the types where the count
 * is odd (GFC1, GFC3) this is arbitrary and does not matter, since neither is
 * on the direction-deciding path.
 */
export function buildEscapeConnectome(seed = 20260608): ConnectomeData {
  const neurons: ConnectomeNeuron[] = [];
  const bySideType = new Map<string, string[]>();

  const key = (type: string, side: Side) => `${type}@${side}`;

  for (const [type, total] of Object.entries(ESCAPE_CELL_COUNTS)) {
    const left = Math.ceil(total / 2);
    const right = total - left;
    for (const [side, count] of [["L", left], ["R", right]] as Array<[Side, number]>) {
      const ids: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const id = `${type}_${side}${i}`;
        ids.push(id);
        neurons.push({ id, type, region: side, transmitter: ESCAPE_TRANSMITTERS[type] });
      }
      bySideType.set(key(type, side), ids);
    }
  }

  const random = mulberry32(seed);
  const edges: ConnectomeEdge[] = [];

  for (const edge of ESCAPE_EDGES) {
    for (const side of ["L", "R"] as Side[]) {
      const targetSide: Side = edge.crossing ? (side === "L" ? "R" : "L") : side;
      const pre = bySideType.get(key(edge.from, side)) ?? [];
      const post = bySideType.get(key(edge.to, targetSide)) ?? [];
      if (pre.length === 0 || post.length === 0) continue;

      // Each side carries half the measured bilateral total.
      const budget = edge.synapses / 2;
      const dense = post.length <= DENSE_TARGET_LIMIT;

      const pairs: Array<[string, string]> = [];
      for (const from of pre) {
        const targets = post.filter((to) => to !== from); // no autapses
        if (targets.length === 0) continue;

        const chosen = dense
          ? targets
          : targets.filter(() => random() <= SPARSE_DENSITY);

        // A thinned projection out of a small population can come up empty, and
        // an empty projection silently deletes a measured connection — which is
        // how the route from the Giant Fibre to the motor neurons lost half its
        // strength the first time this ran. Every source keeps at least one
        // target.
        if (chosen.length === 0) chosen.push(targets[Math.floor(random() * targets.length)]);

        for (const to of chosen) pairs.push([from, to]);
      }
      if (pairs.length === 0) continue;

      // Preserve the measured total exactly by spreading it over the pairs that
      // exist, rather than preserving a per-pair figure nobody measured.
      const perPair = budget / pairs.length;
      for (const [from, to] of pairs) edges.push({ from, to, synapses: perPair });
    }
  }

  return {
    name: "Drosophila giant-fibre escape pathway (visual)",
    source:
      "MaleCNS v1.0 (Berg et al., Cell 2026), cell counts and type-to-type synapse totals. " +
      "Individual cell-to-cell edges were not used: the measured quantity is the type-to-type " +
      "total, and it is preserved here across a seeded projection.",
    licence: "CC-BY 4.0",
    neurons,
    edges,
  };
}

// ── The dynamics ───────────────────────────────────────────────────────────

/**
 * Drive to the two visual populations, from Ache et al. 2019.
 *
 * Their result is that the Giant Fibre's response is reproduced by summing a
 * *linear* function of angular velocity with a *Gaussian* function of angular
 * size. LC4 supplies the first term and LPLC2 supplies the second — LPLC2
 * provides the entire size component.
 *
 * The shapes are theirs. The five constants are fitted here.
 */
export type LoomingTuning = {
  /** Gain on angular velocity into LC4, current per rad/s. */
  velocityGain: number;
  /** Peak gain on angular size into LPLC2. */
  sizeGain: number;
  /**
   * Angular size at which the LPLC2 drive peaks, radians. Published thresholds
   * for takeoff sit between about 39° and 67° depending on the pathway; this is
   * in that range and is fitted, not taken from any one of them.
   */
  sizePeak: number;
  /** Width of the size tuning, radians. */
  sizeWidth: number;
  /** One global scale from synapse counts to weights. The only free weight. */
  weightScale: number;
  /**
   * How much earlier than a fly this circuit commits.
   *
   * At 1, the thresholds reproduce the animal: the Giant Fibre fires when the
   * object subtends roughly 39°-67°, which is what the published takeoff data
   * shows. That is the right answer for a fly, which clears the ground in about
   * five milliseconds.
   *
   * It is the wrong answer for a robot. Measured here, a faithful circuit fires
   * at about 0.5 m from a person walking in at 1.5 m/s — which is already
   * contact distance for a machine that reverses at half a metre per second.
   * The fly's threshold encodes the fly's escape capability, and copying the
   * threshold without the capability copies the wrong half.
   *
   * So the default is above 1, and everything above 1 is a departure from the
   * animal rather than a property of it.
   */
  sensitivity: number;
};

export const DEFAULT_TUNING: LoomingTuning = {
  velocityGain: 9.0,
  sizeGain: 6.0,
  sizePeak: 0.79, // ~45°
  sizeWidth: 0.3,
  weightScale: 1,
  sensitivity: 4,
};

/** The tuning that reproduces the animal's own thresholds. */
export const FLY_FAITHFUL_TUNING: LoomingTuning = { ...DEFAULT_TUNING, sensitivity: 1 };

/** What one hemifield currently sees. */
export type LoomingStimulus = {
  /** Angular size of the approaching object, radians. */
  theta: number;
  /** Rate of change of angular size, rad/s. */
  dTheta: number;
};

/** Angular size of an object of radius `r` at range `d`. */
export function angularSize(radius: number, range: number): number {
  if (range <= 0) return Math.PI;
  return 2 * Math.atan(radius / range);
}

/**
 * Time to contact, in the form the circuit is thought to use it: θ divided by
 * its own rate of change. It needs no estimate of absolute size or speed, which
 * is why it survives having no idea how big the thing is.
 */
export function timeToContact(stimulus: LoomingStimulus): number {
  if (stimulus.dTheta <= 1e-6) return Number.POSITIVE_INFINITY;
  return stimulus.theta / stimulus.dTheta;
}

/** Injected current for LC4 — linear in expansion rate. */
export function lc4Drive(stimulus: LoomingStimulus, tuning: LoomingTuning): number {
  return Math.max(0, tuning.sensitivity * tuning.velocityGain * stimulus.dTheta);
}

/** Injected current for LPLC2 — Gaussian in angular size. */
export function lplc2Drive(stimulus: LoomingStimulus, tuning: LoomingTuning): number {
  const offset = stimulus.theta - tuning.sizePeak;
  return (
    tuning.sensitivity *
    tuning.sizeGain *
    Math.exp(-(offset * offset) / (2 * tuning.sizeWidth * tuning.sizeWidth))
  );
}

/** Deterministic PRNG, so a circuit is the same circuit every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── A runnable circuit ─────────────────────────────────────────────────────

import { buildNetwork, compileConnectome, type CompiledConnectome } from "../connectome.ts";
import type { SpikingNetwork } from "../network.ts";

export type EscapeOptions = {
  tuning?: Partial<LoomingTuning>;
  /**
   * Integration step, ms. The circuit is small enough that 0.5 ms costs almost
   * nothing and keeps the 2.2 ms refractory period meaningful.
   */
  stepMs?: number;
  seed?: number;
};

/**
 * How many milliseconds an escape stays latched once the Giant Fibre fires.
 * A reflex that re-triggers every step is a stutter, not a reflex.
 */
export const ESCAPE_LATCH_MS = 400;

/**
 * Fitted constants. Both were found by running the circuit, not taken from any
 * measurement of a fly.
 *
 * `SENSORY_SCALE` converts measured synapse counts into weights. It is the one
 * free parameter in the sensory pathway, chosen so the Giant Fibre fires within
 * the published angular-size range for takeoff (about 39° to 67°) across
 * ordinary approach speeds.
 *
 * `MOTOR_GAIN` scales the stage below the Giant Fibre so that one Giant Fibre
 * spike reliably drives the jump motor neuron. That behaviour is real — the
 * giant-fibre synapse is a mixed electrical and chemical synapse and is among
 * the most reliable known — but this number is a fit to reproduce it, not a
 * measurement of it.
 */
export const SENSORY_SCALE = 0.005;
export const MOTOR_GAIN = 800;

const MOTOR_TYPES = new Set(["GFC2", "GFC3", "GFC4", "PSI", "TTMn", "DLMn/a", "DLM1-4"]);

export type EscapeVerdict = {
  /** True on the step the Giant Fibre fires. */
  triggered: boolean;
  /** Which side the threat is on, when one fired. */
  side: Side | null;
  /** Giant Fibre spikes this step, per side. */
  giantFibre: { L: number; R: number };
  /** Jump-motor spikes this step, per side. */
  motor: { L: number; R: number };
  /** Simulated time, ms. */
  timeMs: number;
};

/**
 * The escape pathway, wired from the connectome and driven by whatever the
 * robot can see.
 *
 * It is deliberately not given the robot. It takes angular size and expansion
 * rate per hemifield and returns whether the Giant Fibre fired. What to do
 * about that is a decision for something that knows about wheels and about the
 * safety governor.
 */
export class EscapeCircuit {
  readonly network: SpikingNetwork;
  readonly compiled: CompiledConnectome;
  readonly tuning: LoomingTuning;
  readonly stepMs: number;

  private readonly lc4: Record<Side, number[]>;
  private readonly lplc2: Record<Side, number[]>;
  private readonly giantFibre: Record<Side, Set<number>>;
  private readonly jumpMotor: Record<Side, Set<number>>;
  private elapsedMs = 0;

  constructor(options: EscapeOptions = {}) {
    this.tuning = { ...DEFAULT_TUNING, ...options.tuning };
    this.stepMs = options.stepMs ?? 0.5;

    const data = buildEscapeConnectome(options.seed);
    const compiled = compileConnectome(data, {
      weights: {
        // No minimum. The usual filter drops connections of one or two contacts
        // because, in raw per-cell data, those are mostly detection noise. These
        // numbers are not that: each one is a fraction of a measured type-level
        // total, so a small value means a wide projection, not a doubtful one.
        // Applying the filter here deleted the whole LPLC2 to LC4 projection,
        // whose per-pair share works out at about a third of a contact.
        minSynapses: 0,
        perSynapse: 0.06 * this.tuning.weightScale * SENSORY_SCALE,
        maxWeight: 6 * this.tuning.weightScale * SENSORY_SCALE,
      },
      stepMs: this.stepMs,
      seed: options.seed,
    });

    const motorIndices = new Set<number>();
    for (const type of MOTOR_TYPES) {
      for (const i of compiled.byType.get(type) ?? []) motorIndices.add(i);
    }
    for (const synapse of compiled.spec.synapses) {
      if (motorIndices.has(synapse.to)) synapse.weight *= MOTOR_GAIN;
    }

    this.compiled = compiled;
    this.network = buildNetwork(compiled);

    // Cell ids end `_L3` / `_R12`, so the side is the letter before the index.
    const bySide = (type: string, side: Side) => {
      const pattern = new RegExp(`_${side}\\d+$`);
      return (compiled.byType.get(type) ?? []).filter((i) =>
        pattern.test(compiled.spec.labels?.[i] ?? ""),
      );
    };

    this.lc4 = { L: bySide("LC4", "L"), R: bySide("LC4", "R") };
    this.lplc2 = { L: bySide("LPLC2", "L"), R: bySide("LPLC2", "R") };
    this.giantFibre = {
      L: new Set(bySide("DNp01", "L")),
      R: new Set(bySide("DNp01", "R")),
    };
    this.jumpMotor = {
      L: new Set(bySide("TTMn", "L")),
      R: new Set(bySide("TTMn", "R")),
    };
  }

  /**
   * Advance the circuit by `durationMs` with the given view of the world.
   *
   * The two hemifields are independent, which is what makes the reflex
   * directional: the side whose Giant Fibre fires first is the side the threat
   * is on, and the robot goes the other way.
   */
  advance(
    durationMs: number,
    stimulus: { L: LoomingStimulus; R: LoomingStimulus },
  ): EscapeVerdict {
    const steps = Math.max(1, Math.round(durationMs / this.stepMs));
    this.elapsedMs += steps * this.stepMs;
    const counts = { L: 0, R: 0 };
    const motor = { L: 0, R: 0 };

    for (let i = 0; i < steps; i += 1) {
      for (const side of ["L", "R"] as Side[]) {
        this.network.sustainAll(this.lc4[side], lc4Drive(stimulus[side], this.tuning));
        this.network.sustainAll(this.lplc2[side], lplc2Drive(stimulus[side], this.tuning));
      }
      const stats = this.network.step();
      for (let k = 0; k < stats.spikeCount; k += 1) {
        const n = stats.spikes[k];
        if (this.giantFibre.L.has(n)) counts.L += 1;
        else if (this.giantFibre.R.has(n)) counts.R += 1;
        if (this.jumpMotor.L.has(n)) motor.L += 1;
        else if (this.jumpMotor.R.has(n)) motor.R += 1;
      }
    }

    const triggered = counts.L > 0 || counts.R > 0;
    const side: Side | null = !triggered ? null : counts.L >= counts.R ? "L" : "R";

    return {
      triggered,
      side,
      giantFibre: counts,
      motor,
      timeMs: this.elapsedMs,
    };
  }

  /** Cell counts per type, so a caller can report what it is actually running. */
  census(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [type, ids] of this.compiled.byType) out[type] = ids.length;
    return out;
  }
}
