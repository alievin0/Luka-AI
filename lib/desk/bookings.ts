/**
 * Availability and booking — the system of record.
 *
 * The receptionist never decides whether a slot is free. It asks here, and
 * every answer is checked against the business profile and the stored
 * bookings. A slot is refused when it is in the past, outside opening hours,
 * inside the lead time, beyond the booking horizon, too short for the service,
 * blocked by a holiday, or already taken — however the request was phrased.
 *
 * The final guard is the database, not this file: `createBooking` can still
 * come back with a conflict when someone took the slot between the
 * availability read and the write, and that answer is passed through honestly
 * rather than papered over.
 */

import type { BusinessProfile, Service, Booking, BlockedTime } from "./db/types";
import { getRepo } from "./db";
import {
  parseHHMM,
  formatHHMM,
  formatArabicTime,
  isValidDate,
  weekdayOf,
  zonedNow,
  zonedToUtc,
  addDays,
  WEEKDAY_AR,
} from "./time";

export type { Booking } from "./db/types";

export function findService(business: BusinessProfile, ref: string): Service | null {
  const needle = (ref ?? "").trim().toLowerCase();
  if (!needle) return null;
  const byCode = business.services.find((s) => s.code.toLowerCase() === needle);
  if (byCode) return byCode;
  const byId = business.services.find((s) => s.id.toLowerCase() === needle);
  if (byId) return byId;
  const exact = business.services.find((s) => s.name.toLowerCase() === needle);
  if (exact) return exact;
  return business.services.find((s) => s.name.toLowerCase().includes(needle)) ?? null;
}

function overlaps(aStart: number, aLen: number, bStart: number, bLen: number): boolean {
  return aStart < bStart + bLen && bStart < aStart + aLen;
}

export type AvailabilityQuery = {
  business: BusinessProfile;
  date: string;
  service: Service;
  staffId?: string;
  now?: Date;
};

export type Availability =
  | { ok: true; date: string; slots: string[] }
  | {
      ok: false;
      reason: "closed" | "past" | "beyond_horizon" | "bad_date" | "too_long";
      message: string;
    };

export async function availability(q: AvailabilityQuery): Promise<Availability> {
  const { business, date, service } = q;

  if (!isValidDate(date)) {
    return { ok: false, reason: "bad_date", message: "التاريخ مش مفهوم. استعمل صيغة YYYY-MM-DD." };
  }

  const now = zonedNow(business.timezone, q.now);
  if (date < now.date) {
    return { ok: false, reason: "past", message: "هاد التاريخ راح خلص." };
  }

  const horizonEnd = addDays(now.date, business.horizonDays);
  if (date > horizonEnd) {
    return {
      ok: false,
      reason: "beyond_horizon",
      message: `بنستقبل حجوزات لغاية ${business.horizonDays} يوم قدّام بس.`,
    };
  }

  const weekday = weekdayOf(date);
  const hours = business.hours?.[weekday];
  if (!hours) {
    return { ok: false, reason: "closed", message: `${business.name} مسكّرة يوم ${WEEKDAY_AR[weekday]}.` };
  }

  const open = parseHHMM(hours.open);
  const close = parseHHMM(hours.close);
  if (open === null || close === null || close <= open) {
    return { ok: false, reason: "closed", message: "أوقات الدوام مش مضبوطة لهاد اليوم." };
  }

  // A slot has to FINISH before closing, not merely start before it.
  const lastStart = close - service.durationMin;
  if (lastStart < open) {
    return {
      ok: false,
      reason: "too_long",
      message: `مدة «${service.name}» أطول من دوام يوم ${WEEKDAY_AR[weekday]}.`,
    };
  }

  const repo = getRepo();
  const [taken, blocked] = await Promise.all([
    repo.listBookings(business.id, { date }),
    repo.listBlockedTimes(business.id, date),
  ]);

  // A whole-day block closes the day outright.
  const wholeDay = blocked.find(
    (b) => !b.start && !b.end && (!b.staffId || b.staffId === q.staffId),
  );
  if (wholeDay) {
    return {
      ok: false,
      reason: "closed",
      message: wholeDay.reason
        ? `مسكّرين يوم ${date} — ${wholeDay.reason}.`
        : `مسكّرين يوم ${date}.`,
    };
  }

  const relevant = (b: Booking | BlockedTime): boolean => {
    const staffId = (b as Booking).staffId ?? (b as BlockedTime).staffId;
    // With no staff selected, everything on the books occupies the business.
    if (!q.staffId) return true;
    return !staffId || staffId === q.staffId;
  };

  const earliest = date === now.date ? now.minutes + business.leadTimeMin : open;

  const slots: string[] = [];
  for (let start = open; start <= lastStart; start += business.slotStepMin) {
    if (start < earliest) continue;

    const clashesBooking = taken.filter(relevant).some((b) => {
      const s = parseHHMM(b.time);
      return s !== null && overlaps(start, service.durationMin, s, b.durationMin);
    });
    if (clashesBooking) continue;

    const clashesBlock = blocked.filter(relevant).some((b) => {
      if (!b.start || !b.end) return false;
      const s = parseHHMM(b.start);
      const e = parseHHMM(b.end);
      return s !== null && e !== null && overlaps(start, service.durationMin, s, e - s);
    });
    if (clashesBlock) continue;

    slots.push(formatHHMM(start));
  }

  return { ok: true, date, slots };
}

export type BookRequest = {
  business: BusinessProfile;
  serviceRef: string;
  date: string;
  time: string;
  staffId?: string;
  customerId?: string;
  note?: string;
  source?: string;
  now?: Date;
};

export type BookResult =
  | { ok: true; booking: Booking; message: string }
  | { ok: false; reason: string; message: string; alternatives?: string[] };

/**
 * Create an appointment, or explain exactly why it cannot exist.
 *
 * Nothing here ever reports success it did not get from storage: the caller
 * may only tell a customer "booked" after `ok: true`.
 */
export async function book(req: BookRequest): Promise<BookResult> {
  const { business } = req;

  const service = findService(business, req.serviceRef);
  if (!service) {
    return {
      ok: false,
      reason: "unknown_service",
      message: `ما عندي خدمة بهذا الاسم. المتوفر: ${business.services.map((s) => s.name).join("، ")}.`,
    };
  }

  const start = parseHHMM(req.time);
  if (start === null) {
    return { ok: false, reason: "bad_time", message: "الوقت مش مفهوم. استعمل صيغة HH:MM." };
  }

  if (req.staffId && !business.staff.some((s) => s.id === req.staffId && s.active)) {
    return { ok: false, reason: "unknown_staff", message: "هاد الموظف مش متاح." };
  }

  const avail = await availability({
    business,
    date: req.date,
    service,
    staffId: req.staffId,
    now: req.now,
  });
  if (!avail.ok) return { ok: false, reason: avail.reason, message: avail.message };

  const wanted = formatHHMM(start);
  if (!avail.slots.includes(wanted)) {
    return {
      ok: false,
      reason: "unavailable",
      message: avail.slots.length
        ? `${formatArabicTime(start)} مش متاح. المتاح: ${avail.slots
            .slice(0, 6)
            .map((s) => formatArabicTime(parseHHMM(s) ?? 0))
            .join("، ")}.`
        : "ما في مواعيد فاضية بهذا اليوم.",
      alternatives: avail.slots.slice(0, 6),
    };
  }

  const startsAt = zonedToUtc(req.date, wanted, business.timezone);
  if (!startsAt) {
    return { ok: false, reason: "bad_time", message: "ما قدرت أحدد وقت الموعد بالضبط." };
  }
  const endsAt = new Date(startsAt.getTime() + service.durationMin * 60000);

  const result = await getRepo().createBooking({
    businessId: business.id,
    serviceId: service.id,
    serviceName: service.name,
    durationMin: service.durationMin,
    staffId: req.staffId,
    customerId: req.customerId,
    date: req.date,
    time: wanted,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    note: req.note,
    source: req.source,
  });

  if (!result.ok) {
    // A conflict here means the slot went between the read and the write.
    // Offer what is left rather than reporting a generic failure.
    const again = await availability({
      business, date: req.date, service, staffId: req.staffId, now: req.now,
    });
    return {
      ok: false,
      reason: result.reason,
      message: result.message,
      alternatives: again.ok ? again.slots.slice(0, 6) : undefined,
    };
  }

  const weekday = WEEKDAY_AR[weekdayOf(req.date)];
  return {
    ok: true,
    booking: result.booking,
    message: `تم الحجز: ${service.name} يوم ${weekday} ${req.date} الساعة ${formatArabicTime(start)}.`,
  };
}

export async function cancel(businessId: string, bookingId: string) {
  return getRepo().cancelBooking(businessId, bookingId);
}

export async function listBookings(
  businessId: string,
  opts: { date?: string; from?: string; to?: string; includeCancelled?: boolean } = {},
) {
  return getRepo().listBookings(businessId, opts);
}
