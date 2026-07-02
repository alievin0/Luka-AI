"use client";

import { useEffect, useRef, useState } from "react";
import Nav from "@/components/Nav";
import { startVoiceAnalyzer, type VoiceAnalyzerHandle } from "@/lib/voiceMetrics";
import type { MonitorSample } from "@/app/api/monitor/route";

type Summary = {
  overallScore: number;
  postureSummary: string;
  voiceSummary: string;
  habits: string[];
  recommendations: string[];
  encouragement: string;
};

const STORAGE_KEY = "luka_monitor_log";
const INTERVALS = [
  { label: "كل دقيقة", ms: 60_000 },
  { label: "كل ٣ دقائق", ms: 180_000 },
  { label: "كل ٥ دقائق", ms: 300_000 },
];

function nowHM() {
  return new Date().toTimeString().slice(0, 5);
}

export default function MonitorPage() {
  const [active, setActive] = useState(false);
  const [intervalMs, setIntervalMs] = useState(180_000);
  const [log, setLog] = useState<MonitorSample[]>([]);
  const [latest, setLatest] = useState<(MonitorSample & { severity: string }) | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [liveVolume, setLiveVolume] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const voiceRef = useRef<VoiceAnalyzerHandle | null>(null);
  const sampleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uiTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<any>(null);
  const startedAtRef = useRef<string>("");
  const logRef = useRef<MonitorSample[]>([]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      setLog(saved);
      logRef.current = saved;
    } catch {
      /* fresh start */
    }
    return () => stopSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function acquireWakeLock() {
    try {
      wakeLockRef.current = await (navigator as any).wakeLock?.request("screen");
    } catch {
      /* not supported / denied — monitoring still works while screen is on */
    }
  }

  async function startSession() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch {
      setError("ما قدرنا نفتح الكاميرا — اسمح بالوصول من إعدادات المتصفح.");
      return;
    }

    voiceRef.current = await startVoiceAnalyzer();
    await acquireWakeLock();
    document.addEventListener("visibilitychange", onVisibility);

    startedAtRef.current = nowHM();
    setActive(true);
    setSummary(null);
    setElapsed(0);

    uiTimerRef.current = setInterval(() => {
      setElapsed((e) => e + 1);
      setLiveVolume(voiceRef.current?.currentVolume() ?? 0);
    }, 1000);

    // First sample shortly after start, then on the chosen interval.
    setTimeout(() => void takeSample(), 5_000);
    sampleTimerRef.current = setInterval(() => void takeSample(), intervalMs);
  }

  function onVisibility() {
    if (document.visibilityState === "visible") void acquireWakeLock();
  }

  function stopSession() {
    document.removeEventListener("visibilitychange", onVisibility);
    if (sampleTimerRef.current) clearInterval(sampleTimerRef.current);
    if (uiTimerRef.current) clearInterval(uiTimerRef.current);
    sampleTimerRef.current = null;
    uiTimerRef.current = null;
    voiceRef.current?.stop();
    voiceRef.current = null;
    wakeLockRef.current?.release?.().catch?.(() => {});
    wakeLockRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  }

  async function takeSample() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const frame = canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
    const voice = voiceRef.current?.flush();

    try {
      const res = await fetch("/api/monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sample", frame, voice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

      const sample: MonitorSample = {
        time: nowHM(),
        postureScore: data.postureScore,
        postureTip: data.postureTip,
        toneNote: data.toneNote,
      };
      setLatest({ ...sample, severity: data.severity });
      const next = [...logRef.current, sample].slice(-300);
      logRef.current = next;
      setLog(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function fetchSummary() {
    if (!logRef.current.length || loadingSummary) return;
    setError(null);
    setLoadingSummary(true);
    try {
      const res = await fetch("/api/monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "summary",
          log: logRef.current,
          sessionStart: startedAtRef.current || logRef.current[0]?.time,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingSummary(false);
    }
  }

  function clearLog() {
    logRef.current = [];
    setLog([]);
    setSummary(null);
    setLatest(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  const hh = String(Math.floor(elapsed / 3600)).padStart(2, "0");
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-xl">🧘</div>
            <div>
              <h1 className="text-lg font-bold leading-tight">المراقبة اليومية</h1>
              <p className="text-xs text-slate-500">وضعية جسمك + نبرة صوتك طوال اليوم · تحليل كامل</p>
            </div>
          </div>
          <Nav />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          {/* main column */}
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="relative aspect-video bg-slate-900">
                <video ref={videoRef} muted playsInline className="h-full w-full -scale-x-100 object-cover" />
                {!active && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                    <span className="text-4xl">🧘</span>
                    <p className="max-w-md text-sm text-slate-300">
                      خلّي جهازك مسنود قدامك (مكتب/حامل جوال)، وشغّل الجلسة — نراقب وضعية
                      جلستك من الكاميرا ونحلل نبرة صوتك محلياً على جهازك، ونعطيك تنبيهات
                      لحظية وتقرير كامل بنهاية اليوم.
                    </p>
                  </div>
                )}
                {active && (
                  <>
                    <span className="absolute start-2 top-2 flex items-center gap-1 rounded-full bg-red-600/90 px-2 py-0.5 text-xs font-medium text-white">
                      ● مراقبة نشطة {hh}:{mm}:{ss}
                    </span>
                    <div className="absolute bottom-2 start-2 end-2 flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5">
                      <span className="text-xs text-white">🎙️</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20">
                        <div
                          className="h-full rounded-full bg-green-400 transition-all"
                          style={{ width: `${Math.min(100, liveVolume * 900)}%` }}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-2">
                  {!active ? (
                    <button
                      onClick={() => void startSession()}
                      className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                    >
                      ▶️ ابدأ المراقبة
                    </button>
                  ) : (
                    <button
                      onClick={stopSession}
                      className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700"
                    >
                      ⏹️ أوقف المراقبة
                    </button>
                  )}
                  <select
                    value={intervalMs}
                    onChange={(e) => setIntervalMs(Number(e.target.value))}
                    disabled={active}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none disabled:opacity-50"
                  >
                    {INTERVALS.map((i) => (
                      <option key={i.ms} value={i.ms}>
                        📸 {i.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => void fetchSummary()}
                  disabled={!log.length || loadingSummary}
                  className="rounded-xl border border-brand-300 bg-brand-50 px-4 py-2.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:opacity-50"
                >
                  {loadingSummary ? "يحلل يومك…" : "📊 التحليل الكامل"}
                </button>
              </div>
            </div>

            {latest && (
              <div
                className={`rounded-2xl border p-4 ${
                  latest.severity === "warn"
                    ? "border-amber-200 bg-amber-50"
                    : "border-green-200 bg-green-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">
                    {latest.severity === "warn" ? "⚠️ انتبه" : "👍 ممتاز"} — آخر قراءة {latest.time}
                  </span>
                  <span className="rounded-full bg-white px-3 py-1 text-sm font-bold">
                    {latest.postureScore}/10
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-700">🧍 {latest.postureTip}</p>
                <p className="text-sm text-slate-700">🗣️ {latest.toneNote}</p>
              </div>
            )}

            {summary && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
                  <div className="text-4xl font-black text-brand-600">
                    {Math.round(summary.overallScore)}
                  </div>
                  <div className="text-xs text-slate-400">علامة يومك من 100</div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <h4 className="mb-1 text-sm font-semibold">🧍 وضعية الجسم</h4>
                    <p className="text-sm text-slate-600">{summary.postureSummary}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <h4 className="mb-1 text-sm font-semibold">🗣️ نبرة الصوت</h4>
                    <p className="text-sm text-slate-600">{summary.voiceSummary}</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h4 className="mb-2 text-sm font-semibold">🔁 عادات لاحظناها</h4>
                  <ul className="space-y-1 text-sm text-slate-600">
                    {summary.habits.map((h, i) => (
                      <li key={i}>• {h}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h4 className="mb-2 text-sm font-semibold">🎯 توصيات بكرة</h4>
                  <ul className="space-y-2">
                    {summary.recommendations.map((r, i) => (
                      <li key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        {i + 1}. {r}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-center text-sm font-medium text-green-700">
                    💬 {summary.encouragement}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* side column: timeline */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">📜 خط اليوم ({log.length} قراءة)</h3>
                {log.length > 0 && (
                  <button onClick={clearLog} className="text-xs text-slate-400 hover:text-red-500">
                    مسح
                  </button>
                )}
              </div>
              {log.length === 0 ? (
                <p className="text-xs text-slate-400">
                  كل قراءة (صورة + مقاييس صوت) تنضاف هنا تلقائياً أثناء المراقبة.
                </p>
              ) : (
                <ul className="scroll-area max-h-[420px] space-y-2 overflow-y-auto pe-1">
                  {[...log].reverse().map((s, i) => (
                    <li key={`${s.time}-${i}`} className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-500">{s.time}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 font-bold ${
                            s.postureScore >= 7
                              ? "bg-green-100 text-green-700"
                              : s.postureScore >= 4
                                ? "bg-amber-100 text-amber-700"
                                : "bg-red-100 text-red-700"
                          }`}
                        >
                          {s.postureScore}/10
                        </span>
                      </div>
                      <p className="mt-1 text-slate-600">{s.postureTip}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-500">
              <h3 className="mb-1 text-sm font-semibold text-slate-700">🔒 خصوصيتك</h3>
              الصوت يُحلَّل <b>محلياً على جهازك</b> — ما يطلع منه إلا أرقام (وقت الكلام،
              مستوى الصوت، النبرة). صور الكاميرا تُحلَّل لحظياً ولا تُخزَّن. السجل محفوظ
              على جهازك فقط.
              <h3 className="mb-1 mt-3 text-sm font-semibold text-slate-700">💡 للمراقبة الطويلة</h3>
              خلّي الصفحة مفتوحة والشاشة شغالة (نفعّل قفل الإضاءة تلقائياً إن أمكن)، واسند
              الجهاز بزاوية تشوف جلستك. وصّل الشاحن للجلسات الطويلة.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
