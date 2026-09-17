// What this particular robot is.
//
// The kernel is written against one interface, which is what lets an ability
// move from the simulator to a machine. But abilities still need to know the
// facts of the body they are in: how wide it is, how hard it can brake, how
// long its senses take to arrive, and — most importantly — what it cannot do.
//
// A profile states all of that in one place, including the absences. A robot
// with no arm should refuse a grasp with "this platform has no arm", not
// discover it halfway through reaching.

import type { HardwareCapability } from "../core/types.ts";
import type { SafetyLimits } from "../safety/governor.ts";
import type { Ros2Topics } from "./ros2-bridge.ts";

export type Bilingual = { en: string; ar: string };

export type RobotProfile = {
  id: string;
  name: Bilingual;
  /** How it moves. Abilities that assume differential steering check this. */
  base: "differential" | "omni" | "ackermann" | "legged";
  /**
   * Radius of the circle that contains the body, metres. Every clearance
   * calculation in the kernel uses it, so measure it rather than guessing —
   * including anything bolted on, which is usually what hits the door frame.
   */
  footprintRadius: number;
  /** Centre-of-mass height, metres. Balance and stoppability need it. */
  comHeight: number;
  /** Half the support base along the direction of travel, metres. */
  footHalf: number;
  /** Actuator limits, as the platform is configured — not the datasheet maximum. */
  maxLinear: number;
  maxAngular: number;
  maxAccel: number;
  maxDecel: number;
  /** Everything the platform genuinely has. Anything absent is simply absent. */
  capabilities: HardwareCapability[];
  /**
   * Sense-to-act latency budget in ms. The governor measures the real figure
   * and widens its separation distances when the measurement exceeds this, so
   * an optimistic number here costs safety margin rather than buying speed.
   */
  reactionTimeMs: number;
  /** Topic names, where they differ from the ROS defaults. */
  topics?: Partial<Ros2Topics>;
  frames?: { base: string; odom: string; lidar: string };
  /** Gripper force ceiling in newtons, when there is a gripper. */
  maxContactForce?: number;
  /**
   * What this platform cannot do, in plain words. Stated so an ability can
   * refuse with a reason instead of failing in an interesting way.
   */
  absent?: string[];
  /** Anything a person setting this up needs to know. */
  notes?: string[];
  /**
   * Whether the numbers above were checked against the real machine. A profile
   * nobody has verified is a hypothesis, and abilities should say so.
   */
  verified: "simulator" | "measured" | "from-documentation" | "unverified";
};

/** Turn a profile into the safety limits the governor should run with. */
export function limitsFrom(profile: RobotProfile): Partial<SafetyLimits> {
  return {
    maxLinear: profile.maxLinear,
    maxAngular: profile.maxAngular,
    maxDecel: profile.maxDecel,
    reactionTime: profile.reactionTimeMs / 1000,
    // Both bodies have to fit: the robot's own radius plus a person's.
    minSeparation: profile.footprintRadius + 0.25 + 0.02,
    obstacleClearance: Math.max(profile.footprintRadius * 0.6, 0.15),
    maxContactForce: profile.maxContactForce ?? 20,
  };
}

/** The abilities this platform can run, and why the others are excluded. */
export function abilityFitness(
  profile: RobotProfile,
  required: HardwareCapability[],
): { runnable: boolean; missing: HardwareCapability[]; reason?: string } {
  const owned = new Set(profile.capabilities);
  const missing = required.filter((capability) => !owned.has(capability));
  if (missing.length === 0) return { runnable: true, missing: [] };
  return {
    runnable: false,
    missing,
    reason: `${profile.name.en} has no ${missing.join(", ")}.`,
  };
}

/**
 * The simulated robot. This one is `verified: "simulator"` because the numbers
 * are not claims about any real machine — they are the simulator's own
 * constants, and they are true there by construction.
 */
export const SIMULATED_ROVER: RobotProfile = {
  id: "luka-sim",
  name: { en: "Simulated rover", ar: "المركبة المحاكاة" },
  base: "differential",
  footprintRadius: 0.28,
  comHeight: 0.55,
  footHalf: 0.11,
  maxLinear: 1.2,
  maxAngular: 1.8,
  maxAccel: 1.4,
  maxDecel: 1.2,
  capabilities: [
    "drive",
    "arm",
    "gripper",
    "lidar",
    "imu",
    "camera",
    "tactile",
    "battery",
    "lights",
    "speaker",
    "radio",
  ],
  reactionTimeMs: 120,
  maxContactForce: 28,
  notes: [
    "Two dimensions, a planar arm and no arm dynamics. Determinism here is a reproducibility property, not a fidelity claim.",
  ],
  verified: "simulator",
};

/**
 * A template for a real machine.
 *
 * Deliberately not named after any product. Every number below has to be
 * replaced with one measured on the robot in front of you — a profile copied
 * from a datasheet and never checked is the most likely way the safety model
 * ends up describing a robot that does not exist.
 */
export const GENERIC_ROVER_TEMPLATE: RobotProfile = {
  id: "my-rover",
  name: { en: "Unverified rover", ar: "مركبة غير موثّقة" },
  base: "differential",
  footprintRadius: 0.25,
  comHeight: 0.3,
  footHalf: 0.15,
  maxLinear: 0.4,
  maxAngular: 1,
  maxAccel: 0.5,
  maxDecel: 0.5,
  capabilities: ["drive", "lidar", "imu", "battery"],
  reactionTimeMs: 250,
  topics: {
    cmdVel: "/cmd_vel",
    odom: "/odom",
    scan: "/scan",
    imu: "/imu",
    battery: "/battery_state",
  },
  frames: { base: "base_link", odom: "odom", lidar: "laser" },
  absent: [
    "No arm or gripper: every manipulation ability will refuse.",
    "No person tracking: the separation model has nothing to separate from until you add it.",
  ],
  notes: [
    "Measure the footprint including anything bolted on — that is what hits the door frame.",
    "Start with maxLinear well below what the platform can do. You can raise it after the first hour.",
    "Over WiFi, 250 ms is an optimistic reaction time. The governor measures the real one and widens its margins to match.",
  ],
  verified: "unverified",
};

export const PROFILES: Record<string, RobotProfile> = {
  [SIMULATED_ROVER.id]: SIMULATED_ROVER,
  [GENERIC_ROVER_TEMPLATE.id]: GENERIC_ROVER_TEMPLATE,
};

/** Catch a profile that would make the safety model describe a fiction. */
export function validateProfile(profile: RobotProfile): string[] {
  const problems: string[] = [];

  if (profile.footprintRadius <= 0) problems.push("footprintRadius must be positive.");
  if (profile.maxLinear <= 0) problems.push("maxLinear must be positive.");
  if (profile.maxDecel <= 0) problems.push("maxDecel must be positive.");

  if (profile.maxDecel > profile.maxAccel * 3) {
    problems.push(
      `maxDecel (${profile.maxDecel}) is far above maxAccel (${profile.maxAccel}). ` +
        "Braking harder than the drive can accelerate needs evidence — the separation " +
        "model trusts this number to stop the robot.",
    );
  }

  if (profile.capabilities.includes("gripper") && !profile.capabilities.includes("arm")) {
    problems.push("A gripper with no arm cannot be positioned.");
  }
  if (profile.capabilities.includes("tactile") && !profile.capabilities.includes("gripper")) {
    problems.push("Tactile sensing is declared with no gripper to sense with.");
  }

  // A balancing platform whose support is wider than its body is not balancing.
  if (profile.footHalf > profile.comHeight) {
    problems.push(
      "footHalf exceeds comHeight, which describes something that cannot tip. If that is " +
        "true, say so in notes — the balance abilities will have nothing to do.",
    );
  }

  const stoppingDistance =
    (profile.maxLinear * profile.maxLinear) / (2 * profile.maxDecel) +
    profile.maxLinear * (profile.reactionTimeMs / 1000);
  if (stoppingDistance > 3) {
    problems.push(
      `At ${profile.maxLinear} m/s this robot needs ${stoppingDistance.toFixed(1)} m to stop. ` +
        "That is a long way to be wrong about. Lower maxLinear until you have measured it.",
    );
  }

  return problems;
}
