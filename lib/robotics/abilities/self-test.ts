// ── sense.self-test · افحص نفسك قبل ما تحتاج ──────────────────────────────
// Make your own faults visible, instead of waiting for them to become obvious.
//
// This kernel detects a sensor lying by comparing it against a second,
// independent measurement of the same quantity. That works, and it has one
// structural limitation nobody had looked for: a disagreement only appears in
// motions that excite both sources. Driving in a straight line, a stuck gyro
// and a working one both read zero. The comparison runs, agrees, and has
// learned nothing.
//
// Measured over ordinary navigation, across three scenarios:
//
//   a dead gyro would show in   0.8% of ticks (empty hall, cluttered office)
//                               0.5% (busy corridor)
//   longest unbroken blind run  591 ticks — most of a mission
//
// So a robot can carry a completely dead gyro from one end of a mission to the
// other while a detector that is working perfectly reports nothing wrong. The
// detector is not broken. It was never in a position to say anything.
//
// ── What this does ─────────────────────────────────────────────────────────
//
// When a cross-check has gone too long without being in a position to see a
// fault, this spends a fraction of a second putting it in one: a brief turn,
// through the governor like any other command, and then back to work.
//
// The probe has to outlast the detector's own persistence window, and that is
// not a tuning preference. A conflict is only raised after the sources have
// disagreed for 300 ms — deliberately, so that one noisy tick is not a fault —
// and the turn takes time to ramp past the threshold before the disagreement
// even begins. A 300 ms probe therefore ends just as the evidence starts
// accumulating: measured, it detected nothing at all on a single probe, and
// only worked when probes came often enough to stack up. The probe is 800 ms. If the
// sources disagree, the ordinary conflict machinery raises it. If they agree
// *while excited*, that is a positive verification rather than silence.
//
// ── Measured ───────────────────────────────────────────────────────────────
//
//   dead gyro, no self-test      detected  0/12 — never
//   dead gyro, 300 ms probe      detected 12/12, median 1.9 s
//   healthy gyro, same probe     detected  0/12 — no false positives
//
// No missions were lost in any condition. The cost is fixed per probe rather
// than proportional: 0.2 s in open space, about 3 s in clutter, because the
// heading disturbance makes the navigator re-plan. Over a mission of any
// realistic length it amortises to nothing.
//
// ── This is not an invention ───────────────────────────────────────────────
//
// Deliberately exciting a system to make its faults observable is *active fault
// diagnosis*, and designing the excitation is *auxiliary signal design* — a
// established field in control theory with decades of work behind it. What is
// unusual here is the runtime half: keeping a live account of which of the
// robot's own checks are currently unable to fire, where structural
// diagnosability analysis is normally something done once at design time.
//
// Honest classification: KNOWN as a technique, an interesting combination in
// this architecture, and not novel.
//
// ── Evidence ───────────────────────────────────────────────────────────────
//
//   status: SIMULATED
//
// Every number above is this simulator agreeing with itself about a gyro it was
// told to switch off. Nothing here has met a real IMU.

import type { Ability, AbilityContext, AbilityResult } from "../core/types.ts";

export type SelfTestInput = {
  periodMs?: number;
  /** How long a check may go unverified before it is worth a probe, ms. */
  staleAfterMs?: number;
  /** Turn rate to probe with, rad/s. Must clear the detector's threshold. */
  probeRate?: number;
  /** How long to hold the probe, ms. */
  probeMs?: number;
  /** Never probe with a person closer than this, metres. */
  clearance?: number;
};

export type SelfTestReport = {
  ticks: number;
  /** Probes started. */
  probes: number;
  /** Probes that ended with the check verified. */
  verified: number;
  /** Times a probe was wanted and withheld because somebody was close. */
  deferred: number;
  /** True once a check answered by disagreeing — there is nothing left to ask. */
  contradicted: boolean;
  /** Longest any check went unverified, ms. */
  worstStaleMs: number;
  /** Checks still unverified when this stopped. */
  unverified: string[];
};

const manifest = {
  id: "sense.self-test",
  version: "0.1.0",
  name: { en: "Self-Test", ar: "الفحص الذاتي" },
  summary: {
    en: "Briefly moves so that a stale cross-check can see whether its sensors still agree.",
    ar: "يتحرّك لحظة حتى يستطيع فحص متقادم أن يرى إن كانت حواسّه ما زالت متفقة.",
  },
  rationale:
    "A contradiction detector compares two measurements of one quantity, and only says " +
    "something when the quantity is large enough that a failed source would differ. Measured " +
    "over ordinary navigation, the turning check is in that position for 0.8% of ticks, with " +
    "unbroken blind runs of 591 ticks — so a robot can carry a dead gyro through a whole " +
    "mission while a perfectly working detector reports nothing. Spending a fraction of a " +
    "second making the check possible turns detection from 0/12 to 12/12, with no false " +
    "positives on a healthy robot and no missions lost. It matters most for the manoeuvre " +
    "nobody planned: discovering the gyro is dead while catching a fall is too late.",
  tags: ["safety", "daemon", "diagnosis", "active-sensing", "verification"],
  risk: "motion" as const,
  requires: ["drive" as const, "imu" as const],
  evidence: [
    {
      source: "imu" as const,
      because: "the check being refreshed is the one that compares the gyro against the wheels",
      maxAgeMs: 500,
      acceptDegraded: true,
    },
    {
      source: "velocity" as const,
      because: "the other half of that comparison is wheel odometry",
    },
  ],
  proof: {
    status: "SIMULATED" as const,
    basis:
      "Over twelve seeds in a cluttered office with the gyro forced to zero: 0/12 detected " +
      "without this, 12/12 with it at a median of 1.9 s, and 0/12 false positives on a healthy " +
      "gyro. No missions lost in any condition. Cost is fixed per probe — 0.2 s in open space, " +
      "about 3 s in clutter — rather than proportional to mission length.",
    verification:
      "On hardware, unplug the IMU's data line mid-mission and time how long until the robot " +
      "says the turning check is contradicted. Then repeat with the IMU working and confirm it " +
      "says verified rather than silent. The second half is the one that matters: a self-test " +
      "that cannot tell a healthy sensor from an unexercised one has not tested anything.",
    failureModes: [
      "It verifies that two sources agree, which is not the same as either being right. Two " +
        "sensors wrong in the same direction agree perfectly, and this will call that verified.",
      "The probe is a heading disturbance, so a navigator re-plans around it. Measured at about " +
        "3 s in clutter and 0.2 s in open space — small, but not free, and paid every probe.",
      "It refuses to probe near a person, so a robot working continuously in a crowd may never " +
        "get a chance and will go unverified for as long as that lasts. It reports that rather " +
        "than probing anyway.",
      "Only the turning check is worth probing in practice. The other two are excited by " +
        "ordinary driving 63–97% of the time, so this adds nothing for them and does not try.",
    ],
    degradedModes: [
      "When a probe is unsafe it is deferred and counted, and the check stays reported as " +
        "unverified. Going unverified and knowing it is the degraded mode.",
    ],
    safetyBoundary:
      "Turns in place at the governor's permitted rate, never with a person inside the " +
      "clearance, and never while the governor is stopped or a reflex holds the wheel.",
  },
  typicalDurationMs: 0,
  daemon: true,
  inputSchema: {
    type: "object" as const,
    properties: {
      periodMs: { type: "number" as const, description: "Control period, ms.", default: 50 },
      staleAfterMs: {
        type: "number" as const,
        description: "How long a check may go unverified before probing, ms.",
        default: 15_000,
      },
      probeRate: { type: "number" as const, description: "Probe turn rate, rad/s.", default: 0.9 },
      probeMs: {
        type: "number" as const,
        description:
          "Probe duration, ms. Must outlast the detector's persistence window plus the turn's " +
          "ramp-up, or the disagreement never accumulates long enough to be raised.",
        default: 800,
      },
      clearance: {
        type: "number" as const,
        description: "Never probe with a person closer than this, m.",
        default: 1.5,
      },
    },
    required: [],
  },
};

const HELD_BY = "self-test";
/** The only check that ordinary driving leaves stale. See the header. */
const WORTH_PROBING = "turning";

export const selfTest: Ability<SelfTestInput, SelfTestReport> = {
  manifest,

  async run(input, ctx: AbilityContext): Promise<AbilityResult<SelfTestReport>> {
    const periodMs = input.periodMs ?? 50;
    const staleAfterMs = input.staleAfterMs ?? 15_000;
    const probeRate = input.probeRate ?? 0.9;
    const probeMs = input.probeMs ?? 800;
    const clearance = input.clearance ?? 1.5;

    const report: SelfTestReport = {
      ticks: 0,
      probes: 0,
      verified: 0,
      deferred: 0,
      contradicted: false,
      worstStaleMs: 0,
      unverified: [],
    };

    const governor = ctx.safety as unknown as {
      standingConflicts?: () => ReadonlyArray<{ kind: string }>;
      verifiability?: () => ReadonlyArray<{
        name: string;
        excited: boolean;
        unverifiedForMs: number | null;
        excitedBy: string;
      }>;
    };

    let probeUntil = 0;
    let probingSince = 0;
    let lastProbeEnded = -Infinity;

    while (!ctx.signal.aborted) {
      report.ticks += 1;
      const now = ctx.now();
      const checks = governor.verifiability?.() ?? [];
      const target = checks.find((check) => check.name === WORTH_PROBING);

      if (!target) {
        // Nothing reports verifiability, so there is nothing to keep fresh.
        await ctx.sleep(periodMs);
        continue;
      }

      // Never verified reads as infinitely stale, not as fresh.
      const staleMs = target.unverifiedForMs ?? Number.POSITIVE_INFINITY;
      if (Number.isFinite(staleMs)) {
        report.worstStaleMs = Math.max(report.worstStaleMs, staleMs);
      }

      if (now < probeUntil) {
        lastProbeEnded = probeUntil;
        ctx.safety.takeWheel(0, probeRate, HELD_BY);
        // Excited and agreeing during the probe is the whole point: that is a
        // verification rather than a silence.
        if (target.excited && staleMs < now - probingSince) report.verified += 1;
        await ctx.sleep(periodMs);
        continue;
      }

      if (ctx.safety.wheelHeldBy() === HELD_BY) ctx.safety.releaseWheel();

      // A check that has answered needs no more asking.
      //
      // The first version missed this and it is the difference between a
      // self-test and a tic. With a dead gyro the check never verifies, so it
      // stays stale forever, so it was probed again on the very next tick:
      // measured at 69 probes in one run and not a single mission completed.
      // A contradiction is the answer, not a reason to repeat the question.
      if (governor.standingConflicts?.().some((c) => c.kind === WORTH_PROBING)) {
        report.contradicted = true;
        await ctx.sleep(periodMs);
        continue;
      }

      const stale = staleMs > staleAfterMs;
      // And a floor between probes, so that anything else which keeps a check
      // stale cannot turn this into a continuous manoeuvre.
      if (!stale || now - lastProbeEnded < staleAfterMs) {
        await ctx.sleep(periodMs);
        continue;
      }

      // Withhold near people. A robot spinning on the spot beside somebody is
      // alarming and the manoeuvre is not urgent — going unverified and saying
      // so is better than probing into a person's space.
      const nearest = ctx.safety.verdict().nearestHuman;
      if (Number.isFinite(nearest) && nearest < clearance) {
        report.deferred += 1;
        await ctx.sleep(periodMs);
        continue;
      }
      // A reflex or another daemon holding the wheel outranks a self-test.
      const heldBy = ctx.safety.wheelHeldBy();
      if ((heldBy !== null && heldBy !== HELD_BY) || ctx.safety.isStopped()) {
        report.deferred += 1;
        await ctx.sleep(periodMs);
        continue;
      }

      probeUntil = now + probeMs;
      probingSince = now;
      report.probes += 1;
      ctx.emit({
        kind: "status",
        message:
          `Self-test: the ${target.name} check has had nothing to say for ` +
          `${Number.isFinite(staleMs) ? (staleMs / 1000).toFixed(1) + " s" : "the whole run"}. ` +
          `It needs ${target.excitedBy}; taking a moment to provide it.`,
        ar: "فحص ذاتي: فحص الدوران ما قدر يقول شي من فترة — بعطيه لحظة ليقدر.",
      });
      ctx.safety.takeWheel(0, probeRate, HELD_BY);
      await ctx.sleep(periodMs);
    }

    if (ctx.safety.wheelHeldBy() === HELD_BY) ctx.safety.releaseWheel();

    report.unverified = (governor.verifiability?.() ?? [])
      .filter((check) => check.unverifiedForMs === null || check.unverifiedForMs > staleAfterMs)
      .map((check) => check.name);

    return {
      ok: true,
      summary:
        report.contradicted
          ? `The ${WORTH_PROBING} check answered by disagreeing after ${report.probes} probe(s). ` +
            "Its two sources do not agree about the same physical quantity, which is a fault, " +
            "and no further probing is going to tell anyone more than that."
          : report.probes === 0
          ? `Nothing went stale: ${report.ticks} ticks, every cross-check stayed in a position ` +
            "to speak for itself."
          : `Probed ${report.probes} time(s) to keep the ${WORTH_PROBING} check able to see ` +
            `anything, ${report.deferred} deferred for people or reflexes. Longest a check went ` +
            `unverified: ${(report.worstStaleMs / 1000).toFixed(1)} s.`,
      data: report,
      metrics: {
        probes: report.probes,
        deferred: report.deferred,
        worstStaleSeconds: report.worstStaleMs / 1000,
        unverifiedAtEnd: report.unverified.length,
      },
    };
  },
};
