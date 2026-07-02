"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";

type Entry = {
  date: string; // YYYY-MM-DD
  mood: number;
  anxiety: number;
  note: string;
  goal?: string;
  ai?: {
    reply: string;
    actions: string[];
    affirmation: string;
    trendNote: string;
  };
};

const STORAGE_KEY = "luka_coach_entries";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function loadEntries(): Entry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function calcStreak(entries: Entry[]): number {
  const dates = new Set(entries.map((e) => e.date));
  let streak = 0;
  const d = new Date();
  // A streak counts today if checked in, otherwise starts from yesterday.
  if (!dates.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1);
  while (dates.has(d.toISOString().slice(0, 10))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export default function CoachPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [mood, setMood] = useState(6);
  const [anxiety, setAnxiety] = useState(5);
  const [note, setNote] = useState("");
  const [goal, setGoal] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loaded = loadEntries();
    setEntries(loaded);
    const g = loaded.findLast?.((e) => e.goal)?.goal ?? loaded[loaded.length - 1]?.goal;
    if (g) setGoal(g);
  }, []);

  const todayEntry = entries.find((e) => e.date === todayISO());
  const streak = useMemo(() => calcStreak(entries), [entries]);

  async function checkIn() {
    if (loading) return;
    setError(null);
    setLoading(true);

    const entry: Entry = {
      date: todayISO(),
      mood,
      anxiety,
      note: note.trim(),
      goal: goal.trim() || undefined,
    };

    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          today: entry,
          history: entries.filter((e) => e.date !== entry.date),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      entry.ai = data;

      const next = [...entries.filter((e) => e.date !== entry.date), entry].sort((a, b) =>
        a.date.localeCompare(b.date),
      );
      setEntries(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-xl">🌱</div>
            <div>
              <h1 className="text-lg font-bold leading-tight">مرافقي اليومي</h1>
              <p className="text-xs text-slate-500">تشيك-إن يومي · تتبّع مزاجك وقلقك · خطوات صغيرة للتغيير</p>
            </div>
          </div>
          <Nav />
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-4 py-6">
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <StatCard emoji="🔥" label="أيام متتالية" value={String(streak)} />
          <StatCard emoji="📝" label="مجموع التشيك-إن" value={String(entries.length)} />
          <StatCard
            emoji="📈"
            label="متوسط المزاج (٧ أيام)"
            value={
              entries.length
                ? (
                    entries.slice(-7).reduce((s, e) => s + e.mood, 0) /
                    Math.min(entries.length, 7)
                  ).toFixed(1)
                : "—"
            }
          />
        </div>

        {entries.length >= 2 && (
          <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold">آخر ١٤ يوم</h3>
            <TrendChart entries={entries.slice(-14)} />
            <div className="mt-1 flex gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-brand-500" /> المزاج
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> القلق
              </span>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold">
            {todayEntry ? "سجّلت اليوم ✅ — تقدر تحدّث تشيك-إن اليوم" : "شلونك اليوم؟"}
          </h2>

          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <Slider label="مزاجك" emoji={mood >= 7 ? "😄" : mood >= 4 ? "🙂" : "😔"} value={mood} onChange={setMood} />
            <Slider
              label="مستوى القلق"
              emoji={anxiety >= 7 ? "😰" : anxiety >= 4 ? "😐" : "😌"}
              value={anxiety}
              onChange={setAnxiety}
            />
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium">شو صار اليوم؟</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="اكتب بحرّية… شو ضغطك، شو فرحك، شو تحدّيت اليوم."
              className="h-28 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-brand-300"
            />
          </div>

          <div className="mt-3">
            <label className="mb-1 block text-sm font-medium">هدفك الحالي (اختياري)</label>
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="مثال: أتكلم بثقة قدام الناس، أنام بدري…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-brand-300"
            />
          </div>

          <button
            onClick={() => void checkIn()}
            disabled={loading || !note.trim()}
            className="mt-4 w-full rounded-xl bg-brand-600 px-5 py-3 text-base font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? "يفكّر معك…" : "سجّل يومي 🌱"}
          </button>
        </div>

        {todayEntry?.ai && (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-brand-200 bg-brand-50 p-5">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {todayEntry.ai.reply}
              </p>
              <p className="mt-3 text-xs font-medium text-brand-700">📊 {todayEntry.ai.trendNote}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="mb-2 text-sm font-semibold">✅ خطوات صغيرة لليوم</h3>
              <ul className="space-y-2">
                {todayEntry.ai.actions.map((a, i) => (
                  <li key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    {a}
                  </li>
                ))}
              </ul>
              <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-center text-sm font-medium text-green-700">
                💬 {todayEntry.ai.affirmation}
              </p>
            </div>
          </div>
        )}

        {entries.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold text-slate-500">سجلّك</h3>
            <div className="space-y-2">
              {[...entries].reverse().slice(0, 10).map((e) => (
                <div key={e.date} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>{e.date}</span>
                    <span>
                      مزاج {e.mood}/10 · قلق {e.anxiety}/10
                    </span>
                  </div>
                  {e.note && <p className="mt-1 text-slate-600">{e.note}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-slate-400">
          مرافق داعم للنمو الشخصي — ليس بديلاً عن مختص. إذا كنت تمر بأزمة، تواصل فوراً مع شخص
          تثق به أو جهة مختصة. بياناتك محفوظة على جهازك فقط.
        </p>
      </main>
    </div>
  );
}

function StatCard({ emoji, label, value }: { emoji: string; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-xl">{emoji}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function Slider({
  label,
  emoji,
  value,
  onChange,
}: {
  label: string;
  emoji: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="mb-1 flex items-center justify-between text-sm font-medium">
        <span>
          {emoji} {label}
        </span>
        <span className="text-slate-500">{value}/10</span>
      </label>
      <input
        type="range"
        min={1}
        max={10}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand-600"
        dir="ltr"
      />
    </div>
  );
}

function TrendChart({ entries }: { entries: Entry[] }) {
  const W = 560;
  const H = 96;
  const pad = 8;
  const step = entries.length > 1 ? (W - pad * 2) / (entries.length - 1) : 0;
  const y = (v: number) => H - pad - ((v - 1) / 9) * (H - pad * 2);
  const line = (get: (e: Entry) => number) =>
    entries.map((e, i) => `${i === 0 ? "M" : "L"}${pad + i * step},${y(get(e))}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ direction: "ltr" }}>
      <path d={line((e) => e.mood)} fill="none" stroke="#3385fc" strokeWidth="2.5" strokeLinecap="round" />
      <path d={line((e) => e.anxiety)} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="1 6" />
      {entries.map((e, i) => (
        <circle key={e.date} cx={pad + i * step} cy={y(e.mood)} r="3" fill="#3385fc" />
      ))}
    </svg>
  );
}
