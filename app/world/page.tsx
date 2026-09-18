"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * The agent world — a miniature model of the business.
 *
 * It mirrors the running system rather than animating beside it. Agents, their
 * states and every moving pulse come from `/api/desk`, which returns what the
 * pipeline actually wrote. An agent shown working is working; an agent drawn
 * pale has no code behind it yet and is never animated as busy. The routes
 * between rooms are not a drawn diagram either — each one exists because a
 * real message crossed it, and thickens with the traffic it carries.
 *
 * Art direction, because the first pass looked like a debug view:
 *
 *   - An ORTHOGRAPHIC camera at a fixed elevation. This one decision is most
 *     of the difference between "architectural model" and "tech demo"; a free
 *     perspective orbit reads as unfinished however good the geometry is.
 *   - A warm, desaturated palette for everything built — sand, cream, oak,
 *     charcoal. The agents' state colours are then the only saturated things
 *     on screen, so the eye goes straight to what changed. Spending colour on
 *     the scenery is what made the previous version unreadable.
 *   - Flat Lambert shading, one warm key light, long soft shadows, and a
 *     contact shadow under everything that stands. No emissive glow, no fog,
 *     no gradient sky: those hide weak forms rather than fixing them.
 *   - Chunky proportions, head about a third of the height. Realistic
 *     proportions at this scale read as blobs.
 */

type Agent = {
  code: string; name: string; role: string; zone: string;
  state: string; lifecycle: "live" | "planned";
  capabilities: string[]; tools: string[]; permissions: string[];
  updatedAt: string;
};
type WorldEvent = {
  id: string; agentCode?: string; kind: string;
  from?: string; to?: string; summary: string; createdAt: string;
};
type Business = { id: string; slug: string; name: string; isDemo: boolean };
type Storage = { persistent: boolean; message: string };
type Edge = { from: string; to: string; count: number };

const ZONE_AR: Record<string, string> = {
  reception: "الاستقبال", booking: "الحجوزات", knowledge: "المعرفة",
  tools: "القنوات", escalation: "التصعيد", supervision: "المراقبة",
  workshop: "الورشة", business: "صاحب العمل",
};

const STATE_AR: Record<string, string> = {
  idle: "جاهز", working: "شغّال", processing: "عم يعالج", waiting: "بينتظر",
  using_tool: "بيستعمل أداة", escalated: "حوّل لإنسان", error: "خطأ",
  offline: "ما انبنى", deploying: "قيد النشر",
};

/**
 * The only saturated colours in the scene. Everything the world is built from
 * is deliberately muted so that these carry all the meaning.
 */
const STATE_COLOR: Record<string, number> = {
  idle: 0x7c8aa3, working: 0x3d8bfd, processing: 0x3d8bfd, waiting: 0xf59e0b,
  using_tool: 0x8b7bff, escalated: 0xff4d4d, error: 0xff4d4d,
  offline: 0xc3cbd8, deploying: 0x2dd4a0,
};

const LEGEND: Array<{ state: string; label: string }> = [
  { state: "working", label: "شغّال" },
  { state: "using_tool", label: "بيستعمل أداة" },
  { state: "waiting", label: "بينتظر" },
  { state: "escalated", label: "حوّل لإنسان" },
  { state: "idle", label: "جاهز" },
  { state: "offline", label: "ما انبنى" },
];

/** The material palette of the model itself: warm, low-saturation, quiet. */
/**
 * The material palette, taken from the reference the client supplied.
 *
 * Light and airy rather than the flat grey this replaced: white architecture,
 * pale plaza, glass, and real greenery. Colour is semantic — the policy gate
 * is red because it stops things, the paths glow because data is moving — and
 * nowhere is it decorative.
 */
const P = {
  sky: 0xeef2f9,
  plaza: 0xe9eef7,
  plazaEdge: 0xd7dfec,
  slab: 0xffffff,
  slabSide: 0xdde5f0,
  wall: 0xfafcff,
  glass: 0xcfe0f5,
  board: 0x272c38,
  metal: 0xb8c4d6,
  desk: 0xe8edf6,
  screen: 0x2b3444,
  trunk: 0x8d7f6e,
  leaf: 0x63b183,
  leafDark: 0x4a8f68,
  planter: 0xf0f3f9,
  customer: 0x2a3040,
  orb: 0x141c2e,
  path: 0x4a9eff,
  pathAlt: 0x8b7bff,
};

/**
 * The floorplan. Rooms sit on a 9.5-unit grid with reception at the heart and
 * the customer arriving from the front, so the layout itself reads as the path
 * a message takes.
 */
const ZONE_POS: Record<string, [number, number]> = {
  reception: [0, 2.4],
  knowledge: [-5.8, 2.4], booking: [5.8, 2.4],
  tools: [-5.8, 8.2], supervision: [5.8, 8.2],
  escalation: [0, -3.4],
  workshop: [-5.8, -3.4], business: [5.8, -3.4],
};

/** Endpoints that are not rooms: the doorway the customer arrives through. */
const EXTRA_NODES: Record<string, { label: string; pos: [number, number]; color: number }> = {
  customer: { label: "الزبون", pos: [0, 11.4], color: 0x8f8f8f },
  "channel-web": { label: "المتصفح", pos: [-2.4, 8.2], color: 0x9c9c9c },
  "channel-voice": { label: "الصوت", pos: [2.4, 8.2], color: 0xaaaaaa },
};

const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

export default function WorldPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mountRef = useRef<HTMLDivElement>(null);
  const sceneApi = useRef<SceneApi | null>(null);
  const seenEvents = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    fetch("/api/desk")
      .then((r) => r.json())
      .then((d) => {
        setBusinesses(d.businesses ?? []);
        setStorage(d.storage ?? null);
        if (d.businesses?.length) setBusinessId(d.businesses[0].id);
      })
      .catch(() => setError("ما قدرت أجيب قائمة الأنشطة."));
  }, []);

  useEffect(() => {
    if (!businessId) return;
    let alive = true;

    const pull = async () => {
      try {
        const res = await fetch(`/api/desk?business=${encodeURIComponent(businessId)}`);
        const d = await res.json();
        if (!alive || !res.ok) return;
        setAgents(d.agents ?? []);
        setEvents(d.events ?? []);
        setError(null);
      } catch {
        if (alive) setError("تعذّر تحديث حالة العالم.");
      }
    };

    pull();
    // Polling, not a socket: the event stream is low-volume and this keeps the
    // deployment free of a stateful connection.
    const timer = setInterval(pull, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, [businessId]);

  /** The map of the system, derived from traffic rather than declared. */
  const edges = useMemo<Edge[]>(() => {
    const counts = new Map<string, Edge>();
    for (const e of events) {
      if (!e.from || !e.to || e.from === e.to) continue;
      const key = `${e.from}>${e.to}`;
      const hit = counts.get(key);
      if (hit) hit.count += 1;
      else counts.set(key, { from: e.from, to: e.to, count: 1 });
    }
    return Array.from(counts.values());
  }, [events]);

  useEffect(() => { sceneApi.current?.setAgents(agents); }, [agents]);
  useEffect(() => { sceneApi.current?.setEdges(edges); }, [edges]);
  useEffect(() => { sceneApi.current?.focus(selected); }, [selected]);

  useEffect(() => {
    if (!sceneApi.current) return;
    const fresh = events.filter((e) => !seenEvents.current.has(e.id));
    // The first batch is history, not news: adopt it silently, otherwise
    // opening the page replays every event ever recorded in one burst.
    const replay = primed.current;
    primed.current = true;
    for (const e of [...fresh].reverse()) {
      seenEvents.current.add(e.id);
      if (replay && e.from && e.to) sceneApi.current.pulse(e.from, e.to);
    }
  }, [events]);

  useEffect(() => {
    if (!mountRef.current) return;
    const api = buildScene(mountRef.current, (code) => setSelected(code));
    sceneApi.current = api;
    return () => { api.dispose(); sceneApi.current = null; };
  }, []);

  const current = useMemo(
    () => agents.find((a) => a.code === selected) ?? null,
    [agents, selected],
  );
  const live = agents.filter((a) => a.lifecycle === "live");
  const busy = live.filter((a) => a.state !== "idle" && a.state !== "offline");
  const recent = events.slice(0, 40);

  return (
    <div className="flex h-screen flex-col bg-[#fafafa] text-[#171717]">
      <header className="z-10 flex h-14 shrink-0 items-center gap-6 border-b border-[#e5e5e5] bg-white px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[14px] font-semibold leading-none">عالم الوكلاء</h1>
          <span className="text-[11px] leading-none text-[#a3a3a3]">
            مرآة للنظام — من نشرتك الحقيقية
          </span>
        </div>

        <div className="flex items-center gap-5 text-[11px] leading-none text-[#737373] tabular-nums">
          <Stat label="مبني" value={`${live.length}/${agents.length}`} />
          <Rule />
          <Stat label="شغّال" value={busy.length} accent={busy.length > 0} />
          <Rule />
          <Stat label="مسارات" value={edges.length} />
        </div>

        <div className="flex flex-1 items-center justify-end gap-2">
          <select
            value={businessId}
            onChange={(e) => {
              setBusinessId(e.target.value);
              seenEvents.current.clear();
              primed.current = false;
              setSelected(null);
            }}
            className="h-8 rounded-[3px] border border-[#e5e5e5] bg-white px-2 text-[12px] leading-none text-[#171717] outline-none transition focus:border-[#171717]"
          >
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <a
            href="/desk"
            className="flex h-8 items-center rounded-[3px] bg-[#171717] px-3 text-[12px] font-medium leading-none text-white transition hover:bg-[#404040]"
          >
            لوحة التجربة
          </a>
        </div>
      </header>

      {storage && !storage.persistent && (
        <Banner tone="warn">التخزين بالذاكرة — الأحداث والمسارات بتنمسح مع كل نشر</Banner>
      )}
      {error && <Banner tone="error">{error}</Banner>}

      <div className="flex min-h-0 flex-1">
        <div ref={mountRef} className="relative flex-1">
          <div className="pointer-events-none absolute right-6 top-6">
            <p className="mb-3 text-[10px] font-medium leading-none tracking-[0.08em] text-[#a3a3a3]">
              الحالات
            </p>
            <ul className="space-y-2">
              {LEGEND.map((l) => (
                <li key={l.state} className="flex items-center gap-2 text-[11px] leading-none text-[#525252]">
                  <span
                    className="h-2 w-2 shrink-0 rounded-[1px]"
                    style={{ background: hex(STATE_COLOR[l.state]) }}
                  />
                  {l.label}
                </li>
              ))}
            </ul>
          </div>

          {agents.length > 0 && edges.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-12 flex justify-center px-6">
              <p className="pointer-events-auto max-w-md rounded-[3px] border border-[#e5e5e5] bg-white px-4 py-3 text-center text-[12px] leading-relaxed text-[#525252]">
                الوكلاء بمكاتبهم، بس ما في مسارات لسّا —{" "}
                <a className="font-medium text-[#171717] underline underline-offset-2" href="/desk">
                  افتح لوحة التجربة
                </a>{" "}
                واحكي معهم.
              </p>
            </div>
          )}

          <p className="pointer-events-none absolute bottom-6 right-6 text-[10px] leading-none text-[#a3a3a3]">
            اسحب لتدوير · عجلة للتقريب · اضغط على وكيل
          </p>
        </div>

        <aside className="flex w-80 shrink-0 flex-col border-r border-[#e5e5e5] bg-white">
          <section className="shrink-0 border-b border-[#e5e5e5] p-6">
            <SectionLabel>الوكيل المحدّد</SectionLabel>
            {current ? (
              <>
                <div className="mt-3 flex items-baseline gap-2">
                  <h2 className="text-[13px] font-semibold leading-none">{current.name}</h2>
                  <span
                    className="text-[11px] leading-none"
                    style={{ color: hex(STATE_COLOR[current.state] ?? 0x8a8a8a) }}
                  >
                    {STATE_AR[current.state] ?? current.state}
                  </span>
                </div>
                <p className="mt-2 text-[11px] leading-[1.6] text-[#737373]">{current.role}</p>

                <dl className="mt-4 space-y-2 text-[11px] leading-none">
                  <Row label="المكتب" value={ZONE_AR[current.zone] ?? current.zone} />
                  <Row
                    label="الحالة"
                    value={current.lifecycle === "live" ? "كوده مكتوب" : "تصميم — ما انبنى"}
                  />
                </dl>

                {current.capabilities.length > 0 && (
                  <>
                    <SectionLabel className="mt-6">بيقدر يعمل</SectionLabel>
                    <ul className="mt-3 space-y-1.5 text-[11px] leading-[1.6] text-[#525252]">
                      {current.capabilities.map((c) => <li key={c}>{c}</li>)}
                    </ul>
                  </>
                )}
                {current.permissions.length > 0 && (
                  <>
                    <SectionLabel className="mt-6">صلاحياته</SectionLabel>
                    <p className="mt-3 text-[11px] leading-[1.6] text-[#525252]">
                      {current.permissions.join(" · ")}
                    </p>
                  </>
                )}
              </>
            ) : (
              <p className="mt-3 text-[11px] leading-[1.6] text-[#a3a3a3]">
                اضغط على وكيل بالعالم لتشوف تفاصيله.
              </p>
            )}
          </section>

          <section className="flex min-h-0 flex-1 flex-col p-6">
            <SectionLabel>الأحداث</SectionLabel>
            {recent.length === 0 ? (
              <p className="mt-3 text-[11px] leading-[1.6] text-[#a3a3a3]">
                ما في أحداث بعد. احكي مع الوكيل من لوحة التجربة وارجع لهون.
              </p>
            ) : (
              <ul className="scroll-area -mr-3 mt-3 flex-1 overflow-y-auto pr-3">
                {recent.map((e) => (
                  <li key={e.id} className="border-b border-[#f5f5f5] py-3 first:pt-0 last:border-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[10px] leading-none text-[#a3a3a3] tabular-nums" dir="ltr">
                        {new Date(e.createdAt).toLocaleTimeString("en-GB")}
                      </span>
                      {e.from && e.to && (
                        <span className="truncate text-[10px] leading-none text-[#737373]" dir="ltr">
                          {e.from} → {e.to}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-[11px] leading-[1.6] text-[#404040]">{e.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ── chrome primitives ────────────────────────────────────────────────
   Every measurement here is on a 4px grid and every size comes from one
   type scale. Spacing invented per element is what makes an interface look
   assembled rather than designed. */

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[#a3a3a3]">{label}</span>
      <b className={"font-medium " + (accent ? "text-[#2563eb]" : "text-[#171717]")}>{value}</b>
    </span>
  );
}

function Rule() {
  return <span className="h-3 w-px bg-[#e5e5e5]" />;
}

function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-[10px] font-medium leading-none tracking-[0.08em] text-[#a3a3a3] ${className}`}>
      {children}
    </p>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-14 shrink-0 text-[#a3a3a3]">{label}</dt>
      <dd className="text-[#404040]">{value}</dd>
    </div>
  );
}

function Banner({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  const skin = tone === "warn"
    ? "border-[#fde68a] bg-[#fffbeb] text-[#92400e]"
    : "border-[#fecaca] bg-[#fef2f2] text-[#991b1b]";
  return (
    <div className={`z-10 shrink-0 border-b px-6 py-2 text-center text-[11px] leading-none ${skin}`}>
      {children}
    </div>
  );
}

/* ══ the campus ══════════════════════════════════════════════════════
   Built to the reference the client supplied: a light, airy miniature
   campus rather than a grey model. Each function of the system is a
   pavilion; each agent is a glossy dark orb held in a lit halo on a
   pedestal, which is what reads as a presence without being a person or a
   machine; and the connections are lit paths with data visibly running
   along them. Everything shown still comes from what the pipeline wrote. */

type SceneApi = {
  setAgents: (agents: Agent[]) => void;
  setEdges: (edges: Edge[]) => void;
  pulse: (from: string, to: string) => void;
  focus: (code: string | null) => void;
  dispose: () => void;
};

/** Zones whose meaning is a warning carry it in the architecture. */
const ZONE_ACCENT: Record<string, number> = {
  escalation: 0xff4d4d,
  business: 0xf59e0b,
};

const CORNER = 0.05;
const boxCache = new Map<string, THREE.BufferGeometry>();
const cachedGeometries = new Set<THREE.BufferGeometry>();
let maxAnisotropy = 1;

function roundedBox(w: number, h: number, d: number, r = CORNER): THREE.BufferGeometry {
  const rad = Math.min(r, w / 2, h / 2, d / 2);
  const q = (n: number) => Math.round(n * 100) / 100;
  const key = `${q(w)}|${q(h)}|${q(d)}|${q(rad)}`;
  let g = boxCache.get(key);
  if (!g) {
    // segments must be >= 1: at 0 the constructor returns before the requested
    // dimensions are applied and hands back a unit cube.
    g = new RoundedBoxGeometry(w, h, d, 1, rad);
    boxCache.set(key, g);
    cachedGeometries.add(g);
  }
  return g;
}

function surface(
  color: number,
  opts: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.82, metalness: 0, envMapIntensity: 0.7, ...opts,
  });
}

/** Built at true size so the fillet is never sheared by a mesh scale. */
function block(
  parent: THREE.Object3D, material: THREE.Material,
  x: number, y: number, z: number, w: number, h: number, d: number,
  shadow = true, radius = CORNER,
): THREE.Mesh {
  const mesh = new THREE.Mesh(roundedBox(w, h, d, radius), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildScene(mount: HTMLElement, onPick: (code: string) => void): SceneApi {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setClearColor(P.sky, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Neutral, not ACES: on a deliberately pale scene ACES brightens by 67%
  // before its curve begins and pushes every highlight orange.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  mount.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  scene.background = coveTexture();

  /* ── light: a large soft key, a cool fill, an environment for the gloss ── */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.85;
  pmrem.dispose();

  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  const KEY_OFFSET = new THREE.Vector3(-22, 34, 18);
  key.position.copy(KEY_OFFSET);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -16; key.shadow.camera.right = 16;
  key.shadow.camera.top = 16; key.shadow.camera.bottom = -16;
  key.shadow.camera.near = 18; key.shadow.camera.far = 84;
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.014;
  // Shadows that describe form without becoming holes.
  key.shadow.intensity = 0.52;
  scene.add(key);
  scene.add(key.target);
  scene.add(new THREE.HemisphereLight(0xeaf2ff, 0xd5dee9, 0.55));
  const fill = new THREE.DirectionalLight(0xd9e8ff, 0.45);
  fill.position.set(20, 12, -16);
  scene.add(fill);

  const mats = {
    plaza: surface(P.plaza, { roughness: 0.9 }),
    plazaEdge: surface(P.plazaEdge, { roughness: 0.9 }),
    slab: surface(P.slab, { roughness: 0.78 }),
    slabSide: surface(P.slabSide, { roughness: 0.85 }),
    wall: surface(P.wall, { roughness: 0.8 }),
    glass: new THREE.MeshStandardMaterial({
      color: P.glass, roughness: 0.08, metalness: 0.1,
      transparent: true, opacity: 0.4, envMapIntensity: 1.6,
    }),
    board: surface(P.board, { roughness: 0.5 }),
    metal: surface(P.metal, { roughness: 0.3, metalness: 0.7 }),
    desk: surface(P.desk, { roughness: 0.7 }),
    screen: surface(P.screen, { roughness: 0.22, envMapIntensity: 1.2 }),
    trunk: surface(P.trunk, { roughness: 0.9 }),
    leaf: surface(P.leaf, { roughness: 0.75 }),
    leafDark: surface(P.leafDark, { roughness: 0.78 }),
    planter: surface(P.planter, { roughness: 0.85 }),
    customer: surface(P.customer, { roughness: 0.6 }),
  };

  const signs: THREE.Group[] = [];
  const picks: THREE.Object3D[] = [];
  const contactMap = contactTexture();

  /* ── the plaza ─────────────────────────────────────────────────────── */
  const plaza = new THREE.Mesh(roundedBox(26, 0.5, 28, 0.3), mats.plaza);
  plaza.position.set(0, -0.25, 3);
  plaza.receiveShadow = true;
  scene.add(plaza);

  const plazaEdge = new THREE.Mesh(roundedBox(27, 0.28, 29, 0.3), mats.plazaEdge);
  plazaEdge.position.set(0, -0.62, 3);
  plazaEdge.receiveShadow = true;
  scene.add(plazaEdge);

  const groundShade = new THREE.Mesh(
    new THREE.PlaneGeometry(52, 54),
    new THREE.MeshBasicMaterial({
      color: 0x9aa8bd, alphaMap: contactMap, transparent: true,
      opacity: 0.3, depthWrite: false,
    }),
  );
  groundShade.rotation.x = -Math.PI / 2;
  groundShade.position.set(0, -0.78, 3);
  scene.add(groundShade);

  /* ── pavilions ─────────────────────────────────────────────────────── */
  const PAV = 5.6;
  const half = PAV / 2;
  const TOP = 0.28;
  const leafGeo = new THREE.IcosahedronGeometry(0.42, 1);
  const leafGeoS = new THREE.IcosahedronGeometry(0.3, 1);

  function tree(parent: THREE.Object3D, x: number, z: number, scale = 1) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.scale.setScalar(scale);
    const pot = new THREE.Mesh(roundedBox(0.52, 0.34, 0.52, 0.06), mats.planter);
    pot.position.y = TOP + 0.17;
    pot.castShadow = true;
    g.add(pot);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 0.5, 8), mats.trunk,
    );
    trunk.position.y = TOP + 0.58;
    g.add(trunk);
    for (const [ox, oy, oz, geo, m] of [
      [0, 1.02, 0, leafGeo, mats.leaf],
      [-0.2, 1.28, 0.12, leafGeoS, mats.leafDark],
      [0.18, 1.32, -0.1, leafGeoS, mats.leaf],
    ] as Array<[number, number, number, THREE.BufferGeometry, THREE.Material]>) {
      const l = new THREE.Mesh(geo, m);
      l.position.set(ox, TOP + oy, oz);
      l.castShadow = true;
      g.add(l);
    }
    parent.add(g);
  }

  Object.entries(ZONE_POS).forEach(([zone, [x, z]], index) => {
    const pav = new THREE.Group();
    pav.position.set(x, 0, z);
    scene.add(pav);

    // A raised white slab with a visible side, so it reads as a platform a
    // building sits on rather than as paint on the plaza.
    block(pav, mats.slabSide, 0, 0.12, 0, PAV, 0.24, PAV, false, 0.1);
    block(pav, mats.slab, 0, 0.26, 0, PAV - 0.3, 0.06, PAV - 0.3, false, 0.08);

    // An L of low walls with a glass panel, which is what gives each pavilion
    // an interior without closing it off from an overhead view.
    const t = 0.14, wallH = 0.72, wallY = TOP + wallH / 2;
    block(pav, mats.wall, 0, wallY, -half + 0.08, PAV, wallH, t);
    block(pav, mats.wall, -half + 0.08, wallY, 0, t, wallH, PAV);
    const glass = new THREE.Mesh(
      roundedBox(PAV - 1.4, 0.62, 0.05, 0.02), mats.glass,
    );
    glass.position.set(0.3, TOP + 1.12, -half + 0.08);
    pav.add(glass);

    // The sign is the pavilion's face: a large dark board on two posts,
    // standing clear of the walls so it is legible from any angle.
    const sign = signBoard(ZONE_AR[zone] ?? zone, ZONE_ACCENT[zone]);
    sign.position.set(-half + 1.0, 0, half - 0.45);
    pav.add(sign);
    signs.push(sign);

    // desk and screen
    const dz = -1.8;
    block(pav, mats.desk, -0.9, TOP + 0.5, dz, 1.9, 0.08, 0.8);
    block(pav, mats.metal, -1.7, TOP + 0.25, dz, 0.06, 0.44, 0.7);
    block(pav, mats.metal, -0.1, TOP + 0.25, dz, 0.06, 0.44, 0.7);
    const panel = block(pav, mats.screen, -0.9, TOP + 0.86, dz - 0.05, 0.9, 0.52, 0.04);
    panel.rotation.x = -0.08;

    tree(pav, half - 0.85, -half + 0.85, 0.95);
    if (index % 2 === 0) tree(pav, -half + 0.9, half - 1.1, 0.8);

    // A zone whose meaning is a warning says so in the floor, not in a label.
    const accent = ZONE_ACCENT[zone];
    if (accent) {
      const strip = new THREE.Mesh(
        new THREE.PlaneGeometry(PAV - 0.6, 0.1),
        new THREE.MeshBasicMaterial({ color: accent, toneMapped: false }),
      );
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(0, TOP + 0.031, half - 0.9);
      pav.add(strip);
      const wash = new THREE.Mesh(
        new THREE.PlaneGeometry(PAV * 1.5, PAV * 1.5),
        new THREE.MeshBasicMaterial({
          color: accent, alphaMap: contactMap, transparent: true,
          opacity: 0.16, depthWrite: false, toneMapped: false,
        }),
      );
      wash.rotation.x = -Math.PI / 2;
      wash.position.y = 0.26;
      pav.add(wash);
    }
  });

  /* ── the approach: where customers arrive ──────────────────────────── */
  const nodePos = new Map<string, THREE.Vector3>();
  for (const [id, meta] of Object.entries(EXTRA_NODES)) {
    const [x, z] = meta.pos;
    const pad = new THREE.Group();
    pad.position.set(x, 0, z);
    scene.add(pad);

    block(pad, mats.slabSide, 0, 0.12, 0, 2.6, 0.24, 2.6, false, 0.1);
    block(pad, mats.slab, 0, 0.26, 0, 2.3, 0.06, 2.3, false, 0.08);

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.3, 0.62, 24), mats.metal,
    );
    post.position.y = TOP + 0.31;
    post.castShadow = true;
    pad.add(post);

    const sign = signBoard(meta.label);
    sign.position.set(0, 0, 1.0);
    sign.scale.setScalar(0.8);
    pad.add(sign);
    signs.push(sign);

    nodePos.set(id, new THREE.Vector3(x, TOP + 0.9, z));
  }

  // Small dark figures around the entrance. These are the customers — the
  // only human shapes in the scene, and deliberately not the agents.
  for (const [cx, cz, rot] of [
    [-1.5, 13.4, 0.4], [-0.6, 14.1, -0.2], [1.4, 13.7, 2.4], [2.2, 14.6, 1.1],
  ] as Array<[number, number, number]>) {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = rot;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.34, 4, 12), mats.customer);
    body.position.y = 0.44;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), mats.customer);
    head.position.y = 0.84;
    head.castShadow = true;
    g.add(head);
    scene.add(g);
  }

  for (const [tx, tz] of [
    [-13, 12], [13, 12], [-13.5, -1], [13.5, -1], [-12, -8], [12, -8], [0, -10.5],
  ] as Array<[number, number]>) {
    tree(scene, tx, tz, 1.15);
  }

  /* ── agents ────────────────────────────────────────────────────────── */
  type Orb = {
    group: THREE.Group;
    core: THREE.Mesh;
    dome: THREE.Mesh;
    domeMat: THREE.MeshStandardMaterial;
    ring: THREE.Mesh;
    halo: THREE.Mesh;
    face: Face;
    label: Label;
    agent: Agent;
    phase: number;
  };
  const orbs = new Map<string, Orb>();

  const PEDESTAL = new THREE.CylinderGeometry(0.52, 0.64, 0.3, 36);
  const PED_RIM = new THREE.TorusGeometry(0.55, 0.035, 10, 48);
  const CORE_GEO = new THREE.SphereGeometry(0.52, 44, 32);
  // A crescent hood rather than a full shell, so the face is never covered.
  // phi is measured from -X in three.js, so +Z (the face) sits at 0.5π. The
  // shell therefore starts a little past the face and wraps the whole way
  // round, leaving a window centred on the front.
  const SHELL_GEO = new THREE.SphereGeometry(
    0.63, 44, 32, Math.PI * 0.92, Math.PI * 1.16, 0, Math.PI,
  );
  const RING_GEO = new THREE.TorusGeometry(0.88, 0.026, 10, 72);

  function makeOrb(agent: Agent): Orb {
    const group = new THREE.Group();

    const ped = new THREE.Mesh(PEDESTAL, mats.metal);
    ped.position.y = TOP + 0.15;
    ped.castShadow = true;
    ped.receiveShadow = true;
    ped.userData.code = agent.code;
    group.add(ped);
    picks.push(ped);

    const rim = new THREE.Mesh(
      PED_RIM,
      new THREE.MeshBasicMaterial({ color: 0x7c8aa3, toneMapped: false }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = TOP + 0.31;
    group.add(rim);

    // The dark glossy core. It is the only deep value in a pale scene, so the
    // eye finds every agent immediately.
    const core = new THREE.Mesh(
      CORE_GEO,
      new THREE.MeshStandardMaterial({
        color: P.orb, roughness: 0.05, metalness: 0.3, envMapIntensity: 2.4,
      }),
    );
    core.position.y = TOP + 1.05;
    core.castShadow = true;
    core.userData.code = agent.code;
    group.add(core);
    picks.push(core);

    const shell = new THREE.Mesh(
      SHELL_GEO,
      new THREE.MeshStandardMaterial({
        color: 0xf6f8fc, roughness: 0.12, metalness: 0.12,
        envMapIntensity: 1.8, side: THREE.DoubleSide,
      }),
    );
    shell.position.y = TOP + 1.05;
    shell.castShadow = true;
    group.add(shell);

    // The expression. This is what makes a pod read as an agent rather than
    // as an object, and it is the one part that changes with what it is doing.
    const face = makeFace();
    face.mesh.position.set(0, TOP + 1.06, 0.55);
    group.add(face.mesh);

    const ring = new THREE.Mesh(
      RING_GEO,
      new THREE.MeshBasicMaterial({
        color: 0x7c8aa3, transparent: true, opacity: 0.85, toneMapped: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2 + 0.22;
    ring.position.y = TOP + 1.02;
    group.add(ring);

    const domeMat = new THREE.MeshStandardMaterial({
      color: 0x7c8aa3, roughness: 0.1, metalness: 0,
      transparent: true, opacity: 0.12, envMapIntensity: 1.4,
      side: THREE.BackSide, depthWrite: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.92, 32, 24), domeMat);
    dome.position.y = TOP + 1.05;
    group.add(dome);

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1.12, 0.012, 8, 72),
      new THREE.MeshBasicMaterial({
        color: 0x7c8aa3, transparent: true, opacity: 0.5, toneMapped: false,
      }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = TOP + 0.33;
    group.add(halo);

    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({
        color: 0x8fa0bb, alphaMap: contactMap, transparent: true,
        opacity: 0.42, depthWrite: false,
      }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = TOP + 0.032;
    group.add(contact);

    const label = makeLabel(agent);
    group.add(label.sprite);

    scene.add(group);
    return {
      group, core, dome, domeMat, ring, halo, face, label, agent,
      phase: Math.random() * Math.PI * 2,
    };
  }

  function setAgents(agents: Agent[]) {
    const live = new Set(agents.map((a) => a.code));
    for (const [code, o] of Array.from(orbs.entries())) {
      if (live.has(code)) continue;
      scene.remove(o.group);
      o.group.traverse((n) => {
        const m = n as THREE.Mesh;
        const i = picks.indexOf(m);
        if (i >= 0) picks.splice(i, 1);
      });
      orbs.delete(code);
      nodePos.delete(code);
    }

    const byZone = new Map<string, Agent[]>();
    for (const a of agents) {
      const list = byZone.get(a.zone) ?? [];
      list.push(a);
      byZone.set(a.zone, list);
    }

    for (const [zone, list] of Array.from(byZone.entries())) {
      const [zx, zz] = ZONE_POS[zone] ?? [0, 0];
      list.forEach((agent, i) => {
        const offset = (i - (list.length - 1) / 2) * 1.5;
        const x = zx + offset;
        const z = zz + 1.0;

        let o = orbs.get(agent.code);
        if (!o) {
          o = makeOrb(agent);
          orbs.set(agent.code, o);
        }
        o.group.position.set(x, 0, z);
        nodePos.set(agent.code, new THREE.Vector3(x, TOP + 0.92, z));
        const planned = agent.lifecycle === "planned";
        if (o.agent.state !== agent.state || o.agent.lifecycle !== agent.lifecycle) {
          o.label.draw(agent);
          o.face.draw(agent.state, planned);
        }
        o.agent = agent;

        const color = STATE_COLOR[agent.state] ?? 0x7c8aa3;
        o.domeMat.color.setHex(color);
        o.domeMat.opacity = planned ? 0.05 : 0.12;
        (o.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
        (o.ring.material as THREE.MeshBasicMaterial).opacity = planned ? 0.3 : 0.85;
        (o.halo.material as THREE.MeshBasicMaterial).color.setHex(color);
        // A planned agent never glows like a working one, at any frame.
        (o.core.material as THREE.MeshStandardMaterial).color.setHex(
          planned ? 0x9fabbf : P.orb,
        );
      });
    }
  }

  /* ── paths, drawn from real traffic ────────────────────────────────── */
  const edgeGroup = new THREE.Group();
  scene.add(edgeGroup);
  let edgeKey = "";

  function curveBetween(a: THREE.Vector3, b: THREE.Vector3) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += Math.max(1.1, a.distanceTo(b) * 0.16);
    return new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
  }

  function setEdges(list: Edge[]) {
    const k = list.map((e) => `${e.from}>${e.to}:${e.count}`).sort().join("|");
    if (k === edgeKey) return;

    for (const child of [...edgeGroup.children]) {
      edgeGroup.remove(child);
      const m = child as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }

    const heaviest = list.reduce((max, e) => Math.max(max, e.count), 1);
    let complete = true;
    for (const e of list) {
      const a = nodePos.get(e.from);
      const b = nodePos.get(e.to);
      if (!a || !b) { complete = false; continue; }
      const weight = e.count / heaviest;
      // Lit rather than inked: on a pale plaza a dark line reads as a crack,
      // and light reads as something running.
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curveBetween(a, b), 56, 0.03 + weight * 0.028, 8, false),
        new THREE.MeshBasicMaterial({
          color: weight > 0.6 ? P.path : P.pathAlt,
          transparent: true, opacity: 0.55 + weight * 0.35,
          toneMapped: false,
        }),
      );
      edgeGroup.add(tube);
    }
    if (complete) edgeKey = k;
  }

  /* ── pulses ────────────────────────────────────────────────────────── */
  const PULSE_GEO = new THREE.SphereGeometry(0.15, 18, 14);
  const pulses: Array<{
    mesh: THREE.Mesh; trail: THREE.Mesh[];
    curve: THREE.QuadraticBezierCurve3; t: number;
  }> = [];

  function pulse(from: string, to: string) {
    const a = nodePos.get(from);
    const b = nodePos.get(to);
    if (!a || !b) return;

    const mesh = new THREE.Mesh(
      PULSE_GEO,
      new THREE.MeshBasicMaterial({ color: P.path, toneMapped: false }),
    );
    scene.add(mesh);
    const trail: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Mesh(
        PULSE_GEO,
        new THREE.MeshBasicMaterial({
          color: P.path, transparent: true, opacity: 0, toneMapped: false,
        }),
      );
      sp.scale.setScalar(1 - (i + 1) / 7);
      scene.add(sp);
      trail.push(sp);
    }
    pulses.push({ mesh, trail, curve: curveBetween(a, b), t: 0 });
  }

  /* ── camera ────────────────────────────────────────────────────────── */
  const NEED_W = 30;
  const NEED_H = 21;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
  const orb = { a: Math.PI * 0.25, p: 0.84, zoom: 1, drag: false, lx: 0, ly: 0 };
  const want = { a: orb.a, p: orb.p, zoom: 1 };
  const lookAt = new THREE.Vector3(0, 0, 3);
  const lookWant = new THREE.Vector3(0, 0, 3);
  let focused: string | null = null;
  const DIST = 90;

  function focus(code: string | null) {
    focused = code;
    const p = code ? nodePos.get(code) : null;
    if (p) { lookWant.set(p.x, 0, p.z); want.zoom = 2.2; }
    else { lookWant.set(0, 0, 3); want.zoom = 1; }
  }

  function place() {
    // The elevation is held in a narrow band: this is always read from above.
    const p = Math.max(0.5, Math.min(1.0, orb.p));
    camera.position.set(
      lookAt.x + Math.cos(orb.a) * Math.sin(p) * DIST,
      Math.cos(p) * DIST,
      lookAt.z + Math.sin(orb.a) * Math.sin(p) * DIST,
    );
    camera.lookAt(lookAt);
    key.position.copy(lookAt).add(KEY_OFFSET);
    key.target.position.copy(lookAt);
    key.target.updateMatrixWorld();
  }

  const el = renderer.domElement;
  let downAt = { x: 0, y: 0 };
  const onDown = (e: PointerEvent) => {
    orb.drag = true;
    orb.lx = e.clientX; orb.ly = e.clientY;
    downAt = { x: e.clientX, y: e.clientY };
    el.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!orb.drag) return;
    want.a -= (e.clientX - orb.lx) * 0.005;
    want.p = Math.max(0.5, Math.min(1.0, want.p - (e.clientY - orb.ly) * 0.003));
    orb.lx = e.clientX; orb.ly = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    if (!orb.drag) return;
    orb.drag = false;
    try { el.releasePointerCapture(e.pointerId); } catch { /* capture already gone */ }
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    want.zoom = Math.max(0.65, Math.min(3.2, want.zoom * (1 - e.deltaY * 0.0012)));
  };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const onClick = (e: MouseEvent) => {
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
    const rect = el.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(picks, false)[0];
    const code = hit?.object.userData.code as string | undefined;
    if (code) onPick(code);
  };
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("click", onClick);

  /* ── post: ambient occlusion is what stops each pavilion reading as a
        decal printed on the plaza ─────────────────────────────────────── */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.updateGtaoMaterial({
    radius: 0.3, distanceExponent: 1.2, thickness: 0.4,
    scale: 1.1, samples: 16, screenSpaceRadius: false,
  });
  gtao.blendIntensity = 0.8;
  composer.addPass(gtao);
  composer.addPass(new OutputPass());

  function resize() {
    const w = mount.clientWidth || 1;
    const h = mount.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    gtao.setSize(w, h);
    const aspect = w / h;
    // Fit both axes: fixing only the vertical extent clips the campus
    // horizontally on any viewport narrower than its own aspect.
    const f = Math.max(NEED_H, NEED_W / aspect) * 1.06;
    camera.left = (-f * aspect) / 2;
    camera.right = (f * aspect) / 2;
    camera.top = f / 2;
    camera.bottom = -f / 2;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(mount);
  resize();

  /* ── frame ─────────────────────────────────────────────────────────── */
  const clock = new THREE.Clock();
  let raf = 0;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ease = (from: number, to: number, k: number) => from + (to - from) * k;
  const camDir = new THREE.Vector3();

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.getElapsedTime();
    const k = Math.min(1, dt * 4.5);

    orb.a = ease(orb.a, want.a, k);
    orb.p = ease(orb.p, want.p, k);
    orb.zoom = ease(orb.zoom, want.zoom, k);
    lookAt.lerp(lookWant, k);
    if (Math.abs(camera.zoom - orb.zoom) > 0.0005) {
      camera.zoom = orb.zoom;
      camera.updateProjectionMatrix();
    }
    place();

    // Signs turn about Y only, so they stay upright and legible as the campus
    // rotates without ever tipping toward the camera.
    camera.getWorldDirection(camDir);
    const faceY = Math.atan2(-camDir.x, -camDir.z);
    for (const sgn of signs) sgn.rotation.y = faceY - (sgn.parent?.rotation.y ?? 0);

    orbs.forEach((o, code) => {
      const planned = o.agent.lifecycle === "planned";
      const active = !planned
        && o.agent.state !== "idle" && o.agent.state !== "offline";
      const sel = code === focused;

      const lift = reduced ? 0 : Math.sin(t * (active ? 1.9 : 0.8) + o.phase)
        * (active ? 0.07 : 0.03);
      // The whole pod turns to face the viewer: an expression nobody can see
      // is not an expression.
      o.group.rotation.y = faceY;
      o.group.position.y = lift;
      o.ring.rotation.z += dt * (active ? 0.9 : 0.25);

      const beat = active ? Math.abs(Math.sin(t * 2.2 + o.phase)) : 0;
      o.domeMat.opacity = (planned ? 0.07 : 0.16) + beat * 0.16 + (sel ? 0.1 : 0);
      const hm = o.halo.material as THREE.MeshBasicMaterial;
      hm.opacity = (planned ? 0.18 : 0.42) + beat * 0.4 + (sel ? 0.25 : 0);
      o.halo.scale.setScalar(1 + beat * 0.12 + (sel ? 0.08 : 0));
      o.ring.scale.setScalar(1 + beat * 0.06);

      o.label.sprite.visible = sel || active;
    });

    for (let i = pulses.length - 1; i >= 0; i--) {
      const pu = pulses[i];
      pu.t += dt * 0.68;
      if (pu.t >= 1) {
        for (const m of [pu.mesh, ...pu.trail]) {
          scene.remove(m);
          (m.material as THREE.Material).dispose();
        }
        pu.mesh.geometry.dispose();
        pulses.splice(i, 1);
        continue;
      }
      const at = pu.curve.getPoint(pu.t);
      pu.mesh.position.copy(at);
      const fade = Math.sin(pu.t * Math.PI);
      pu.trail.forEach((m, j) => {
        m.position.copy(pu.curve.getPoint(Math.max(0, pu.t - (j + 1) * 0.03)));
        (m.material as THREE.MeshBasicMaterial).opacity = fade * 0.55 * (1 - (j + 1) / 7);
      });
    }

    composer.render();
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    setAgents,
    setEdges,
    pulse,
    focus,
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("click", onClick);
      composer.dispose();
      envRT.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        // The size cache is module-level and shared with the next mount.
        if (m.geometry && !cachedGeometries.has(m.geometry)) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      if (el.parentElement === mount) mount.removeChild(el);
    },
  };
}

/* ── pieces ──────────────────────────────────────────────────────────── */

/** A large dark board on two posts — the pavilion's face. */
function signBoard(text: string, accent?: number): THREE.Group {
  const group = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({
    color: P.board, roughness: 0.5, metalness: 0.1,
  });
  for (const ox of [-0.54, 0.54]) {
    const post = new THREE.Mesh(roundedBox(0.055, 0.96, 0.055, 0.025), postMat);
    post.position.set(ox, 0.48, 0);
    post.castShadow = true;
    group.add(post);
  }

  const canvas = document.createElement("canvas");
  canvas.width = 440;
  canvas.height = 150;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#272c38";
    roundRect(ctx, 0, 0, canvas.width, canvas.height, 22);
    ctx.fill();
    if (accent !== undefined) {
      ctx.fillStyle = "#" + accent.toString(16).padStart(6, "0");
      roundRect(ctx, 22, canvas.height - 20, canvas.width - 44, 8, 4);
      ctx.fill();
    }
    ctx.direction = "rtl";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '600 62px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = "#f4f7fc";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 - 4, canvas.width - 44);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  // Unlit: a billboard turns its normal to the camera, so a lit board's
  // brightness would swing by more than half as the campus rotates.
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(1.34, 0.46),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }),
  );
  board.position.y = 1.18;
  group.add(board);
  return group;
}

type Face = { mesh: THREE.Mesh; draw: (state: string, planned: boolean) => void };

/**
 * The agent's expression, drawn as an LED on its glass face.
 *
 * This is the whole reason a pod reads as an agent and not as an object: a
 * thing with an expression is attending to you. The expression is not
 * decorative either — it is the state, so what the agent is doing can be read
 * from the agent itself rather than from a legend somewhere else.
 */
function makeFace(): Face {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 192;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.78, 0.58),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, toneMapped: false, depthWrite: false,
    }),
  );

  const draw = (state: string, planned: boolean) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // An LED is bright or it is off — it is never a muted state swatch. The
    // default is the reference's blue and only a meaningful state changes it,
    // which is why the expression reads at this size when a tinted state
    // colour did not.
    const LED: Record<string, number> = {
      idle: 0x3d8bfd, working: 0x3d8bfd, using_tool: 0x9b8bff,
      processing: 0x9b8bff, waiting: 0xffb02e,
      escalated: 0xff5a5a, error: 0xff5a5a, deploying: 0x2ee6b0,
      offline: 0x5a6472,
    };
    const lit = planned ? "#59626f" : hex(LED[state] ?? 0x3d8bfd);
    ctx.strokeStyle = lit;
    ctx.fillStyle = lit;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = lit;
    ctx.shadowBlur = planned ? 8 : 34;

    const cx = 128, cy = 96, eye = 40;
    const kind = planned || state === "offline" ? "offline"
      : state === "escalated" || state === "error" ? "alert"
        : state === "working" || state === "using_tool" ? "working"
          : state === "processing" ? "thinking"
            : state === "waiting" ? "waiting"
              : state === "deploying" ? "success"
                : "friendly";

    if (kind === "alert") {
      // A warning reads as a shape, not as a colour alone.
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 46);
      ctx.lineTo(cx + 50, cy + 40);
      ctx.lineTo(cx - 50, cy + 40);
      ctx.closePath();
      ctx.stroke();
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 14);
      ctx.lineTo(cx, cy + 12);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy + 28, 6, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === "offline") {
      ctx.lineWidth = 12;
      for (const ox of [-eye, eye]) {
        ctx.beginPath();
        ctx.moveTo(cx + ox - 20, cy);
        ctx.lineTo(cx + ox + 20, cy);
        ctx.stroke();
      }
    } else if (kind === "working") {
      ctx.lineWidth = 13;
      for (const [ox, dir] of [[-eye, 1], [eye, -1]] as Array<[number, number]>) {
        ctx.beginPath();
        ctx.moveTo(cx + ox - 16 * dir, cy - 20);
        ctx.lineTo(cx + ox + 14 * dir, cy);
        ctx.lineTo(cx + ox - 16 * dir, cy + 20);
        ctx.stroke();
      }
    } else if (kind === "thinking") {
      ctx.lineWidth = 12;
      for (const ox of [-eye, eye]) {
        ctx.beginPath();
        ctx.arc(cx + ox, cy, 17, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx, cy - 16);
      ctx.lineTo(cx, cy + 16);
      ctx.stroke();
    } else if (kind === "waiting") {
      for (const ox of [-34, 0, 34]) {
        ctx.beginPath();
        ctx.arc(cx + ox, cy, 9, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // friendly and success: closed, upward-curving eyes
      ctx.lineWidth = 14;
      for (const ox of [-eye, eye]) {
        ctx.beginPath();
        ctx.arc(cx + ox, cy + 12, 24, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
      if (kind === "success") {
        ctx.lineWidth = 11;
        ctx.beginPath();
        ctx.arc(cx, cy + 34, 22, Math.PI * 0.18, Math.PI * 0.82);
        ctx.stroke();
      }
    }

    tex.needsUpdate = true;
  };
  draw("idle", false);
  return { mesh, draw };
}

type Label = { sprite: THREE.Sprite; draw: (agent: Agent) => void };

/** The agent's name and state, on a small card above its orb. */
function makeLabel(agent: Agent): Label {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 116;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex, transparent: true, toneMapped: false,
    }),
  );
  sprite.scale.set(2.1, 0.64, 1);
  sprite.position.y = 2.6;
  sprite.renderOrder = 20;
  // Shown only when the agent is selected or doing something: a name card
  // over every pod at once is noise, and the reference keeps them off too.
  sprite.visible = false;

  const draw = (a: Agent) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.direction = "rtl";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const color = hex(STATE_COLOR[a.state] ?? 0x7c8aa3);
    ctx.save();
    ctx.shadowColor = "rgba(40,60,100,0.22)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, 12, 12, canvas.width - 24, 80, 18);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(canvas.width - 40, 52, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '600 32px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = "#1b2233";
    ctx.fillText(a.name, canvas.width / 2 - 14, 40, canvas.width - 90);
    ctx.font = '500 23px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(STATE_AR[a.state] ?? a.state, canvas.width / 2 - 14, 72, canvas.width - 90);

    tex.needsUpdate = true;
  };
  draw(agent);
  return { sprite, draw };
}

let _contactMap: THREE.CanvasTexture | null = null;
/** A soft radial falloff for every pool of shade in the scene. */
function contactTexture(): THREE.CanvasTexture {
  if (_contactMap) return _contactMap;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, "rgba(0,0,0,1)");
    grd.addColorStop(0.45, "rgba(0,0,0,0.55)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  // Used as an alpha map, so it stays linear — no colour space on this one.
  _contactMap = new THREE.CanvasTexture(c);
  return _contactMap;
}

let _glow: THREE.CanvasTexture | null = null;
/** A soft radial sprite, shared by every halo and every pulse. */
function glowTexture(): THREE.CanvasTexture {
  if (_glow) return _glow;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.2, "rgba(255,255,255,0.5)");
    grd.addColorStop(0.5, "rgba(255,255,255,0.12)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
  }
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}

/** A studio cove: light above, settling into the plaza's own tone. */
function coveTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, "#fbfcfe");
    grd.addColorStop(0.5, "#eef2f9");
    grd.addColorStop(1, "#dde5f1");
    g.fillStyle = grd;
    g.fillRect(0, 0, 4, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
