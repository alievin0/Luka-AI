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
 *
 * One trap, recorded because it cost a whole regeneration round: attaching a
 * reference image to Soul silently switches its prompt enhancer on, and the
 * enhancer re-captions the *reference* rather than elaborating the prompt. Ask
 * it for one isolated pavilion with a picture of the whole campus attached and
 * every asset comes back as a copy of the whole campus, Arabic signage and
 * all. These prompts are therefore text-only, which keeps the enhancer off and
 * the prompt verbatim — check the echoed `params.prompt` if that ever changes.
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
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123836_261e2abe-3f35-4efb-a60c-a4b539a63ce2.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123713_bb061f61-3113-40d2-84a8-4f3316539711.png",
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
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123839_d39f102f-2d30-4c71-9fa6-70bae304a198.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123713_8719ac85-095f-49a7-af26-58463e855667.png",
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
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123833_3cfdc4f2-4434-4e6e-abfc-7f9ba75c2faf.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123712_97c16339-e3dc-4923-838f-88c7769bd560.png",
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
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123946_319efdee-82a9-4973-9ee5-80f861e0839d.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123712_f482bdaf-45c0-46d9-8edd-58be7d6031a8.png",
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
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123845_1574bcd6-8320-4c02-a63a-400eb9ab8c43.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123712_7957b730-9ac7-4297-8db4-0cc2fd93464d.png",
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
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123927_12d6f261-fd80-4818-af03-b31dedaffddb.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123713_f0221023-0d2c-46fc-9672-dc6e2314fadb.png",
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
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123842_e92975b0-42aa-46d9-8f51-09bbac44b8b1.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123713_b10161e3-37ac-4c58-9c22-b6ff00a36ea0.png",
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
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123929_4b8d6f72-9bd8-42a5-88b3-9652959194b7.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123712_fb53f793-239e-4f7a-81b2-ce02c8990c11.png",
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
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123907_1eb0d9ce-9382-4add-a92b-5c92e3ea5b17.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123749_2f77bdc8-3211-4550-8c86-177281cd0121.png",
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
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123948_38961406-bbca-4e0e-8eaa-43de81b8cad1.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123713_e050f729-e0b1-44af-ab93-aaa814480a90.png",
  },
  wait: {
    file: "pod-wait.png",
    source:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123917_52d8bb24-5251-4b2c-be1c-4a63b58b19ff.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123713_6b7562af-0317-447b-8664-ee573ac4b935.png",
  },
  alert: {
    file: "pod-alert.png",
    source:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123921_d75b5c24-b8d5-4aea-828f-d5137dc0c864.png",
    sourceFlat:
      "https://d8j0ntlcm91z4.cloudfront.net/user_3FGFAFklFFNNDWgioc8qdFVbWa0/hf_20260918_123713_942bc5da-e0d8-4dd1-a455-de84d21d6f45.png",
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
