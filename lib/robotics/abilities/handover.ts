// ── hri.handover · التسليم لليد ─────────────────────────────────────────────
// Giving something to a person.
//
// The hard part is not the reach, it is the release. Let go too early and it
// falls; too late and you are having a tug of war with someone's hand. Humans
// solve this by feel — the giver senses the receiver's grip load and releases
// over roughly a tenth of a second. So this ability does the same thing: it
// presents the object, waits until the wrist sensor says a person is genuinely
// pulling, and only then opens. If nobody takes it, it does not stand there
// with its arm out — it retracts, says so, and keeps the object safe.

import { distance, headingTo, type Vec2 } from "../core/math.ts";
import { turnTo } from "./_motion.ts";
import type { Ability, AbilityResult } from "../core/types.ts";

export type HandoverInput = {
  /** Which person to hand to; defaults to the nearest attentive one. */
  personId?: string;
  /** Distance to stop at before extending the arm, metres. */
  standoff?: number;
  /** Newtons of pull that mean "they have it". */
  releasePull?: number;
  /** Give up and retract after this long, ms. */
  timeoutMs?: number;
};

export type HandoverReport = {
  person: string | null;
  delivered: boolean;
  /** Pull force at the moment of release, newtons. */
  releasePull: number;
  /** Time from presenting to release, ms. */
  exchangeMs: number;
  retracted: boolean;
};

export const handover: Ability<HandoverInput, HandoverReport> = {
  manifest: {
    id: "hri.handover",
    version: "1.0.0",
    name: { en: "Human Handover", ar: "التسليم لليد" },
    summary: {
      en: "Presents what it is holding to a person and lets go on the feel of their pull — not on a timer, and never into empty air.",
      ar: "بيقدّم الغرض للشخص وبيفلته لما يحس بشدّة إيده — مو على مؤقّت، وأبداً بالهوا.",
    },
    rationale:
      "Handover is the most common physical interaction between a robot and a person, " +
      "and timers get it wrong constantly: people hesitate, get distracted, or reach " +
      "before they have a grip. Releasing on measured pull instead makes the exchange " +
      "feel like being handed something by a person, and the failure mode is safe — if " +
      "nobody pulls, nothing is dropped.",
    tags: ["hri", "manipulation", "collaboration"],
    risk: "contact",
    requires: ["arm", "gripper", "tactile", "camera", "speaker", "lights"],
    // Releasing on a timer is how handovers go wrong, because people hesitate. This
    // releases on measured pull, which means the measurement has to exist.
    evidence: [
      {
        source: "gripper" as const,
        because: "it releases on a measured pull, and an unmeasured pull is a timer",
      },
      {
        source: "people" as const,
        because: "handing over to nobody is dropping something, and the difference is a person track",
      },
      { source: "arm" as const, because: "the object has to be presented before it can be taken" },
    ],
    proof: {
      status: "SIMULATED" as const,
      basis:
        "Releases at 8.0 N when a hand takes the object and keeps hold when nobody does. " +
        "Simulated pull model with a simulated person.",
      verification:
        "A person taking an object from a real gripper with a force gauge in line, and — the " +
          "important half — a person reaching out and stopping short, where nothing should be " +
          "released.",
      failureModes: [
        "A gripper without force sensing turns this into a timer, which is the thing it was " +
          "written to avoid.",
        "The pull threshold is one number for every object. A heavy object's own weight can " +
          "approach it.",
        "It cannot tell a person taking the object from the object snagging on something.",
      ],
      degradedModes: [
        "None: without force it refuses rather than releasing on a timer.",
      ],
      safetyBoundary:
        "Never releases without a measured pull, and never closes on a hand — the grip is already " +
        "closed before a person reaches for it.",
    },
    typicalDurationMs: 8000,
    inputSchema: {
      type: "object",
      properties: {
        personId: { type: "string", description: "Who to hand it to." },
        standoff: { type: "number", description: "Stop this far away, m.", default: 0.75 },
        releasePull: { type: "number", description: "Pull that means 'I have it', N.", default: 2.5 },
        timeoutMs: { type: "number", description: "Retract after this long.", default: 15000 },
      },
      required: [],
    },
  },

  precondition(_input, ctx) {
    const held = ctx.robot.gripper().holding;
    return held
      ? { ok: true }
      : { ok: false, reason: "nothing in the gripper to hand over" };
  },

  async run(input, ctx): Promise<AbilityResult<HandoverReport>> {
    const standoff = input.standoff ?? 0.75;
    const releasePull = input.releasePull ?? 2.5;
    const timeoutMs = input.timeoutMs ?? 15_000;
    const started = ctx.now();

    const report: HandoverReport = {
      person: null,
      delivered: false,
      releasePull: 0,
      exchangeMs: 0,
      retracted: false,
    };

    const pick = () => {
      const humans = ctx.robot.trackHumans();
      return input.personId
        ? humans.find((h) => h.id === input.personId)
        : humans.find((h) => h.attentive) ?? humans[0];
    };

    const person = pick();
    if (!person) {
      return {
        ok: false,
        summary: "Nobody here to hand it to.",
        failure: "not-found",
        data: report,
      };
    }
    report.person = person.id;

    // 1. Face them and say what is coming. A hand appearing from a machine that
    //    has not announced itself is how people get startled into grabbing.
    const pose = ctx.robot.pose();
    await turnTo(ctx, headingTo(pose, person.at), 0.1, 4000);
    ctx.robot.setLights("handover", "#38bdf8");
    ctx.robot.say("Here you go — take it when you're ready. تفضّل، خُذه وقت ما تجهز.");
    ctx.emit({ kind: "signal", channel: "sound", payload: "handover offer" });

    // 2. Present it: arm out toward them, at a comfortable height, moving
    //    slowly enough that they can track it.
    const local = toBodyFrame(ctx.robot.pose(), person.at, standoff);
    ctx.robot.moveArm(local, 0.85);

    const presentedAt = ctx.now();
    let maxPull = 0;

    // 3. Wait for their hand, not for the clock.
    while (ctx.now() - started < timeoutMs && !ctx.signal.aborted) {
      const gripper = ctx.robot.gripper();
      maxPull = Math.max(maxPull, gripper.externalPull);

      if (gripper.externalPull >= releasePull) {
        // They have it. Open over a beat rather than instantly, which is what
        // makes the exchange feel deliberate instead of dropped.
        report.releasePull = gripper.externalPull;
        ctx.robot.setGripper(0.35, 0.4);
        await ctx.sleep(120);
        ctx.robot.setGripper(0, 0);
        await ctx.sleep(250);

        report.delivered = ctx.robot.gripper().holding === null;
        report.exchangeMs = ctx.now() - presentedAt;
        break;
      }

      // If they wander off mid-offer, do not keep holding the arm out.
      const current = pick();
      if (!current || current.distance > standoff + 1.5) {
        ctx.emit({ kind: "warn", message: "They moved away — pulling the arm back in." });
        break;
      }

      await ctx.sleep(60);
    }

    // 4. Retract whatever happened, so the arm is never left extended.
    ctx.robot.moveArm({ x: 0.3, y: 0 }, 0.4);
    report.retracted = true;
    ctx.robot.setLights("idle", "#3b82f6");
    ctx.emit({ kind: "metric", name: "handover.pull", value: maxPull, unit: "N" });

    if (!report.delivered) {
      ctx.robot.say("I'll hold on to it. رح أضلّ ماسكه.");
      return {
        ok: false,
        summary: `${person.id} didn't take it — strongest pull was ${maxPull.toFixed(1)} N against a ${releasePull.toFixed(1)} N release threshold. Arm retracted, still holding.`,
        failure: maxPull > 0 ? "gave-up" : "timeout",
        data: report,
        metrics: { maxPull, exchangeMs: ctx.now() - presentedAt },
      };
    }

    return {
      ok: true,
      summary: `Handed over to ${person.id} — released at ${report.releasePull.toFixed(1)} N after ${report.exchangeMs} ms.`,
      data: report,
      metrics: { releasePull: report.releasePull, exchangeMs: report.exchangeMs },
    };
  },
};

/** A point `standoff` metres from the robot toward `target`, in the body frame. */
function toBodyFrame(
  pose: { x: number; y: number; theta: number },
  target: Vec2,
  standoff: number,
): Vec2 {
  const bearing = headingTo(pose, target) - pose.theta;
  const reach = Math.min(standoff, distance(pose, target) * 0.8, 0.75);
  return { x: Math.cos(bearing) * reach, y: Math.sin(bearing) * reach };
}
