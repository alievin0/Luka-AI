"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { drawScene } from "../_lib/scene.ts";
import { DEFAULT_LAYERS, emptyScene, type Frame, type WorldSetup } from "../_lib/types.ts";

type Turn = {
  role: "user" | "assistant";
  text: string;
  /** Abilities the robot ran while producing this turn. */
  actions: Array<{ ability: string; ok?: boolean; summary?: string }>;
};

const SCENARIOS = [
  { name: "cluttered-office", label: "مكتب مزدحم" },
  { name: "busy-corridor", label: "ممر فيه ناس" },
  { name: "kitchen-fetch", label: "مطبخ فيه أغراض" },
  { name: "empty-hall", label: "قاعة فاضية" },
  { name: "long-patrol", label: "دورية طويلة" },
];

const OPENERS = [
  "شو شايف حواليك؟",
  "روح على النقطة (12, 8) وخبّرني شو صار",
  "جرّب تمسك الفنجان — وقلّي قديش عصرته",
  "قبل ما تتحرك، اعمل بروفة للخطة وقلّي الاحتمالات",
];

export default function TalkPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [scenario, setScenario] = useState("cluttered-office");
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [hud, setHud] = useState<Frame | null>(null);

  const sessionRef = useRef<string>("");
  const sceneRef = useRef(emptyScene());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<{ start: () => void; stop: () => void } | null>(null);

  if (!sessionRef.current && typeof window !== "undefined") {
    sessionRef.current =
      window.sessionStorage.getItem("luka-robot-session") ??
      Math.random().toString(36).slice(2);
    window.sessionStorage.setItem("luka-robot-session", sessionRef.current);
  }

  // The world stream: one long-lived connection for as long as the page is open.
  useEffect(() => {
    const controller = new AbortController();
    streamRef.current?.abort();
    streamRef.current = controller;
    sceneRef.current = emptyScene();

    const connect = async () => {
      try {
        const response = await fetch(
          `/api/robots/live?session=${sessionRef.current}&scenario=${scenario}&speed=3`,
          { signal: controller.signal },
        );
        if (!response.body) return;
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
            const lines = chunk.split("\n");
            const name = lines.find((l) => l.startsWith("event: "))?.slice(7).trim();
            const data = lines.find((l) => l.startsWith("data: "))?.slice(6);
            if (!name || !data) continue;
            const payload = JSON.parse(data);

            if (name === "setup") {
              sceneRef.current.setup = payload as WorldSetup;
              sceneRef.current.trail = [];
            } else if (name === "frame") {
              const frame = payload as Frame;
              sceneRef.current.frame = frame;
              const lead = frame.robots[0];
              if (lead) {
                const trail = sceneRef.current.trail;
                const last = trail[trail.length - 1];
                if (!last || Math.hypot(lead.x - last.x, lead.y - last.y) > 0.07) {
                  trail.push({ x: lead.x, y: lead.y });
                  if (trail.length > 900) trail.shift();
                }
              }
            } else if (name === "log") {
              const entry = payload as { kind: string; label?: string; at?: { x: number; y: number }; t: number };
              if (entry.kind === "mark" && entry.at && entry.label) {
                sceneRef.current.marks = [
                  ...sceneRef.current.marks.slice(-4),
                  { label: entry.label, at: entry.at, t: entry.t },
                ];
              }
            }
          }
        }
      } catch (streamError) {
        if ((streamError as Error).name !== "AbortError") {
          setError((streamError as Error).message);
        }
      }
    };

    void connect();
    return () => controller.abort();
  }, [scenario]);

  useEffect(() => {
    let raf = 0;
    let lastHud = 0;
    const loop = (now: number) => {
      drawScene(canvasRef.current, sceneRef.current, DEFAULT_LAYERS);
      if (now - lastHud > 250) {
        lastHud = now;
        setHud(sceneRef.current.frame);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, thinking]);

  // Speech recognition, where the browser has it. Everything works without it.
  useEffect(() => {
    const Recognition =
      (window as unknown as { SpeechRecognition?: new () => never }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => never }).webkitSpeechRecognition;
    if (!Recognition) return;
    setVoiceAvailable(true);

    const recognition = new (Recognition as unknown as new () => {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      start: () => void;
      stop: () => void;
      onresult: ((event: { results: Array<Array<{ transcript: string }>> }) => void) | null;
      onend: (() => void) | null;
      onerror: (() => void) | null;
    })();

    recognition.lang = "ar-SA";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const said = event.results[0]?.[0]?.transcript ?? "";
      if (said) setInput((current) => (current ? `${current} ${said}` : said));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
  }, []);

  const say = useCallback(
    (text: string) => {
      if (!speak || typeof window === "undefined" || !window.speechSynthesis) return;
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 400));
      utterance.lang = /[؀-ۿ]/.test(text) ? "ar-SA" : "en-US";
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    },
    [speak],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || thinking) return;

      setError(null);
      setInput("");
      const history = [...turns, { role: "user" as const, text: trimmed, actions: [] }];
      setTurns([...history, { role: "assistant", text: "", actions: [] }]);
      setThinking(true);

      try {
        const response = await fetch("/api/robots/live", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session: sessionRef.current,
            messages: history.map((turn) => ({ role: turn.role, content: turn.text })),
          }),
        });
        if (!response.body) throw new Error("لا يوجد رد من الخادم");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let spoken = "";

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

            if (name === "text") {
              spoken += payload.delta as string;
              setTurns((current) => {
                const next = [...current];
                const last = next[next.length - 1];
                next[next.length - 1] = { ...last, text: last.text + (payload.delta as string) };
                return next;
              });
            } else if (name === "acting") {
              setTurns((current) => {
                const next = [...current];
                const last = next[next.length - 1];
                next[next.length - 1] = {
                  ...last,
                  actions: [...last.actions, { ability: payload.ability as string }],
                };
                return next;
              });
            } else if (name === "acted") {
              setTurns((current) => {
                const next = [...current];
                const last = next[next.length - 1];
                const actions = [...last.actions];
                const index = actions.findIndex(
                  (a) => a.ability === payload.ability && a.ok === undefined,
                );
                if (index >= 0) {
                  actions[index] = {
                    ability: payload.ability as string,
                    ok: payload.ok as boolean,
                    summary: payload.summary as string,
                  };
                }
                next[next.length - 1] = { ...last, actions };
                return next;
              });
            } else if (name === "error") {
              setError(payload.message as string);
            }
          }
        }

        if (spoken) say(spoken);
      } catch (sendError) {
        setError((sendError as Error).message);
      } finally {
        setThinking(false);
      }
    },
    [turns, thinking, say],
  );

  const reset = useCallback(async () => {
    await fetch("/api/robots/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: sessionRef.current, reset: true }),
    });
    setTurns([]);
    sceneRef.current = emptyScene();
    // Reconnecting the world stream brings up a fresh robot.
    setScenario((current) => current);
    window.location.reload();
  }, []);

  const lead = hud?.robots[0];

  return (
    <main className="flex h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-5 py-3">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">🤖 احكي مع الروبوت</h1>
            <p className="text-xs text-slate-600">
              الروبوت شغّال دايماً — الناس بتمشي والبطارية بتنقص حتى وإنت ساكت. احكيله شو
              تريد وشوفه ينفّذ.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            >
              {SCENARIOS.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setSpeak((v) => !v)}
              aria-pressed={speak}
              className={`rounded-lg px-3 py-1.5 text-sm ring-1 transition ${
                speak
                  ? "bg-slate-900 text-white ring-slate-900"
                  : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {speak ? "🔊 بيحكي" : "🔇 ساكت"}
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg bg-white px-3 py-1.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            >
              روبوت جديد
            </button>
            <a
              href="/robots"
              className="rounded-lg bg-white px-3 py-1.5 text-sm text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50"
            >
              كل القدرات ←
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1500px] flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(0,1fr)_440px]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="relative flex-1">
            <canvas ref={canvasRef} className="block h-full w-full bg-slate-950" />
            <div className="pointer-events-none absolute right-3 top-3 flex flex-wrap gap-1.5">
              <Chip>⏱ {((hud?.t ?? 0) / 1000).toFixed(0)}s</Chip>
              {lead && <Chip>🔋 {(lead.charge * 100).toFixed(0)}%</Chip>}
              {lead && <Chip>🏃 {lead.speed.toFixed(2)} m/s</Chip>}
              {lead?.holding && <Chip>📦 {lead.holding}</Chip>}
            </div>
            {hud?.safety && (
              <div className="pointer-events-none absolute bottom-3 right-3 max-w-[75%]">
                <span
                  dir="ltr"
                  className={`inline-block rounded-lg px-2.5 py-1 text-xs backdrop-blur ${
                    hud.safety.level === "clear"
                      ? "bg-emerald-500/15 text-emerald-300"
                      : hud.safety.level === "slow"
                        ? "bg-amber-500/15 text-amber-300"
                        : "bg-rose-500/15 text-rose-300"
                  }`}
                >
                  🛡 {hud.safety.reason}
                </span>
              </div>
            )}
          </div>
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div
            ref={logRef}
            className="scroll-area flex-1 space-y-3 overflow-y-auto p-4"
          >
            {turns.length === 0 && (
              <div className="space-y-3 py-6">
                <p className="text-center text-sm text-slate-500">
                  احكي معه — بيتحرّك وإنت عم تشوفه.
                </p>
                <div className="space-y-1.5">
                  {OPENERS.map((opener) => (
                    <button
                      key={opener}
                      type="button"
                      onClick={() => void send(opener)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-right text-sm text-slate-700 transition hover:border-brand-300 hover:bg-brand-50/60"
                    >
                      {opener}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((turn, i) => (
              <div key={i} className={turn.role === "user" ? "text-left" : ""}>
                <div
                  className={`inline-block max-w-[92%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    turn.role === "user"
                      ? "bg-brand-600 text-white"
                      : "bg-slate-100 text-slate-800"
                  }`}
                >
                  {turn.text || (thinking && i === turns.length - 1 ? "…" : "")}
                </div>
                {turn.actions.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {turn.actions.map((action, j) => (
                      <div
                        key={j}
                        className={`rounded-lg px-2.5 py-1.5 text-xs ring-1 ${
                          action.ok === undefined
                            ? "bg-amber-50 text-amber-800 ring-amber-200"
                            : action.ok
                              ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                              : "bg-rose-50 text-rose-800 ring-rose-200"
                        }`}
                      >
                        <code dir="ltr" className="font-mono text-[11px]">
                          {action.ok === undefined ? "▶" : action.ok ? "✓" : "✗"} {action.ability}
                        </code>
                        {action.summary && (
                          <p dir="auto" className="mt-0.5 leading-snug">
                            {action.summary}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {error && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="border-t border-slate-200 p-3"
          >
            <div className="flex gap-2">
              {voiceAvailable && (
                <button
                  type="button"
                  aria-pressed={listening}
                  onClick={() => {
                    if (listening) {
                      recognitionRef.current?.stop();
                      setListening(false);
                    } else {
                      recognitionRef.current?.start();
                      setListening(true);
                    }
                  }}
                  className={`shrink-0 rounded-lg px-3 text-lg ring-1 transition ${
                    listening
                      ? "animate-pulse bg-rose-600 text-white ring-rose-600"
                      : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                  }`}
                  title="احكي بصوتك"
                >
                  🎙
                </button>
              )}
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={thinking ? "عم يشتغل…" : "احكيله شو يعمل…"}
                disabled={thinking}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
              />
              <button
                type="submit"
                disabled={thinking || !input.trim()}
                className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-40"
              >
                ابعت
              </button>
            </div>
          </form>
        </aside>
      </div>
    </main>
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
