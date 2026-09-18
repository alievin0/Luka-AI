// ── motion.telegraph · إشارة النيّة ──────────────────────────────────────────
// Robots are dangerous mostly because they are unreadable. This ability makes
// the machine's next move obvious *before* it makes it, by moving in a way that
// gives the intention away.
//
// The idea comes out of legible-motion research: the most readable trajectory
// is not the most efficient one, it is the one that most quickly rules out the
// goals you are *not* going for. So the pre-cue here is not a generic wiggle —
// it is aimed away from whichever plausible alternative the goal is most easily
// confused with.

import { angleDiff, clamp, degrees, headingTo, type Vec2, wrapAngle } from "../core/math.ts";
import { turnTo } from "./_motion.ts";
import type { Ability, AbilityResult } from "../core/types.ts";

export type TelegraphInput = {
  x: number;
  y: number;
  /** Other places the robot might plausibly be heading. */
  alternatives?: Array<{ x: number; y: number }>;
  /** Spoken line; defaults to a bilingual announcement. */
  utterance?: string;
  /** Wait up to this long for a nearby person to look at the robot. */
  waitForAttentionMs?: number;
};

export type TelegraphReport = {
  /** Degrees of separation the pre-cue created between goal and best rival. */
  legibilityGain: number;
  audienceNearby: boolean;
  acknowledged: boolean;
  cueDurationMs: number;
};

export const intentTelegraph: Ability<TelegraphInput, TelegraphReport> = {
  manifest: {
    id: "motion.telegraph",
    version: "1.0.0",
    name: { en: "Intent Telegraph", ar: "إشارة النيّة" },
    summary: {
      en: "Announce the next move with light, voice and a legible pre-cue turn that rules out the goals the robot is NOT going to.",
      ar: "يعلن حركته الجاية بالضوء والصوت وبحركة تمهيدية واضحة بتستبعد الأهداف اللي مو رايح عليها.",
    },
    rationale:
      "People get hurt around robots when they guess wrong about what the machine is " +
      "about to do. Predictability is not enough — the motion has to actively " +
      "disambiguate. This ability scores every candidate pre-cue heading by how much " +
      "angular separation it creates between the true goal and the most confusable " +
      "alternative, then performs the winner, so a bystander knows within a second " +
      "where the robot is going.",
    tags: ["hri", "safety", "communication"],
    risk: "motion",
    requires: ["drive", "lights", "speaker"],
    // Telegraphing is for the benefit of a person, so it needs to know a person is
    // there. Signalling to an empty room is harmless; believing the room is empty
    // because nothing is looking is not.
    evidence: [
      {
        source: "people" as const,
        because: "the cue is for somebody, and an empty list from a blind robot is not an empty room",
      },
      { source: "pose" as const, because: "the cue rules out the goals it is not heading for" },
    ],
    proof: {
      status: "SIMULATED" as const,
      basis:
        "Runs in the navigation demos and emits the cue before motion. Whether it makes a human " +
        "any safer has not been measured and cannot be measured in a simulator, because the " +
        "simulated people do not read it.",
      verification:
        "This one needs people, not instruments: whether a bystander can say where the robot is " +
        "about to go, before it goes there, more often than chance. Anything less is a claim " +
        "about the light being on.",
      failureModes: [
        "A cue nobody can interpret is decoration. Nothing here establishes that the chosen " +
          "signal reads as a direction to a person who has not been told what it means.",
        "Telegraphing an intention the planner then changes is worse than saying nothing.",
        "It signals to people it can see. Someone behind the robot gets nothing.",
      ],
      degradedModes: [
        "With no person tracks it does not run; the honest alternative would be signalling " +
          "constantly, which trains people to ignore it.",
      ],
      safetyBoundary:
        "Signals only. It never changes what the robot does, so a wrong cue misleads rather than " +
        "moves.",
    },
    typicalDurationMs: 2500,
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number", description: "Where the robot is about to go, X." },
        y: { type: "number", description: "Where the robot is about to go, Y." },
        alternatives: {
          type: "array",
          description: "Other goals a bystander might think the robot means.",
          items: {
            type: "object",
            properties: { x: { type: "number" }, y: { type: "number" } },
            required: ["x", "y"],
          },
        },
        utterance: { type: "string", description: "What to say out loud." },
        waitForAttentionMs: {
          type: "number",
          description: "How long to wait for a person to look over.",
          default: 1500,
        },
      },
      required: ["x", "y"],
    },
  },

  async run(input, ctx): Promise<AbilityResult<TelegraphReport>> {
    const started = ctx.now();
    const goal: Vec2 = { x: input.x, y: input.y };
    const pose = ctx.robot.pose();
    const goalBearing = headingTo(pose, goal);

    const alternatives = (input.alternatives ?? []).map((a) => headingTo(pose, a));
    const rival = mostConfusable(goalBearing, alternatives);

    // Pick the pre-cue heading: exaggerate *away* from the rival, but never so
    // far that the robot looks like it is going somewhere else entirely.
    const exaggeration = rival === null ? 0.35 : clamp(Math.abs(angleDiff(goalBearing, rival)) * 0.6, 0.25, 0.7);
    const awayFromRival =
      rival === null ? 1 : Math.sign(angleDiff(rival, goalBearing)) || 1;
    const cueHeading = wrapAngle(goalBearing + awayFromRival * exaggeration);

    const legibilityGain =
      rival === null
        ? degrees(exaggeration)
        : degrees(Math.abs(angleDiff(cueHeading, rival)) - Math.abs(angleDiff(goalBearing, rival)));

    const humans = ctx.robot.trackHumans();
    const audienceNearby = humans.some((h) => h.distance < 4);

    // 1. Light: a directional sweep toward the goal side.
    ctx.robot.setLights(awayFromRival > 0 ? "indicate-left" : "indicate-right", "#f59e0b");
    ctx.emit({
      kind: "signal",
      channel: "light",
      payload: `amber sweep ${awayFromRival > 0 ? "left" : "right"}`,
    });

    // 2. Voice.
    const line =
      input.utterance ??
      `Heading to ${goal.x.toFixed(1)}, ${goal.y.toFixed(1)} — رايح عالنقطة، انتبه لو سمحت.`;
    ctx.robot.say(line);
    ctx.emit({ kind: "signal", channel: "sound", payload: line });

    // 3. Wait for someone to actually look, if anyone is around.
    let acknowledged = !audienceNearby;
    const waitUntil = ctx.now() + (input.waitForAttentionMs ?? 1500);
    while (audienceNearby && !acknowledged && ctx.now() < waitUntil && !ctx.signal.aborted) {
      acknowledged = ctx.robot
        .trackHumans()
        .some((h) => h.distance < 4 && h.attentive);
      await ctx.sleep(100);
    }

    // 4. The pre-cue itself: turn to the exaggerated heading, hold, then settle
    //    onto the true goal bearing. The hold is what makes it readable.
    ctx.emit({
      kind: "signal",
      channel: "motion",
      payload: `pre-cue turn to ${degrees(cueHeading).toFixed(0)}°`,
    });
    await turnTo(ctx, cueHeading, 0.08, 3000);
    await ctx.sleep(350);
    await turnTo(ctx, goalBearing, 0.06, 3000);

    ctx.robot.setLights("travelling", "#22c55e");

    const report: TelegraphReport = {
      legibilityGain,
      audienceNearby,
      acknowledged,
      cueDurationMs: ctx.now() - started,
    };
    ctx.emit({ kind: "metric", name: "telegraph.legibilityGain", value: legibilityGain, unit: "deg" });

    return {
      ok: true,
      summary: audienceNearby
        ? `Signalled the move to ${humans.length} nearby person(s); ${acknowledged ? "acknowledged" : "no eye contact"} — pre-cue added ${legibilityGain.toFixed(0)}° of separation.`
        : `Nobody nearby; signalled anyway (${legibilityGain.toFixed(0)}° pre-cue) and moved on.`,
      data: report,
      metrics: { legibilityGain, cueDurationMs: report.cueDurationMs },
    };
  },
};

/** The alternative goal whose bearing is closest to the real one. */
function mostConfusable(goalBearing: number, alternatives: number[]): number | null {
  let best: number | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const alt of alternatives) {
    const gap = Math.abs(angleDiff(goalBearing, alt));
    if (gap < bestGap) {
      bestGap = gap;
      best = alt;
    }
  }
  return best;
}
