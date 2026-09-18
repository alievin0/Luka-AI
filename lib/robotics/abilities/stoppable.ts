// ── safety.stoppable · هل بقدر أوقف؟ ────────────────────────────────────────
// The question underneath every other safety question.
//
// A speed limiter answers "how fast may I go". It does not answer the prior
// question: if everything latched right now, would this robot actually come to
// rest without falling over or hitting something? Those are different
// questions, and a robot can be comfortably inside its speed limit and still be
// in a state it cannot stop out of.
//
// This matters most where the rest of the safety stack is quiet. `critical`
// abilities bypass the governor by design — that is what makes them able to
// catch a fall — and nothing else checks whether the bypass is survivable. This
// daemon does, and it publishes a continuous margin rather than a boolean, so
// the number is visible while it is still comfortable.

import { clamp } from "../core/math.ts";
import { nearestObstacle } from "../safety/governor.ts";
import type { Ability, AbilityResult } from "../core/types.ts";

export type StoppableInput = {
  comHeight?: number;
  footHalf?: number;
  /** Deceleration the brakes can deliver, m/s². */
  maxDecel?: number;
  /** Warn when the headroom falls below this many seconds. */
  warnSeconds?: number;
  /** Escalate after the robot has been unstoppable for this long, ms. */
  escalateAfterMs?: number;
  periodMs?: number;
};

export type StoppableReport = {
  /** Worst balance margin seen, radians. Negative means it could not have stopped upright. */
  minBalanceMarginRad: number;
  /** Worst space margin seen, metres. Negative means it could not have stopped in time. */
  minSpaceMarginM: number;
  /** Worst headroom seen, seconds of travel before stopping becomes impossible. */
  minHeadroomSeconds: number;
  /** Fraction of the run spent in a state it could not have stopped out of. */
  unstoppableFraction: number;
  ticks: number;
  escalated: boolean;
  /** Which margin bound it, most of the time. */
  limitedBy: "balance" | "space" | "nothing";
  /** The braking figure every margin above was computed from, m/s². */
  assumedDecel: number;
};

const GRAVITY = 9.81;

export const safetyStoppable: Ability<StoppableInput, StoppableReport> = {
  manifest: {
    id: "safety.stoppable",
    version: "1.0.0",
    name: { en: "Stoppability Monitor", ar: "مراقب القدرة على التوقف" },
    summary: {
      en: "Continuously answers whether the robot could come to rest right now without falling or hitting anything, and publishes the margin rather than a yes/no.",
      ar: "بيجاوب باستمرار: لو وقف الروبوت هلق، بيوصل لوضع ثابت بدون ما يوقع أو يصطدم؟ وبينشر الهامش مو بس جواب نعم/لا.",
    },
    rationale:
      "Speed limits answer how fast, not whether stopping is still possible — and those " +
      "come apart exactly where it matters. A robot carrying speed toward a wall, or " +
      "already leaning, can be inside every limit it has and still be committed. " +
      "Emergency behaviours make this sharper: they are allowed to override the speed " +
      "limiter, which is the right design, and it means nothing else is checking " +
      "whether the state they drive into is one the robot can stop out of. Publishing " +
      "the margin continuously turns that from something discovered after an incident " +
      "into a number on a dashboard.",
    tags: ["safety", "daemon", "diagnostics"],
    risk: "passive",
    requires: ["imu", "lidar"],
    // It answers "if I stopped right now, would I reach a stable state" — which is
    // a question about the robot's own motion and what is in front of it, so
    // absence of either makes the answer meaningless rather than optimistic.
    evidence: [
      {
        source: "imu" as const,
        because: "a robot already leaning has a different stopping problem to one that is level",
        maxAgeMs: 300,
      },
      {
        source: "lidar" as const,
        because: "stopping distance has to fit in the space that is actually there",
        maxAgeMs: 500,
        acceptDegraded: true,
      },
      {
        source: "velocity" as const,
        because: "there is no stopping distance without a speed",
      },
    ],
    proof: {
      status: "SIMULATED" as const,
      basis:
        "Runs alongside the navigation demos and reports the margin continuously. It has never " +
        "been checked against a real platform's braking, which is the only number that matters.",
      verification:
        "Measure the platform's actual deceleration from full speed on the surface it will work " +
        "on — loaded and unloaded, because a carried mass changes it — and compare against both " +
        "the configured `maxDecel` and what the governor measures at runtime. The rated figure " +
        "being optimistic is the failure that matters.",
      failureModes: [
        "The deceleration is no longer a bare constant — the governor measures what the floor " +
          "actually gives and this asks for that figure every tick — but the measurement needs a " +
          "surface ahead to measure against. In the middle of an open space there is nothing to " +
          "read and the configured number stands, which is reported as an assumption rather than " +
          "as knowledge.",
        "A measurement may only lower the assumed braking, never raise it. If the configured " +
          "figure is optimistic and the floor never demonstrates worse — because the robot never " +
          "brakes hard — every margin here is still wrong in the unsafe direction.",
        "It reasons about the scan plane, so it cannot see a drop, a stair edge or a kerb.",
        "It says whether stopping is possible, not whether stopping is safe for what is being " +
          "carried.",
      ],
      degradedModes: [
        "Accepts a partial scan, which makes the free distance a lower bound rather than an " +
          "estimate — the safe direction to be wrong in.",
      ],
      safetyBoundary:
        "Passive. It reports and never commands, so it cannot make anything worse directly; what " +
        "it can do is be believed when it is wrong.",
    },
    typicalDurationMs: 0,
    daemon: true,
    inputSchema: {
      type: "object",
      properties: {
        comHeight: { type: "number", description: "Centre-of-mass height, m.", default: 0.55 },
        footHalf: { type: "number", description: "Support half-length, m.", default: 0.11 },
        maxDecel: {
          type: "number",
          description:
            "Override the available braking, m/s². Left out, it asks the governor for the " +
            "figure the separation model is actually using, which is the measured one when " +
            "the floor has demonstrated worse than the configured limit.",
        },
        warnSeconds: { type: "number", description: "Warn below this headroom, s.", default: 0.4 },
        escalateAfterMs: {
          type: "number",
          description: "Stop the mission after this long unstoppable.",
          default: 1500,
        },
        periodMs: { type: "number", description: "Check interval, ms.", default: 50 },
      },
      required: [],
    },
  },

  async run(input, ctx): Promise<AbilityResult<StoppableReport>> {
    const comHeight = input.comHeight ?? 0.55;
    const footHalf = input.footHalf ?? 0.11;
    const warnSeconds = input.warnSeconds ?? 0.4;
    const escalateAfterMs = input.escalateAfterMs ?? 1500;
    const periodMs = input.periodMs ?? 50;

    const omega0 = Math.sqrt(GRAVITY / comHeight);
    const supportAngle = Math.asin(clamp(footHalf / comHeight, 0, 1));
    // How much base acceleration the ankle alone can counteract. Braking harder
    // than this throws the body forward faster than the ankle can answer, and
    // the difference has to come out of the balance margin.
    const ankleAuthority = (GRAVITY * footHalf) / comHeight;
    let assumedDecel = input.maxDecel ?? ctx.safety.effectiveDecel();

    const report: StoppableReport = {
      assumedDecel: input.maxDecel ?? ctx.safety.effectiveDecel(),
      minBalanceMarginRad: Number.POSITIVE_INFINITY,
      minSpaceMarginM: Number.POSITIVE_INFINITY,
      minHeadroomSeconds: Number.POSITIVE_INFINITY,
      unstoppableFraction: 0,
      ticks: 0,
      escalated: false,
      limitedBy: "nothing",
    };

    let unstoppableTicks = 0;
    let unstoppableSince: number | null = null;
    let balanceBound = 0;
    let spaceBound = 0;
    let warned = false;

    while (!ctx.signal.aborted) {
      report.ticks += 1;

      const imu = ctx.robot.imu();
      // Asked every tick rather than read once at the start, because the whole
      // point of it being measured is that it can change under the robot.
      const maxDecel = input.maxDecel ?? ctx.safety.effectiveDecel();
      const speed = Math.abs(ctx.robot.velocity().linear);
      const clearance = nearestObstacle(ctx.robot.lidar());

      // Balance: the capture point now, plus whatever the stop itself would add.
      const capture = Math.abs(imu.tilt + imu.tiltRate / omega0);
      const excessDecel = Math.max(maxDecel - ankleAuthority, 0);
      const stopSeconds = speed / maxDecel;
      const leanFromBraking = (0.5 * excessDecel * stopSeconds * stopSeconds) / comHeight;
      const balanceMargin = supportAngle - (capture + leanFromBraking);

      // Space: how far it would travel before resting, against what is ahead.
      const stopDistance =
        speed * ctx.safety.effectiveReactionTime() + (speed * speed) / (2 * maxDecel);
      const spaceMargin = clearance - stopDistance;

      // Headroom: how much longer it could keep going before the stop stops
      // being possible. Seconds is the unit an operator can act on.
      const headroom = speed > 0.02 ? spaceMargin / speed : Number.POSITIVE_INFINITY;

      report.minBalanceMarginRad = Math.min(report.minBalanceMarginRad, balanceMargin);
      report.minSpaceMarginM = Math.min(report.minSpaceMarginM, spaceMargin);
      if (Number.isFinite(headroom)) {
        report.minHeadroomSeconds = Math.min(report.minHeadroomSeconds, headroom);
      }
      // Report the worst it ever believed it had, not the last.
      assumedDecel = Math.min(assumedDecel, maxDecel);
      if (balanceMargin < spaceMargin) balanceBound += 1;
      else spaceBound += 1;

      const stoppable = balanceMargin > 0 && spaceMargin > 0;
      if (!stoppable) {
        unstoppableTicks += 1;
        unstoppableSince ??= ctx.now();

        if (ctx.now() - unstoppableSince > escalateAfterMs && !report.escalated) {
          report.escalated = true;
          ctx.emit({
            kind: "warn",
            message: `Committed: no stop from here leaves the robot upright and clear (balance ${balanceMargin.toFixed(3)} rad, space ${spaceMargin.toFixed(2)} m).`,
          });
          ctx.escalate("stoppability monitor: the robot cannot stop safely from this state");
        }
      } else {
        unstoppableSince = null;
      }

      if (Number.isFinite(headroom) && headroom < warnSeconds && !warned) {
        warned = true;
        ctx.emit({
          kind: "warn",
          message: `Stopping headroom down to ${headroom.toFixed(2)} s — ${clearance.toFixed(2)} m ahead and ${stopDistance.toFixed(2)} m needed to stop.`,
        });
      } else if (Number.isFinite(headroom) && headroom > warnSeconds * 2) {
        warned = false;
      }

      if (report.ticks % 20 === 0) {
        ctx.emit({
          kind: "metric",
          name: "stoppable.headroom",
          value: Number.isFinite(headroom) ? Number(headroom.toFixed(3)) : 99,
          unit: "s",
        });
      }

      await ctx.sleep(periodMs);
    }

    report.unstoppableFraction = report.ticks > 0 ? unstoppableTicks / report.ticks : 0;
    report.assumedDecel = assumedDecel;
    report.limitedBy =
      balanceBound === 0 && spaceBound === 0
        ? "nothing"
        : balanceBound > spaceBound
          ? "balance"
          : "space";

    ctx.emit({
      kind: "metric",
      name: "stoppable.unstoppableFraction",
      value: report.unstoppableFraction,
    });

    return {
      ok: !report.escalated && report.unstoppableFraction < 0.02,
      summary:
        report.unstoppableFraction === 0
          ? `Could have stopped safely at every one of ${report.ticks} checks — tightest margin ${fmt(report.minHeadroomSeconds)} s, bounded by ${report.limitedBy}, working from ${assumedDecel.toFixed(2)} m/s² of braking.`
          : `Spent ${(report.unstoppableFraction * 100).toFixed(1)}% of the run in states it could not have stopped out of (worst balance ${report.minBalanceMarginRad.toFixed(3)} rad, worst space ${report.minSpaceMarginM.toFixed(2)} m).`,
      data: report,
      metrics: {
        minHeadroomSeconds: Number.isFinite(report.minHeadroomSeconds)
          ? report.minHeadroomSeconds
          : 99,
        minBalanceMarginRad: report.minBalanceMarginRad,
        minSpaceMarginM: report.minSpaceMarginM,
        unstoppableFraction: report.unstoppableFraction,
      },
    };
  },
};

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "∞";
}
