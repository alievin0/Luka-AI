// Evaluation protocols.
//
// A number from a robot run means nothing without the conditions that produced
// it: which seeds, how long it was given, what counted as success, which world.
// So a protocol is a value here, it carries a fingerprint, and two results with
// different fingerprints refuse to be compared rather than quietly subtracting
// numbers that were never measuring the same thing.
//
// This is the cheapest honest thing a robotics library can do, and almost
// nothing does it.

import { wilson, mcNemar, requiredEpisodes, resolvableDifference, summarise, type Interval, type McNemarResult } from "./stats.ts";
import type { ScenarioName } from "../sim/scenarios.ts";

export type SuccessCriterion = {
  /** Stable id, so a result records *which* definition of success it used. */
  id: string;
  version: string;
  description: string;
};

export type Protocol = {
  name: string;
  scenario: ScenarioName;
  /** The exact seeds, in order. Fixing them is what makes runs comparable. */
  seeds: number[];
  /** Simulated-time budget per episode, ms. */
  timeLimitMs: number;
  criterion: SuccessCriterion;
  /** Anything else that changes the meaning of a result. */
  conditions?: Record<string, string | number | boolean>;
};

export type EpisodeRecord = {
  index: number;
  seed: number;
  success: boolean;
  /** Simulated duration of the episode, ms. */
  durationMs: number;
  /** Free-form measures — reported per episode, never only as an average. */
  metrics: Record<string, number>;
  /** Why it failed, when it did. */
  failure?: string;
  notes?: string;
};

export type SuiteResult = {
  protocol: Protocol;
  fingerprint: string;
  episodes: EpisodeRecord[];
  successes: number;
  trials: number;
  successRate: number;
  /** 95% Wilson interval on the success rate. */
  interval: Interval;
  /** Per-metric mean, spread and interval across episodes. */
  metrics: Record<string, ReturnType<typeof summarise>>;
  failures: Record<string, number>;
  /** The smallest difference this many episodes could have detected. */
  resolvablePercentagePoints: number;
  wallClockMs: number;
};

/**
 * A stable fingerprint of everything that defines the measurement.
 *
 * Not cryptographic — this is an equality check, not a signature. Two protocols
 * that differ anywhere produce different fingerprints, which is the only
 * property needed to stop incomparable numbers being compared.
 */
export function fingerprint(protocol: Protocol): string {
  const canonical = JSON.stringify({
    name: protocol.name,
    scenario: protocol.scenario,
    seeds: protocol.seeds,
    timeLimitMs: protocol.timeLimitMs,
    criterion: protocol.criterion,
    conditions: sortKeys(protocol.conditions ?? {}),
  });

  // Two independent FNV-1a streams, so a 64-bit-wide fingerprint.
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < canonical.length; i += 1) {
    const code = canonical.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b + code, 0x85ebca6b) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

function sortKeys<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).sort(([x], [y]) => x.localeCompare(y))) as T;
}

export type EpisodeRunner = (
  seed: number,
  index: number,
) => Promise<Omit<EpisodeRecord, "index" | "seed">>;

/** Run one episode per seed, and report the statistics rather than a number. */
export async function runSuite(
  protocol: Protocol,
  runner: EpisodeRunner,
): Promise<SuiteResult> {
  const started = Date.now();
  const episodes: EpisodeRecord[] = [];

  for (let index = 0; index < protocol.seeds.length; index += 1) {
    const seed = protocol.seeds[index];
    const outcome = await runner(seed, index);
    episodes.push({ index, seed, ...outcome });
  }

  const successes = episodes.filter((e) => e.success).length;
  const trials = episodes.length;

  const metricNames = new Set<string>();
  for (const episode of episodes) {
    for (const key of Object.keys(episode.metrics)) metricNames.add(key);
  }
  const metrics: Record<string, ReturnType<typeof summarise>> = {};
  for (const name of metricNames) {
    metrics[name] = summarise(
      episodes
        .map((e) => e.metrics[name])
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v)),
    );
  }

  const failures: Record<string, number> = {};
  for (const episode of episodes) {
    if (episode.success || !episode.failure) continue;
    failures[episode.failure] = (failures[episode.failure] ?? 0) + 1;
  }

  return {
    protocol,
    fingerprint: fingerprint(protocol),
    episodes,
    successes,
    trials,
    successRate: trials > 0 ? successes / trials : 0,
    interval: wilson(successes, trials),
    metrics,
    failures,
    resolvablePercentagePoints: resolvableDifference(trials) * 100,
    wallClockMs: Date.now() - started,
  };
}

export type Comparison = {
  fingerprint: string;
  test: McNemarResult;
  aRate: number;
  bRate: number;
  /** Episodes that would have been needed to resolve the difference seen. */
  episodesNeeded: number;
  verdict: string;
};

/**
 * Compare two suites that ran the same protocol.
 *
 * Paired, because both ran the identical seeded episodes: the question is not
 * "are these two rates different", which needs hundreds of episodes, but "on
 * the episodes where they disagreed, did one win more often", which needs far
 * fewer. Mismatched protocols throw — silently subtracting two numbers measured
 * under different conditions is the failure this whole module exists to stop.
 */
export function compare(a: SuiteResult, b: SuiteResult, alpha = 0.05): Comparison {
  if (a.fingerprint !== b.fingerprint) {
    throw new Error(
      `Refusing to compare results from different protocols (${a.fingerprint} vs ${b.fingerprint}). ` +
        "Re-run both under the same protocol.",
    );
  }

  const test = mcNemar(
    a.episodes.map((e) => e.success),
    b.episodes.map((e) => e.success),
    alpha,
  );
  const needed = requiredEpisodes(Math.min(a.successRate, b.successRate), Math.max(a.successRate, b.successRate));

  return {
    fingerprint: a.fingerprint,
    test,
    aRate: a.successRate,
    bRate: b.successRate,
    episodesNeeded: needed,
    verdict: test.significant
      ? test.summary
      : `${test.summary} A difference this size would need about ${Number.isFinite(needed) ? needed : "∞"} episodes to establish.`,
  };
}

/** A report a robotics person can read without asking follow-up questions. */
export function report(result: SuiteResult): string {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const lines: string[] = [];

  lines.push(`${result.protocol.name}  [${result.fingerprint}]`);
  lines.push(
    `  world ${result.protocol.scenario} · ${result.trials} episodes · ${result.protocol.timeLimitMs / 1000}s limit each`,
  );
  lines.push(`  success: ${result.successes}/${result.trials} = ${pct(result.successRate)}`);
  lines.push(
    `  95% CI:  ${pct(result.interval.low)} – ${pct(result.interval.high)}   (Wilson)`,
  );
  lines.push(
    `  this many episodes can only resolve differences above ${result.resolvablePercentagePoints.toFixed(0)} points`,
  );
  lines.push(`  criterion: ${result.protocol.criterion.id}@${result.protocol.criterion.version} — ${result.protocol.criterion.description}`);

  if (Object.keys(result.failures).length > 0) {
    const worst = Object.entries(result.failures).sort((x, y) => y[1] - x[1]);
    lines.push(`  failures: ${worst.map(([reason, n]) => `${reason} ×${n}`).join(", ")}`);
  }

  for (const [name, stats] of Object.entries(result.metrics)) {
    lines.push(
      `  ${name}: mean ${stats.mean.toFixed(3)} ± ${stats.stdDev.toFixed(3)} · median ${stats.median.toFixed(3)} · range ${stats.min.toFixed(3)}–${stats.max.toFixed(3)}`,
    );
  }

  if (result.protocol.conditions) {
    const conditions = Object.entries(result.protocol.conditions)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    if (conditions) lines.push(`  conditions: ${conditions}`);
  }

  return lines.join("\n");
}

export type PerturbationAxis = {
  name: string;
  /** The levels to sweep, in increasing severity. Level 0 should be nominal. */
  levels: number[];
  unit?: string;
};

export type SweepResult = {
  axis: string;
  unit?: string;
  points: Array<{ level: number; successRate: number; interval: Interval; trials: number }>;
  /** The level at which the success rate first drops below `threshold`. */
  breakingPoint: number | null;
};

/**
 * Sweep one nuisance variable and report the whole curve.
 *
 * A single success rate on nominal conditions is the number that made everyone
 * stop trusting robot benchmarks: policies that score in the nineties fall into
 * the twenties under a shifted camera or a moved object. One number per axis is
 * the least a result can say honestly.
 */
export async function sweep(
  protocol: Protocol,
  axis: PerturbationAxis,
  runner: (seed: number, level: number) => Promise<{ success: boolean }>,
  threshold = 0.5,
): Promise<SweepResult> {
  const points: SweepResult["points"] = [];
  let breakingPoint: number | null = null;

  for (const level of axis.levels) {
    let successes = 0;
    for (const seed of protocol.seeds) {
      const outcome = await runner(seed, level);
      if (outcome.success) successes += 1;
    }
    const trials = protocol.seeds.length;
    const successRate = trials > 0 ? successes / trials : 0;
    points.push({ level, successRate, interval: wilson(successes, trials), trials });
    if (breakingPoint === null && successRate < threshold) breakingPoint = level;
  }

  return { axis: axis.name, unit: axis.unit, points, breakingPoint };
}
