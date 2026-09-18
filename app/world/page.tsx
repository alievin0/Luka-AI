"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

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
/**
 * The material palette of the model itself.
 *
 * Measured, not eyeballed. The rule is that agent state colours are the only
 * saturated things on the board, and the first pass broke it: the oak desks
 * had a chroma of 100 against the `idle` state's 46, so eight desks covering
 * more pixels than every figure combined were the loudest thing in the frame.
 * Everything here now sits below the quietest state colour, and value —
 * near-white floor against mid-tone wood — carries the separation instead.
 */
const P = {
  ground: 0xccb99c,
  floor: 0xfbf8f1,
  rug: 0xe0d7c6,
  rim: 0xada08d,
  wall: 0xe7ddcb,
  oak: 0xb09b83,
  oakDark: 0x8d7a62,
  charcoal: 0x38342e,
  screen: 0x33465c,
  plant: 0x7e8f76,
  plantDark: 0x63755e,
  ink: 0x6b5a45,
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
  customer: { label: "الزبون", pos: [0, 11.4], color: 0xb3a894 },
  "channel-web": { label: "المتصفح", pos: [-2.4, 8.2], color: 0xa89e8e },
  "channel-voice": { label: "الصوت", pos: [2.4, 8.2], color: 0x9c9689 },
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

/**
 * Rounded boxes, built at true size and cached by size.
 *
 * Razor-sharp box edges are the clearest tell of untouched 3D: nothing
 * manufactured has them. A small constant fillet — the same physical radius on
 * every object, not a radius proportional to its size — is what reads as a
 * moulded model rather than a stack of primitives.
 *
 * It has to be built at final size. Scaling one shared rounded box, the way the
 * previous `block()` scaled a unit cube, stretches the corner radius with it:
 * a 26 x 0.9 plinth would come out with a 1.3-unit fillet along one axis and a
 * 0.05 one along another. So the size goes into the geometry and the mesh scale
 * stays at 1. The rooms are identical, so the cache collapses this to about
 * twenty geometries for the whole model.
 */
const CORNER = 0.045;
const boxCache = new Map<string, THREE.BufferGeometry>();

function roundedBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const r = Math.min(CORNER, w / 2, h / 2, d / 2);
  const q = (n: number) => Math.round(n * 100) / 100;
  const key = `${q(w)}|${q(h)}|${q(d)}|${q(r)}`;
  let g = boxCache.get(key);
  if (!g) {
    // segments must be >= 1: at 0 the constructor returns before the requested
    // width/height/depth are ever applied, and hands back a unit cube.
    g = new RoundedBoxGeometry(w, h, d, 1, r);
    boxCache.set(key, g);
    cachedGeometries.add(g);
  }
  return g;
}

/** Set from the renderer's capabilities; text is the reason it matters. */
let maxAnisotropy = 1;

/** Identity set for dispose(): these geometries outlive any one scene. */
const cachedGeometries = new Set<THREE.BufferGeometry>();

function surface(
  color: number,
  opts: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.85, metalness: 0, envMapIntensity: 0.6, ...opts,
  });
}

/** A box placed by centre and size, so furniture reads as dimensions. */
function block(
  parent: THREE.Object3D, material: THREE.Material,
  x: number, y: number, z: number, w: number, h: number, d: number,
  shadow = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(roundedBox(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/**
 * A soft radial gradient for the pool of shade under an object.
 *
 * The eye reads "resting on the floor" almost entirely from this. A flat disc
 * at uniform opacity, which is what was here before, reads as a sticker.
 */
let _contactMap: THREE.CanvasTexture | null = null;

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

function buildScene(mount: HTMLElement, onPick: (code: string) => void): SceneApi {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setClearColor(0xefe8dc, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Neutral, not ACES. ACES brightens by 67% before its filmic curve even
  // starts, then adds contrast and pushes warm tones orange — it would eat a
  // palette chosen to be pale. Neutral is mathematically identity below a peak
  // of 0.76 and only rolls off the highlights, which stops a surface facing the
  // key light square-on from clipping to flat white.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  mount.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";

  maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();

  /**
   * Orthographic, not perspective. Parallel projection is what makes this read
   * as a model on a table rather than a game camera, and it keeps every room
   * the same size wherever it sits on the floor.
   */
  /** Screen-space extent the model needs, measured from the plinth. */
  const NEED_W = 27.6;
  const NEED_H = 20;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);

  /**
   * Ambient light from an environment rather than a constant.
   *
   * A plain AmbientLight adds the same value to every surface whatever way it
   * faces, which is the single biggest flattener available: it removes exactly
   * the shading that gives a box its form. An irradiance environment lights
   * up-facing surfaces more than down-facing ones for free, and it puts a thin
   * highlight on the rounded edges — the two changes compound, and together
   * they are most of the difference between "built" and "assembled".
   */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  // A little pre-blur: unblurred, the room's light panels read as legible
  // reflections, which is not what a matte model wants.
  const envRT = pmrem.fromScene(room, 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.55;
  room.dispose();
  pmrem.dispose();

  /* One warm key light at a fixed angle, so every shadow in the model falls
     the same way — the thing that most makes a set of boxes look built. */
  const key = new THREE.DirectionalLight(0xfff4e2, 2.2);
  /** Held relative to whatever the camera is framing, so the light direction —
      and every shadow with it — stays put as the view moves. */
  const KEY_OFFSET = new THREE.Vector3(-26, 38, 20);
  key.position.copy(KEY_OFFSET);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  // Tight bounds around what is actually framed. At the old ±34 a shadow texel
  // covered more ground than a monitor bezel is thick, which is why fine
  // contact detail came out mushy.
  key.shadow.camera.left = -14; key.shadow.camera.right = 14;
  key.shadow.camera.top = 14; key.shadow.camera.bottom = -14;
  key.shadow.camera.near = 20; key.shadow.camera.far = 90;
  key.shadow.camera.updateProjectionMatrix();
  // normalBias offsets along the surface normal in world units, so it scales
  // with the scene and does not detach a shadow from the object casting it;
  // a flat depth bias always trades acne for that detachment.
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.014;
  // Shadows that describe form without becoming holes. Faking this by raising
  // ambient would flatten everything else to get it.
  key.shadow.intensity = 0.66;
  scene.add(key);
  scene.add(key.target);
  // A cool cast in the shade against the warm bounce off the sand. Kept low:
  // the environment is doing the fill now, and no AmbientLight at all.
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0xd8c8ae, 0.22));
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.3);
  fill.position.set(22, 14, -18);
  scene.add(fill);

  // Scoped to this scene: a module-level list would outlive dispose() and the
  // frame loop would go on turning signs belonging to a torn-down world.
  const signs: THREE.Group[] = [];

  // Roughness is art direction here, not realism: the screen is the one glossy
  // thing in the room so it reads as glass, the rug is fully matte so it reads
  // as fabric, and everything else sits between them.
  const contactMap = contactTexture();
  const mats = {
    ground: surface(P.ground, { roughness: 0.95 }),
    floor: surface(P.floor, { roughness: 0.9 }),
    rug: surface(P.rug, { roughness: 1 }),
    rim: surface(P.rim, { roughness: 0.92 }),
    wall: surface(P.wall, { roughness: 0.88 }),
    oak: surface(P.oak, { roughness: 0.72 }),
    oakDark: surface(P.oakDark, { roughness: 0.78 }),
    charcoal: surface(P.charcoal, { roughness: 0.6 }),
    screen: surface(P.screen, { roughness: 0.28, envMapIntensity: 1.1 }),
    plant: surface(P.plant, { roughness: 0.8 }),
    plantDark: surface(P.plantDark, { roughness: 0.82 }),
    shadow: new THREE.MeshBasicMaterial({
      color: 0x6b5d49, alphaMap: contactMap, transparent: true,
      opacity: 0.3, depthWrite: false,
    }),
  };

  /* ── the plinth the whole model sits on ────────────────────────────── */
  const base = new THREE.Mesh(roundedBox(18.5, 0.64, 20.5), mats.ground);
  base.position.set(0, -0.32, 3.25);
  base.receiveShadow = true;
  scene.add(base);

  const baseRim = new THREE.Mesh(roundedBox(19.3, 0.26, 21.3), mats.rim);
  baseRim.position.set(0, -0.7, 3.25);
  baseRim.receiveShadow = true;
  scene.add(baseRim);

  // A wide, very soft pool under the whole plinth. Without it the model floats
  // in a void; with it, it is an object resting on a surface.
  const groundShade = new THREE.Mesh(
    new THREE.PlaneGeometry(32, 34),
    new THREE.MeshBasicMaterial({
      color: 0x6b5d49, alphaMap: contactMap, transparent: true,
      opacity: 0.22, depthWrite: false,
    }),
  );
  groundShade.rotation.x = -Math.PI / 2;
  groundShade.position.set(0, -0.86, 3.25);
  scene.add(groundShade);

  /* ── rooms ─────────────────────────────────────────────────────────── */
  /**
   * One room per zone, at a scale that agrees with itself.
   *
   * The first pass had no consistent ruler: taking the figure as 1.8m, the
   * room worked out at 39 square metres for one person, the desk at 2.5m long
   * and the monitor at 1.4m wide. Everything here is now derived from the
   * figure, so the model reads as a place at a believable size.
   */
  const ROOM = 4.4;
  const half = ROOM / 2;
  const FLOOR_TOP = 0.18;
  const leafGeo = new THREE.IcosahedronGeometry(0.19, 1);
  const leafGeoSmall = new THREE.IcosahedronGeometry(0.14, 1);

  Object.entries(ZONE_POS).forEach(([zone, [x, z]], index) => {
    const room = new THREE.Group();
    room.position.set(x, 0, z);
    scene.add(room);

    block(room, mats.floor, 0, 0.09, 0, ROOM, FLOOR_TOP, ROOM, false);

    // Walls a person could not step over. At the old 0.52 they read as a kerb
    // around a platform rather than as a room.
    const t = 0.13, wallH = 0.95, wallY = FLOOR_TOP + wallH / 2;
    const gap = z > 3 ? "front" : z < -1 ? "back" : x < 0 ? "right" : "left";
    if (gap !== "back") block(room, mats.wall, 0, wallY, -half, ROOM, wallH, t);
    if (gap !== "front") block(room, mats.wall, 0, wallY, half, ROOM, wallH, t);
    if (gap !== "left") block(room, mats.wall, -half, wallY, 0, t, wallH, ROOM);
    if (gap !== "right") block(room, mats.wall, half, wallY, 0, t, wallH, ROOM);

    /* desk, monitor, chair — the agent stands at all of it */
    const dz = -1.15;
    block(room, mats.rug, 0, FLOOR_TOP + 0.005, dz + 0.4, 2.3, 0.01, 1.9, false);

    const deskTop = 0.74;
    block(room, mats.oak, 0, deskTop, dz, 1.55, 0.07, 0.72);
    block(room, mats.oakDark, -0.7, (FLOOR_TOP + deskTop) / 2, dz, 0.07, deskTop - FLOOR_TOP, 0.64);
    block(room, mats.oakDark, 0.7, (FLOOR_TOP + deskTop) / 2, dz, 0.07, deskTop - FLOOR_TOP, 0.64);

    const surfaceY = deskTop + 0.035;
    block(room, mats.charcoal, 0, surfaceY + 0.01, dz - 0.05, 0.22, 0.02, 0.14);
    block(room, mats.charcoal, 0, surfaceY + 0.1, dz - 0.05, 0.05, 0.16, 0.05);
    const panel = block(room, mats.charcoal, 0, surfaceY + 0.36, dz - 0.05, 0.62, 0.36, 0.028);
    panel.rotation.x = -0.1;
    // A faint lit face. Eight softly glowing screens is most of what says
    // these offices are occupied; the emissive is kept well below the
    // saturation of any state colour so the palette rule holds.
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.575, 0.325),
      new THREE.MeshStandardMaterial({
        color: P.screen, roughness: 0.28,
        emissive: 0x24405c, emissiveIntensity: 0.4,
      }),
    );
    face.position.set(0, surfaceY + 0.36, dz - 0.05 + 0.016);
    face.rotation.x = -0.1;
    room.add(face);

    // A chair with a column and a splayed base, because two boxes rendered as
    // an unidentifiable dark wedge.
    const cz = dz + 0.8;
    block(room, mats.charcoal, 0, 0.46, cz, 0.46, 0.07, 0.44);
    const back = block(room, mats.charcoal, 0, 0.72, cz + 0.2, 0.44, 0.44, 0.06);
    back.rotation.x = 0.12;
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.26, 10), mats.charcoal,
    );
    column.position.set(0, 0.31, cz);
    column.castShadow = true;
    room.add(column);
    const chairBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.26, 0.035, 5), mats.charcoal,
    );
    chairBase.position.set(0, FLOOR_TOP + 0.02, cz);
    chairBase.castShadow = true;
    room.add(chairBase);

    // Eight identical offices read as a tiling error, so the greenery moves
    // corner by room and every other one gets a cabinet.
    const corners: Array<[number, number]> = [
      [half - 0.7, -half + 0.7], [half - 0.7, half - 0.7],
      [-half + 0.7, -half + 0.7], [half - 0.7, half - 1.3],
    ];
    const [px, pz] = corners[index % corners.length];
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.12, 0.2, 12), mats.oakDark,
    );
    pot.position.set(px, FLOOR_TOP + 0.1, pz);
    pot.castShadow = true;
    room.add(pot);
    for (const [ox, oy, oz, geo] of [
      [0, 0.3, 0, leafGeo], [-0.13, 0.42, 0.08, leafGeoSmall], [0.12, 0.45, -0.06, leafGeoSmall],
    ] as Array<[number, number, number, THREE.BufferGeometry]>) {
      const leaf = new THREE.Mesh(geo, oy > 0.4 ? mats.plantDark : mats.plant);
      leaf.position.set(px + ox, FLOOR_TOP + oy, pz + oz);
      leaf.castShadow = true;
      room.add(leaf);
    }

    if (index % 2 === 0) {
      block(room, mats.oakDark, -half + 0.55, FLOOR_TOP + 0.3, -half + 0.85, 0.85, 0.6, 0.42);
    }

    // The sign stands clear of the plant. Previously the two shared a corner
    // in two of the eight rooms and the greenery grew straight through it.
    const sign = signPost(ZONE_AR[zone] ?? zone);
    sign.position.set(-half + 0.65, 0, half - 0.5);
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

    block(pad, mats.floor, 0, 0.09, 0, 2.0, 0.18, 2.0, false);
    block(pad, mats.wall, 0, 0.26, 0, 1.3, 0.16, 1.3, false);
    // A low rounded post, not a hex gem: the gem was a shape language that
    // appeared nowhere else in the model.
    const marker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.32, 0.72, 20),
      surface(meta.color, { roughness: 0.7 }),
    );
    marker.position.y = 0.7;
    marker.castShadow = true;
    pad.add(marker);

    const sign = signPost(meta.label);
    sign.position.set(-0.75, 0, 0.7);
    sign.scale.setScalar(0.85);
    pad.add(sign);
    signs.push(sign);

    nodePos.set(id, new THREE.Vector3(x, 1.0, z));
  }

  /* ── agents ────────────────────────────────────────────────────────── */
  type Figure = {
    group: THREE.Group;
    skin: THREE.MeshStandardMaterial;
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
    // Retire anyone no longer on the roster, or switching business would leave
    // the previous company's figures standing in the rooms — and leave dead
    // raycast targets still answering clicks with a stale code.
    const live = new Set(agents.map((a) => a.code));
    for (const [code, fig] of Array.from(figures.entries())) {
      if (live.has(code)) continue;
      scene.remove(fig.group);
      fig.group.traverse((o) => {
        const m = o as THREE.Mesh;
        const i = picks.indexOf(m);
        if (i >= 0) picks.splice(i, 1);
        if (m.geometry && !cachedGeometries.has(m.geometry)) m.geometry.dispose();
        const mat = m.material as THREE.Material | undefined;
        mat?.dispose();
      });
      figures.delete(code);
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
        // At the workstation, just behind the chair. Placing them at the desk
        // itself put each figure standing inside its own chair.
        const spread = 0.95;
        const offset = (i - (list.length - 1) / 2) * spread;
        const x = zx + offset;
        const z = zz + 0.42;

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
        nodePos.set(agent.code, new THREE.Vector3(x, 1.2, z));
        if (changed) fig.label.draw(agent);
        applyState(fig);
      });
    }
  }

  function applyState(fig: Figure) {
    const planned = fig.agent.lifecycle === "planned";
    const color = STATE_COLOR[fig.agent.state] ?? 0x9bb0c9;
    // Solid, not translucent: a see-through figure sorted badly against its
    // own floor ring. Pale and desaturated says "not built" just as clearly.
    fig.skin.color.setHex(planned ? 0xd8d2c6 : color);
    fig.skin.transparent = false;
    fig.skin.opacity = 1;
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
    mid.y += Math.max(2.4, a.distanceTo(b) * 0.3);
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
        new THREE.TubeGeometry(curveBetween(a, b), 44, 0.03 + weight * 0.04, 8, false),
        new THREE.MeshStandardMaterial({
          color: P.ink, roughness: 0.9, metalness: 0,
          transparent: true, opacity: 0.55 + weight * 0.35,
        }),
      );
      edgeGroup.add(tube);
    }
    if (complete) edgeKey = key;
  }

  /* ── pulses ────────────────────────────────────────────────────────── */
  const PULSE_GEO = new THREE.SphereGeometry(0.17, 18, 14);
  const SHADE_GEO = new THREE.PlaneGeometry(0.85, 0.85);
  const TRAIL = 4;

  function pulse(from: string, to: string) {
    const a = nodePos.get(from);
    const b = nodePos.get(to);
    if (!a || !b) return;

    const mesh = new THREE.Mesh(
      PULSE_GEO,
      new THREE.MeshStandardMaterial({
        color: 0x2f6df0, emissive: 0x2f6df0, emissiveIntensity: 0.9, roughness: 0.35,
      }),
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
        new THREE.MeshBasicMaterial({
          color: 0x6d97f5, transparent: true, opacity: 0, depthWrite: false,
        }),
      );
      t.scale.setScalar(1 - (i + 1) / (TRAIL + 1.2));
      scene.add(t);
      trail.push(t);
    }
    pulses.push({ mesh, shade, trail, curve: curveBetween(a, b), t: 0 });
  }

  function flash(at: THREE.Vector3) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.42, 40),
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
  const lookAt = new THREE.Vector3(0, 0, 3.25);
  const lookWant = new THREE.Vector3(0, 0, 3.25);
  let focused: string | null = null;

  function focus(code: string | null) {
    focused = code;
    const p = code ? nodePos.get(code) : null;
    if (p) {
      lookWant.set(p.x, 0, p.z);
      want.zoom = 2.1;
    } else {
      lookWant.set(0, 0, 3.25);
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
        if (m.geometry && !cachedGeometries.has(m.geometry)) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      // The rounded-box cache is module-level and shared with the next mount,
      // so it is deliberately never disposed here.
      envRT.dispose();
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
  const skin = surface(0x9bb0c9, { roughness: 0.55 });

  // About three heads tall. The previous figure was 2.3 heads — below a Funko
  // Pop, and not a human proportion at all. Its feet also sat 0.10 below the
  // floor, hidden by an opaque disc, so it never made visible ground contact.
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.66, 6, 16), skin);
  body.position.y = 0.81;
  body.castShadow = true;
  body.userData.code = agent.code;
  group.add(body);
  picks.push(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.29, 24, 18), skin);
  head.position.y = 1.51;
  head.castShadow = true;
  head.userData.code = agent.code;
  group.add(head);
  picks.push(head);

  // A frontal arc for a face. This was a full revolution before — a band right
  // around the head — so the figures had no front at all and the animation
  // that turns them toward the desk was turning something nobody could see.
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(
      0.295, 24, 18, -Math.PI * 0.34, Math.PI * 0.68, Math.PI * 0.34, Math.PI * 0.24,
    ),
    surface(0x2c2f38, { roughness: 0.22, envMapIntensity: 1.2 }),
  );
  visor.position.y = 1.51;
  group.add(visor);

  // Arms, so the silhouette is a person rather than a chess pawn.
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.3, 4, 10), skin);
    arm.position.set(side * 0.3, 0.86, 0.04);
    arm.rotation.z = side * 0.16;
    arm.castShadow = true;
    group.add(arm);
  }

  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.3),
    new THREE.MeshBasicMaterial({
      color: 0x6b5d49, alphaMap: contactTexture(), transparent: true,
      opacity: 0.4, depthWrite: false,
    }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.19;
  group.add(contact);

  // A colour under every agent, always. Hiding it while idle left a floor of
  // identical grey figures with nothing to read.
  const base = new THREE.Mesh(
    new THREE.RingGeometry(0.36, 0.47, 40),
    new THREE.MeshBasicMaterial({
      color: 0x9bb0c9, transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.2;
  group.add(base);

  // The expanding ring is the extra signal, shown only while the agent is
  // doing something and never for a planned one.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.48, 0.56, 40),
    new THREE.MeshBasicMaterial({
      color: 0x9bb0c9, transparent: true, opacity: 0.45,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.205;
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
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  sprite.scale.set(2.1, 0.7, 1);
  sprite.position.y = 2.35;
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

  const post = new THREE.Mesh(roundedBox(0.07, 1.32, 0.07), surface(P.charcoal));
  post.position.y = 0.84;
  post.castShadow = true;
  group.add(post);

  const canvas = document.createElement("canvas");
  canvas.width = 288;
  canvas.height = 80;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    // Cream on charcoal. A pale board on a pale floor was the reason none of
    // these could be read at the distance the model is actually viewed from.
    ctx.fillStyle = "#38342e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.direction = "rtl";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '700 46px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = "#f7f2e9";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2, canvas.width - 18);
  }
  const boardTex = new THREE.CanvasTexture(canvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  boardTex.anisotropy = maxAnisotropy;
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.4),
    new THREE.MeshBasicMaterial({
      map: boardTex, side: THREE.DoubleSide, toneMapped: false,
    }),
  );
  board.position.y = 1.56;
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
