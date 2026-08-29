import type { Lecture } from "./packs";
import { scoreEnergy } from "./lectures";
import { normalise } from "./countries";

/**
 * What Mahdar noticed.
 *
 * The rule this file exists to enforce: an insight is a claim about the
 * student's own lectures, so it must be derived from them and it must be able
 * to say where it came from. Nothing here is generated text — each insight is
 * a shape with a lecture id and, where one exists, a second on the timeline.
 * The interface renders it and the tap opens the source.
 *
 * If a claim cannot name its source, it does not get made.
 */

export type Insight =
  /** One term the lecturer kept returning to across several lectures. */
  | {
      kind: "repeatedTerm";
      key: string;
      term: string;
      /** How many separate lectures it appeared in. */
      lectures: number;
      lectureId: string;
      atSeconds?: number;
    }
  /** A passage the lecturer audibly leaned on. */
  | {
      kind: "emphasised";
      key: string;
      quote: string;
      lectureId: string;
      lectureTitle: string;
      atSeconds: number;
    }
  /** The lecturer said out loud that something is on the exam. */
  | {
      kind: "examSignal";
      key: string;
      topic: string;
      lectureId: string;
      lectureTitle: string;
      atSeconds?: number;
    }
  /** Work picked up out of the last seven days of lectures. */
  | {
      kind: "newTasks";
      key: string;
      count: number;
      lectureId: string;
    };

const WEEK = 7 * 86_400_000;

/** Enough to be a pattern rather than a coincidence. */
const REPEAT_THRESHOLD = 2;

/**
 * Derive what is worth saying, best first.
 *
 * Capped low on purpose. A home screen that lists fourteen observations is a
 * log file; three is something a student actually reads before their next
 * lecture starts.
 */
export function insightsFrom(lectures: Lecture[], now = Date.now(), limit = 3): Insight[] {
  const ready = lectures.filter((l) => l.status === "ready" && l.analysis);
  if (ready.length === 0) return [];

  const out: Insight[] = [];

  /* A term the lecturer keeps coming back to is the strongest signal in the
   * whole set — it is the one thing a student could not have noticed for
   * themselves, because it happened across weeks. */
  type Repeat = {
    term: string;
    lectures: Set<string>;
    id: string;
    /** When that lecture was, so the freshest mention wins the jump. */
    lectureAt: number;
    at?: number;
  };
  const seen = new Map<string, Repeat>();
  for (const lecture of ready) {
    for (const term of lecture.analysis?.terms ?? []) {
      const key = normalise(term.term);
      if (!key) continue;
      const entry: Repeat = seen.get(key) ?? {
        term: term.term,
        lectures: new Set<string>(),
        id: lecture.id,
        lectureAt: -Infinity,
      };
      entry.lectures.add(lecture.id);
      if (lecture.at >= entry.lectureAt) {
        entry.id = lecture.id;
        entry.lectureAt = lecture.at;
        entry.at = term.atSeconds;
      }
      seen.set(key, entry);
    }
  }
  const repeated = [...seen.values()]
    .filter((e) => e.lectures.size >= REPEAT_THRESHOLD)
    .sort((a, b) => b.lectures.size - a.lectures.size)[0];
  if (repeated) {
    out.push({
      kind: "repeatedTerm",
      key: `repeat:${repeated.term}`,
      term: repeated.term,
      lectures: repeated.lectures.size,
      lectureId: repeated.id,
      atSeconds: repeated.at,
    });
  }

  /* Something the lecturer said would be on the exam, in their own words.
   * Only "stated" — an inference does not get to sound like a quote. */
  for (const lecture of ready) {
    const stated = (lecture.analysis?.examPredictions ?? []).find(
      (p) => p.basis === "stated" && p.quote,
    );
    if (stated) {
      out.push({
        kind: "examSignal",
        key: `exam:${lecture.id}`,
        topic: stated.topic,
        lectureId: lecture.id,
        lectureTitle: lecture.title,
        atSeconds: stated.atSeconds,
      });
      break;
    }
  }

  /* The loudest moment of the newest lecture. This is the differentiator in
   * one line: a sentence, the second it was said, and a way to hear it. */
  const newest = ready[0];
  if (newest) {
    const loudest = scoreEnergy(newest.segments)
      .filter((seg) => seg.emphasis >= 0.6 && seg.text.trim().length > 24)
      .sort((a, b) => b.emphasis - a.emphasis)[0];
    if (loudest) {
      out.push({
        kind: "emphasised",
        key: `emph:${newest.id}:${loudest.at}`,
        quote: loudest.text.trim(),
        lectureId: newest.id,
        lectureTitle: newest.title,
        atSeconds: loudest.at,
      });
    }
  }

  /* How much work this week actually produced. */
  const recent = ready.filter((l) => now - l.at <= WEEK);
  const tasksThisWeek = recent.reduce((n, l) => n + (l.analysis?.tasks.length ?? 0), 0);
  if (tasksThisWeek > 0 && recent[0]) {
    out.push({
      kind: "newTasks",
      key: "tasks:week",
      count: tasksThisWeek,
      lectureId: recent[0].id,
    });
  }

  return out.slice(0, limit);
}
