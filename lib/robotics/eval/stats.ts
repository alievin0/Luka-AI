// Statistics for robot evaluation.
//
// A success rate measured over a handful of episodes is a binomial estimate,
// and at the episode counts robot evaluation actually uses it is a very loose
// one: nine successes out of ten is compatible with a true rate anywhere from
// about 60% to about 98%. Reporting "90%" without that range is not a summary,
// it is a claim the data does not support.
//
// Everything here is exact or clearly-labelled-approximate, and dependency-free.

export type Interval = { low: number; high: number };

/**
 * Wilson score interval for a binomial proportion.
 *
 * Preferred over the textbook normal ("Wald") interval because it stays inside
 * [0, 1] and keeps its coverage near 0% and 100% — exactly where robot results
 * tend to sit and exactly where Wald produces intervals like [0.82, 1.07].
 */
export function wilson(successes: number, trials: number, z = 1.96): Interval {
  if (trials <= 0) return { low: 0, high: 1 };
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denominator;
  const half =
    (z / denominator) *
    Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** log(n!) via a log-gamma approximation, accurate enough for exact binomials. */
function logFactorial(n: number): number {
  if (n < 2) return 0;
  // Stirling with the standard correction series; error under 1e-10 for n >= 2.
  return (
    (n + 0.5) * Math.log(n) -
    n +
    0.5 * Math.log(2 * Math.PI) +
    1 / (12 * n) -
    1 / (360 * n * n * n)
  );
}

function logChoose(n: number, k: number): number {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/** P(X = k) for X ~ Binomial(n, p). */
export function binomialPmf(k: number, n: number, p: number): number {
  if (k < 0 || k > n) return 0;
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

/** P(X >= k) for X ~ Binomial(n, p). */
export function binomialTail(k: number, n: number, p: number): number {
  let total = 0;
  for (let i = Math.max(k, 0); i <= n; i += 1) total += binomialPmf(i, n, p);
  return Math.min(total, 1);
}

export type McNemarResult = {
  /** Episodes A won and B lost. */
  aOnly: number;
  /** Episodes B won and A lost. */
  bOnly: number;
  /** Episodes where both did the same thing — these carry no information. */
  agreed: number;
  pValue: number;
  significant: boolean;
  summary: string;
};

/**
 * Exact McNemar test on paired outcomes.
 *
 * Pairing is the whole point: run both variants on the *same* seeded episodes
 * and the question stops being "are these two rates different", which needs
 * hundreds of episodes to answer, and becomes "on the episodes where they
 * disagreed, did one win more often", which needs far fewer. Episodes where
 * both succeeded or both failed are discarded — they contain no evidence about
 * which is better.
 */
export function mcNemar(
  a: boolean[],
  b: boolean[],
  alpha = 0.05,
): McNemarResult {
  if (a.length !== b.length) {
    throw new Error("Paired comparison needs the same episodes on both sides.");
  }

  let aOnly = 0;
  let bOnly = 0;
  let agreed = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) agreed += 1;
    else if (a[i]) aOnly += 1;
    else bOnly += 1;
  }

  const discordant = aOnly + bOnly;
  if (discordant === 0) {
    return {
      aOnly,
      bOnly,
      agreed,
      pValue: 1,
      significant: false,
      summary: `Identical on all ${agreed} episodes — nothing to compare.`,
    };
  }

  // Two-sided exact binomial test against a fair coin.
  const extreme = Math.max(aOnly, bOnly);
  const pValue = Math.min(2 * binomialTail(extreme, discordant, 0.5), 1);
  const significant = pValue < alpha;
  const winner = aOnly > bOnly ? "A" : "B";

  return {
    aOnly,
    bOnly,
    agreed,
    pValue,
    significant,
    summary: significant
      ? `${winner} wins: ${aOnly} vs ${bOnly} on the ${discordant} episodes where they differed (p = ${pValue.toFixed(4)}).`
      : `No verdict: ${aOnly} vs ${bOnly} across ${discordant} disagreements is p = ${pValue.toFixed(3)}, which this many episodes cannot resolve.`,
  };
}

/** Inverse standard normal CDF (Acklam's rational approximation). */
function probit(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;

  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - low) return -probit(1 - p);

  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/**
 * How many episodes it would take to detect a difference of this size.
 *
 * The normal approximation for two independent proportions. Paired testing does
 * better than this, so treat the answer as a conservative ceiling — but the
 * shape is the lesson: detecting 20 points takes about a hundred episodes,
 * detecting 2 points takes about ten thousand, and "we ran 20 and it looked
 * better" is not a result.
 */
export function requiredEpisodes(
  baseline: number,
  improved: number,
  power = 0.8,
  alpha = 0.05,
): number {
  const delta = Math.abs(improved - baseline);
  if (delta < 1e-9) return Number.POSITIVE_INFINITY;

  const zAlpha = -probit(alpha / 2);
  const zBeta = -probit(1 - power);
  const pooled = (baseline + improved) / 2;

  const numerator =
    zAlpha * Math.sqrt(2 * pooled * (1 - pooled)) +
    zBeta * Math.sqrt(baseline * (1 - baseline) + improved * (1 - improved));

  return Math.ceil((numerator * numerator) / (delta * delta));
}

/** The smallest difference this many episodes could actually resolve. */
export function resolvableDifference(
  episodes: number,
  baseline = 0.5,
  power = 0.8,
  alpha = 0.05,
): number {
  let low = 0;
  let high = 1 - baseline;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (requiredEpisodes(baseline, baseline + mid, power, alpha) <= episodes) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return high;
}

/** Mean, standard deviation and a normal interval for a continuous measure. */
export function summarise(values: number[]): {
  n: number;
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  median: number;
  interval: Interval;
} {
  const n = values.length;
  if (n === 0) {
    return { n: 0, mean: 0, stdDev: 0, min: 0, max: 0, median: 0, interval: { low: 0, high: 0 } };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance =
    n > 1 ? values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1) : 0;
  const stdDev = Math.sqrt(variance);
  const halfWidth = n > 1 ? (1.96 * stdDev) / Math.sqrt(n) : 0;

  return {
    n,
    mean,
    stdDev,
    min: sorted[0],
    max: sorted[n - 1],
    median: n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
    interval: { low: mean - halfWidth, high: mean + halfWidth },
  };
}
