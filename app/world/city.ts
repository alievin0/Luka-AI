import { CAMPUS_H, CAMPUS_W, NODES, routePath, tracedRoutes } from "./model";

/**
 * The campus plan — the world as numbers, before any of it is drawn.
 *
 * The page used to paste generated pictures onto a background. This is the
 * model those pictures were standing in for: every building is described here
 * as a footprint, a height and a kind, and `city3d` builds it out of real
 * geometry. Nothing on this page is a photograph of a building any more.
 *
 * The one thing that did not change is where everything stands. The plan reads
 * its coordinates from `model.ts`, the same numbers the routes and the agent
 * pins have always used, so the ground plan of the 3D city and the graph the
 * pipeline actually walks are one description and cannot drift apart.
 *
 * Nothing here imports three.js: the plan is plain arithmetic, so the tests can
 * check it without a browser or a GPU.
 */

/** Campus pixels per world unit. The whole city is ~113 × 68 units across. */
export const SCALE = 10;

export type Vec2 = { x: number; z: number };

/** Campus pixel space → world space, centred on the middle of the plan. */
export function toWorld(px: number, py: number): Vec2 {
  return { x: (px - CAMPUS_W / 2) / SCALE, z: (py - CAMPUS_H / 2) / SCALE };
}

export const GROUND_W = CAMPUS_W / SCALE;
export const GROUND_D = CAMPUS_H / SCALE + 4;

/* ── palette ────────────────────────────────────────────────────────────── */

/**
 * Five materials, no more. A miniature reads as one object when every wall is
 * the same white and every window the same glass; the colour that carries
 * meaning is then unmistakable because it is the only colour in the frame.
 */
export const PALETTE = {
  ground: "#d4dbea",
  groundInner: "#e6ebf6",
  wall: "#fafbfe",
  wallShade: "#d8e0ee",
  plinth: "#ccd5e6",
  glass: "#93c0e6",
  plate: "#242d47",
  amber: "#f0a93c",
  road: "#c8d1e3",
  tree: "#93bd9f",
  skin: "#f2c9a8",
} as const;

/** The state colours, matched to the roster's own tones. */
export const TONE_HEX = {
  blue: "#3b82f6",
  green: "#12b981",
  amber: "#f59e0b",
  red: "#f4525a",
  violet: "#8b7bff",
  grey: "#94a3b8",
} as const;

/* ── the buildings ──────────────────────────────────────────────────────── */

export type PlaceKind =
  | "pavilion"
  | "archive"
  | "hub"
  | "hall"
  | "workshop"
  | "gate"
  | "house"
  | "shop"
  | "tower"
  | "plaza"
  | "kiosk"
  | "mast"
  | "scaffold";

export type Place = {
  /** The node code this building stands on, straight out of `NODES`. */
  code: string;
  kind: PlaceKind;
  /** Footprint in world units, before rotation. */
  w: number;
  d: number;
  /** Height of the body, excluding the plinth it stands on. */
  h: number;
  /** Yaw, in radians. Most of the city is square; a few turn to face a road. */
  rot: number;
  /** Where the label floats and the beacon sits, above the ground. */
  crown: number;
  /** Colour of the one accent this building is allowed. */
  accent: string;
  label: string;
};

const P = (
  code: string,
  kind: PlaceKind,
  w: number,
  d: number,
  h: number,
  rot: number,
  crown: number,
  accent: string,
): Place => ({ code, kind, w, d, h, rot, crown, accent, label: NODES[code]?.label ?? code });

/**
 * Every building on the campus.
 *
 * Heights carry meaning rather than decoration: the orchestrator is the tallest
 * because everything routes through it, the watchtower is the thinnest because
 * it only looks, and the customer stands on a plaza with no walls at all
 * because the customer is not part of the machine.
 */
export const PLACES: Place[] = [
  P("reception", "pavilion", 17, 12.5, 7.6, 0.1, 10.8, PALETTE.amber),
  P("knowledge", "archive", 13, 11, 11.5, -0.12, 15, "#7b9cf0"),
  P("orchestrator", "hub", 12.5, 12.5, 14, 0.78, 18.2, "#5b6ef5"),
  P("booking", "hall", 14.5, 11.5, 10, -0.06, 13.2, "#3fb9a0"),
  P("tools", "workshop", 13, 10.5, 8.6, -0.3, 12, "#8b7bff"),
  P("policy", "gate", 16, 8.5, 7.2, 0.17, 10.6, "#f4525a"),
  P("handoff", "house", 11.5, 10, 7.4, -0.34, 12.4, "#f0a93c"),
  P("business", "shop", 9.5, 8, 6, -0.34, 7.6, "#9aa6bd"),
  P("supervision", "tower", 6.5, 6.5, 15, 0.2, 18.6, "#7b9cf0"),
  P("workshop", "scaffold", 9, 9, 6.5, 0.22, 9.8, "#9aa6bd"),
  P("voice", "mast", 3.6, 3.6, 8, 0, 12, "#7b9cf0"),
  P("customer", "plaza", 11, 11, 0.7, 0, 5.6, "#3b82f6"),
  P("channel-whatsapp", "kiosk", 4.2, 4.2, 4.6, 0.25, 6.6, "#25d366"),
  P("channel-web", "kiosk", 4.2, 4.2, 4.2, -0.15, 6.2, "#3b5bf6"),
  P("channel-instagram", "kiosk", 4.2, 4.2, 4, 0.4, 6, "#d6407f"),
];

const BY_CODE = new Map(PLACES.map((p) => [p.code, p]));

/**
 * The building an agent stands at: its own, else its zone's.
 *
 * `escalation` and `supervisor` are second names for a building that already
 * exists rather than buildings of their own — the roster uses both spellings,
 * and an agent must never fall off the map because of which one it picked.
 */
const ALIAS: Record<string, string> = {
  escalation: "policy",
  supervisor: "supervision",
};

export function placeFor(code: string): Place | null {
  return BY_CODE.get(ALIAS[code] ?? code) ?? null;
}

/** Where a building stands, in world units. */
export function anchorOf(place: Place): Vec2 {
  const node = NODES[place.code];
  return node ? toWorld(node.x, node.y) : { x: 0, z: 0 };
}

/* ── the roads ──────────────────────────────────────────────────────────── */

/**
 * The traced routes are SVG paths in campus pixels, written when the map was
 * flat. Rather than redraw them by hand for three dimensions, they are parsed
 * and sampled here: the roads in the city are literally the same curves the
 * pipeline's pulses have always travelled, laid onto the ground.
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

/** A route as a polyline in world units, ready to be turned into a ribbon. */
export function sampleRoute(from: string, to: string, perCurve = 18): Vec2[] {
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

/** Every road drawn on the ground, whether or not anything has used it yet. */
export function roads(): Array<{ from: string; to: string; points: Vec2[] }> {
  return tracedRoutes()
    .map((r) => ({ ...r, points: sampleRoute(r.from, r.to) }))
    .filter((r) => r.points.length > 1);
}

/* ── the small stuff that makes it a place ──────────────────────────────── */

/**
 * Trees and planters, placed by hand and kept off the roads.
 *
 * Scattering them randomly would put a tree through a wall on some renders and
 * not others; a fixed list is boring to write and right every time.
 */
export const GREENERY: Array<{ x: number; z: number; r: number }> = [
  { x: -46, z: -12, r: 1.9 },
  { x: -39, z: -20, r: 1.5 },
  { x: -19, z: -30, r: 1.7 },
  { x: -3, z: -24, r: 1.5 },
  { x: 8, z: -21, r: 1.8 },
  { x: 27, z: -18, r: 1.6 },
  { x: 38, z: -8, r: 1.9 },
  { x: 45, z: 6, r: 1.6 },
  { x: 22, z: 12, r: 1.8 },
  { x: 9, z: 27, r: 1.7 },
  { x: -12, z: 24, r: 1.5 },
  { x: -22, z: 9, r: 1.9 },
  { x: -48, z: 26, r: 1.6 },
  { x: 48, z: 22, r: 1.5 },
  { x: -33, z: 30, r: 1.4 },
  { x: 33, z: -28, r: 1.6 },
  { x: -52, z: 4, r: 1.7 },
  { x: -30, z: -6, r: 1.5 },
  { x: -9, z: 6, r: 1.6 },
  { x: 2, z: 14, r: 1.4 },
  { x: 17, z: 24, r: 1.7 },
  { x: -20, z: 32, r: 1.6 },
  { x: -3, z: 33, r: 1.4 },
  { x: 30, z: 8, r: 1.5 },
  { x: 52, z: -4, r: 1.6 },
  { x: -50, z: -24, r: 1.5 },
  { x: -41, z: 33, r: 1.5 },
  { x: 43, z: 33, r: 1.6 },
  { x: 12, z: -31, r: 1.5 },
  { x: -32, z: -32, r: 1.4 },
  { x: -44, z: 24, r: 2.1 },
  { x: -14, z: 30, r: 1.9 },
  { x: -37, z: 35, r: 1.5 },
  { x: -20, z: 21, r: 1.6 },
  { x: 25, z: 34, r: 1.8 },
  { x: 8, z: 34, r: 1.5 },
  { x: -53, z: 14, r: 1.7 },
  { x: 53, z: 14, r: 1.6 },
  { x: -52, z: -14, r: 1.5 },
  { x: 20, z: -30, r: 1.5 },
];

/**
 * The park in the empty quarter in front of the customer's plaza.
 *
 * The plan leaves a corner with nothing in it, and a corner with nothing in it
 * reads as a mistake rather than as open space. A pond and the planting around
 * it fill it with something that belongs in a place where people wait.
 */
export const POND = { x: -28, z: 29, rx: 12, rz: 7 };

/**
 * The paved ground under the two places people gather, which is what stops the
 * campus reading as buildings dropped at random on a lawn.
 */
export const PAVING: Array<{ x: number; z: number; r: number }> = [
  { x: -1.9, z: -6.2, r: 17 },
  { x: -34.5, z: -7.6, r: 13 },
  { x: -2.7, z: 18.4, r: 12 },
];
