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

export type LinkProfile = {
  /**
   * `loopback` is the simulator, where the link cannot fail. `wired` is a
   * cable. `wireless` is anything that shares a medium with other traffic,
   * which includes every WiFi deployment.
   */
  kind: "loopback" | "wired" | "wireless";
  /** The control period the kernel intends to run at, ms. */
  controlPeriodMs: number;
  /**
   * The round-trip time the link is expected to hold at the 99th percentile,
   * ms. Not the average — the average is comfortable and the tail is what
   * drives into someone. When the measured p99 exceeds the control period,
   * closing a loop across this link is not something the link can do.
   */
  maxRoundTripP99Ms: number;
  /**
   * The robot's own command timeout, ms, or null when it has none. This is the
   * only watchdog that survives the sender dying, so a wireless robot without
   * one is a robot that keeps its last order forever.
   */
  robotSideWatchdogMs: number | null;
};

export type Kinematics = {
  /** Drive wheel radius, metres. */
  wheelRadius: number;
  /** Distance between the drive wheels, metres. */
  trackWidth: number;
  /**
   * Where these numbers came from.
   *
   * `platform-parameters` — read off the robot at run time, which is the best
   * case and is what several platforms offer if you ask.
   * `measured` — somebody put a tape on it.
   * `datasheet` — the nominal figure, which is right until a tyre wears or a
   * wheel is swapped for a similar one.
   * `assumed` — a guess. Abilities that need metric accuracy refuse on this.
   */
  source: "platform-parameters" | "measured" | "datasheet" | "assumed";
  /**
   * The slowest speed this platform will actually move at, m/s.
   *
   * Below it the drive does not turn: static friction in the gearbox has not
   * been cleared, and the command produces nothing. Every real geared drive has
   * this band and it is a few centimetres per second on a small indoor robot.
   *
   * It is in the profile because it decides whether a safety limit is a limit
   * or a stop. A governor that answers a blind sensor by crawling at 0.02 m/s
   * on a platform that cannot move below 0.03 has not slowed the robot down, it
   * has parked it — and it will go on reporting that it is crawling, which is a
   * command being mistaken for an action.
   *
   * Leave it undefined when nobody has measured it. That is different from
   * zero, and the audit says so.
   */
  minMovingSpeed?: number;
};

/**
 * One shape the machine can be in, and what it can do while it is in it.
 *
 * A wheel-leg robot is two robots that share a body, and the numbers that
 * matter are different for each: wheels are fast, cheap and statically stable;
 * legs are slow, expensive and often not. A profile with one set of limits for
 * a machine with two shapes is claiming they behave the same, which is the same
 * mistake as declaring "camera" and not saying how far it sees.
 */
export type MorphologyMode = {
  /** The machine's own name for it — "wheel", "leg", "hybrid", "crawl". */
  name: string;
  maxLinear: number;
  maxAngular: number;
  maxAccel: number;
  maxDecel: number;
  /** Whether the body holds itself up in this mode or has to balance. */
  stance: "static" | "dynamic";
  /** Floor clearance in this mode, metres. Legs usually raise the belly. */
  groundClearance?: number;
  /** Draw at the nominal speed, watts. Wheels are cheap and legs are not. */
  nominalWatts?: number;
  source: "measured" | "datasheet" | "assumed";
};

export type MorphologyProfile = {
  modes: MorphologyMode[];
  /** The shape the machine powers up in. */
  defaultMode: string;
  /**
   * What it costs to change shape. Absent means nobody has measured it, which
   * matters because every decision to switch is a decision about this number.
   */
  transitions?: Array<{
    from: string;
    to: string;
    seconds: number;
    joules?: number;
    source: "measured" | "assumed";
  }>;
  /**
   * The fraction of body weight the actuators can take off any one contact,
   * 0..1. This is the thing legs physically buy that a passive suspension
   * cannot: a rocker-bogie equalises load by design and cannot choose to do
   * otherwise.
   *
   * Undefined when nobody has measured it — which is not zero and not one. The
   * first ARC-2 hypothesis turned on this quantity and was refuted in
   * `arc2/terramechanics.ts`, which does not make the number less worth
   * measuring; it makes it less worth assuming.
   */
  normalForceAuthority?: number;
  /** How many ground contacts there are, and how many can be unloaded. */
  contacts?: { count: number; liftable: number };
};

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
   * How far the person tracker actually reaches, metres, and how wide, radians.
   *
   * Declaring `"camera"` says the machine has one. It does not say how far it
   * sees, and the difference decides whether a capability works. `hri.yield-path`
   * predicts a closest approach and steps out of it; measured on a tracker with
   * no reach at all it cleared 45 corridor crossings in 60, and gated to six
   * metres and 162° the same code cleared 24 — because stepping aside means
   * turning, and turning swings the camera off the person who caused it.
   *
   * Leave them undefined when nobody has measured them, which is different from
   * assuming they are generous. A detector's useful range is the distance at
   * which it still produces a track you would act on, not the distance at which
   * a person occupies one pixel.
   */
  visionRange?: number;
  visionFov?: number;
  /**
   * Sense-to-act latency budget in ms. The governor measures the real figure
   * and widens its separation distances when the measurement exceeds this, so
   * an optimistic number here costs safety margin rather than buying speed.
   */
  reactionTimeMs: number;
  /** Topic names, where they differ from the ROS defaults. */
  topics?: Partial<Ros2Topics>;
  frames?: { base: string; odom: string; lidar: string };
  /**
   * How commands reach the motors. The kernel treats a wireless link as a
   * component that fails, because it is the one that does.
   */
  link?: LinkProfile;
  /**
   * The numbers that turn wheel rotations into metres. Getting these slightly
   * wrong does not look like a bug — it looks like drift, and drift looks like
   * a sensor problem. `source` is here because a wheelbase somebody measured
   * with a tape and a wheelbase somebody assumed are different kinds of fact.
   */
  kinematics?: Kinematics;
  /**
   * Height of the lidar plane above the floor, metres. Everything below it is
   * invisible: a foot, a cat, a child lying down, the lip of a step.
   */
  lidarHeight?: number;
  /**
   * How much floor the robot can clear, metres. On some popular platforms this
   * is a few millimetres, which makes a door threshold or a cable a wall.
   */
  groundClearance?: number;
  /**
   * Whether the battery channel reports 0–1 or 0–100. The ROS message is
   * specified as a fraction and drivers publish both, so a robot can believe
   * it has 85% charge when it has 0.85% of it. Measure this once.
   */
  batteryScale?: "fraction" | "percent" | "unknown";
  /** Gripper force ceiling in newtons, when there is a gripper. */
  maxContactForce?: number;
  /**
   * The shapes this machine can take, when it can take more than one.
   *
   * Absent means fixed morphology, which is every platform in this file except
   * the ARC-2 template. When it is present the top-level motion numbers are the
   * machine's envelope, and `limitsFrom` without a named mode returns the
   * *most restrictive* mode instead — because a caller that has not said which
   * shape the robot is in does not know, and not knowing has a safe direction.
   */
  morphology?: MorphologyProfile;
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

/** The mode by that name, or the most restrictive one when none is named. */
export function modeLimits(
  profile: RobotProfile,
  mode?: string,
): Pick<MorphologyMode, "maxLinear" | "maxAngular" | "maxDecel"> {
  const morphology = profile.morphology;
  if (!morphology || morphology.modes.length === 0) {
    return {
      maxLinear: profile.maxLinear,
      maxAngular: profile.maxAngular,
      maxDecel: profile.maxDecel,
    };
  }
  if (mode !== undefined) {
    const found = morphology.modes.find((m) => m.name === mode);
    if (!found) {
      throw new Error(
        `${profile.id} has no "${mode}" mode. It has: ${morphology.modes.map((m) => m.name).join(", ")}.`,
      );
    }
    return found;
  }
  // Nobody said which shape the robot is in. Take the worst of each number
  // separately rather than the worst mode, because a caller that does not know
  // the mode cannot rely on any single one of them.
  return {
    maxLinear: Math.min(...morphology.modes.map((m) => m.maxLinear)),
    maxAngular: Math.min(...morphology.modes.map((m) => m.maxAngular)),
    maxDecel: Math.min(...morphology.modes.map((m) => m.maxDecel)),
  };
}

/** Turn a profile into the safety limits the governor should run with. */
export function limitsFrom(profile: RobotProfile, mode?: string): Partial<SafetyLimits> {
  const motion = modeLimits(profile, mode);
  return {
    maxLinear: motion.maxLinear,
    maxAngular: motion.maxAngular,
    maxDecel: motion.maxDecel,
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
  visionRange: 6,
  visionFov: Math.PI * 0.9,
  maxContactForce: 28,
  link: {
    kind: "loopback",
    controlPeriodMs: 20,
    maxRoundTripP99Ms: 1,
    // The simulator is in the same process, so the "robot side" and the
    // "sender side" are the same side. Nothing can drop between them.
    robotSideWatchdogMs: 20,
  },
  kinematics: {
    wheelRadius: 0.05,
    trackWidth: 0.35,
    source: "platform-parameters",
    minMovingSpeed: 0.03,
  },
  lidarHeight: 0.2,
  groundClearance: 0.05,
  batteryScale: "fraction",
  notes: [
    "Two dimensions, a planar arm and no arm dynamics. Determinism here is a reproducibility property, not a fidelity claim.",
  ],
  verified: "simulator",
};

/**
 * What to run when the platform is unknown.
 *
 * There is no permissive default. A profile that is missing does not fall back
 * to something reasonable-sounding, because "reasonable" was calibrated against
 * a robot that is not this one. It falls back to here: slow enough that a
 * mistake is a bump, with the separation model assuming the worst about
 * everything it has not been told.
 *
 * The right way out of this profile is to measure the robot, not to raise the
 * numbers until it feels responsive.
 */
export const CRAWL_PROFILE: RobotProfile = {
  id: "crawl",
  name: { en: "Unknown platform (crawl)", ar: "منصّة مجهولة (زحف)" },
  base: "differential",
  // Assume a big robot: a footprint guess that is too small is the one that
  // clips door frames and people.
  footprintRadius: 0.4,
  comHeight: 0.4,
  footHalf: 0.2,
  maxLinear: 0.05,
  maxAngular: 0.3,
  maxAccel: 0.2,
  maxDecel: 0.2,
  capabilities: ["drive"],
  // Assume a slow link until something measures a fast one.
  reactionTimeMs: 500,
  link: {
    kind: "wireless",
    controlPeriodMs: 100,
    maxRoundTripP99Ms: 100,
    robotSideWatchdogMs: null,
  },
  kinematics: { wheelRadius: 0.05, trackWidth: 0.3, source: "assumed" },
  batteryScale: "unknown",
  absent: [
    "Nothing is known about this platform. Every capability beyond driving is treated as missing.",
    "Kinematics are assumed, so anything needing metric accuracy — mapping, navigation, precise motion — refuses.",
  ],
  notes: [
    "This profile exists so an unidentified robot moves at a speed where being wrong is survivable.",
    "Replace it by measuring the machine. Do not raise these numbers to make a demo feel better.",
  ],
  verified: "unverified",
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
  link: {
    kind: "wireless",
    controlPeriodMs: 50,
    maxRoundTripP99Ms: 50,
    robotSideWatchdogMs: null,
  },
  kinematics: { wheelRadius: 0.05, trackWidth: 0.3, source: "assumed" },
  lidarHeight: 0.15,
  groundClearance: 0.02,
  batteryScale: "unknown",
  absent: [
    "No arm or gripper: every manipulation ability will refuse.",
    "No person tracking: the separation model has nothing to separate from until you add it.",
  ],
  notes: [
    "Measure the footprint including anything bolted on — that is what hits the door frame.",
    "Start with maxLinear well below what the platform can do. You can raise it after the first hour.",
    "Over WiFi, 250 ms is an optimistic reaction time. The governor measures the real one and widens its margins to match.",
    "Set robotSideWatchdogMs once you know the base's own command timeout. Until then the only watchdog is on the far side of the link, which is the side that fails.",
  ],
  verified: "unverified",
};

/**
 * ARC-2, which does not exist.
 *
 * Every number here is a guess, and the file says so in the only way that
 * matters: `verified: "unverified"`, every mode `source: "assumed"`, and the
 * quantities nobody has measured left out rather than filled in. It is here so
 * that a capability written for a shape-changing machine has something to be
 * refused by, and so that the shape of what has to be measured is visible
 * before there is a machine to measure it on.
 *
 * `normalForceAuthority` is deliberately absent. It is the one number that says
 * what the legs physically buy over a passive suspension, the first ARC-2
 * hypothesis turned on it, and assuming it is exactly how that hypothesis went
 * wrong. Undefined is the honest value until somebody puts a load cell under a
 * wheel and lifts.
 */
export const ARC2_TEMPLATE: RobotProfile = {
  id: "arc-2",
  name: { en: "ARC-2 (no machine yet)", ar: "ARC-2 (ما في آلة بعد)" },
  base: "differential",
  footprintRadius: 0.35,
  comHeight: 0.4,
  footHalf: 0.22,
  // The envelope: the best any mode manages. `limitsFrom` without a named mode
  // does not use these — it takes the worst of each number across the modes.
  maxLinear: 1.2,
  maxAngular: 1.6,
  maxAccel: 1.2,
  maxDecel: 1.2,
  capabilities: ["drive", "lidar", "imu", "camera", "battery"],
  reactionTimeMs: 150,
  groundClearance: 0.08,
  morphology: {
    defaultMode: "wheel",
    modes: [
      {
        name: "wheel",
        maxLinear: 1.2,
        maxAngular: 1.6,
        maxAccel: 1.2,
        maxDecel: 1.2,
        stance: "static",
        groundClearance: 0.08,
        source: "assumed",
      },
      {
        name: "leg",
        // Slower, weaker and higher off the ground. The numbers are guesses;
        // the *ordering* is the part that is not — a machine whose legs are as
        // fast as its wheels does not need wheels.
        maxLinear: 0.35,
        maxAngular: 0.8,
        maxAccel: 0.4,
        maxDecel: 0.4,
        stance: "dynamic",
        groundClearance: 0.22,
        source: "assumed",
      },
    ],
    transitions: [
      { from: "wheel", to: "leg", seconds: 4, source: "assumed" },
      { from: "leg", to: "wheel", seconds: 3, source: "assumed" },
    ],
    contacts: { count: 4, liftable: 4 },
    // normalForceAuthority: deliberately absent — see above.
  },
  absent: [
    "Every number in this profile. No ARC-2 has been built.",
    "normalForceAuthority — what the legs can actually take off a wheel.",
    "The energy cost of a mode change, as opposed to its duration.",
    "Whether the leg mode can be entered from a standstill only, or while moving.",
  ],
  notes: [
    "This is a shape for measurements to be poured into, not a description of a machine.",
    "The first thing to measure is the one the retreat hypothesis turns on: drive into a " +
      "prepared patch of loose material at a controlled slip, count the passes, then measure " +
      "what it takes to reverse out — and repeat the exit in leg mode.",
  ],
  verified: "unverified",
};

export const PROFILES: Record<string, RobotProfile> = {
  [SIMULATED_ROVER.id]: SIMULATED_ROVER,
  [GENERIC_ROVER_TEMPLATE.id]: GENERIC_ROVER_TEMPLATE,
  [CRAWL_PROFILE.id]: CRAWL_PROFILE,
  [ARC2_TEMPLATE.id]: ARC2_TEMPLATE,
};

/**
 * Whether this platform can be trusted with a metric task — mapping,
 * navigating to a coordinate, driving a measured distance.
 *
 * All three need wheel rotations to mean metres. A guessed wheelbase does not
 * fail loudly; it produces a map that is subtly the wrong scale and a robot
 * that is confidently somewhere else.
 */
export function metricallyTrustworthy(
  profile: RobotProfile,
): { ok: boolean; reason?: string } {
  const kinematics = profile.kinematics;
  if (!kinematics) {
    return {
      ok: false,
      reason:
        `${profile.name.en} has no kinematics in its profile, so wheel rotations cannot be ` +
        "converted to metres. Measure the wheel radius and track width, or read them off the platform.",
    };
  }
  if (kinematics.source === "assumed") {
    return {
      ok: false,
      reason:
        `${profile.name.en} has assumed kinematics (wheel radius ${kinematics.wheelRadius} m, ` +
        `track ${kinematics.trackWidth} m). Assumed numbers produce a map at the wrong scale rather ` +
        "than an error. Measure them, or read them from the platform's own parameters.",
    };
  }
  return { ok: true };
}

/**
 * Whether a control loop at this period can be closed across this link.
 *
 * The comparison is against the tail, not the average. A link whose median is
 * 8 ms and whose p99 is 180 ms will feel fine and will occasionally hand the
 * robot a command about a world that is nearly a fifth of a second old.
 */
export function linkSupportsControl(
  profile: RobotProfile,
  measuredP99Ms?: number,
): { ok: boolean; reason?: string } {
  const link = profile.link;
  if (!link) return { ok: true };

  const p99 = measuredP99Ms ?? link.maxRoundTripP99Ms;
  if (p99 > link.controlPeriodMs) {
    return {
      ok: false,
      reason:
        `the link's p99 round trip is ${p99.toFixed(0)} ms and the control period is ` +
        `${link.controlPeriodMs} ms. One command in a hundred arrives describing a world that has ` +
        "already moved on. Close the fast loop on the robot and send setpoints across this link instead.",
    };
  }
  return { ok: true };
}

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

  const morphology = profile.morphology;
  if (morphology) {
    if (morphology.modes.length < 2) {
      problems.push(
        "A morphology block with fewer than two modes describes a fixed-shape robot. " +
          "Leave it out rather than declaring a shape-changer that cannot change shape.",
      );
    }
    const names = morphology.modes.map((m) => m.name);
    if (new Set(names).size !== names.length) {
      problems.push(`Two morphology modes share a name: ${names.join(", ")}.`);
    }
    if (!names.includes(morphology.defaultMode)) {
      problems.push(
        `defaultMode "${morphology.defaultMode}" is not one of the declared modes (${names.join(", ")}).`,
      );
    }
    for (const mode of morphology.modes) {
      if (mode.maxLinear <= 0 || mode.maxDecel <= 0) {
        problems.push(`Mode "${mode.name}" has a non-positive speed or braking limit.`);
      }
      if (mode.maxDecel > mode.maxAccel * 3) {
        problems.push(
          `Mode "${mode.name}" brakes at ${mode.maxDecel} m/s² and accelerates at ${mode.maxAccel}. ` +
            "Braking harder than the drive can accelerate needs evidence.",
        );
      }
    }
    // The top-level numbers are the envelope. A machine whose envelope is
    // narrower than a mode it declares is describing two different robots.
    const fastest = Math.max(...morphology.modes.map((m) => m.maxLinear));
    if (profile.maxLinear < fastest - 1e-9) {
      problems.push(
        `maxLinear (${profile.maxLinear}) is below the fastest declared mode (${fastest}). ` +
          "The top-level figures are the machine's envelope; a mode cannot exceed it.",
      );
    }
    if (
      morphology.normalForceAuthority !== undefined &&
      (morphology.normalForceAuthority < 0 || morphology.normalForceAuthority > 1)
    ) {
      problems.push("normalForceAuthority is a fraction of body weight and must be within 0..1.");
    }
    if (morphology.contacts && morphology.contacts.liftable > morphology.contacts.count) {
      problems.push("More contacts are declared liftable than exist.");
    }
    for (const transition of morphology.transitions ?? []) {
      if (!names.includes(transition.from) || !names.includes(transition.to)) {
        problems.push(
          `A transition names a mode that does not exist: ${transition.from} → ${transition.to}.`,
        );
      }
      if (transition.seconds <= 0) {
        problems.push(
          `Changing shape from ${transition.from} to ${transition.to} is declared instantaneous. ` +
            "Nothing mechanical is, and any decision to switch is a decision about this number.",
        );
      }
    }
  }

  if (profile.lidarHeight !== undefined && profile.lidarHeight <= 0) {
    problems.push("lidarHeight must be positive — it is a height above the floor, not an offset.");
  }

  const link = profile.link;
  if (link && link.controlPeriodMs <= 0) {
    problems.push("controlPeriodMs must be positive.");
  }
  if (link && link.robotSideWatchdogMs !== null && link.robotSideWatchdogMs <= 0) {
    problems.push("robotSideWatchdogMs must be positive, or null when there is no watchdog.");
  }

  return problems;
}

export type Finding = {
  /**
   * `block` — do not drive at the profile's speeds until this is resolved.
   * `warn` — a real limitation somebody should know about before it surprises
   * them, not a reason to refuse.
   */
  level: "block" | "warn";
  code: string;
  message: string;
};

/**
 * What is risky about running this robot as configured.
 *
 * Separate from `validateProfile` on purpose. That one asks whether the profile
 * describes a coherent machine; this one asks whether the coherent machine it
 * describes is safe to switch on. A profile can pass the first and fail the
 * second — the generic template does, which is the honest result for a profile
 * nobody has filled in yet.
 *
 * Findings are returned rather than thrown so the caller decides. `hardware.checkout`
 * treats `block` as a refusal.
 */
export function auditProfile(profile: RobotProfile): Finding[] {
  const findings: Finding[] = [];
  const link = profile.link;

  // A speed limit below the platform's stiction is a stop wearing a limit's
  // clothes, and nothing else in the kernel would notice: the governor would go
  // on reporting that it is crawling while the robot sits still.
  // A profile with no kinematics at all is already reported elsewhere; here the
  // question is only about the speed floor.
  const floor = profile.kinematics?.minMovingSpeed;
  if (profile.kinematics !== undefined && floor === undefined) {
    findings.push({
      level: "warn",
      code: "stiction-unknown",
      message:
        "Nobody has measured the slowest speed this platform actually moves at. Command it at " +
        "0.02 m/s and watch whether the wheels turn; if they do not, every degraded mode that " +
        "answers a problem by crawling is a stop that reports itself as motion.",
    });
  } else if (floor !== undefined && floor >= profile.maxLinear) {
    findings.push({
      level: "block",
      code: "stiction-above-limit",
      message:
        `This platform will not move below ${floor} m/s and its speed limit is ` +
        `${profile.maxLinear} m/s. There is no speed it is both allowed and able to travel at.`,
    });
  }

  if (link) {
    if (link.maxRoundTripP99Ms > link.controlPeriodMs) {
      findings.push({
        level: "block",
        code: "link-too-slow",
        message:
          `The link's expected p99 (${link.maxRoundTripP99Ms} ms) is longer than the control ` +
          `period (${link.controlPeriodMs} ms). A loop cannot be closed across it. Either slow ` +
          "the loop or run the fast part on the robot and send setpoints across the link.",
      });
    }

    if (link.kind === "wireless" && link.robotSideWatchdogMs === null) {
      // The kernel's own deadman runs in this process. If this process is what
      // died, it is not running, and it is not going to stop anything.
      const reach = profile.maxLinear;
      findings.push({
        level: profile.maxLinear > CRAWL_LINEAR ? "block" : "warn",
        code: "no-robot-watchdog",
        message:
          "Wireless link with no watchdog on the robot. If this process dies, the last velocity " +
          `command stays in force and the robot keeps driving at up to ${reach.toFixed(2)} m/s ` +
          "until something physical stops it. The kernel's deadman cannot cover this case, because " +
          "it is running in the process that died. Configure the base's own command timeout, or " +
          `keep maxLinear at crawl (${CRAWL_LINEAR} m/s).`,
      });
    }

    if (link.robotSideWatchdogMs !== null) {
      const travel = (link.robotSideWatchdogMs / 1000) * profile.maxLinear;
      if (travel > 0.2) {
        findings.push({
          level: "warn",
          code: "slow-robot-watchdog",
          message:
            `The robot's own watchdog takes ${link.robotSideWatchdogMs} ms to fire, so a dead ` +
            `command carries it ${travel.toFixed(2)} m before firmware intervenes.`,
        });
      }
    }
  } else {
    findings.push({
      level: "warn",
      code: "link-unknown",
      message:
        "No link is described, so the kernel cannot tell whether commands cross something that " +
        "fails. If this robot is driven over a network, describe the link.",
    });
  }

  const metric = metricallyTrustworthy(profile);
  if (!metric.ok) {
    findings.push({ level: "warn", code: "kinematics-assumed", message: metric.reason ?? "" });
  }

  if (profile.batteryScale === undefined && profile.capabilities.includes("battery")) {
    findings.push({
      level: "warn",
      code: "battery-scale-unknown",
      message:
        "A battery is declared but batteryScale is unset. The ROS message specifies a 0–1 " +
        "fraction and drivers publish both that and 0–100, so the robot may read 0.85% as 85% " +
        "and drive itself flat. Read the topic once and record which it is.",
    });
  }

  if (profile.lidarHeight !== undefined) {
    findings.push({
      level: "warn",
      code: "lidar-blind-below",
      message:
        `The lidar plane is ${(profile.lidarHeight * 100).toFixed(0)} cm above the floor. It cannot ` +
        "see anything below that: a foot, an animal, a person lying down, or the lip of a step. " +
        "Nothing in this kernel makes that untrue.",
    });
  }

  if (profile.groundClearance !== undefined && profile.groundClearance < 0.02) {
    findings.push({
      level: "warn",
      code: "low-clearance",
      message:
        `Ground clearance is ${(profile.groundClearance * 1000).toFixed(0)} mm. A door threshold, ` +
        "a cable or a rug edge is a wall to this robot, and the lidar will not report it as one.",
    });
  }

  if (profile.verified === "unverified") {
    findings.push({
      level: "warn",
      code: "unverified",
      message:
        `${profile.name.en} has not been checked against a real machine. Every number in it is a ` +
        "hypothesis, including the ones the safety model depends on.",
    });
  }

  return findings;
}

/** The speed below which being wrong about the robot is a bump, not an injury. */
export const CRAWL_LINEAR = 0.05;
