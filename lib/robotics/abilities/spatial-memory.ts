// ── memory.spatial · الذاكرة المكانية ───────────────────────────────────────
// "Where did I last see the keys?"
//
// The trick is not storing positions — that is a hash map. The trick is knowing
// how much to trust one. A sofa observed an hour ago is still where you left
// it; a coffee cup is not. So this memory learns a decay rate *per label* from
// its own track record: every time it goes back and finds the thing where it
// expected, that label's half-life grows; every time it is surprised, the
// half-life shrinks. After a few hours the robot has quietly worked out which
// objects in its world are furniture and which are traffic.

import { distance, type Vec2 } from "../core/math.ts";
import type { Ability, AbilityResult } from "../core/types.ts";

export type SpatialRecord = {
  label: string;
  at: Vec2;
  lastSeenMs: number;
  observations: number;
  /** Learned staleness half-life, ms. */
  halfLifeMs: number;
  confirmations: number;
  surprises: number;
};

export type SpatialInput = {
  op?: "observe" | "recall" | "forget" | "list";
  /** Object label for recall/forget. */
  label?: string;
  /** Treat a re-sighting further than this from memory as a surprise, metres. */
  surpriseRadius?: number;
};

export type SpatialReport = {
  op: string;
  records: Array<SpatialRecord & { confidence: number; ageMs: number }>;
  /** For `recall`: the best answer, or null if nothing is remembered. */
  answer: (SpatialRecord & { confidence: number; ageMs: number }) | null;
  learned: string[];
};

const DEFAULT_HALF_LIFE = 5 * 60 * 1000;
const MIN_HALF_LIFE = 20 * 1000;
const MAX_HALF_LIFE = 12 * 60 * 60 * 1000;
const KEY = (label: string) => `spatial:${label.toLowerCase()}`;

export const spatialMemory: Ability<SpatialInput, SpatialReport> = {
  manifest: {
    id: "memory.spatial",
    version: "1.0.0",
    name: { en: "Spatial Memory", ar: "الذاكرة المكانية" },
    summary: {
      en: "Remembers where things were seen and learns, per object, how fast that knowledge goes stale.",
      ar: "بتتذكر وين شاف الأغراض، وبتتعلّم لكل غرض كم بتضل معلومته صالحة قبل ما تقدم.",
    },
    rationale:
      "Perception is expensive and the world is bigger than the field of view, so a " +
      "robot has to act on memory most of the time. A flat 'last known position' lies " +
      "confidently. Attaching a learned half-life to every label turns memory into an " +
      "honest estimate: the robot can say 'the cup was there eight minutes ago, I would " +
      "not bet on it' and go look, while not wasting a trip to re-confirm the fridge.",
    tags: ["memory", "perception", "learning"],
    risk: "passive",
    requires: ["camera"],
    // It learns per object how fast its own knowledge goes stale, which is only
    // meaningful if an observation is distinguishable from the absence of one.
    evidence: [
      {
        source: "detections" as const,
        because: "a memory of where things are is built from having seen them there",
      },
      { source: "pose" as const, because: "a detection is only a location once you know where you were" },
    ],
    proof: {
      status: "SIMULATED" as const,
      basis:
        "Learns different staleness rates for objects that move and objects that do not, in the " +
        "simulator, where the ground truth of which is which is available to check against.",
      verification:
        "Place known objects in a real room, move some of them on a known schedule, and check " +
        "the learned half-lives against that schedule. The claim is about the rates, not about " +
        "recall.",
      failureModes: [
        "A detector that misses an object reads as the object having moved, so a flaky detector " +
          "teaches this that everything is volatile.",
        "It learns per object class, so one unusually mobile sofa poisons the class.",
        "Nothing distinguishes an object that moved from one that was occluded.",
      ],
      degradedModes: [
        "Fewer detections mean slower learning rather than wrong learning, because an absent " +
          "observation is recorded as absent.",
      ],
      safetyBoundary:
        "Passive; it records and answers questions and never moves anything.",
    },
    typicalDurationMs: 400,
    inputSchema: {
      type: "object",
      properties: {
        op: {
          type: "string",
          description: "observe | recall | forget | list",
          enum: ["observe", "recall", "forget", "list"],
          default: "observe",
        },
        label: { type: "string", description: "Object label, for recall/forget." },
        surpriseRadius: {
          type: "number",
          description: "Distance from memory that counts as 'it moved', m.",
          default: 0.75,
        },
      },
      required: [],
    },
  },

  async run(input, ctx): Promise<AbilityResult<SpatialReport>> {
    const op = input.op ?? "observe";
    const surpriseRadius = input.surpriseRadius ?? 0.75;
    const now = ctx.now();
    const learned: string[] = [];

    const readAll = (): SpatialRecord[] =>
      ctx.memory
        .keys("spatial:")
        .map((key) => ctx.memory.get<SpatialRecord>(key))
        .filter((r): r is SpatialRecord => r !== undefined);

    const decorate = (record: SpatialRecord) => {
      const ageMs = Math.max(now - record.lastSeenMs, 0);
      return {
        ...record,
        ageMs,
        confidence: Math.pow(0.5, ageMs / record.halfLifeMs),
      };
    };

    if (op === "forget") {
      if (!input.label) {
        return { ok: false, summary: "forget needs a label.", failure: "precondition" };
      }
      ctx.memory.delete(KEY(input.label));
      return {
        ok: true,
        summary: `Forgot everything about "${input.label}".`,
        data: { op, records: [], answer: null, learned: [] },
      };
    }

    if (op === "recall") {
      if (!input.label) {
        return { ok: false, summary: "recall needs a label.", failure: "precondition" };
      }
      const record = ctx.memory.get<SpatialRecord>(KEY(input.label));
      if (!record) {
        return {
          ok: false,
          summary: `No memory of "${input.label}" — never seen it.`,
          failure: "not-found",
          data: { op, records: [], answer: null, learned: [] },
        };
      }
      const answer = decorate(record);
      ctx.emit({ kind: "mark", label: `${record.label} (memory)`, at: record.at });
      ctx.emit({ kind: "metric", name: "memory.confidence", value: answer.confidence });
      return {
        ok: true,
        summary: `"${record.label}" was at (${record.at.x.toFixed(1)}, ${record.at.y.toFixed(1)}) ${humanAge(answer.ageMs)} ago — confidence ${(answer.confidence * 100).toFixed(0)}% (half-life ${humanAge(record.halfLifeMs)}).`,
        data: { op, records: [answer], answer, learned: [] },
        metrics: { confidence: answer.confidence, ageMs: answer.ageMs },
      };
    }

    if (op === "list") {
      const records = readAll().map(decorate).sort((a, b) => b.confidence - a.confidence);
      return {
        ok: true,
        summary: `Holding ${records.length} remembered object(s).`,
        data: { op, records, answer: null, learned: [] },
      };
    }

    // observe
    const seen = ctx.robot.detectObjects();
    for (const detection of seen) {
      const key = KEY(detection.label);
      const previous = ctx.memory.get<SpatialRecord>(key);

      if (!previous) {
        ctx.memory.set<SpatialRecord>(key, {
          label: detection.label,
          at: detection.at,
          lastSeenMs: now,
          observations: 1,
          halfLifeMs: DEFAULT_HALF_LIFE,
          confirmations: 0,
          surprises: 0,
        });
        learned.push(`first sighting of ${detection.label}`);
        continue;
      }

      const moved = distance(previous.at, detection.at);
      const surprised = moved > surpriseRadius;

      // The learning rule: found where expected → trust this label's positions
      // longer; found somewhere else → trust them for less time. Multiplicative
      // so a label converges on its own timescale rather than a global one.
      const halfLifeMs = clampHalfLife(
        surprised ? previous.halfLifeMs * 0.55 : previous.halfLifeMs * 1.35,
      );

      ctx.memory.set<SpatialRecord>(key, {
        label: detection.label,
        // Confirmations refine the estimate; surprises replace it outright.
        at: surprised
          ? detection.at
          : {
              x: previous.at.x * 0.6 + detection.at.x * 0.4,
              y: previous.at.y * 0.6 + detection.at.y * 0.4,
            },
        lastSeenMs: now,
        observations: previous.observations + 1,
        halfLifeMs,
        confirmations: previous.confirmations + (surprised ? 0 : 1),
        surprises: previous.surprises + (surprised ? 1 : 0),
      });

      if (surprised) {
        learned.push(
          `${detection.label} had moved ${moved.toFixed(1)} m — trusting it for ${humanAge(halfLifeMs)} now`,
        );
      } else if (previous.observations >= 2) {
        learned.push(
          `${detection.label} confirmed in place — trusted for ${humanAge(halfLifeMs)}`,
        );
      }
    }

    const records = readAll().map(decorate).sort((a, b) => b.confidence - a.confidence);
    for (const detection of seen) {
      ctx.emit({ kind: "mark", label: detection.label, at: detection.at });
    }

    return {
      ok: true,
      summary:
        seen.length === 0
          ? `Nothing in view; still holding ${records.length} remembered object(s).`
          : `Observed ${seen.length} object(s); memory now holds ${records.length}.${learned.length ? ` ${learned[0]}.` : ""}`,
      data: { op, records, answer: null, learned },
      metrics: { observed: seen.length, remembered: records.length },
    };
  },
};

function clampHalfLife(value: number): number {
  return Math.min(Math.max(value, MIN_HALF_LIFE), MAX_HALF_LIFE);
}

function humanAge(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)} s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(0)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}
