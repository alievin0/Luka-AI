"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/**
 * The agent world.
 *
 * A mirror of the running system, not a separate animation. Agents, their
 * states, and every moving pulse come from `/api/desk`, which returns what the
 * pipeline actually wrote. An agent shown working is working; an agent drawn
 * faded has no code behind it yet and can never be animated as busy.
 *
 * The connections between agents are not drawn from a diagram either: each one
 * appears because a real message travelled that edge, and thickens the more
 * traffic it carries. A fresh install shows an empty floor, which is the
 * truth — the map draws itself as the system is used.
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

const STATE_COLOR: Record<string, number> = {
  idle: 0x8fa0bd, working: 0x2f6bf0, processing: 0x2f6bf0, waiting: 0xe0972c,
  using_tool: 0x8257e6, escalated: 0xdc4436, error: 0xdc4436,
  offline: 0xbcc5d4, deploying: 0x16a36a,
};

/** The colours the legend explains, in the order it lists them. */
const LEGEND: Array<{ state: string; label: string }> = [
  { state: "working", label: "شغّال" },
  { state: "using_tool", label: "بيستعمل أداة" },
  { state: "waiting", label: "بينتظر" },
  { state: "escalated", label: "حوّل لإنسان" },
  { state: "idle", label: "جاهز" },
  { state: "offline", label: "ما انبنى" },
];

/** Where each zone sits on the floor. */
const ZONE_POS: Record<string, [number, number]> = {
  reception: [0, 1], knowledge: [-8, -3], booking: [8, -3],
  escalation: [0, -8], tools: [-8, 5], supervision: [8, 5],
  workshop: [12, 0], business: [0, -13],
};

/** Nodes that are not agents but do appear as event endpoints. */
const EXTRA_NODES: Record<string, { label: string; pos: [number, number]; color: number }> = {
  customer: { label: "الزبون", pos: [0, 11], color: 0x16a36a },
  "channel-web": { label: "المتصفح", pos: [-5, 7.5], color: 0x8257e6 },
  "channel-voice": { label: "الصوت", pos: [5, 7.5], color: 0x64748b },
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

  /* ── data ─────────────────────────────────────────────────────────── */
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

  /**
   * The map of the system, derived from traffic rather than declared. An edge
   * exists because messages crossed it, and its weight is how many.
   */
  const edges = useMemo<Edge[]>(() => {
    const counts = new Map<string, Edge>();
    for (const e of events) {
      if (!e.from || !e.to || e.from === e.to) continue;
      const key = `${e.from}→${e.to}`;
      const hit = counts.get(key);
      if (hit) hit.count += 1;
      else counts.set(key, { from: e.from, to: e.to, count: 1 });
    }
    return Array.from(counts.values());
  }, [events]);

  useEffect(() => { sceneApi.current?.setAgents(agents); }, [agents]);
  useEffect(() => { sceneApi.current?.setEdges(edges); }, [edges]);
  useEffect(() => { sceneApi.current?.focus(selected); }, [selected]);

  /* New events since the last poll become pulses in the scene. */
  useEffect(() => {
    if (!sceneApi.current) return;
    const fresh = events.filter((e) => !seenEvents.current.has(e.id));
    // The first batch is history, not news: adopt it silently, otherwise
    // opening the page replays every event ever recorded in one burst.
    const replay = primed.current;
    primed.current = true;
    // Oldest first, so a burst animates in the order it happened.
    for (const e of [...fresh].reverse()) {
      seenEvents.current.add(e.id);
      if (replay && e.from && e.to) sceneApi.current.pulse(e.from, e.to);
    }
  }, [events]);

  /* ── scene ────────────────────────────────────────────────────────── */
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
    <div className="flex h-screen flex-col bg-[#0b1220] text-slate-100">
      <header className="z-10 flex flex-wrap items-center gap-3 border-b border-white/10 bg-[#0e162a] px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-lg">🌐</div>
        <div className="flex-1">
          <h1 className="text-base font-bold leading-tight">عالم الوكلاء</h1>
          <p className="text-[11px] text-slate-400">
            مرآة للنظام — الحالات والخطوط والحركة كلها من نشرتك الحقيقية
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
            🧩 مبني <b className="font-mono">{live.length}</b>
            <span className="text-slate-500">/{agents.length}</span>
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
            ⚡️ شغّال الآن <b className="font-mono">{busy.length}</b>
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
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
          className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-400"
        >
          {businesses.map((b) => (
            <option key={b.id} value={b.id} className="bg-[#0e162a]">{b.name}</option>
          ))}
        </select>
        <a
          href="/desk"
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          احكي معهم ←
        </a>
      </header>

      {storage && !storage.persistent && (
        <div className="z-10 border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-center text-[11px] text-amber-300">
          🗄️ التخزين بالذاكرة — الأحداث والمسارات بتنمسح مع كل نشر.
        </div>
      )}
      {error && (
        <div className="z-10 border-b border-red-500/20 bg-red-500/10 px-4 py-1.5 text-center text-[11px] text-red-300">
          ⚠️ {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div ref={mountRef} className="relative flex-1">
          {/* Depth at the edges, so the floor reads as a space rather than a page. */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ boxShadow: "inset 0 0 180px 60px rgba(4,8,18,0.75)" }}
          />

          <div className="pointer-events-none absolute right-4 top-4 rounded-2xl border border-white/10 bg-black/35 p-3 backdrop-blur-sm">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              الألوان
            </p>
            <ul className="space-y-1">
              {LEGEND.map((l) => (
                <li key={l.state} className="flex items-center gap-2 text-[11px] text-slate-300">
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
            <div className="pointer-events-none absolute inset-x-0 top-1/2 flex justify-center">
              <p className="pointer-events-auto rounded-2xl border border-white/10 bg-black/50 px-5 py-3 text-center text-xs text-slate-300 backdrop-blur-sm">
                الوكلاء واقفين بأماكنهم، بس ما في مسارات لسّا.
                <br />
                <a className="text-brand-300 underline" href="/desk">افتح لوحة التجربة</a> واحكي
                معهم — كل رسالة بترسم خط جديد هون.
              </p>
            </div>
          )}

          <p className="pointer-events-none absolute bottom-3 right-4 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[11px] text-slate-400 backdrop-blur-sm">
            اسحب لتدوير · عجلة الماوس للتقريب · اضغط على وكيل
          </p>
        </div>

        <aside className="flex w-[350px] shrink-0 flex-col overflow-hidden border-r border-white/10 bg-[#0e162a]">
          <section className="border-b border-white/10 p-4">
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              الوكيل المحدّد
            </h2>
            {current ? (
              <>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold">{current.name}</h3>
                  <span
                    className="rounded-md border px-2 py-0.5 text-[10px] font-semibold"
                    style={{
                      color: hex(STATE_COLOR[current.state] ?? 0x8fa0bd),
                      borderColor: "currentColor",
                    }}
                  >
                    {STATE_AR[current.state] ?? current.state}
                  </span>
                </div>
                <p className="text-xs text-slate-400">{current.role}</p>
                <dl className="mt-3 space-y-1.5 text-xs">
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-slate-500">المنطقة</dt>
                    <dd className="text-slate-300">{ZONE_AR[current.zone] ?? current.zone}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-slate-500">الحالة</dt>
                    <dd className="text-slate-300">
                      {current.lifecycle === "live" ? "كوده مكتوب" : "تصميم — ما انبنى"}
                    </dd>
                  </div>
                </dl>
                {current.capabilities.length > 0 && (
                  <>
                    <h4 className="mt-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                      بيقدر يعمل
                    </h4>
                    <ul className="mt-1 space-y-0.5 text-xs text-slate-300">
                      {current.capabilities.map((c) => <li key={c}>• {c}</li>)}
                    </ul>
                  </>
                )}
                {current.permissions.length > 0 && (
                  <>
                    <h4 className="mt-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                      صلاحياته
                    </h4>
                    <p className="mt-1 text-xs text-slate-300">{current.permissions.join(" · ")}</p>
                  </>
                )}
              </>
            ) : (
              <p className="text-xs text-slate-500">اضغط على وكيل بالعالم لتشوف تفاصيله.</p>
            )}
          </section>

          <section className="flex min-h-0 flex-1 flex-col p-4">
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              الأحداث — مباشرة
            </h2>
            {recent.length === 0 ? (
              <p className="text-xs text-slate-500">
                ما في أحداث بعد. افتح{" "}
                <a className="text-brand-300 underline" href="/desk">لوحة التجربة</a> واحكي
                مع الوكيل — وارجع لهون تشوف الحركة.
              </p>
            ) : (
              <ul className="scroll-area -mr-2 flex-1 space-y-1.5 overflow-y-auto pr-2">
                {recent.map((e) => (
                  <li key={e.id} className="border-b border-white/5 pb-1.5 text-xs last:border-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[10px] text-slate-600" dir="ltr">
                        {new Date(e.createdAt).toLocaleTimeString("en-GB")}
                      </span>
                      {e.from && e.to && (
                        <span className="font-mono text-[10px] text-brand-300" dir="ltr">
                          {e.from} → {e.to}
                        </span>
                      )}
                    </div>
                    <div className="text-slate-400">{e.summary}</div>
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

/* ══ the three.js scene ═══════════════════════════════════════════════ */

type SceneApi = {
  setAgents: (agents: Agent[]) => void;
  setEdges: (edges: Edge[]) => void;
  pulse: (from: string, to: string) => void;
  focus: (code: string | null) => void;
  dispose: () => void;
};

const BG_TOP = 0x141f3a;
const BG_BOTTOM = 0x070c18;

function buildScene(mount: HTMLElement, onPick: (code: string) => void): SceneApi {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  mount.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";

  const scene = new THREE.Scene();
  scene.background = gradientTexture();
  // Fog tinted to the horizon colour: distant zones recede instead of floating.
  scene.fog = new THREE.Fog(BG_BOTTOM, 34, 78);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);

  /* lighting */
  scene.add(new THREE.HemisphereLight(0x9ec1ff, 0x0a1020, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(12, 24, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -30; key.shadow.camera.right = 30;
  key.shadow.camera.top = 30; key.shadow.camera.bottom = -30;
  key.shadow.bias = -0.0008;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x5b8cff, 0.6);
  rim.position.set(-14, 8, -12);
  scene.add(rim);

  /* floor */
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(30, 72),
    new THREE.MeshStandardMaterial({ color: 0x121c33, roughness: 0.92, metalness: 0.05 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(60, 60, 0x2b3c63, 0x1b2745);
  const gridMat = grid.material as THREE.Material;
  gridMat.transparent = true;
  gridMat.opacity = 0.35;
  grid.position.y = 0.012;
  scene.add(grid);

  /* ── zone pads ─────────────────────────────────────────────────────── */
  for (const [zone, [x, z]] of Object.entries(ZONE_POS)) {
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 3.35, 0.16, 56),
      new THREE.MeshStandardMaterial({ color: 0x1b2846, roughness: 0.7, metalness: 0.15 }),
    );
    pad.position.set(x, 0.08, z);
    pad.receiveShadow = true;
    scene.add(pad);

    const rimRing = new THREE.Mesh(
      new THREE.TorusGeometry(3.3, 0.045, 10, 72),
      new THREE.MeshBasicMaterial({ color: 0x3f5f9e, transparent: true, opacity: 0.45 }),
    );
    rimRing.rotation.x = -Math.PI / 2;
    rimRing.position.set(x, 0.17, z);
    scene.add(rimRing);

    scene.add(billboard(ZONE_AR[zone] ?? zone, "#93a6c9", 26, x, 0.42, z + 4.1, 3.4));
  }

  /* ── non-agent endpoints ───────────────────────────────────────────── */
  const nodePos = new Map<string, THREE.Vector3>();
  for (const [id, meta] of Object.entries(EXTRA_NODES)) {
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(1.05, 1.2, 0.42, 36),
      new THREE.MeshStandardMaterial({
        color: meta.color, roughness: 0.4, metalness: 0.3,
        emissive: meta.color, emissiveIntensity: 0.25,
      }),
    );
    disc.position.set(meta.pos[0], 0.24, meta.pos[1]);
    disc.castShadow = true;
    scene.add(disc);
    scene.add(billboard(meta.label, "#cbd5e1", 28, meta.pos[0], 1.35, meta.pos[1], 2.4));
    nodePos.set(id, new THREE.Vector3(meta.pos[0], 0.9, meta.pos[1]));
  }

  /* ── agents ────────────────────────────────────────────────────────── */
  type Figure = {
    group: THREE.Group;
    ring: THREE.Mesh;
    halo: THREE.Mesh;
    glow: THREE.Mesh;
    label: Label;
    agent: Agent;
    phase: number;
    facing: number;
  };
  const figures = new Map<string, Figure>();
  const picks: THREE.Object3D[] = [];
  const pulses: Array<{
    mesh: THREE.Mesh; trail: THREE.Mesh[]; curve: THREE.QuadraticBezierCurve3; t: number;
  }> = [];
  const flashes: Array<{ mesh: THREE.Mesh; t: number }> = [];

  function setAgents(agents: Agent[]) {
    // Group by zone so several agents in one zone fan out instead of stacking.
    const byZone = new Map<string, Agent[]>();
    for (const a of agents) {
      const list = byZone.get(a.zone) ?? [];
      list.push(a);
      byZone.set(a.zone, list);
    }

    for (const [zone, list] of Array.from(byZone.entries())) {
      const [zx, zz] = ZONE_POS[zone] ?? [0, 0];
      list.forEach((agent, i) => {
        const angle = (i / Math.max(1, list.length)) * Math.PI * 2 - Math.PI / 2;
        const r = list.length > 1 ? 1.65 : 0;
        const x = zx + Math.cos(angle) * r;
        const z = zz + Math.sin(angle) * r;

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
        nodePos.set(agent.code, new THREE.Vector3(x, 0.95, z));
        if (changed) fig.label.draw(agent);
        applyState(fig);
      });
    }
  }

  function applyState(fig: Figure) {
    const planned = fig.agent.lifecycle === "planned";
    const color = STATE_COLOR[fig.agent.state] ?? 0x8fa0bd;
    fig.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.fixed) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat?.color) return;
      mat.color.setHex(color);
      if (mat.emissive) {
        mat.emissive.setHex(color);
        mat.emissiveIntensity = planned ? 0.05 : 0.22;
      }
      mat.transparent = planned;
      mat.opacity = planned ? 0.3 : 1;
    });
    for (const m of [fig.ring, fig.halo, fig.glow]) {
      (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    }
    // A planned agent must never look busy, whatever the rest of the scene does.
    fig.halo.visible = !planned && fig.agent.state !== "idle";
  }

  /* ── edges, drawn from real traffic ────────────────────────────────── */
  const edgeGroup = new THREE.Group();
  scene.add(edgeGroup);
  let edgeKey = "";

  function curveBetween(a: THREE.Vector3, b: THREE.Vector3): THREE.QuadraticBezierCurve3 {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    // Lift proportional to span, so long hops arc higher and never overlap.
    mid.y += Math.max(1.4, a.distanceTo(b) * 0.24);
    return new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
  }

  function setEdges(edges: Edge[]) {
    const key = edges.map((e) => `${e.from}>${e.to}:${e.count}`).sort().join("|");
    if (key === edgeKey) return;

    // Rebuild wholesale: a handful of tubes, and polling would otherwise leak
    // geometry on every change.
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
        // cache this key, or the edge would never be retried once it can be.
        complete = false;
        continue;
      }
      const weight = e.count / heaviest;
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curveBetween(a, b), 36, 0.02 + weight * 0.05, 7, false),
        new THREE.MeshBasicMaterial({
          color: 0x4d7fe8,
          transparent: true,
          opacity: 0.16 + weight * 0.34,
        }),
      );
      edgeGroup.add(tube);
    }
    if (complete) edgeKey = key;
  }

  /* ── pulses ────────────────────────────────────────────────────────── */
  const TRAIL = 5;
  function pulse(from: string, to: string) {
    const a = nodePos.get(from);
    const b = nodePos.get(to);
    if (!a || !b) return;

    const geo = new THREE.SphereGeometry(0.17, 14, 12);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: 0xbcd4ff, transparent: true, opacity: 1 }),
    );
    scene.add(mesh);

    const trail: THREE.Mesh[] = [];
    for (let i = 0; i < TRAIL; i++) {
      const t = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: 0x5b8cff, transparent: true, opacity: 0 }),
      );
      t.scale.setScalar(1 - (i + 1) / (TRAIL + 1));
      scene.add(t);
      trail.push(t);
    }
    pulses.push({ mesh, trail, curve: curveBetween(a, b), t: 0 });
  }

  /** A ring that expands where a pulse lands, so arrival is legible. */
  function flash(at: THREE.Vector3) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.42, 36),
      new THREE.MeshBasicMaterial({
        color: 0x9dc0ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(at.x, 0.2, at.z);
    scene.add(mesh);
    flashes.push({ mesh, t: 0 });
  }

  /* ── camera ────────────────────────────────────────────────────────── */
  const orb = { a: Math.PI * 0.5, p: 0.78, r: 36, drag: false, lx: 0, ly: 0, spin: true };
  const want = { a: orb.a, p: orb.p, r: orb.r };
  const lookAt = new THREE.Vector3(0, 1, 0);
  const lookWant = new THREE.Vector3(0, 1, 0);
  let focused: string | null = null;

  function focus(code: string | null) {
    focused = code;
    const p = code ? nodePos.get(code) : null;
    if (p) {
      lookWant.set(p.x, 1, p.z);
      want.r = 20;
      orb.spin = false;
      setTimeout(() => { orb.spin = true; }, 8000);
    } else {
      lookWant.set(0, 1, 0);
      want.r = 36;
    }
  }

  function place() {
    const p = Math.max(0.18, Math.min(1.32, orb.p));
    camera.position.set(
      lookAt.x + Math.cos(orb.a) * Math.sin(p) * orb.r,
      Math.cos(p) * orb.r + 1,
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
    want.p = Math.max(0.18, Math.min(1.32, want.p - (e.clientY - orb.ly) * 0.004));
    orb.lx = e.clientX; orb.ly = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    if (!orb.drag) return;
    orb.drag = false;
    try { el.releasePointerCapture(e.pointerId); } catch { /* capture already gone */ }
    setTimeout(() => { orb.spin = true; }, 6000);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    want.r = Math.max(10, Math.min(60, want.r + e.deltaY * 0.03));
  };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const onClick = (e: MouseEvent) => {
    // A drag that ends over a figure is not a click on it.
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

    if (orb.spin && !orb.drag && !reduced) want.a += dt * 0.03;
    orb.a = ease(orb.a, want.a, k);
    orb.p = ease(orb.p, want.p, k);
    orb.r = ease(orb.r, want.r, k);
    lookAt.lerp(lookWant, k);
    place();

    figures.forEach((fig, code) => {
      const planned = fig.agent.lifecycle === "planned";
      const active = !planned && fig.agent.state !== "idle" && fig.agent.state !== "offline";

      // Breathing at rest, a quicker lift when working: the difference is what
      // reads as "this one is doing something".
      fig.group.position.y = active
        ? Math.sin(t * 3.4 + fig.phase) * 0.06
        : Math.sin(t * 0.9 + fig.phase) * 0.018;

      // Idle agents drift their gaze; active ones settle and get on with it.
      const drift = active ? 0 : Math.sin(t * 0.35 + fig.phase) * 0.5;
      fig.facing = ease(fig.facing, drift, dt * 1.6);
      fig.group.rotation.y = fig.facing;

      const sel = code === focused;
      const target = sel ? 1.16 : 1;
      fig.group.scale.setScalar(ease(fig.group.scale.x, target, k));

      const ringMat = fig.ring.material as THREE.MeshBasicMaterial;
      ringMat.opacity = (planned ? 0.14 : 0.3) +
        (active ? Math.abs(Math.sin(t * 2.6 + fig.phase)) * 0.45 : 0.06) +
        (sel ? 0.25 : 0);

      if (fig.halo.visible) {
        fig.halo.rotation.z = t * 1.6 + fig.phase;
        (fig.halo.material as THREE.MeshBasicMaterial).opacity =
          0.35 + Math.abs(Math.sin(t * 2.2 + fig.phase)) * 0.4;
      }
      (fig.glow.material as THREE.MeshBasicMaterial).opacity = planned ? 0.04 : active ? 0.16 : 0.08;
    });

    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += dt * 0.75;
      if (p.t >= 1) {
        flash(p.curve.getPoint(1));
        scene.remove(p.mesh);
        for (const m of p.trail) {
          scene.remove(m);
          (m.material as THREE.Material).dispose();
        }
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        pulses.splice(i, 1);
        continue;
      }
      p.mesh.position.copy(p.curve.getPoint(p.t));
      const fade = Math.sin(p.t * Math.PI);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 + fade * 0.5;
      p.trail.forEach((m, j) => {
        const lag = Math.max(0, p.t - (j + 1) * 0.035);
        m.position.copy(p.curve.getPoint(lag));
        (m.material as THREE.MeshBasicMaterial).opacity =
          fade * 0.5 * (1 - (j + 1) / (TRAIL + 1));
      });
    }

    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.t += dt * 1.8;
      if (f.t >= 1) {
        scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        (f.mesh.material as THREE.Material).dispose();
        flashes.splice(i, 1);
        continue;
      }
      f.mesh.scale.setScalar(1 + f.t * 3.5);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - f.t) * 0.8;
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

type Label = { sprite: THREE.Sprite; draw: (agent: Agent) => void };

function makeFigure(agent: Agent, picks: THREE.Object3D[]) {
  const group = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({
    color: 0x8fa0bd, roughness: 0.38, metalness: 0.22,
    emissive: 0x8fa0bd, emissiveIntensity: 0.2,
  });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.46, 8, 20), shell);
  body.position.y = 0.66;
  body.castShadow = true;
  body.userData.code = agent.code;
  group.add(body);
  picks.push(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.29, 24, 18), shell);
  head.position.y = 1.32;
  head.castShadow = true;
  head.userData.code = agent.code;
  group.add(head);
  picks.push(head);

  // A dark visor reads as a face and gives the figure a front to turn.
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 24, 18, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.26),
    new THREE.MeshStandardMaterial({
      color: 0x0b1120, roughness: 0.18, metalness: 0.6,
      emissive: 0x2a3d63, emissiveIntensity: 0.5,
    }),
  );
  visor.position.y = 1.32;
  visor.rotation.x = -0.28;
  visor.userData.fixed = true;
  group.add(visor);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.52, 0.66, 40),
    new THREE.MeshBasicMaterial({
      color: 0x8fa0bd, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.035;
  ring.userData.fixed = true;
  group.add(ring);

  // A soft pool of light under the figure, standing in for a bounce light.
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(1.15, 36),
    new THREE.MeshBasicMaterial({
      color: 0x8fa0bd, transparent: true, opacity: 0.08,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.025;
  glow.userData.fixed = true;
  group.add(glow);

  // Only shown while the agent is doing something — never for a planned one.
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.4, 0.028, 8, 40, Math.PI * 1.35),
    new THREE.MeshBasicMaterial({ color: 0x8fa0bd, transparent: true, opacity: 0.6 }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 1.78;
  halo.visible = false;
  halo.userData.fixed = true;
  group.add(halo);

  const label = makeLabel(agent);
  group.add(label.sprite);

  return {
    group, ring, halo, glow, label, agent,
    phase: Math.random() * Math.PI * 2,
    facing: 0,
  };
}

/**
 * Name and state on a sprite above the agent.
 *
 * A sprite rather than text on the floor: it always faces the camera, so the
 * labels stay readable while the view orbits. The browser shapes the Arabic on
 * a canvas — three.js cannot.
 */
function makeLabel(agent: Agent): Label {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  sprite.scale.set(3, 1, 1);
  sprite.position.y = 2.35;
  sprite.userData.fixed = true;
  sprite.renderOrder = 10;

  const draw = (a: Agent) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.direction = "rtl";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const state = STATE_AR[a.state] ?? a.state;
    const color = hex(STATE_COLOR[a.state] ?? 0x8fa0bd);
    const dim = a.lifecycle === "planned";

    ctx.fillStyle = dim ? "rgba(10,16,30,0.5)" : "rgba(10,16,30,0.72)";
    roundRect(ctx, 12, 14, canvas.width - 24, 100, 22);
    ctx.fill();
    ctx.strokeStyle = color + (dim ? "55" : "aa");
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.font = '600 38px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = dim ? "rgba(226,232,240,0.55)" : "#e8eefc";
    ctx.fillText(a.name, canvas.width / 2, 50, canvas.width - 60);

    ctx.font = '500 27px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(state, canvas.width / 2, 90, canvas.width - 60);

    tex.needsUpdate = true;
  };
  draw(agent);
  return { sprite, draw };
}

/** A standing caption for a zone or a fixed node. */
function billboard(
  text: string, color: string, size: number,
  x: number, y: number, z: number, width: number,
): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.direction = "rtl";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${size * 1.6}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 24);
  }
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false,
    }),
  );
  sprite.scale.set(width, width * 0.25, 1);
  sprite.position.set(x, y, z);
  return sprite;
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

/** A vertical gradient standing in for a sky, so the scene has a horizon. */
function gradientTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, hex(BG_TOP));
    g.addColorStop(1, hex(BG_BOTTOM));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
