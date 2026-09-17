// Small, dependency-free math toolbox shared by the simulator, the safety
// governor and the abilities. Everything here is pure and allocation-light so
// it can run inside a control loop at a few hundred hertz.

export type Vec2 = { x: number; y: number };
export type Pose2 = { x: number; y: number; theta: number };

export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

/** Maps `value` from one range to another, clamped to the output range. */
export function remap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return outMin;
  return clamp(
    outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin),
    Math.min(outMin, outMax),
    Math.max(outMin, outMax),
  );
}

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function length(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function normalize(a: Vec2): Vec2 {
  const len = length(a);
  return len < 1e-9 ? { x: 0, y: 0 } : { x: a.x / len, y: a.y / len };
}

/** Wraps an angle into [-pi, pi) so heading errors never take the long way round. */
export function wrapAngle(radians: number): number {
  let a = (radians + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Signed shortest angular difference `to - from`. */
export function angleDiff(from: number, to: number): number {
  return wrapAngle(to - from);
}

export function headingTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function radians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function round(value: number, decimals = 3): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/**
 * Deterministic PRNG (mulberry32). Every stochastic part of the kernel takes a
 * seed so a run can be replayed bit-for-bit — essential when a rehearsal says
 * "this plan fails 7% of the time" and you want to see those 7%.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller normal sample from a uniform RNG. */
export function gaussian(rng: () => number, mean = 0, stdDev = 1): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

/** Classic PID with output clamping and integral anti-windup. */
export class Pid {
  private readonly kp: number;
  private readonly ki: number;
  private readonly kd: number;
  private readonly outputLimit: number;
  private integral = 0;
  private previousError = 0;
  private primed = false;

  constructor(kp: number, ki: number, kd: number, outputLimit = Number.POSITIVE_INFINITY) {
    this.kp = kp;
    this.ki = ki;
    this.kd = kd;
    this.outputLimit = outputLimit;
  }

  step(error: number, dt: number): number {
    if (dt <= 0) return 0;
    const derivative = this.primed ? (error - this.previousError) / dt : 0;
    this.previousError = error;
    this.primed = true;

    const candidate =
      this.kp * error + this.ki * (this.integral + error * dt) + this.kd * derivative;

    // Only accumulate when the controller is not saturated (anti-windup).
    if (Math.abs(candidate) < this.outputLimit) this.integral += error * dt;

    return clamp(
      this.kp * error + this.ki * this.integral + this.kd * derivative,
      -this.outputLimit,
      this.outputLimit,
    );
  }

  reset(): void {
    this.integral = 0;
    this.previousError = 0;
    this.primed = false;
  }
}

/** First-order low-pass filter; `cutoffHz` is the -3 dB point. */
export class LowPass {
  private readonly cutoffHz: number;
  private value: number | null = null;

  constructor(cutoffHz: number) {
    this.cutoffHz = cutoffHz;
  }

  step(sample: number, dt: number): number {
    if (this.value === null) {
      this.value = sample;
      return sample;
    }
    const rc = 1 / (TAU * Math.max(this.cutoffHz, 1e-6));
    const alpha = dt / (rc + dt);
    this.value += alpha * (sample - this.value);
    return this.value;
  }

  get current(): number {
    return this.value ?? 0;
  }
}

/**
 * Welford's online mean/variance — used by the anomaly sentinel to learn a
 * baseline without keeping the whole history in memory.
 */
export class RunningStats {
  count = 0;
  private meanValue = 0;
  private m2 = 0;

  push(sample: number): void {
    this.count += 1;
    const delta = sample - this.meanValue;
    this.meanValue += delta / this.count;
    this.m2 += delta * (sample - this.meanValue);
  }

  get mean(): number {
    return this.meanValue;
  }

  get variance(): number {
    return this.count > 1 ? this.m2 / (this.count - 1) : 0;
  }

  get stdDev(): number {
    return Math.sqrt(this.variance);
  }

  /** Standard score, guarded so a perfectly flat baseline can't divide by zero. */
  zScore(sample: number, floor = 1e-6): number {
    return (sample - this.meanValue) / Math.max(this.stdDev, floor);
  }
}
