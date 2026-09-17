"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The operator's console.
 *
 * The point of this page is that the receptionist is demonstrable today,
 * before any WhatsApp number or phone line exists: type as a customer, and
 * watch the same engine WhatsApp will call answer, escalate, and book.
 */

type Service = { id: string; code: string; name: string; durationMin: number; price?: number; currency?: string };
type BusinessSummary = { id: string; slug: string; name: string; kind: string; isDemo: boolean };
type BusinessProfile = BusinessSummary & { services: Service[]; currency: string };
type Storage = { ok: boolean; kind: string; persistent: boolean; message: string };
type Booking = {
  id: string; serviceName: string; date: string; time: string;
  customerName?: string; status: string;
};
type Escalation = { reason: string; label: string; matched?: string; customerMessage: string; at: string };
type Turn = { role: "user" | "assistant"; content: string };

const OPENERS = [
  "مرحبا، قديش سعر تنظيف الأسنان؟",
  "بتفتحوا يوم الجمعة؟",
  "بدي أحجز كشفية بكرا الصبح",
  "وين موقعكم بالضبط؟",
];

export default function DeskConsole() {
  const [businesses, setBusinesses] = useState<BusinessSummary[]>([]);
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [businessId, setBusinessId] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const summary = businesses.find((b) => b.id === businessId);

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

  // The profile, bookings and open escalations always come from storage, so
  // the console shows the same state the customer-facing pipeline wrote.
  useEffect(() => {
    if (!businessId) return;
    fetch(`/api/desk?business=${encodeURIComponent(businessId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.business) setProfile(d.business);
        if (Array.isArray(d.bookings)) setBookings(d.bookings);
      })
      .catch(() => setError("ما قدرت أجيب بيانات النشاط."));
  }, [businessId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  function reset() {
    setTurns([]);
    setEscalations([]);
    setError(null);
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy || !businessId) return;

    setTurns((prev) => [...prev, { role: "user", content: message }]);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/desk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, message, contact: "console" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `فشل الطلب (${res.status})`);

      setTurns((prev) => [...prev, { role: "assistant", content: data.reply }]);
      if (data.escalation) setEscalations((prev) => [data.escalation, ...prev]);
      if (Array.isArray(data.bookings)) setBookings(data.bookings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-lg">
            💬
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-bold leading-tight">موظف الاستقبال — لوحة التجربة</h1>
            <p className="text-xs text-slate-500">
              احكي معه كأنك زبون. نفس المحرك اللي رح يرد على واتساب.
            </p>
          </div>

          <select
            id="tenant-select"
            value={businessId}
            onChange={(e) => { setBusinessId(e.target.value); reset(); }}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400"
          >
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={reset}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100"
          >
            محادثة جديدة
          </button>
        </div>
      </header>

      {summary?.isDemo && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
          ⚠️ هاد نشاط <b>تجريبي</b> للاختبار فقط — مش زبون حقيقي.
        </div>
      )}

      {storage && !storage.persistent && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-center text-xs text-red-800">
          🗄️ <b>التخزين مؤقت بالذاكرة</b> — {storage.message}
        </div>
      )}
      {storage && storage.persistent && !storage.ok && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-center text-xs text-red-800">
          ⚠️ {storage.message}
        </div>
      )}

      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-4 overflow-hidden p-4">
        <main className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div ref={scrollRef} className="scroll-area flex-1 space-y-3 overflow-y-auto p-4 sm:p-6">
            {turns.length === 0 && (
              <div className="mx-auto max-w-lg py-8 text-center">
                <div className="mb-3 text-4xl">💬</div>
                <h2 className="text-lg font-bold">جرّبه كأنك زبون</h2>
                <p className="mt-1 text-sm text-slate-500">
                  اسأل عن سعر، أو دوام، أو احجز موعد — وشوف كيف بيرد.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {OPENERS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-full border border-slate-300 px-3 py-1.5 text-xs text-slate-700 transition hover:border-brand-400 hover:bg-brand-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t, i) => (
              <div key={i} className={t.role === "user" ? "flex justify-start" : "flex justify-end"}>
                <div
                  className={
                    "max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm " +
                    (t.role === "user"
                      ? "bg-slate-100 text-slate-800"
                      : "bg-brand-600 text-white")
                  }
                >
                  {t.content}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex justify-end">
                <div className="rounded-2xl bg-slate-100 px-4 py-2.5 text-sm text-slate-500">
                  عم بكتب…
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                ⚠️ {error}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="flex items-center gap-2 border-t border-slate-200 p-3"
          >
            <input
              id="desk-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="اكتب كأنك زبون…"
              disabled={busy}
              className="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              إرسال
            </button>
          </form>
        </main>

        <aside className="hidden w-80 shrink-0 flex-col gap-4 overflow-y-auto lg:flex">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-1 text-sm font-bold">🔔 محتاج مراجعتك</h2>
            <p className="mb-3 text-xs text-slate-500">
              كل رسالة رفض الوكيل يرد عليها لحاله بتوصل هون.
            </p>
            {escalations.length === 0 ? (
              <p className="text-xs text-slate-400">ما في تحويلات بهالمحادثة.</p>
            ) : (
              <ul className="space-y-2">
                {escalations.map((e, i) => (
                  <li key={i} className="rounded-xl border border-red-200 bg-red-50 p-2.5">
                    <div className="text-xs font-semibold text-red-700">{e.label}</div>
                    <div className="mt-0.5 text-xs text-slate-600">«{e.customerMessage}»</div>
                    {e.matched && (
                      <div className="mt-1 text-[11px] text-slate-400">سبب التحويل: {e.matched}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-1 text-sm font-bold">📅 الحجوزات</h2>
            <p className="mb-3 text-xs text-slate-500">حجوزات حقيقية ثبّتها الوكيل.</p>
            {bookings.length === 0 ? (
              <p className="text-xs text-slate-400">ما في حجوزات بعد.</p>
            ) : (
              <ul className="space-y-2">
                {bookings.map((b) => (
                  <li key={b.id} className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5">
                    <div className="text-xs font-semibold text-emerald-800">{b.serviceName}</div>
                    <div className="mt-0.5 font-mono text-xs text-slate-600" dir="ltr">
                      {b.date} · {b.time}
                    </div>
                    {b.customerName && (
                      <div className="mt-0.5 text-xs text-slate-500">{b.customerName}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {profile && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-2 text-sm font-bold">🧾 خدمات {profile.name}</h2>
              <ul className="space-y-1.5">
                {profile.services.map((s) => (
                  <li key={s.id} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-slate-700">{s.name}</span>
                    {/* Each number gets its own LTR span with the Arabic unit
                        OUTSIDE it. Putting "30د · 20 JOD" inside one dir="ltr"
                        element lets the bidi algorithm reorder the run, which
                        rendered as "JOD د · 3020". */}
                    <span className="flex shrink-0 items-baseline gap-1.5 text-slate-500">
                      <span>
                        <span className="font-mono" dir="ltr">{s.durationMin}</span> دقيقة
                      </span>
                      {typeof s.price === "number" && (
                        <>
                          <span className="text-slate-300">·</span>
                          <span>
                            <span className="font-mono" dir="ltr">{s.price}</span>{" "}
                            {s.currency ?? ""}
                          </span>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
