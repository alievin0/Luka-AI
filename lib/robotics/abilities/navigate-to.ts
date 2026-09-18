// ── navigate.to · التنقل إلى نقطة ───────────────────────────────────────────
// The plain workhorse: get to a point, steering around whatever appears. Most
// of the interesting abilities are built on top of it.

import { distance, type Vec2 } from "../core/math.ts";
import { driveTo } from "./_motion.ts";
import type { Ability, AbilityResult } from "../core/types.ts";

export type NavigateInput = {
  x: number;
  y: number;
  tolerance?: number;
  maxSpeed?: number;
  timeoutMs?: number;
  /** Announce the move first via `motion.telegraph`. */
  telegraph?: boolean;
};

export type NavigateReport = {
  arrived: boolean;
  travelled: number;
  straightLine: number;
  /** travelled / straightLine — 1.0 is a perfect line, higher means detours. */
  pathEfficiency: number;
  elapsedMs: number;
};

export const navigateTo: Ability<NavigateInput, NavigateReport> = {
  manifest: {
    id: "navigate.to",
    version: "1.0.0",
    name: { en: "Navigate To", ar: "التنقل إلى نقطة" },
    summary: {
      en: "Drive to a point in the map, steering around obstacles and people as they appear.",
      ar: "يمشي لنقطة على الخريطة ويتفادى العوائق والناس وقت ما يظهروا.",
    },
    rationale:
      "Reactive local navigation with no prior map. It reports path efficiency, not " +
      "just success, because a robot that arrives after wandering twice as far as " +
      "necessary has told you something important about its perception.",
    tags: ["navigation", "core"],
    risk: "motion",
    requires: ["drive", "lidar"],
    // Having a lidar is not the same as being able to see. This is the
    // capability the safety model leans on hardest, so it says what it needs.
    evidence: [
      {
        source: "lidar",
        because: "everything it avoids, it avoids because the scan showed it",
        maxAgeMs: 500,
        minCompleteness: 0.5,
        acceptDegraded: true,
      },
      {
        source: "pose",
        because: "a goal in world coordinates is meaningless without knowing where the robot is",
      },
      {
        source: "transport",
        because: "a command that does not arrive is not a command",
        acceptDegraded: true,
      },
    ],
    proof: {
      status: "SIMULATED",
      basis:
        "1.02x path efficiency and zero collisions across the cluttered-office and corridor " +
        "scenarios, over five seeds. Simulator only; no physical robot has run this.",
      verification:
        "Drive a measured course on a real robot with a tape-measured start and finish, and " +
        "compare travelled distance against the straight line. Repeat with an obstacle added " +
        "after planning has started.",
      failureModes: [
        "A lidar whose extrinsics are wrong reports obstacles in the wrong place, and the robot " +
          "avoids things that are not there while driving into things that are.",
        "Guessed wheelbase or wheel radius makes odometry drift, so the goal moves relative to " +
          "the robot as it travels.",
        "Narrow gaps: the swept-disc clearance uses one footprint radius and will refuse a gap " +
          "an oblong robot could actually pass through.",
      ],
      degradedModes: [
        "Accepts a scan with half its beams answering, which narrows the field it can plan in " +
          "rather than stopping it.",
      ],
      safetyBoundary:
        "Never commands a speed above what the governor allows for the current clearance, and " +
        "never drives on a scan below half completeness.",
    },
    typicalDurationMs: 12_000,
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Goal X in metres." },
        y: { type: "number", description: "Goal Y in metres." },
        tolerance: { type: "number", description: "Arrival radius, m.", default: 0.3 },
        maxSpeed: { type: "number", description: "Speed cap, m/s.", default: 0.8 },
        timeoutMs: { type: "number", description: "Give up after this long.", default: 60000 },
        telegraph: {
          type: "boolean",
          description: "Signal the move to nearby people first.",
          default: false,
        },
      },
      required: ["x", "y"],
    },
  },

  async run(input, ctx): Promise<AbilityResult<NavigateReport>> {
    const goal: Vec2 = { x: input.x, y: input.y };
    const start = ctx.robot.pose();
    const straightLine = distance(start, goal);

    if (input.telegraph) {
      await ctx.call("motion.telegraph", { x: goal.x, y: goal.y });
    }

    ctx.robot.setLights("travelling", "#22c55e");
    ctx.emit({ kind: "mark", label: "goal", at: goal });

    let lastReport = 0;
    const outcome = await driveTo(ctx, goal, {
      tolerance: input.tolerance ?? 0.3,
      maxLinear: input.maxSpeed ?? 0.8,
      timeoutMs: input.timeoutMs ?? 60_000,
      onStep: ({ remaining, detouring }) => {
        if (ctx.now() - lastReport > 900) {
          lastReport = ctx.now();
          ctx.emit({ kind: "pose", pose: ctx.robot.pose() });
          ctx.emit({
            kind: "status",
            message: `${remaining.toFixed(1)} m to go${detouring ? " (going around something)" : ""}`,
            ar: `باقي ${remaining.toFixed(1)} متر${detouring ? " (عم يلف حول عائق)" : ""}`,
          });
        }
      },
    });

    const report: NavigateReport = {
      arrived: outcome.ok,
      travelled: outcome.travelled,
      straightLine,
      pathEfficiency: straightLine > 0.05 ? outcome.travelled / straightLine : 1,
      elapsedMs: outcome.elapsedMs,
    };

    ctx.robot.setLights("idle", "#3b82f6");
    ctx.emit({ kind: "metric", name: "path.efficiency", value: report.pathEfficiency });

    if (!outcome.ok) {
      return {
        ok: false,
        summary: `Could not reach (${goal.x.toFixed(1)}, ${goal.y.toFixed(1)}) — ${outcome.reason}.`,
        failure: outcome.reason === "timeout" ? "timeout" : outcome.reason === "aborted" ? "aborted" : "gave-up",
        data: report,
      };
    }

    return {
      ok: true,
      summary: `Arrived at (${goal.x.toFixed(1)}, ${goal.y.toFixed(1)}) — ${report.travelled.toFixed(1)} m travelled, ${report.pathEfficiency.toFixed(2)}× the straight line.`,
      data: report,
      metrics: { travelled: report.travelled, pathEfficiency: report.pathEfficiency },
    };
  },
};
