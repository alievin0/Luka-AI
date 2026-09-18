// The fly's compass — wired correctly, and it does not work.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ READ THIS BEFORE USING ANY OF IT                                        │
// │                                                                         │
// │ This circuit is built from real measured connectome data and it does    │
// │ NOT produce a heading. There is no ability registered on top of it,     │
// │ because there is nothing here that works well enough to register.       │
// │                                                                         │
// │ What it does: holds a bump while something external drives one, and     │
// │ reads that bump out correctly (strength 0.95, bearing within 3°).       │
// │ The shifters are wired right — driving one hemisphere makes it fire at  │
// │ 47 Hz while the other sits at 8 Hz, which is the asymmetry that would   │
// │ rotate a bump.                                                          │
// │                                                                         │
// │ What it does not do: hold a bump on its own. Take the drive away and    │
// │ the ring either goes silent, if the background current is below         │
// │ rheobase, or fires almost uniformly if it is above. Swept across        │
// │ weight scale 0.6 to 12, background 1.2 to 1.45 and shifter thresholds   │
// │ -50 to -44 mV, no combination held a localised bump. So the rotation    │
// │ mechanism has nothing to rotate.                                        │
// │                                                                         │
// │ An earlier version of this file appeared to work — strength 0.86, a     │
// │ clean bump. It was an artifact. Cells were dealt into wedges from       │
// │ wedge zero, which left the remainder piled on the low wedges, and the   │
// │ activity simply pooled where the cells were. Spreading the cells        │
// │ evenly around the ring made the bump disappear, which is how you can    │
// │ tell it was never attractor dynamics. The firing profile still traces   │
// │ the cell count per wedge almost exactly.                                │
// │                                                                         │
// │ This is kept rather than deleted because the negative result is the     │
// │ useful part, and because the wiring, the provenance and the readout     │
// │ are correct and reusable by anyone who wants to fit the parameters      │
// │ properly. See the note at the end of this header.                       │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Deep in the centre of the insect brain there is a ring of cells that holds a
// single bump of activity, and the position of that bump around the ring is the
// animal's heading. Turn the fly, and the bump rotates by the same amount. Put
// it in the dark, and the bump keeps turning with it — dead reckoning. Show it a
// landmark, and the bump snaps to a bearing relative to that landmark.
//
// This is a ring attractor, and it is the best-understood piece of neural
// machinery that does something a robot actually needs:
//
//   EPG      the ring itself — 16 wedges, one bump, and the bump is the heading
//   PEN      shifters — they read the ring and write back one wedge over, so
//            driving the left ones rotates the bump left
//   Δ7       global inhibition — the reason there is one bump and not five
//   ER       landmark input — inhibits the ring where a remembered bearing says
//            the world is, pinning the estimate to something outside the robot
//   PFL3     the output — compares the bump against a goal and says turn
//
// ── Why bother, when a gyro exists ─────────────────────────────────────────
//
// Integrating a yaw rate is exact and it drifts, because the error integrates
// too. The usual fix is a filter that fuses the gyro with something absolute,
// and a ring attractor is that fix expressed as a circuit: the shifters
// integrate, the landmark input corrects, and the attractor dynamics mean small
// errors decay instead of accumulating. A bump that is slightly off is pulled
// back to the nearest stable position by the same recurrence that holds it up.
//
// What it gives this kernel that odometry did not: a heading that survives
// wheel slip, and a way to say "go back to where the door was" using the
// bearing the robot remembers rather than the coordinates it computed.
//
// ── Provenance, per edge ───────────────────────────────────────────────────
//
// This circuit is honest at a finer grain than the escape circuit, because it
// has to be. There, every connection was measured. Here some are measured and
// some are only described, and each edge says which:
//
//   "measured"  — the type-to-type synapse total was counted in FlyWire v783.
//   "described" — the connection is established anatomy, published and not in
//                 doubt, but the synapse total was not in the data available
//                 here. Its strength is a modelling choice.
//
// The ring topology itself is in the second category and is the most important
// thing in the file. The connectome's cell-type table names a cell EPG; it does
// not say which of the sixteen wedges that EPG is in. Without the wedge index
// there is no ±1 offset, and without the ±1 offset there is no ring attractor —
// just a blob. So the sixteen-wedge tiling and the shifters' one-wedge offset
// are taken from published anatomy and assigned here. The cell counts, the
// transmitters and most of the connection strengths are measured; the geometry
// that makes it a compass is not.
//
// ── Why it does not work, as far as this got ───────────────────────────────
//
// The connectome fixes the graph. It does not fix a single number that decides
// whether a ring attractor is an attractor: not one synaptic weight, not one
// membrane time constant, not one threshold. A ring attractor's stable regime
// is narrow — recurrent excitation strong enough to hold a bump alive, global
// inhibition strong enough to stop it spreading, and the two balanced against
// each other within a few per cent. Hand-sweeping three parameters does not
// find that regime, and there is no reason it should.
//
// This is the literature's own position, met in practice rather than read
// about. Every published result that gets function out of a connectome fixes
// the graph from data and then *optimises* everything else against a task —
// gradient descent over thousands of parameters, not a person trying values.
// The escape circuit in the neighbouring file worked because it is
// feed-forward: a threshold crossing needs one scale set correctly. A
// recurrent attractor needs a balance, and a balance has to be found, not
// guessed.
//
// What would plausibly fix it, for anyone continuing: fit the weights by
// gradient descent on a heading-tracking objective, in the manner of the
// connectome-constrained models that do work; or relax the point-neuron model,
// since the ring's cells are among those known to signal in ways a
// leaky-integrate-and-fire unit does not represent.

import type { ConnectomeData, ConnectomeEdge, ConnectomeNeuron } from "../connectome.ts";

/**
 * Wedges around the ring. Sixteen is the anatomical number for the ellipsoid
 * body, giving a resolution of 22.5° before interpolation.
 */
export const WEDGES = 16;

/**
 * Cell counts per type, measured in FlyWire v783.
 *
 * The four ER types are the ones that carry visual landmark bearing onto the
 * ring; there are more of them in the animal, and the rest are left out rather
 * than invented.
 */
export const COMPASS_CELL_COUNTS: Record<string, number> = {
  EPG: 47, // the ring — the bump's position is the heading
  PEN_a: 20, // shifters, subtype a
  PEN_b: 22, // shifters, subtype b
  PEG: 20, // recurrent sustain
  Delta7: 42, // global inhibition
  ER1: 29, // landmark bearing
  ER2: 43,
  ER3w: 25,
  ER4m: 11,
  PFL3: 24, // steering output
};

/**
 * Transmitters, from the connectome's predictions.
 *
 * Δ7 is glutamatergic, and in the fly glutamate acting on GluClα is inhibitory.
 * This matters more here than anywhere else in this kernel: Δ7 is the global
 * inhibition that makes the ring hold exactly one bump. Get its sign wrong and
 * the ring does not produce a wrong heading — it saturates, every wedge fires,
 * and the compass reports nothing at all.
 *
 * The ER neurons are GABAergic, which is why a landmark *suppresses* the ring
 * where it is seen rather than exciting it. The bump ends up sitting where the
 * landmark is not.
 */
export const COMPASS_TRANSMITTERS: Record<string, ConnectomeNeuron["transmitter"]> = {
  EPG: "acetylcholine",
  PEN_a: "acetylcholine",
  PEN_b: "acetylcholine",
  PEG: "acetylcholine",
  Delta7: "glutamate",
  ER1: "gaba",
  ER2: "gaba",
  ER3w: "gaba",
  ER4m: "gaba",
  PFL3: "acetylcholine",
};

export type Provenance = "measured" | "described";

export type CompassEdge = {
  from: string;
  to: string;
  /** Total synaptic contacts between the two populations. */
  synapses: number;
  provenance: Provenance;
  /**
   * How the projection maps wedge to wedge.
   *
   * `same` — wedge i to wedge i.
   * `shift+1` / `shift-1` — the offset that makes the ring rotate. This is the
   *   whole mechanism: a population that reads the bump and writes it back one
   *   wedge over will move the bump every time it is driven.
   * `neighbour` — wedge i to i-1 and i+1, local excitation that sharpens and
   *   sustains the bump.
   * `global` — every cell to every cell, regardless of wedge.
   * `opposite` — wedge i to wedge i+8, the 180° offset Δ7 is built with.
   */
  mapping: "same" | "shift+1" | "shift-1" | "neighbour" | "global" | "opposite";
  /** Why this edge is here, when that is not obvious. */
  note?: string;
};

/**
 * The circuit.
 *
 * Measured totals are from FlyWire v783. Where a connection is established
 * anatomy but its synapse total was not available here, it is marked
 * `described` and given a strength in the same range as its measured
 * neighbours — which is a guess with a reason, not a measurement.
 */
export const COMPASS_EDGES: CompassEdge[] = [
  // ── the ring holds itself up ──────────────────────────────────────────
  {
    from: "EPG",
    to: "EPG",
    synapses: 2364,
    provenance: "measured",
    mapping: "neighbour",
    note: "Local recurrent excitation. Without it the bump disperses.",
  },
  {
    from: "EPG",
    to: "PEG",
    synapses: 2932,
    provenance: "measured",
    mapping: "same",
  },
  {
    from: "PEG",
    to: "EPG",
    synapses: 2900,
    provenance: "described",
    mapping: "same",
    note: "The return leg of the sustain loop. Established anatomy; the total was not in the data here, so it is set near its measured outbound partner.",
  },

  // ── global inhibition: why there is one bump ──────────────────────────
  {
    from: "EPG",
    to: "Delta7",
    synapses: 2376,
    provenance: "measured",
    mapping: "same",
  },
  {
    from: "Delta7",
    to: "EPG",
    synapses: 2400,
    provenance: "described",
    mapping: "opposite",
    note: "Δ7 dendrites span the bridge almost uniformly and each cell outputs at two sites eight glomeruli apart, so its inhibition arrives roughly opposite where it was collected. That geometry is published; the synapse total here is not.",
  },

  // ── the shifters: this is what integrates turning ─────────────────────
  {
    from: "EPG",
    to: "PEN_a",
    synapses: 2626,
    provenance: "measured",
    mapping: "same",
  },
  {
    from: "EPG",
    to: "PEN_b",
    synapses: 3689,
    provenance: "measured",
    mapping: "same",
  },
  {
    from: "PEN_a",
    to: "EPG",
    synapses: 5160,
    provenance: "measured",
    mapping: "shift+1",
    note: "The offset is the mechanism. Left-hemisphere cells of this type write back one wedge in one direction; right-hemisphere cells write the other way. Which hemisphere goes which way is assigned here.",
  },
  {
    from: "PEN_b",
    to: "EPG",
    synapses: 4166,
    provenance: "measured",
    mapping: "shift+1",
  },
  {
    from: "PEN_b",
    to: "PEN_b",
    synapses: 3111,
    provenance: "measured",
    mapping: "same",
  },

  // ── landmarks pin the ring to the world ───────────────────────────────
  { from: "ER2", to: "EPG", synapses: 6624, provenance: "measured", mapping: "same" },
  { from: "ER4m", to: "EPG", synapses: 6593, provenance: "measured", mapping: "same" },
  { from: "ER3w", to: "EPG", synapses: 3332, provenance: "measured", mapping: "same" },
  { from: "ER1", to: "EPG", synapses: 2890, provenance: "measured", mapping: "same" },
  {
    from: "ER2",
    to: "ER2",
    synapses: 17292,
    provenance: "measured",
    mapping: "global",
    note: "Mutual inhibition among ring neurons — the single largest connection in the whole circuit. It makes the landmark channel competitive, so one bearing wins rather than all of them blurring.",
  },

  // ── output: turn towards the goal ─────────────────────────────────────
  {
    from: "EPG",
    to: "PFL3",
    synapses: 2300,
    provenance: "described",
    mapping: "same",
    note: "PFL3 is the steering population; its phase offset against the bump is what produces a left or right turn. The projection is published; this total is not measured.",
  },
];

/** Which hemisphere a cell belongs to, and therefore which way it shifts. */
export type Hemisphere = "L" | "R";

export type CompassCell = {
  id: string;
  type: string;
  wedge: number;
  side: Hemisphere;
};

/**
 * Lay the measured cell counts out around the ring.
 *
 * Cells are dealt round-robin into wedges, alternating hemispheres. The counts
 * are measured; this arrangement is not — the connectome names a cell EPG
 * without saying which wedge it sits in.
 */
export function layOutCompass(): CompassCell[] {
  const cells: CompassCell[] = [];
  for (const [type, count] of Object.entries(COMPASS_CELL_COUNTS)) {
    // Each hemisphere's cells are dealt around the whole ring independently.
    //
    // Doing this the obvious way — wedge from the index, side from its parity —
    // is wrong, and wrong in a way that looks fine until the compass is asked
    // to turn. With sixteen wedges, index parity and wedge parity are the same
    // thing, so every even wedge ends up holding only left-hemisphere cells and
    // every odd wedge only right. Driving the left shifters then moves the bump
    // until it lands on a wedge that has no left shifter in it, and there it
    // stops: measured, the bump jumped 54 degrees and pinned, whichever way the
    // robot turned.
    // Each side's cells are then spread evenly around the whole ring rather
    // than dealt from wedge zero. Dealing leaves the leftovers piled on the low
    // wedges — with 47 EPG cells the occupancy came out 4,4,4,4,4,4,4,3,2,2,...
    // and that lopsidedness is itself an attractor: the bump slid into the
    // densely populated arc and sat there, landing on the same bearing no
    // matter which way the robot turned.
    const half = Math.ceil(count / 2);
    for (let i = 0; i < count; i += 1) {
      const side: Hemisphere = i < half ? "L" : "R";
      const withinSide = side === "L" ? i : i - half;
      const groupSize = side === "L" ? half : count - half;
      cells.push({
        id: `${type}_${i}`,
        type,
        wedge: groupSize > 0 ? Math.round((withinSide * WEDGES) / groupSize) % WEDGES : 0,
        side,
      });
    }
  }
  return cells;
}

/** Build the connectome the spiking engine runs. */
export function buildCompassConnectome(): ConnectomeData {
  const cells = layOutCompass();
  const neurons: ConnectomeNeuron[] = cells.map((c) => ({
    id: c.id,
    type: c.type,
    region: c.side,
    transmitter: COMPASS_TRANSMITTERS[c.type],
  }));

  const byType = new Map<string, CompassCell[]>();
  for (const cell of cells) {
    const list = byType.get(cell.type) ?? [];
    list.push(cell);
    byType.set(cell.type, list);
  }

  const edges: ConnectomeEdge[] = [];

  for (const edge of COMPASS_EDGES) {
    const pre = byType.get(edge.from) ?? [];
    const post = byType.get(edge.to) ?? [];
    if (pre.length === 0 || post.length === 0) continue;

    const pairs: Array<[string, string]> = [];
    for (const from of pre) {
      for (const to of post) {
        if (from.id === to.id) continue;
        if (!wedgesConnect(edge, from, to)) continue;
        pairs.push([from.id, to.id]);
      }
    }
    if (pairs.length === 0) continue;

    // Spread the measured total across whatever pairs the mapping creates, so
    // the quantity that was counted is the quantity that survives.
    const perPair = edge.synapses / pairs.length;
    for (const [from, to] of pairs) edges.push({ from, to, synapses: perPair });
  }

  const measured = COMPASS_EDGES.filter((e) => e.provenance === "measured");
  return {
    name: "Drosophila central complex heading system",
    source:
      `FlyWire v783 cell counts and type-to-type synapse totals for ${measured.length} of ` +
      `${COMPASS_EDGES.length} connections. The remaining ${COMPASS_EDGES.length - measured.length} are ` +
      "published anatomy with modelled strengths, and the wedge geometry that makes this a ring " +
      "attractor is assigned here rather than read from the data.",
    licence: "CC-BY 4.0",
    neurons,
    edges,
  };
}

function wedgesConnect(edge: CompassEdge, from: CompassCell, to: CompassCell): boolean {
  const wrap = (w: number) => ((w % WEDGES) + WEDGES) % WEDGES;
  switch (edge.mapping) {
    case "global":
      return true;
    case "same":
      return from.wedge === to.wedge;
    case "neighbour":
      return to.wedge === wrap(from.wedge - 1) || to.wedge === wrap(from.wedge + 1);
    case "opposite":
      return to.wedge === wrap(from.wedge + WEDGES / 2);
    case "shift+1":
    case "shift-1": {
      // The hemisphere decides the direction. This is what makes turning one
      // way rotate the bump one way.
      const direction = from.side === "L" ? 1 : -1;
      return to.wedge === wrap(from.wedge + direction);
    }
  }
}

/** The compass bearing a wedge stands for, radians. */
export function wedgeBearing(wedge: number): number {
  return (2 * Math.PI * wedge) / WEDGES;
}

/**
 * Read a heading out of the ring.
 *
 * A population vector rather than the loudest wedge: the bump spans several
 * wedges, and its centre of mass is finer than the 22.5° the tiling would
 * otherwise limit it to. `strength` is how concentrated the bump is, 0 to 1 —
 * a dispersed ring is a compass that has lost track of itself, and a caller
 * should be able to tell.
 */
export function readBump(rates: number[]): { heading: number; strength: number } {
  let x = 0;
  let y = 0;
  let total = 0;
  for (let w = 0; w < rates.length; w += 1) {
    const bearing = wedgeBearing(w);
    x += rates[w] * Math.cos(bearing);
    y += rates[w] * Math.sin(bearing);
    total += rates[w];
  }
  if (total <= 0) return { heading: 0, strength: 0 };
  return {
    heading: Math.atan2(y, x),
    strength: Math.hypot(x, y) / total,
  };
}

/** Shortest signed difference between two angles, radians. */
export function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// ── A runnable compass ─────────────────────────────────────────────────────

import { buildNetwork, compileConnectome, type CompiledConnectome } from "../connectome.ts";
import type { SpikingNetwork } from "../network.ts";

export type CompassTuning = {
  /** Converts synapse counts to weights. The one global scale. */
  weightScale: number;
  /** Baseline drive to every EPG cell — what keeps a bump alive at rest. */
  tonicDrive: number;
  /** Drive to the shifters per rad/s of turning. */
  shiftGain: number;
  /** Drive to the ring neurons when a landmark is visible. */
  landmarkGain: number;
  /** Width of the landmark's influence around its bearing, radians. */
  landmarkWidth: number;
  /**
   * Spike threshold for the shifters, mV. Higher than the default makes them
   * conjunctive — needing the bump *and* a turn — at the cost of the support
   * their output gives the ring.
   */
  shifterThreshold: number;
};

export const DEFAULT_COMPASS_TUNING: CompassTuning = {
  // Found by sweeping, not chosen. Below about 0.5 the recurrence cannot hold a
  // bump alive once the drive that started it stops; above about 1.2 the
  // activity spreads and a second lobe appears on the far side of the ring.
  weightScale: 0.6,
  // Just under the rheobase of 1.5, so no cell fires on background alone and
  // the bump has to be held up by the ring's own recurrence.
  tonicDrive: 1.2,
  shiftGain: 2.5,
  landmarkGain: 3.0,
  landmarkWidth: 0.6,
  shifterThreshold: -44,
};

export type CompassReading = {
  /** Heading the ring is holding, radians. */
  heading: number;
  /** How concentrated the bump is, 0..1. Low means the compass is lost. */
  strength: number;
  /** Firing rate per wedge, for anyone who wants to see the bump. */
  wedges: number[];
  /** Turn command from the steering population, rad/s. */
  steer: number;
};

/**
 * The heading system, running.
 *
 * It is given a turn rate and, when one is visible, a landmark bearing. It is
 * not given the robot's pose — the whole point is that the heading comes out of
 * the circuit rather than being handed to it.
 */
export class CompassCircuit {
  readonly network: SpikingNetwork;
  readonly compiled: CompiledConnectome;
  readonly tuning: CompassTuning;
  readonly stepMs: number;

  private readonly epgByWedge: number[][];
  /** PEG carries the sustain loop, so it needs the same background drive. */
  private readonly peg: number[];
  private readonly shifters: Record<Hemisphere, number[]>;
  private readonly ringByWedge: number[][];
  private readonly steering: number[];
  private readonly window: number[][] = [];

  constructor(options: { tuning?: Partial<CompassTuning>; stepMs?: number; seed?: number } = {}) {
    this.tuning = { ...DEFAULT_COMPASS_TUNING, ...options.tuning };
    this.stepMs = options.stepMs ?? 0.5;

    const data = buildCompassConnectome();
    this.compiled = compileConnectome(data, {
      weights: {
        // As in the escape circuit: these per-pair counts are fractions of a
        // measured total, so a small one means a wide projection rather than a
        // doubtful detection.
        minSynapses: 0,
        perSynapse: 0.06 * this.tuning.weightScale,
        maxWeight: 6 * this.tuning.weightScale,
      },
      // The shifters have to be conjunctive: a PEN cell should fire when the
      // bump is in its wedge *and* the animal is turning its way, not on the
      // bump alone. Left at the default threshold they fire on ring input by
      // itself, so both hemispheres run at once, push the bump in opposite
      // directions, and it sits still however hard the robot turns — measured,
      // the idle hemisphere was firing at 97 Hz while being driven with zero.
      //
      // Raising their threshold is a cell property rather than a rewiring, so
      // the measured synapse counts stay untouched. It is still a modelled
      // number.
      typeParams: {
        PEN_a: { vThreshold: this.tuning.shifterThreshold },
        PEN_b: { vThreshold: this.tuning.shifterThreshold },
      },
      stepMs: this.stepMs,
      seed: options.seed,
    });
    this.network = buildNetwork(this.compiled);

    const cells = layOutCompass();
    const indexOf = new Map<string, number>();
    data.neurons.forEach((n, i) => indexOf.set(String(n.id), i));

    this.epgByWedge = Array.from({ length: WEDGES }, () => [] as number[]);
    this.ringByWedge = Array.from({ length: WEDGES }, () => [] as number[]);
    this.shifters = { L: [], R: [] };
    this.steering = [];
    this.peg = [];

    for (const cell of cells) {
      const index = indexOf.get(cell.id);
      if (index === undefined) continue;
      if (cell.type === "EPG") this.epgByWedge[cell.wedge].push(index);
      else if (cell.type === "PEN_a" || cell.type === "PEN_b") this.shifters[cell.side].push(index);
      else if (cell.type === "PEG") this.peg.push(index);
      else if (cell.type.startsWith("ER")) this.ringByWedge[cell.wedge].push(index);
      else if (cell.type === "PFL3") this.steering.push(index);
    }
  }

  /**
   * Advance the circuit.
   *
   * `turnRate` is the robot's own yaw rate in rad/s — the gyro signal the
   * shifters integrate. `landmark` is a bearing in the robot's own frame, or
   * null when nothing is visible, and it is what stops the integration from
   * drifting.
   */
  advance(
    durationMs: number,
    turnRate: number,
    landmark: number | null = null,
    goal: number | null = null,
  ): CompassReading {
    const steps = Math.max(1, Math.round(durationMs / this.stepMs));
    const counts = new Array<number>(WEDGES).fill(0);
    let steerSpikes = 0;

    // Turning drives one hemisphere's shifters, which write the bump back one
    // wedge over. Which hemisphere depends on the sign, and that is the whole
    // of dead reckoning in this circuit.
    const drive = Math.abs(turnRate) * this.tuning.shiftGain;
    const driven: Hemisphere = turnRate >= 0 ? "L" : "R";
    const idle: Hemisphere = driven === "L" ? "R" : "L";

    for (let i = 0; i < steps; i += 1) {
      for (const wedge of this.epgByWedge) {
        this.network.sustainAll(wedge, this.tuning.tonicDrive);
      }
      // The sustain loop runs EPG to PEG and back, so PEG has to be held near
      // threshold too. Driving only EPG leaves PEG silent, which breaks the
      // loop and lets the bump die the moment anything stops pushing it.
      this.network.sustainAll(this.peg, this.tuning.tonicDrive);
      this.network.sustainAll(this.shifters[driven], drive);
      this.network.sustainAll(this.shifters[idle], 0);

      if (landmark !== null) {
        // Ring neurons are inhibitory, so exciting the ones whose wedge matches
        // the landmark's bearing suppresses the EPG cells there. The bump
        // settles away from the landmark, at a fixed offset from it — which is
        // exactly what pins a heading to the world.
        for (let w = 0; w < WEDGES; w += 1) {
          const offset = angleDelta(wedgeBearing(w), landmark);
          const weight = Math.exp(
            -(offset * offset) / (2 * this.tuning.landmarkWidth * this.tuning.landmarkWidth),
          );
          this.network.sustainAll(this.ringByWedge[w], this.tuning.landmarkGain * weight);
        }
      }

      const stats = this.network.step();
      for (let k = 0; k < stats.spikeCount; k += 1) {
        const n = stats.spikes[k];
        const wedge = this.wedgeOf(n);
        if (wedge >= 0) counts[wedge] += 1;
        else if (this.steering.includes(n)) steerSpikes += 1;
      }
    }

    // A short rolling window, because a bump read from a single step of a
    // spiking network is mostly noise. Short is the operative word: this is
    // lag on the heading estimate, and an earlier version kept eight frames,
    // which at a 100 ms frame meant the compass was reporting where the robot
    // had been almost a second ago — and went on reporting a bump for that long
    // after the bump had actually died.
    this.window.push(counts);
    if (this.window.length > 3) this.window.shift();
    const smoothed = new Array<number>(WEDGES).fill(0);
    for (const frame of this.window) {
      for (let w = 0; w < WEDGES; w += 1) smoothed[w] += frame[w];
    }

    const { heading, strength } = readBump(smoothed);
    const steer =
      goal === null ? 0 : clampTurn(angleDelta(goal, heading) * 1.2 * (steerSpikes > 0 ? 1 : 1));

    return { heading, strength, wedges: smoothed, steer };
  }

  /** Force the bump to a bearing. Used to start from a known heading. */
  seed(bearing: number, strength = 6): void {
    for (let i = 0; i < 400; i += 1) {
      for (let w = 0; w < WEDGES; w += 1) {
        const offset = angleDelta(wedgeBearing(w), bearing);
        const weight = Math.exp(-(offset * offset) / (2 * 0.4 * 0.4));
        this.network.sustainAll(this.epgByWedge[w], this.tuning.tonicDrive + strength * weight);
      }
      this.network.step();
    }
    this.window.length = 0;
  }

  census(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [type, ids] of this.compiled.byType) out[type] = ids.length;
    return out;
  }

  private wedgeOf(neuron: number): number {
    for (let w = 0; w < WEDGES; w += 1) {
      if (this.epgByWedge[w].includes(neuron)) return w;
    }
    return -1;
  }
}

function clampTurn(v: number): number {
  return Math.max(-1.5, Math.min(1.5, v));
}
