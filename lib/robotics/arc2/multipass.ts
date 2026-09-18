// ── What the robot does to the ground it has already driven on ───────────────
//
// `terramechanics.ts` next door models one pass of one wheel, and says so in
// its own header: the omission that matters is "repeated passes deepening a
// rut — which is how Spirit was lost." This file is that omission, and it is
// deliberately small, because the useful part of it is not a model. It is the
// admission that the parameter which decides everything has never been measured
// on any machine we own.
//
// The physics, stated plainly. Rut depth does not grow linearly with traffic.
// Each pass leaves the soil denser and the rut deeper, and the increments
// shrink. The standard reduced form is a power law in pass number:
//
//     z_N = z_1 · N^a            a ≥ 0, dimensionless
//
// `a = 0` is ground that does not care how often you cross it. `a = 1` is
// ground that deepens in proportion to traffic. Real soils sit in between and
// the value is a property of THAT soil on THAT day at THAT moisture — which is
// exactly why it cannot be looked up, and why a robot that wants to know it has
// to measure it where it is standing.
//
// Two measured statements from the literature bound what we should expect, and
// neither of them is a value of `a`:
//
//   - On a moist loamy sand under a ~1.5 t autonomous field robot, air
//     permeability after the tenth pass was about five times lower than after
//     the first, with structural damage appearing between the sixth and tenth
//     pass (Calleja-Huerta et al., Soil & Tillage Research 233, 2023).
//   - In a wheel/track rut study, the first pass's share of total rut depth
//     falls as vertical load rises (Sci. Rep. 15, 2025) — so `a` is not even
//     constant across loads for one soil.
//
// Both say traffic count matters at least as much as load. Neither gives us a
// number we may put in a constant, and this file does not invent one.
//
// So the contract here is: NOTHING in this module will return a pass budget
// from an unmeasured exponent. `estimateAccumulation` returns an estimate only
// when it is handed real per-pass measurements, and it carries the provenance
// of those measurements forward so a caller cannot launder a simulated number
// into a physical claim. That is the same rule the kernel's evidence layer
// applies to sensors, applied to a soil parameter.

/** Where a number came from. A simulated number is never a measurement. */
export type Provenance = "measured" | "simulated";

/** One pass over one patch of ground, as the rig records it. */
export type PassRecord = {
  /** 1-based. Pass 1 is the first time this wheel ever crossed this ground. */
  pass: number;
  /** Rut depth below the undisturbed surface, metres, positive down. */
  sinkage: number;
  /** Cone index at a fixed depth, kPa. Optional: the rut alone drives the fit. */
  coneIndex?: number;
  /** Vertical load on the wheel during this pass, newtons. */
  load: number;
  provenance: Provenance;
};

export type Accumulation = {
  /** Sinkage attributed to the first pass, metres. */
  firstPass: number;
  /** The exponent in z_N = z_1 · N^a. */
  exponent: number;
  /**
   * Coefficient of determination of the log-log fit, 0..1. A power law that
   * does not describe the data is worth knowing about before it is used to
   * decide anything.
   */
  fitQuality: number;
  /** How many passes the fit rests on. */
  samples: number;
  /** "measured" only if EVERY pass it rests on was measured. */
  provenance: Provenance;
};

/** Why no estimate could be produced. */
export type AccumulationRefusal = {
  refused: true;
  reason: string;
};

/**
 * Fit `z_N = z_1 · N^a` to what the rig actually recorded.
 *
 * Least squares in log-log, which is the standard reduction and is honest about
 * needing at least two distinct passes: one pass constrains `z_1` and says
 * nothing whatsoever about `a`, and a model fitted to a single point is the
 * failure this whole project is about.
 */
export function estimateAccumulation(
  passes: readonly PassRecord[],
): Accumulation | AccumulationRefusal {
  const usable = passes.filter((p) => p.pass >= 1 && p.sinkage > 0);
  if (usable.length < 2) {
    return { refused: true, reason: "a power law needs at least two passes with positive sinkage" };
  }
  const distinct = new Set(usable.map((p) => p.pass));
  if (distinct.size < 2) {
    return { refused: true, reason: "every record is the same pass number; the exponent is unconstrained" };
  }

  const xs = usable.map((p) => Math.log(p.pass));
  const ys = usable.map((p) => Math.log(p.sinkage));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  if (sxx === 0) {
    return { refused: true, reason: "no spread in pass number; the exponent is unconstrained" };
  }
  const exponent = sxy / sxx;
  const intercept = my - exponent * mx;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i += 1) {
    const predicted = intercept + exponent * xs[i];
    ssRes += (ys[i] - predicted) ** 2;
    ssTot += (ys[i] - my) ** 2;
  }
  const fitQuality = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);

  return {
    firstPass: Math.exp(intercept),
    exponent,
    fitQuality,
    samples: n,
    // One simulated pass makes the whole estimate simulated. There is no
    // partial credit: a fit is only as physical as its worst input.
    provenance: usable.every((p) => p.provenance === "measured") ? "measured" : "simulated",
  };
}

/**
 * Narrows any of this module's return unions. Generic because `passBudget` and
 * `earlyWarning` refuse in exactly the same way `estimateAccumulation` does,
 * and a guard that only knew about one of them made callers cast.
 */
export function refused<T>(value: T | AccumulationRefusal): value is AccumulationRefusal {
  return typeof value === "object" && value !== null && (value as AccumulationRefusal).refused === true;
}

/** Sinkage predicted at pass `n`, metres. */
export function sinkageAtPass(fit: Accumulation, n: number): number {
  if (n < 1) return 0;
  return fit.firstPass * Math.pow(n, fit.exponent);
}

export type BudgetQuery = {
  /**
   * The sinkage at which this machine is in trouble, metres. The standard
   * geometric criterion is belly contact: once the rut is as deep as the
   * chassis clearance the hull is carrying load, the wheels are unloaded, and
   * drawbar pull collapses. That is how a rover strands itself.
   */
  limit: number;
  /** Passes already made over this ground. */
  completed: number;
};

export type Budget = {
  /** The first pass number at which the prediction crosses `limit`. */
  criticalPass: number;
  /**
   * Passes remaining before that. THIS is the number the capability lives or
   * dies on: a prediction that arrives with zero or negative lead time tells
   * the robot it is already stuck, which it could have discovered by being
   * stuck.
   */
  leadPasses: number;
  provenance: Provenance;
  fitQuality: number;
};

/**
 * How many more passes this ground will take.
 *
 * Returns a refusal rather than a number when the fit cannot support one — an
 * exponent of zero predicts the limit is never reached, which is a statement
 * about the fit and not about the soil.
 */
export function passBudget(
  fit: Accumulation,
  query: BudgetQuery,
): Budget | AccumulationRefusal {
  if (query.limit <= 0) return { refused: true, reason: "limit must be positive" };
  if (fit.firstPass >= query.limit) {
    return { refused: true, reason: "the first pass already reached the limit; there was never a budget" };
  }
  if (fit.exponent <= 0) {
    return { refused: true, reason: "non-positive exponent predicts the limit is never reached" };
  }
  // z_1 · N^a = limit  ⟹  N = (limit / z_1)^(1/a)
  const exact = Math.pow(query.limit / fit.firstPass, 1 / fit.exponent);
  // When the limit falls exactly on a pass, floating point lands a hair above
  // the integer and `Math.ceil` then hands back one pass more of budget than
  // exists. Erring long is the dangerous direction — it is the difference
  // between "you have one more crossing" and being stranded on it — so snap to
  // the integer when we are within noise of it.
  const nearest = Math.round(exact);
  const snapped = Math.abs(exact - nearest) < 1e-9 * Math.max(1, exact) ? nearest : exact;
  const criticalPass = Math.ceil(snapped);
  return {
    criticalPass,
    leadPasses: criticalPass - query.completed,
    provenance: fit.provenance,
    fitQuality: fit.fitQuality,
  };
}

/**
 * The kill test, as a function.
 *
 * Take only the first `k` passes of a series, fit them, and ask what they
 * predict. Then compare against what the full series actually did. The
 * capability is worth building only if a prediction made early is both
 * available and roughly right.
 *
 * `leadPasses <= 0` means the warning arrives no earlier than the stranding
 * itself, which is not a warning.
 */
export type EarlyWarning = {
  /** How many passes the prediction was made from. */
  from: number;
  /** Predicted first pass to reach the limit. */
  predictedCritical: number;
  /** Where the full series actually first reached it, if it did. */
  observedCritical: number | null;
  /** Passes of warning the prediction would have given. */
  leadPasses: number;
  /** Predicted minus observed. Null when the series never reached the limit. */
  error: number | null;
  fitQuality: number;
  provenance: Provenance;
};

export function earlyWarning(
  passes: readonly PassRecord[],
  limit: number,
  from: number,
): EarlyWarning | AccumulationRefusal {
  if (from < 2) return { refused: true, reason: "a prediction needs at least two passes" };
  const early = passes.filter((p) => p.pass <= from);
  const fit = estimateAccumulation(early);
  if (refused(fit)) return fit;
  const budget = passBudget(fit, { limit, completed: from });
  if (refused(budget)) return budget;

  const reached = passes
    .filter((p) => p.sinkage >= limit)
    .sort((a, b) => a.pass - b.pass)[0];
  const observedCritical = reached ? reached.pass : null;

  return {
    from,
    predictedCritical: budget.criticalPass,
    observedCritical,
    leadPasses: budget.leadPasses,
    error: observedCritical === null ? null : budget.criticalPass - observedCritical,
    fitQuality: fit.fitQuality,
    provenance: fit.provenance,
  };
}
