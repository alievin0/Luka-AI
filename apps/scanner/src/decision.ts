import type { Roadside, ScanReading, Severity, VerdictLevel } from "./packs/types";

/**
 * What the screen decides, once the driver has answered.
 *
 * This exists as a function rather than three lines inside `result.tsx`
 * because of what those three lines are. They are the decision hierarchy —
 * a reported symptom outranks the photograph — and the first version of it
 * lived in the JSX, where the only thing that could check it was a structural
 * assertion that nothing read the raw fields. That proves the wiring and says
 * nothing about the outcome. Here it can be given inputs and asked what it
 * concluded, with no API key and nothing to be flaky about.
 *
 * The hierarchy, highest first:
 *
 *   1. a symptom the driver reported   — smoke, a smell, a noise, a change
 *   2. whether the photo was readable  — handled upstream, not here
 *   3. the lamp, its severity and the driving decision from the model
 *
 * Step 1 is above the model because the model cannot reach it. The question is
 * asked in the app, after the scan has returned, so nothing in the prompt or
 * the schema can account for the answer and no amount of server-side clamping
 * will either.
 */
export type Decision = {
  /** True when the driver's answer, not the photograph, produced this. */
  overridden: boolean;
  level: VerdictLevel;
  severity: Severity;
  roadside: Roadside;
};

/**
 * @param symptoms What the driver answered: true for "yes, I noticed
 *   something", false for no, null while the question is unanswered.
 *
 * Only ever raises. A "no" is the driver confirming the absence of what they
 * can see, hear and smell — it is not an inspection, and a red light stays red
 * through it. There is deliberately no path in this function that lowers
 * anything, because a screen that can be talked down from "stop driving" by a
 * tap is worse than one that cannot be talked up.
 */
export function decide(reading: ScanReading, symptoms: boolean | null): Decision {
  if (symptoms === true) {
    return {
      overridden: true,
      level: "stop",
      severity: "critical",
      // Not "move-to-safety": smoke or a burning smell is the case where
      // driving on to somewhere more convenient is the thing that hurts.
      roadside: "do-not-move",
    };
  }
  return {
    overridden: false,
    level: reading.verdictLevel,
    severity: reading.severity,
    // Absent on results saved before `roadside` existed. Falling back to the
    // most cautious class would put "do not move the car" over an old green
    // result; "monitor" is what the app already showed for those, which is to
    // say nothing extra.
    roadside: reading.roadside ?? "monitor",
  };
}
