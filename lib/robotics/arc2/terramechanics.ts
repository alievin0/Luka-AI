// ── Classical terramechanics, for one question ───────────────────────────────
//
// This is not part of the robotics kernel and nothing in the kernel imports it.
// It exists to answer one question that had to be answered before any ARC-2
// capability was worth building, and it needs no physics engine, no robot and
// no gait, because the question is about a contact model rather than a machine:
//
//   Can a load-transfer experiment tell "the floor has no grip" apart from
//   "the wheel is sinking into it"?
//
// The hypothesis it was built to kill said yes, and specifically that the
// derivative of drawbar pull with respect to normal load is positive on a rigid
// low-friction surface and turns negative on loose soil. `__tests__/
// terramechanics.test.ts` records what the model actually says, which is that
// the prediction is false and the reasoning behind it was backwards.
//
// Semi-empirical, quasi-static, rigid wheel, single pass, level ground:
//
//   pressure-sinkage       p   = (k_c/b + k_φ) z^n                    (Bekker)
//   wheel sinkage          z   = [ 3W / (b(3−n)(k_c/b + k_φ)√(2r)) ]^(2/(2n+1))
//   compaction resistance  R_c = b(k_c/b + k_φ) z^(n+1) / (n+1)
//   shear stress           τ   = (c + σ tan φ)(1 − e^(−j/K))  (Janosi–Hanamoto)
//   drawbar pull           DP  = H − R_c
//
// What it does NOT model, and the omissions matter more than the model does:
// repeated passes deepening a rut — which is how Spirit was lost — slope, belly
// contact once sinkage approaches the wheel radius, grousers, moisture, and any
// dynamics at all. A number from here describes classical terramechanics
// theory, not a robot, and certainly not ARC-2.

export type Soil = {
  name: string;
  /** Sinkage exponent. */
  n: number;
  /** Cohesive modulus, kN/m^(n+1). */
  kc: number;
  /** Frictional modulus, kN/m^(n+2). */
  kphi: number;
  /** Cohesion, kPa. */
  c: number;
  /** Internal angle of friction, degrees. */
  phi: number;
  /** Shear deformation modulus, m. */
  K: number;
};

/** Wong, *Theory of Ground Vehicles*, and the Land Locomotion Laboratory tables. */
export const SOILS: readonly Soil[] = [
  { name: "dry sand", n: 1.1, kc: 0.99, kphi: 1528.43, c: 1.04, phi: 28, K: 0.010 },
  { name: "sandy loam", n: 0.7, kc: 5.27, kphi: 1515.04, c: 1.72, phi: 29, K: 0.025 },
  { name: "clayey soil", n: 0.5, kc: 13.19, kphi: 692.15, c: 4.14, phi: 13, K: 0.010 },
];

export type Wheel = { radius: number; width: number };

/** A wheel for a 40–60 kg machine, which is the size ARC-2 is drawn at. */
export const ARC2_WHEEL: Wheel = { radius: 0.12, width: 0.08 };

/** Static sinkage of a rigid wheel under load `W` newtons, metres. */
export function sinkage(W: number, soil: Soil, wheel: Wheel = ARC2_WHEEL): number {
  const k = soil.kc / wheel.width + soil.kphi;
  const base =
    (3 * (W / 1000)) /
    (wheel.width * (3 - soil.n) * k * Math.sqrt(2 * wheel.radius));
  return Math.pow(base, 2 / (2 * soil.n + 1));
}

/** Compaction resistance, newtons — the cost of digging the rut you drive in. */
export function compactionResistance(W: number, soil: Soil, wheel: Wheel = ARC2_WHEEL): number {
  const z = sinkage(W, soil, wheel);
  const k = soil.kc / wheel.width + soil.kphi;
  return 1000 * ((wheel.width * k * Math.pow(z, soil.n + 1)) / (soil.n + 1));
}

/** Contact patch of a rigid wheel at sinkage `z`. */
export function patch(z: number, wheel: Wheel = ARC2_WHEEL): { length: number; area: number } {
  const theta = Math.acos(Math.max(1 - z / wheel.radius, -1));
  const length = 2 * wheel.radius * Math.sin(theta);
  return { length, area: length * wheel.width };
}

/** Gross tractive effort at a given slip ratio, newtons. */
export function tractiveEffort(
  W: number,
  soil: Soil,
  slip: number,
  wheel: Wheel = ARC2_WHEEL,
): number {
  if (slip <= 0) return 0;
  const { length, area } = patch(sinkage(W, soil, wheel), wheel);
  if (length <= 0) return 0;
  const maxShear = area * soil.c * 1000 + W * Math.tan((soil.phi * Math.PI) / 180);
  const x = (slip * length) / soil.K;
  return maxShear * (1 - (1 / x) * (1 - Math.exp(-x)));
}

/**
 * Net drawbar pull, newtons. `soil = null` is a rigid surface with friction
 * coefficient `mu` and no sinkage at all — ice, or a wet polished floor.
 */
export function drawbarPull(
  W: number,
  soil: Soil | null,
  slip: number,
  options: { mu?: number; wheel?: Wheel } = {},
): number {
  const wheel = options.wheel ?? ARC2_WHEEL;
  if (soil === null) return (options.mu ?? 0.1) * W;
  return tractiveEffort(W, soil, slip, wheel) - compactionResistance(W, soil, wheel);
}
