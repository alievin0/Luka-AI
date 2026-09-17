/**
 * Appointments: what is actually free, and what was actually booked.
 *
 * Every check here is a hard gate. The receptionist never decides whether a
 * slot is available — it asks this module, and a slot that is closed, taken,
 * in the past, or inside the lead time is refused no matter how the customer
 * phrased the request. A confirmed appointment the business cannot honour is
 * worse than no appointment at all.
 *
 * Storage is in memory, per server instance: it is the seam a real database
 * plugs into, and `listBookings` / `importBookings` exist so that swap does
 * not require touching the availability logic.
 */

import type { Tenant, Service } from "./tenants";
import { findService } from "./tenants";
import {
  parseHHMM,
  formatHHMM,
  formatArabicTime,
  isValidDate,
  weekdayOf,
  zonedNow,
  WEEKDAY_AR,
} from "./time";

export type Booking = {
  id: string;
  tenantId: string;
  serviceId: string;
  serviceName: string;
  /** Tenant-local date, "YYYY-MM-DD". */
  date: string;
  /** Tenant-local start time, "HH:MM". */
  time: string;
  durationMin: number;
  customerName?: string;
  customerContact?: string;
  note?: string;
  createdAt: string;
  status: "confirmed" | "cancelled";
};

const store = new Map<string, Booking[]>();
let counter = 0;

function bucket(tenantId: string): Booking[] {
  let list = store.get(tenantId);
  if (!list) {
    list = [];
    store.set(tenantId, list);
  }
  return list;
}

function nextId(tenantId: string): string {
  counter += 1;
  return `${tenantId}-${Date.now().toString(36)}-${counter}`;
}

function overlaps(aStart: number, aLen: number, bStart: number, bLen: number): boolean {
  return aStart < bStart + bLen && bStart < aStart + aLen;
}

export type SlotQuery = {
  tenant: Tenant;
  date: string;
  service: Service;
  /** Injectable for tests; defaults to the real clock. */
  now?: Date;
};

export type Availability =
  | { ok: true; slots: string[]; date: string }
  | { ok: false; reason: "closed" | "past" | "beyond_horizon" | "bad_date"; message: string };

/** Every start time a service can actually begin on a given day. */
export function availability(q: SlotQuery): Availability {
  const { tenant, date, service } = q;

  if (!isValidDate(date)) {
    return { ok: false, reason: "bad_date", message: "التاريخ مش مفهوم. استعمل صيغة YYYY-MM-DD." };
  }

  const now = zonedNow(tenant.timezone, q.now);

  if (date < now.date) {
    return { ok: false, reason: "past", message: "هاد التاريخ راح خلص." };
  }

  const horizonMs = tenant.horizonDays * 86400000;
  const daysAhead = Math.round(
    (new Date(`${date}T12:00:00Z`).getTime() - new Date(`${now.date}T12:00:00Z`).getTime()) / 86400000,
  );
  if (daysAhead * 86400000 > horizonMs) {
    return {
      ok: false,
      reason: "beyond_horizon",
      message: `بنستقبل حجوزات لغاية ${tenant.horizonDays} يوم قدّام بس.`,
    };
  }

  const weekday = weekdayOf(date);
  const hours = tenant.hours?.[weekday];
  if (!hours) {
    return { ok: false, reason: "closed", message: `${tenant.name} مسكّرة يوم ${WEEKDAY_AR[weekday]}.` };
  }

  const open = parseHHMM(hours.open);
  const close = parseHHMM(hours.close);
  if (open === null || close === null || close <= open) {
    return { ok: false, reason: "closed", message: "أوقات الدوام مش مضبوطة لهاد اليوم." };
  }

  // A slot must finish before closing, not merely start before it.
  const lastStart = close - service.durationMin;
  if (lastStart < open) {
    return {
      ok: false,
      reason: "closed",
      message: `مدة «${service.name}» أطول من دوام يوم ${WEEKDAY_AR[weekday]}.`,
    };
  }

  const earliest = date === now.date ? now.minutes + tenant.leadTimeMin : open;
  const taken = bucket(tenant.id).filter((b) => b.status === "confirmed" && b.date === date);

  const slots: string[] = [];
  for (let start = open; start <= lastStart; start += tenant.slotStepMin) {
    if (start < earliest) continue;
    const clash = taken.some((b) => {
      const bStart = parseHHMM(b.time);
      return bStart !== null && overlaps(start, service.durationMin, bStart, b.durationMin);
    });
    if (!clash) slots.push(formatHHMM(start));
  }

  return { ok: true, slots, date };
}

export type BookRequest = {
  tenant: Tenant;
  serviceRef: string;
  date: string;
  time: string;
  customerName?: string;
  customerContact?: string;
  note?: string;
  now?: Date;
};

export type BookResult =
  | { ok: true; booking: Booking; message: string }
  | { ok: false; reason: string; message: string; alternatives?: string[] };

/** Create an appointment, or explain precisely why it cannot exist. */
export function book(req: BookRequest): BookResult {
  const { tenant } = req;

  const service = findService(tenant, req.serviceRef);
  if (!service) {
    return {
      ok: false,
      reason: "unknown_service",
      message: `ما عندي خدمة بهذا الاسم. المتوفر: ${tenant.services.map((s) => s.name).join("، ")}.`,
    };
  }

  const start = parseHHMM(req.time);
  if (start === null) {
    return { ok: false, reason: "bad_time", message: "الوقت مش مفهوم. استعمل صيغة HH:MM." };
  }

  const avail = availability({ tenant, date: req.date, service, now: req.now });
  if (!avail.ok) {
    return { ok: false, reason: avail.reason, message: avail.message };
  }

  const wanted = formatHHMM(start);
  if (!avail.slots.includes(wanted)) {
    return {
      ok: false,
      reason: "unavailable",
      message: avail.slots.length
        ? `${formatArabicTime(start)} مش متاح. المتاح: ${avail.slots.slice(0, 6).map((s) => formatArabicTime(parseHHMM(s) ?? 0)).join("، ")}.`
        : "ما في مواعيد فاضية بهذا اليوم.",
      alternatives: avail.slots.slice(0, 6),
    };
  }

  const booking: Booking = {
    id: nextId(tenant.id),
    tenantId: tenant.id,
    serviceId: service.id,
    serviceName: service.name,
    date: req.date,
    time: wanted,
    durationMin: service.durationMin,
    customerName: req.customerName?.trim() || undefined,
    customerContact: req.customerContact?.trim() || undefined,
    note: req.note?.trim() || undefined,
    createdAt: new Date().toISOString(),
    status: "confirmed",
  };
  bucket(tenant.id).push(booking);

  const weekday = WEEKDAY_AR[weekdayOf(req.date)];
  return {
    ok: true,
    booking,
    message: `تم الحجز: ${service.name} يوم ${weekday} ${req.date} الساعة ${formatArabicTime(start)}.`,
  };
}

export function cancel(tenantId: string, bookingId: string): { ok: boolean; message: string } {
  const found = bucket(tenantId).find((b) => b.id === bookingId);
  if (!found) return { ok: false, message: "ما لقيت هاد الحجز." };
  if (found.status === "cancelled") return { ok: false, message: "هاد الحجز ملغي أصلاً." };
  found.status = "cancelled";
  return { ok: true, message: `تم إلغاء حجز ${found.serviceName} يوم ${found.date}.` };
}

export function listBookings(tenantId: string, opts: { includeCancelled?: boolean } = {}): Booking[] {
  const all = bucket(tenantId);
  const list = opts.includeCancelled ? all : all.filter((b) => b.status === "confirmed");
  return [...list].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/** Seam for a real datastore: replace the in-memory contents for a tenant. */
export function importBookings(tenantId: string, bookings: Booking[]): void {
  store.set(tenantId, [...bookings]);
}

/** Used by tests to start from a known state. */
export function clearBookings(tenantId?: string): void {
  if (tenantId) store.delete(tenantId);
  else store.clear();
}
