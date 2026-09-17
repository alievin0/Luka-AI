// Every capability has to say what it needs and how far it has been shown to
// work.
//
// This is the part of the architecture that rots quietly. A capability added
// next month with no declaration still runs, still passes its own tests, and
// is indistinguishable in a list from one that has been measured — which is
// exactly the confusion the status enum exists to prevent. So the requirement
// is enforced here rather than written in a document.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createRegistry } from "../abilities/index.ts";
import type { EvidenceSource } from "../core/evidence.ts";

const registry = createRegistry();
const abilities = registry.manifests();

/**
 * The one capability that must not declare evidence requirements.
 *
 * The gate refuses a capability whose sensors are absent, invalid or stale.
 * `hardware.checkout` is the capability whose job is to find out whether the
 * sensors are absent, invalid or stale. Gating it on the lidar working means a
 * robot with a dead lidar cannot run the check that would say so.
 */
const DIAGNOSES_ITS_OWN_SENSES = "hardware.checkout";

test("every capability says how far it has actually been demonstrated", () => {
  const undeclared = abilities.filter((m) => !m.proof).map((m) => m.id);
  assert.deepEqual(
    undeclared,
    [],
    `these capabilities do not say what they rest on: ${undeclared.join(", ")}`,
  );
});

test("no capability claims hardware evidence, because none has run on hardware", () => {
  // The claim this file cares about most. The moment something here says
  // HARDWARE_TESTED or VALIDATED, the thing to check is what was measured and
  // on which machine — and this test failing is how anyone finds out that a
  // status was raised.
  const claimed = abilities
    .filter((m) => m.proof?.status === "HARDWARE_TESTED" || m.proof?.status === "VALIDATED")
    .map((m) => `${m.id} (${m.proof?.status})`);
  assert.deepEqual(
    claimed,
    [],
    "a capability claims physical evidence: " +
      claimed.join(", ") +
      ". If a robot really did run it, say where and delete this expectation — " +
      "if not, the status is wrong.",
  );
});

test("a capability that has never failed is a capability nobody has run", () => {
  // An empty failure-mode list is a claim, and it is almost always the claim
  // that nobody looked.
  for (const manifest of abilities) {
    assert.ok(
      (manifest.proof?.failureModes.length ?? 0) > 0,
      `${manifest.id} lists no way it can fail`,
    );
    assert.ok(
      (manifest.proof?.verification.length ?? 0) > 20,
      `${manifest.id} does not say how anyone would check it on a real robot`,
    );
    assert.ok(
      (manifest.proof?.safetyBoundary.length ?? 0) > 20,
      `${manifest.id} does not say what line it will not cross`,
    );
  }
});

test("a capability that reads sensors says which readings it is trusting", () => {
  for (const manifest of abilities) {
    if (manifest.id === DIAGNOSES_ITS_OWN_SENSES) {
      assert.equal(
        manifest.evidence,
        undefined,
        "hardware.checkout must not be gated on the sensors it exists to test",
      );
      continue;
    }
    assert.ok(
      (manifest.evidence?.length ?? 0) > 0,
      `${manifest.id} runs on readings it never says it needs`,
    );
  }
});

test("every requirement explains itself in words a person could act on", () => {
  for (const manifest of abilities) {
    for (const requirement of manifest.evidence ?? []) {
      assert.ok(
        requirement.because.length > 15,
        `${manifest.id} requires ${requirement.source} without saying why`,
      );
    }
  }
});

test("freshness is only required of channels that carry a timestamp", () => {
  // A real limit of the evidence layer, enforced so it cannot be tripped over.
  // Only the lidar, the IMU and the transport carry a clock; everything else
  // reports `ageMs: null`, and the gate correctly refuses a maximum age it
  // cannot measure. Asking for freshness anywhere else refuses the capability
  // permanently, on every robot, which is a hard failure that looks like a
  // careful declaration.
  const STAMPED: EvidenceSource[] = ["lidar", "imu", "transport"];
  for (const manifest of abilities) {
    for (const requirement of manifest.evidence ?? []) {
      if (requirement.maxAgeMs === undefined) continue;
      assert.ok(
        STAMPED.includes(requirement.source),
        `${manifest.id} asks for ${requirement.source} no older than ${requirement.maxAgeMs} ms, ` +
          "but that channel carries no timestamp, so the requirement can never be satisfied",
      );
    }
  }
});

test("the catalogue reports its own state honestly", () => {
  const byStatus = new Map<string, number>();
  for (const manifest of abilities) {
    const status = manifest.proof?.status ?? "undeclared";
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
  }
  // Not an assertion about the numbers — an assertion that the numbers exist
  // and that nothing has slipped through without one.
  assert.equal(
    byStatus.get("undeclared") ?? 0,
    0,
    "a capability in the registry has no status at all",
  );
  assert.equal(
    [...byStatus.values()].reduce((a, b) => a + b, 0),
    abilities.length,
  );
});
