// Ready-made worlds. Every scenario is seeded, so "it worked on my machine"
// means the same thing on yours.

import type { SimWorldConfig } from "./world.ts";

export type ScenarioName =
  | "empty-hall"
  | "cluttered-office"
  | "busy-corridor"
  | "kitchen-fetch"
  | "warehouse-fleet"
  | "long-patrol";

export type Scenario = {
  name: ScenarioName;
  title: { en: string; ar: string };
  description: string;
  world: SimWorldConfig;
  /** Where robots start. More than one entry means a fleet scenario. */
  spawns: Array<{ id: string; x: number; y: number; theta?: number; charge?: number }>;
};

export const SCENARIOS: Record<ScenarioName, Scenario> = {
  "empty-hall": {
    name: "empty-hall",
    title: { en: "Empty Hall", ar: "قاعة فاضية" },
    description: "Nothing in the way. The baseline every other number is compared against.",
    world: { width: 14, height: 10, seed: 11, dock: { x: 1.2, y: 1.2 }, noise: 1 },
    spawns: [{ id: "luka-1", x: 2, y: 5 }],
  },

  "cluttered-office": {
    name: "cluttered-office",
    title: { en: "Cluttered Office", ar: "مكتب مزدحم" },
    description: "Desks, pillars and a narrow gap — reactive steering has to earn its keep.",
    world: {
      width: 14,
      height: 10,
      seed: 23,
      dock: { x: 1.2, y: 1.2 },
      obstacles: [
        { id: "desk-a", kind: "box", at: { x: 5, y: 3 }, width: 2.4, height: 0.9 },
        { id: "desk-b", kind: "box", at: { x: 5, y: 7 }, width: 2.4, height: 0.9 },
        { id: "pillar-1", kind: "circle", at: { x: 8.5, y: 5 }, radius: 0.5 },
        { id: "shelf", kind: "box", at: { x: 11, y: 2.5 }, width: 0.6, height: 3.4 },
      ],
      objects: [
        { id: "mug", label: "mug", at: { x: 9.6, y: 7.4 }, mass: 0.35, stiffness: 90, graspClosure: 0.5, crushForce: 55, graspable: true },
        { id: "folder", label: "folder", at: { x: 4.2, y: 8.6 }, mass: 0.6, stiffness: 20, graspClosure: 0.3, crushForce: 14, graspable: true },
      ],
    },
    spawns: [{ id: "luka-1", x: 2, y: 5 }],
  },

  "busy-corridor": {
    name: "busy-corridor",
    title: { en: "Busy Corridor", ar: "ممر مزدحم" },
    description: "Two people walking the same corridor the robot needs. Safety earns its keep here.",
    world: {
      width: 16,
      height: 6,
      seed: 37,
      dock: { x: 1.2, y: 1.2 },
      obstacles: [
        { id: "wall-a", kind: "box", at: { x: 8, y: 0.9 }, width: 7, height: 0.4 },
        { id: "wall-b", kind: "box", at: { x: 8, y: 5.1 }, width: 7, height: 0.4 },
      ],
      humans: [
        {
          id: "amal",
          at: { x: 11, y: 3 },
          waypoints: [
            { x: 4, y: 3 },
            { x: 13, y: 3 },
          ],
          speed: 1.1,
          attentive: false,
        },
        {
          id: "sami",
          at: { x: 6, y: 2.3 },
          waypoints: [
            { x: 13, y: 2.3 },
            { x: 5, y: 3.7 },
          ],
          speed: 0.8,
          attentive: true,
        },
      ],
    },
    spawns: [{ id: "luka-1", x: 2, y: 3 }],
  },

  "kitchen-fetch": {
    name: "kitchen-fetch",
    title: { en: "Kitchen Fetch", ar: "جيب من المطبخ" },
    description: "Soft fruit next to a rigid tin — grasping force is the whole problem.",
    world: {
      width: 10,
      height: 8,
      seed: 5,
      dock: { x: 1, y: 1 },
      obstacles: [
        { id: "counter", kind: "box", at: { x: 7, y: 6.2 }, width: 4.2, height: 0.8 },
        { id: "island", kind: "box", at: { x: 4.5, y: 3 }, width: 2, height: 1.2 },
      ],
      objects: [
        { id: "peach", label: "peach", at: { x: 6, y: 5.4 }, mass: 0.18, stiffness: 6, graspClosure: 0.45, crushForce: 4, graspable: true },
        { id: "tin", label: "tin can", at: { x: 7.4, y: 5.4 }, mass: 0.85, stiffness: 200, graspClosure: 0.55, crushForce: 140, graspable: true },
        { id: "bottle", label: "bottle", at: { x: 8.6, y: 5.4 }, mass: 1.4, stiffness: 150, graspClosure: 0.5, crushForce: 90, graspable: true },
        // Needs ~1.0 N of friction to hold and gives way at 0.8 N: there is no
        // force that both holds this and leaves it intact. The right answer is
        // to refuse, and `grasp.adaptive` has to work that out for itself.
        { id: "egg", label: "egg", at: { x: 5.2, y: 5.4 }, mass: 0.06, stiffness: 2.5, graspClosure: 0.4, crushForce: 0.8, graspable: true },
      ],
      humans: [
        { id: "host", at: { x: 2.5, y: 6.5 }, waypoints: [], speed: 0, attentive: true },
      ],
    },
    spawns: [{ id: "luka-1", x: 2, y: 3 }],
  },

  "warehouse-fleet": {
    name: "warehouse-fleet",
    title: { en: "Warehouse Fleet", ar: "أسطول المستودع" },
    description: "Four robots, a pile of jobs and no supervisor. They have to divide the work themselves.",
    world: {
      width: 20,
      height: 14,
      seed: 91,
      dock: { x: 1.5, y: 1.5 },
      obstacles: [
        { id: "rack-1", kind: "box", at: { x: 6, y: 4 }, width: 0.8, height: 5 },
        { id: "rack-2", kind: "box", at: { x: 10, y: 4 }, width: 0.8, height: 5 },
        { id: "rack-3", kind: "box", at: { x: 14, y: 4 }, width: 0.8, height: 5 },
        { id: "rack-4", kind: "box", at: { x: 8, y: 11 }, width: 5, height: 0.8 },
      ],
      objects: [
        { id: "pallet-a", label: "pallet a", at: { x: 17, y: 12 }, mass: 2, stiffness: 400, graspClosure: 0.7, crushForce: 300, graspable: true },
        { id: "pallet-b", label: "pallet b", at: { x: 3, y: 12 }, mass: 2, stiffness: 400, graspClosure: 0.7, crushForce: 300, graspable: true },
      ],
    },
    spawns: [
      { id: "luka-1", x: 2, y: 2 },
      { id: "luka-2", x: 2, y: 6, charge: 0.8 },
      { id: "luka-3", x: 18, y: 2, charge: 0.55 },
      { id: "luka-4", x: 18, y: 12, charge: 0.31 },
    ],
  },

  "long-patrol": {
    name: "long-patrol",
    title: { en: "Long Patrol", ar: "دورية طويلة" },
    description: "A big floor and a half-charged battery. Knowing when to turn back is the skill.",
    world: {
      width: 26,
      height: 18,
      seed: 64,
      dock: { x: 1.5, y: 1.5 },
      obstacles: [
        { id: "block-1", kind: "box", at: { x: 9, y: 6 }, width: 4, height: 1 },
        { id: "block-2", kind: "box", at: { x: 17, y: 12 }, width: 1, height: 5 },
        { id: "pillar", kind: "circle", at: { x: 13, y: 9 }, radius: 0.7 },
      ],
      faults: [
        // A bearing starts to go at the two-minute mark.
        { channel: "vibration", bias: 0.42, noise: 0.05, startsAtMs: 120_000 },
      ],
    },
    spawns: [{ id: "luka-1", x: 2, y: 2, charge: 0.42 }],
  },
};

export function scenario(name: ScenarioName): Scenario {
  const found = SCENARIOS[name];
  if (!found) {
    throw new Error(`Unknown scenario "${name}". Try: ${Object.keys(SCENARIOS).join(", ")}`);
  }
  return found;
}
