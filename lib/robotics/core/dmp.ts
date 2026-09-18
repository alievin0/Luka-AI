// Dynamic Movement Primitives — the maths behind "show the robot once, then it
// can do it anywhere".
//
// A demonstrated trajectory is fitted as a spring-damper pulling toward the
// goal plus a learned forcing term that fades out as the movement completes.
// Because the forcing term is expressed in a phase variable rather than in
// time, the same weights replay the *shape* of the motion toward a completely
// different goal, faster or slower, without ever leaving the demonstrated
// style.
//
// Reference formulation: Ijspeert, Nakanishi & Schaal, "Dynamical Movement
// Primitives" (2013). Implemented here from the equations, no dependencies.

export type DmpConfig = {
  /** Number of Gaussian basis functions per dimension. More = finer detail. */
  basisCount?: number;
  /** Spring constant of the goal attractor. */
  alphaZ?: number;
  /** Damping; alphaZ/4 is critical damping. */
  betaZ?: number;
  /** How fast the phase decays — how quickly the learned shape stops acting. */
  alphaX?: number;
};

export type DmpModel = {
  dimensions: number;
  basisCount: number;
  alphaZ: number;
  betaZ: number;
  alphaX: number;
  /** Duration of the demonstration, seconds. */
  tau: number;
  start: number[];
  goal: number[];
  centers: number[];
  widths: number[];
  /** [dimension][basis] */
  weights: number[][];
  /**
   * Demonstrated travel per dimension. Replaying toward a different goal scales
   * the learned shape by (newTravel / demoTravel); a dimension that started and
   * ended in the same place has no travel to scale by, so its shape is replayed
   * at the demonstrated amplitude instead of being multiplied by zero.
   */
  spread: number[];
};

export type DemoPoint = { t: number; values: number[] };

const DEFAULTS = { basisCount: 30, alphaZ: 25, betaZ: 25 / 4, alphaX: 2.5 };

/** Fit a DMP to one demonstration using locally weighted regression. */
export function fitDmp(demo: DemoPoint[], config: DmpConfig = {}): DmpModel {
  if (demo.length < 4) {
    throw new Error("A demonstration needs at least four samples.");
  }
  const dimensions = demo[0].values.length;
  const basisCount = config.basisCount ?? DEFAULTS.basisCount;
  const alphaZ = config.alphaZ ?? DEFAULTS.alphaZ;
  const betaZ = config.betaZ ?? DEFAULTS.betaZ;
  const alphaX = config.alphaX ?? DEFAULTS.alphaX;

  const t0 = demo[0].t;
  const tau = Math.max(demo[demo.length - 1].t - t0, 1e-3);

  // Basis functions evenly spaced in *phase*, which means evenly spaced in the
  // perceptual sense rather than in time.
  const centers = new Array(basisCount);
  for (let i = 0; i < basisCount; i += 1) {
    centers[i] = Math.exp((-alphaX * i) / (basisCount - 1));
  }
  const widths = new Array(basisCount);
  for (let i = 0; i < basisCount; i += 1) {
    const next = i < basisCount - 1 ? centers[i + 1] : centers[i] * 0.85;
    widths[i] = 1 / Math.max((next - centers[i]) ** 2, 1e-8);
  }

  // Resample the demonstration onto a uniform grid so the derivatives behave.
  const steps = Math.max(demo.length, 100);
  const dt = tau / (steps - 1);
  const y: number[][] = [];
  for (let s = 0; s < steps; s += 1) {
    y.push(sampleAt(demo, t0 + s * dt));
  }

  const start = [...y[0]];
  const goal = [...y[steps - 1]];

  // Central differences for velocity and acceleration.
  const dy = derivative(y, dt);
  const ddy = derivative(dy, dt);

  const weights: number[][] = [];
  const spread: number[] = [];

  for (let d = 0; d < dimensions; d += 1) {
    spread.push(goal[d] - start[d]);

    // Locally weighted regression: each basis function is fitted independently
    // against the force the demonstration must have been under.
    const numerators = new Array(basisCount).fill(0);
    const denominators = new Array(basisCount).fill(0);

    for (let s = 0; s < steps; s += 1) {
      const x = Math.exp((-alphaX * s) / (steps - 1));
      const fTarget =
        tau * tau * ddy[s][d] - alphaZ * (betaZ * (goal[d] - y[s][d]) - tau * dy[s][d]);
      for (let i = 0; i < basisCount; i += 1) {
        const psi = Math.exp(-widths[i] * (x - centers[i]) ** 2);
        numerators[i] += psi * x * fTarget;
        denominators[i] += psi * x * x;
      }
    }

    weights.push(
      numerators.map((n, i) =>
        Math.abs(denominators[i]) < 1e-10 ? 0 : n / denominators[i],
      ),
    );
  }

  return {
    dimensions,
    basisCount,
    alphaZ,
    betaZ,
    alphaX,
    tau,
    start,
    goal,
    centers,
    widths,
    weights,
    spread,
  };
}

export type RolloutOptions = {
  /** Where to start; defaults to the demonstrated start. */
  start?: number[];
  /** Where to end; the whole point — this can differ from the demonstration. */
  goal?: number[];
  /** Playback duration in seconds; defaults to the demonstrated duration. */
  tau?: number;
  /** Integration step, seconds. */
  dt?: number;
};

/** Replay a fitted primitive, optionally toward a new goal or at a new speed. */
export function rolloutDmp(model: DmpModel, options: RolloutOptions = {}): DemoPoint[] {
  const start = options.start ?? model.start;
  const goal = options.goal ?? model.goal;
  const tau = options.tau ?? model.tau;
  const dt = options.dt ?? Math.min(tau / 200, 0.02);

  const y = [...start];
  const z = new Array(model.dimensions).fill(0);
  let x = 1;

  const out: DemoPoint[] = [{ t: 0, values: [...y] }];
  const steps = Math.ceil(tau / dt);

  for (let s = 1; s <= steps; s += 1) {
    // Phase decays from 1 to ~0; the learned forcing term rides on it, so the
    // goal attractor always wins in the end. That is why a DMP cannot diverge.
    x += ((-model.alphaX * x) / tau) * dt;

    let psiSum = 0;
    const psi = new Array(model.basisCount);
    for (let i = 0; i < model.basisCount; i += 1) {
      psi[i] = Math.exp(-model.widths[i] * (x - model.centers[i]) ** 2);
      psiSum += psi[i];
    }

    for (let d = 0; d < model.dimensions; d += 1) {
      let forcing = 0;
      for (let i = 0; i < model.basisCount; i += 1) {
        forcing += psi[i] * model.weights[d][i];
      }
      const demoSpread = model.spread[d];
      const scale =
        Math.abs(demoSpread) > 1e-3 ? (goal[d] - start[d]) / demoSpread : 1;
      forcing = psiSum > 1e-10 ? (forcing / psiSum) * x * scale : 0;

      const dz =
        (model.alphaZ * (model.betaZ * (goal[d] - y[d]) - z[d]) + forcing) / tau;
      z[d] += dz * dt;
      y[d] += (z[d] / tau) * dt;
    }

    out.push({ t: s * dt, values: [...y] });
  }

  return out;
}

/** Root-mean-square distance between two trajectories, resampled to match. */
export function trajectoryRmse(a: DemoPoint[], b: DemoPoint[], samples = 100): number {
  const durationA = a[a.length - 1].t - a[0].t;
  const durationB = b[b.length - 1].t - b[0].t;
  let total = 0;
  for (let s = 0; s < samples; s += 1) {
    const phase = s / (samples - 1);
    const va = sampleAt(a, a[0].t + phase * durationA);
    const vb = sampleAt(b, b[0].t + phase * durationB);
    let sum = 0;
    for (let d = 0; d < va.length; d += 1) sum += (va[d] - vb[d]) ** 2;
    total += sum;
  }
  return Math.sqrt(total / samples);
}

/** Linear interpolation of a trajectory at an arbitrary time. */
export function sampleAt(trajectory: DemoPoint[], t: number): number[] {
  if (t <= trajectory[0].t) return [...trajectory[0].values];
  const last = trajectory[trajectory.length - 1];
  if (t >= last.t) return [...last.values];

  let lo = 0;
  let hi = trajectory.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (trajectory[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const span = trajectory[hi].t - trajectory[lo].t || 1;
  const k = (t - trajectory[lo].t) / span;
  return trajectory[lo].values.map(
    (v, i) => v + (trajectory[hi].values[i] - v) * k,
  );
}

function derivative(series: number[][], dt: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < series.length; i += 1) {
    const prev = series[Math.max(i - 1, 0)];
    const next = series[Math.min(i + 1, series.length - 1)];
    const span = (Math.min(i + 1, series.length - 1) - Math.max(i - 1, 0)) * dt || dt;
    out.push(prev.map((p, d) => (next[d] - p) / span));
  }
  return out;
}
