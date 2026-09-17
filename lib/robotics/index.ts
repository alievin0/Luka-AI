// Luka Robotics Kernel — public entry point.
//
//   const rig = createSimRig({ scenario: "cluttered-office" });
//   rig.runtime.startDaemon("reflex.shield", {});
//   await rig.runtime.run("navigate.to", { x: 12, y: 8 });
//
// The same abilities run on real hardware by handing `RobotRuntime` a different
// `RobotIO` implementation — see `hal/README` in the package docs.

export * from "./core/types.ts";
export * from "./core/math.ts";
export { AbilityRegistry } from "./core/registry.ts";
export { RobotRuntime, type RuntimeOptions, type RunHandle } from "./core/runtime.ts";
export { createMemory, createInMemoryBackend, sharedBackend } from "./core/memory.ts";
export { validate } from "./core/schema.ts";
export * from "./core/dmp.ts";

export { SafetyGovernor, DEFAULT_LIMITS, nearestObstacle, type SafetyLimits } from "./safety/governor.ts";

export { SimWorld, type SimWorldConfig, type SimRobot, TIP_ANGLE } from "./sim/world.ts";
export { SimRobotAdapter, FULL_HARDWARE } from "./sim/adapter.ts";
export {
  type RobotProfile,
  PROFILES,
  SIMULATED_ROVER,
  GENERIC_ROVER_TEMPLATE,
  limitsFrom,
  validateProfile,
  abilityFitness,
} from "./hal/profile.ts";
export { SCENARIOS, scenario, type Scenario, type ScenarioName } from "./sim/scenarios.ts";

export { ALL_ABILITIES, createRegistry } from "./abilities/index.ts";

import { AbilityRegistry } from "./core/registry.ts";
import { RobotRuntime } from "./core/runtime.ts";
import { createInMemoryBackend, createMemory, type MemoryBackend } from "./core/memory.ts";
import { limitsFrom, type RobotProfile } from "./hal/profile.ts";
import { SafetyGovernor, type SafetyLimits } from "./safety/governor.ts";
import { SimRobotAdapter, FULL_HARDWARE } from "./sim/adapter.ts";
import { SimWorld } from "./sim/world.ts";
import { scenario, type ScenarioName } from "./sim/scenarios.ts";
import { createRegistry } from "./abilities/index.ts";
import type { HardwareCapability } from "./core/types.ts";

export type SimRig = {
  world: SimWorld;
  registry: AbilityRegistry;
  governor: SafetyGovernor;
  robot: SimRobotAdapter;
  runtime: RobotRuntime;
  /** Extra robots in fleet scenarios, keyed by id (includes the primary one). */
  fleet: Map<string, { robot: SimRobotAdapter; runtime: RobotRuntime; governor: SafetyGovernor }>;
};

export type SimRigOptions = {
  scenario?: ScenarioName;
  /**
   * The robot this rig is standing in for. Its limits become the governor's
   * limits, and abilities can read it to refuse what the platform cannot do.
   */
  profile?: RobotProfile;
  seed?: number;
  /** 0 = as fast as possible (tests), 1 = wall-clock (live UI). */
  realtimeFactor?: number;
  capabilities?: HardwareCapability[];
  limits?: Partial<SafetyLimits>;
  registry?: AbilityRegistry;
  memoryBackend?: MemoryBackend;
  /** Bring up every robot in the scenario, not just the first. */
  wholeFleet?: boolean;
  /** Fraction of lidar beams that return nothing, 0..1. A real failure mode. */
  beamDropout?: number;
  /** A contiguous arc of the scan that returns nothing, radians from heading. */
  blindSector?: { centre: number; width: number };
};

/** Stand up a complete simulated robot: world, safety, abilities, runtime. */
export function createSimRig(options: SimRigOptions = {}): SimRig {
  const chosen = scenario(options.scenario ?? "cluttered-office");
  const seed = options.seed ?? chosen.world.seed ?? 1;
  const world = new SimWorld({ ...chosen.world, seed });
  const registry = options.registry ?? createRegistry();
  const memoryBackend = options.memoryBackend ?? createInMemoryBackend();

  const spawns = options.wholeFleet ? chosen.spawns : chosen.spawns.slice(0, 1);
  const fleet = new Map<
    string,
    { robot: SimRobotAdapter; runtime: RobotRuntime; governor: SafetyGovernor }
  >();

  const profile = options.profile;

  for (const spawn of spawns) {
    world.addRobot(spawn.id, { x: spawn.x, y: spawn.y }, spawn.theta ?? 0, {
      charge: spawn.charge,
    });
    const governor = new SafetyGovernor({
      limits: { ...(profile ? limitsFrom(profile) : {}), ...options.limits },
    });
    const robot = new SimRobotAdapter(world, spawn.id, governor, {
      capabilities: options.capabilities ?? FULL_HARDWARE,
      beamDropout: options.beamDropout,
      blindSector: options.blindSector,
    });
    const runtime = new RobotRuntime({
      registry,
      robot,
      governor,
      world,
      seed,
      memoryBackend,
      realtimeFactor: options.realtimeFactor ?? 0,
      // The profile decides whether commands expire. A simulator's link is
      // in-process and cannot drop; anything else gets a deadman between the
      // abilities and the motors.
      link: profile?.link,
    });
    if (profile) createMemory(spawn.id, memoryBackend).set("profile", profile);
    fleet.set(spawn.id, { robot, runtime, governor });
  }

  const primary = fleet.get(spawns[0].id);
  if (!primary) throw new Error(`Scenario "${chosen.name}" has no robots.`);

  return {
    world,
    registry,
    governor: primary.governor,
    robot: primary.robot,
    runtime: primary.runtime,
    fleet,
  };
}
