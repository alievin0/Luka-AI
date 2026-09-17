// Shapes the /robots page receives over SSE. They mirror what
// `app/api/robots/route.ts` sends; keeping them here means the page never
// reaches into the kernel's internals.

export type Bilingual = { en: string; ar: string };

export type JsonSchema = {
  type: "object" | "array" | "string" | "number" | "boolean";
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: Array<string | number>;
  default?: unknown;
  minimum?: number;
  maximum?: number;
};

export type AbilityCard = {
  id: string;
  name: Bilingual;
  summary: Bilingual;
  rationale: string;
  risk: "passive" | "motion" | "contact" | "critical";
  requires: string[];
  tags: string[];
  daemon: boolean;
  inputSchema?: JsonSchema;
};

export type DemoCard = {
  name: string;
  title: Bilingual;
  blurb: string;
  abilities: string[];
};

export type ScenarioCard = {
  name: string;
  title: Bilingual;
  description: string;
};

export type Obstacle =
  | { id: string; kind: "circle"; at: { x: number; y: number }; radius: number }
  | {
      id: string;
      kind: "box";
      at: { x: number; y: number };
      width: number;
      height: number;
    };

export type WorldSetup = {
  width: number;
  height: number;
  dock: { x: number; y: number };
  obstacles: Obstacle[];
};

export type Frame = {
  t: number;
  robots: Array<{
    id: string;
    x: number;
    y: number;
    theta: number;
    tilt: number;
    charge: number;
    lights: { pattern: string; color: string };
    holding: string | null;
    speed: number;
    utterance: string | null;
  }>;
  humans: Array<{ id: string; x: number; y: number; attentive: boolean }>;
  objects: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    held: boolean;
    damaged: boolean;
  }>;
  lidar: { ranges: number[]; fov: number; maxRange: number; stride: number };
  arm: {
    tip: { x: number; y: number };
    height: number;
    closure: number;
    force: number;
    slip: number;
    pull: number;
  };
  envelope: number;
  safety: { level: "clear" | "slow" | "stop"; reason: string; speedScale: number };
};

export type OccupancyMap = {
  resolution: number;
  origin: { x: number; y: number };
  width: number;
  height: number;
  /** Base64, one byte per cell: 0 unknown, 1 free, 2 occupied. */
  cells: string;
};

export type LogEntry = {
  t: number;
  kind: "status" | "metric" | "signal" | "safety" | "pose" | "mark" | "warn" | "result";
  message?: string;
  ar?: string;
  reason?: string;
  summary?: string;
  payload?: string;
  channel?: string;
  level?: "clear" | "slow" | "stop";
  name?: string;
  value?: number;
  unit?: string;
  ok?: boolean;
  label?: string;
  at?: { x: number; y: number };
};

export type Outcome = {
  ok: boolean;
  summary: string;
  details?: string[];
  metrics?: Record<string, number>;
};

export type Mark = { label: string; at: { x: number; y: number }; t: number };

/** Everything the renderer needs, held outside React so frames never re-render. */
export type SceneState = {
  setup: WorldSetup | null;
  frame: Frame | null;
  map: { decoded: Uint8Array; meta: OccupancyMap } | null;
  trail: Array<{ x: number; y: number }>;
  marks: Mark[];
  history: {
    speed: number[];
    safety: number[];
    charge: number[];
  };
};

export function emptyScene(): SceneState {
  return {
    setup: null,
    frame: null,
    map: null,
    trail: [],
    marks: [],
    history: { speed: [], safety: [], charge: [] },
  };
}

export type Layers = {
  map: boolean;
  lidar: boolean;
  envelope: boolean;
  trail: boolean;
  labels: boolean;
};

export const DEFAULT_LAYERS: Layers = {
  map: true,
  lidar: true,
  envelope: true,
  trail: true,
  labels: true,
};
