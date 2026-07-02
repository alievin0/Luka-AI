"use client";

import { useState } from "react";
import Nav from "@/components/Nav";

type FamilyEvent = {
  title: string;
  type: "wedding" | "gathering" | "condolence" | "birthday" | "eid" | "other";
  dateISO: string;
  time?: string;
  location?: string;
  host?: string;
  sourceQuote: string;
  confidence: "high" | "medium" | "low";
};

const TYPE_META: Record<FamilyEvent["type"], { emoji: string; label: string }> = {
  wedding: { emoji: "💍", label: "عرس" },
  gathering: { emoji: "🍽️", label: "عزيمة" },
  condolence: { emoji: "🖤", label: "عزاء" },
  birthday: { emoji: "🎂", label: "عيد ميلاد" },
  eid: { emoji: "🎉", label: "عيد" },
  other: { emoji: "📌", label: "مناسبة" },
};

const CONFIDENCE_META: Record<FamilyEvent["confidence"], { label: string; cls: string }> = {
  high: { label: "مؤكد", cls: "bg-green-100 text-green-700" },
  medium: { label: "شبه مؤكد", cls: "bg-amber-100 text-amber-700" },
  low: { label: "تحقق منه", cls: "bg-red-100 text-red-700" },
};

function icsEscape(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function eventToIcs(e: FamilyEvent): string {
  const uid = `${e.dateISO}-${Math.random().toString(36).slice(2)}@luka-ai`;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const d = e.dateISO.replace(/-/g, "");
  const lines = ["BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp}`];
  if (e.time && /^\d{2}:\d{2}$/.test(e.time)) {
    const t = e.time.replace(":", "") + "00";
    lines.push(`DTSTART:${d}T${t}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${d}`);
  }
  lines.push(`SUMMARY:${icsEscape(e.title)}`);
  if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
  lines.push(
    `DESCRIPTION:${icsEscape(
      `${TYPE_META[e.type].label}${e.host ? ` عند ${e.host}` : ""}\nمن مجموعة العائلة: "${e.sourceQuote}"`,
    )}`,
  );
  lines.push("BEGIN:VALARM", "TRIGGER:-PT3H", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(e.title)}`, "END:VALARM");
  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

function downloadIcs(events: FamilyEvent[], filename: string) {
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Luka AI//Family Events//AR",
    "CALSCALE:GREGORIAN",
    ...events.map(eventToIcs),
    "END:VCALENDAR",
  ].join("\r\n");
  const blob = new Blob([body], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function EventsPage() {
  const [chat, setChat] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [events, setEvents] = useState<FamilyEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setChat(await file.text());
  }

  async function extract() {
    if (!chat.trim() || loading) return;
    setError(null);
    setLoading(true);
    setEvents(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat, today: new Date().toISOString().slice(0, 10) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      const sorted = (data.events as FamilyEvent[]).sort((a, b) =>
        a.dateISO.localeCompare(b.dateISO),
      );
      setEvents(sorted);
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
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-xl">📅</div>
            <div>
              <h1 className="text-lg font-bold leading-tight">مناسبات العائلة</h1>
              <p className="text-xs text-slate-500">
                من دردشة مجموعة العائلة إلى تقويمك — عزيمة، عرس، عزاء… بدون دعوة رسمية
              </p>
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

        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold">صدّر المحادثة وخلّينا نرتب مواعيدك 🗓️</h2>
          <p className="mt-1 text-sm text-slate-500">
            بالثقافة الخليجية المواعيد تنعقد بالمحادثة مو بدعوة رسمية — &quot;العشا عندنا
            الخميس&quot; كافية. صدّر محادثة مجموعة العائلة من واتساب (المجموعة ← ⋮ ← تصدير
            الدردشة ← <b>بدون وسائط</b>) وارفع الملف هنا.
          </p>

          <div className="mt-4 space-y-3">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600 transition hover:border-brand-300 hover:bg-brand-50">
              <input
                type="file"
                accept=".txt"
                className="hidden"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              📄 {fileName ? `تم اختيار: ${fileName}` : "اختر ملف التصدير (.txt) أو الصق المحادثة تحت"}
            </label>

            <textarea
              value={chat}
              onChange={(e) => setChat(e.target.value)}
              placeholder={"أو الصق المحادثة هنا…\n3/15/26, 8:42 PM - أبو خالد: العشا عندنا الخميس الجاي إن شاء الله الكل معزوم"}
              className="h-36 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-brand-300"
            />

            <label className="flex items-start gap-2 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 accent-brand-600"
              />
              <span>
                أؤكد أن هذه محادثتي وأنا عضو في المجموعة، وأوافق على تحليلها لاستخراج المناسبات
                فقط. المحادثة تُعالَج مؤقتاً ولا تُخزَّن على الخادم.
              </span>
            </label>

            <button
              onClick={() => void extract()}
              disabled={!chat.trim() || !consent || loading}
              className="w-full rounded-xl bg-brand-600 px-5 py-3 text-base font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? "يقرأ المحادثة ويستخرج المناسبات…" : "استخرج المناسبات ✨"}
            </button>
          </div>
        </div>

        {events && (
          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">
                {events.length ? `لقينا ${events.length} مناسبة 🎊` : "ما لقينا مناسبات بتواريخ واضحة"}
              </h3>
              {events.length > 0 && (
                <button
                  onClick={() => downloadIcs(events, "family-events.ics")}
                  className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  ⬇️ أضف الكل للتقويم (.ics)
                </button>
              )}
            </div>

            <div className="space-y-3">
              {events.map((e, i) => {
                const meta = TYPE_META[e.type];
                const conf = CONFIDENCE_META[e.confidence];
                return (
                  <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl">{meta.emoji}</span>
                        <div>
                          <h4 className="font-semibold">{e.title}</h4>
                          <p className="text-xs text-slate-500">
                            {new Date(e.dateISO + "T00:00:00").toLocaleDateString("ar", {
                              weekday: "long",
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            })}
                            {e.time ? ` · ${e.time}` : ""}
                            {e.location ? ` · 📍 ${e.location}` : ""}
                            {e.host ? ` · عند ${e.host}` : ""}
                          </p>
                        </div>
                      </div>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${conf.cls}`}>
                        {conf.label}
                      </span>
                    </div>
                    <blockquote className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      💬 &quot;{e.sourceQuote}&quot;
                    </blockquote>
                    <button
                      onClick={() =>
                        downloadIcs([e], `${e.title.replace(/[\\/:*?"<>|]/g, "-")}.ics`)
                      }
                      className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                    >
                      ⬇️ أضف للتقويم
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-slate-400">
          ملف .ics يفتح مباشرة في تقويم Google وApple وOutlook. تحقق دائماً من المواعيد
          منخفضة الثقة قبل الاعتماد عليها.
        </p>
      </main>
    </div>
  );
}
