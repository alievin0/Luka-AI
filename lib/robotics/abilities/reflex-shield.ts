// ── reflex.shield · درع الانعكاس ────────────────────────────────────────────
// A daemon that runs underneath everything else and watches the world faster
// than any deliberative ability can think. It does not plan; it computes how
// long until something bad happens and takes the wheel when that number gets
// small.

import { clamp } from "../core/math.ts";
import { nearestObstacle } from "../safety/governor.ts";
import type { Ability, AbilityContext, AbilityResult } from "../core/types.ts";

export type ReflexInput = {
  /** Control period in ms. Real reflexes are fast; 20 ms = 50 Hz. */
  periodMs?: number;
  /** Latch a full emergency stop when time-to-collision drops below this (s). */
  brakeTtc?: number;
  /** Stop the mission entirely after this many interventions. */
  interventionBudget?: number;
  /** Back away when a person comes closer than this, metres. */
  yieldDistance?: number;
};

export type ReflexReport = {
  interventions: number;
  minObstacleDistance: number;
  minHumanDistance: number;
  minTtc: number;
  emergencyStops: number;
  ticks: number;
};

const manifest = {
  id: "reflex.shield",
  version: "1.0.0",
  name: { en: "Reflex Shield", ar: "درع الانعكاس" },
  summary: {
    en: "A 50 Hz guardian loop that measures time-to-collision and overrides the motors before anything else notices.",
    ar: "حلقة حماية بتشتغل ٥٠ مرة بالثانية، بتحسب الوقت المتبقي للاصطدام وبتتحكم بالمحركات قبل ما ينتبه غيرها.",
  },
  rationale:
    "Most robot injuries happen in the gap between perceiving a hazard and finishing " +
    "the thought about it. The shield removes that gap: it never reasons about goals, " +
    "it only answers 'how many milliseconds until contact' and brakes. It runs as a " +
    "daemon so every other ability inherits it for free, and it keeps a record of how " +
    "often it had to intervene — a number that tells you whether the rest of the stack " +
    "is behaving.",
  tags: ["safety", "daemon", "reactive"],
  risk: "critical" as const,
  requires: ["drive" as const, "lidar" as const],
  typicalDurationMs: 0,
  daemon: true,
  inputSchema: {
    type: "object" as const,
    properties: {
      periodMs: { type: "number" as const, description: "Control period, ms.", default: 20 },
      brakeTtc: {
        type: "number" as const,
        description: "Emergency-stop threshold on time-to-collision, seconds.",
        default: 0.45,
      },
      interventionBudget: {
        type: "number" as const,
        description: "How many braking episodes before the shield gives up and stops the mission.",
        default: 12,
      },
      yieldDistance: {
        type: "number" as const,
        description: "Back away when someone comes closer than this, metres.",
        default: 0.45,
      },
    },
    required: [],
  },
};

export const reflexShield: Ability<ReflexInput, ReflexReport> = {
  manifest,

  async run(input, ctx): Promise<AbilityResult<ReflexReport>> {
    const periodMs = input.periodMs ?? 20;
    const brakeTtc = input.brakeTtc ?? 0.45;
    const budget = input.interventionBudget ?? 12;
    const yieldDistance = input.yieldDistance ?? 0.45;

    const report: ReflexReport = {
      interventions: 0,
      minObstacleDistance: Number.POSITIVE_INFINITY,
      minHumanDistance: Number.POSITIVE_INFINITY,
      minTtc: Number.POSITIVE_INFINITY,
      emergencyStops: 0,
      ticks: 0,
    };

    let previousLevel = "clear";
    // An intervention is a braking *episode*, not a control cycle. Counting
    // cycles would turn one pedestrian stepping in front of the robot into
    // fifty "near misses" and burn the whole budget in a second.
    let braking = false;

    while (!ctx.signal.aborted) {
      report.ticks += 1;

      const scan = ctx.robot.lidar();
      const obstacle = nearestObstacle(scan);
      const speed = ctx.robot.velocity().linear;
      const humans = ctx.robot.trackHumans();
      const nearestHuman = humans.length > 0 ? humans[0].distance : Number.POSITIVE_INFINITY;

      report.minObstacleDistance = Math.min(report.minObstacleDistance, obstacle);
      report.minHumanDistance = Math.min(report.minHumanDistance, nearestHuman);

      // Time-to-collision against geometry, and against the closest person
      // including their own closing velocity.
      const ttcObstacle = speed > 0.02 ? obstacle / speed : Number.POSITIVE_INFINITY;
      const ttcHuman = closingTtc(ctx, nearestHuman, speed, humans[0]?.velocity);
      const ttc = Math.min(ttcObstacle, ttcHuman);
      if (Number.isFinite(ttc)) report.minTtc = Math.min(report.minTtc, ttc);

      const verdict = ctx.safety.verdict();
      if (verdict.level !== previousLevel) {
        ctx.emit({ kind: "safety", level: verdict.level, reason: verdict.reason });
        previousLevel = verdict.level;
      }

      // Someone inside the envelope of a robot that has already stopped can
      // only be resolved by the robot: standing still is not a safe state when
      // the gap is still closing. Reversing always increases separation, so the
      // shield yields ground rather than waiting to be walked into.
      const yielding = nearestHuman < yieldDistance && rearIsClear(scan);
      if (yielding) {
        ctx.safety.takeWheel(-0.22, 0, "reflex: yielding ground");
        ctx.robot.drive(-0.22, 0);
        ctx.robot.setLights("yielding", "#f59e0b");
      }

      if (ttc < brakeTtc) {
        // Hold the robot still for as long as the hazard lasts.
        if (!yielding) {
          ctx.safety.takeWheel(0, 0, "reflex: braking");
          ctx.robot.stop();
        }

        if (!braking) {
          braking = true;
          report.interventions += 1;
          ctx.robot.setLights("alarm", "#ef4444");
          ctx.emit({
            kind: "safety",
            level: "stop",
            reason: `reflex brake — ${(ttc * 1000).toFixed(0)} ms to contact`,
          });

          // A single close call is a reflex. A pattern of them is a broken plan.
          if (report.interventions >= budget) {
            report.emergencyStops += 1;
            ctx.safety.emergencyStop(
              `reflex shield intervened ${report.interventions} times — the plan is not safe`,
            );
            ctx.emit({
              kind: "warn",
              message: "Reflex shield latched an emergency stop: too many near misses.",
            });
            // Stop the mission too, rather than leaving it to spin against a
            // robot that will no longer move.
            ctx.escalate("reflex shield: too many near misses to continue");
            break;
          }
        }
      } else if (!yielding) {
        if (braking && ttc > brakeTtc * 1.5) {
          // Hysteresis on the way out, so a hazard hovering at the threshold is
          // one episode rather than a stutter of them.
          braking = false;
          ctx.robot.setLights("travelling", "#22c55e");
          ctx.emit({ kind: "safety", level: "clear", reason: "hazard passed — releasing" });
        }
        if (!braking) ctx.safety.releaseWheel();
      }

      await ctx.sleep(periodMs);
    }

    ctx.safety.releaseWheel();
    ctx.emit({
      kind: "metric",
      name: "reflex.interventions",
      value: report.interventions,
    });

    return {
      ok: report.emergencyStops === 0,
      summary:
        report.interventions === 0
          ? `Shield ran ${report.ticks} cycles with nothing to do — closest approach ${fmt(report.minObstacleDistance)} m.`
          : `Shield intervened ${report.interventions}× (closest ${fmt(report.minObstacleDistance)} m, tightest margin ${fmt(report.minTtc)} s).`,
      data: report,
      metrics: {
        interventions: report.interventions,
        minObstacleDistance: report.minObstacleDistance,
        minHumanDistance: report.minHumanDistance,
      },
    };
  },
};

/** Time to contact with a person, accounting for their velocity toward us. */
function closingTtc(
  ctx: AbilityContext,
  distanceToHuman: number,
  robotSpeed: number,
  humanVelocity?: { x: number; y: number },
): number {
  if (!Number.isFinite(distanceToHuman)) return Number.POSITIVE_INFINITY;
  const pose = ctx.robot.pose();
  const humans = ctx.robot.trackHumans();
  if (humans.length === 0) return Number.POSITIVE_INFINITY;

  const human = humans[0];
  const toRobotX = pose.x - human.at.x;
  const toRobotY = pose.y - human.at.y;
  const norm = Math.hypot(toRobotX, toRobotY) || 1;
  const humanClosing = humanVelocity
    ? (humanVelocity.x * toRobotX + humanVelocity.y * toRobotY) / norm
    : 0;

  // Only the component of our own motion pointing at them counts.
  const robotClosing =
    robotSpeed *
    Math.cos(Math.atan2(human.at.y - pose.y, human.at.x - pose.x) - pose.theta);

  const closing = Math.max(robotClosing, 0) + Math.max(humanClosing, 0);
  const gap = clamp(distanceToHuman - 0.3, 0, Number.POSITIVE_INFINITY);
  return closing > 0.02 ? gap / closing : Number.POSITIVE_INFINITY;
}

/** Is there room to back up? The lidar's rear beams have to say so. */
function rearIsClear(scan: { ranges: number[]; fov: number }, needed = 0.6): boolean {
  const { ranges, fov } = scan;
  if (ranges.length === 0) return false;
  const step = fov / Math.max(ranges.length - 1, 1);
  let sawRear = false;
  for (let i = 0; i < ranges.length; i += 1) {
    const angle = -fov / 2 + i * step;
    if (Math.abs(angle) < (Math.PI * 2) / 3) continue;
    sawRear = true;
    if (ranges[i] < needed) return false;
  }
  // A sensor that cannot see behind cannot authorise reversing.
  return sawRear;
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "∞";
}
