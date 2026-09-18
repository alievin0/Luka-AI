/**
 * The businesses this service answers for.
 *
 * A tenant is the complete set of facts the receptionist is allowed to state:
 * opening hours, services, prices, address, policies. This is deliberately a
 * closed world — if a customer asks something the tenant config does not
 * answer, the receptionist escalates instead of guessing. That single rule is
 * what keeps it from inventing a price and costing the client a customer.
 *
 * Tenants are loaded from the DESK_TENANTS environment variable (a JSON array).
 * The bundled entry is an explicitly-labelled example so the console is
 * testable before any real client is configured; it is never presented as a
 * real business.
 */

import type { Weekday } from "./time";
import { WEEKDAYS, parseHHMM } from "./time";

export type Service = {
  id: string;
  name: string;
  /** Minutes the appointment occupies. */
  durationMin: number;
  price?: number;
  currency?: string;
  note?: string;
};

/** Opening hours for one day, or null when closed. */
export type DayHours = { open: string; close: string } | null;

export type Tenant = {
  id: string;
  name: string;
  kind: "clinic" | "salon" | "gym" | "restaurant" | "shop" | "other";
  /** IANA timezone, e.g. "Asia/Amman". */
  timezone: string;
  city?: string;
  address?: string;
  mapUrl?: string;
  phone?: string;
  hours: Record<Weekday, DayHours>;
  services: Service[];
  /** Extra answerable facts, as question/answer pairs in the tenant's words. */
  facts?: Array<{ q: string; a: string }>;
  policies?: {
    cancellationHours?: number;
    depositRequired?: boolean;
    walkIns?: boolean;
    parking?: string;
  };
  escalation?: {
    /** Extra subjects this owner always wants handled by a person. */
    topics?: string[];
    /** Where escalations are sent (shown in the console; used by adapters). */
    ownerContact?: string;
  };
  /** Minimum minutes between now and the earliest bookable slot. */
  leadTimeMin: number;
  /** Booking grid in minutes, e.g. 15 or 30. */
  slotStepMin: number;
  /** How many days ahead bookings are accepted. */
  horizonDays: number;
  /** True for the bundled demo tenant — surfaced in the UI, never hidden. */
  isExample?: boolean;
};

const EXAMPLE_TENANT: Tenant = {
  id: "example",
  name: "عيادة المثال (تجريبي)",
  kind: "clinic",
  timezone: "Asia/Amman",
  city: "عمّان",
  address: "شارع المثال، عمّان",
  phone: "+962 7 0000 0000",
  isExample: true,
  hours: {
    sun: { open: "09:00", close: "17:00" },
    mon: { open: "09:00", close: "17:00" },
    tue: { open: "09:00", close: "17:00" },
    wed: { open: "09:00", close: "17:00" },
    thu: { open: "09:00", close: "15:00" },
    fri: null,
    sat: { open: "10:00", close: "14:00" },
  },
  services: [
    { id: "check", name: "كشفية", durationMin: 30, price: 20, currency: "JOD" },
    { id: "clean", name: "تنظيف أسنان", durationMin: 45, price: 35, currency: "JOD" },
    { id: "filling", name: "حشوة", durationMin: 60, price: 30, currency: "JOD" },
  ],
  facts: [
    { q: "التأمين", a: "بنقبل تأمين طبي، احكي مع الاستقبال قبل الموعد بيوم." },
    { q: "الموقف", a: "في موقف سيارات مجاني قدام العيادة." },
  ],
  policies: { cancellationHours: 4, walkIns: false, parking: "موقف مجاني" },
  escalation: { topics: ["تأمين خاص", "حالة طارئة"], ownerContact: "صاحب العيادة" },
  leadTimeMin: 60,
  slotStepMin: 15,
  horizonDays: 30,
};

export type TenantIssue = { tenantId: string; field: string; problem: string };

/**
 * Check a tenant config before it is ever used to answer a customer.
 * A silently malformed tenant is worse than a missing one: it produces
 * confident answers built on broken hours.
 */
export function validateTenant(t: Tenant): TenantIssue[] {
  const issues: TenantIssue[] = [];
  const id = t?.id || "(no id)";

  if (!t?.id?.trim()) issues.push({ tenantId: id, field: "id", problem: "مفقود" });
  if (!t?.name?.trim()) issues.push({ tenantId: id, field: "name", problem: "مفقود" });

  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: t.timezone });
  } catch {
    issues.push({ tenantId: id, field: "timezone", problem: `منطقة زمنية غير معروفة: ${t.timezone}` });
  }

  for (const day of WEEKDAYS) {
    const h = t.hours?.[day];
    if (h === null || h === undefined) continue;
    const open = parseHHMM(h.open);
    const close = parseHHMM(h.close);
    if (open === null) issues.push({ tenantId: id, field: `hours.${day}.open`, problem: `وقت غير صالح: ${h.open}` });
    if (close === null) issues.push({ tenantId: id, field: `hours.${day}.close`, problem: `وقت غير صالح: ${h.close}` });
    if (open !== null && close !== null && close <= open) {
      issues.push({ tenantId: id, field: `hours.${day}`, problem: "وقت الإغلاق قبل أو يساوي وقت الفتح" });
    }
  }

  if (!Array.isArray(t.services) || t.services.length === 0) {
    issues.push({ tenantId: id, field: "services", problem: "ما في خدمات معرّفة" });
  } else {
    const seen = new Set<string>();
    for (const s of t.services) {
      if (!s.id?.trim()) issues.push({ tenantId: id, field: "services[].id", problem: "مفقود" });
      else if (seen.has(s.id)) issues.push({ tenantId: id, field: `services.${s.id}`, problem: "معرّف مكرّر" });
      else seen.add(s.id);
      if (!s.name?.trim()) issues.push({ tenantId: id, field: `services.${s.id}.name`, problem: "مفقود" });
      if (!Number.isFinite(s.durationMin) || s.durationMin <= 0) {
        issues.push({ tenantId: id, field: `services.${s.id}.durationMin`, problem: "مدة غير صالحة" });
      }
    }
  }

  if (!Number.isFinite(t.slotStepMin) || t.slotStepMin <= 0) {
    issues.push({ tenantId: id, field: "slotStepMin", problem: "غير صالح" });
  }
  if (!Number.isFinite(t.leadTimeMin) || t.leadTimeMin < 0) {
    issues.push({ tenantId: id, field: "leadTimeMin", problem: "غير صالح" });
  }
  if (!Number.isFinite(t.horizonDays) || t.horizonDays <= 0) {
    issues.push({ tenantId: id, field: "horizonDays", problem: "غير صالح" });
  }

  return issues;
}

let cache: { tenants: Tenant[]; issues: TenantIssue[] } | null = null;

function load(): { tenants: Tenant[]; issues: TenantIssue[] } {
  if (cache) return cache;

  const raw = process.env.DESK_TENANTS?.trim();
  let tenants: Tenant[] = [];
  const issues: TenantIssue[] = [];

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) tenants = parsed as Tenant[];
      else issues.push({ tenantId: "(env)", field: "DESK_TENANTS", problem: "المتوقع مصفوفة JSON" });
    } catch {
      issues.push({ tenantId: "(env)", field: "DESK_TENANTS", problem: "JSON غير صالح" });
    }
  }

  // The example is always available so the console works out of the box, but
  // a real tenant with the same id replaces it.
  if (!tenants.some((t) => t?.id === EXAMPLE_TENANT.id)) {
    tenants = [...tenants, EXAMPLE_TENANT];
  }

  for (const t of tenants) issues.push(...validateTenant(t));

  cache = { tenants, issues };
  return cache;
}

/** Drop the cache — used by tests that change DESK_TENANTS between cases. */
export function resetTenantCache(): void {
  cache = null;
}

export function listTenants(): Tenant[] {
  return load().tenants;
}

export function tenantIssues(): TenantIssue[] {
  return load().issues;
}

export function getTenant(id: string): Tenant | null {
  const wanted = (id ?? "").trim();
  if (!wanted) return null;
  return load().tenants.find((t) => t.id === wanted) ?? null;
}

export function findService(tenant: Tenant, ref: string): Service | null {
  const needle = (ref ?? "").trim().toLowerCase();
  if (!needle) return null;
  const byId = tenant.services.find((s) => s.id.toLowerCase() === needle);
  if (byId) return byId;
  const exact = tenant.services.find((s) => s.name.toLowerCase() === needle);
  if (exact) return exact;
  return tenant.services.find((s) => s.name.toLowerCase().includes(needle)) ?? null;
}
