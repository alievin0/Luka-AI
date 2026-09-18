"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AbilityForm } from "./_components/AbilityForm.tsx";
import { drawScene, drawSparkline } from "./_lib/scene.ts";
import type { CameraMode, Studio } from "./_lib/scene3d.ts";
import {
  DEFAULT_LAYERS,
  emptyScene,
  type AbilityCard,
  type DemoCard,
  type Frame,
  type Layers,
  type LogEntry,
  type OccupancyMap,
  type Outcome,
  type ScenarioCard,
  type WorldSetup,
} from "./_lib/types.ts";

const RISK_STYLE: Record<AbilityCard["risk"], string> = {
  passive: "bg-slate-100 text-slate-600 ring-slate-200",
  motion: "bg-sky-50 text-sky-700 ring-sky-200",
  contact: "bg-amber-50 text-amber-700 ring-amber-200",
  critical: "bg-rose-50 text-rose-700 ring-rose-200",
};

const RISK_LABEL: Record<AbilityCard["risk"], string> = {
  passive: "قراءة",
  motion: "حركة",
  contact: "تلامس",
  critical: "طوارئ",
};

const LOG_FILTERS = [
  { key: "status", label: "الحالة" },
  { key: "safety", label: "الأمان" },
  { key: "warn", label: "تحذيرات" },
  { key: "metric", label: "قياسات" },
  { key: "signal", label: "إشارات" },
] as const;

const HISTORY_LENGTH = 220;

export default function RobotsPage() {
  const [abilities, setAbilities] = useState<AbilityCard[]>([]);
  const [demos, setDemos] = useState<DemoCard[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioCard[]>([]);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);

  const [tab, setTab] = useState<"demos" | "abilities">("demos");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scenario, setScenario] = useState("cluttered-office");
  const [seed, setSeed] = useState("");

  const [running, setRunning] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [speed, setSpeed] = useState(8);
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [hud, setHud] = useState<{ frame: Frame | null }>({ frame: null });
  const [view, setView] = useState<"2d" | "3d">("3d");
  const [camera, setCamera] = useState<CameraMode>("orbit");
  const [studioError, setStudioError] = useState<string | null>(null);

  const sceneRef = useRef(emptyScene());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<HTMLCanvasElement | null>(null);
  const studioRef = useRef<Studio | null>(null);
  const speedChartRef = useRef<HTMLCanvasElement | null>(null);
  const safetyChartRef = useRef<HTMLCanvasElement | null>(null);
  const chargeChartRef = useRef<HTMLCanvasElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  useEffect(() => {
    fetch("/api/robots")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        setAbilities(data.abilities ?? []);
        setDemos(data.demos ?? []);
        setScenarios(data.scenarios ?? []);
      })
      .catch((error: Error) => setCatalogueError(error.message));
  }, []);

  // One render loop for the page's lifetime. Frames land in a ref, so a 16 Hz
  // stream never triggers a React render.
  useEffect(() => {
    let raf = 0;
    let lastHud = 0;
    const loop = (now: number) => {
      const scene = sceneRef.current;
      drawScene(canvasRef.current, scene, layersRef.current);
      drawSparkline(speedChartRef.current, scene.history.speed, {
        color: "#38bdf8",
        min: 0,
        max: 1.3,
      });
      drawSparkline(safetyChartRef.current, scene.history.safety, {
        color: "#34d399",
        min: 0,
        max: 1,
      });
      drawSparkline(chargeChartRef.current, scene.history.charge, {
        color: "#fbbf24",
        min: 0,
        max: 1,
      });
      // The numeric read-out only needs to be legible, not smooth.
      if (now - lastHud > 250) {
        lastHud = now;
        setHud({ frame: scene.frame });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // The studio renderer and its dependency are loaded only if the 3D view is
  // actually opened: three.js is a few hundred kilobytes and the 2D view needs
  // none of it. Its loop is separate from the 2D one above because the two
  // never run at the same time.
  useEffect(() => {
    if (view !== "3d") return;
    const canvas = glRef.current;
    if (!canvas) return;

    let studio: Studio | null = null;
    let raf = 0;
    let observer: ResizeObserver | null = null;
    let cancelled = false;

    import("./_lib/scene3d.ts")
      .then(({ Studio: Ctor }) => {
        if (cancelled) return;
        studio = new Ctor(canvas);
        studioRef.current = studio;
        studio.setMode(cameraRef.current);
        studio.resize();
        setStudioError(null);

        observer = new ResizeObserver(() => studio?.resize());
        if (canvas.parentElement) observer.observe(canvas.parentElement);

        const loop = () => {
          studio?.sync(sceneRef.current, layersRef.current);
          studio?.render();
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      })
      .catch((error: Error) => {
        // No WebGL, or the module failed to load. Say so and fall back rather
        // than leaving a black rectangle.
        if (!cancelled) {
          setStudioError(error.message);
          setView("2d");
        }
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      studio?.dispose();
      studioRef.current = null;
    };
  }, [view]);

  useEffect(() => {
    studioRef.current?.setMode(camera);
  }, [camera]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(null);
  }, []);

  const run = useCallback(
    async (body: Record<string, unknown>, label: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setRunning(label);
      setLogs([]);
      setOutcome(null);
      sceneRef.current = emptyScene();
      studioRef.current?.resetWorld();

      try {
        const response = await fetch("/api/robots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, speed }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!response.body) throw new Error("لا يوجد بث من الخادم");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let pending: LogEntry[] = [];
        let flushedAt = 0;

        const flush = (force = false) => {
          const now = Date.now();
          if (!force && (pending.length === 0 || now - flushedAt < 120)) return;
          flushedAt = now;
          const batch = pending;
          pending = [];
          if (batch.length > 0) {
            setLogs((prev) => [...prev, ...batch].slice(-400));
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";

          for (const chunk of chunks) {
            const lines = chunk.split("\n");
            const name = lines.find((l) => l.startsWith("event: "))?.slice(7).trim();
            const data = lines.find((l) => l.startsWith("data: "))?.slice(6);
            if (!name || !data) continue;
            const payload = JSON.parse(data);
            applyEvent(sceneRef.current, name, payload, (entry) => pending.push(entry));
            if (name === "done") setOutcome(payload as Outcome);
          }
          flush();
        }
        flush(true);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setOutcome({ ok: false, summary: (error as Error).message });
        }
      } finally {
        setRunning(null);
        abortRef.current = null;
      }
    },
    [speed],
  );

  const filteredAbilities = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return abilities;
    return abilities.filter((a) =>
      [a.id, a.name.en, a.name.ar, a.summary.ar, a.summary.en, ...a.tags]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [abilities, query]);

  const selected = abilities.find((a) => a.id === selectedId) ?? null;
  const visibleLogs = logs.filter((entry) => !hidden.has(entry.kind));
  const frame = hud.frame;
  const lead = frame?.robots[0];

  return (
    <main className="min-h-screen bg-slate-50 pb-10">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-end justify-between gap-4 px-5 py-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              🤖 قدرات لوكا الروبوتية
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">
              قدرات مبرمجة ومختبَرة، كل وحدة بتشتغل على محاكي فيه فيزياء حقيقية —
              ناس بتمشي، بطارية بتخلص، أغراض بتنكسر إذا عصرتها زيادة. ونفس الكود
              بيشتغل على روبوت حقيقي عبر ROS 2.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href="/robots/talk"
              className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
            >
              💬 احكي مع الروبوت
            </a>
          <dl className="flex gap-5 text-sm">
            <Stat label="قدرة" value={abilities.length} />
            <Stat label="عالم" value={scenarios.length} />
            <Stat label="عرض" value={demos.length} />
          </dl>
          </div>
        </div>
      </header>

      {studioError && (
        <div className="mx-auto mt-4 max-w-[1500px] px-5">
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            ما قدرت أشغّل العرض ثلاثي الأبعاد ({studioError}) — رجعت للعرض ثنائي
            الأبعاد.
          </p>
        </div>
      )}

      {catalogueError && (
        <div className="mx-auto mt-4 max-w-[1500px] px-5">
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            ما قدرت أجيب القدرات من الخادم ({catalogueError}). تأكد إنو السيرفر شغّال.
          </p>
        </div>
      )}

      <div className="mx-auto grid max-w-[1500px] gap-5 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section className="min-w-0 space-y-4">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="relative h-[min(64vh,600px)]">
              {/* The keys matter. Without them React reconciles these two as the
                  same <canvas> and only swaps the ref, so switching to 2D hands
                  `drawScene` a canvas that already holds a WebGL context —
                  `getContext("2d")` returns null, the draw silently does
                  nothing, and the last 3D frame sits there looking live. */}
              {view === "3d" ? (
                <canvas key="gl" ref={glRef} className="block h-full w-full bg-[#05080f]" />
              ) : (
                <canvas key="2d" ref={canvasRef} className="block h-full w-full bg-slate-950" />
              )}

              {/* The 3D view has no text of its own, so the same prompt the 2D
                  renderer draws on an empty canvas is an overlay here. */}
              {view === "3d" && !frame && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="rounded-xl bg-slate-950/60 px-4 py-2 text-sm text-slate-400 backdrop-blur">
                    اختر عرضاً أو قدرة وشغّلها
                  </span>
                </div>
              )}

              {/* What the picture is and is not. The renderer gives the world a
                  height; the simulator never had one, and hiding that behind a
                  handsome frame would be the whole problem. */}
              {view === "3d" && (
                <div className="pointer-events-none absolute bottom-3 left-3">
                  <span className="inline-block rounded-lg bg-slate-950/70 px-2.5 py-1 text-[11px] leading-relaxed text-slate-300 backdrop-blur">
                    عرض ثلاثي الأبعاد — الفيزياء ثنائية الأبعاد. الارتفاعات هنا
                    اختيار عرض، والمحاكي لا يعرف عنها شيئًا.
                  </span>
                </div>
              )}
              <div className="pointer-events-none absolute right-3 top-3 flex flex-wrap gap-1.5">
                <Chip>⏱ {((frame?.t ?? 0) / 1000).toFixed(1)}s</Chip>
                {lead && <Chip>🔋 {(lead.charge * 100).toFixed(0)}%</Chip>}
                {lead && <Chip>🏃 {lead.speed.toFixed(2)} m/s</Chip>}
                {frame && frame.arm.force > 0.4 && (
                  <Chip>✊ {frame.arm.force.toFixed(1)} N</Chip>
                )}
                {lead?.holding && <Chip>📦 {lead.holding}</Chip>}
              </div>
              {frame?.safety && (
                <div className="pointer-events-none absolute bottom-3 right-3 max-w-[70%]">
                  <span
                    className={`inline-block rounded-lg px-2.5 py-1 text-xs backdrop-blur ${
                      frame.safety.level === "clear"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : frame.safety.level === "slow"
                          ? "bg-amber-500/15 text-amber-300"
                          : "bg-rose-500/15 text-rose-300"
                    }`}
                    dir="ltr"
                  >
                    🛡 {frame.safety.reason}
                  </span>
                </div>
              )}
              {running && (
                <div className="pointer-events-none absolute left-3 top-3">
                  <span className="inline-flex items-center gap-2 rounded-lg bg-brand-500/20 px-2.5 py-1 text-xs text-brand-200">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-300" />
                    {running}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex overflow-hidden rounded-full ring-1 ring-slate-200">
                  {(["3d", "2d"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={view === v}
                      onClick={() => setView(v)}
                      className={`px-2.5 py-1 text-xs transition ${
                        view === v
                          ? "bg-slate-900 text-white"
                          : "bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {v === "3d" ? "٣د" : "٢د"}
                    </button>
                  ))}
                </div>

                {view === "3d" && (
                  <div className="flex overflow-hidden rounded-full ring-1 ring-slate-200">
                    {CAMERA_MODES.map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={camera === mode}
                        onClick={() => setCamera(mode)}
                        className={`px-2.5 py-1 text-xs transition ${
                          camera === mode
                            ? "bg-slate-900 text-white"
                            : "bg-white text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                <span className="mx-0.5 h-4 w-px bg-slate-200" aria-hidden />

                {(Object.keys(DEFAULT_LAYERS) as Array<keyof Layers>).map((layer) => (
                  <button
                    key={layer}
                    type="button"
                    aria-pressed={layers[layer]}
                    onClick={() => setLayers((l) => ({ ...l, [layer]: !l[layer] }))}
                    className={`rounded-full px-2.5 py-1 text-xs ring-1 transition ${
                      layers[layer]
                        ? "bg-slate-900 text-white ring-slate-900"
                        : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {LAYER_LABELS[layer]}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  السرعة
                  <input
                    type="range"
                    min={1}
                    max={24}
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                    className="accent-brand-600"
                    aria-label="سرعة التشغيل"
                  />
                  <span className="w-8 tabular-nums text-slate-500">{speed}×</span>
                </label>
                {running && (
                  <button
                    type="button"
                    onClick={stop}
                    className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700"
                  >
                    إيقاف
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Sparkline
              title="السرعة"
              unit="m/s"
              value={lead?.speed}
              canvasRef={speedChartRef}
            />
            <Sparkline
              title="سقف الأمان"
              unit="×"
              value={frame?.safety.speedScale}
              canvasRef={safetyChartRef}
            />
            <Sparkline
              title="البطارية"
              unit=""
              value={lead?.charge}
              format={(v) => `${(v * 100).toFixed(0)}%`}
              canvasRef={chargeChartRef}
            />
          </div>

          {outcome && <OutcomeCard outcome={outcome} />}

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
              <span className="text-sm font-medium text-slate-700">
                ما بيحكيه الروبوت وهو بيشتغل
              </span>
              <div className="flex flex-wrap gap-1">
                {LOG_FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    aria-pressed={!hidden.has(filter.key)}
                    onClick={() =>
                      setHidden((prev) => {
                        const next = new Set(prev);
                        if (next.has(filter.key)) next.delete(filter.key);
                        else next.add(filter.key);
                        return next;
                      })
                    }
                    className={`rounded-full px-2 py-0.5 text-[11px] ring-1 transition ${
                      hidden.has(filter.key)
                        ? "bg-white text-slate-400 ring-slate-200"
                        : "bg-slate-100 text-slate-700 ring-slate-200"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
            <div
              ref={logRef}
              className="scroll-area h-56 overflow-y-auto px-4 py-2.5 font-mono text-[11px] leading-relaxed"
            >
              {visibleLogs.length === 0 ? (
                <p className="py-6 text-center text-slate-400">
                  {running ? "…" : "شغّل عرضاً أو قدرة لتشوف التفاصيل"}
                </p>
              ) : (
                visibleLogs.map((entry, i) => <LogLine key={i} entry={entry} />)
              )}
            </div>
          </div>
        </section>

        <aside className="min-w-0 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex border-b border-slate-200" role="tablist">
              {(["demos", "abilities"] as const).map((key) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`flex-1 px-4 py-2.5 text-sm font-medium transition ${
                    tab === key
                      ? "border-b-2 border-brand-600 text-brand-700"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {key === "demos" ? `عروض (${demos.length})` : `قدرات (${abilities.length})`}
                </button>
              ))}
            </div>

            {tab === "demos" ? (
              <div className="max-h-[520px] space-y-2 overflow-y-auto p-3 scroll-area">
                {demos.map((demo) => (
                  <button
                    key={demo.name}
                    type="button"
                    disabled={running !== null}
                    onClick={() => run({ demo: demo.name }, demo.title.ar)}
                    className="w-full rounded-xl border border-slate-200 p-3 text-right transition hover:border-brand-300 hover:bg-brand-50/60 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-50"
                  >
                    <span className="block font-medium text-slate-900">{demo.title.ar}</span>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600">{demo.blurb}</p>
                    <span className="mt-2 flex flex-wrap gap-1">
                      {demo.abilities.map((id) => (
                        <code
                          key={id}
                          dir="ltr"
                          className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                        >
                          {id}
                        </code>
                      ))}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-3">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="دوّر بالقدرات…"
                  className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
                <div className="max-h-[440px] space-y-1 overflow-y-auto scroll-area">
                  {filteredAbilities.map((ability) => (
                    <button
                      key={ability.id}
                      type="button"
                      onClick={() =>
                        setSelectedId(selectedId === ability.id ? null : ability.id)
                      }
                      aria-expanded={selectedId === ability.id}
                      className={`w-full rounded-lg border p-2.5 text-right transition focus:outline-none focus:ring-2 focus:ring-brand-200 ${
                        selectedId === ability.id
                          ? "border-brand-300 bg-brand-50"
                          : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-900">
                          {ability.name.ar}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${RISK_STYLE[ability.risk]}`}
                        >
                          {RISK_LABEL[ability.risk]}
                        </span>
                      </span>
                      <code dir="ltr" className="mt-0.5 block text-[11px] text-slate-500">
                        {ability.id}
                        {ability.daemon && " · daemon"}
                      </code>
                    </button>
                  ))}
                  {filteredAbilities.length === 0 && (
                    <p className="py-6 text-center text-sm text-slate-400">ما في نتيجة</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {selected && (
            <div className="rounded-2xl border border-brand-200 bg-white p-4 shadow-sm">
              <h3 className="font-semibold text-slate-900">{selected.name.ar}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">
                {selected.summary.ar}
              </p>
              <details className="mt-3 border-t border-slate-100 pt-3">
                <summary className="cursor-pointer text-xs font-medium text-slate-600">
                  ليش موجودة هالقدرة؟
                </summary>
                <p
                  className="mt-2 text-xs leading-relaxed text-slate-500"
                  dir="ltr"
                >
                  {selected.rationale}
                </p>
              </details>

              <div className="mt-3 flex flex-wrap gap-1">
                {selected.requires.map((r) => (
                  <code
                    key={r}
                    dir="ltr"
                    className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                  >
                    {r}
                  </code>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-600">العالم</span>
                  <select
                    value={scenario}
                    onChange={(e) => setScenario(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  >
                    {scenarios.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.title.ar}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-600">البذرة (اختياري)</span>
                  <input
                    dir="ltr"
                    inputMode="numeric"
                    value={seed}
                    onChange={(e) => setSeed(e.target.value)}
                    placeholder="مثلاً 42"
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5 font-mono text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                </label>
              </div>

              <div className="mt-3">
                <AbilityForm
                  ability={selected}
                  disabled={running !== null}
                  onRun={(input) =>
                    run(
                      {
                        ability: selected.id,
                        input,
                        scenario,
                        seed: seed.trim() ? Number(seed) : undefined,
                      },
                      selected.name.ar,
                    )
                  }
                />
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">شو بتشوف بالشاشة</h2>
            <ul className="space-y-1.5 text-xs leading-relaxed text-slate-600">
              <Legend colour="#38bdf8" label="الخريطة اللي الروبوت بناها لحاله" />
              <Legend colour="rgba(250,204,21,0.75)" label="شعاع الليزر — شو عم يشوف هلق. الشعاع اللي رجع من سطح إله حافة مضيّة؛ الشعاع اللي ما لقى شي لحدّ ١٢ متر بيبهت لَلعدم؛ والشعاع اللي ما رجع أصلاً ما بينرسم أبداً" />
              <Legend colour="rgba(248,113,113,0.5)" label="مظروف الأمان: المسافة اللازمة ليوقف بأمان على سرعته الحالية" />
              <Legend colour="#f87171" label="الناس، وحوالين كل واحد دائرة ٥٥ سم — هون بتتلامس الأجسام، ممنوع الروبوت يقرب أكتر" />
              <Legend colour="#a78bfa" label="علامات: الهدف، والحدود اللي رايح يستكشفها" />
              <Legend colour="#fbbf24" label="أغراض — بتصير بنفسجية لما يمسكها، وحمرا إذا تضرّرت" />
            </ul>
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
              حارس الأمان بيشتغل فوق كل شي: بيحسب المسافة اللازمة ليوقف الروبوت
              بأمان وبيحدّ سرعته حسبها — وما في قدرة بتقدر تتجاوزه إلا قدرات
              الطوارئ.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}

const CAMERA_MODES: Array<[CameraMode, string]> = [
  ["orbit", "حر"],
  ["follow", "متابعة"],
  ["chase", "خلف الروبوت"],
];

const LAYER_LABELS: Record<keyof Layers, string> = {
  map: "الخريطة",
  lidar: "الليزر",
  envelope: "مظروف الأمان",
  trail: "المسار",
  labels: "الأسماء",
};

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden
        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: colour }}
      />
      <span>{label}</span>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      dir="ltr"
      className="rounded-lg bg-slate-900/70 px-2 py-1 text-xs tabular-nums text-slate-200 backdrop-blur"
    >
      {children}
    </span>
  );
}

function Sparkline({
  title,
  unit,
  value,
  format,
  canvasRef,
}: {
  title: string;
  unit: string;
  value: number | undefined;
  format?: (v: number) => string;
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-slate-500">{title}</span>
        <span dir="ltr" className="font-mono text-sm tabular-nums text-slate-800">
          {value === undefined
            ? "—"
            : format
              ? format(value)
              : `${value.toFixed(2)}${unit}`}
        </span>
      </div>
      <canvas ref={canvasRef} className="mt-2 block h-8 w-full" />
    </div>
  );
}

function OutcomeCard({ outcome }: { outcome: Outcome }) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ${
        outcome.ok ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className="text-lg leading-none">{outcome.ok ? "✅" : "⚠️"}</span>
        <div className="min-w-0 flex-1">
          <p dir="auto" className="font-medium leading-relaxed text-slate-900">
            {outcome.summary}
          </p>
          {outcome.details && outcome.details.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {outcome.details.map((detail, i) => (
                <li key={i} className="flex gap-1.5" dir="auto">
                  <span className="text-slate-400">•</span>
                  <span>{detail}</span>
                </li>
              ))}
            </ul>
          )}
          {outcome.metrics && Object.keys(outcome.metrics).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(outcome.metrics).map(([key, value]) => (
                <span
                  key={key}
                  dir="ltr"
                  className="rounded-lg bg-white/80 px-2 py-1 font-mono text-[11px] text-slate-700 ring-1 ring-black/5"
                >
                  {key} = {formatNumber(value)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  const time = `${(entry.t / 1000).toFixed(1)}s`;
  const stamp = (
    <span className="w-11 shrink-0 text-slate-400" dir="ltr">
      {time}
    </span>
  );

  if (entry.kind === "safety") {
    const tone =
      entry.level === "clear"
        ? "text-emerald-600"
        : entry.level === "slow"
          ? "text-amber-600"
          : "text-rose-600";
    return (
      <p className="flex gap-2 py-0.5" dir="ltr">
        {stamp}
        <span className={tone}>[safety] {entry.reason}</span>
      </p>
    );
  }
  if (entry.kind === "warn") {
    return (
      <p className="flex gap-2 py-0.5" dir="ltr">
        {stamp}
        <span className="text-amber-700">! {entry.message}</span>
      </p>
    );
  }
  if (entry.kind === "result") {
    return (
      <p className="flex gap-2 py-0.5" dir="ltr">
        {stamp}
        <span className={entry.ok ? "text-emerald-700" : "text-rose-700"}>
          {entry.ok ? "✓" : "✗"} {entry.summary}
        </span>
      </p>
    );
  }
  if (entry.kind === "metric") {
    return (
      <p className="flex gap-2 py-0.5" dir="ltr">
        {stamp}
        <span className="text-slate-500">
          {entry.name} = {formatNumber(entry.value ?? 0)}
          {entry.unit ?? ""}
        </span>
      </p>
    );
  }
  if (entry.kind === "signal") {
    return (
      <p className="flex gap-2 py-0.5" dir="ltr">
        {stamp}
        <span className="text-sky-600">
          ({entry.channel}) {entry.payload}
        </span>
      </p>
    );
  }
  if (entry.kind === "status") {
    return (
      <p className="flex gap-2 py-0.5">
        {stamp}
        <span className="text-slate-700">{entry.ar ?? entry.message}</span>
      </p>
    );
  }
  return null;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "∞";
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

/** Fold one SSE event into the scene held outside React. */
function applyEvent(
  scene: ReturnType<typeof emptyScene>,
  name: string,
  payload: unknown,
  pushLog: (entry: LogEntry) => void,
): void {
  if (name === "setup") {
    scene.setup = payload as WorldSetup;
    scene.trail = [];
    scene.marks = [];
    scene.map = null;
    scene.history = { speed: [], safety: [], charge: [] };
    return;
  }

  if (name === "map") {
    const meta = payload as OccupancyMap;
    scene.map = { meta, decoded: decodeBase64(meta.cells) };
    return;
  }

  if (name === "frame") {
    const frame = payload as Frame;
    scene.frame = frame;

    const lead = frame.robots[0];
    if (lead) {
      const last = scene.trail[scene.trail.length - 1];
      if (!last || Math.hypot(lead.x - last.x, lead.y - last.y) > 0.07) {
        scene.trail.push({ x: lead.x, y: lead.y });
        if (scene.trail.length > 1200) scene.trail.shift();
      }
      push(scene.history.speed, Math.abs(lead.speed));
      push(scene.history.charge, lead.charge);
    }
    push(scene.history.safety, frame.safety.speedScale);
    return;
  }

  if (name === "log") {
    const entry = payload as LogEntry;
    if (entry.kind === "mark" && entry.at && entry.label) {
      // Keep the most recent few; a long exploration emits a lot of these.
      scene.marks = [...scene.marks.slice(-5), { label: entry.label, at: entry.at, t: entry.t }];
      return;
    }
    if (entry.kind === "pose") return;
    pushLog(entry);
  }
}

function push(series: number[], value: number): void {
  series.push(value);
  if (series.length > HISTORY_LENGTH) series.shift();
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
