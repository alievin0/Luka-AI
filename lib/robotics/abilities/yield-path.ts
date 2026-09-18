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
// ── What the first version of this measured, and why it was wrong ──────────
//
// It reported 0/20 clean crossings becoming 20/20, with contacts falling from
// 12.7 per run to zero. That number was an artifact of the simulator handing
// out people's *true* velocities: exact, noiseless, with no lag. A tracker has
// no such thing. It differences noisy detections, which costs about 0.28 m/s
// here — squarely inside the 0.2–0.4 m/s that published person-trackers report.
//
// Given a real estimate, the capability did not merely stop helping. It made
// things worse: 12.3 contacts per crossing against 5.0 for doing nothing at
// all. The robot was dodging noise and stepping into people.
//
// The cause was not the noise itself but what the code did with it. Both
// perpendicular escapes stay valid while the estimate wobbles, and the
// direction was rechosen from scratch every tick, so the scoring swapped sides
// and the robot dithered in the corridor — the dance two people do in a
// doorway. Committing to a side once chosen, and keeping it until it is
// blocked, is the whole fix.
//
// A second fix was tried and removed. Bounding the horizon by the tracker's own
// uncertainty is sound on paper — five seconds of a 0.28 m/s error is 1.39 m of
// prediction guarding 0.8 m of clearance — and it measured as nothing. Swept
// over sixty seeds with a paired test, 2.5 s, 3.5 s and 5 s are
// indistinguishable (p = 0.44 and p = 1.00). An earlier warning buys more time
// to finish the sidestep than the extra error costs.
//
// ── Evidence ───────────────────────────────────────────────────────────────
//
//   status: SIMULATED
//
// Sixty corridor crossings against people who never look up, paired on seed:
//
//   without yielding    0/60 clean [0–6%]    3.73 contacts per crossing
//   with yielding      41/60 clean [56–79%]  1.63 contacts per crossing
//
// McNemar on the paired episodes: 41 wins to 0 across 41 disagreements,
// p = 0.0000. It works, and it is not the miracle the first measurement
// claimed. Roughly a third of crossings still end in contact.
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
  /**
   * How far clear a prediction has to read before an escape already under way
   * is abandoned, as a multiple of `clearance`.
   */
  releaseFactor?: number;
  /**
   * The largest velocity uncertainty, relative to the speed being estimated,
   * that is still worth choosing a side from.
   */
  maxUncertaintyRatio?: number;
  /**
   * How long to keep executing an escape after losing sight of the person who
   * caused it, ms. Turning to step aside is what pushes them out of frame.
   */
  coastMs?: number;
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
  /** Ticks where somebody was converging and the estimate was too poor to act on. */
  tooUncertain: number;
  /** Ticks spent finishing an escape for somebody no longer in view. */
  coasting: number;
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
  // It moves the robot out of somebody's way, which means it has to actually see
  // the somebody. An empty person list from a robot with no tracker is not an
  // empty corridor, and stepping aside from a person who is not detected is the
  // failure this whole capability exists to prevent.
  evidence: [
    {
      source: "people" as const,
      because: "it predicts a closest approach, and there is nothing to predict without a track",
    },
    {
      source: "pose" as const,
      because: "the sidestep is perpendicular to their path, which needs both positions",
    },
    {
      source: "velocity" as const,
      because: "closest approach is computed from relative velocity, not relative position",
    },
  ],
  proof: {
    status: "SIMULATED" as const,
    basis:
      "Sixty corridor crossings against people who never look up, paired on seed: 0/60 clean " +
      "and 6.97 contacts per crossing without it, 37/60 clean [49-73%] and 2.20 contacts with " +
      "it. McNemar gives 37 wins to 0 across 37 disagreements, p = 0.0000.\n\n" +
      "Two earlier numbers were both measured against a tracker no camera could supply. The " +
      "first claimed 20/20 and zero contacts, on a simulator handing out people's true " +
      "velocities; with an estimated one the same code was worse than doing nothing. The second " +
      "claimed 41/60, on a tracker that reported every person in the world regardless of the " +
      "camera's six metres and 162 degrees, and with a position error that did not grow with " +
      "range. Gated to what the camera can see, the same code collapsed to 1/60 — worse than " +
      "standing still, at 8.42 contacts against 6.97 — because stepping aside means turning, " +
      "and turning swings the camera off the person who caused it, so the escape cancels itself " +
      "and restarts: 21.4 fresh escapes per crossing. Letting a committed escape outlive the " +
      "sight of them is what recovers it, and it is a 34-to-1 win over abandoning them, " +
      "p = 0.0000.",
    verification:
      "A person walking a marked line at a measured pace, crossing a robot on a marked course, " +
      "with the closest approach measured from overhead video. The number to check is the " +
      "predicted closest approach against the observed one, not whether it felt comfortable.",
    failureModes: [
      "About a third of crossings still end in contact. A corridor with somebody walking into " +
        "the robot who never looks up is not a solved problem and this does not solve it.",
      "Both escapes stay valid while the velocity estimate wobbles, so the direction is " +
        "committed once chosen. That buys consistency and costs the ability to change its mind " +
        "when the person changes theirs.",
      "The simulated people walk at constant speed along straight waypoints and never hesitate " +
        "or change their minds. Real people do, and stepping into somebody who stepped the same " +
        "way is this class of prediction's signature failure.",
      "A person tracker that drops a track mid-approach looks exactly like a person who left. " +
        "An escape already under way carries on for a second and a half without them, which is " +
        "the right answer when the robot's own turn is what lost them and the wrong one when " +
        "they genuinely went somewhere else.",
      "The escape direction is perpendicular to where the person is walking, so it is only as " +
        "good as the velocity estimate — and a manoeuvre is not started from one whose " +
        "uncertainty is more than 0.6 of the speed it is estimating, because at a ratio of one " +
        "the perpendicular is a coin flip and stepping the wrong way is an interception. Ticks " +
        "refused on that ground are counted rather than hidden.",
      "The five-second horizon was swept against a tracker with no range limit. A camera that " +
        "sees six metres gives 3.5 s of warning at worst in this corridor, so the horizon is no " +
        "longer the binding constraint it was tuned to be.",
      "In a corridor narrow enough that perpendicular is into a wall, it has nowhere to go and " +
        "the prediction is correct and useless.",
    ],
    degradedModes: [
      "None worth the name: without person tracks it does not run, and it should not.",
    ],
    safetyBoundary:
      "Steps aside at the governor's permitted speed and never toward a predicted approach.",
  },
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
      releaseFactor: {
        type: "number" as const,
        description:
          "How far clear a prediction must read before an escape already under way is called off, " +
          "as a multiple of clearance.",
        default: 1.6,
      },
      maxUncertaintyRatio: {
        type: "number" as const,
        description:
          "Largest velocity uncertainty, relative to the speed being estimated, still worth " +
          "choosing a side from.",
        default: 0.6,
      },
      coastMs: {
        type: "number" as const,
        description:
          "How long an escape keeps running after the person who caused it leaves the camera, ms.",
        default: 1500,
      },
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
    // How far clear the prediction has to read before an escape already under
    // way is called off, as a multiple of `clearance`.
    const releaseFactor = input.releaseFactor ?? 1.6;
    // The most a velocity estimate may be wrong, relative to the speed it is
    // estimating, before it is too poor to pick a side from.
    //
    // The direction of the escape is perpendicular to the way the person is
    // walking, so an error of `u` on a speed of `v` puts roughly `u/v` radians
    // of error on it. At a ratio of one the perpendicular is a coin flip, and a
    // robot that steps the wrong way has not yielded, it has intercepted.
    //
    // Not the same experiment as the horizon bound below, which was tried and
    // removed: that used uncertainty to decide *how far ahead* to predict. This
    // decides whether to act on the prediction at all.
    const maxUncertaintyRatio = input.maxUncertaintyRatio ?? 0.6;
    /** How long an escape keeps running after the person who caused it is lost. */
    const coastMs = input.coastMs ?? 1500;

    const report: YieldReport = {
      yields: 0,
      minDistance: Number.POSITIVE_INFINITY,
      tightestPrediction: Number.POSITIVE_INFINITY,
      trapped: 0,
      tooUncertain: 0,
      coasting: 0,
      ticks: 0,
    };

    let yieldingFor: string | null = null;
    /** The escape direction already chosen for them, kept until it is blocked. */
    let committedSide: Vec2 | null = null;
    /** When the current escape was committed to, on the robot's clock. */
    let committedAt = 0;

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

        // A horizon bound from the tracker's own uncertainty was tried here and
        // removed, because measuring it said the theory was wrong.
        //
        // The reasoning was sound on paper: a velocity estimate carries error,
        // projecting it forward multiplies that error by the horizon, and at
        // five seconds against a tracker with 0.28 m/s of error the prediction
        // is 1.39 m uncertain while guarding 0.8 m of clearance. So bound the
        // horizon by clearance/uncertainty, around 2.4 s.
        //
        // Swept, with the direction committed: 1 s gives 0/20 clean, 2.45 s
        // gives 12/20, 5 s gives 14/20 and 8 s adds nothing. Longer is better
        // and the bound is inert at best — when it bites it costs two clean
        // crossings. An earlier warning buys more time to finish the sidestep
        // than the extra prediction error costs, and once the escape direction
        // is committed a slightly wrong prediction still produces a useful
        // escape. The horizon stays where the measurement puts it.

        // Only paths that are actually converging, and soon enough that moving
        // changes the outcome.
        //
        // Wider on both counts for somebody the robot is already stepping out
        // of the way of. A prediction built from a velocity estimate wobbles,
        // and a manoeuvre dropped the first tick the wobble reads "fine" is a
        // manoeuvre that never finishes — the robot steps half out, re-enters
        // their line, and steps out again. This is the same lesson the conflict
        // detectors had to learn: a state is held until the evidence clears it
        // at a magnitude where clearing means something.
        const engaged = person.id === yieldingFor;
        if (approach.time < 0 || approach.time > (engaged ? horizon * 1.5 : horizon)) continue;
        if (approach.distance >= (engaged ? clearance * releaseFactor : clearance)) continue;
        if (!worst || approach.time < worst.approach.time) worst = { person, approach };
      }

      if (!worst) {
        // The escape destroys the evidence for itself.
        //
        // Stepping aside means turning, and turning swings a 162° camera off
        // the person who caused it. They leave the track, nothing is
        // converging any more, and the manoeuvre is abandoned halfway — then
        // the robot turns back, sees them again, and starts over. Measured
        // before this existed: 471 fresh escapes across twenty crossings,
        // twenty-three per crossing, which is not yielding, it is a dance.
        //
        // So a commitment outlives the sight of the person who caused it, for
        // about as long as the step itself takes. The decision was made from
        // evidence; losing sight of them afterwards does not unmake it. It is
        // bounded because a commitment nobody can see the reason for any more
        // is exactly the thing that must not run indefinitely.
        if (yieldingFor !== null && committedSide && ctx.now() - committedAt < coastMs) {
          const bearing = Math.atan2(committedSide.y, committedSide.x);
          const turn = clamp(wrap(bearing - heading) * 2.4, -1.8, 1.8);
          const aligned = Math.abs(wrap(bearing - heading));
          const forward = aligned < 0.9 ? stepSpeed : stepSpeed * 0.25;
          report.coasting += 1;
          ctx.safety.takeWheel(forward, turn, "yielding the path");
          ctx.robot.drive(forward, turn);
          await ctx.sleep(periodMs);
          continue;
        }
        if (yieldingFor !== null) {
          yieldingFor = null;
          committedSide = null;
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

      // Having picked a side for somebody, keep it.
      //
      // The direction used to be recomputed from scratch every tick, out of a
      // velocity estimate that moves. Both perpendiculars stay valid escapes
      // while the estimate wobbles, so the scoring swapped between them and the
      // robot dithered in the corridor instead of leaving it — which is the
      // awkward dance two people do in a doorway, and it is why contacts went
      // *up* when this ran on a real tracker rather than on true velocities:
      // 12.3 per crossing against 5.0 for standing still and doing nothing.
      //
      // Committing costs the ability to change its mind when the person does.
      // That is the right trade here: the escape only has to be good enough,
      // and an escape carried through beats a better one abandoned halfway.
      const committed: Vec2 | null = yieldingFor === worst.person.id ? committedSide : null;

      // Prefer the side that takes the robot further from where they are going,
      // and only use a side the lidar says is open.
      const scan = ctx.robot.lidar();
      let chosen: Vec2 | null = null;
      let best = -Infinity;

      // The side already chosen, if it is still open. Only a blocked escape
      // justifies reconsidering.
      if (committed) {
        const relative = wrap(Math.atan2(committed.y, committed.x) - heading);
        if (isClear(scan, relative, 1.0)) chosen = committed;
      }

      for (const option of chosen ? [] : options) {
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

      // Starting a manoeuvre needs an estimate good enough to choose from;
      // continuing one does not, because the choice has already been made.
      if (yieldingFor !== worst.person.id) {
        const walkingSpeed = Math.hypot(worst.person.velocity.x, worst.person.velocity.y);
        // An absent uncertainty is not a small one. A tracker that does not
        // publish its own error gets treated as unusable for choosing a side,
        // because the alternative is acting on a number nobody vouched for.
        const reported = worst.person.velocityUncertainty;
        const ratio =
          walkingSpeed <= 0.05
            ? 0 // standing still: the direction comes from geometry, not the estimate
            : reported === undefined
              ? Number.POSITIVE_INFINITY
              : reported / walkingSpeed;
        if (!Number.isFinite(ratio) || ratio > maxUncertaintyRatio) {
          report.tooUncertain += 1;
          await ctx.sleep(periodMs);
          continue;
        }
      }

      committedSide = chosen;
      if (yieldingFor !== worst.person.id) {
        yieldingFor = worst.person.id;
        committedAt = ctx.now();
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
