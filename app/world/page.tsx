"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { VignetteShader } from "three/examples/jsm/shaders/VignetteShader.js";

/**
 * The agent network.
 *
 * It mirrors the running system rather than animating beside it. Every node,
 * every state and every moving pulse comes from `/api/desk`, which returns
 * what the pipeline actually wrote. A node shown working is working; a node
 * drawn dim has no code behind it yet and is never animated as busy. The
 * connections are not a drawn diagram either — each one exists because a real
 * message crossed it, and brightens with the traffic it carries.
 *
 * On the art direction, after an earlier pass was rejected: the previous
 * version put little characters in little rooms with little desks, and no
 * amount of polish moves that out of the category it belongs to. A toy is a
 * toy. This is deliberately abstract instead — machined metal and dark glass
 * over a polished floor, light travelling along the paths, and not one thing
 * that could be mistaken for a game. Restraint is doing the work: the whole
 * scene is near-black, so the only bright things on screen are the agents'
 * states and the data actually moving between them.
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
 * The only bright colours in the scene. Everything the network is built from
 * is near-black, so these carry all the meaning and all the glow.
 */
const STATE_COLOR: Record<string, number> = {
  idle: 0x5a6b85, working: 0x3b82f6, processing: 0x3b82f6, waiting: 0xf0a33c,
  using_tool: 0x9061f9, escalated: 0xef4444, error: 0xef4444,
  offline: 0x2f3642, deploying: 0x10b981,
};

const LEGEND: Array<{ state: string; label: string }> = [
  { state: "working", label: "شغّال" },
  { state: "using_tool", label: "بيستعمل أداة" },
  { state: "waiting", label: "بينتظر" },
  { state: "escalated", label: "حوّل لإنسان" },
  { state: "idle", label: "جاهز" },
  { state: "offline", label: "ما انبنى" },
];

/** The constellation. Message flow runs from the front of the floor inward. */
const ZONE_POS: Record<string, [number, number]> = {
  reception: [0, 1.5],
  knowledge: [-6.2, 0.5], booking: [6.2, 0.5],
  tools: [-6.2, 6], supervision: [6.2, 6],
  escalation: [0, -3.5],
  workshop: [-6.2, -5.5], business: [6.2, -5.5],
};

const EXTRA_NODES: Record<string, { label: string; pos: [number, number] }> = {
  customer: { label: "الزبون", pos: [0, 10] },
  "channel-web": { label: "المتصفح", pos: [-3.4, 6.6] },
  "channel-voice": { label: "الصوت", pos: [3.4, 6.6] },
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
        if (alive) setError("تعذّر تحديث حالة الشبكة.");
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
    <div className="flex h-screen flex-col bg-[#05070c] text-slate-200">
      <header className="z-10 flex flex-wrap items-center gap-3 border-b border-white/[0.07] bg-[#080b12] px-5 py-3">
        <div className="flex-1">
          <h1 className="text-[13px] font-semibold tracking-[0.18em] text-slate-100">
            شبكة الوكلاء
          </h1>
          <p className="mt-0.5 text-[10px] tracking-wide text-slate-500">
            الحالات والمسارات والحركة كلها من نشرتك الحقيقية
          </p>
        </div>

        <div className="flex items-center gap-4 font-mono text-[10px] tracking-wider text-slate-500">
          <span>
            مبني <b className="text-slate-200">{String(live.length).padStart(2, "0")}</b>
            <span className="text-slate-600">/{String(agents.length).padStart(2, "0")}</span>
          </span>
          <span className="h-3 w-px bg-white/10" />
          <span>
            شغّال <b className="text-[#3b82f6]">{String(busy.length).padStart(2, "0")}</b>
          </span>
          <span className="h-3 w-px bg-white/10" />
          <span>
            مسارات <b className="text-slate-200">{String(edges.length).padStart(2, "0")}</b>
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
          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-[#3b82f6]/60"
        >
          {businesses.map((b) => (
            <option key={b.id} value={b.id} className="bg-[#080b12]">{b.name}</option>
          ))}
        </select>
        <a
          href="/desk"
          className="rounded-lg border border-white/15 px-3.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-[#3b82f6]/60 hover:text-white"
        >
          احكي معهم ←
        </a>
      </header>

      {storage && !storage.persistent && (
        <div className="z-10 border-b border-amber-500/15 bg-amber-500/[0.06] px-4 py-1 text-center text-[10px] tracking-wide text-amber-400/80">
          التخزين بالذاكرة — الأحداث والمسارات بتنمسح مع كل نشر
        </div>
      )}
      {error && (
        <div className="z-10 border-b border-red-500/15 bg-red-500/[0.06] px-4 py-1 text-center text-[10px] text-red-400/90">
          {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div ref={mountRef} className="relative flex-1">
          <div className="pointer-events-none absolute left-5 top-5 space-y-1.5">
            <p className="mb-2 font-mono text-[9px] tracking-[0.2em] text-slate-600">
              الحالات
            </p>
            {LEGEND.map((l) => (
              <div key={l.state} className="flex items-center gap-2 text-[10px] text-slate-400">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    background: hex(STATE_COLOR[l.state]),
                    boxShadow: `0 0 6px ${hex(STATE_COLOR[l.state])}`,
                  }}
                />
                {l.label}
              </div>
            ))}
          </div>

          {agents.length > 0 && edges.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-12 flex justify-center px-4">
              <p className="pointer-events-auto rounded-lg border border-white/10 bg-black/60 px-4 py-2.5 text-center text-[11px] text-slate-400 backdrop-blur-sm">
                الشبكة واقفة، بس ما في مسارات لسّا.{" "}
                <a className="text-[#3b82f6] hover:underline" href="/desk">افتح لوحة التجربة</a>{" "}
                واحكي معهم — كل رسالة بترسم مسار.
              </p>
            </div>
          )}

          <p className="pointer-events-none absolute bottom-4 right-5 font-mono text-[9px] tracking-wider text-slate-700">
            اسحب لتدوير · عجلة للتقريب · اضغط على عقدة
          </p>
        </div>

        <aside className="flex w-[330px] shrink-0 flex-col overflow-hidden border-r border-white/[0.07] bg-[#080b12]">
          <section className="border-b border-white/[0.07] p-5">
            <h2 className="mb-3 font-mono text-[9px] tracking-[0.2em] text-slate-600">
              العقدة المحدّدة
            </h2>
            {current ? (
              <>
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-semibold text-slate-100">{current.name}</h3>
                  <span
                    className="font-mono text-[10px]"
                    style={{ color: hex(STATE_COLOR[current.state] ?? 0x5a6b85) }}
                  >
                    {STATE_AR[current.state] ?? current.state}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{current.role}</p>
                <dl className="mt-4 space-y-2 text-[11px]">
                  <div className="flex gap-3">
                    <dt className="w-14 shrink-0 text-slate-600">المنطقة</dt>
                    <dd className="text-slate-300">{ZONE_AR[current.zone] ?? current.zone}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-14 shrink-0 text-slate-600">الحالة</dt>
                    <dd className="text-slate-300">
                      {current.lifecycle === "live" ? "كوده مكتوب" : "تصميم — ما انبنى"}
                    </dd>
                  </div>
                </dl>
                {current.capabilities.length > 0 && (
                  <>
                    <h4 className="mt-4 font-mono text-[9px] tracking-[0.2em] text-slate-600">
                      بيقدر يعمل
                    </h4>
                    <ul className="mt-1.5 space-y-1 text-[11px] text-slate-400">
                      {current.capabilities.map((c) => <li key={c}>— {c}</li>)}
                    </ul>
                  </>
                )}
                {current.permissions.length > 0 && (
                  <>
                    <h4 className="mt-4 font-mono text-[9px] tracking-[0.2em] text-slate-600">
                      صلاحياته
                    </h4>
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      {current.permissions.join(" · ")}
                    </p>
                  </>
                )}
              </>
            ) : (
              <p className="text-[11px] text-slate-600">اضغط على عقدة بالشبكة لتشوف تفاصيلها.</p>
            )}
          </section>

          <section className="flex min-h-0 flex-1 flex-col p-5">
            <h2 className="mb-3 flex items-center gap-2 font-mono text-[9px] tracking-[0.2em] text-slate-600">
              <span className="h-1 w-1 animate-pulse rounded-full bg-[#3b82f6]" />
              الأحداث — مباشرة
            </h2>
            {recent.length === 0 ? (
              <p className="text-[11px] leading-relaxed text-slate-600">
                ما في أحداث بعد. افتح{" "}
                <a className="text-[#3b82f6] hover:underline" href="/desk">لوحة التجربة</a>{" "}
                واحكي مع الوكيل — وارجع لهون تشوف الحركة.
              </p>
            ) : (
              <ul className="scroll-area -mr-2 flex-1 space-y-2.5 overflow-y-auto pr-2">
                {recent.map((e) => (
                  <li key={e.id} className="border-b border-white/[0.05] pb-2.5 last:border-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[9px] text-slate-700" dir="ltr">
                        {new Date(e.createdAt).toLocaleTimeString("en-GB")}
                      </span>
                      {e.from && e.to && (
                        <span className="font-mono text-[9px] text-[#3b82f6]/80" dir="ltr">
                          {e.from} → {e.to}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-slate-400">
                      {e.summary}
                    </div>
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

/* ══ the scene ════════════════════════════════════════════════════════ */

type SceneApi = {
  setAgents: (agents: Agent[]) => void;
  setEdges: (edges: Edge[]) => void;
  pulse: (from: string, to: string) => void;
  focus: (code: string | null) => void;
  dispose: () => void;
};

const BG = 0x05070c;
/** Machined dark metal for the bodies; near-black glass for the cores. */
const METAL = 0x6b7d96;
const GLASS = 0x0d1219;

let maxAnisotropy = 1;

function buildScene(mount: HTMLElement, onPick: (code: string) => void): SceneApi {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setClearColor(BG, 1);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  mount.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  // Fog in the background colour: distant nodes sink into the dark instead of
  // ending at a hard edge, which is most of the depth in the frame.
  scene.fog = new THREE.Fog(BG, 26, 62);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 200);

  /**
   * A dark studio to reflect.
   *
   * Machined metal is only convincing if there is something for it to catch.
   * RoomEnvironment is a bright white room and would wash this out, so this is
   * a near-black box with a few cool strip lights — the same thing a product
   * photographer would build, and the reason the bodies read as milled rather
   * than as flat grey.
   */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(studioEnvironment(), 0.03);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 1.0;
  pmrem.dispose();

  scene.add(new THREE.AmbientLight(0x3b4a63, 0.75));
  const key = new THREE.DirectionalLight(0xd6e4ff, 2.1);
  key.position.set(-14, 20, 10);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7aa0e6, 1.6);
  rim.position.set(16, 8, -14);
  scene.add(rim);

  /* ── the floor ─────────────────────────────────────────────────────── */
  // Glossy near-black, catching the studio strips as a soft sheen. A true
  // mirror was tried first and cost a second full scene render, reflected the
  // labels as mirrored nonsense, and washed the frame grey for its trouble.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({
      color: 0x070a11, metalness: 0.15, roughness: 0.85,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // A faint technical grid: it makes the floor a plane you can read distance
  // on, which an empty black void does not.
  const grid = new THREE.GridHelper(80, 40, 0x2b3f66, 0x18233a);
  grid.position.y = 0.004;
  const gridMat = grid.material as THREE.Material;
  gridMat.transparent = true;
  gridMat.opacity = 0.55;
  scene.add(grid);

  /* ── nodes ─────────────────────────────────────────────────────────── */
  type Node = {
    group: THREE.Group;
    core: THREE.Mesh;
    coreMat: THREE.MeshStandardMaterial;
    halo: THREE.Sprite;
    ring: THREE.Mesh;
    label: Label;
    agent: Agent | null;
    phase: number;
  };
  const nodes = new Map<string, Node>();
  const nodePos = new Map<string, THREE.Vector3>();
  const picks: THREE.Object3D[] = [];

  const BODY_GEO = new THREE.CylinderGeometry(0.62, 0.72, 0.16, 48);
  const COLLAR_GEO = new THREE.TorusGeometry(0.63, 0.018, 8, 60);
  const CORE_GEO = new THREE.IcosahedronGeometry(0.32, 2);
  const RING_GEO = new THREE.RingGeometry(0.82, 0.86, 64);
  const metalMat = new THREE.MeshStandardMaterial({
    color: METAL, metalness: 0.75, roughness: 0.3,
  });
  const collarMat = new THREE.MeshStandardMaterial({
    color: 0x93a6c4, metalness: 1, roughness: 0.14,
  });

  function makeNode(id: string, label: string, x: number, z: number): Node {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const body = new THREE.Mesh(BODY_GEO, metalMat);
    body.position.y = 0.08;
    body.userData.code = id;
    group.add(body);
    picks.push(body);

    const collar = new THREE.Mesh(COLLAR_GEO, collarMat);
    collar.rotation.x = -Math.PI / 2;
    collar.position.y = 0.165;
    group.add(collar);

    // The core is the only lit thing on a node, and it is what blooms.
    const coreMat = new THREE.MeshStandardMaterial({
      color: GLASS, metalness: 0.1, roughness: 0.08,
      emissive: 0x5a6b85, emissiveIntensity: 2.2,
    });
    const core = new THREE.Mesh(CORE_GEO, coreMat);
    core.position.y = 0.52;
    core.userData.code = id;
    group.add(core);
    picks.push(core);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(), color: 0x5a6b85,
        transparent: true, opacity: 0.45, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false,
      }),
    );
    halo.scale.set(1.5, 1.5, 1);
    halo.position.y = 0.52;
    group.add(halo);

    const ring = new THREE.Mesh(
      RING_GEO,
      new THREE.MeshBasicMaterial({
        color: 0x5a6b85, transparent: true, opacity: 0.4,
        side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    group.add(ring);

    const lab = makeLabel(label);
    group.add(lab.sprite);

    scene.add(group);
    nodePos.set(id, new THREE.Vector3(x, 0.52, z));
    return {
      group, core, coreMat, halo, ring, label: lab,
      agent: null, phase: Math.random() * Math.PI * 2,
    };
  }

  // Fixed endpoints exist whatever the roster says.
  for (const [id, meta] of Object.entries(EXTRA_NODES)) {
    const n = makeNode(id, meta.label, meta.pos[0], meta.pos[1]);
    paint(n, 0x6d84a8, 1.1);
    nodes.set(id, n);
  }

  function paint(n: Node, color: number, intensity: number) {
    n.coreMat.emissive.setHex(color);
    n.coreMat.emissiveIntensity = intensity;
    (n.halo.material as THREE.SpriteMaterial).color.setHex(color);
    (n.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  function setAgents(agents: Agent[]) {
    const seen = new Set(Object.keys(EXTRA_NODES));
    const byZone = new Map<string, Agent[]>();
    for (const a of agents) {
      const list = byZone.get(a.zone) ?? [];
      list.push(a);
      byZone.set(a.zone, list);
    }

    for (const [zone, list] of Array.from(byZone.entries())) {
      const [zx, zz] = ZONE_POS[zone] ?? [0, 0];
      list.forEach((agent, i) => {
        const offset = (i - (list.length - 1) / 2) * 1.9;
        const x = zx + offset;
        const z = zz + (list.length > 1 ? (i % 2 === 0 ? -0.5 : 0.5) : 0);
        seen.add(agent.code);

        let n = nodes.get(agent.code);
        if (!n) {
          n = makeNode(agent.code, agent.name, x, z);
          nodes.set(agent.code, n);
        }
        n.group.position.set(x, 0, z);
        nodePos.set(agent.code, new THREE.Vector3(x, 0.52, z));
        if (n.agent?.state !== agent.state) n.label.draw(agent.name, agent.state);
        n.agent = agent;

        const planned = agent.lifecycle === "planned";
        const color = STATE_COLOR[agent.state] ?? 0x5a6b85;
        // A planned node must never glow like a working one, at any frame.
        paint(n, color, planned ? 0.35 : 2.6);
      });
    }

    // Retire anyone no longer on the roster, or switching business leaves the
    // previous company's nodes standing and dead raycast targets behind them.
    for (const [code, n] of Array.from(nodes.entries())) {
      if (seen.has(code)) continue;
      scene.remove(n.group);
      n.group.traverse((o) => {
        const m = o as THREE.Mesh;
        const i = picks.indexOf(m);
        if (i >= 0) picks.splice(i, 1);
      });
      (n.coreMat as THREE.Material).dispose();
      nodes.delete(code);
      nodePos.delete(code);
    }
  }

  /* ── edges, drawn from real traffic ────────────────────────────────── */
  const edgeGroup = new THREE.Group();
  scene.add(edgeGroup);
  let edgeKey = "";

  function curveBetween(a: THREE.Vector3, b: THREE.Vector3) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += Math.max(0.9, a.distanceTo(b) * 0.16);
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
      // Additive, so the paths read as light rather than as wire.
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curveBetween(a, b), 60, 0.014 + weight * 0.018, 7, false),
        new THREE.MeshBasicMaterial({
          color: 0x60a5fa, transparent: true, opacity: 0.3 + weight * 0.45,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }),
      );
      edgeGroup.add(tube);
    }
    if (complete) edgeKey = k;
  }

  /* ── pulses ────────────────────────────────────────────────────────── */
  const PULSE_GEO = new THREE.SphereGeometry(0.075, 16, 12);
  const pulses: Array<{
    mesh: THREE.Mesh; glow: THREE.Sprite; trail: THREE.Sprite[];
    curve: THREE.QuadraticBezierCurve3; t: number;
  }> = [];

  function pulse(from: string, to: string) {
    const a = nodePos.get(from);
    const b = nodePos.get(to);
    if (!a || !b) return;

    const mesh = new THREE.Mesh(
      PULSE_GEO,
      new THREE.MeshBasicMaterial({ color: 0xdbeafe, toneMapped: false }),
    );
    scene.add(mesh);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(), color: 0x60a5fa, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }),
    );
    glow.scale.set(1.5, 1.5, 1);
    scene.add(glow);

    const trail: THREE.Sprite[] = [];
    for (let i = 0; i < 6; i++) {
      const t = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture(), color: 0x3b82f6, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }),
      );
      const k = 1 - (i + 1) / 8;
      t.scale.set(1.1 * k, 1.1 * k, 1);
      scene.add(t);
      trail.push(t);
    }
    pulses.push({ mesh, glow, trail, curve: curveBetween(a, b), t: 0 });
  }

  /* ── camera ────────────────────────────────────────────────────────── */
  const orb = { a: Math.PI * 0.5, p: 0.74, r: 37, drag: false, lx: 0, ly: 0, spin: true };
  const want = { a: orb.a, p: orb.p, r: orb.r };
  const lookAt = new THREE.Vector3(0, 0.6, 2.2);
  const lookWant = new THREE.Vector3(0, 0.6, 2.2);
  let focused: string | null = null;

  function focus(code: string | null) {
    focused = code;
    const p = code ? nodePos.get(code) : null;
    if (p) {
      lookWant.set(p.x, 0.6, p.z);
      want.r = 13;
      orb.spin = false;
      setTimeout(() => { orb.spin = true; }, 9000);
    } else {
      lookWant.set(0, 0.6, 2.2);
      want.r = 37;
    }
  }

  function place() {
    const p = Math.max(0.34, Math.min(1.05, orb.p));
    camera.position.set(
      lookAt.x + Math.cos(orb.a) * Math.sin(p) * orb.r,
      Math.cos(p) * orb.r + 1.4,
      lookAt.z + Math.sin(orb.a) * Math.sin(p) * orb.r,
    );
    camera.lookAt(lookAt);
  }

  const el = renderer.domElement;
  let downAt = { x: 0, y: 0 };
  const onDown = (e: PointerEvent) => {
    orb.drag = true; orb.spin = false;
    orb.lx = e.clientX; orb.ly = e.clientY;
    downAt = { x: e.clientX, y: e.clientY };
    el.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!orb.drag) return;
    want.a -= (e.clientX - orb.lx) * 0.005;
    want.p = Math.max(0.34, Math.min(1.05, want.p - (e.clientY - orb.ly) * 0.003));
    orb.lx = e.clientX; orb.ly = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    if (!orb.drag) return;
    orb.drag = false;
    try { el.releasePointerCapture(e.pointerId); } catch { /* capture already gone */ }
    setTimeout(() => { orb.spin = true; }, 7000);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    want.r = Math.max(8, Math.min(46, want.r + e.deltaY * 0.022));
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

  /* ── post ──────────────────────────────────────────────────────────── */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Bloom is not decoration here: it is what makes a lit core read as a light
  // source rather than a pale dot, and it is why the whole scene can stay
  // near-black and still have somewhere for the eye to go.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.46, 0.5, 0.78);
  composer.addPass(bloom);
  const vignette = new ShaderPass(VignetteShader);
  vignette.uniforms.offset.value = 0.95;
  vignette.uniforms.darkness.value = 0.85;
  composer.addPass(vignette);
  composer.addPass(new OutputPass());

  function resize() {
    const w = mount.clientWidth || 1;
    const h = mount.clientHeight || 1;
    // 1.5 rather than 2: the composer shades every pixel several times over,
    // and at this flat-shaded style the difference is not visible.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
    camera.aspect = w / h;
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

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.getElapsedTime();
    const k = Math.min(1, dt * 4);

    if (orb.spin && !orb.drag && !reduced) want.a += dt * 0.026;
    orb.a = ease(orb.a, want.a, k);
    orb.p = ease(orb.p, want.p, k);
    orb.r = ease(orb.r, want.r, k);
    lookAt.lerp(lookWant, k);
    place();

    nodes.forEach((n, code) => {
      const agent = n.agent;
      const planned = agent?.lifecycle === "planned";
      const active = !!agent && !planned
        && agent.state !== "idle" && agent.state !== "offline";
      const sel = code === focused;

      n.core.rotation.y += dt * (active ? 0.9 : 0.18);
      n.core.rotation.x += dt * (active ? 0.4 : 0.07);
      n.core.position.y = 0.52 + (reduced ? 0 : Math.sin(t * 1.1 + n.phase) * 0.035);
      n.halo.position.y = n.core.position.y;

      const beat = active ? 0.55 + Math.abs(Math.sin(t * 2.2 + n.phase)) * 0.65 : 0.34;
      (n.halo.material as THREE.SpriteMaterial).opacity =
        (planned ? 0.1 : beat) + (sel ? 0.25 : 0);
      const scale = (planned ? 1.1 : active ? 1.85 : 1.45) + (sel ? 0.35 : 0);
      n.halo.scale.set(scale, scale, 1);

      const ringMat = n.ring.material as THREE.MeshBasicMaterial;
      ringMat.opacity = (planned ? 0.12 : 0.34) +
        (active ? Math.abs(Math.sin(t * 2.2 + n.phase)) * 0.45 : 0) + (sel ? 0.3 : 0);

      // Always named. The label dims when the node is quiet rather than
      // disappearing, or the network is a field of anonymous lights.
      const labMat = n.label.sprite.material as THREE.SpriteMaterial;
      labMat.opacity = sel ? 1 : active ? 0.95 : planned ? 0.34 : 0.6;
    });

    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += dt * 0.62;
      if (p.t >= 1) {
        for (const m of [p.mesh, p.glow, ...p.trail]) {
          scene.remove(m);
          (m.material as THREE.Material).dispose();
        }
        p.mesh.geometry.dispose();
        pulses.splice(i, 1);
        continue;
      }
      const at = p.curve.getPoint(p.t);
      p.mesh.position.copy(at);
      p.glow.position.copy(at);
      const fade = Math.sin(p.t * Math.PI);
      (p.glow.material as THREE.SpriteMaterial).opacity = 0.35 + fade * 0.5;
      p.trail.forEach((m, j) => {
        m.position.copy(p.curve.getPoint(Math.max(0, p.t - (j + 1) * 0.028)));
        (m.material as THREE.SpriteMaterial).opacity = fade * 0.42 * (1 - (j + 1) / 8);
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
      envRT.dispose();
      composer.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
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

/** A near-black room with a few cool strips — something for metal to catch. */
function studioEnvironment(): THREE.Scene {
  const env = new THREE.Scene();
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(12, 8, 12),
    new THREE.MeshBasicMaterial({ color: 0x070a10, side: THREE.BackSide }),
  );
  env.add(shell);

  const strip = (x: number, y: number, z: number, w: number, h: number, i: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(i) }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, y, 0);
    env.add(m);
  };
  strip(0, 2.6, -5.6, 9, 0.8, 0.5);
  strip(-5.6, 1.4, 0, 7, 0.5, 0.3);
  strip(5.6, 2.0, 0, 5, 0.4, 0.22);
  strip(0, 3.6, 5.6, 6, 0.45, 0.18);
  return env;
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
    grd.addColorStop(0.18, "rgba(255,255,255,0.55)");
    grd.addColorStop(0.45, "rgba(255,255,255,0.13)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
  }
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}

let _falloff: THREE.CanvasTexture | null = null;
/** Opaque at the edges, clear in the middle: fades the mirror out with distance. */
function falloffTexture(): THREE.CanvasTexture {
  if (_falloff) return _falloff;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, "rgba(0,0,0,0)");
    grd.addColorStop(0.3, "rgba(0,0,0,0.25)");
    grd.addColorStop(0.62, "rgba(0,0,0,0.9)");
    grd.addColorStop(1, "rgba(0,0,0,1)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
  }
  _falloff = new THREE.CanvasTexture(c);
  return _falloff;
}

type Label = { sprite: THREE.Sprite; draw: (name: string, state: string) => void };

/** Small, unlit, high-contrast type. Never touched by exposure or bloom. */
function makeLabel(name: string): Label {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 84;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, toneMapped: false,
    }),
  );
  sprite.scale.set(2.2, 0.58, 1);
  sprite.position.y = 1.45;
  sprite.renderOrder = 20;

  const draw = (label: string, state: string) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.direction = "rtl";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = '600 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = "#e8eefb";
    ctx.fillText(label, canvas.width / 2, 28, canvas.width - 24);

    if (state) {
      ctx.font = '500 21px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = hex(STATE_COLOR[state] ?? 0x5a6b85);
      ctx.fillText(STATE_AR[state] ?? state, canvas.width / 2, 60, canvas.width - 24);
    }
    tex.needsUpdate = true;
  };
  draw(name, "");
  return { sprite, draw };
}
