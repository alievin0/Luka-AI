/**
 * Clock and calendar helpers for the receptionist.
 *
 * Every business runs on its own local clock, and a receptionist that books
 * "tomorrow at 5" while reading a server clock in another timezone books the
 * wrong slot. So all reasoning here happens on explicit local date/time
 * strings ("2026-09-18", "17:30") resolved through the tenant's timezone,
 * never on raw Date arithmetic.
 */

export type Weekday = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export const WEEKDAY_AR: Record<Weekday, string> = {
  sun: "الأحد",
  mon: "الإثنين",
  tue: "الثلاثاء",
  wed: "الأربعاء",
  thu: "الخميس",
  fri: "الجمعة",
  sat: "السبت",
};

/** "HH:MM" → minutes since midnight, or null when malformed. */
export function parseHHMM(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes since midnight → "HH:MM". */
export function formatHHMM(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Arabic 12-hour rendering, for talking to a customer. */
export function formatArabicTime(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const min = m % 60;
  const period = h24 < 12 ? "ص" : "م";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return min === 0 ? `${h12} ${period}` : `${h12}:${String(min).padStart(2, "0")} ${period}`;
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test((value ?? "").trim())) return false;
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  // Round-tripping catches "2026-02-31", which Date silently rolls forward.
  return d.toISOString().slice(0, 10) === value;
}

/** Weekday of a "YYYY-MM-DD" date. Anchored at noon UTC so no zone shifts it. */
export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

/** Shift a "YYYY-MM-DD" date by whole days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type ZonedNow = {
  /** Local calendar date, "YYYY-MM-DD". */
  date: string;
  /** Local wall clock, "HH:MM". */
  time: string;
  /** Minutes since local midnight. */
  minutes: number;
  weekday: Weekday;
};

/**
 * The current local date and time in a timezone.
 *
 * Uses Intl rather than offset arithmetic so daylight-saving transitions are
 * handled by the platform instead of by us.
 */
export function zonedNow(timezone: string, at: Date = new Date()): ZonedNow {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);
  } catch {
    // An unknown timezone must not take the receptionist down; UTC is the
    // safe fallback and the tenant validator flags the bad value separately.
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);
  }

  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${pick("year")}-${pick("month")}-${pick("day")}`;
  // Intl renders midnight as "24" in some environments under hour12:false.
  const hour = pick("hour") === "24" ? "00" : pick("hour");
  const time = `${hour}:${pick("minute")}`;

  return {
    date,
    time,
    minutes: parseHHMM(time) ?? 0,
    weekday: weekdayOf(date),
  };
}

/**
 * Turn a business-local date and time into the absolute instant it names.
 *
 * The booking table stores both: the local fields the business reads, and the
 * instants the overlap constraint compares. Getting this wrong would let two
 * bookings an hour apart look simultaneous across a DST boundary, so the
 * conversion is done against the real zone rather than a fixed offset.
 */
export function zonedToUtc(date: string, time: string, timezone: string): Date | null {
  if (!isValidDate(date)) return null;
  const minutes = parseHHMM(time);
  if (minutes === null) return null;

  // The wall clock we want, read as if it were UTC.
  const wanted = Date.parse(`${date}T${formatHHMM(minutes)}:00Z`);
  if (!Number.isFinite(wanted)) return null;

  // What a given instant actually reads as in that zone, again as if UTC.
  const readsAs = (instant: number): number => {
    const p = zonedNow(timezone, new Date(instant));
    return Date.parse(`${p.date}T${p.time}:00Z`);
  };

  // One correction lands on the right offset; a second settles DST edges,
  // where the first guess can fall on the other side of the transition.
  let guess = wanted + (wanted - readsAs(wanted));
  const drift = wanted - readsAs(guess);
  if (drift !== 0) guess += drift;
  return new Date(guess);
}
