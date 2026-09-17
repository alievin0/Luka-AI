// Loading a real connectome.
//
// A connectome is a wiring diagram: which neuron contacts which, and how often.
// It is not a model. It gives you no weights, no signs, no time constants — and
// the gap between "we know the wiring" and "we know what it computes" is the
// whole of the field. This module is explicit about where measurement stops and
// modelling starts, because every number it invents is an assumption someone
// will otherwise mistake for data.

import { SpikingNetwork, type NeuronParams, type NetworkSpec, type Synapse } from "./network.ts";

/**
 * One neuron as connectome datasets describe it.
 *
 * `transmitter` is itself usually a prediction rather than a measurement in the
 * large datasets — it is inferred from the imagery. Treated here as evidence,
 * not fact, which is why `sign` can override it.
 */
export type ConnectomeNeuron = {
  id: string | number;
  /** Cell type, e.g. "LPLC2" or "Giant Fiber". The useful handle. */
  type?: string;
  /** Anatomical region, where the dataset gives one. */
  region?: string;
  /** Predicted or measured neurotransmitter. */
  transmitter?: "acetylcholine" | "glutamate" | "gaba" | "dopamine" | "serotonin" | "octopamine" | "unknown";
  /** Force the sign regardless of transmitter. */
  sign?: 1 | -1;
};

/** One connection, with the synapse count the dataset actually counted. */
export type ConnectomeEdge = {
  from: string | number;
  to: string | number;
  /** Number of synaptic contacts. This is the measured quantity. */
  synapses: number;
};

export type ConnectomeData = {
  name: string;
  /** Where it came from, so a model can never be mistaken for a source. */
  source: string;
  licence?: string;
  neurons: ConnectomeNeuron[];
  edges: ConnectomeEdge[];
};

/**
 * How synapse counts become weights.
 *
 * This is the modelling step, and the honest framing is that it is a guess with
 * a shape. Counting contacts tells you two neurons are strongly coupled; it does
 * not tell you by how many millivolts.
 */
export type WeightModel = {
  /** Weight per synaptic contact before scaling. */
  perSynapse: number;
  /** Cap, so one enormous connection cannot dominate the network. */
  maxWeight: number;
  /** Ignore connections weaker than this many contacts — they are mostly noise. */
  minSynapses: number;
  /** Multiplier applied to inhibitory connections. */
  inhibitoryGain: number;
  /** Uniform axonal delay, ms. Real delays vary and are rarely in the data. */
  delayMs: number;
};

export const DEFAULT_WEIGHTS: WeightModel = {
  perSynapse: 0.06,
  maxWeight: 6,
  minSynapses: 3,
  inhibitoryGain: 1.6,
  delayMs: 1.5,
};

/** Excitatory or inhibitory, from the transmitter where one is given. */
export function signOf(neuron: ConnectomeNeuron): 1 | -1 {
  if (neuron.sign) return neuron.sign;
  switch (neuron.transmitter) {
    case "gaba":
    case "glutamate":
      // In the fly, glutamate is commonly inhibitory via GluClα — the opposite
      // of the vertebrate default, and a classic way to get the sign wrong.
      return -1;
    case "acetylcholine":
      return 1;
    default:
      return 1;
  }
}

export type CompiledConnectome = {
  spec: NetworkSpec;
  /** Dataset id → dense index. */
  index: Map<string | number, number>;
  /** Cell type → the indices of every neuron of that type. */
  byType: Map<string, number[]>;
  stats: {
    neurons: number;
    edges: number;
    droppedEdges: number;
    excitatory: number;
    inhibitory: number;
    /** Synaptic contacts represented, after the minimum-count filter. */
    contacts: number;
  };
};

/** Turn a connectome into something runnable, and say what was assumed. */
export function compileConnectome(
  data: ConnectomeData,
  options: {
    weights?: Partial<WeightModel>;
    neuronParams?: Partial<NeuronParams>;
    /** Per-type parameter overrides — the only place cell biology enters. */
    typeParams?: Record<string, Partial<NeuronParams>>;
    stepMs?: number;
    seed?: number;
  } = {},
): CompiledConnectome {
  const model = { ...DEFAULT_WEIGHTS, ...options.weights };

  const index = new Map<string | number, number>();
  const byType = new Map<string, number[]>();
  const labels: string[] = [];
  const params = new Map<number, Partial<NeuronParams>>();

  data.neurons.forEach((neuron, i) => {
    index.set(neuron.id, i);
    labels.push(neuron.type ? `${neuron.type}:${neuron.id}` : String(neuron.id));
    if (neuron.type) {
      const existing = byType.get(neuron.type) ?? [];
      existing.push(i);
      byType.set(neuron.type, existing);
      const override = options.typeParams?.[neuron.type];
      if (override) params.set(i, override);
    }
  });

  const synapses: Synapse[] = [];
  let dropped = 0;
  let excitatory = 0;
  let inhibitory = 0;
  let contacts = 0;

  for (const edge of data.edges) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from === undefined || to === undefined || edge.synapses < model.minSynapses) {
      dropped += 1;
      continue;
    }

    const sign = signOf(data.neurons[from]);
    const magnitude = Math.min(
      edge.synapses * model.perSynapse * (sign < 0 ? model.inhibitoryGain : 1),
      model.maxWeight,
    );

    synapses.push({ from, to, weight: sign * magnitude, delayMs: model.delayMs });
    contacts += edge.synapses;
    if (sign > 0) excitatory += 1;
    else inhibitory += 1;
  }

  return {
    spec: {
      neuronCount: data.neurons.length,
      synapses,
      params,
      defaults: options.neuronParams,
      stepMs: options.stepMs ?? 0.5,
      seed: options.seed ?? 17,
      labels,
    },
    index,
    byType,
    stats: {
      neurons: data.neurons.length,
      edges: synapses.length,
      droppedEdges: dropped,
      excitatory,
      inhibitory,
      contacts,
    },
  };
}

export function buildNetwork(compiled: CompiledConnectome): SpikingNetwork {
  return new SpikingNetwork(compiled.spec);
}

/**
 * Parse the shape most connectome exports arrive in: one CSV of neurons, one of
 * connections. Column names vary between datasets, so they are given rather than
 * guessed.
 */
export function parseConnectomeCsv(
  neuronCsv: string,
  edgeCsv: string,
  columns: {
    neuronId: string;
    neuronType?: string;
    neuronRegion?: string;
    neuronTransmitter?: string;
    edgeFrom: string;
    edgeTo: string;
    edgeSynapses: string;
  },
  meta: { name: string; source: string; licence?: string },
): ConnectomeData {
  const neuronRows = parseCsv(neuronCsv);
  const edgeRows = parseCsv(edgeCsv);

  const neurons: ConnectomeNeuron[] = neuronRows.map((row) => ({
    id: row[columns.neuronId],
    type: columns.neuronType ? row[columns.neuronType] : undefined,
    region: columns.neuronRegion ? row[columns.neuronRegion] : undefined,
    transmitter: columns.neuronTransmitter
      ? normaliseTransmitter(row[columns.neuronTransmitter])
      : undefined,
  }));

  const edges: ConnectomeEdge[] = edgeRows
    .map((row) => ({
      from: row[columns.edgeFrom],
      to: row[columns.edgeTo],
      synapses: Number(row[columns.edgeSynapses]),
    }))
    .filter((edge) => Number.isFinite(edge.synapses) && edge.synapses > 0);

  return { ...meta, neurons, edges };
}

function normaliseTransmitter(value: string | undefined): ConnectomeNeuron["transmitter"] {
  const key = (value ?? "").trim().toLowerCase();
  if (key.startsWith("ach") || key.includes("cholin")) return "acetylcholine";
  if (key.startsWith("glut")) return "glutamate";
  if (key.startsWith("gaba")) return "gaba";
  if (key.startsWith("dop")) return "dopamine";
  if (key.startsWith("ser") || key.startsWith("5-ht")) return "serotonin";
  if (key.startsWith("oct")) return "octopamine";
  return "unknown";
}

/** A small CSV reader: quoted fields, embedded commas, CRLF. */
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.length === header.length).map((r) => {
    const record: Record<string, string> = {};
    header.forEach((name, i) => {
      record[name] = r[i].trim();
    });
    return record;
  });
}
