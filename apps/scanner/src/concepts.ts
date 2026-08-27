import type { Lecture, Segment } from "./packs";
import { normalise } from "./countries";

/**
 * Concepts, and what connects them.
 *
 * A list of terms with definitions is a glossary, and a glossary is something
 * a student can already get from the textbook. What they cannot get anywhere
 * else is where the term came up *in their lecture* and what their lecturer
 * put next to it.
 *
 * So both relationships here are derived from the lecture rather than
 * invented: two concepts are related if one is named inside the other's
 * definition, or if the lecturer said both within a couple of minutes. The
 * second is the honest version of a concept map — proximity in the lecture is
 * evidence, and it is evidence the student can go and listen to.
 */

/** How close two mentions have to be to count as the lecturer linking them. */
const NEAR_SECONDS = 120;

export type Mention = { at: number; text: string };

export type ConceptDetail = {
  term: string;
  definition: string;
  /** Every second the term was actually said, in order. */
  mentions: Mention[];
  /** Terms this one is connected to, strongest first. */
  related: string[];
  /** The quotation the analysis grounded it in, when there is one. */
  quote?: string;
  atSeconds?: number;
};

const mentionsOf = (term: string, segments: Segment[]): Mention[] => {
  const needle = normalise(term);
  if (needle.length < 2) return [];
  return segments
    .filter((segment) => normalise(segment.text).includes(needle))
    .map((segment) => ({ at: segment.at, text: segment.text.trim() }));
};

/**
 * Build the full picture for every concept in a lecture.
 *
 * Done in one pass over the transcript per term rather than per render: an
 * hour of speech is a few thousand segments, and re-scanning it inside a list
 * row is the difference between a screen that opens and one that stutters.
 */
export function conceptsOf(lecture: Lecture): ConceptDetail[] {
  const terms = lecture.analysis?.terms ?? [];
  if (terms.length === 0) return [];

  const withMentions = terms.map((entry) => ({
    term: entry.term,
    definition: entry.definition,
    quote: entry.quote,
    atSeconds: entry.atSeconds,
    mentions: mentionsOf(entry.term, lecture.segments),
  }));

  return withMentions.map((entry) => {
    const scores = new Map<string, number>();

    for (const other of withMentions) {
      if (other.term === entry.term) continue;

      // Named inside each other's definition: the lecturer defined one in
      // terms of the other, which is as explicit as a link gets.
      const named =
        normalise(entry.definition).includes(normalise(other.term)) ||
        normalise(other.definition).includes(normalise(entry.term));
      if (named) scores.set(other.term, (scores.get(other.term) ?? 0) + 3);

      // Said close together. Counted once per near pair so a term repeated
      // twenty times in one digression cannot dominate the map.
      const near = entry.mentions.some((mine) =>
        other.mentions.some((theirs) => Math.abs(mine.at - theirs.at) <= NEAR_SECONDS),
      );
      if (near) scores.set(other.term, (scores.get(other.term) ?? 0) + 1);
    }

    return {
      ...entry,
      related: [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([term]) => term),
    };
  });
}
