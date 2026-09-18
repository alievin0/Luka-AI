import { CAMPUS_H, CAMPUS_W, NODES, routePath, tracedRoutes } from "./model";

/**
 * The plan of the system, as numbers.
 *
 * This page has been through a miniature office, a flat backdrop, a set of
 * generated pictures and a town of little buildings, and the buildings were the
 * last thing to go: a receptionist that answers a clinic's customers is not a
 * town, and drawing it as one made a serious product look like a toy.
 *
 * What is left is what was always underneath — a graph. Each agent is a node
 * standing on the floor, each route between them is an arc, and the only things
 * that move are the messages actually crossing. Nothing is decorative.
 *
 * The coordinates come from `model.ts`, the same numbers the routes and the
 * agent pins have always used, so the picture and the pipeline are one
 * description and cannot drift apart. Nothing here imports three.js: the plan
 * is plain arithmetic, so the tests can check it without a browser or a GPU.
 */

/** Campus pixels per world unit. The whole graph is ~113 × 68 units across. */
export const SCALE = 10;

export type Vec2 = { x: number; z: number };

/** Campus pixel space → world space, centred on the middle of the plan. */
export function toWorld(px: number, py: number): Vec2 {
  return { x: (px - CAMPUS_W / 2) / SCALE, z: (py - CAMPUS_H / 2) / SCALE };
}

export const GROUND_W = CAMPUS_W / SCALE + 22;
export const GROUND_D = CAMPUS_H / SCALE + 22;

/* ── how it looks ───────────────────────────────────────────────────────── */

/**
 * The look, as data.
 *
 * The shape of this thing and the mood of it are different decisions, and
 * arguing about the second one should not mean rebuilding the first. Every
 * colour and every light lives here; `city3d` reads them and never names a
 * colour of its own.
 */
export type Look = {
  key: string;
  name: string;
  dark: boolean;
  /** The panel behind the canvas, and the gradient drawn into it. */
  panel: string;
  skyTop: string;
  skyBottom: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  /** The floor and the grid ruled on it. */
  floor: string;
  floorEdge: string;
  grid: string;
  /** A node: the platform it stands on, its rim at rest, and its core. */
  platform: string;
  platformTop: string;
  resting: string;
  core: string;
  coreMetalness: number;
  coreRoughness: number;
  /** The wiring between nodes before anything has crossed it. */
  link: string;
  /** Type, used by the panel rather than by the scene. */
  label: string;
  labelMinor: string;
  labelBack: string;
  /** Light. */
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  keyColor: string;
  keyIntensity: number;
  fillColor: string;
  fillIntensity: number;
  rimColor: string;
  rimIntensity: number;
  exposure: number;
};

/** Graphite: a dark console, lit by the system running on it. */
const GRAPHITE: Look = {
  key: "graphite",
  name: "داكن احترافي",
  dark: true,
  panel: "#0b1020",
  skyTop: "#080c18",
  skyBottom: "#141d36",
  fog: "#0b1020",
  fogNear: 150,
  fogFar: 330,
  floor: "#121a30",
  floorEdge: "#0b1020",
  grid: "#1f2b4c",
  platform: "#1b2440",
  platformTop: "#26314f",
  resting: "#46557f",
  core: "#e6ecfb",
  coreMetalness: 0.35,
  coreRoughness: 0.22,
  link: "#37477a",
  label: "#eaf0ff",
  labelMinor: "#8f9dc0",
  labelBack: "rgba(14,21,42,0.86)",
  hemiSky: "#2c3d72",
  hemiGround: "#070b16",
  hemiIntensity: 0.55,
  keyColor: "#d7e4ff",
  keyIntensity: 1.7,
  fillColor: "#4f7bd8",
  fillIntensity: 0.55,
  rimColor: "#8f7bff",
  rimIntensity: 0.9,
  exposure: 1.12,
};

/** Daylight: the same console in white, to sit inside a light dashboard. */
const DAYLIGHT: Look = {
  key: "daylight",
  name: "فاتح احترافي",
  dark: false,
  panel: "#eff3fa",
  skyTop: "#ffffff",
  skyBottom: "#e4eaf6",
  fog: "#eef2f9",
  fogNear: 170,
  fogFar: 350,
  floor: "#e8edf7",
  floorEdge: "#eff3fa",
  grid: "#d2dbef",
  platform: "#ffffff",
  platformTop: "#f6f8fd",
  resting: "#b9c4dc",
  core: "#31406b",
  coreMetalness: 0.25,
  coreRoughness: 0.3,
  link: "#a8b8d8",
  label: "#16203c",
  labelMinor: "#6b7590",
  labelBack: "rgba(255,255,255,0.94)",
  hemiSky: "#f2f6ff",
  hemiGround: "#aab6cf",
  hemiIntensity: 0.75,
  keyColor: "#ffffff",
  keyIntensity: 2.3,
  fillColor: "#c3d6ff",
  fillIntensity: 0.45,
  rimColor: "#a9b6ff",
  rimIntensity: 0.4,
  exposure: 1,
};

export const LOOKS: Record<string, Look> = { graphite: GRAPHITE, daylight: DAYLIGHT };

/** The look the board opens with, until the operator says otherwise. */
export const DEFAULT_LOOK = "graphite";

export function lookFor(key: string | null | undefined): Look {
  return LOOKS[key ?? ""] ?? LOOKS[DEFAULT_LOOK];
}

/** The state colours, matched to the roster's own tones. */
export const TONE_HEX = {
  blue: "#3b82f6",
  green: "#12b981",
  amber: "#f59e0b",
  red: "#f4525a",
  violet: "#8b7bff",
  grey: "#94a3b8",
} as const;

/* ── the nodes ──────────────────────────────────────────────────────────── */

/**
 * What a node is for. It changes the mark, never the meaning: a gate is drawn
 * as a gate because every message is screened there, and a node with no code
 * behind it is drawn as an outline because there is nothing inside it yet.
 */
export type PlaceKind = "hub" | "agent" | "gate" | "channel" | "source" | "sink" | "planned";

export type Place = {
  /** The node code this stands on, straight out of `NODES`. */
  code: string;
  kind: PlaceKind;
  /** Diameter of the platform, in world units. */
  w: number;
  d: number;
  /** Half-height of the solid standing on it. */
  core: number;
  /** Where the middle of that solid sits, above the floor. */
  h: number;
  rot: number;
  /** Where the label sits, above the floor. */
  crown: number;
  /** The one colour this node is allowed when it is not reporting state. */
  accent: string;
  label: string;
};

/** The top of a platform, where a solid rests. */
export const DECK = 0.95;

const P = (
  code: string,
  kind: PlaceKind,
  w: number,
  core: number,
  crown: number,
  accent: string,
  rot = 0,
): Place => ({
  code,
  kind,
  w,
  d: w,
  core,
  // The solid sits on its platform rather than hovering over it: an object
  // with a gap under it reads as a marker on a diagram, and an object resting
  // on something reads as an object.
  h: DECK + core * 0.94,
  rot,
  crown,
  accent,
  label: NODES[code]?.label ?? code,
});

/**
 * Every node on the board.
 *
 * Size carries rank rather than decoration: the orchestrator is the widest
 * because everything routes through it, a channel is the smallest because it is
 * a doorway and not a worker, and the two nodes that are only designed are the
 * same size as the ones that are built — an unbuilt agent is not a small agent.
 */
export const PLACES: Place[] = [
  P("reception", "agent", 13, 3.3, 9.6, "#3b82f6"),
  P("knowledge", "agent", 11, 2.8, 8.4, "#5b8bf5"),
  P("orchestrator", "hub", 16, 4.4, 12, "#7b6ef5"),
  P("booking", "agent", 12.5, 3.1, 9.2, "#12b981"),
  P("tools", "agent", 11, 2.8, 8.4, "#8b7bff"),
  P("policy", "gate", 14, 3.6, 10.2, "#f4525a"),
  P("handoff", "sink", 11.5, 2.9, 8.6, "#f0a93c"),
  P("business", "sink", 8.5, 2.2, 6.8, "#8f9dc0"),
  P("supervision", "agent", 9, 2.4, 7.4, "#5b8bf5"),
  P("workshop", "planned", 8.5, 2.2, 6.8, "#8f9dc0"),
  P("voice", "planned", 7, 1.8, 5.8, "#8f9dc0"),
  P("customer", "source", 11.5, 2.9, 8.6, "#3b82f6"),
  P("channel-whatsapp", "channel", 6.4, 1.7, 5.6, "#25d366"),
  P("channel-web", "channel", 6.4, 1.7, 5.6, "#3b5bf6"),
  P("channel-instagram", "channel", 6.4, 1.7, 5.6, "#d6407f"),
];

const BY_CODE = new Map(PLACES.map((p) => [p.code, p]));

/**
 * `escalation` and `supervisor` are second names for a node that already
 * exists rather than nodes of their own — the roster uses both spellings, and
 * an agent must never fall off the board because of which one it picked.
 */
const ALIAS: Record<string, string> = {
  escalation: "policy",
  supervisor: "supervision",
};

export function placeFor(code: string): Place | null {
  return BY_CODE.get(ALIAS[code] ?? code) ?? null;
}

/** Where a node stands, in world units. */
export function anchorOf(place: Place): Vec2 {
  const node = NODES[place.code];
  return node ? toWorld(node.x, node.y) : { x: 0, z: 0 };
}

/* ── the links ──────────────────────────────────────────────────────────── */

/**
 * The traced routes are SVG paths in campus pixels, written when the map was
 * flat. Rather than redraw them by hand, they are parsed and sampled here: the
 * links on the board are literally the same curves the pipeline's messages have
 * always travelled, so a link cannot lead somewhere a message cannot go.
 */
type Cubic = { c1: Vec2; c2: Vec2; end: Vec2 };

export function parseRoute(d: string): { start: Vec2; curves: Cubic[] } | null {
  const commands = d.match(/[MCQL][^MCQL]*/g);
  if (!commands) return null;

  let cursor: Vec2 | null = null;
  let start: Vec2 | null = null;
  const curves: Cubic[] = [];

  for (const command of commands) {
    const kind = command[0];
    const nums = (command.slice(1).match(/-?\d*\.?\d+/g) ?? []).map(Number);

    if (kind === "M") {
      if (nums.length < 2) return null;
      cursor = toWorld(nums[0], nums[1]);
      start = cursor;
      continue;
    }
    if (!cursor) return null;

    if (kind === "C") {
      if (nums.length < 6) return null;
      curves.push({
        c1: toWorld(nums[0], nums[1]),
        c2: toWorld(nums[2], nums[3]),
        end: toWorld(nums[4], nums[5]),
      });
      cursor = toWorld(nums[4], nums[5]);
    } else if (kind === "Q") {
      if (nums.length < 4) return null;
      // A quadratic is the cubic with its controls pulled two thirds of the
      // way in; converting here means the sampler only ever handles one shape.
      const c = toWorld(nums[0], nums[1]);
      const end = toWorld(nums[2], nums[3]);
      curves.push({
        c1: { x: cursor.x + (2 / 3) * (c.x - cursor.x), z: cursor.z + (2 / 3) * (c.z - cursor.z) },
        c2: { x: end.x + (2 / 3) * (c.x - end.x), z: end.z + (2 / 3) * (c.z - end.z) },
        end,
      });
      cursor = end;
    } else if (kind === "L") {
      if (nums.length < 2) return null;
      const end = toWorld(nums[0], nums[1]);
      curves.push({ c1: cursor, c2: end, end });
      cursor = end;
    }
  }

  if (!start || curves.length === 0) return null;
  return { start, curves };
}

function cubicAt(p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + e * p1.x,
    z: a * p0.z + b * c1.z + c * c2.z + e * p1.z,
  };
}

/** A route as a polyline in world units, ready to be turned into an arc. */
export function sampleRoute(from: string, to: string, perCurve = 20): Vec2[] {
  const d = routePath(from, to);
  if (!d) return [];
  const parsed = parseRoute(d);
  if (!parsed) return [];

  const points: Vec2[] = [parsed.start];
  let cursor = parsed.start;
  for (const curve of parsed.curves) {
    for (let i = 1; i <= perCurve; i += 1) {
      points.push(cubicAt(cursor, curve.c1, curve.c2, curve.end, i / perCurve));
    }
    cursor = curve.end;
  }
  return points;
}

/** Every link on the board, whether or not anything has used it yet. */
export function roads(): Array<{ from: string; to: string; points: Vec2[] }> {
  return tracedRoutes()
    .map((r) => ({ ...r, points: sampleRoute(r.from, r.to) }))
    .filter((r) => r.points.length > 1);
}

/**
 * How high a link arcs over the floor at its midpoint.
 *
 * Flat lines between fifteen nodes cross each other into a knot. Lifting each
 * one by its own length separates them by depth, which is the one thing a flat
 * diagram cannot do and the reason this is worth drawing in three dimensions
 * at all.
 */
export function arcHeight(points: Vec2[]): number {
  if (points.length < 2) return 0;
  const a = points[0];
  const b = points[points.length - 1];
  return Math.min(13, 2.2 + Math.hypot(b.x - a.x, b.z - a.z) * 0.16);
}
