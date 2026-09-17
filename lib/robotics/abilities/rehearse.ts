// ── plan.rehearse · البروفة الذهنية ─────────────────────────────────────────
// Thinking before moving.
//
// The robot has a model of itself and its world, so before committing a plan to
// real motors it runs that plan a hundred times inside the model, each time
// with a different random seed and noisier sensors than it actually has. What
// comes back is not "will this work" — it is a distribution: this plan succeeds
// 94% of the time, the 6% are all the same failure, and here is what it is.
//
// The refusal is the valuable part. A plan that works in ninety-four rehearsals
// and strands the robot in six is a plan you want to hear about beforehand.

import type { Ability, AbilityResult } from "../core/types.ts";

export type PlanStep = { ability: string; input?: Record<string, unknown> };

export type RehearseInput = {
  plan: PlanStep[];
  /** How many times to run it in the model. */
  trials?: number;
  /** Minimum success rate to call the plan safe, 0..1. */
  successThreshold?: number;
  /**
   * Sensor noise multiplier for rehearsals. Above 1 deliberately rehearses a
   * worse robot than the real one, which is the point: a plan that only works
   * with perfect sensing is not a plan.
   */
  noise?: number;
};

export type RehearseReport = {
  trials: number;
  successes: number;
  successRate: number;
  verdict: "go" | "no-go" | "unavailable";
  /** Failure reasons and how often each occurred. */
  failureModes: Array<{ reason: string; count: number; share: number }>;
  medianDurationMs: number;
  worstDurationMs: number;
  meanCollisions: number;
  /** Which step failed most often, if any. */
  weakestStep: { index: number; ability: string; failures: number } | null;
};

export const rehearsePlan: Ability<RehearseInput, RehearseReport> = {
  manifest: {
    id: "plan.rehearse",
    version: "1.0.0",
    name: { en: "Mental Rehearsal", ar: "البروفة الذهنية" },
    summary: {
      en: "Runs a plan hundreds of times inside a forked copy of the world before touching a motor, and reports the odds instead of a guess.",
      ar: "بيجرّب الخطة مئات المرات جوّا نسخة من العالم قبل ما يحرّك محرك، وبيعطيك الاحتمالات مو تخمين.",
    },
    rationale:
      "Robots are usually tested by running them, which means every test costs real " +
      "time and risks real damage. But the robot already carries a model of itself, and " +
      "simulated time is nearly free — a minute-long mission rehearses in milliseconds. " +
      "Running the plan many times with different seeds turns a plan review into a " +
      "measurement: the success rate, the failure that dominates, and the step that " +
      "causes it. Rehearsing with deliberately degraded sensors finds the plans that " +
      "only work on a good day.",
    tags: ["planning", "verification", "simulation"],
    risk: "passive",
    requires: [],
    typicalDurationMs: 3000,
    inputSchema: {
      type: "object",
      properties: {
        plan: {
          type: "array",
          description: "The sequence of abilities to rehearse.",
          items: {
            type: "object",
            properties: {
              ability: { type: "string", description: "Ability id." },
              input: { type: "object", description: "Input for that ability." },
            },
            required: ["ability"],
          },
        },
        trials: { type: "number", description: "Rehearsals to run.", default: 40 },
        successThreshold: {
          type: "number",
          description: "Success rate needed for a go verdict.",
          default: 0.9,
        },
        noise: { type: "number", description: "Sensor noise multiplier.", default: 1.4 },
      },
      required: ["plan"],
    },
  },

  async run(input, ctx): Promise<AbilityResult<RehearseReport>> {
    const trials = Math.max(1, Math.min(input.trials ?? 40, 500));
    const threshold = input.successThreshold ?? 0.9;
    const noise = input.noise ?? 1.4;

    const empty: RehearseReport = {
      trials: 0,
      successes: 0,
      successRate: 0,
      verdict: "unavailable",
      failureModes: [],
      medianDurationMs: 0,
      worstDurationMs: 0,
      meanCollisions: 0,
      weakestStep: null,
    };

    if (!ctx.twin) {
      return {
        ok: false,
        summary:
          "No model of the world to rehearse in — this robot can only learn by doing. Run the plan on hardware with the reflex shield up, or attach a simulator.",
        failure: "precondition",
        data: empty,
      };
    }

    if (input.plan.length === 0) {
      return { ok: false, summary: "Nothing to rehearse.", failure: "precondition", data: empty };
    }

    const unknown = input.plan.filter((step) => step.ability === "plan.rehearse");
    if (unknown.length > 0) {
      return {
        ok: false,
        summary: "A plan cannot rehearse itself.",
        failure: "precondition",
        data: empty,
      };
    }

    const durations: number[] = [];
    const collisions: number[] = [];
    const failures = new Map<string, number>();
    const stepFailures = new Map<number, number>();
    let successes = 0;

    ctx.emit({
      kind: "status",
      message: `Rehearsing ${input.plan.length}-step plan ${trials}× at ${noise.toFixed(1)}× sensor noise…`,
      ar: `عم أجرّب خطة من ${input.plan.length} خطوة ${trials} مرة مع ضجيج ${noise.toFixed(1)}×…`,
    });

    for (let trial = 0; trial < trials; trial += 1) {
      if (ctx.signal.aborted) break;

      const twin = ctx.twin({ seed: 1000 + trial * 7919, noise });
      if (!twin) break;

      let failed: { reason: string; step: number } | null = null;

      for (let index = 0; index < input.plan.length; index += 1) {
        const step = input.plan[index];
        const result = await twin.run(step.ability, step.input ?? {});
        if (!result.ok) {
          failed = { reason: result.failure ?? "failed", step: index };
          break;
        }
      }

      await twin.stopDaemons("rehearsal finished");
      const state = twin.state();
      durations.push(state.timeMs);
      collisions.push(state.collisions);

      if (failed) {
        failures.set(failed.reason, (failures.get(failed.reason) ?? 0) + 1);
        stepFailures.set(failed.step, (stepFailures.get(failed.step) ?? 0) + 1);
      } else {
        successes += 1;
      }

      // Rehearsals are cheap but not free; yield so a long batch stays abortable.
      if (trial % 5 === 4) await ctx.sleep(0);
    }

    const ran = durations.length;
    const successRate = ran > 0 ? successes / ran : 0;
    durations.sort((a, b) => a - b);

    const weakest = [...stepFailures.entries()].sort((a, b) => b[1] - a[1])[0];
    const report: RehearseReport = {
      trials: ran,
      successes,
      successRate,
      verdict: successRate >= threshold ? "go" : "no-go",
      failureModes: [...failures.entries()]
        .map(([reason, count]) => ({ reason, count, share: count / Math.max(ran, 1) }))
        .sort((a, b) => b.count - a.count),
      medianDurationMs: ran > 0 ? durations[Math.floor(ran / 2)] : 0,
      worstDurationMs: ran > 0 ? durations[ran - 1] : 0,
      meanCollisions:
        ran > 0 ? collisions.reduce((sum, c) => sum + c, 0) / ran : 0,
      weakestStep: weakest
        ? {
            index: weakest[0],
            ability: input.plan[weakest[0]].ability,
            failures: weakest[1],
          }
        : null,
    };

    ctx.emit({ kind: "metric", name: "rehearse.successRate", value: successRate });

    const headline = `${(successRate * 100).toFixed(0)}% of ${ran} rehearsals succeeded (median ${(report.medianDurationMs / 1000).toFixed(1)} s, worst ${(report.worstDurationMs / 1000).toFixed(1)} s)`;
    const diagnosis = report.weakestStep
      ? ` The failures concentrate on step ${report.weakestStep.index + 1} (${report.weakestStep.ability}), mostly "${report.failureModes[0]?.reason}".`
      : "";

    return {
      ok: report.verdict === "go",
      summary:
        report.verdict === "go"
          ? `Go — ${headline}.${diagnosis}`
          : `No-go — ${headline}, below the ${(threshold * 100).toFixed(0)}% bar.${diagnosis} Fix that step before running this for real.`,
      data: report,
      failure: report.verdict === "go" ? undefined : "unsafe",
      metrics: {
        successRate,
        medianDurationMs: report.medianDurationMs,
        meanCollisions: report.meanCollisions,
      },
    };
  },
};
