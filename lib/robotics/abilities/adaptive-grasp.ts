// ── grasp.adaptive · القبضة المتكيّفة ───────────────────────────────────────
// Picking something up without knowing what it is.
//
// A gripper told to squeeze at a fixed force is wrong twice: too weak for the
// bottle, hard enough to ruin the peach. This ability never gets told the
// force. It closes until it feels contact, works out how stiff the thing is
// from how the force builds against closure, derives the force that would
// damage it, then hunts upward for the *smallest* force that stops the object
// slipping — and refuses the grasp outright when that force does not exist.

import { clamp } from "../core/math.ts";
import { distance } from "../core/math.ts";
import type { Ability, AbilityResult } from "../core/types.ts";

export type GraspInput = {
  /** Label of the object to pick up, as perception reports it. */
  target: string;
  /** Force ceiling regardless of what the object could take, newtons. */
  maxForce?: number;
  /** How much slip is tolerable before tightening, 0..1. */
  slipTolerance?: number;
  /** Abandon the grasp after this long, ms. */
  timeoutMs?: number;
};

export type GraspReport = {
  target: string;
  held: boolean;
  compliance: "soft" | "firm" | "rigid" | "unknown";
  /** Newtons per unit closure, measured during the squeeze. */
  measuredStiffness: number;
  /** Force the ability settled on. */
  holdForce: number;
  /** Estimated force at which the object would be damaged. */
  damageForce: number;
  /** holdForce / damageForce — under 1.0 means the object survived. */
  safetyRatio: number;
  attempts: number;
};

export const adaptiveGrasp: Ability<GraspInput, GraspReport> = {
  manifest: {
    id: "grasp.adaptive",
    version: "1.0.0",
    name: { en: "Adaptive Grasp", ar: "القبضة المتكيّفة" },
    summary: {
      en: "Feels out an unknown object's stiffness, then holds it with the least force that stops it slipping — and refuses when no safe force exists.",
      ar: "بيحسّ بصلابة الغرض المجهول، وبعدين بيمسكه بأقل قوة بتمنعه ينزلق — وإذا ما في قوة آمنة بيرفض.",
    },
    rationale:
      "Force control is where manipulation actually lives. Vision tells you where " +
      "something is, never how hard to hold it. By treating the squeeze as a " +
      "measurement — force against closure gives you stiffness, stiffness gives you a " +
      "damage threshold, slip tells you the friction requirement — the robot derives " +
      "its own force budget for an object it has never seen. The important case is the " +
      "one where the budget is empty: the minimum force that holds is above the force " +
      "that crushes, and the right answer is to put it down and say so.",
    tags: ["manipulation", "force-control", "perception"],
    risk: "contact",
    requires: ["arm", "gripper", "tactile", "camera"],
    // Force is the whole point: this derives stiffness by squeezing and holds at
    // the least force that works. A gripper that does not measure force reports
    // zero, and a controller squeezing an egg reads zero as "I have not started".
    evidence: [
      {
        source: "gripper" as const,
        because: "the least force that works can only be found by measuring the force",
      },
      { source: "arm" as const, because: "it has to know where the hand is before closing it" },
    ],
    proof: {
      status: "SIMULATED" as const,
      basis:
        "Holds a tin and a peach at the least force that works and refuses the egg, because no " +
        "safe force exists for it — that refusal is the result worth having. Simulated contact " +
        "and yield model.",
      verification:
        "Grip objects of known crush strength with an in-line force gauge and compare the held " +
        "force against the gauge. The egg is the test: it should be refused, not crushed slowly.",
      failureModes: [
        "A gripper with no force sensing cannot run this at all, and the evidence layer is what " +
          "stops it pretending otherwise.",
        "Stiffness is derived from the first squeeze, so an object that yields non-linearly — a " +
          "sealed cup, a spring-loaded clip — is modelled wrongly after the first millimetre.",
        "Slip is detected after it starts. A smooth heavy object can be dropped before the " +
          "correction lands.",
      ],
      degradedModes: [
        "On a gripper that reports position but not force, the evidence is degraded and this " +
          "refuses. Position-only grasping is a different capability and should be written as one.",
      ],
      safetyBoundary:
        "Never exceeds the governor's contact-force ceiling, and refuses rather than exceeding it " +
        "when no force below the ceiling will hold the object.",
    },
    typicalDurationMs: 6000,
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Label of the object to pick up." },
        maxForce: { type: "number", description: "Absolute force ceiling, N.", default: 25 },
        slipTolerance: { type: "number", description: "Acceptable slip signal, 0..1.", default: 0.05 },
        timeoutMs: { type: "number", description: "Abandon after this long.", default: 20000 },
      },
      required: ["target"],
    },
  },

  async run(input, ctx): Promise<AbilityResult<GraspReport>> {
    const maxForce = input.maxForce ?? 25;
    const slipTolerance = input.slipTolerance ?? 0.05;
    const timeoutMs = input.timeoutMs ?? 20_000;
    const started = ctx.now();

    const report: GraspReport = {
      target: input.target,
      held: false,
      compliance: "unknown",
      measuredStiffness: 0,
      holdForce: 0,
      damageForce: 0,
      safetyRatio: 0,
      attempts: 0,
    };

    const find = () =>
      ctx.robot
        .detectObjects()
        .find((o) => o.label.toLowerCase().includes(input.target.toLowerCase()));

    const detection = find();
    if (!detection) {
      return {
        ok: false,
        summary: `I can't see "${input.target}" from here.`,
        failure: "not-found",
        data: report,
      };
    }

    // 1. Put the hand over the object, in the body frame.
    const pose = ctx.robot.pose();
    const dx = detection.at.x - pose.x;
    const dy = detection.at.y - pose.y;
    const cos = Math.cos(pose.theta);
    const sin = Math.sin(pose.theta);
    const local = { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };

    if (Math.hypot(local.x, local.y) > 0.75) {
      return {
        ok: false,
        summary: `"${input.target}" is ${distance(pose, detection.at).toFixed(2)} m away — too far to reach. Drive closer first.`,
        failure: "precondition",
        data: report,
      };
    }

    ctx.robot.setLights("reaching", "#a855f7");
    ctx.robot.setGripper(0, 0);
    ctx.robot.moveArm(local, 0.35);
    await waitForArm(ctx, 4000);

    // 2. Measure compliance properly: squeeze at two light, known forces and
    //    read how much further the fingers travelled. Force over closure *is*
    //    stiffness — a single squeeze cannot tell a small rigid object from a
    //    large soft one, but the slope can. Both probes stay gentle, because
    //    the measurement is worthless if it destroys what it measured.
    // Both probes are deliberately feeble. The fingers travel the whole free
    // stroke at the lower one, so even something that yields at a newton is
    // never squeezed hard over a long stroke — by the time the force goes up,
    // there is almost no distance left to travel.
    const probeLow = 0.3;
    const probeHigh = 0.9;

    ctx.robot.setGripper(1, probeLow);
    const low = await settleClosure(ctx, timeoutMs / 4);
    if (low.closure === null) {
      ctx.robot.setGripper(0, 0);
      return {
        ok: false,
        summary: `Closed on nothing — "${input.target}" is not between the fingers.`,
        failure: "not-found",
        data: report,
      };
    }

    ctx.robot.setGripper(1, probeHigh);
    const high = await settleClosure(ctx, timeoutMs / 4);
    // If even the probe made it creep, its yield point is below 1.2 N. Ease off
    // at once and treat that as the hard evidence it is.
    const fragile = high.creeping || high.closure === null;
    if (fragile) ctx.robot.setGripper(1, probeLow);

    const closureHigh = high.closure ?? low.closure;
    const deflection = Math.max(closureHigh - low.closure, 1e-4);
    report.measuredStiffness = fragile
      ? clamp((probeLow * 2) / Math.max(deflection, 0.05), 0.5, 10)
      : (probeHigh - probeLow) / deflection;
    report.compliance =
      report.measuredStiffness > 60
        ? "rigid"
        : report.measuredStiffness > 12
          ? "firm"
          : "soft";

    // A first guess at the damage threshold, used to size the search steps and
    // to warn — not as the safety mechanism. The safety mechanism is the creep
    // check below, which measures the real thing instead of predicting it.
    report.damageForce = fragile
      ? probeHigh
      : clamp(report.measuredStiffness * 0.6, 0.5, maxForce * 2);

    ctx.emit({
      kind: "metric",
      name: "grasp.stiffness",
      value: report.measuredStiffness,
      unit: "N/closure",
    });
    ctx.emit({
      kind: "status",
      message: `Feels ${report.compliance} (${report.measuredStiffness.toFixed(1)} N per unit closure)${fragile ? " and already yielding under the probe" : ""} — expecting damage near ${report.damageForce.toFixed(1)} N`,
      ar: `حاسس إنه ${arabicCompliance(report.compliance)} (${report.measuredStiffness.toFixed(1)})${fragile ? " وعم يترضّض من الجس" : ""} — بيتضرر تقريباً عند ${report.damageForce.toFixed(1)} نيوتن`,
    });

    // 3. Walk the force up until the object stops slipping, watching for the
    //    one thing that means stop: closure creeping while the force is held
    //    constant. That is the object yielding, and no grasp is worth it.
    // Anything that yielded under the probe gets searched from below it, in
    // small steps, and is never allowed back up to the force that hurt it.
    const ceiling = fragile
      ? Math.min(probeHigh, maxForce, ctx.safety.contactForceLimit())
      : Math.min(maxForce, ctx.safety.contactForceLimit());
    const step = fragile ? 0.1 : clamp(report.damageForce * 0.12, 0.15, 2);
    let force = fragile ? probeLow : Math.min(probeHigh, ceiling);
    let yielding = false;
    let lastSafeForce = 0;

    while (force <= ceiling + 1e-9 && !ctx.signal.aborted) {
      report.attempts += 1;
      ctx.robot.setGripper(1, force);
      await ctx.sleep(120);

      const before = ctx.robot.gripper().closure;
      await ctx.sleep(120);
      const after = ctx.robot.gripper();

      // Fingers at the end stop on a compliant object mean it has been squashed
      // flat: the closure sensor can no longer report the creep, so treat the
      // saturation itself as the warning.
      const bottomedOut = after.closure >= 0.995 && report.measuredStiffness < 60;

      if (after.closure - before > 0.008 || bottomedOut) {
        yielding = true;
        ctx.robot.setGripper(1, lastSafeForce);
        ctx.emit({
          kind: "warn",
          message: bottomedOut
            ? `Fingers bottomed out on the ${input.target} at ${force.toFixed(1)} N — released to ${lastSafeForce.toFixed(1)} N.`
            : `Object started to deform at ${force.toFixed(1)} N — released to ${lastSafeForce.toFixed(1)} N.`,
        });
        break;
      }
      lastSafeForce = force;

      if (after.holding && after.slip <= slipTolerance) {
        await ctx.sleep(400);
        const settled = ctx.robot.gripper();
        if (settled.holding && settled.slip <= slipTolerance) {
          report.held = true;
          report.holdForce = force;
          break;
        }
      }

      if (ctx.now() - started > timeoutMs) break;
      force += step;
    }

    report.safetyRatio =
      report.damageForce > 0 ? clamp(report.holdForce / report.damageForce, 0, 9.99) : 0;

    if (!report.held) {
      // The interesting failure: holding it would break it.
      ctx.robot.setGripper(0, 0);
      await ctx.sleep(300);
      const needed = force;
      ctx.robot.say(
        `I can't hold the ${input.target} without damaging it. ما بقدر أمسكه بدون ما أكسره.`,
      );
      ctx.emit({
        kind: "warn",
        message: `Grasp refused: needs ~${needed.toFixed(1)} N, damage starts near ${report.damageForce.toFixed(1)} N.`,
      });
      return {
        ok: false,
        summary: yielding
          ? `Put the ${input.target} back down — it started to deform at ${needed.toFixed(1)} N and still wasn't held. No safe grip exists.`
          : `Put the ${input.target} back down — it needs more than ${needed.toFixed(1)} N to hold and I budgeted ${report.damageForce.toFixed(1)} N before damage. No safe grip exists.`,
        failure: "unsafe",
        data: report,
        metrics: { damageForce: report.damageForce, attempts: report.attempts },
      };
    }

    ctx.robot.setLights("holding", "#22c55e");
    ctx.emit({ kind: "metric", name: "grasp.holdForce", value: report.holdForce, unit: "N" });

    return {
      ok: true,
      summary: `Holding the ${input.target} at ${report.holdForce.toFixed(1)} N — ${report.compliance}, ${(report.safetyRatio * 100).toFixed(0)}% of its damage threshold, found in ${report.attempts} step(s).`,
      data: report,
      metrics: {
        holdForce: report.holdForce,
        safetyRatio: report.safetyRatio,
        attempts: report.attempts,
      },
    };
  },
};

type Ctx = Parameters<typeof adaptiveGrasp.run>[1];

async function waitForArm(ctx: Ctx, timeoutMs: number): Promise<void> {
  const until = ctx.now() + timeoutMs;
  while (ctx.now() < until && !ctx.signal.aborted) {
    if (!ctx.robot.arm().moving) return;
    await ctx.sleep(40);
  }
}

/**
 * Squeeze and report where the fingers came to rest, and whether they then kept
 * sinking.
 *
 * Two phases, because three different motions look alike on a closure sensor:
 * the fast free stroke before contact, the slow creep of something yielding,
 * and stillness. Phase one waits for the speed to drop well below the free
 * closing rate — that is contact. Phase two then watches for continued motion
 * at that force, which can only be the object giving way.
 */
async function settleClosure(
  ctx: Ctx,
  timeoutMs: number,
): Promise<{ closure: number | null; creeping: boolean }> {
  const sampleMs = 40;
  const freeStrokePerSample = 0.03; // well under the 1.8 /s free closing rate
  const until = ctx.now() + timeoutMs;

  let previous = ctx.robot.gripper().closure;
  let slowFor = 0;
  let contact: number | null = null;

  // Phase 1 — find contact.
  while (ctx.now() < until && !ctx.signal.aborted) {
    await ctx.sleep(sampleMs);
    const closure = ctx.robot.gripper().closure;
    const moved = Math.abs(closure - previous);
    previous = closure;

    if (closure >= 0.995) return { closure: null, creeping: false };

    slowFor = moved < freeStrokePerSample ? slowFor + sampleMs : 0;
    if (slowFor >= 3 * sampleMs) {
      contact = closure;
      break;
    }
  }

  if (contact === null) {
    return { closure: previous >= 0.995 ? null : previous, creeping: false };
  }

  // Phase 2 — is it still sinking at this force? Sampled rather than waited
  // out, so a yielding object is released in a tenth of a second.
  for (let elapsed = 0; elapsed < 280; elapsed += sampleMs) {
    await ctx.sleep(sampleMs);
    const closure = ctx.robot.gripper().closure;
    if (closure - contact > 0.008) return { closure: contact, creeping: true };
    if (closure >= 0.995) return { closure: contact, creeping: true };
  }
  return { closure: contact, creeping: false };
}

function arabicCompliance(value: GraspReport["compliance"]): string {
  if (value === "soft") return "طري";
  if (value === "firm") return "متوسط";
  if (value === "rigid") return "قاسي";
  return "غير معروف";
}
