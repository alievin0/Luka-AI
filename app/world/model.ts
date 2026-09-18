/**
 * The world's data model: everything the page derives, with no React in it.
 *
 * It lives apart from the view for one reason — every number the world shows
 * is computed here, so every number can be tested. `scripts/test-desk.mjs`
 * exercises this file directly. If a KPI cannot be derived from what the API
 * actually returns, the function returns `null` and the card renders a dash.
 * Nothing in this file invents a figure to fill a space in the design.
 */

/* ── the shapes /api/desk returns ──────────────────────────────────────── */

export type AgentLifecycle = "live" | "planned";

export type Agent = {
  code: string;
  name: string;
  role: string;
  zone: string;
  state: string;
  lifecycle: AgentLifecycle;
  currentTask?: string;
  capabilities: string[];
  tools: string[];
  permissions: string[];
  updatedAt: string;
};

export type WorldEvent = {
  id: string;
  taskId?: string;
  agentCode?: string;
  kind: string;
  from?: string;
  to?: string;
  summary: string;
  createdAt: string;
};

export type Booking = {
  id: string;
  serviceName: string;
  customerName?: string;
  date: string;
  time: string;
  status: string;
  createdAt: string;
};

export type Conversation = {
  id: string;
  channel: string;
  status: string;
  intent?: string;
  startedAt: string;
  lastAt: string;
};

export type Escalation = {
  id: string;
  reason: string;
  customerMessage: string;
  status: string;
  createdAt: string;
};

export type TaskStep = {
  seq: number;
  label: string;
  status: string;
  detail?: string;
  createdAt: string;
};

export type Task = {
  id: string;
  conversationId?: string;
  agentCode?: string;
  title: string;
  status: string;
  steps: TaskStep[];
  startedAt: string;
  endedAt?: string;
};

export type DayHours = { open: string; close: string } | null;

export type Business = {
  id: string;
  slug: string;
  name: string;
  kind?: string;
  timezone?: string;
  isDemo: boolean;
  hours?: Record<string, DayHours>;
};

export type Storage = { persistent: boolean; message: string };
export type ModelStatus = { configured: boolean; keyLength: number };

/* ── time, in the business's own zone ──────────────────────────────────── */

export type Weekday = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAY_FROM_EN: Record<string, Weekday> = {
  Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat",
};

export type Zoned = {
  /** "YYYY-MM-DD" in the business's zone — the only safe key for "today". */
  day: string;
  weekday: Weekday;
  hour: number;
  minute: number;
  /** Minutes since midnight, for comparing against opening hours. */
  minutes: number;
  /** "HH:MM", zero-padded. */
  hhmm: string;
};

/**
 * A timestamp as the business experiences it.
 *
 * Bucketing by the viewer's local day would put a Riyadh evening booking on
 * the wrong day for an operator in Amman, so every bucket key in this file
 * goes through here.
 */
export function zoned(at: string | number | Date, timezone: string): Zoned | null {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return null;

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
  } catch {
    // An unknown zone must not take the page down with it.
    return zoned(date, "UTC");
  }

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // `hour12: false` yields "24" for midnight in some engines.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const weekday = WEEKDAY_FROM_EN[get("weekday")] ?? WEEKDAYS[date.getUTCDay()];

  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    weekday,
    hour,
    minute,
    minutes: hour * 60 + minute,
    hhmm: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

/** "HH:MM" to minutes since midnight, or null when it is not a time. */
export function parseHHMM(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Whether a message landed while the business was shut.
 *
 * A closed day counts as after-hours; so does a day with no entry, because a
 * business that never declared Friday hours is not open on Friday. Overnight
 * ranges (22:00–02:00) are handled as a wrap rather than as an empty window.
 */
export function isAfterHours(
  at: string,
  timezone: string,
  hours: Record<string, DayHours> | undefined,
): boolean | null {
  const z = zoned(at, timezone);
  if (!z) return null;
  if (!hours) return null;

  const day = hours[z.weekday];
  if (day === undefined) return true;
  if (day === null) return true;

  const open = parseHHMM(day.open);
  const close = parseHHMM(day.close);
  if (open === null || close === null) return null;

  if (close > open) return z.minutes < open || z.minutes >= close;
  // Wraps past midnight.
  return z.minutes < open && z.minutes >= close;
}

/* ── derivations ───────────────────────────────────────────────────────── */

/** Counts per hour for the `buckets` hours ending with the current one. */
export function countByHour(
  timestamps: string[],
  timezone: string,
  buckets: number,
  now: number = Date.now(),
): number[] {
  const out = new Array<number>(buckets).fill(0);
  const hourMs = 3_600_000;
  // Snap to the top of the current hour so bars do not shuffle every render.
  const end = Math.floor(now / hourMs) * hourMs + hourMs;
  const start = end - buckets * hourMs;

  for (const iso of timestamps) {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t) || t < start || t >= end) continue;
    const index = Math.floor((t - start) / hourMs);
    if (index >= 0 && index < buckets) out[index] += 1;
  }
  void timezone; // bucket edges are absolute; the zone only labels them
  return out;
}

/**
 * Percentage change, or null when there is no baseline.
 *
 * Returning null rather than 0 or 100 is deliberate: the card then shows a
 * dash instead of claiming a trend nobody measured.
 */
export function changePct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Mean wall-clock duration of the finished tasks, in seconds. */
export function averageSeconds(tasks: Task[]): number | null {
  const spans: number[] = [];
  for (const t of tasks) {
    if (!t.endedAt) continue;
    const started = new Date(t.startedAt).getTime();
    const ended = new Date(t.endedAt).getTime();
    if (Number.isNaN(started) || Number.isNaN(ended) || ended < started) continue;
    spans.push((ended - started) / 1000);
  }
  if (!spans.length) return null;
  return spans.reduce((a, b) => a + b, 0) / spans.length;
}

export type Kpi = {
  key: string;
  label: string;
  value: string;
  /** null renders a dash — there was no baseline to compare against. */
  change: number | null;
  /** Whether a rise is good news, so the arrow can be coloured honestly. */
  riseIsGood: boolean;
  tone: KpiTone;
  spark: number[];
};

export type KpiTone = "blue" | "green" | "red" | "indigo" | "violet";

export type Snapshot = {
  business?: Business;
  agents: Agent[];
  events: WorldEvent[];
  bookings: Booking[];
  escalations: Escalation[];
  tasks: Task[];
  conversations: Conversation[];
};

/** Bars in a stat card's sparkline — one per hour, as the design draws it. */
export const SPARK_BUCKETS = 14;

const SECONDS_LABEL = (s: number) => (s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`);

/** The five headline figures, each from the records the API returned. */
export function deriveKpis(snap: Snapshot, now: number = Date.now()): Kpi[] {
  const tz = snap.business?.timezone ?? "UTC";
  const today = zoned(now, tz)?.day ?? "";
  const yesterday = zoned(now - 86_400_000, tz)?.day ?? "";
  const on = (iso: string, day: string) => zoned(iso, tz)?.day === day;

  const convToday = snap.conversations.filter((c) => on(c.startedAt, today));
  const convYesterday = snap.conversations.filter((c) => on(c.startedAt, yesterday));

  const booked = snap.bookings.filter((b) => b.status !== "cancelled");
  const bookedToday = booked.filter((b) => on(b.createdAt, today));
  const bookedYesterday = booked.filter((b) => on(b.createdAt, yesterday));

  const escToday = snap.escalations.filter((e) => on(e.createdAt, today));

  const tasksToday = snap.tasks.filter((t) => on(t.startedAt, today));
  const tasksYesterday = snap.tasks.filter((t) => on(t.startedAt, yesterday));
  const avgToday = averageSeconds(tasksToday);
  const avgYesterday = averageSeconds(tasksYesterday);

  const hours = snap.business?.hours;
  const afterToday = convToday.filter((c) => isAfterHours(c.startedAt, tz, hours) === true);
  const afterYesterday = convYesterday.filter(
    (c) => isAfterHours(c.startedAt, tz, hours) === true,
  );

  return [
    {
      key: "conversations",
      label: "محادثة اليوم",
      value: String(convToday.length),
      change: changePct(convToday.length, convYesterday.length),
      riseIsGood: true,
      tone: "blue",
      spark: countByHour(snap.conversations.map((c) => c.startedAt), tz, SPARK_BUCKETS, now),
    },
    {
      key: "bookings",
      label: "حجوزات",
      value: String(bookedToday.length),
      change: changePct(bookedToday.length, bookedYesterday.length),
      riseIsGood: true,
      tone: "green",
      spark: countByHour(booked.map((b) => b.createdAt), tz, SPARK_BUCKETS, now),
    },
    {
      key: "escalations",
      label: "تصعيدات مفتوحة",
      value: String(snap.escalations.length),
      // The API returns only the open ones, so there is no closed history to
      // compare against. A dash is the truthful answer, not a zero.
      change: null,
      riseIsGood: false,
      tone: "red",
      spark: countByHour(escToday.map((e) => e.createdAt), tz, SPARK_BUCKETS, now),
    },
    {
      key: "latency",
      label: "متوسط وقت الرد",
      value: avgToday === null ? "—" : SECONDS_LABEL(avgToday),
      change:
        avgToday === null || avgYesterday === null
          ? null
          : changePct(avgToday, avgYesterday),
      riseIsGood: false,
      tone: "indigo",
      spark: countByHour(
        snap.tasks.filter((t) => t.endedAt).map((t) => t.startedAt),
        tz,
        SPARK_BUCKETS,
        now,
      ),
    },
    {
      key: "afterhours",
      label: "محادثة خارج الدوام",
      value: hours ? String(afterToday.length) : "—",
      change: hours ? changePct(afterToday.length, afterYesterday.length) : null,
      riseIsGood: true,
      tone: "violet",
      spark: countByHour(
        snap.conversations
          .filter((c) => isAfterHours(c.startedAt, tz, hours) === true)
          .map((c) => c.startedAt),
        tz,
        SPARK_BUCKETS,
        now,
      ),
    },
  ];
}

/* ── vocabulary ────────────────────────────────────────────────────────── */

export type Tone = "blue" | "green" | "amber" | "red" | "violet" | "grey";

export const STATE_AR: Record<string, string> = {
  idle: "جاهز",
  working: "يعمل",
  processing: "يعالج",
  waiting: "ينتظر",
  using_tool: "يستعمل أداة",
  escalated: "حوّل لإنسان",
  error: "خطأ",
  offline: "غير مبني",
  deploying: "قيد النشر",
};

export const STATE_TONE: Record<string, Tone> = {
  idle: "green",
  working: "green",
  processing: "blue",
  waiting: "amber",
  using_tool: "violet",
  escalated: "red",
  error: "red",
  offline: "grey",
  deploying: "blue",
};

/** The Arabic the event stream shows, keyed by what the pipeline emits. */
export const EVENT_AR: Record<string, string> = {
  message_received: "محادثة جديدة",
  policy_passed: "تحليل الطلب",
  policy_blocked: "إيقاف من بوابة السياسات",
  get_business_info: "بحث في المعرفة",
  get_services: "بحث في الخدمات",
  get_availability: "التحقق من المواعيد",
  create_booking: "طلب حجز",
  booking_confirmed: "تأكيد الحجز",
  escalation_created: "تصعيد للإنسان",
  human_notified: "تنبيه الفريق",
  reply_sent: "تم إرسال الرد",
  pipeline_error: "خطأ في المعالجة",
};

export const EVENT_TONE: Record<string, Tone> = {
  message_received: "blue",
  policy_passed: "green",
  policy_blocked: "red",
  get_business_info: "green",
  get_services: "green",
  get_availability: "amber",
  create_booking: "amber",
  booking_confirmed: "green",
  escalation_created: "red",
  human_notified: "red",
  reply_sent: "blue",
  pipeline_error: "red",
};

/** Unknown kinds keep their raw name rather than being hidden or renamed. */
export function eventLabel(kind: string): string {
  return EVENT_AR[kind] ?? kind;
}

export function eventTone(kind: string): Tone {
  return EVENT_TONE[kind] ?? "grey";
}

export function stateLabel(state: string): string {
  return STATE_AR[state] ?? state;
}

export function stateTone(state: string): Tone {
  return STATE_TONE[state] ?? "grey";
}

/* ── the replay strip ──────────────────────────────────────────────────── */

export const STAGES = ["استقبال", "تحليل", "معرفة", "حجز", "تأكيد", "مكتمل"] as const;

const STAGE_OF: Record<string, number> = {
  message_received: 0,
  policy_passed: 1,
  policy_blocked: 1,
  get_business_info: 2,
  get_services: 2,
  get_availability: 2,
  create_booking: 3,
  booking_confirmed: 3,
  escalation_created: 4,
  human_notified: 4,
  reply_sent: 4,
};

/** Which stage of the strip an event lights, or -1 when it maps to none. */
export function stageOf(kind: string): number {
  const stage = STAGE_OF[kind];
  return stage === undefined ? -1 : stage;
}

/** How far a task got: the strip fills to here. A finished task reaches 5. */
export function reachedStage(task: Task | null): number {
  if (!task) return -1;
  let best = -1;
  for (const step of task.steps) best = Math.max(best, stageOf(step.label));
  if (task.status === "completed") best = STAGES.length - 1;
  return best;
}

/* ── the map: where each node sits on the client's rendered campus ─────── */

/**
 * Coordinates in the campus artwork's own pixel space (1126 × 676), which is
 * also the SVG overlay's viewBox. Expressing them this way means the overlay
 * scales with the picture and never needs re-measuring: the numbers below were
 * read off the artwork itself.
 */
export const CAMPUS_W = 1126;
export const CAMPUS_H = 676;

export type Node = { x: number; y: number; label: string; r: number };

export const NODES: Record<string, Node> = {
  customer: { x: 137, y: 508, label: "الزبون", r: 20 },
  "channel-whatsapp": { x: 209, y: 540, label: "واتساب", r: 18 },
  "channel-web": { x: 268, y: 566, label: "الويب", r: 15 },
  "channel-instagram": { x: 262, y: 604, label: "إنستغرام", r: 15 },
  reception: { x: 218, y: 262, label: "الاستقبال", r: 24 },
  voice: { x: 132, y: 330, label: "الوكيل الصوتي", r: 15 },
  knowledge: { x: 438, y: 110, label: "المعرفة", r: 22 },
  orchestrator: { x: 544, y: 276, label: "مدير المهام", r: 26 },
  booking: { x: 745, y: 251, label: "الحجوزات", r: 24 },
  tools: { x: 896, y: 366, label: "الأدوات", r: 22 },
  policy: { x: 536, y: 522, label: "بوابة السياسات", r: 24 },
  escalation: { x: 536, y: 522, label: "التصعيد", r: 24 },
  handoff: { x: 881, y: 582, label: "الإنسان", r: 24 },
  business: { x: 980, y: 626, label: "صاحب العمل", r: 18 },
  supervision: { x: 1010, y: 150, label: "المراقبة", r: 15 },
  supervisor: { x: 1010, y: 150, label: "المراقبة", r: 15 },
  workshop: { x: 306, y: 118, label: "الورشة", r: 15 },
};

/**
 * The lit routes, traced onto the paths already drawn in the artwork so a
 * pulse travels along a glowing line rather than cutting across the model.
 */
const ROUTES: Record<string, string> = {
  "customer>channel-whatsapp": "M137,508 C160,518 186,530 209,540",
  "customer>channel-web": "M137,508 C180,530 230,552 268,566",
  "channel-whatsapp>reception": "M209,540 C268,470 274,352 218,262",
  "channel-web>reception": "M268,566 C312,468 286,344 218,262",
  "channel-instagram>reception": "M262,604 C320,492 292,348 218,262",
  "reception>orchestrator": "M218,262 C300,206 430,200 544,276",
  "orchestrator>reception": "M544,276 C430,200 300,206 218,262",
  "orchestrator>knowledge": "M544,276 C512,206 480,150 438,110",
  "knowledge>orchestrator": "M438,110 C480,150 512,206 544,276",
  "reception>knowledge": "M218,262 C284,166 358,112 438,110",
  "knowledge>reception": "M438,110 C358,112 284,166 218,262",
  "orchestrator>booking": "M544,276 C610,232 684,224 745,251",
  "booking>orchestrator": "M745,251 C684,224 610,232 544,276",
  "reception>booking": "M218,262 C360,150 600,164 745,251",
  "booking>reception": "M745,251 C600,164 360,150 218,262",
  "booking>tools": "M745,251 C808,278 866,318 896,366",
  "tools>booking": "M896,366 C866,318 808,278 745,251",
  "orchestrator>policy": "M544,276 C578,352 508,442 536,522",
  "policy>orchestrator": "M536,522 C508,442 578,352 544,276",
  "reception>policy": "M218,262 C290,360 420,430 536,522",
  "policy>reception": "M536,522 C420,430 290,360 218,262",
  "policy>handoff": "M536,522 C640,586 776,606 881,582",
  "handoff>policy": "M881,582 C776,606 640,586 536,522",
  "handoff>business": "M881,582 C914,594 950,612 980,626",
  "reception>customer": "M218,262 C264,352 208,438 137,508",
  "booking>customer": "M745,251 C520,300 280,380 137,508",
  "policy>customer": "M536,522 C400,540 254,528 137,508",
};

/**
 * The path a pulse follows from one node to another.
 *
 * Unrecognised pairs get a curve derived from the two nodes instead of being
 * dropped: a new edge in the pipeline must still show up on the map, even
 * before anyone has traced a pretty line for it.
 */
export function routePath(from: string, to: string): string | null {
  const key = `${from}>${to}`;
  const traced = ROUTES[key];
  if (traced) return traced;

  const a = NODES[from];
  const b = NODES[to];
  if (!a || !b) return null;

  // Bow the fallback away from the straight line so two-way traffic between
  // the same pair does not overlap into one flickering streak.
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(60, len * 0.18);
  const cx = mx + (-dy / len) * bow;
  const cy = my + (dx / len) * bow;
  return `M${a.x},${a.y} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x},${b.y}`;
}

/** Traffic between nodes, counted from the events themselves. */
export type Edge = { from: string; to: string; count: number };

export function deriveEdges(events: WorldEvent[]): Edge[] {
  const counts = new Map<string, Edge>();
  for (const e of events) {
    if (!e.from || !e.to || e.from === e.to) continue;
    const key = `${e.from}>${e.to}`;
    const hit = counts.get(key);
    if (hit) hit.count += 1;
    else counts.set(key, { from: e.from, to: e.to, count: 1 });
  }
  return Array.from(counts.values());
}

/** Where an agent stands on the campus: its own pin, else its zone's. */
export function nodeForAgent(agent: Agent): Node | null {
  return NODES[agent.code] ?? NODES[agent.zone] ?? null;
}
