// The person tracker, and what a camera can actually see.
//
// `detectObjects` gates on the camera's declared range and field of view and
// lets its position error grow with distance. `trackHumans` — the channel the
// safety governor computes its separation from — did none of those things: it
// mapped over every person in the world and sorted them by distance. Same file,
// same camera, same two constants.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createSimRig } from "../index.ts";
import { SimWorld } from "../sim/world.ts";
import { SimRobotAdapter } from "../sim/adapter.ts";
import { SafetyGovernor } from "../safety/governor.ts";
import { SIMULATED_ROVER } from "../hal/profile.ts";

/** A robot at the origin facing +x, with one person placed where you like. */
function looking(at: { x: number; y: number }, seed = 3) {
  const world = new SimWorld({
    width: 40,
    height: 20,
    seed,
    noise: 1,
    humans: [{ id: "them", at, waypoints: [], speed: 0, attentive: false }],
  });
  const governor = new SafetyGovernor({ watchConflicts: false, watchGrip: false });
  const robot = new SimRobotAdapter(world, "luka", governor, {});
  world.addRobot("luka", { x: 5, y: 10 }, 0);
  return { world, robot, governor };
}

test("a person beyond the camera's range is not a person the robot can see", () => {
  // The declared figure is six metres, and it was already being honoured for
  // objects twenty lines above in the same file.
  assert.equal(looking({ x: 9, y: 10 }).robot.trackHumans().length, 1, "4 m away and not seen");
  assert.equal(looking({ x: 14, y: 10 }).robot.trackHumans().length, 0, "9 m away and reported anyway");
});

test("a person behind the robot is not a person the robot can see", () => {
  // 162° of field of view leaves a wedge behind the machine, which is where a
  // person standing at x - 0.6 with theta = 0 is.
  assert.equal(looking({ x: 6.5, y: 10 }).robot.trackHumans().length, 1, "dead ahead and not seen");
  assert.equal(looking({ x: 4.4, y: 10 }).robot.trackHumans().length, 0, "directly behind and reported anyway");
});

test("the position error grows with distance, because a camera's does", () => {
  // A bearing error of a fixed number of pixels is a larger displacement
  // further out. A flat figure said a person at the far edge of the camera's
  // range was located as precisely as one at arm's length.
  const spread = (distance: number) => {
    const errors: number[] = [];
    for (let seed = 1; seed <= 60; seed += 1) {
      const rig = looking({ x: 5 + distance, y: 10 }, seed);
      const [track] = rig.robot.trackHumans();
      if (!track) continue;
      errors.push(Math.hypot(track.at.x - (5 + distance), track.at.y - 10));
    }
    return errors.reduce((a, b) => a + b, 0) / errors.length;
  };
  const near = spread(1);
  const far = spread(5.5);
  assert.ok(far > near * 1.6, `error at 5.5 m (${far.toFixed(3)}) barely exceeds 1 m (${near.toFixed(3)})`);
});

test("what comes out is a tracker with the error published trackers have", () => {
  // The anchor for this noise model is not whether a capability survives it —
  // that is how a sensor gets tuned toward an answer. It is the 0.2–0.4 m/s of
  // velocity error the literature reports, which this repository already
  // calibrated the corridor result against.
  const errors: number[] = [];
  for (let seed = 1; seed <= 5; seed += 1) {
    const rig = createSimRig({ scenario: "distracted-corridor", seed });
    const previous = new Map<string, { x: number; y: number; t: number }>();
    for (let tick = 0; tick < 300; tick += 1) {
      rig.robot.drive(0.6, 0);
      rig.world.step(0.05);
      const now = rig.world.timeMs;
      for (const track of rig.robot.trackHumans()) {
        const human = rig.world.humans.find((h) => h.id === track.id);
        if (!human) continue;
        const before = previous.get(track.id);
        previous.set(track.id, { x: human.at.x, y: human.at.y, t: now });
        if (!before || now - before.t <= 0 || now - before.t > 200) continue;
        const dt = (now - before.t) / 1000;
        const truth = { x: (human.at.x - before.x) / dt, y: (human.at.y - before.y) / dt };
        const error = Math.hypot(track.velocity.x - truth.x, track.velocity.y - truth.y);
        if (Number.isFinite(error)) errors.push(error);
      }
    }
  }
  assert.ok(errors.length > 500, `only ${errors.length} samples`);
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
  assert.ok(
    mean > 0.15 && mean < 0.45,
    `velocity error is ${mean.toFixed(3)} m/s, outside anything a published person tracker reports`,
  );
});

test("stepping aside does not cancel itself by turning away from the reason", async () => {
  // The escape destroys the evidence for itself: stepping aside means turning,
  // and turning swings a 162° camera off the person who caused it, so the
  // manoeuvre is abandoned halfway and started again from the other side.
  // Measured before the escape was allowed to outlive the sight of them: 471
  // fresh escapes across twenty crossings, twenty-three per crossing.
  const crossings = async (coastMs: number) => {
    let starts = 0;
    let coasted = 0;
    let contacts = 0;
    for (let seed = 1; seed <= 10; seed += 1) {
      const rig = createSimRig({ scenario: "distracted-corridor", seed });
      const self = rig.world.robot(rig.robot.id);
      const goal = { x: self.pose.x + 8, y: self.pose.y };
      const yielding = rig.runtime.startDaemon<{ coastMs: number }, {
        yields: number;
        coasting: number;
      }>("hri.yield-path", { coastMs });
      void rig.runtime.run("reflex.shield", {});
      await rig.runtime.run("navigate.to", { x: goal.x, y: goal.y, tolerance: 0.4 });
      await rig.runtime.stopDaemons("done");
      const report = (await yielding.promise).data;
      starts += report?.yields ?? 0;
      coasted += report?.coasting ?? 0;
      contacts += self.humanContacts;
    }
    return { starts: starts / 10, coasted, contacts: contacts / 10 };
  };

  // Paired against the same capability with the coast switched off, rather than
  // against a number somebody chose. The comparison is the claim.
  const abandoning = await crossings(0);
  const carrying = await crossings(1500);

  assert.ok(
    abandoning.starts > carrying.starts * 1.5,
    `abandoning the escape on losing sight gave ${abandoning.starts.toFixed(1)} fresh escapes per ` +
      `crossing against ${carrying.starts.toFixed(1)} for carrying it through — not the difference ` +
      "this is supposed to be about",
  );
  assert.ok(carrying.coasted > 0, "no escape ever had to carry on without seeing the person");
  assert.ok(
    carrying.contacts < abandoning.contacts,
    `carrying the escape through touched people ${carrying.contacts.toFixed(2)} times per crossing ` +
      `against ${abandoning.contacts.toFixed(2)} for abandoning it`,
  );
});

test("a profile that declares a shorter camera gets a shorter camera", () => {
  // `RobotProfile` now carries the tracker's reach, because declaring "camera"
  // says the machine has one and not how far it sees — and the difference is
  // the whole corridor result. A field the rig does not read would be
  // decorative, which is the shape of half the findings in this package.
  const short = createSimRig({
    scenario: "busy-corridor",
    seed: 2,
    profile: { ...SIMULATED_ROVER, visionRange: 2, visionFov: Math.PI * 0.9 },
  });
  const long = createSimRig({ scenario: "busy-corridor", seed: 2, profile: SIMULATED_ROVER });
  let shortSaw = 0;
  let longSaw = 0;
  for (let tick = 0; tick < 200; tick += 1) {
    short.robot.drive(0.6, 0);
    long.robot.drive(0.6, 0);
    short.world.step(0.05);
    long.world.step(0.05);
    shortSaw += short.robot.trackHumans().length;
    longSaw += long.robot.trackHumans().length;
  }
  assert.ok(longSaw > 0, "the six-metre camera saw nobody, so this proves nothing");
  assert.ok(
    shortSaw < longSaw * 0.6,
    `a two-metre camera reported ${shortSaw} tracks against ${longSaw} for a six-metre one`,
  );
});
