/**
 * The world's art assets and where each one stands.
 *
 * Every piece here was generated with Higgsfield Soul 2.0 from the prompts
 * recorded beside it, then placed by hand in the campus artwork's own
 * coordinate space (1126 × 676) — the same space `model.ts` puts its nodes and
 * routes in, so a sprite and the pin that lights up on it can never disagree.
 *
 * Nothing in the scene carries baked text. Every label on screen is real
 * markup drawn on top, which is why the world can be in Arabic, stay sharp at
 * any zoom, and change with the business without regenerating a single image.
 *
 * The files are fetched by `npm run world:assets`; until they exist the page
 * falls back to the single flat render, so a missing asset can never break the
 * page. See DESK.md.
 */

import { CAMPUS_H, CAMPUS_W } from "./model";

export type SpriteKey =
  | "reception"
  | "knowledge"
  | "booking"
  | "policy"
  | "tools"
  | "handoff"
  | "orchestrator"
  | "customers"
  | "whatsapp"
  | "pod-idle"
  | "pod-wait"
  | "pod-alert";

export type Sprite = {
  /** File under `public/world/sprites/`. */
  file: string;
  /**
   * The cutout the page actually uses — the generated render with its
   * background removed, so it composites cleanly whatever the ground is.
   */
  source: string;
  /** The original render behind it, kept so the set can be redone. */
  sourceFlat: string;
  /** Centre of the sprite, in campus pixels. */
  x: number;
  y: number;
  /** Rendered width in campus pixels; the art is square. */
  w: number;
};

/** The places. Drawn back to front by `y`, which is what isometric depth is. */
export const PLACES: Array<Sprite & { key: SpriteKey; zone: string; label: string }> = [
  {
    key: "knowledge",
    zone: "knowledge",
    label: "المعرفة",
    file: "knowledge.png",
    source:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_030534_18dd616e-5a23-4573-b4b6-6574b0c21e51.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_025514_588df0aa-43bf-4a93-8a8a-be13a7d380ad.png",
    x: 438,
    y: 110,
    w: 258,
  },
  {
    key: "booking",
    zone: "booking",
    label: "الحجوزات",
    file: "booking.png",
    source:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_030536_3da90d84-4c8b-4fdf-a23f-44fa760ed240.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_025514_890e9128-48d2-4d8f-b195-c735338c9b56.png",
    x: 745,
    y: 251,
    w: 258,
  },
  {
    key: "reception",
    zone: "reception",
    label: "الاستقبال",
    file: "reception.png",
    source:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_030513_0e9c6a69-18d7-42aa-8746-f21253b279f9.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_024913_f1a957c0-a2af-46a0-b106-8f7044d2de85.png",
    x: 218,
    y: 262,
    w: 262,
  },
  {
    key: "orchestrator",
    zone: "orchestrator",
    label: "مدير المهام",
    file: "orchestrator.png",
    source:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_030546_7df0bd5f-6f55-4b85-ac70-b2c336e0827c.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_025514_21d80827-b54c-4c32-9923-021aa749295b.png",
    x: 544,
    y: 276,
    w: 198,
  },
  {
    key: "tools",
    zone: "tools",
    label: "الأدوات",
    file: "tools.png",
    source:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_030541_8f1c8db5-88c7-46f1-8e6c-84172fc5763a.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_025514_f3160930-36c4-48ba-8c8a-1aadfe3e9451.png",
    x: 896,
    y: 366,
    w: 250,
  },
  {
    key: "customers",
    zone: "customer",
    label: "الزبون",
    file: "customers.png",
    source:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_030555_fc76489b-e390-4b65-ad15-cccbf4463562.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_025514_b186810f-79e1-48c7-9365-220220f29c1b.png",
    x: 137,
    y: 508,
    w: 120,
  },
  {
    key: "policy",
    zone: "escalation",
    label: "بوابة السياسات",
    file: "policy.png",
    source:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_030539_7b2b23f6-c3b2-4b30-b6b7-d8282f056cde.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_025514_0c611478-9b69-4167-b301-f97804a49374.png",
    x: 536,
    y: 522,
    w: 262,
  },
  {
    key: "whatsapp",
    zone: "channel",
    label: "واتساب",
    file: "whatsapp.png",
    source:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_030557_ae2b1a94-243d-454c-b872-b94b79affe58.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_025514_d3e8287c-8822-492d-a8f9-7d08d123e4db.png",
    x: 209,
    y: 540,
    w: 78,
  },
  {
    key: "handoff",
    zone: "business",
    label: "الإنسان",
    file: "handoff.png",
    source:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_030544_62a4b7f6-343d-4784-976e-476fb1ea79f5.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_025514_55f5b828-7d2e-4968-90ae-6081d19c8082.png",
    x: 881,
    y: 582,
    w: 258,
  },
];

/** The characters. One per state the agent can actually be in. */
export const PODS: Record<
  "idle" | "wait" | "alert",
  { file: string; source: string; sourceFlat: string }
> = {
  idle: {
    file: "pod-idle.png",
    source:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_030548_57eb1816-148a-4274-b519-97e998d0edb8.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_025514_4a09fdae-c013-4898-a0a1-91ce91ccc8df.png",
  },
  wait: {
    file: "pod-wait.png",
    source:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_030553_c985ec6a-3208-46ca-a4f8-5c5715c8d201.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_025514_e1a56dbe-7c75-4cea-ae6b-2c1f2ec95537.png",
  },
  alert: {
    file: "pod-alert.png",
    source:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_030550_f92d1bea-0dda-457f-9a3a-ed0584cf0bf6.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_025514_2b3ba687-9889-4f58-accd-4716eeb8440c.png",
  },
};

/** Which character an agent's state puts on the board. */
export function podFor(state: string): "idle" | "wait" | "alert" {
  if (state === "escalated" || state === "error") return "alert";
  if (state === "waiting") return "wait";
  return "idle";
}

/**
 * Whether an agent is drawn as a character on the board.
 *
 * A channel is a doorway, not a person: it already has its own icon in the
 * scene, and standing a second robot on top of it says there are two things
 * there when there is one.
 */
export function hasPod(code: string): boolean {
  return !code.startsWith("channel-");
}

/** A pod stands in front of its building, which in isometric means lower down. */
export const POD_DROP = 56;
export const POD_W = 92;

export const SPRITE_DIR = "/world/sprites";

/**
 * Where the art is served from.
 *
 * `local` is the committed copy under `public/` and is what a real deployment
 * should use. `remote` points straight at the generator's CDN: this session's
 * network policy blocks that host, so the files could not be committed from
 * here, and reading them over the wire is what lets the world be seen at all
 * before someone runs `npm run world:assets`. It is a stopgap, not the plan —
 * if a sprite fails to load the page drops back to the single flat render
 * rather than showing a half-built world.
 */
export type SpriteSource = "local" | "remote";

export function spriteUrl(
  asset: { file: string; source: string },
  from: SpriteSource,
): string {
  return from === "local" ? `${SPRITE_DIR}/${asset.file}` : asset.source;
}

/** Everything the fetch script needs, in one list. */
export function allAssets(): Array<{ file: string; source: string }> {
  return [
    ...PLACES.map((p) => ({ file: p.file, source: p.source })),
    ...Object.values(PODS).map((p) => ({ file: p.file, source: p.source })),
  ];
}

/** Percentage geometry for a sprite, against the campus box. */
export function spriteBox(s: { x: number; y: number; w: number }) {
  return {
    left: `${((s.x - s.w / 2) / CAMPUS_W) * 100}%`,
    top: `${((s.y - s.w / 2) / CAMPUS_H) * 100}%`,
    width: `${(s.w / CAMPUS_W) * 100}%`,
    height: `${(s.w / CAMPUS_H) * 100}%`,
  };
}
