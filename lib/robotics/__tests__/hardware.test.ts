import { test } from "node:test";
import assert from "node:assert/strict";

import { createSimRig, SIMULATED_ROVER, GENERIC_ROVER_TEMPLATE } from "../index.ts";
import { validateProfile, limitsFrom, abilityFitness, type RobotProfile } from "../hal/profile.ts";
import type { CheckoutInput, CheckoutReport } from "../abilities/checkout.ts";

test("the shipped profiles are internally consistent", () => {
  assert.deepEqual(validateProfile(SIMULATED_ROVER), []);
  assert.deepEqual(validateProfile(GENERIC_ROVER_TEMPLATE), []);
});

test("profile validation catches configurations that describe a fiction", () => {
  const gripperWithoutArm: RobotProfile = {
    ...GENERIC_ROVER_TEMPLATE,
    capabilities: ["drive", "gripper"],
  };
  assert.match(validateProfile(gripperWithoutArm).join(" "), /gripper with no arm/);

  const optimisticBrakes: RobotProfile = {
    ...GENERIC_ROVER_TEMPLATE,
    maxAccel: 0.3,
    maxDecel: 4,
  };
  assert.match(validateProfile(optimisticBrakes).join(" "), /maxDecel/);

  const tooFast: RobotProfile = { ...GENERIC_ROVER_TEMPLATE, maxLinear: 3, maxDecel: 0.4 };
  assert.match(validateProfile(tooFast).join(" "), /to stop/);
});

test("separation limits cover both bodies, not just the robot", () => {
  const limits = limitsFrom(SIMULATED_ROVER);
  assert.ok(
    (limits.minSeparation ?? 0) >= SIMULATED_ROVER.footprintRadius + 0.25,
    `minSeparation ${limits.minSeparation} does not leave room for a person`,
  );
  assert.equal(limits.maxLinear, SIMULATED_ROVER.maxLinear);
  assert.equal(limits.reactionTime, SIMULATED_ROVER.reactionTimeMs / 1000);
});

test("an ability is refused by name when the platform lacks the hardware", () => {
  const fitness = abilityFitness(GENERIC_ROVER_TEMPLATE, ["arm", "gripper"]);
  assert.equal(fitness.runnable, false);
  assert.deepEqual(fitness.missing, ["arm", "gripper"]);
  assert.match(fitness.reason ?? "", /has no arm, gripper/);

  assert.equal(abilityFitness(SIMULATED_ROVER, ["arm", "gripper"]).runnable, true);
});

test("a profile makes the governor's limits about this robot", () => {
  const slow: RobotProfile = { ...SIMULATED_ROVER, id: "slow", maxLinear: 0.3 };
  const rig = createSimRig({ scenario: "empty-hall", profile: slow });
  assert.equal(rig.governor.limits.maxLinear, 0.3);
  assert.ok(rig.governor.allowedSpeed(Number.POSITIVE_INFINITY) <= 0.3);
});

test("checkout clears a healthy robot", async () => {
  const rig = createSimRig({ scenario: "empty-hall", profile: SIMULATED_ROVER });
  const result = await rig.runtime.run<CheckoutInput, CheckoutReport>(
    "hardware.checkout",
    {},
  );

  assert.equal(result.ok, true, result.summary);
  assert.equal(result.data?.failures, 0);
  const names = result.data?.checks.map((c) => c.name) ?? [];
  for (const required of ["profile", "lidar", "imu", "battery", "emergency-stop", "brakes"]) {
    assert.ok(names.includes(required), `no ${required} check ran`);
  }
});

test("checkout refuses a profile that claims hardware the robot does not have", async () => {
  const rig = createSimRig({
    scenario: "empty-hall",
    profile: SIMULATED_ROVER,
    capabilities: ["drive", "lidar"],
  });
  const result = await rig.runtime.run<CheckoutInput, CheckoutReport>(
    "hardware.checkout",
    { staticOnly: true },
  );

  assert.equal(result.ok, false);
  assert.equal(result.failure, "precondition");
  const capabilities = result.data?.checks.find((c) => c.name === "capabilities");
  assert.equal(capabilities?.status, "fail");
  assert.match(capabilities?.detail ?? "", /does not expose/);
});

test("checkout notices a sensor that never changes", async () => {
  // A noiseless world produces bit-identical scans from a stationary robot,
  // which is exactly what a frozen driver looks like. The check is expected to
  // say so rather than wave it through.
  const rig = createSimRig({ scenario: "empty-hall", profile: SIMULATED_ROVER });
  rig.world.robot("luka-1").commandedLinear = 0;
  const noiseless = createSimRig({
    scenario: "empty-hall",
    profile: SIMULATED_ROVER,
    limits: {},
  });
  // The simulator's noise is part of the world, so build one without it.
  const world = noiseless.world as unknown as { noise: number };
  world.noise = 0;

  const result = await noiseless.runtime.run<{ staticOnly: boolean }, CheckoutReport>(
    "hardware.checkout",
    { staticOnly: true },
  );

  const lidar = result.data?.checks.find((c) => c.name === "lidar");
  assert.ok(lidar, "no lidar check ran");
  assert.notEqual(lidar.status, "pass", "identical scans must not be reported as healthy");
  assert.match(lidar.detail, /identical/);
});

test("checkout will not test the brakes while an emergency stop is latched", async () => {
  const rig = createSimRig({ scenario: "empty-hall", profile: SIMULATED_ROVER });
  rig.governor.emergencyStop("test");

  const result = await rig.runtime.run<CheckoutInput, CheckoutReport>(
    "hardware.checkout",
    {},
  );

  // The ability itself is motion-class, so a latched stop refuses it outright —
  // which is the correct answer and the one a real operator needs to see.
  assert.equal(result.ok, false);
  assert.match(result.summary, /emergency stop|not cleared/i);
});
