// ── learn.demo · التعلّم بالتقليد ────────────────────────────────────────────
// Show the robot a movement once. It keeps the *shape* of what you did, not the
// coordinates, so it can do the same thing somewhere else, at a different
// speed, from a different starting point.
//
// Under the hood this is a Dynamic Movement Primitive (`core/dmp.ts`): a goal
// attractor plus a learned forcing term that fades as the motion completes.
// The consequence is that a taught skill cannot run away — however far you move
// the target, the motion still converges on it.

import { fitDmp, rolloutDmp, trajectoryRmse, type DmpModel, type DemoPoint } from "../core/dmp.ts";
import type { Ability, AbilityResult } from "../core/types.ts";

export type LearnInput = {
  op?: "teach" | "replay" | "list" | "forget";
  /** Skill name, e.g. "pour" or "wipe". */
  name?: string;
  /**
   * The demonstration: samples of the end-effector as a human guided it.
   * `[{ t: seconds, x, y, z }]` in the robot's body frame.
   */
  demonstration?: Array<{ t: number; x: number; y: number; z: number }>;
  /** Replay target; defaults to the demonstrated endpoint. */
  goal?: { x: number; y: number; z: number };
  /** Replay duration in seconds; defaults to the demonstrated duration. */
  durationSec?: number;
  basisCount?: number;
};

export type LearnReport = {
  op: string;
  name?: string;
  skills: string[];
  /** How faithfully a same-goal replay reproduces the demonstration, metres. */
  reproductionRmse?: number;
  /** Distance between where the replay ended and where it was asked to end. */
  goalError?: number;
  waypoints?: number;
  durationSec?: number;
};

const KEY = (name: string) => `skill:${name.toLowerCase()}`;

export const learnFromDemo: Ability<LearnInput, LearnReport> = {
  manifest: {
    id: "learn.demo",
    version: "1.0.0",
    name: { en: "Learn From Demonstration", ar: "التعلّم بالتقليد" },
    summary: {
      en: "Watch a movement once, keep its shape as a dynamic movement primitive, then perform it toward any new target, at any speed.",
      ar: "بيشوف الحركة مرة وحدة، بيحفظ شكلها كنمط حركة ديناميكي، وبعدين بينفّذها لأي هدف جديد وبأي سرعة.",
    },
    rationale:
      "Programming a robot arm by typing coordinates does not scale past the person " +
      "who typed them. Demonstration does: anyone who can do the task can teach it. " +
      "Storing the demonstration as a dynamical system rather than a list of points is " +
      "what makes it transferable — the style survives a change of goal, the motion is " +
      "guaranteed to converge, and an interrupted replay can resume from wherever the " +
      "arm actually is instead of restarting.",
    tags: ["learning", "manipulation", "imitation"],
    risk: "motion",
    requires: ["arm"],
    typicalDurationMs: 4000,
    inputSchema: {
      type: "object",
      properties: {
        op: {
          type: "string",
          description: "teach | replay | list | forget",
          enum: ["teach", "replay", "list", "forget"],
          default: "replay",
        },
        name: { type: "string", description: "Name of the skill." },
        demonstration: {
          type: "array",
          description: "Samples of the guided motion: t (s), x, y, z (m).",
          items: {
            type: "object",
            properties: {
              t: { type: "number" },
              x: { type: "number" },
              y: { type: "number" },
              z: { type: "number" },
            },
            required: ["t", "x", "y", "z"],
          },
        },
        goal: {
          type: "object",
          description: "Where the replay should end up.",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" },
          },
          required: ["x", "y", "z"],
        },
        durationSec: { type: "number", description: "Replay duration, seconds." },
        basisCount: { type: "number", description: "Detail of the fit.", default: 30 },
      },
      required: [],
    },
  },

  async run(input, ctx): Promise<AbilityResult<LearnReport>> {
    const op = input.op ?? "replay";
    const skills = () =>
      ctx.memory.keys("skill:").map((key) => key.replace("skill:", ""));

    if (op === "list") {
      const names = skills();
      return {
        ok: true,
        summary: names.length
          ? `Knows ${names.length} taught skill(s): ${names.join(", ")}.`
          : "No taught skills yet — show me one.",
        data: { op, skills: names },
      };
    }

    if (op === "forget") {
      if (!input.name) {
        return { ok: false, summary: "forget needs a skill name.", failure: "precondition" };
      }
      ctx.memory.delete(KEY(input.name));
      return {
        ok: true,
        summary: `Forgot the skill "${input.name}".`,
        data: { op, name: input.name, skills: skills() },
      };
    }

    if (op === "teach") {
      if (!input.name || !input.demonstration || input.demonstration.length < 4) {
        return {
          ok: false,
          summary: "teach needs a name and a demonstration of at least four samples.",
          failure: "precondition",
        };
      }

      const demo: DemoPoint[] = input.demonstration.map((p) => ({
        t: p.t,
        values: [p.x, p.y, p.z],
      }));

      const model = fitDmp(demo, { basisCount: input.basisCount ?? 30 });
      ctx.memory.set<DmpModel>(KEY(input.name), model);

      // Immediately check the fit by replaying it in the abstract — a skill that
      // cannot reproduce its own demonstration is not worth storing silently.
      const check = rolloutDmp(model);
      const rmse = trajectoryRmse(demo, check);

      ctx.emit({ kind: "metric", name: "learn.rmse", value: rmse, unit: "m" });
      ctx.emit({
        kind: "status",
        message: `Learned "${input.name}" from ${demo.length} samples`,
        ar: `تعلّمت "${input.name}" من ${demo.length} عيّنة`,
      });

      return {
        ok: rmse < 0.05,
        summary:
          rmse < 0.05
            ? `Learned "${input.name}" — reproduces the demonstration to ${(rmse * 1000).toFixed(0)} mm over ${model.tau.toFixed(1)} s.`
            : `Learned "${input.name}" but the fit is loose (${(rmse * 1000).toFixed(0)} mm) — demonstrate it again, more smoothly.`,
        data: {
          op,
          name: input.name,
          skills: skills(),
          reproductionRmse: rmse,
          waypoints: demo.length,
          durationSec: model.tau,
        },
        metrics: { rmse },
      };
    }

    // replay
    if (!input.name) {
      return { ok: false, summary: "replay needs a skill name.", failure: "precondition" };
    }
    const model = ctx.memory.get<DmpModel>(KEY(input.name));
    if (!model) {
      return {
        ok: false,
        summary: `I was never taught "${input.name}". Known: ${skills().join(", ") || "none"}.`,
        failure: "not-found",
        data: { op, name: input.name, skills: skills() },
      };
    }

    // Start from where the arm actually is, so an interrupted replay resumes
    // gracefully instead of snapping back to the demonstrated start.
    const arm = ctx.robot.arm();
    const start = [arm.tip.x, arm.tip.y, arm.height];
    const goal = input.goal
      ? [input.goal.x, input.goal.y, input.goal.z]
      : model.goal;
    const tau = input.durationSec ?? model.tau;

    const trajectory = rolloutDmp(model, { start, goal, tau, dt: 0.04 });

    ctx.robot.setLights("working", "#a855f7");
    ctx.emit({
      kind: "status",
      message: `Replaying "${input.name}" toward (${goal.map((v) => v.toFixed(2)).join(", ")})`,
      ar: `عم أعيد "${input.name}" باتجاه (${goal.map((v) => v.toFixed(2)).join("، ")})`,
    });

    let previousT = 0;
    for (const point of trajectory) {
      if (ctx.signal.aborted) {
        return { ok: false, summary: `Replay of "${input.name}" aborted.`, failure: "aborted" };
      }
      ctx.robot.moveArm({ x: point.values[0], y: point.values[1] }, point.values[2]);
      await ctx.sleep(Math.max((point.t - previousT) * 1000, 10));
      previousT = point.t;
    }

    // Let the arm finish converging on the last commanded point.
    await ctx.sleep(300);

    const finalArm = ctx.robot.arm();
    const goalError = Math.hypot(
      finalArm.tip.x - goal[0],
      finalArm.tip.y - goal[1],
      finalArm.height - goal[2],
    );

    ctx.robot.setLights("idle", "#3b82f6");
    ctx.emit({ kind: "metric", name: "learn.goalError", value: goalError, unit: "m" });

    return {
      ok: goalError < 0.12,
      summary: `Performed "${input.name}" in ${tau.toFixed(1)} s — finished ${(goalError * 1000).toFixed(0)} mm from the target.`,
      data: {
        op,
        name: input.name,
        skills: skills(),
        goalError,
        waypoints: trajectory.length,
        durationSec: tau,
      },
      metrics: { goalError, waypoints: trajectory.length },
      failure: goalError < 0.12 ? undefined : "gave-up",
    };
  },
};
