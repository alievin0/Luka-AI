// Whether a capability may run right now, and why not.
//
// The old answer to that question was a list of hardware names. `grasp.adaptive`
// declared it needed a gripper, the registry checked the robot had one, and
// that was the whole gate. It is a fair first question and it is not the one
// that matters most: a robot can have a lidar bolted to it, and a driver
// publishing NaN across every beam, and pass.
//
// So the gate asks about evidence rather than parts. Every requirement names a
// channel, how fresh the reading has to be, and how much of it has to be
// usable. Every answer names which requirement failed, what the evidence
// actually was, and how old.
//
// ── Nothing here returns a bare boolean ────────────────────────────────────
//
// A verdict carries every check that ran, passed and failed alike. `admitted`
// exists for the caller that only wants to branch, and it is derived from the
// checks rather than computed alongside them, so the two cannot disagree. A
// refusal that says `supported: false` is a refusal nobody can act on.
//
// ── Degraded is a verdict, not a failure ───────────────────────────────────
//
// A capability that needs a perfect scan and one that needs any scan are
// different capabilities, and a robot with half its beams answering should not
// be treated as a robot with none. A requirement that accepts degraded evidence
// admits the capability and marks the verdict degraded, which is a state the
// caller is expected to do something about — run slower, claim less, verify
// more — rather than ignore.

import type { Evidence, EvidenceSet, EvidenceSource } from "./evidence.ts";

export type EvidenceRequirement = {
  source: EvidenceSource;
  /**
   * Reject a reading older than this, in ms.
   *
   * Leave it unset for channels where age is not meaningful. Where it is set
   * and the channel carries no timestamp, the requirement fails: an age that
   * cannot be measured is not an age of zero, and treating it as one is how a
   * stale reading gets used as a current one.
   */
  maxAgeMs?: number;
  /** Fraction of the channel that has to be usable, 0..1. Defaults to any. */
  minCompleteness?: number;
  /**
   * Whether a degraded reading is good enough. False by default, because a
   * capability that has not thought about degraded operation should not get it
   * by accident.
   */
  acceptDegraded?: boolean;
  /** Why this capability needs this channel, for the refusal message. */
  because: string;
};

export type GateCheck = {
  requirement: string;
  passed: boolean;
  detail: string;
  evidence?: Evidence;
};

export type GateVerdict = {
  /** Derived from the checks, never computed separately. */
  admitted: boolean;
  /** Admitted, and running on evidence worse than the capability would like. */
  degraded: boolean;
  checks: GateCheck[];
  /** One line naming the first thing that stopped it, when something did. */
  refusal?: string;
};

/**
 * Evaluate a capability's requirements against what the robot can currently
 * justify believing.
 */
export function evaluateGate(
  requirements: readonly EvidenceRequirement[],
  evidence: EvidenceSet,
): GateVerdict {
  const checks: GateCheck[] = [];
  let degraded = false;

  for (const requirement of requirements) {
    const found = evidence.get(requirement.source);
    const label = `${requirement.source}: ${requirement.because}`;

    if (!found) {
      checks.push({
        requirement: label,
        passed: false,
        detail: `Nothing reports on ${requirement.source}, so the question cannot be answered.`,
      });
      continue;
    }

    if (found.quality === "absent" || found.quality === "invalid") {
      checks.push({
        requirement: label,
        passed: false,
        detail: `${found.quality}: ${found.reason}`,
        evidence: found,
      });
      continue;
    }

    if (found.quality === "degraded" && !requirement.acceptDegraded) {
      checks.push({
        requirement: label,
        passed: false,
        detail:
          `degraded and this capability does not accept degraded evidence: ${found.reason} ` +
          "Either it needs to say how it would run on this, or it should not run.",
        evidence: found,
      });
      continue;
    }

    const minimum = requirement.minCompleteness ?? 0;
    if (found.completeness < minimum) {
      checks.push({
        requirement: label,
        passed: false,
        detail:
          `${(found.completeness * 100).toFixed(0)}% usable, and this needs ` +
          `${(minimum * 100).toFixed(0)}%. ${found.reason}`,
        evidence: found,
      });
      continue;
    }

    if (requirement.maxAgeMs !== undefined) {
      if (found.ageMs === null) {
        checks.push({
          requirement: label,
          passed: false,
          detail:
            `This needs a reading no older than ${requirement.maxAgeMs} ms and the channel carries ` +
            "no timestamp, so its age cannot be established. An age that cannot be measured is not " +
            "an age of zero.",
          evidence: found,
        });
        continue;
      }
      if (found.ageMs > requirement.maxAgeMs) {
        checks.push({
          requirement: label,
          passed: false,
          detail: `${found.ageMs.toFixed(0)} ms old, and this needs it within ${requirement.maxAgeMs} ms.`,
          evidence: found,
        });
        continue;
      }
    }

    if (found.quality === "degraded") degraded = true;
    checks.push({
      requirement: label,
      passed: true,
      detail: found.reason + (found.quality === "degraded" ? " (accepted as degraded)" : ""),
      evidence: found,
    });
  }

  const failed = checks.filter((check) => !check.passed);
  return {
    admitted: failed.length === 0,
    degraded: degraded && failed.length === 0,
    checks,
    refusal:
      failed.length === 0
        ? undefined
        : `${failed[0].requirement} — ${failed[0].detail}` +
          (failed.length > 1 ? ` (and ${failed.length - 1} more)` : ""),
  };
}

/**
 * How far a capability has actually been demonstrated.
 *
 * The distinction this enforces is between what a simulator agreed with and
 * what a machine did. Nothing here raises itself; the value is written by
 * whoever has the evidence, and the evidence is named next to it.
 */
export type CapabilityStatus =
  /** Written down, not run. */
  | "IDEA"
  /** Works in the simulator. That is a claim about the simulator. */
  | "SIMULATED"
  /** Has run on a physical robot at least once. */
  | "HARDWARE_TESTED"
  /** Has run on a physical robot enough times, and been measured, to be relied on. */
  | "VALIDATED";

export type CapabilityEvidenceRecord = {
  status: CapabilityStatus;
  /** What was actually measured, and where. One line, no adjectives. */
  basis: string;
  /**
   * How anyone would check the claim on a real robot. Required even at IDEA,
   * because a capability whose verification nobody can describe is one nobody
   * can trust later.
   */
  verification: string;
  /** How this is known to fail. Empty is a claim in itself, and usually wrong. */
  failureModes: string[];
  /** What it does when the evidence is worse than it wants, if anything. */
  degradedModes: string[];
  /** The line it will not cross, whatever it is asked. */
  safetyBoundary: string;
};

/** True when the claim rests on a physical robot rather than a simulator. */
export function isPhysicallyEvidenced(record: CapabilityEvidenceRecord): boolean {
  return record.status === "HARDWARE_TESTED" || record.status === "VALIDATED";
}
