// Every ability the robot knows, in one registry.

import { AbilityRegistry } from "../core/registry.ts";
import { adaptiveGrasp } from "./adaptive-grasp.ts";
import { anomalySentinel } from "./anomaly-sentinel.ts";
import { balanceRecover } from "./balance-recover.ts";
import { exploreFrontier } from "./explore-frontier.ts";
import { handover } from "./handover.ts";
import { intentTelegraph } from "./intent-telegraph.ts";
import { learnFromDemo } from "./learn-demo.ts";
import { navigateTo } from "./navigate-to.ts";
import { powerLifeline } from "./power-lifeline.ts";
import { reflexShield } from "./reflex-shield.ts";
import { rehearsePlan } from "./rehearse.ts";
import { safetyStoppable } from "./stoppable.ts";
import { spatialMemory } from "./spatial-memory.ts";
import { swarmAuction } from "./swarm-auction.ts";
import type { Ability } from "../core/types.ts";

export const ALL_ABILITIES: Array<Ability<never, never>> = [
  adaptiveGrasp,
  anomalySentinel,
  balanceRecover,
  exploreFrontier,
  handover,
  intentTelegraph,
  learnFromDemo,
  navigateTo,
  powerLifeline,
  reflexShield,
  rehearsePlan,
  safetyStoppable,
  spatialMemory,
  swarmAuction,
] as unknown as Array<Ability<never, never>>;

/** A registry preloaded with the whole catalogue. */
export function createRegistry(): AbilityRegistry {
  return new AbilityRegistry().registerAll(ALL_ABILITIES);
}

export {
  adaptiveGrasp,
  anomalySentinel,
  balanceRecover,
  exploreFrontier,
  handover,
  intentTelegraph,
  learnFromDemo,
  navigateTo,
  powerLifeline,
  reflexShield,
  rehearsePlan,
  safetyStoppable,
  spatialMemory,
  swarmAuction,
};
