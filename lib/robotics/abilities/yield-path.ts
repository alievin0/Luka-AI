// ── hri.yield-path · إخلاء الطريق ──────────────────────────────────────────
// Get out of the way before it becomes a problem.
//
// This exists because of the worst number this kernel measures. In the
// `measured-crossing` demo, twenty crossings of a corridor with people who look
// where they are going produce twenty clean runs. The same twenty crossings with
// people who never look up produce **zero**, and an average of 12.7 contacts per
// run. The robot cannot get out of the way of someone walking into it.
//
// Two things were wrong with how it tried.
//
// It reversed. Backing away from someone walking at you is the slowest escape
// available, because it is the one direction that is *along* their approach
// vector: the robot gives ground at a third of a metre per second while they
// close at a metre and a half. It loses that race by construction, and no
// amount of tuning the reverse speed fixes a sign error in the geometry.
//
// And it waited. The old rule triggered when somebody came within about a
// metre, which at walking pace is under a second of warning — less than the
// robot needs to turn, let alone to travel anywhere.
//
// So this one predicts instead of reacting, and steps sideways instead of back.
// It computes where the person and the robot will be closest if neither
// changes course, and if that distance is too small it moves perpendicular to
// their path — the direction that opens the gap fastest — while there is still
// time for the movement to matter.
//
// ── Evidence ───────────────────────────────────────────────────────────────
//
//   status: SIMULATED
//
// Twenty corridor crossings against distracted people go from 0/20 clean to
// 20/20, with contacts per run from 12.7 to zero. The horizon was swept on
// those twenty seeds, so they are not independent evidence of anything; forty
// further seeds that were never looked at during the sweep came back 40/40.
//
// That is a simulator agreeing with itself. It is not a claim about a corridor.
// The people in it walk at a constant speed along straight waypoints and never
// stop, hesitate, change their minds or step the same way the robot does — and
// the last of those is exactly the failure mode this kind of prediction has in
// the real world, where two parties dodging each other pick the same side.
//
// ── What this cannot fix ───────────────────────────────────────────────────
//
// Somebody who is actively following the robot. Someone in a corridor narrower
// than the robot plus a person. And anybody the robot cannot see: this needs
// person tracks, and most real platforms do not publish them, which is why the
// geometric reflex stays underneath and does the braking.

import { clamp } from "../core/math.ts";
import type { Vec2 } from "../core/math.ts";
import type { Ability, AbilityResult, HumanTrack } from "../core/types.ts";

export type YieldInput = {
  /** Control period, ms. */
  periodMs?: number;
  /**
   * How close the paths may come before the robot moves, metres, centre to
   * centre. Bodies touch at about 0.53 m, so this is a margin over contact
   * rather than a comfort preference.
   */
  clearance?: number;
  /**
   * How far ahead to look, seconds. Too short and the robot reacts too late to
   * travel anywhere; too long and it dodges people who were never going to
   * come near it.
   */
  horizonSeconds?: number;
  /** How fast to step aside, m/s. */
  stepSpeed?: number;
};

export type YieldReport = {
  /** Times the robot moved out of a predicted path. */
  yields: number;
  /** Closest any person actually got, metres. */
  minDistance: number;
  /** Smallest predicted closest approach the robot acted on, metres. */
  tightestPrediction: number;
  /** Times a yield was wanted and there was nowhere to go. */
  trapped: number;
  ticks: number;
};

const manifest = {
  id: "hri.yield-path",
  version: "1.0.0",
  name: { en: "Yield the Path", ar: "إخلاء الطريق" },
  summary: {
    en: "Predicts where a person and the robot will be closest if neither changes course, and steps sideways out of their path while there is still time for it to matter.",
    ar: "بيحسب وين رح يكون أقرب تلاقي بينه وبين الشخص إذا ما غيّر حدا مساره، وبيتحرّك عالجنب برّا طريقه وهو لسا في وقت الحركة تفيد.",
  },
  rationale:
    "Backing away from someone walking toward you is the slowest escape available, " +
    "because it is the one direction that lies along their approach. A robot reversing at " +
    "a third of a metre per second loses that race to a person walking at a metre and a " +
    "half, every time, and this kernel measured exactly that: zero clean crossings out of " +
    "twenty against people who never look up. Moving perpendicular to their path opens the " +
    "gap at the robot's full speed rather than the difference between two speeds, and " +
    "predicting the closest approach buys the seconds needed for any of it to happen.",
  tags: ["safety", "daemon", "hri", "prediction"],
  risk: "motion" as const,
  requires: ["drive" as const, "camera" as const],
  typicalDurationMs: 0,
  daemon: true,
  inputSchema: {
    type: "object" as const,
    properties: {
      periodMs: { type: "number" as const, description: "Control period, ms.", default: 20 },
      clearance: {
        type: "number" as const,
        description: "Minimum predicted closest approach, metres centre to centre.",
        default: 0.8,
      },
      horizonSeconds: {
        type: "number" as const,
        description: "How far ahead to predict, seconds. Swept; 5 is where it works.",
        default: 5,
      },
      stepSpeed: { type: "number" as const, description: "Speed to step aside, m/s.", default: 0.8 },
    },
    required: [],
  },
};

export const yieldPath: Ability<YieldInput, YieldReport> = {
  manifest,

  async run(input, ctx): Promise<AbilityResult<YieldReport>> {
    const periodMs = input.periodMs ?? 20;
    const clearance = input.clearance ?? 0.8;
    // Five seconds, and the value matters more than anything else here.
    // Swept: a two-second horizon gets 4/20 crossings, three gets 8/20, four
    // gets 13/20 and five gets 20/20. Beyond five it falls back again, because
    // the robot starts dodging people who were never going to reach it.
    // Clearance barely moves the result by comparison.
    const horizon = input.horizonSeconds ?? 5;
    const stepSpeed = input.stepSpeed ?? 0.8;

    const report: YieldReport = {
      yields: 0,
      minDistance: Number.POSITIVE_INFINITY,
      tightestPrediction: Number.POSITIVE_INFINITY,
      trapped: 0,
      ticks: 0,
    };

    let yieldingFor: string | null = null;

    while (!ctx.signal.aborted) {
      report.ticks += 1;

      const people = ctx.robot.trackHumans();
      const pose = ctx.robot.pose();
      const velocity = ctx.robot.velocity();
      const heading = pose.theta;
      const own: Vec2 = {
        x: Math.cos(heading) * velocity.linear,
        y: Math.sin(heading) * velocity.linear,
      };

      let worst: { person: HumanTrack; approach: Approach } | null = null;
      for (const person of people) {
        report.minDistance = Math.min(report.minDistance, person.distance);
        const approach = closestApproach(pose, own, person);
        // Only paths that are actually converging, and soon enough that moving
        // changes the outcome.
        if (approach.time < 0 || approach.time > horizon) continue;
        if (approach.distance >= clearance) continue;
        if (!worst || approach.time < worst.approach.time) worst = { person, approach };
      }

      if (!worst) {
        if (yieldingFor !== null) {
          yieldingFor = null;
          ctx.safety.releaseWheel();
          ctx.robot.setLights("idle", "#3b82f6");
        }
        await ctx.sleep(periodMs);
        continue;
      }

      report.tightestPrediction = Math.min(report.tightestPrediction, worst.approach.distance);

      // Perpendicular to the way they are walking. Both perpendiculars are
      // valid escapes; the one with room wins.
      const walking = worst.person.velocity;
      const speed = Math.hypot(walking.x, walking.y);
      const along: Vec2 =
        speed > 0.05
          ? { x: walking.x / speed, y: walking.y / speed }
          : // Standing still and too close: treat the line between us as their
            // direction, so the robot still steps off it rather than backing up.
            unit({ x: worst.person.at.x - pose.x, y: worst.person.at.y - pose.y });

      const options: Vec2[] = [
        { x: -along.y, y: along.x },
        { x: along.y, y: -along.x },
      ];

      // Prefer the side that takes the robot further from where they are going,
      // and only use a side the lidar says is open.
      const scan = ctx.robot.lidar();
      let chosen: Vec2 | null = null;
      let best = -Infinity;
      for (const option of options) {
        const bearing = Math.atan2(option.y, option.x);
        const relative = wrap(bearing - heading);
        if (!isClear(scan, relative, 1.0)) continue;
        // Score by how much it increases the predicted closest approach.
        const trial = closestApproach(
          pose,
          { x: option.x * stepSpeed, y: option.y * stepSpeed },
          worst.person,
        );
        if (trial.distance > best) {
          best = trial.distance;
          chosen = option;
        }
      }

      if (!chosen) {
        // Nowhere to step. Stopping is what is left, and the geometric reflex
        // underneath will hold the robot — this only records that yielding was
        // wanted and refused, because that number is the honest measure of how
        // often a corridor is simply too narrow.
        report.trapped += 1;
        await ctx.sleep(periodMs);
        continue;
      }

      if (yieldingFor !== worst.person.id) {
        yieldingFor = worst.person.id;
        report.yields += 1;
        ctx.robot.setLights("yielding", "#f59e0b");
        ctx.emit({
          kind: "status",
          message:
            `Stepping out of ${worst.person.id}'s path — they would pass within ` +
            `${worst.approach.distance.toFixed(2)} m in ${worst.approach.time.toFixed(1)} s.`,
          ar: `بتحرّك من طريق ${worst.person.id} — رح يمرقوا على بعد ${worst.approach.distance.toFixed(2)} م خلال ${worst.approach.time.toFixed(1)} ثانية.`,
        });
      }

      // Turn toward the chosen direction and drive. A differential base cannot
      // move sideways, so the turn is part of the escape and not a preamble to
      // it: driving while turning still carries the robot off their line.
      const bearing = Math.atan2(chosen.y, chosen.x);
      const turn = clamp(wrap(bearing - heading) * 2.4, -1.8, 1.8);
      const aligned = Math.abs(wrap(bearing - heading));
      // Full speed once roughly pointed the right way; creep while still turning
      // so the robot does not carve back across their path.
      const forward = aligned < 0.9 ? stepSpeed : stepSpeed * 0.25;

      ctx.safety.takeWheel(forward, turn, "yielding the path");
      ctx.robot.drive(forward, turn);

      await ctx.sleep(periodMs);
    }

    if (ctx.safety.wheelHeldBy() === "yielding the path") ctx.safety.releaseWheel();

    return {
      ok: true,
      summary:
        report.yields === 0
          ? `Nobody was on a converging path across ${report.ticks} ticks.`
          : `Stepped aside ${report.yields} time(s); tightest predicted pass ` +
            `${report.tightestPrediction.toFixed(2)} m, closest anyone actually got ` +
            `${report.minDistance.toFixed(2)} m` +
            (report.trapped > 0 ? `, ${report.trapped} tick(s) with nowhere to go.` : "."),
      data: report,
      metrics: {
        yields: report.yields,
        minDistance: report.minDistance,
        trapped: report.trapped,
      },
    };
  },
};

type Approach = { time: number; distance: number };

/**
 * Where two bodies on straight courses come closest, and when.
 *
 * Standard closing geometry: with relative position r and relative velocity v,
 * the separation is smallest at t = -(r·v)/|v|², and substituting back gives
 * the distance. A negative time means they are already past each other, which
 * is not a problem to solve.
 */
export function closestApproach(
  robot: { x: number; y: number },
  robotVelocity: Vec2,
  person: HumanTrack,
): Approach {
  const r: Vec2 = { x: person.at.x - robot.x, y: person.at.y - robot.y };
  const v: Vec2 = {
    x: person.velocity.x - robotVelocity.x,
    y: person.velocity.y - robotVelocity.y,
  };

  const closingSpeed = v.x * v.x + v.y * v.y;
  if (closingSpeed < 1e-6) {
    // Nobody is moving relative to anybody. Current separation is the answer,
    // and it stays the answer.
    return { time: 0, distance: Math.hypot(r.x, r.y) };
  }

  const time = -(r.x * v.x + r.y * v.y) / closingSpeed;
  const at: Vec2 = { x: r.x + v.x * time, y: r.y + v.y * time };
  return { time, distance: Math.hypot(at.x, at.y) };
}

/** Is there room to move this way? */
function isClear(
  scan: { ranges: number[]; fov: number },
  bearing: number,
  needed: number,
): boolean {
  const { ranges, fov } = scan;
  if (ranges.length === 0) return false;
  const step = fov / Math.max(ranges.length - 1, 1);
  let saw = false;
  for (let i = 0; i < ranges.length; i += 1) {
    const angle = -fov / 2 + i * step;
    if (Math.abs(wrap(angle - bearing)) > 0.5) continue;
    const range = ranges[i];
    if (!Number.isFinite(range)) continue;
    saw = true;
    if (range < needed) return false;
  }
  // A direction the sensor cannot see is not a direction to drive into.
  return saw;
}

function unit(v: Vec2): Vec2 {
  const length = Math.hypot(v.x, v.y);
  return length < 1e-6 ? { x: 1, y: 0 } : { x: v.x / length, y: v.y / length };
}

function wrap(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
