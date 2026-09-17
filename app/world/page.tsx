"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

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
  idle: 0x9bb0c9, working: 0x2f6df0, processing: 0x2f6df0, waiting: 0xe8993a,
  using_tool: 0x8257e6, escalated: 0xd94a3d, error: 0xd94a3d,
  offline: 0xc9c2b6, deploying: 0x16a36a,
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
const P = {
  ground: 0xccb99c,
  floor: 0xfbf8f1,
  rug: 0xe3d8c4,
  rim: 0xb09a79,
  wall: 0xe7ddcb,
  oak: 0xc08b5c,
  oakDark: 0x9c6b3a,
  charcoal: 0x38342e,
  screen: 0x33465c,
  plant: 0x6b9e78,
  plantDark: 0x4e7b5b,
  ink: 0x6b5a45,
};

/**
 * The floorplan. Rooms sit on a 9.5-unit grid with reception at the heart and
 * the customer arriving from the front, so the layout itself reads as the path
 * a message takes.
 */
const ZONE_POS: Record<string, [number, number]> = {
  reception: [0, 3.5],
  knowledge: [-8.4, 3.5], booking: [8.4, 3.5],
  tools: [-8.4, 11.9], supervision: [8.4, 11.9],
  escalation: [0, -4.9],
  workshop: [-8.4, -4.9], business: [8.4, -4.9],
};

/** Endpoints that are not rooms: the doorway the customer arrives through. */
const EXTRA_NODES: Record<string, { label: string; pos: [number, number]; color: number }> = {
  customer: { label: "الزبون", pos: [0, 16], color: 0x16a36a },
  "channel-web": { label: "المتصفح", pos: [-3.4, 12.2], color: 0x8257e6 },
  "channel-voice": { label: "الصوت", pos: [3.4, 12.2], color: 0x6b7a8f },
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
    <div className="flex h-screen flex-col bg-[#efe8dc]">
      <header className="z-10 flex flex-wrap items-center gap-3 border-b border-[#ddd2be] bg-[#f7f2e9] px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#38342e] text-lg">🏛️</div>
        <div className="flex-1">
          <h1 className="text-base font-bold leading-tight text-[#38342e]">عالم الوكلاء</h1>
          <p className="text-[11px] text-[#8d8271]">
            نموذج مصغّر لشركتك — الحالات والمسارات والحركة كلها من نشرتك الحقيقية
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-[#5c554a]">
          <span className="rounded-full border border-[#ddd2be] bg-white/70 px-3 py-1.5">
            🧩 مبني <b className="font-mono">{live.length}</b>
            <span className="text-[#a89d8b]">/{agents.length}</span>
          </span>
          <span className="rounded-full border border-[#ddd2be] bg-white/70 px-3 py-1.5">
            ⚡️ شغّال الآن <b className="font-mono">{busy.length}</b>
          </span>
          <span className="rounded-full border border-[#ddd2be] bg-white/70 px-3 py-1.5">
            🔗 مسارات <b className="font-mono">{edges.length}</b>
          </span>
        </div>

        <select
          value={businessId}
          onChange={(e) => {
            setBusinessId(e.target.value);
            seenEvents.current.clear();
            primed.current = false;
            setSelected(null);
          }}
          className="rounded-xl border border-[#ddd2be] bg-white px-3 py-2 text-sm text-[#38342e] outline-none focus:border-[#c08b5c]"
        >
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <a
          href="/desk"
          className="rounded-xl bg-[#38342e] px-4 py-2 text-sm font-semibold text-[#f7f2e9] transition hover:bg-[#4a453d]"
        >
          احكي معهم ←
        </a>
      </header>

      {storage && !storage.persistent && (
        <div className="z-10 border-b border-amber-300/60 bg-amber-100/70 px-4 py-1.5 text-center text-[11px] text-amber-900">
          🗄️ التخزين بالذاكرة — الأحداث والمسارات بتنمسح مع كل نشر.
        </div>
      )}
      {error && (
        <div className="z-10 border-b border-red-300/60 bg-red-100/70 px-4 py-1.5 text-center text-[11px] text-red-800">
          ⚠️ {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div ref={mountRef} className="relative flex-1">
          <div
            className="pointer-events-none absolute inset-0"
            style={{ boxShadow: "inset 0 0 160px 50px rgba(120,104,80,0.16)" }}
          />

          <div className="pointer-events-none absolute right-4 top-4 rounded-2xl border border-[#ddd2be] bg-white/85 p-3 shadow-sm backdrop-blur-sm">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#a89d8b]">
              الألوان
            </p>
            <ul className="space-y-1">
              {LEGEND.map((l) => (
                <li key={l.state} className="flex items-center gap-2 text-[11px] text-[#5c554a]">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: hex(STATE_COLOR[l.state]) }}
                  />
                  {l.label}
                </li>
              ))}
            </ul>
          </div>

          {agents.length > 0 && edges.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center px-4">
              <p className="pointer-events-auto rounded-2xl border border-[#ddd2be] bg-white/90 px-5 py-3 text-center text-xs text-[#5c554a] shadow-sm backdrop-blur-sm">
                الوكلاء بمكاتبهم، بس ما في مسارات لسّا.
                <br />
                <a className="font-semibold text-[#a2713f] underline" href="/desk">افتح لوحة التجربة</a>{" "}
                واحكي معهم — كل رسالة بترسم مسار جديد هون.
              </p>
            </div>
          )}

          <p className="pointer-events-none absolute bottom-3 right-4 rounded-full border border-[#ddd2be] bg-white/85 px-3 py-1 text-[11px] text-[#8d8271] backdrop-blur-sm">
            اسحب لتدوير · عجلة الماوس للتقريب · اضغط على وكيل
          </p>
        </div>

        <aside className="flex w-[350px] shrink-0 flex-col overflow-hidden border-r border-[#ddd2be] bg-[#f7f2e9]">
          <section className="border-b border-[#ddd2be] p-4">
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#a89d8b]">
              الوكيل المحدّد
            </h2>
            {current ? (
              <>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-[#38342e]">{current.name}</h3>
                  <span
                    className="rounded-md border px-2 py-0.5 text-[10px] font-semibold"
                    style={{
                      color: hex(STATE_COLOR[current.state] ?? 0x9bb0c9),
                      borderColor: "currentColor",
                    }}
                  >
                    {STATE_AR[current.state] ?? current.state}
                  </span>
                </div>
                <p className="text-xs text-[#8d8271]">{current.role}</p>
                <dl className="mt-3 space-y-1.5 text-xs">
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-[#a89d8b]">المكتب</dt>
                    <dd className="text-[#5c554a]">{ZONE_AR[current.zone] ?? current.zone}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-[#a89d8b]">الحالة</dt>
                    <dd className="text-[#5c554a]">
                      {current.lifecycle === "live" ? "كوده مكتوب" : "تصميم — ما انبنى"}
                    </dd>
                  </div>
                </dl>
                {current.capabilities.length > 0 && (
                  <>
                    <h4 className="mt-3 text-[10px] font-semibold uppercase tracking-widest text-[#a89d8b]">
                      بيقدر يعمل
                    </h4>
                    <ul className="mt-1 space-y-0.5 text-xs text-[#5c554a]">
                      {current.capabilities.map((c) => <li key={c}>• {c}</li>)}
                    </ul>
                  </>
                )}
                {current.permissions.length > 0 && (
                  <>
                    <h4 className="mt-3 text-[10px] font-semibold uppercase tracking-widest text-[#a89d8b]">
                      صلاحياته
                    </h4>
                    <p className="mt-1 text-xs text-[#5c554a]">{current.permissions.join(" · ")}</p>
                  </>
                )}
              </>
            ) : (
              <p className="text-xs text-[#a89d8b]">اضغط على وكيل بالعالم لتشوف تفاصيله.</p>
            )}
          </section>

          <section className="flex min-h-0 flex-1 flex-col p-4">
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#a89d8b]">
              الأحداث — مباشرة
            </h2>
            {recent.length === 0 ? (
              <p className="text-xs text-[#a89d8b]">
                ما في أحداث بعد. افتح{" "}
                <a className="font-semibold text-[#a2713f] underline" href="/desk">لوحة التجربة</a>{" "}
                واحكي مع الوكيل — وارجع لهون تشوف الحركة.
              </p>
            ) : (
              <ul className="scroll-area -mr-2 flex-1 space-y-1.5 overflow-y-auto pr-2">
                {recent.map((e) => (
                  <li key={e.id} className="border-b border-[#e4dbcb] pb-1.5 text-xs last:border-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[10px] text-[#b5aa97]" dir="ltr">
                        {new Date(e.createdAt).toLocaleTimeString("en-GB")}
                      </span>
                      {e.from && e.to && (
                        <span className="font-mono text-[10px] text-[#a2713f]" dir="ltr">
                          {e.from} → {e.to}
                        </span>
                      )}
                    </div>
                    <div className="text-[#5c554a]">{e.summary}</div>
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

/* ══ the model ════════════════════════════════════════════════════════ */

type SceneApi = {
  setAgents: (agents: Agent[]) => void;
  setEdges: (edges: Edge[]) => void;
  pulse: (from: string, to: string) => void;
  focus: (code: string | null) => void;
  dispose: () => void;
};

/** One shared box; every piece of furniture is this, scaled. */
const BOX = new THREE.BoxGeometry(1, 1, 1);

function lambert(color: number, opts: { transparent?: boolean; opacity?: number } = {}) {
  return new THREE.MeshLambertMaterial({ color, ...opts });
}

/** A box placed by centre and size, so furniture reads as dimensions. */
function block(
  parent: THREE.Object3D, material: THREE.Material,
  x: number, y: number, z: number, w: number, h: number, d: number,
  shadow = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(BOX, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(w, h, d);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildScene(mount: HTMLElement, onPick: (code: string) => void): SceneApi {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setClearColor(0xefe8dc, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mount.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";

  const scene = new THREE.Scene();

  /**
   * Orthographic, not perspective. Parallel projection is what makes this read
   * as a model on a table rather than a game camera, and it keeps every room
   * the same size wherever it sits on the floor.
   */
  const FRUSTUM = 27;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);

  /* One warm key light at a fixed angle, so every shadow in the model falls
     the same way — the thing that most makes a set of boxes look built. */
  const key = new THREE.DirectionalLight(0xfff4e2, 1.75);
  /** Held relative to whatever the camera is framing, so the light direction —
      and every shadow with it — stays put as the view moves. */
  const KEY_OFFSET = new THREE.Vector3(-26, 38, 20);
  key.position.copy(KEY_OFFSET);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -34; key.shadow.camera.right = 34;
  key.shadow.camera.top = 34; key.shadow.camera.bottom = -34;
  key.shadow.camera.near = 1; key.shadow.camera.far = 120;
  key.shadow.bias = -0.0012;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  scene.add(key.target);
  // Cool sky against warm sand bounce: shadows go blue-grey, not black.
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0xd8c8ae, 0.68));
  scene.add(new THREE.AmbientLight(0xffffff, 0.15));

  // Scoped to this scene: a module-level list would outlive dispose() and the
  // frame loop would go on turning signs belonging to a torn-down world.
  const signs: THREE.Group[] = [];

  const mats = {
    ground: lambert(P.ground),
    floor: lambert(P.floor),
    rug: lambert(P.rug),
    rim: lambert(P.rim),
    wall: lambert(P.wall),
    oak: lambert(P.oak),
    oakDark: lambert(P.oakDark),
    charcoal: lambert(P.charcoal),
    screen: lambert(P.screen),
    plant: lambert(P.plant),
    plantDark: lambert(P.plantDark),
    shadow: new THREE.MeshBasicMaterial({
      color: 0x7a6c56, transparent: true, opacity: 0.16, depthWrite: false,
    }),
  };

  /* ── the plinth the whole model sits on ────────────────────────────── */
  const base = new THREE.Mesh(BOX, mats.ground);
  base.position.set(0, -0.45, 4);
  base.scale.set(26, 0.9, 28);
  base.receiveShadow = true;
  scene.add(base);

  const baseRim = new THREE.Mesh(BOX, mats.rim);
  baseRim.position.set(0, -0.94, 4);
  baseRim.scale.set(27, 0.38, 29);
  baseRim.receiveShadow = true;
  scene.add(baseRim);

  /* ── rooms ─────────────────────────────────────────────────────────── */
  const ROOM = 6.6;
  const half = ROOM / 2;
  const leafGeo = new THREE.IcosahedronGeometry(0.5, 0);
  const leafGeoSmall = new THREE.IcosahedronGeometry(0.32, 0);

  Object.entries(ZONE_POS).forEach(([zone, [x, z]], index) => {
    const room = new THREE.Group();
    room.position.set(x, 0, z);
    scene.add(room);

    block(room, mats.floor, 0, 0.09, 0, ROOM, 0.18, ROOM, false);
    // A rug under the desk. The previous pass put a quarter tile here, which
    // read as a rendering fault rather than a floor.
    block(room, mats.rug, -0.9, 0.185, -1.3, 3.9, 0.02, 2.9, false);

    // Low perimeter walls with a doorway toward reception. Kept under the
    // height of a figure so they never hide anyone at any camera angle.
    const t = 0.24, wallY = 0.43, wallH = 0.52;
    const gap = z > 4 ? "front" : z < -1 ? "back" : x < 0 ? "right" : "left";
    if (gap !== "back") block(room, mats.wall, 0, wallY, -half, ROOM, wallH, t);
    if (gap !== "front") block(room, mats.wall, 0, wallY, half, ROOM, wallH, t);
    if (gap !== "left") block(room, mats.wall, -half, wallY, 0, t, wallH, ROOM);
    if (gap !== "right") block(room, mats.wall, half, wallY, 0, t, wallH, ROOM);

    /* desk, screen, chair — the props that turn a platform into a place */
    const dx = -0.9, dz = -1.75;
    block(room, mats.oak, dx, 0.82, dz, 2.8, 0.13, 1.25);
    block(room, mats.oakDark, dx - 1.25, 0.46, dz, 0.15, 0.6, 1.15);
    block(room, mats.oakDark, dx + 1.25, 0.46, dz, 0.15, 0.6, 1.15);
    block(room, mats.charcoal, dx, 0.96, dz - 0.16, 0.46, 0.16, 0.36);
    block(room, mats.screen, dx, 1.4, dz - 0.16, 1.5, 0.84, 0.09);
    block(room, mats.charcoal, dx, 0.28, dz + 1.35, 0.62, 0.1, 0.62);
    block(room, mats.charcoal, dx, 0.64, dz + 1.64, 0.62, 0.72, 0.09);

    // Eight identical offices read as a tiling error, so each room places its
    // greenery in a different corner and every other one gets a cabinet.
    const corners: Array<[number, number]> = [
      [half - 1.0, -half + 1.0], [half - 1.0, half - 1.0],
      [-half + 1.0, half - 1.0], [half - 1.0, half - 1.6],
    ];
    const [px, pz] = corners[index % corners.length];
    block(room, mats.oakDark, px, 0.42, pz, 0.6, 0.64, 0.6);
    const leaf = new THREE.Mesh(leafGeo, mats.plant);
    leaf.position.set(px, 1.12, pz);
    leaf.castShadow = true;
    room.add(leaf);
    const leafB = new THREE.Mesh(leafGeoSmall, mats.plantDark);
    leafB.position.set(px - 0.22, 1.45, pz + 0.16);
    leafB.castShadow = true;
    room.add(leafB);

    if (index % 2 === 0) {
      block(room, mats.wall, -half + 0.85, 0.52, -half + 1.4, 1.2, 0.86, 0.7);
    }

    // A standing sign rather than floating text: it belongs to the room, and
    // billboards on Y only so it stays readable as the model turns.
    const sign = signPost(ZONE_AR[zone] ?? zone);
    sign.position.set(-half + 0.9, 0, half - 0.85);
    room.add(sign);
    signs.push(sign);
  });

  /* ── the doorway and its approach ──────────────────────────────────── */
  const nodePos = new Map<string, THREE.Vector3>();
  for (const [id, meta] of Object.entries(EXTRA_NODES)) {
    const [x, z] = meta.pos;
    const pad = new THREE.Group();
    pad.position.set(x, 0, z);
    scene.add(pad);

    block(pad, mats.floor, 0, 0.09, 0, 3.0, 0.18, 3.0, false);
    block(pad, mats.wall, 0, 0.3, 0, 1.9, 0.24, 1.9, false);
    const marker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.62, 1.0, 6),
      lambert(meta.color),
    );
    marker.position.y = 0.92;
    marker.castShadow = true;
    pad.add(marker);

    const sign = signPost(meta.label);
    sign.position.set(-1.1, 0, 1.0);
    sign.scale.setScalar(0.86);
    pad.add(sign);
    signs.push(sign);

    nodePos.set(id, new THREE.Vector3(x, 1.1, z));
  }

  /* ── agents ────────────────────────────────────────────────────────── */
  type Figure = {
    group: THREE.Group;
    skin: THREE.MeshLambertMaterial;
    ring: THREE.Mesh;
    base: THREE.Mesh;
    label: Label;
    agent: Agent;
    phase: number;
    facing: number;
  };
  const figures = new Map<string, Figure>();
  const picks: THREE.Object3D[] = [];
  const pulses: Array<{
    mesh: THREE.Mesh; shade: THREE.Mesh; trail: THREE.Mesh[];
    curve: THREE.QuadraticBezierCurve3; t: number;
  }> = [];
  const flashes: Array<{ mesh: THREE.Mesh; t: number }> = [];

  function setAgents(agents: Agent[]) {
    const byZone = new Map<string, Agent[]>();
    for (const a of agents) {
      const list = byZone.get(a.zone) ?? [];
      list.push(a);
      byZone.set(a.zone, list);
    }

    for (const [zone, list] of Array.from(byZone.entries())) {
      const [zx, zz] = ZONE_POS[zone] ?? [0, 0];
      list.forEach((agent, i) => {
        // Stand them in a short line facing the desk rather than a ring: a
        // row reads as people at work, a ring reads as a diagram.
        const spread = 1.75;
        const offset = (i - (list.length - 1) / 2) * spread;
        const x = zx + offset;
        const z = zz + 1.6;

        let fig = figures.get(agent.code);
        if (!fig) {
          fig = makeFigure(agent, picks);
          scene.add(fig.group);
          figures.set(agent.code, fig);
        }
        const changed =
          fig.agent.state !== agent.state || fig.agent.lifecycle !== agent.lifecycle;
        fig.agent = agent;
        fig.group.position.set(x, 0, z);
        nodePos.set(agent.code, new THREE.Vector3(x, 1.25, z));
        if (changed) fig.label.draw(agent);
        applyState(fig);
      });
    }
  }

  function applyState(fig: Figure) {
    const planned = fig.agent.lifecycle === "planned";
    const color = STATE_COLOR[fig.agent.state] ?? 0x9bb0c9;
    fig.skin.color.setHex(color);
    fig.skin.transparent = planned;
    fig.skin.opacity = planned ? 0.38 : 1;
    (fig.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
    const baseMat = fig.base.material as THREE.MeshBasicMaterial;
    baseMat.color.setHex(color);
    baseMat.opacity = planned ? 0.35 : 0.85;
    // A planned agent must never look busy, at any frame.
    fig.ring.visible = !planned && fig.agent.state !== "idle";
  }

  /* ── routes, drawn from real traffic ───────────────────────────────── */
  const edgeGroup = new THREE.Group();
  scene.add(edgeGroup);
  let edgeKey = "";

  function curveBetween(a: THREE.Vector3, b: THREE.Vector3): THREE.QuadraticBezierCurve3 {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += Math.max(2.1, a.distanceTo(b) * 0.24);
    return new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
  }

  function setEdges(edges: Edge[]) {
    const key = edges.map((e) => `${e.from}>${e.to}:${e.count}`).sort().join("|");
    if (key === edgeKey) return;

    for (const child of [...edgeGroup.children]) {
      edgeGroup.remove(child);
      const m = child as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }

    const heaviest = edges.reduce((max, e) => Math.max(max, e.count), 1);
    let complete = true;
    for (const e of edges) {
      const a = nodePos.get(e.from);
      const b = nodePos.get(e.to);
      if (!a || !b) {
        // An endpoint the roster has not placed yet. Draw the rest, but do not
        // cache this key, or the route would never be retried once it can be.
        complete = false;
        continue;
      }
      const weight = e.count / heaviest;
      // Ink on a plan: dark enough to be the graphic it is meant to be, and
      // neutral, so the agents keep the only colour on the board.
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curveBetween(a, b), 44, 0.04 + weight * 0.055, 7, false),
        new THREE.MeshBasicMaterial({
          color: P.ink, transparent: true, opacity: 0.5 + weight * 0.35,
        }),
      );
      edgeGroup.add(tube);
    }
    if (complete) edgeKey = key;
  }

  /* ── pulses ────────────────────────────────────────────────────────── */
  const PULSE_GEO = new THREE.SphereGeometry(0.26, 18, 14);
  const SHADE_GEO = new THREE.CircleGeometry(0.28, 22);
  const TRAIL = 4;

  function pulse(from: string, to: string) {
    const a = nodePos.get(from);
    const b = nodePos.get(to);
    if (!a || !b) return;

    const mesh = new THREE.Mesh(
      PULSE_GEO,
      new THREE.MeshBasicMaterial({ color: 0x2f6df0 }),
    );
    scene.add(mesh);

    // A shadow tracking along the floor beneath it. Small touch, and the one
    // that makes the pulse read as travelling *over* the model.
    const shade = new THREE.Mesh(SHADE_GEO, mats.shadow.clone());
    shade.rotation.x = -Math.PI / 2;
    scene.add(shade);

    const trail: THREE.Mesh[] = [];
    for (let i = 0; i < TRAIL; i++) {
      const t = new THREE.Mesh(
        PULSE_GEO,
        new THREE.MeshBasicMaterial({ color: 0x6d97f5, transparent: true, opacity: 0 }),
      );
      t.scale.setScalar(1 - (i + 1) / (TRAIL + 1.2));
      scene.add(t);
      trail.push(t);
    }
    pulses.push({ mesh, shade, trail, curve: curveBetween(a, b), t: 0 });
  }

  function flash(at: THREE.Vector3) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.58, 44),
      new THREE.MeshBasicMaterial({
        color: 0x2f6df0, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(at.x, 0.22, at.z);
    scene.add(mesh);
    flashes.push({ mesh, t: 0 });
  }

  /* ── camera rig ────────────────────────────────────────────────────── */
  const orb = { a: Math.PI * 0.25, p: 0.86, zoom: 1, drag: false, lx: 0, ly: 0 };
  const want = { a: orb.a, p: orb.p, zoom: 1 };
  const lookAt = new THREE.Vector3(0, 0, 4.6);
  const lookWant = new THREE.Vector3(0, 0, 4.6);
  let focused: string | null = null;

  function focus(code: string | null) {
    focused = code;
    const p = code ? nodePos.get(code) : null;
    if (p) {
      lookWant.set(p.x, 0, p.z);
      want.zoom = 2.1;
    } else {
      lookWant.set(0, 0, 4.6);
      want.zoom = 1;
    }
  }

  const DIST = 90;
  function place() {
    // Elevation is held in a narrow band: the model must always be read from
    // above, never from the side.
    const p = Math.max(0.52, Math.min(1.0, orb.p));
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
    want.a -= (e.clientX - orb.lx) * 0.006;
    want.p = Math.max(0.52, Math.min(1.0, want.p - (e.clientY - orb.ly) * 0.003));
    orb.lx = e.clientX; orb.ly = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    if (!orb.drag) return;
    orb.drag = false;
    try { el.releasePointerCapture(e.pointerId); } catch { /* capture already gone */ }
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    want.zoom = Math.max(0.6, Math.min(3.2, want.zoom * (1 - e.deltaY * 0.0012)));
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

  function resize() {
    const w = mount.clientWidth || 1;
    const h = mount.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.left = (-FRUSTUM * aspect) / 2;
    camera.right = (FRUSTUM * aspect) / 2;
    camera.top = FRUSTUM / 2;
    camera.bottom = -FRUSTUM / 2;
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

    // Signs turn about Y only, so they stay upright and legible as the model
    // rotates without ever tipping toward the camera.
    camera.getWorldDirection(camDir);
    const faceY = Math.atan2(-camDir.x, -camDir.z);
    for (const s of signs) s.rotation.y = faceY - (s.parent?.rotation.y ?? 0);

    figures.forEach((fig, code) => {
      const planned = fig.agent.lifecycle === "planned";
      const active = !planned && fig.agent.state !== "idle" && fig.agent.state !== "offline";

      fig.group.position.y = reduced ? 0
        : active ? Math.abs(Math.sin(t * 3.1 + fig.phase)) * 0.09
          : Math.sin(t * 0.85 + fig.phase) * 0.02;

      // Idle agents glance around; working ones square up to the desk.
      const drift = active ? 0 : Math.sin(t * 0.32 + fig.phase) * 0.45;
      fig.facing = ease(fig.facing, Math.PI + drift, dt * 1.5);
      fig.group.rotation.y = fig.facing;

      const sel = code === focused;
      fig.group.scale.setScalar(ease(fig.group.scale.x, sel ? 1.12 : 1, k));

      if (fig.ring.visible) {
        fig.ring.scale.setScalar(1 + Math.abs(Math.sin(t * 2.3 + fig.phase)) * 0.28);
        (fig.ring.material as THREE.MeshBasicMaterial).opacity =
          0.5 - Math.abs(Math.sin(t * 2.3 + fig.phase)) * 0.28;
      }
      fig.label.sprite.visible = sel || active;
    });

    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += dt * 0.7;
      if (p.t >= 1) {
        flash(p.curve.getPoint(1));
        for (const m of [p.mesh, p.shade, ...p.trail]) {
          scene.remove(m);
          (m.material as THREE.Material).dispose();
        }
        pulses.splice(i, 1);
        continue;
      }
      const at = p.curve.getPoint(p.t);
      p.mesh.position.copy(at);
      p.shade.position.set(at.x, 0.2, at.z);
      const lift = Math.max(0.2, at.y);
      p.shade.scale.setScalar(1 + lift * 0.22);
      (p.shade.material as THREE.MeshBasicMaterial).opacity = 0.2 / (1 + lift * 0.35);
      p.trail.forEach((m, j) => {
        const lag = Math.max(0, p.t - (j + 1) * 0.04);
        m.position.copy(p.curve.getPoint(lag));
        (m.material as THREE.MeshBasicMaterial).opacity =
          Math.sin(p.t * Math.PI) * 0.55 * (1 - (j + 1) / (TRAIL + 1.2));
      });
    }

    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.t += dt * 2;
      if (f.t >= 1) {
        scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        (f.mesh.material as THREE.Material).dispose();
        flashes.splice(i, 1);
        continue;
      }
      f.mesh.scale.setScalar(1 + f.t * 3);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - f.t) * 0.7;
    }

    renderer.render(scene, camera);
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
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry && m.geometry !== BOX) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      // BOX is module-level and shared with the next mount — never disposed.
      PULSE_GEO.dispose();
      SHADE_GEO.dispose();
      renderer.dispose();
      if (el.parentElement === mount) mount.removeChild(el);
    },
  };
}

/* ── pieces ──────────────────────────────────────────────────────────── */

type Label = { sprite: THREE.Sprite; draw: (agent: Agent) => void };

/**
 * A figure at roughly two and a half heads tall. Realistic proportions read as
 * a blob at this scale; an oversized head reads as a character.
 */
function makeFigure(agent: Agent, picks: THREE.Object3D[]) {
  const group = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0x9bb0c9 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.4, 6, 20), skin);
  body.position.y = 0.66;
  body.castShadow = true;
  body.userData.code = agent.code;
  group.add(body);
  picks.push(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 28, 22), skin);
  head.position.y = 1.5;
  head.castShadow = true;
  head.userData.code = agent.code;
  group.add(head);
  picks.push(head);

  // A dark band for a face: gives the figure a front, which is what makes
  // turning toward the desk legible.
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.427, 28, 22, 0, Math.PI * 2, Math.PI * 0.36, Math.PI * 0.2),
    new THREE.MeshLambertMaterial({ color: 0x2c2f38 }),
  );
  visor.position.y = 1.5;
  visor.rotation.x = -0.2;
  group.add(visor);

  const contact = new THREE.Mesh(
    new THREE.CircleGeometry(0.56, 28),
    new THREE.MeshBasicMaterial({
      color: 0x7a6c56, transparent: true, opacity: 0.22, depthWrite: false,
    }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.2;
  group.add(contact);

  // A colour under every agent, always. Hiding it while idle left a floor of
  // identical grey figures with nothing to read.
  const base = new THREE.Mesh(
    new THREE.RingGeometry(0.46, 0.62, 44),
    new THREE.MeshBasicMaterial({
      color: 0x9bb0c9, transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.21;
  group.add(base);

  // The expanding ring is the extra signal, shown only while the agent is
  // doing something and never for a planned one.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.72, 44),
    new THREE.MeshBasicMaterial({
      color: 0x9bb0c9, transparent: true, opacity: 0.45,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.215;
  ring.visible = false;
  group.add(ring);

  const label = makeLabel(agent);
  group.add(label.sprite);

  return {
    group, skin, ring, base, label, agent,
    phase: Math.random() * Math.PI * 2, facing: Math.PI,
  };
}

/**
 * Name and state on a small card above the agent, shown only while it is
 * working or selected. Labelling everything at once is what made the previous
 * version noisy.
 */
function makeLabel(agent: Agent): Label {
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 132;
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  sprite.scale.set(2.9, 0.96, 1);
  sprite.position.y = 2.6;
  sprite.renderOrder = 10;
  sprite.visible = false;

  const draw = (a: Agent) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.direction = "rtl";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const color = hex(STATE_COLOR[a.state] ?? 0x9bb0c9);

    ctx.save();
    ctx.shadowColor = "rgba(90,76,52,0.28)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, 14, 14, canvas.width - 28, 92, 20);
    ctx.fill();
    ctx.restore();

    // The state colour as a spine on the trailing edge, so the card carries
    // the same signal as the figure without shouting.
    ctx.fillStyle = color;
    roundRect(ctx, canvas.width - 32, 22, 12, 76, 6);
    ctx.fill();

    ctx.font = '600 34px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = "#38342e";
    ctx.fillText(a.name, canvas.width / 2 - 6, 48, canvas.width - 90);

    ctx.font = '500 25px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(STATE_AR[a.state] ?? a.state, canvas.width / 2 - 6, 82, canvas.width - 90);

    tex.needsUpdate = true;
  };
  draw(agent);
  return { sprite, draw };
}

/** A small standing sign: a post, a board, and the room's name on it. */
function signPost(text: string): THREE.Group {
  const group = new THREE.Group();

  const post = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: P.charcoal }));
  post.position.y = 0.5;
  post.scale.set(0.09, 0.82, 0.09);
  post.castShadow = true;
  group.add(post);

  const canvas = document.createElement("canvas");
  canvas.width = 448;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    // Cream on charcoal. A pale board on a pale floor was the reason none of
    // these could be read at the distance the model is actually viewed from.
    ctx.fillStyle = "#38342e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.direction = "rtl";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '700 62px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = "#f7f2e9";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 3, canvas.width - 28);
  }
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 0.63),
    new THREE.MeshLambertMaterial({
      map: new THREE.CanvasTexture(canvas), side: THREE.DoubleSide,
    }),
  );
  board.position.y = 1.2;
  board.castShadow = true;
  group.add(board);

  return group;
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
