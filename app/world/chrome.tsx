"use client";

import Link from "next/link";
import {
  STAGES,
  eventLabel,
  eventTone,
  stateLabel,
  stateTone,
  type Agent,
  type Business,
  type Kpi,
  type KpiTone,
  type Task,
  type Tone,
  type WorldEvent,
} from "./model";
import {
  IconAgents,
  IconAlert,
  IconBolt,
  IconBook,
  IconCalendar,
  IconChat,
  IconChevron,
  IconChevronDown,
  IconGear,
  IconGlobe,
  IconHome,
  IconLink,
  IconMoon,
  IconPause,
  IconPlay,
  IconReplay,
  IconSearch,
  LukaMark,
} from "./icons";

/**
 * The frame around the campus, rebuilt from the client's design as real
 * markup rather than cropped out of it — so every figure in it is live, stays
 * sharp at any zoom, and can be read by a screen reader.
 *
 * One rule runs through all of it: a control that does nothing is not drawn as
 * if it does. Sections of the product that are designed but not built are
 * marked, not linked; a metric with no baseline shows a dash rather than a
 * flattering arrow.
 */

const TONE_TEXT: Record<Tone, string> = {
  blue: "#3b82f6",
  green: "#12b981",
  amber: "#f59e0b",
  red: "#f4525a",
  violet: "#8b7bff",
  grey: "#94a3b8",
};

/* ── left navigation ───────────────────────────────────────────────────── */

type NavEntry = {
  label: string;
  icon: (p: { className?: string }) => React.ReactElement;
  href?: string;
  badge?: number;
  badgeTone?: "blue" | "red";
};

export function Sidebar({
  business,
  openConversations,
  openEscalations,
}: {
  business: Business | null;
  openConversations: number;
  openEscalations: number;
}) {
  const items: NavEntry[] = [
    { label: "نظرة عامة", icon: IconHome },
    { label: "المحادثات", icon: IconChat, href: "/desk", badge: openConversations, badgeTone: "blue" },
    { label: "الحجوزات", icon: IconCalendar },
    { label: "التصعيدات", icon: IconAlert, badge: openEscalations, badgeTone: "red" },
    { label: "الوكلاء", icon: IconAgents },
    { label: "المعرفة", icon: IconBook },
    { label: "التكاملات", icon: IconLink },
    { label: "عالم الوكلاء", icon: IconGlobe, href: "/world" },
    { label: "الإعدادات", icon: IconGear },
  ];

  return (
    <aside className="flex w-[216px] shrink-0 flex-col rounded-[18px] bg-white px-3 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex items-center gap-2.5 px-2">
        <LukaMark className="h-8 w-8 shrink-0" />
        <div className="min-w-0">
          <p className="text-[17px] font-bold leading-tight tracking-tight text-[#16203c]">Luka AI</p>
          <p className="truncate text-[11px] leading-tight text-[#8a93a8]">موظف الاستقبال الذكي</p>
        </div>
      </div>

      <nav className="mt-5 flex shrink-0 flex-col gap-0.5">
        {items.map((item) => {
          const active = item.href === "/world";
          const Icon = item.icon;
          const body = (
            <>
              <Icon className="h-[19px] w-[19px] shrink-0" />
              <span className="flex-1 truncate text-[13.5px]">{item.label}</span>
              {item.badge ? (
                <span
                  className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10.5px] font-semibold text-white tabular-nums"
                  style={{ background: item.badgeTone === "red" ? "#f4525a" : "#2f4bd8" }}
                >
                  {item.badge}
                </span>
              ) : null}
            </>
          );

          if (active) {
            return (
              <span
                key={item.label}
                aria-current="page"
                className="relative flex items-center gap-2.5 rounded-[11px] bg-[#e9edfe] py-2 pe-3 ps-3 font-semibold text-[#3b4fd8]"
              >
                <span className="absolute inset-y-1.5 end-0 w-[3px] rounded-full bg-[#3b5bf6]" />
                {body}
              </span>
            );
          }

          if (item.href) {
            return (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center gap-2.5 rounded-[11px] py-2 pe-3 ps-3 text-[#3a4566] transition-colors hover:bg-[#f2f5fb]"
              >
                {body}
              </Link>
            );
          }

          // Designed, not built. It reads as part of the product and refuses
          // to pretend it leads anywhere.
          return (
            <span
              key={item.label}
              aria-disabled="true"
              title="قريباً"
              className="flex cursor-default items-center gap-2.5 rounded-[11px] py-2 pe-3 ps-3 text-[#3a4566] opacity-55"
            >
              {body}
            </span>
          );
        })}
      </nav>

      <div className="mt-auto flex min-h-0 flex-1 flex-col justify-end gap-3 pt-4">
        <div className="flex shrink-0 items-center gap-2 rounded-[13px] border border-[#eceff6] bg-white px-3 py-2.5">
          <IconChevron className="h-4 w-4 shrink-0 text-[#b6bece]" />
          <div className="min-w-0 flex-1 text-end">
            <p className="truncate text-[13px] font-semibold text-[#16203c]">
              {business?.name ?? "—"}
            </p>
            <p className="flex items-center justify-end gap-1.5 text-[11px] text-[#8a93a8]">
              <span>{business?.isDemo ? "نشاط تجريبي" : "الخطة النشطة"}</span>
              <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
            </p>
          </div>
        </div>

        {/* The card shrinks with the viewport instead of pushing the nav off
            the bottom of a short screen. */}
        <div className="min-h-0 flex-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/world/promo.webp"
            alt="لوكا: موظفك الذكي بيشتغل ٢٤/٧، بيرد ويحجز ويهتم بعملائك"
            className="h-full w-full select-none rounded-[13px] object-contain object-bottom"
            draggable={false}
          />
        </div>

        <p className="shrink-0 px-1 text-[10.5px] text-[#aab2c2]">v0.1.0</p>
      </div>

    </aside>
  );
}

/* ── top bar ───────────────────────────────────────────────────────────── */

export function TopBar({
  business,
  businesses,
  onBusiness,
  query,
  onQuery,
  healthy,
  healthNote,
  clock,
}: {
  business: Business | null;
  businesses: Business[];
  onBusiness: (id: string) => void;
  query: string;
  onQuery: (v: string) => void;
  healthy: boolean;
  healthNote: string;
  clock: string;
}) {
  const initials = (business?.name ?? "—").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");

  return (
    <div className="flex h-[52px] shrink-0 flex-row-reverse items-center gap-3">
      <label dir="ltr" className="flex h-[38px] flex-1 items-center gap-2.5 rounded-[11px] bg-white px-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <IconSearch className="h-[17px] w-[17px] shrink-0 text-[#a6aec0]" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="ابحث في الأحداث والوكلاء…"
          dir="rtl"
          className="min-w-0 flex-1 bg-transparent text-right text-[13px] text-[#16203c] outline-none placeholder:text-[#a6aec0]"
        />
        <kbd className="hidden rounded-md bg-[#f1f4fa] px-1.5 py-0.5 text-[10px] text-[#8a93a8] sm:block">⌘K</kbd>
      </label>

      <span
        className="flex h-[34px] items-center gap-2 rounded-full px-3.5 text-[12px] font-semibold"
        style={{
          background: healthy ? "#e2f7ef" : "#fdeaec",
          color: healthy ? "#0d8a63" : "#c0353d",
        }}
        title={healthNote}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: healthy ? "#12b981" : "#f4525a" }} />
        {healthy ? "النظام يعمل" : "النظام متوقّف"}
      </span>

      <span className="hidden h-[34px] items-center rounded-full bg-white px-3.5 text-[12px] text-[#5a6480] tabular-nums shadow-[0_1px_2px_rgba(16,24,40,0.04)] lg:flex">
        {clock}
      </span>

      <div className="relative flex h-[38px] items-center gap-2.5 rounded-[11px] bg-white ps-2.5 pe-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <IconChevronDown className="h-4 w-4 shrink-0 text-[#b6bece]" />
        <div className="hidden text-end leading-tight md:block">
          <p className="max-w-[150px] truncate text-[12.5px] font-semibold text-[#16203c]">
            {business?.name ?? "—"}
          </p>
          <p className="max-w-[150px] truncate text-[10.5px] text-[#8a93a8]">
            {business?.kind ?? "نشاط تجاري"}
          </p>
        </div>
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[#eceafe] text-[12px] font-bold text-[#6d55e8]">
          {initials || "?"}
        </span>
        <select
          aria-label="اختيار النشاط"
          value={business?.id ?? ""}
          onChange={(e) => onBusiness(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/* ── the five stat cards ───────────────────────────────────────────────── */

const KPI_STYLE: Record<KpiTone, { tile: string; ink: string; bar: string }> = {
  blue: { tile: "#e6eefc", ink: "#3b5bf6", bar: "#9db8f7" },
  green: { tile: "#e0f6ed", ink: "#12b981", bar: "#8bdcbe" },
  red: { tile: "#fde8ea", ink: "#f4525a", bar: "#f5a8ad" },
  indigo: { tile: "#e6ebfe", ink: "#4a5ff0", bar: "#a2afef" },
  violet: { tile: "#eeeaff", ink: "#8b7bff", bar: "#c3b9fb" },
};

const KPI_ICON: Record<string, (p: { className?: string }) => React.ReactElement> = {
  conversations: IconChat,
  bookings: IconCalendar,
  escalations: IconAlert,
  latency: IconBolt,
  afterhours: IconMoon,
};

export function KpiRow({ kpis }: { kpis: Kpi[] }) {
  return (
    <div dir="ltr" className="grid shrink-0 grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
      {kpis.map((k) => {
        const s = KPI_STYLE[k.tone];
        const Icon = KPI_ICON[k.key] ?? IconChat;
        const good = k.change === null ? null : k.change === 0 ? null : k.change > 0 === k.riseIsGood;
        return (
          <div
            key={k.key}
            className="relative overflow-hidden rounded-[15px] bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
          >
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px]"
                style={{ background: s.tile, color: s.ink }}
              >
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="text-[24px] font-bold leading-none text-[#16203c] tabular-nums">
                {k.value}
              </span>
              <span
                className="ms-auto text-[11.5px] font-semibold tabular-nums"
                style={{ color: good === null ? "#a6aec0" : good ? "#12b981" : "#f4525a" }}
                title={k.change === null ? "ما في بيانات أمس للمقارنة" : undefined}
              >
                {k.change === null ? "—" : `${k.change > 0 ? "↑" : "↓"} ${Math.abs(k.change)}%`}
              </span>
            </div>
            <div className="mt-2 flex items-end justify-between gap-2">
              <p className="truncate text-[12px] text-[#7b8499]">{k.label}</p>
              <Spark values={k.spark} color={s.bar} accent={s.ink} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Twelve hourly buckets of the same records the card counts. */
function Spark({ values, color, accent }: { values: number[]; color: string; accent: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-[22px] shrink-0 items-end gap-[2px]" aria-hidden="true">
      {values.map((v, i) => (
        <span
          key={i}
          className="w-[3px] rounded-[1.5px]"
          style={{
            height: `${Math.max(20, (v / max) * 100)}%`,
            background: i === values.length - 1 && v > 0 ? accent : color,
            opacity: v === 0 ? 0.45 : 1,
          }}
        />
      ))}
    </div>
  );
}

/* ── right rail ────────────────────────────────────────────────────────── */

export function Rail({
  agents,
  events,
  showAll,
  onShowAll,
  selected,
  onSelect,
  timezone,
}: {
  agents: Agent[];
  events: WorldEvent[];
  showAll: boolean;
  onShowAll: () => void;
  selected: string | null;
  onSelect: (code: string | null) => void;
  timezone: string;
}) {
  const built = agents.filter((a) => a.lifecycle === "live").length;
  const shown = showAll ? events.slice(0, 40) : events.slice(0, 6);

  return (
    <aside className="flex w-[228px] shrink-0 flex-col gap-2.5">
      <section className="rounded-[15px] bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <header className="flex items-baseline justify-between">
          <span className="text-[11.5px] font-semibold text-[#8a93a8] tabular-nums">
            {built}/{agents.length}
          </span>
          <h2 className="text-[13px] font-bold text-[#16203c]">الوكلاء النشطون</h2>
        </header>
        <ul className="mt-2 space-y-0.5">
          {agents.map((a) => {
            const tone = a.lifecycle === "planned" ? "grey" : stateTone(a.state);
            const on = selected === a.code;
            return (
              <li key={a.code}>
                <button
                  type="button"
                  onClick={() => onSelect(on ? null : a.code)}
                  className={`flex w-full items-center gap-2 rounded-[9px] px-1.5 py-[7px] text-start transition-colors ${
                    on ? "bg-[#eef2fd]" : "hover:bg-[#f5f7fb]"
                  }`}
                >
                  <span
                    className="h-[9px] w-[9px] shrink-0 rounded-full"
                    style={{
                      background: TONE_TEXT[tone],
                      boxShadow: a.lifecycle === "planned" ? "none" : `0 0 0 3px ${TONE_TEXT[tone]}22`,
                    }}
                  />
                  <span className="flex-1 truncate text-[12.5px] text-[#2c3652]">{a.name}</span>
                  <span
                    className="shrink-0 rounded-md px-1.5 py-[3px] text-[10px] font-semibold"
                    style={{
                      background: a.lifecycle === "planned" ? "#eef0f5" : `${TONE_TEXT[tone]}1f`,
                      color: a.lifecycle === "planned" ? "#77809a" : TONE_TEXT[tone],
                    }}
                  >
                    {a.lifecycle === "planned" ? "قيد التطوير" : stateLabel(a.state)}
                  </span>
                </button>
              </li>
            );
          })}
          {agents.length === 0 && (
            <li className="px-1.5 py-4 text-center text-[12px] text-[#a6aec0]">ما في وكلاء</li>
          )}
        </ul>
      </section>

      <section className="flex min-h-0 flex-1 flex-col rounded-[15px] bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <h2 className="text-end text-[13px] font-bold text-[#16203c]">تدفق الأحداث المباشر</h2>
        <ul className="scroll-area mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {shown.map((e) => (
            <li
              key={e.id}
              className="flex flex-row-reverse items-center gap-2 rounded-[9px] px-1.5 py-[7px]"
              title={e.summary}
            >
              <span className="shrink-0 text-[11px] text-[#a6aec0] tabular-nums">
                {clockOf(e.createdAt, timezone)}
              </span>
              <span className="flex-1 truncate text-end text-[12.5px] text-[#2c3652]">
                {eventLabel(e.kind)}
              </span>
              <span
                className="h-[9px] w-[9px] shrink-0 rounded-full"
                style={{ background: TONE_TEXT[eventTone(e.kind)] }}
              />
            </li>
          ))}
          {shown.length === 0 && (
            <li className="px-1.5 py-6 text-center text-[12px] text-[#a6aec0]">
              ما صار إشي بعد
            </li>
          )}
        </ul>
        {events.length > 6 && (
          <button
            type="button"
            onClick={onShowAll}
            className="mt-2 w-full rounded-[10px] border border-[#e9edf5] py-2 text-[12.5px] font-semibold text-[#3a4566] transition-colors hover:bg-[#f5f7fb]"
          >
            {showAll ? "عرض أقل" : `عرض الكل (${events.length})`}
          </button>
        )}
      </section>
    </aside>
  );
}

function clockOf(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return "--:--";
  }
}

/* ── the replay strip ──────────────────────────────────────────────────── */

export function ReplayBar({
  task,
  mode,
  playing,
  speed,
  elapsed,
  total,
  stage,
  onMode,
  onSpeed,
  onToggle,
}: {
  task: Task | null;
  mode: "live" | "replay";
  playing: boolean;
  speed: number;
  elapsed: number;
  total: number;
  stage: number;
  onMode: (m: "live" | "replay") => void;
  onSpeed: (s: number) => void;
  onToggle: () => void;
}) {
  // Task ids carry a per-business counter after the last underscore; that is
  // the number an operator can actually quote back.
  const tail = task ? task.id.split("_").pop() ?? task.id : "";
  const ref = task ? `#${/^\d+$/.test(tail) ? tail.padStart(4, "0") : task.id.slice(-4)}` : "—";

  return (
    <div
      dir="ltr"
      className="flex h-[104px] shrink-0 flex-col justify-center gap-2 rounded-[15px] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          disabled={!task || mode === "live"}
          aria-label={playing ? "إيقاف مؤقت" : "تشغيل"}
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-[#2f4bd8] text-white transition-opacity disabled:opacity-35"
        >
          {playing ? <IconPause className="h-[17px] w-[17px]" /> : <IconPlay className="h-[17px] w-[17px]" />}
        </button>

        {[0.5, 1, 2].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSpeed(s)}
            disabled={mode === "live"}
            className={`h-[28px] rounded-full px-2.5 text-[12px] font-semibold tabular-nums transition-colors disabled:opacity-35 ${
              speed === s ? "bg-[#2f4bd8] text-white" : "bg-[#f2f4fa] text-[#5a6480] hover:bg-[#e9edf5]"
            }`}
          >
            {s}x
          </button>
        ))}

        <p className="mx-auto min-w-0 truncate text-center text-[13px] font-semibold text-[#16203c]">
          {task ? `محادثة ${ref} — ${task.title}` : "ما في محادثة مسجّلة بعد"}
        </p>

        <span className="shrink-0 text-[11.5px] text-[#a6aec0] tabular-nums">
          {fmt(elapsed)} / {fmt(total)}
        </span>
        <button
          type="button"
          onClick={() => onMode("live")}
          className={`h-[30px] shrink-0 rounded-[9px] px-3 text-[12px] font-semibold transition-colors ${
            mode === "live" ? "bg-[#2f52f0] text-white" : "bg-[#f2f4fa] text-[#5a6480] hover:bg-[#e9edf5]"
          }`}
        >
          مباشر
        </button>
        <button
          type="button"
          onClick={() => onMode("replay")}
          disabled={!task}
          className={`flex h-[30px] shrink-0 items-center gap-1.5 rounded-[9px] border px-3 text-[12px] font-semibold transition-colors disabled:opacity-35 ${
            mode === "replay"
              ? "border-[#2f52f0] bg-[#eef2fe] text-[#2f52f0]"
              : "border-[#e9edf5] text-[#5a6480] hover:bg-[#f5f7fb]"
          }`}
        >
          <IconReplay className="h-[14px] w-[14px]" />
          إعادة العرض
        </button>
      </div>

      <Stages stage={stage} />
    </div>
  );
}

function Stages({ stage }: { stage: number }) {
  return (
    <ol className="relative mx-auto flex w-full max-w-[760px] items-start justify-between px-2">
      <span className="absolute inset-x-6 top-[6px] h-[2px] rounded-full bg-[#eceff6]" />
      <span
        className="absolute left-6 top-[6px] h-[2px] rounded-full bg-[#3b5bf6] transition-[width] duration-500"
        style={{
          width:
            stage < 0
              ? "0%"
              : `calc((100% - 3rem) * ${Math.min(stage, STAGES.length - 1) / (STAGES.length - 1)})`,
        }}
      />
      {STAGES.map((label, i) => {
        const done = i <= stage;
        const current = i === stage;
        return (
          <li key={label} className="relative flex flex-col items-center gap-1.5">
            <span
              className="h-[13px] w-[13px] rounded-full border-[3px] transition-colors"
              style={{
                borderColor: done ? "#3b5bf6" : "#d7dde9",
                background: current ? "#3b5bf6" : "#ffffff",
                boxShadow: current ? "0 0 0 4px #3b5bf629" : "none",
              }}
            />
            <span
              className="text-[11.5px] transition-colors"
              style={{ color: done ? "#2c3652" : "#a6aec0", fontWeight: current ? 700 : 500 }}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
