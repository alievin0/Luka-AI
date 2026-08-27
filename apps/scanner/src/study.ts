import type { Lecture } from "./packs";
import { normalise } from "./countries";

/**
 * Choosing what the model is allowed to see.
 *
 * A semester of transcripts is far more than any one question needs, and
 * sending all of it would be slow, expensive, and — worse — would bury the
 * two paragraphs that actually answer the question in an hour of unrelated
 * speech. So retrieval happens here, on the device, before anything leaves
 * it: the question picks its own evidence, and that evidence is the only
 * thing the answer can be built from.
 *
 * This is also what makes "no source, no claim" enforceable. The server can
 * check every quotation against exactly this text.
 */

/** Words too short or too common to discriminate between lectures. */
const MIN_TOKEN = 3;
/** How many transcript lines the answer is built from. */
const MAX_LINES = 70;
/** Lines either side of a hit, so a quotation is not cut off mid-thought. */
const CONTEXT = 1;

export type Excerpt = {
  lectureId: string;
  lectureTitle: string;
  at: number;
  text: string;
};

export type StudyContext = {
  excerpts: Excerpt[];
  /** Lecture titles and summaries, so the model can answer "which lecture…". */
  overview: { id: string; title: string; at: number; summary: string; terms: string[] }[];
};

const tokensOf = (text: string) =>
  normalise(text)
    .split(/\s+/)
    .filter((word) => word.length >= MIN_TOKEN);

/**
 * Gather the evidence for one question.
 *
 * Scored by how many of the question's words a line contains, with a lecture's
 * own concepts counting too — a student asking about "equivalence" should
 * reach the lecture that defined it even if the word itself is rare in the
 * transcript.
 */
export function contextFor(question: string, lectures: Lecture[]): StudyContext {
  const wanted = new Set(tokensOf(question));

  const overview = lectures
    .filter((lecture) => lecture.analysis)
    .map((lecture) => ({
      id: lecture.id,
      title: lecture.title,
      at: lecture.at,
      summary: lecture.analysis!.summary,
      terms: lecture.analysis!.terms.map((term) => term.term),
    }));

  if (wanted.size === 0) return { excerpts: [], overview };

  type Scored = { lecture: Lecture; index: number; score: number };
  const hits: Scored[] = [];

  for (const lecture of lectures) {
    // A concept named in the question makes every line of that lecture a
    // little more likely to be relevant.
    const conceptBonus = (lecture.analysis?.terms ?? []).some((term) =>
      tokensOf(term.term).some((word) => wanted.has(word)),
    )
      ? 1
      : 0;

    lecture.segments.forEach((segment, index) => {
      const words = new Set(tokensOf(segment.text));
      let score = 0;
      for (const word of wanted) if (words.has(word)) score += 2;
      if (score === 0) return;
      hits.push({ lecture, index, score: score + conceptBonus });
    });
  }

  hits.sort((a, b) => b.score - a.score);

  /* Widen each hit to its neighbours, then de-duplicate: two adjacent hits
   * would otherwise send the same line twice and waste the budget. */
  const chosen = new Map<string, Excerpt>();
  for (const hit of hits) {
    if (chosen.size >= MAX_LINES) break;
    for (let i = hit.index - CONTEXT; i <= hit.index + CONTEXT; i++) {
      const segment = hit.lecture.segments[i];
      if (!segment) continue;
      const key = `${hit.lecture.id}:${segment.at}`;
      if (chosen.has(key)) continue;
      chosen.set(key, {
        lectureId: hit.lecture.id,
        lectureTitle: hit.lecture.title,
        at: segment.at,
        text: segment.text,
      });
      if (chosen.size >= MAX_LINES) break;
    }
  }

  const excerpts = [...chosen.values()].sort((a, b) =>
    a.lectureId === b.lectureId ? a.at - b.at : a.lectureId.localeCompare(b.lectureId),
  );

  return { excerpts, overview };
}

/**
 * Questions worth offering, built from what the student actually recorded.
 *
 * Generic prompts ("summarise my notes") teach nobody anything about what the
 * tool can do. A concept their own lecturer spent time on does.
 */
export function suggestionsFor(lectures: Lecture[], limit = 4): string[] {
  const ready = lectures.filter((l) => l.status === "ready" && l.analysis);
  if (ready.length === 0) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const lecture of ready) {
    for (const term of lecture.analysis?.terms ?? []) {
      const key = normalise(term.term);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(term.term);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
