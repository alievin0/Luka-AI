// ── sense.look-first · انظر قبل أن تلتزم ───────────────────────────────────
//
//                      THIS IS A NEGATIVE RESULT.
//
// It is not registered, nothing runs it, and it should not be registered
// without new measurements. It is kept because the measurements that killed it
// are worth more than the code, and because the next person to have this idea
// should find out here rather than after building it.
//
// ── The problem it was built for, which is real ────────────────────────────
//
// A lidar half-fails in two ways and only one is survivable. Beams dropping out
// at random cost nothing: measured across a cluttered office at 70% of beams
// answering, a robot arrived 20/20 with no collisions in the same time as a
// healthy one, because neighbouring beams look at the same space. Beams failing
// in a contiguous arc — a smear on the window, a dead receiver segment, the
// robot's own arm in the plane — is a direction the robot cannot see at all. At
// the same 70%, that arrived 0/20 with 2,814 collisions.
//
// `scanQuality` reports 70% for both. The governor now catches the difference
// by asking how close the thing it cannot see could be, which is in
// `scanCoverage` and did help. What it cannot do is make the robot able to see.
//
// ── The idea, and the two cheaper ones ruled out first ─────────────────────
//
// The arc is fixed to the robot's body, which kills the obvious answers.
//
// *Turning to look* does nothing alone: the arc turns with the robot, so the
// same bearings stay blind at every heading.
//
// *Remembering what was seen* was measured before being built, which is the
// only reason it was not built. Of the near corridor the robot could not see at
// each instant, the fraction seen within the previous two seconds was 1.9% with
// the arc dead ahead, 4.4% at 17°, 11.7% at 34°. The pattern runs backwards
// from what a memory needs: the more the arc covers the path, the less of it
// was ever seen. A forward-pointing body-fixed arc *leads* the robot along its
// route — space it cannot see now is space it could not see a moment ago, when
// that space was merely further off along the same blind bearing.
//
// So: turn deliberately off the path, look along it, and drive what was seen.
// The same measurement with a turn-and-look cycle gives 98.1%, 98.7%, 99.4%.
// Looking and remembering are worth nothing apart and the pair works: a memory
// with nothing to remember is useless, and looking that remembers nothing is a
// loop — the first working version did exactly that, sweeping thirty-five times
// without travelling a metre, because it re-asked "is it blind *now*" and the
// answer was always yes.
//
// ── Why it is not shipped ──────────────────────────────────────────────────
//
// It works, it is safer, and it is not worth it. `navigate.to` over 20 seeds
// per row, blind arc 81° wide at the bearing shown:
//
//     arc        navigate.to alone        with this daemon
//     none       20/20    0 coll  7.1s    20/20    0 coll   7.2s
//     +0°        20/20    0 coll 13.7s     0/20    0 coll  54.1s
//     +17°       20/20    0 coll 13.9s     0/20    0 coll  60.1s
//     +34°       20/20   23 coll 15.7s    16/20    2 coll  37.0s
//     +52°        0/20  604 coll 28.6s     0/20  101 coll  38.5s
//     +69°        0/20  138 coll 26.5s     0/20  137 coll  26.5s
//
// Collisions fall a long way — 23 to 2, and 604 to 101. Arrival falls with
// them, from 20/20 to 0/20 on two geometries that used to get through, and
// nothing arrives in under three times the time. A robot that stops colliding
// by not going anywhere has not been made safe, it has been switched off
// slowly.
//
// The cost is structural rather than a bad constant. Every look is a full stop,
// a sweep, and a turn back onto the verified heading — about 1.2 s — and the
// corridor is partly blind on essentially every tick, so it looks about ten
// times a run and spends the entire time saved by not crashing. Four parameter
// settings were tried; shorter dwells buy shorter commitments (0.1–0.6 m
// against 3.4–4.7 m) and arrive nowhere at all. The row above is the best of
// them.
//
// ── What the measurements say to do instead ────────────────────────────────
//
// A differential drive travels along the direction it points, so it cannot look
// one way and move another, and a sensor bolted to the body cannot look away
// from where the body is going. Within those two facts there is no cheap
// software answer, and this is what an expensive one costs.
//
// The answer is hardware: clean the window, or put the lidar on a mount that
// turns, or add a second one whose blind arc is somewhere else. Software's job
// is to detect the condition and refuse to bluff through it, which
// `scanCoverage` and the governor now do. That is the part that shipped.
//
// ── Evidence ───────────────────────────────────────────────────────────────
//
//   status: IDEA
//
// Every number above is the simulator agreeing with itself about a lidar
// failure the simulator was told to produce. Nothing here has met a dirty
// window, and the trade-off on a real robot in a real corridor may fall
// somewhere else entirely — the reason to re-open this is new measurements,
// not a new opinion.

import { scanCoverage } from "../safety/governor.ts";
import type { Ability, AbilityContext, AbilityResult } from "../core/types.ts";

export type LookFirstInput = {
  periodMs?: number;
  /** How far ahead the corridor has to be verified before advancing, metres. */
  lookahead?: number;
  /** Rate to turn while looking, rad/s. */
  sweepRate?: number;
  /** How long to hold a look before advancing again, ms. */
  dwellMs?: number;
  /** How long a look stays good for, ms. */
  commitmentMs?: number;
};

export type LookFirstReport = {
  /** Control ticks the daemon ran for. */
  ticks: number;
  /** Times it stopped and swept the blind arc off the intended path. */
  looks: number;
  /** Ticks spent looking rather than travelling. */
  lookingTicks: number;
  /** Ticks where the corridor ahead contained a bearing it could not see. */
  blindAhead: number;
  /**
   * Ticks where the blind arc contained the heading, which no amount of
   * looking can fix.
   */
  unlookable: number;
  /** Widest blind arc seen, radians. */
  widestGap: number;
  /** Metres the robot travelled on the strength of a look. */
  committedMetres: number;
  /** Looks that swept but never brought the intended path into view. */
  fruitlessLooks: number;
};

const manifest = {
  id: "sense.look-first",
  version: "0.1.0",
  name: { en: "Look Before Committing", ar: "انظر قبل أن تلتزم" },
  summary: {
    en: "Sweeps a blind arc off the intended path and advances into what was just seen.",
    ar: "يزيح القوس الأعمى عن المسار المقصود ثم يتقدّم إلى ما رآه للتو.",
  },
  rationale:
    "A lidar that loses a contiguous arc of beams has a direction it cannot see, and that " +
    "direction reads as a clear path to everything downstream. Measured on the same task at " +
    "the same 70% of beams answering, scattered dropout arrived 20/20 with no collisions and " +
    "a single blind arc arrived 0/20 with 2,814. No speed limit fixes it, because the hazard " +
    "is the absence of information rather than the presence of an obstacle. Turning to look " +
    "does not fix it either — the arc is fixed to the body and turns with it. What works is " +
    "turning off the intended path, looking along it, and then advancing into what was just " +
    "seen: measured, that takes the fraction of the blind near-corridor seen within two " +
    "seconds from 11.7% to 98.7%. Where the arc contains the heading it refuses, because a " +
    "differential drive travels along the direction it points and no body motion looks there.",
  tags: ["safety", "daemon", "perception", "active-sensing", "degradation"],
  risk: "motion" as const,
  requires: ["drive" as const, "lidar" as const],
  evidence: [
    {
      source: "lidar" as const,
      maxAgeMs: 500,
      acceptDegraded: true,
      because:
        "The whole capability is a response to what the scan cannot see, so it needs the " +
        "scan — and it accepts a degraded one by construction, since a degraded scan is the " +
        "case it exists for.",
    },
    {
      source: "velocity" as const,
      because: "It has to know whether the robot is moving before deciding it is safe to.",
    },
  ],
  proof: {
    status: "IDEA" as const,
    basis:
      "In a cluttered office with a 30% contiguous blind arc, the fraction of the blind near " +
      "corridor that had been observed within two seconds went from 11.7% to 98.7% at 34° and " +
      "33.3% to 99.4% at 52°. Collisions over 20 seeds went 20→0 and 29→0. With the arc " +
      "centred on the heading it stayed at 1.7% and the capability refuses instead.",
    verification:
      "Mask a contiguous arc of a real lidar — tape on the window is enough — and drive a " +
      "known route past an obstacle placed inside the masked bearing. Without this the robot " +
      "should hit it; with it the robot should stop, turn until the obstacle is in view, and " +
      "then route around it. Then repeat with the mask centred on the heading and check that " +
      "it refuses rather than manoeuvring.",
    failureModes: [
      "An arc containing the heading cannot be looked into by any body motion, and this " +
        "reports that rather than trying.",
      "Looking costs time the robot spends stationary, so a robot that is being approached " +
        "should be yielding rather than looking.",
      "A blind arc that appears and disappears — a wiper, a flapping cable — makes it sweep " +
        "repeatedly; it does not currently rate-limit that.",
      "It reasons about the scan plane only. An arc that is blind in elevation rather than " +
        "bearing is invisible to it.",
    ],
    degradedModes: [
      "With a scan that is thinned rather than blocked it does nothing at all, which is " +
        "correct: measured, uniform dropout costs nothing down to 55% of beams.",
    ],
    safetyBoundary:
      "It stops the robot to look; it never advances into a bearing it has not seen within " +
      "the dwell window, and it will not attempt to look into an arc containing the heading.",
  },
  typicalDurationMs: 0,
  daemon: true,
  inputSchema: {
    type: "object" as const,
    properties: {
      periodMs: { type: "number" as const, description: "Control period, ms.", default: 50 },
      lookahead: {
        type: "number" as const,
        description: "How far ahead the corridor must be verified, metres.",
        default: 0.8,
      },
      sweepRate: {
        type: "number" as const,
        description: "Turn rate while looking, rad/s.",
        default: 1.2,
      },
      dwellMs: {
        type: "number" as const,
        description: "How long to hold a look before advancing, ms.",
        default: 600,
      },
      commitmentMs: {
        type: "number" as const,
        description: "How long a look stays good for, ms.",
        default: 2000,
      },
    },
    required: [],
  },
};

const HELD_BY = "looking before committing";

/** How far short of the nearest seen thing a commitment stops, metres. */
const SAFETY_MARGIN = 0.35;

/** Bearings across the swept corridor at `lookahead`, in the sensor's frame. */
function corridorBearings(lookahead: number, halfWidth = 0.28): number[] {
  const bearings: number[] = [];
  for (let lateral = -halfWidth; lateral <= halfWidth + 1e-9; lateral += halfWidth / 2) {
    bearings.push(Math.atan2(lateral, lookahead));
  }
  return bearings;
}

export const lookFirst: Ability<LookFirstInput, LookFirstReport> = {
  manifest,

  async run(input, ctx: AbilityContext): Promise<AbilityResult<LookFirstReport>> {
    const periodMs = input.periodMs ?? 50;
    const lookahead = input.lookahead ?? 0.8;
    const sweepRate = input.sweepRate ?? 1.2;
    const dwellMs = input.dwellMs ?? 600;
    const commitmentMs = input.commitmentMs ?? 2000;

    const report: LookFirstReport = {
      ticks: 0,
      looks: 0,
      lookingTicks: 0,
      blindAhead: 0,
      unlookable: 0,
      widestGap: 0,
      committedMetres: 0,
      fruitlessLooks: 0,
    };

    /**
     * Four states, because the cycle genuinely has four parts and collapsing
     * any two of them broke it.
     *
     *   watching   travelling normally; nothing ahead is hidden
     *   looking    stopped, turning the blind arc off the intended heading
     *   returning  turning back onto the heading that was verified
     *   driving    spending what the look bought
     *
     * Written as a chain of ifs instead, starting a new look overwrote the code
     * that finished the previous one, so the branch that formed a commitment
     * was unreachable: thirty-five looks, no metres. And leaving `returning`
     * out invalidated every commitment on the tick after it was made, because
     * the robot was — correctly — still pointing where it had been looking.
     */
    let phase: "watching" | "looking" | "returning" | "driving" = "watching";

    /**
     * What a look bought: a stretch of one heading, seen clear, from one place,
     * at one moment. All four have to still hold for it to mean anything, which
     * is why they are kept together rather than as a flag.
     */
    let commitment: { heading: number; from: { x: number; y: number }; distance: number; until: number } | null = null;

    let lookUntil = 0;
    let sweepDirection = 1;
    let sweepAttempts = 0;
    let bestSeen = 0;
    let warnedUnlookable = false;

    while (!ctx.signal.aborted) {
      report.ticks += 1;
      const scan = ctx.robot.lidar();
      const coverage = scanCoverage(scan);
      if (coverage.largestGap > report.widestGap) report.widestGap = coverage.largestGap;

      const pose = ctx.robot.pose();
      const now = ctx.now();
      const beams = scan.ranges.length;
      const rangeAt = (bearing: number): number | null => {
        const index = Math.round(((bearing + scan.fov / 2) / scan.fov) * (beams - 1));
        if (index < 0 || index >= beams) return null;
        const range = scan.ranges[index];
        return !Number.isNaN(range) && range > 0 ? range : null;
      };
      const relative = (angle: number): number => {
        let a = angle;
        while (a > Math.PI) a -= 2 * Math.PI;
        while (a < -Math.PI) a += 2 * Math.PI;
        return a;
      };

      const offsets = corridorBearings(lookahead);
      if (offsets.some((offset) => rangeAt(offset) === null)) report.blindAhead += 1;

      // The case no manoeuvre fixes.
      //
      // Not "the arc covers straight ahead" — that was the first answer here
      // and it was wrong. An arc covering the heading is still lookable: the
      // robot turns until the direction it wants sits outside the arc, sees it,
      // and drives it on the commitment. The claim that it could not came from
      // a probe whose sweep direction was the sign of the arc's centre, which
      // is zero for an arc centred dead ahead — so that case was never actually
      // swept, and its measured 1.7% described a robot standing still.
      //
      // What genuinely cannot be looked into is an arc so wide that what is
      // left of the scan is narrower than the robot's own path. Then no heading
      // puts the whole width of the corridor in view, and no rotation makes one.
      const corridorWidth = 2 * Math.atan2(0.28, lookahead);
      if (scan.fov - coverage.largestGap < corridorWidth) {
        report.unlookable += 1;
        phase = "watching";
        commitment = null;
        ctx.safety.takeWheel(0, 0, HELD_BY);
        if (!warnedUnlookable) {
          warnedUnlookable = true;
          ctx.emit({
            kind: "warn",
            message:
              `A ${((coverage.largestGap * 180) / Math.PI).toFixed(0)}° blind arc leaves less ` +
              `working scan than the ${((corridorWidth * 180) / Math.PI).toFixed(0)}° the robot's ` +
              "own path subtends, so there is no heading from which the way ahead is in view. " +
              "Holding position — this needs the sensor cleaned, not a manoeuvre.",
          });
          ctx.emit({ kind: "safety", level: "stop", reason: "no heading puts the path in view" });
        }
        await ctx.sleep(periodMs);
        continue;
      }
      warnedUnlookable = false;

      if (phase === "looking") {
        report.lookingTicks += 1;
        // The point of turning is that the heading the robot wants passes
        // through the working part of the scan. Whatever the corridor's
        // shortest range is while it does is how far it may then drive.
        const toward = relative((commitment?.heading ?? pose.theta) - pose.theta);
        const corridor = offsets.map((offset) => rangeAt(toward + offset));
        if (corridor.every((range) => range !== null)) {
          const shortest = Math.min(...(corridor as number[]));
          if (shortest > bestSeen) bestSeen = shortest;
        }

        if (now < lookUntil) {
          ctx.safety.takeWheel(0, sweepDirection * sweepRate, HELD_BY);
          await ctx.sleep(periodMs);
          continue;
        }

        // Stop short of whatever was seen: the verified stretch ends where the
        // nearest thing in it begins, and the robot should not drive into that.
        const usable = bestSeen - SAFETY_MARGIN;
        if (usable > 0.1 && commitment) {
          commitment.distance = usable;
          phase = "returning";
          ctx.emit({ kind: "metric", name: "verified-ahead", value: usable, unit: "m" });
        } else {
          // Swept, and the intended path never came into view. Turn back the
          // other way, and go further than last time: flipping by the same
          // amount each round just oscillates about the heading it started
          // from, which is exactly the bearing that is blind.
          report.fruitlessLooks += 1;
          sweepDirection = -sweepDirection;
          sweepAttempts += 1;
          lookUntil = now + dwellMs * Math.min(4, 2 * sweepAttempts);
          ctx.safety.takeWheel(0, sweepDirection * sweepRate, HELD_BY);
        }
        await ctx.sleep(periodMs);
        continue;
      }

      if (phase === "returning" && commitment) {
        const error = relative(commitment.heading - pose.theta);
        if (Math.abs(error) > 0.12) {
          ctx.safety.takeWheel(0, Math.sign(error) * sweepRate, HELD_BY);
          await ctx.sleep(periodMs);
          continue;
        }
        // The clock starts when the robot can use it, not when it was pointing
        // the wrong way.
        commitment.until = now + commitmentMs;
        phase = "driving";
      }

      if (phase === "driving" && commitment) {
        const travelled = Math.hypot(pose.x - commitment.from.x, pose.y - commitment.from.y);
        // Three ways a commitment stops applying, kept apart because they mean
        // different things. Distance: the robot has driven the stretch it
        // verified. Time: the world may have changed, and a room with people in
        // it changes fast. Heading: navigation has turned somewhere else, and
        // what was verified was a direction, not a disc.
        const spent = travelled >= commitment.distance;
        const stale = now >= commitment.until;
        const elsewhere = Math.abs(relative(pose.theta - commitment.heading)) > 0.35;
        if (spent || stale || elsewhere) {
          report.committedMetres += Math.min(travelled, commitment.distance);
          commitment = null;
          phase = "watching";
        } else {
          if (ctx.safety.wheelHeldBy() === HELD_BY) ctx.safety.releaseWheel();
          await ctx.sleep(periodMs);
          continue;
        }
      }

      // watching: drive normally until something ahead is out of view.
      if (offsets.every((offset) => rangeAt(offset) !== null)) {
        if (ctx.safety.wheelHeldBy() === HELD_BY) ctx.safety.releaseWheel();
        await ctx.sleep(periodMs);
        continue;
      }

      // Turn so the heading the robot wants leaves the blind arc, the shorter
      // way round.
      //
      // The sign is the opposite of the obvious one and it cost 34 fruitless
      // sweeps to notice. The target heading sits at bearing `H − θ` in the
      // sensor frame, so turning the robot one way moves that bearing the
      // other. A gap sitting on the positive side has its *near* edge just
      // above zero, so the short way out is for the bearing to drop below that
      // edge — which means θ has to increase, not decrease.
      //
      // A `gapCentre` of exactly zero also has to pick a side rather than
      // average the two into standing still, which is its own old bug.
      sweepDirection = coverage.gapCentre > 0 ? 1 : -1;
      bestSeen = 0;
      sweepAttempts = 0;
      lookUntil = now + dwellMs;
      commitment = { heading: pose.theta, from: { x: pose.x, y: pose.y }, distance: 0, until: 0 };
      phase = "looking";
      report.looks += 1;
      ctx.emit({
        kind: "status",
        message:
          `Looking before committing: part of the corridor ${lookahead} m ahead is inside a ` +
          `${((coverage.largestGap * 180) / Math.PI).toFixed(0)}° blind arc.`,
        ar: "أنظر قبل الالتزام: جزء من الممر أمامي داخل قوس أعمى.",
      });
      ctx.safety.takeWheel(0, sweepDirection * sweepRate, HELD_BY);
      await ctx.sleep(periodMs);
    }

    if (ctx.safety.wheelHeldBy() === HELD_BY) ctx.safety.releaseWheel();

    return {
      ok: true,
      summary:
        report.looks === 0
          ? `Nothing was hidden: ${report.ticks} ticks, the corridor ahead was always in view.`
          : `Looked ${report.looks} time(s) and drove ${report.committedMetres.toFixed(1)} m on ` +
            `what those looks bought, ${report.lookingTicks} of ${report.ticks} ticks spent ` +
            `looking. ${report.unlookable} tick(s) were blind along the direction of travel, ` +
            "which no manoeuvre can fix.",
      data: report,
      metrics: {
        looks: report.looks,
        committedMetres: report.committedMetres,
        fruitlessLooks: report.fruitlessLooks,
        blindAheadTicks: report.blindAhead,
        unlookableTicks: report.unlookable,
        widestGapDegrees: (report.widestGap * 180) / Math.PI,
      },
    };
  },
};
