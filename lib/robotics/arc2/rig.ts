// ── The single-wheel multi-pass rig ──────────────────────────────────────────
//
// This is the acquisition contract for a bench experiment that costs a few
// hundred dollars and can kill the ARC-2 reversibility line before anybody
// spends a year building ARC-2.
//
// The question it exists to answer is not "can a morphing robot climb out of a
// rut" — that is answered, built and flight-qualified: the ExoMars Rosalind
// Franklin rover's wheel-walking mode drove itself out of a sand trap with its
// front wheels almost fully buried, and JPL's push–pull locomotion extricated a
// vehicle with roughly half the sinkage of its entrapped condition. Escape is
// prior art and this project does not claim it.
//
// The question is the one before that: CAN A ROBOT TELL, FROM THE RUT IT HAS
// ITSELF JUST MADE, THAT THE NEXT PASS WILL STRAND IT — with enough passes of
// warning to do something about it? On Mars that decision is made by people on
// Earth; Spirit's took eight months and 2.7 tonnes of simulant in a testbed,
// and it failed. Slip prediction for tactical planning is, in the words of the
// traversability literature, still "a manual process on Earth."
//
// If two or three passes predict the stranding pass, morphology change becomes
// an action with a trigger and ARC-2 has something to decide. If they do not,
// the line dies here, on a bench, for the price of a used laptop.
//
// NOTHING IN THIS FILE SIMULATES A RIG. There is no mock, on purpose. A caller
// with no hardware must write their own source and tag it `simulated`, and
// `multipass.ts` will carry that tag into every number derived from it.

import type { PassRecord, Provenance } from "./multipass.ts";

/**
 * One physical instrument on the rig. Named rather than assumed, because a
 * channel whose source nobody wrote down is how a simulator's opinion ends up
 * in a hardware report.
 */
export type Channel = {
  /** What is being measured. */
  quantity: "sinkage" | "coneIndex" | "load" | "drawbar" | "wheelTorque" | "slip";
  unit: "m" | "kPa" | "N" | "N·m" | "ratio";
  /** The actual instrument, e.g. "VL53L5CX 8x8 ToF, 12 mm above undisturbed datum". */
  instrument: string;
  /** Manufacturer-stated or bench-verified, whichever is weaker. */
  resolution: number;
  /** Set true only once somebody has checked this channel against a reference. */
  calibrated: boolean;
};

export type RigConfiguration = {
  /** Soil in the bin, named the way the supplier names it. */
  soil: string;
  /** Gravimetric moisture content as a fraction, measured not assumed. */
  moisture: number;
  wheel: { radius: number; width: number; grousers: number };
  /** Vertical load per pass, newtons — dead weight for v1, no actuator needed. */
  load: number;
  /** Commanded slip ratio, 0..1. */
  slip: number;
  channels: readonly Channel[];
};

/**
 * What a rig must be able to do. An implementation drives real hardware; there
 * is no implementation in this repository because there is no hardware yet.
 */
export type SingleWheelRig = {
  readonly configuration: RigConfiguration;
  /** Rake the bin back to a repeatable initial state. Between SERIES, never between passes. */
  prepareBed(): Promise<void>;
  /** Drive one pass along the bin and return what was recorded. */
  runPass(pass: number): Promise<PassRecord>;
  /** Profile the rut across the track after a pass, metres below datum. */
  profile(): Promise<number[]>;
};

export type PassSeries = {
  configuration: RigConfiguration;
  records: PassRecord[];
  provenance: Provenance;
};

/**
 * Run `count` passes over the SAME track without re-preparing the bed, which is
 * the whole point: each pass inherits the ground the previous one left.
 */
export async function runPassSeries(rig: SingleWheelRig, count: number): Promise<PassSeries> {
  if (count < 2) throw new Error("a multi-pass series needs at least two passes");
  await rig.prepareBed();
  const records: PassRecord[] = [];
  for (let pass = 1; pass <= count; pass += 1) {
    records.push(await rig.runPass(pass));
  }
  return {
    configuration: rig.configuration,
    records,
    provenance: records.every((r) => r.provenance === "measured") ? "measured" : "simulated",
  };
}

/**
 * An uncalibrated channel is not a measurement, whatever it is labelled. This
 * is the same rule the kernel applies to a sensor with no declared uncertainty,
 * and the reason it is enforced here is that the rig's own conclusion is about
 * whether a physical claim is supportable.
 */
export function unreadyChannels(configuration: RigConfiguration): string[] {
  return configuration.channels
    .filter((c) => !c.calibrated)
    .map((c) => `${c.quantity} (${c.instrument}) is not calibrated`);
}
