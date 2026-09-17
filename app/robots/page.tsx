"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Bilingual = { en: string; ar: string };

type AbilityCard = {
  id: string;
  name: Bilingual;
  summary: Bilingual;
  rationale: string;
  risk: "passive" | "motion" | "contact" | "critical";
  requires: string[];
  tags: string[];
  daemon: boolean;
};

type DemoCard = {
  name: string;
  title: Bilingual;
  blurb: string;
  abilities: string[];
};

type Obstacle =
  | { id: string; kind: "circle"; at: { x: number; y: number }; radius: number }
  | { id: string; kind: "box"; at: { x: number; y: number }; width: number; height: number };

type WorldSetup = {
  width: number;
  height: number;
  dock: { x: number; y: number };
  obstacles: Obstacle[];
};

type Frame = {
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
  objects: Array<{ id: string; label: string; x: number; y: number; held: boolean; damaged: boolean }>;
  safety: { level: "clear" | "slow" | "stop"; reason: string; speedScale: number };
};

type LogEntry = {
  t: number;
  kind: string;
  message?: string;
  ar?: string;
  reason?: string;
  summary?: string;
  payload?: string;
  channel?: string;
  level?: string;
  name?: string;
  value?: number;
  unit?: string;
  ok?: boolean;
};

type Outcome = {
  ok: boolean;
  summary: string;
  details?: string[];
  metrics?: Record<string, number>;
};

const RISK_STYLES: Record<AbilityCard["risk"], string> = {
  passive: "bg-slate-100 text-slate-600",
  motion: "bg-brand-50 text-brand-700",
  contact: "bg-amber-50 text-amber-700",
  critical: "bg-rose-50 text-rose-700",
};

const RISK_LABELS: Record<AbilityCard["risk"], string> = {
  passive: "قراءة فقط",
  motion: "حركة",
  contact: "تلامس",
  critical: "طوارئ",
};

export default function RobotsPage() {
  const [abilities, setAbilities] = useState<AbilityCard[]>([]);
  const [demos, setDemos] = useState<DemoCard[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [speed, setSpeed] = useState(8);

  const setupRef = useRef<WorldSetup | null>(null);
  const frameRef = useRef<Frame | null>(null);
  const trailRef = useRef<Array<{ x: number; y: number }>>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/robots")
      .then((r) => r.json())
      .then((data) => {
        setAbilities(data.abilities ?? []);
        setDemos(data.demos ?? []);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [logs]);

  // One render loop for the life of the page; frames arrive whenever they arrive.
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      paint(canvasRef.current, setupRef.current, frameRef.current, trailRef.current);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

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
      trailRef.current = [];
      frameRef.current = null;

      try {
        const response = await fetch("/api/robots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, speed }),
          signal: controller.signal,
        });
        if (!response.body) throw new Error("no stream");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";

          for (const chunk of chunks) {
            const eventLine = chunk.split("\n").find((l) => l.startsWith("event: "));
            const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!eventLine || !dataLine) continue;
            const name = eventLine.slice(7).trim();
            const payload = JSON.parse(dataLine.slice(6));

            if (name === "setup") {
              setupRef.current = payload as WorldSetup;
              trailRef.current = [];
            } else if (name === "frame") {
              const frame = payload as Frame;
              frameRef.current = frame;
              const lead = frame.robots[0];
              if (lead) {
                const trail = trailRef.current;
                const last = trail[trail.length - 1];
                if (!last || Math.hypot(lead.x - last.x, lead.y - last.y) > 0.08) {
                  trail.push({ x: lead.x, y: lead.y });
                  if (trail.length > 900) trail.shift();
                }
              }
            } else if (name === "log") {
              setLogs((prev) => [...prev.slice(-260), payload as LogEntry]);
            } else if (name === "done") {
              setOutcome(payload as Outcome);
            }
          }
        }
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

  const selectedAbility = abilities.find((a) => a.id === selected) ?? null;

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-5">
          <h1 className="text-2xl font-bold text-slate-900">
            🤖 قدرات لوكا الروبوتية
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            قدرات مبرمجة وجاهزة للاستخدام: كل وحدة فيها بتشتغل على محاكي حقيقي فيه
            فيزياء وناس وبطارية — وبتشتغل نفسها على روبوت حقيقي عبر ROS 2.
          </p>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <canvas
              ref={canvasRef}
              width={1200}
              height={760}
              className="block w-full bg-slate-900"
            />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm">
              <Legend frame={frameRef.current} running={running} />
              <label className="flex items-center gap-2 text-slate-600">
                السرعة
                <input
                  type="range"
                  min={1}
                  max={24}
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="accent-brand-600"
                />
                <span className="w-10 tabular-nums text-slate-500">{speed}×</span>
              </label>
            </div>
          </div>

          {outcome && (
            <div
              className={`rounded-2xl border p-4 ${
                outcome.ok
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-rose-200 bg-rose-50"
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="text-lg">{outcome.ok ? "✅" : "⚠️"}</span>
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{outcome.summary}</p>
                  {outcome.details && outcome.details.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm text-slate-700">
                      {outcome.details.map((d, i) => (
                        <li key={i}>• {d}</li>
                      ))}
                    </ul>
                  )}
                  {outcome.metrics && Object.keys(outcome.metrics).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {Object.entries(outcome.metrics).map(([key, value]) => (
                        <span
                          key={key}
                          className="rounded-full bg-white/70 px-2.5 py-1 font-mono text-xs text-slate-700"
                        >
                          {key} = {formatNumber(value)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-2 text-sm font-medium text-slate-700">
              ما بيحكيه الروبوت وهو بيشتغل
            </div>
            <div
              ref={logRef}
              className="scroll-area h-52 overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed"
            >
              {logs.length === 0 && (
                <p className="text-slate-400">اختر عرضاً أو قدرة وشغّلها…</p>
              )}
              {logs.map((entry, i) => (
                <LogLine key={i} entry={entry} />
              ))}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">عروض جاهزة</h2>
            <div className="space-y-2">
              {demos.map((demo) => (
                <button
                  key={demo.name}
                  disabled={running !== null}
                  onClick={() => run({ demo: demo.name }, demo.name)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-right transition hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">{demo.title.ar}</span>
                    {running === demo.name && (
                      <span className="text-xs text-brand-600">عم يشتغل…</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">{demo.blurb}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {demo.abilities.map((id) => (
                      <span
                        key={id}
                        className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600"
                      >
                        {id}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
            {running && (
              <button
                onClick={stop}
                className="mt-3 w-full rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
              >
                إيقاف
              </button>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              القدرات ({abilities.length})
            </h2>
            <div className="space-y-1.5">
              {abilities.map((ability) => (
                <button
                  key={ability.id}
                  onClick={() => setSelected(selected === ability.id ? null : ability.id)}
                  className={`w-full rounded-lg border p-2.5 text-right transition ${
                    selected === ability.id
                      ? "border-brand-300 bg-brand-50"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900">
                      {ability.name.ar}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${RISK_STYLES[ability.risk]}`}
                    >
                      {RISK_LABELS[ability.risk]}
                    </span>
                  </div>
                  <code className="mt-0.5 block text-[11px] text-slate-500">{ability.id}</code>
                </button>
              ))}
            </div>
          </div>

          {selectedAbility && (
            <div className="rounded-2xl border border-brand-200 bg-white p-4 shadow-sm">
              <h3 className="font-semibold text-slate-900">{selectedAbility.name.ar}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">
                {selectedAbility.summary.ar}
              </p>
              <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500" dir="ltr">
                {selectedAbility.rationale}
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {selectedAbility.requires.map((r) => (
                  <span
                    key={r}
                    className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600"
                  >
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function Legend({ frame, running }: { frame: Frame | null; running: string | null }) {
  const lead = frame?.robots[0];
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
      <span className="tabular-nums">⏱ {((frame?.t ?? 0) / 1000).toFixed(1)}s</span>
      {lead && (
        <>
          <span className="tabular-nums">🔋 {(lead.charge * 100).toFixed(0)}%</span>
          <span className="tabular-nums">🏃 {lead.speed.toFixed(2)} m/s</span>
          {lead.holding && <span>✊ {lead.holding}</span>}
        </>
      )}
      {frame?.safety && (
        <span
          className={
            frame.safety.level === "clear"
              ? "text-emerald-600"
              : frame.safety.level === "slow"
                ? "text-amber-600"
                : "text-rose-600"
          }
        >
          🛡 {frame.safety.reason}
        </span>
      )}
      {running && <span className="text-brand-600">▶ {running}</span>}
    </div>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  const time = `${(entry.t / 1000).toFixed(1)}s`;
  const base = "flex gap-2 py-0.5";

  if (entry.kind === "safety") {
    const tone =
      entry.level === "clear"
        ? "text-emerald-600"
        : entry.level === "slow"
          ? "text-amber-600"
          : "text-rose-600";
    return (
      <div className={base} dir="ltr">
        <span className="w-12 shrink-0 text-slate-400">{time}</span>
        <span className={tone}>[safety] {entry.reason}</span>
      </div>
    );
  }
  if (entry.kind === "warn") {
    return (
      <div className={base} dir="ltr">
        <span className="w-12 shrink-0 text-slate-400">{time}</span>
        <span className="text-amber-700">! {entry.message}</span>
      </div>
    );
  }
  if (entry.kind === "result") {
    return (
      <div className={base} dir="ltr">
        <span className="w-12 shrink-0 text-slate-400">{time}</span>
        <span className={entry.ok ? "text-emerald-700" : "text-rose-700"}>
          {entry.ok ? "✓" : "✗"} {entry.summary}
        </span>
      </div>
    );
  }
  if (entry.kind === "metric") {
    return (
      <div className={base} dir="ltr">
        <span className="w-12 shrink-0 text-slate-400">{time}</span>
        <span className="text-slate-500">
          {entry.name} = {formatNumber(entry.value ?? 0)}
          {entry.unit ?? ""}
        </span>
      </div>
    );
  }
  if (entry.kind === "signal") {
    return (
      <div className={base} dir="ltr">
        <span className="w-12 shrink-0 text-slate-400">{time}</span>
        <span className="text-brand-600">
          ({entry.channel}) {entry.payload}
        </span>
      </div>
    );
  }
  if (entry.kind === "status") {
    return (
      <div className={base}>
        <span className="w-12 shrink-0 text-slate-400" dir="ltr">
          {time}
        </span>
        <span className="text-slate-700">{entry.ar ?? entry.message}</span>
      </div>
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

/** Draws the world. Pure function of the latest frame — no state of its own. */
function paint(
  canvas: HTMLCanvasElement | null,
  setup: WorldSetup | null,
  frame: Frame | null,
  trail: Array<{ x: number; y: number }>,
): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, width, height);

  if (!setup) {
    ctx.fillStyle = "#475569";
    ctx.font = "16px ui-sans-serif, system-ui";
    ctx.textAlign = "center";
    ctx.fillText("اختر عرضاً من اليمين لتشغيله", width / 2, height / 2);
    return;
  }

  const pad = 24;
  const scale = Math.min(
    (width - pad * 2) / setup.width,
    (height - pad * 2) / setup.height,
  );
  const offsetX = (width - setup.width * scale) / 2;
  const offsetY = (height - setup.height * scale) / 2;
  // Screen y grows downward; the world's does not.
  const sx = (x: number) => offsetX + x * scale;
  const sy = (y: number) => offsetY + (setup.height - y) * scale;

  // Floor and grid.
  ctx.fillStyle = "#111c33";
  ctx.fillRect(offsetX, offsetY, setup.width * scale, setup.height * scale);
  ctx.strokeStyle = "rgba(148,163,184,0.10)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= setup.width; x += 1) {
    ctx.beginPath();
    ctx.moveTo(sx(x), sy(0));
    ctx.lineTo(sx(x), sy(setup.height));
    ctx.stroke();
  }
  for (let y = 0; y <= setup.height; y += 1) {
    ctx.beginPath();
    ctx.moveTo(sx(0), sy(y));
    ctx.lineTo(sx(setup.width), sy(y));
    ctx.stroke();
  }

  // Dock.
  ctx.strokeStyle = "#22c55e";
  ctx.lineWidth = 2;
  ctx.strokeRect(sx(setup.dock.x) - 14, sy(setup.dock.y) - 14, 28, 28);
  ctx.fillStyle = "#22c55e";
  ctx.font = "11px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("dock", sx(setup.dock.x), sy(setup.dock.y) + 28);

  // Obstacles.
  ctx.fillStyle = "#334155";
  for (const obstacle of setup.obstacles) {
    if (obstacle.kind === "circle") {
      ctx.beginPath();
      ctx.arc(sx(obstacle.at.x), sy(obstacle.at.y), obstacle.radius * scale, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(
        sx(obstacle.at.x - obstacle.width / 2),
        sy(obstacle.at.y + obstacle.height / 2),
        obstacle.width * scale,
        obstacle.height * scale,
      );
    }
  }

  // Where the robot has been.
  if (trail.length > 1) {
    ctx.strokeStyle = "rgba(56,189,248,0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx(trail[0].x), sy(trail[0].y));
    for (const point of trail) ctx.lineTo(sx(point.x), sy(point.y));
    ctx.stroke();
  }

  if (!frame) return;

  // Objects.
  for (const object of frame.objects) {
    ctx.fillStyle = object.damaged ? "#f43f5e" : object.held ? "#a855f7" : "#fbbf24";
    ctx.beginPath();
    ctx.arc(sx(object.x), sy(object.y), 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(object.label, sx(object.x), sy(object.y) - 10);
  }

  // People.
  for (const human of frame.humans) {
    ctx.fillStyle = human.attentive ? "rgba(248,113,113,0.95)" : "rgba(248,113,113,0.6)";
    ctx.beginPath();
    ctx.arc(sx(human.x), sy(human.y), 0.25 * scale, 0, Math.PI * 2);
    ctx.fill();
    // The separation envelope the safety governor protects.
    ctx.strokeStyle = "rgba(248,113,113,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx(human.x), sy(human.y), 0.35 * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#fca5a5";
    ctx.font = "10px ui-sans-serif, system-ui";
    ctx.fillText(human.id, sx(human.x), sy(human.y) - 0.35 * scale - 4);
  }

  // Robots.
  for (const robot of frame.robots) {
    const radius = 0.28 * scale;
    ctx.save();
    ctx.translate(sx(robot.x), sy(robot.y));

    ctx.fillStyle = robot.lights.color;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    // Heading, and a lean bar when the robot is tilting.
    ctx.rotate(-robot.theta);
    ctx.strokeStyle = robot.lights.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(radius * 1.6, 0);
    ctx.stroke();
    ctx.restore();

    if (Math.abs(robot.tilt) > 0.02) {
      ctx.strokeStyle = Math.abs(robot.tilt) > 0.2 ? "#ef4444" : "#f59e0b";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx(robot.x), sy(robot.y));
      ctx.lineTo(
        sx(robot.x) + Math.sin(robot.tilt) * radius * 2.4,
        sy(robot.y) - Math.cos(robot.tilt) * radius * 2.4,
      );
      ctx.stroke();
    }

    ctx.fillStyle = "#cbd5e1";
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(robot.id, sx(robot.x), sy(robot.y) + radius + 14);

    if (robot.utterance) {
      ctx.fillStyle = "rgba(226,232,240,0.85)";
      ctx.font = "11px ui-sans-serif, system-ui";
      ctx.fillText(robot.utterance.slice(0, 56), sx(robot.x), sy(robot.y) - radius - 10);
    }
  }
}
