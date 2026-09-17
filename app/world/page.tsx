"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/**
 * The agent world.
 *
 * This is a mirror of the running system, not a separate animation: the
 * agents, their states and every moving pulse come from `/api/desk`, which
 * returns what the pipeline actually wrote. An agent shown working is working;
 * an agent shown offline has no code behind it yet.
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

const ZONE_AR: Record<string, string> = {
  reception: "الاستقبال", booking: "الحجوزات", knowledge: "المعرفة",
  tools: "القنوات والأدوات", escalation: "التصعيد", supervision: "المراقبة",
  workshop: "الورشة", business: "صاحب العمل",
};

const STATE_AR: Record<string, string> = {
  idle: "جاهز", working: "شغّال", processing: "عم يعالج", waiting: "بينتظر",
  using_tool: "بيستعمل أداة", escalated: "حوّل للإنسان", error: "خطأ",
  offline: "غير مبني", deploying: "قيد النشر",
};

const STATE_COLOR: Record<string, number> = {
  idle: 0x9aa6bc, working: 0x3d6df0, processing: 0x3d6df0, waiting: 0xe8a23c,
  using_tool: 0x8b6fe8, escalated: 0xde5240, error: 0xde5240,
  offline: 0xc3cad6, deploying: 0x21a968,
};

/** Where each zone sits on the floor. */
const ZONE_POS: Record<string, [number, number]> = {
  reception: [0, 2], knowledge: [-7, -2], booking: [7, -2],
  escalation: [0, -6], tools: [-7, 5], supervision: [7, 5],
  workshop: [11, 1], business: [0, -11],
};

/** Nodes that are not agents but do appear as event endpoints. */
const EXTRA_NODES: Record<string, { label: string; pos: [number, number]; color: number }> = {
  customer: { label: "الزبون", pos: [0, 10], color: 0x21a968 },
  "channel-web": { label: "المتصفح", pos: [-4, 7], color: 0x8b6fe8 },
  "channel-voice": { label: "الصوت", pos: [4, 7], color: 0xc3cad6 },
};

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
    // Polling, not a socket: the event stream is low-volume and this keeps
    // the deployment free of a stateful connection.
    const timer = setInterval(pull, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, [businessId]);

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

  useEffect(() => {
    sceneApi.current?.setAgents(agents);
  }, [agents]);

  useEffect(() => {
    sceneApi.current?.highlight(selected);
  }, [selected]);

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

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-lg">🌐</div>
        <div className="flex-1">
          <h1 className="text-base font-bold leading-tight">عالم الوكلاء</h1>
          <p className="text-[11px] text-slate-500">
            مرآة للنظام — الوكلاء وحالاتهم والحركة كلها من نشرتك الحقيقية
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-3 py-1.5">
            🧩 مبني <b className="font-mono">{live.length}</b>/<b className="font-mono">{agents.length}</b>
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1.5">
            ⚡️ شغّال الآن <b className="font-mono">{busy.length}</b>
          </span>
        </div>

        <select
          value={businessId}
          onChange={(e) => {
            setBusinessId(e.target.value);
            seenEvents.current.clear();
            primed.current = false;
          }}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400"
        >
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <a
          href="/desk"
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          جرّبه ←
        </a>
      </header>

      {storage && !storage.persistent && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-[11px] text-amber-800">
          🗄️ التخزين بالذاكرة — الأحداث بتنمسح مع كل نشر.
        </div>
      )}
      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-1.5 text-center text-[11px] text-red-700">
          ⚠️ {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div ref={mountRef} className="relative flex-1 bg-slate-100">
          <p className="pointer-events-none absolute bottom-3 right-4 rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-[11px] text-slate-500">
            اسحب لتدوير · اضغط على أي وكيل
          </p>
        </div>

        <aside className="flex w-[340px] shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
          <section className="border-b border-slate-200 p-4">
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              الوكيل المحدّد
            </h2>
            {current ? (
              <>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold">{current.name}</h3>
                  <span
                    className="rounded-md border px-2 py-0.5 text-[10px] font-semibold"
                    style={{
                      color: "#" + (STATE_COLOR[current.state] ?? 0x8390a5).toString(16).padStart(6, "0"),
                      borderColor: "currentColor",
                    }}
                  >
                    {STATE_AR[current.state] ?? current.state}
                  </span>
                </div>
                <p className="text-xs text-slate-500">{current.role}</p>
                <dl className="mt-3 space-y-1.5 text-xs">
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-slate-400">المنطقة</dt>
                    <dd>{ZONE_AR[current.zone] ?? current.zone}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-slate-400">الحالة</dt>
                    <dd>{current.lifecycle === "live" ? "كوده مكتوب" : "تصميم — ما انبنى"}</dd>
                  </div>
                </dl>
                {current.capabilities.length > 0 && (
                  <>
                    <h4 className="mt-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                      بيقدر يعمل
                    </h4>
                    <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                      {current.capabilities.map((c) => <li key={c}>• {c}</li>)}
                    </ul>
                  </>
                )}
                {current.permissions.length > 0 && (
                  <>
                    <h4 className="mt-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                      صلاحياته
                    </h4>
                    <p className="mt-1 text-xs text-slate-600">{current.permissions.join(" · ")}</p>
                  </>
                )}
              </>
            ) : (
              <p className="text-xs text-slate-400">اضغط على وكيل بالعالم لتشوف تفاصيله.</p>
            )}
          </section>

          <section className="flex min-h-0 flex-1 flex-col p-4">
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              الأحداث — مباشرة
            </h2>
            {events.length === 0 ? (
              <p className="text-xs text-slate-400">
                ما في أحداث بعد. افتح <a className="text-brand-600 underline" href="/desk">لوحة التجربة</a> واحكي
                مع الوكيل — وارجع لهون تشوف الحركة.
              </p>
            ) : (
              <ul className="scroll-area -mr-2 flex-1 space-y-1.5 overflow-y-auto pr-2">
                {events.map((e) => (
                  <li key={e.id} className="border-b border-slate-100 pb-1.5 text-xs last:border-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[10px] text-slate-400" dir="ltr">
                        {new Date(e.createdAt).toLocaleTimeString("en-GB")}
                      </span>
                      {e.from && e.to && (
                        <span className="font-mono text-[10px] text-brand-600" dir="ltr">
                          {e.from} → {e.to}
                        </span>
                      )}
                    </div>
                    <div className="text-slate-600">{e.summary}</div>
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

/* ── the three.js scene ────────────────────────────────────────────── */

type SceneApi = {
  setAgents: (agents: Agent[]) => void;
  pulse: (from: string, to: string) => void;
  highlight: (code: string | null) => void;
  dispose: () => void;
};

function buildScene(mount: HTMLElement, onPick: (code: string) => void): SceneApi {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setClearColor(0xf1f5f9, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mount.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd6deea, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(10, 20, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26; key.shadow.camera.right = 26;
  key.shadow.camera.top = 26; key.shadow.camera.bottom = -26;
  key.shadow.bias = -0.0006;
  scene.add(key);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(24, 64),
    new THREE.MeshStandardMaterial({ color: 0xfafbfd, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // zone pads, so the floor reads as a map rather than a void
  for (const [zone, [x, z]] of Object.entries(ZONE_POS)) {
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(3.1, 48),
      new THREE.MeshBasicMaterial({ color: 0xe8edf5, transparent: true, opacity: 0.9 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(x, 0.01, z);
    scene.add(pad);
    scene.add(flatLabel(ZONE_AR[zone] ?? zone, "#94a3b8", x, z + 3.7, 4.4));
  }

  for (const [, meta] of Object.entries(EXTRA_NODES)) {
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.25, 0.3, 32),
      new THREE.MeshStandardMaterial({ color: meta.color, roughness: 0.5 }),
    );
    disc.position.set(meta.pos[0], 0.15, meta.pos[1]);
    disc.castShadow = true;
    scene.add(disc);
    scene.add(flatLabel(meta.label, "#475569", meta.pos[0], meta.pos[1] + 1.9, 3));
  }

  const nodePos = new Map<string, THREE.Vector3>();
  for (const [id, meta] of Object.entries(EXTRA_NODES)) {
    nodePos.set(id, new THREE.Vector3(meta.pos[0], 0.9, meta.pos[1]));
  }

  type Figure = {
    group: THREE.Group; ring: THREE.Mesh; label: THREE.Mesh; agent: Agent; phase: number;
  };
  const figures = new Map<string, Figure>();
  const picks: THREE.Object3D[] = [];
  const pulses: Array<{ mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number }> = [];

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
        const angle = (i / Math.max(1, list.length)) * Math.PI * 2;
        const r = list.length > 1 ? 1.5 : 0;
        const x = zx + Math.cos(angle) * r;
        const z = zz + Math.sin(angle) * r;

        let fig = figures.get(agent.code);
        if (!fig) {
          const label = flatLabel(agent.name, "#334155", x, z + 1.5, 3);
          fig = { ...makeFigure(agent, picks), label };
          scene.add(fig.group);
          scene.add(label);
          figures.set(agent.code, fig);
        }
        fig.agent = agent;
        fig.group.position.set(x, 0, z);
        fig.label.position.set(x, 0.04, z + 1.5);
        nodePos.set(agent.code, new THREE.Vector3(x, 0.9, z));
        applyState(fig);
      });
    }
  }

  function applyState(fig: Figure) {
    const planned = fig.agent.lifecycle === "planned";
    const color = STATE_COLOR[fig.agent.state] ?? 0x9aa6bc;
    fig.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat || !mat.color || (mesh.userData.fixed as boolean)) return;
      mat.color.setHex(color);
      mat.transparent = planned;
      mat.opacity = planned ? 0.28 : 1;
    });
    (fig.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
    (fig.ring.material as THREE.MeshBasicMaterial).opacity = planned ? 0.25 : 0.65;
  }

  function pulse(from: string, to: string) {
    const a = nodePos.get(from);
    const b = nodePos.get(to);
    if (!a || !b) return;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 14, 12),
      new THREE.MeshBasicMaterial({ color: 0x3d6df0, transparent: true, opacity: 0.95 }),
    );
    scene.add(mesh);
    pulses.push({ mesh, from: a.clone(), to: b.clone(), t: 0 });
  }

  let highlighted: string | null = null;
  function highlight(code: string | null) { highlighted = code; }

  /* camera */
  const orb = { a: Math.PI * 0.5, p: 0.72, r: 34, drag: false, lx: 0, ly: 0, spin: true };
  function place() {
    const p = Math.max(0.2, Math.min(1.3, orb.p));
    camera.position.set(
      Math.cos(orb.a) * Math.sin(p) * orb.r,
      Math.cos(p) * orb.r,
      Math.sin(orb.a) * Math.sin(p) * orb.r,
    );
    camera.lookAt(0, 0.8, 0);
  }

  const el = renderer.domElement;
  const onDown = (e: PointerEvent) => {
    orb.drag = true; orb.spin = false; orb.lx = e.clientX; orb.ly = e.clientY;
    el.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!orb.drag) return;
    orb.a -= (e.clientX - orb.lx) * 0.005;
    orb.p -= (e.clientY - orb.ly) * 0.004;
    orb.lx = e.clientX; orb.ly = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    if (!orb.drag) return;
    orb.drag = false;
    try { el.releasePointerCapture(e.pointerId); } catch { /* capture already gone */ }
    setTimeout(() => { orb.spin = true; }, 6000);
  };
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const onClick = (e: MouseEvent) => {
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

  const clock = new THREE.Clock();
  let raf = 0;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.getElapsedTime();
    if (orb.spin && !reduced) orb.a += dt * 0.035;
    place();

    figures.forEach((fig, code) => {
      const active = fig.agent.state !== "idle" && fig.agent.state !== "offline";
      const bob = active ? Math.sin(t * 3.2 + fig.phase) * 0.05 : Math.sin(t * 0.8 + fig.phase) * 0.015;
      fig.group.position.y = bob;
      const sel = code === highlighted;
      fig.group.scale.setScalar(sel ? 1.18 : 1);
      const ringMat = fig.ring.material as THREE.MeshBasicMaterial;
      ringMat.opacity = (fig.agent.lifecycle === "planned" ? 0.2 : 0.45) +
        (active ? Math.abs(Math.sin(t * 2.4 + fig.phase)) * 0.4 : 0.1);
    });

    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += dt * 0.9;
      if (p.t >= 1) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        pulses.splice(i, 1);
        continue;
      }
      p.mesh.position.lerpVectors(p.from, p.to, p.t);
      p.mesh.position.y += Math.sin(p.t * Math.PI) * 2.2;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.sin(p.t * Math.PI);
    }

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    setAgents,
    pulse,
    highlight,
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("click", onClick);
      renderer.dispose();
      if (el.parentElement === mount) mount.removeChild(el);
    },
  };
}

function makeFigure(agent: Agent, picks: THREE.Object3D[]) {
  const group = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x9aa6bc, roughness: 0.45 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 22, 16), shell);
  body.scale.set(1, 1.12, 1);
  body.position.y = 0.5;
  body.castShadow = true;
  body.userData.code = agent.code;
  group.add(body);
  picks.push(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 22, 16), shell);
  head.position.y = 1.12;
  head.castShadow = true;
  head.userData.code = agent.code;
  group.add(head);
  picks.push(head);

  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xeaf6ff, emissiveIntensity: 1.4,
  });
  for (const ex of [-0.11, 0.11]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.058, 12, 10), eyeMat);
    eye.position.set(ex, 1.14, 0.29);
    eye.userData.fixed = true;
    group.add(eye);
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.68, 32),
    new THREE.MeshBasicMaterial({ color: 0x9aa6bc, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.userData.fixed = true;
  group.add(ring);

  return { group, ring, agent, phase: Math.random() * Math.PI * 2 };
}

/** A label drawn flat on the floor — the browser shapes Arabic, three.js cannot. */
function flatLabel(text: string, color: string, x: number, z: number, width: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.font = '600 44px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = "rtl";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 24);

  const tex = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width * 0.1875),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.04, z);
  return mesh;
}
