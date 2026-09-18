/**
 * Supabase adapter — the persistent store.
 *
 * Talks to PostgREST over plain fetch rather than pulling in a client library:
 * the surface used here is small, and it keeps the deployment dependency-free.
 *
 * Two keys, two roles:
 *   SUPABASE_SERVICE_ROLE_KEY — server only. Bypasses RLS by design, because
 *     the receptionist acts for whichever business the channel routed to. It
 *     must never reach the browser.
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY — the owner dashboard, where RLS is what
 *     keeps one business out of another's data.
 *
 * The double-booking guard is the database's exclusion constraint, not code
 * here: a conflicting insert comes back as Postgres error 23P01 and is
 * reported as a conflict.
 */

import type { Repo, CreateBookingInput, CreateBookingResult, RepoHealth } from "./repo";
import type {
  Agent, AgentEvent, AgentState, BlockedTime, Booking, BusinessProfile,
  ChannelKind, Conversation, Customer, EscalationRecord, Message, Task, TaskStep,
} from "./types";
import { seedAgents, AGENTS_BY_CODE } from "../agents";
import { WEEKDAYS, type Weekday } from "../time";

export type SupabaseConfig = { url: string; serviceKey: string };

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) return null;
  return { url: url.replace(/\/+$/, ""), serviceKey };
}

type PgError = { code?: string; message?: string; details?: string };

class Rest {
  constructor(private cfg: SupabaseConfig) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.cfg.serviceKey,
      Authorization: `Bearer ${this.cfg.serviceKey}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  async select<T>(table: string, query: string): Promise<T[]> {
    const res = await fetch(`${this.cfg.url}/rest/v1/${table}?${query}`, {
      headers: this.headers(),
      cache: "no-store",
    });
    if (!res.ok) throw await this.toError(res, `select ${table}`);
    return (await res.json()) as T[];
  }

  async insert<T>(table: string, body: unknown, opts: { upsert?: string } = {}): Promise<T[]> {
    const prefer = ["return=representation"];
    if (opts.upsert) prefer.push("resolution=merge-duplicates");
    const url =
      `${this.cfg.url}/rest/v1/${table}` + (opts.upsert ? `?on_conflict=${opts.upsert}` : "");
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers({ Prefer: prefer.join(",") }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.toError(res, `insert ${table}`);
    return (await res.json()) as T[];
  }

  async patch<T>(table: string, query: string, body: unknown): Promise<T[]> {
    const res = await fetch(`${this.cfg.url}/rest/v1/${table}?${query}`, {
      method: "PATCH",
      headers: this.headers({ Prefer: "return=representation" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.toError(res, `patch ${table}`);
    return (await res.json()) as T[];
  }

  private async toError(res: Response, what: string): Promise<Error & { pg?: PgError }> {
    const pg = (await res.json().catch(() => null)) as PgError | null;
    const err = new Error(
      `${what} failed (${res.status})${pg?.message ? `: ${pg.message}` : ""}`,
    ) as Error & { pg?: PgError };
    if (pg) err.pg = pg;
    return err;
  }
}

/** Postgres exclusion-constraint violation — the double-booking guard firing. */
function isConflict(err: unknown): boolean {
  const pg = (err as { pg?: PgError })?.pg;
  return pg?.code === "23P01" || pg?.code === "23505";
}

type BusinessRow = {
  id: string; slug: string; name: string; kind: string; timezone: string;
  city: string | null; address: string | null; map_url: string | null; phone: string | null;
  currency: string; lead_time_min: number; slot_step_min: number; horizon_days: number;
  policies: Record<string, unknown>; escalation_contact: string | null; is_demo: boolean;
  services?: Array<{
    id: string; code: string; name: string; duration_min: number;
    price: string | number | null; currency: string | null; note: string | null; active: boolean;
  }>;
  staff?: Array<{ id: string; name: string; role: string | null; active: boolean }>;
  business_hours?: Array<{ weekday: number; open_time: string; close_time: string }>;
  knowledge_items?: Array<{ id: string; question: string; answer: string; active: boolean }>;
};

const BUSINESS_SELECT =
  "*,services(id,code,name,duration_min,price,currency,note,active)," +
  "staff(id,name,role,active),business_hours(weekday,open_time,close_time)," +
  "knowledge_items(id,question,answer,active)";

function toProfile(row: BusinessRow): BusinessProfile {
  const hours = {} as Record<Weekday, { open: string; close: string } | null>;
  for (const d of WEEKDAYS) hours[d] = null;
  for (const h of row.business_hours ?? []) {
    const day = WEEKDAYS[h.weekday];
    if (day) hours[day] = { open: h.open_time, close: h.close_time };
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    timezone: row.timezone,
    currency: row.currency,
    city: row.city ?? undefined,
    address: row.address ?? undefined,
    mapUrl: row.map_url ?? undefined,
    phone: row.phone ?? undefined,
    hours,
    services: (row.services ?? [])
      .filter((s) => s.active)
      .map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        durationMin: s.duration_min,
        price: s.price === null ? undefined : Number(s.price),
        currency: s.currency ?? row.currency,
        note: s.note ?? undefined,
        active: s.active,
      })),
    staff: (row.staff ?? [])
      .filter((s) => s.active)
      .map((s) => ({ id: s.id, name: s.name, role: s.role ?? undefined, active: s.active })),
    knowledge: (row.knowledge_items ?? [])
      .filter((k) => k.active)
      .map((k) => ({ id: k.id, question: k.question, answer: k.answer })),
    policies: (row.policies ?? {}) as BusinessProfile["policies"],
    escalationContact: row.escalation_contact ?? undefined,
    leadTimeMin: row.lead_time_min,
    slotStepMin: row.slot_step_min,
    horizonDays: row.horizon_days,
    isDemo: row.is_demo,
  };
}

type BookingRow = {
  id: string; business_id: string; service_id: string; staff_id: string | null;
  customer_id: string | null; date: string; start_time: string; duration_min: number;
  status: Booking["status"]; note: string | null; source: string; created_at: string;
  services?: { name: string } | null;
  staff?: { name: string } | null;
  customers?: { name: string | null } | null;
};

function toBooking(r: BookingRow): Booking {
  return {
    id: r.id,
    businessId: r.business_id,
    serviceId: r.service_id,
    serviceName: r.services?.name ?? "",
    staffId: r.staff_id ?? undefined,
    staffName: r.staff?.name ?? undefined,
    customerId: r.customer_id ?? undefined,
    customerName: r.customers?.name ?? undefined,
    date: r.date,
    time: r.start_time,
    durationMin: r.duration_min,
    status: r.status,
    note: r.note ?? undefined,
    source: r.source,
    createdAt: r.created_at,
  };
}

const BOOKING_SELECT = "*,services(name),staff(name),customers(name)";
const enc = encodeURIComponent;

export function createSupabaseRepo(cfg: SupabaseConfig): Repo {
  const rest = new Rest(cfg);

  const repo: Repo = {
    kind: "supabase",
    persistent: true,

    async health(): Promise<RepoHealth> {
      try {
        await rest.select("businesses", "select=id&limit=1");
        return { ok: true, kind: "supabase", persistent: true, message: "قاعدة البيانات موصولة." };
      } catch (err) {
        return {
          ok: false,
          kind: "supabase",
          persistent: true,
          message: `تعذّر الوصول لقاعدة البيانات: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },

    async listBusinesses() {
      const rows = await rest.select<BusinessRow>(
        "businesses",
        "select=id,slug,name,kind,is_demo&order=name",
      );
      return rows.map((b) => ({
        id: b.id, slug: b.slug, name: b.name, kind: b.kind, isDemo: b.is_demo,
      }));
    },

    async getBusiness(idOrSlug) {
      const key = (idOrSlug ?? "").trim();
      if (!key) return null;
      const isUuid = /^[0-9a-f-]{36}$/i.test(key);
      const rows = await rest.select<BusinessRow>(
        "businesses",
        `select=${enc(BUSINESS_SELECT)}&${isUuid ? "id" : "slug"}=eq.${enc(key)}&limit=1`,
      );
      return rows[0] ? toProfile(rows[0]) : null;
    },

    async getBusinessByChannel(kind, externalId) {
      const rows = await rest.select<{ business_id: string }>(
        "channels",
        `select=business_id&kind=eq.${enc(kind)}&external_id=eq.${enc(externalId)}&status=eq.connected&limit=1`,
      );
      return rows[0] ? repo.getBusiness(rows[0].business_id) : null;
    },

    async listBookings(businessId, opts = {}) {
      const parts = [
        `select=${enc(BOOKING_SELECT)}`,
        `business_id=eq.${enc(businessId)}`,
        "order=date.asc,start_time.asc",
      ];
      if (!opts.includeCancelled) parts.push("status=eq.confirmed");
      if (opts.date) parts.push(`date=eq.${enc(opts.date)}`);
      if (opts.from) parts.push(`date=gte.${enc(opts.from)}`);
      if (opts.to) parts.push(`date=lte.${enc(opts.to)}`);
      const rows = await rest.select<BookingRow>("bookings", parts.join("&"));
      return rows.map(toBooking);
    },

    async createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
      try {
        const rows = await rest.insert<BookingRow>("bookings", {
          business_id: input.businessId,
          service_id: input.serviceId,
          staff_id: input.staffId ?? null,
          customer_id: input.customerId ?? null,
          date: input.date,
          start_time: input.time,
          duration_min: input.durationMin,
          starts_at: input.startsAt,
          ends_at: input.endsAt,
          note: input.note ?? null,
          source: input.source ?? "agent",
        });
        const row = rows[0];
        if (!row) {
          return { ok: false, reason: "storage", message: "ما رجع الحجز من قاعدة البيانات." };
        }
        return { ok: true, booking: { ...toBooking(row), serviceName: input.serviceName } };
      } catch (err) {
        // The exclusion constraint firing is the correct answer, not a bug:
        // someone took the slot between the availability read and the write.
        if (isConflict(err)) {
          return { ok: false, reason: "conflict", message: "هاد الوقت انحجز قبل شوي." };
        }
        return {
          ok: false,
          reason: "storage",
          message: err instanceof Error ? err.message : "فشل حفظ الحجز.",
        };
      }
    },

    async cancelBooking(businessId, bookingId) {
      try {
        const rows = await rest.patch<BookingRow>(
          "bookings",
          `id=eq.${enc(bookingId)}&business_id=eq.${enc(businessId)}&status=eq.confirmed`,
          { status: "cancelled" },
        );
        if (!rows.length) return { ok: false, message: "ما لقيت حجز مؤكد بهذا الرقم." };
        return { ok: true, message: `تم إلغاء الحجز يوم ${rows[0].date}.` };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "فشل الإلغاء." };
      }
    },

    async listBlockedTimes(businessId, date) {
      const rows = await rest.select<{
        id: string; staff_id: string | null; date: string;
        start_time: string | null; end_time: string | null; reason: string | null;
      }>(
        "blocked_times",
        `select=*&business_id=eq.${enc(businessId)}&date=eq.${enc(date)}`,
      );
      return rows.map((r): BlockedTime => ({
        id: r.id,
        staffId: r.staff_id ?? undefined,
        date: r.date,
        start: r.start_time ?? undefined,
        end: r.end_time ?? undefined,
        reason: r.reason ?? undefined,
      }));
    },

    async findCustomer(businessId, channel, contact) {
      const rows = await rest.select<{
        id: string; business_id: string; name: string | null;
        contact: string; channel: string; created_at: string;
      }>(
        "customers",
        `select=*&business_id=eq.${enc(businessId)}&channel=eq.${enc(channel)}&contact=eq.${enc(contact)}&limit=1`,
      );
      const r = rows[0];
      return r
        ? { id: r.id, businessId: r.business_id, name: r.name ?? undefined,
            contact: r.contact, channel: r.channel as ChannelKind, createdAt: r.created_at }
        : null;
    },

    async upsertCustomer({ businessId, channel, contact, name }) {
      const existing = await repo.findCustomer(businessId, channel, contact);
      if (existing) {
        if (name && !existing.name) {
          await rest.patch("customers", `id=eq.${enc(existing.id)}`, { name });
          return { ...existing, name };
        }
        return existing;
      }
      const rows = await rest.insert<{
        id: string; business_id: string; name: string | null;
        contact: string; channel: string; created_at: string;
      }>("customers", { business_id: businessId, channel, contact, name: name ?? null },
        { upsert: "business_id,channel,contact" });
      const r = rows[0];
      return { id: r.id, businessId: r.business_id, name: r.name ?? undefined,
               contact: r.contact, channel: r.channel as ChannelKind, createdAt: r.created_at };
    },

    async openConversation({ businessId, customerId, channel }) {
      if (customerId) {
        const open = await rest.select<ConversationRow>(
          "conversations",
          `select=*&business_id=eq.${enc(businessId)}&customer_id=eq.${enc(customerId)}` +
            `&channel=eq.${enc(channel)}&status=neq.closed&order=last_at.desc&limit=1`,
        );
        if (open[0]) return toConversation(open[0]);
      }
      const rows = await rest.insert<ConversationRow>("conversations", {
        business_id: businessId, customer_id: customerId ?? null, channel,
      });
      return toConversation(rows[0]);
    },

    async getConversation(businessId, conversationId) {
      const rows = await rest.select<ConversationRow>(
        "conversations",
        `select=*&business_id=eq.${enc(businessId)}&id=eq.${enc(conversationId)}&limit=1`,
      );
      return rows[0] ? toConversation(rows[0]) : null;
    },

    async listConversations(businessId, limit = 50) {
      const rows = await rest.select<ConversationRow>(
        "conversations",
        `select=*&business_id=eq.${enc(businessId)}&order=last_at.desc&limit=${limit}`,
      );
      return rows.map(toConversation);
    },

    async setConversationStatus(businessId, conversationId, status) {
      await rest.patch(
        "conversations",
        `id=eq.${enc(conversationId)}&business_id=eq.${enc(businessId)}`,
        { status, last_at: new Date().toISOString() },
      );
    },

    async appendMessage({ businessId, conversationId, role, body, externalId }) {
      if (externalId) {
        const dupe = await rest.select<MessageRow>(
          "messages",
          `select=*&business_id=eq.${enc(businessId)}&external_id=eq.${enc(externalId)}&limit=1`,
        );
        if (dupe[0]) return { message: toMessage(dupe[0]), duplicate: true };
      }
      try {
        const rows = await rest.insert<MessageRow>("messages", {
          business_id: businessId, conversation_id: conversationId,
          role, body, external_id: externalId ?? null,
        });
        await rest.patch("conversations", `id=eq.${enc(conversationId)}`, {
          last_at: new Date().toISOString(),
        });
        return { message: toMessage(rows[0]), duplicate: false };
      } catch (err) {
        // Two deliveries of the same webhook can race; the unique index is the
        // real guard and a violation here means the other one won.
        if (isConflict(err) && externalId) {
          const again = await rest.select<MessageRow>(
            "messages",
            `select=*&business_id=eq.${enc(businessId)}&external_id=eq.${enc(externalId)}&limit=1`,
          );
          if (again[0]) return { message: toMessage(again[0]), duplicate: true };
        }
        throw err;
      }
    },

    async listMessages(conversationId, limit = 40) {
      const rows = await rest.select<MessageRow>(
        "messages",
        `select=*&conversation_id=eq.${enc(conversationId)}&order=created_at.asc&limit=${limit}`,
      );
      return rows.map(toMessage);
    },

    async createEscalation(input) {
      const rows = await rest.insert<EscalationRow>("escalations", {
        business_id: input.businessId,
        conversation_id: input.conversationId ?? null,
        customer_id: input.customerId ?? null,
        reason: input.reason,
        matched: input.matched ?? null,
        customer_message: input.customerMessage,
      });
      return toEscalation(rows[0]);
    },

    async listEscalations(businessId, opts = {}) {
      const parts = [
        "select=*",
        `business_id=eq.${enc(businessId)}`,
        "order=created_at.desc",
        "limit=100",
      ];
      if (opts.openOnly) parts.push("status=eq.open");
      const rows = await rest.select<EscalationRow>("escalations", parts.join("&"));
      return rows.map(toEscalation);
    },

    async resolveEscalation(businessId, escId) {
      const rows = await rest.patch<EscalationRow>(
        "escalations",
        `id=eq.${enc(escId)}&business_id=eq.${enc(businessId)}`,
        { status: "resolved", resolved_at: new Date().toISOString() },
      );
      return rows.length
        ? { ok: true, message: "تم." }
        : { ok: false, message: "ما لقيت هاد التصعيد." };
    },

    async listAgents(businessId) {
      const rows = await rest.select<{
        code: string; name: string; role: string; zone: string;
        state: string; lifecycle: string; updated_at: string;
      }>("agents", `select=*&business_id=eq.${enc(businessId)}`);

      if (!rows.length) return seedAgents();

      // The roster in code is authoritative for what an agent can do; the row
      // only carries live state. That way a deploy cannot leave stale
      // capabilities in the database describing an agent that changed.
      return rows.map((r): Agent => {
        const def = AGENTS_BY_CODE[r.code];
        return {
          code: r.code,
          name: def?.name ?? r.name,
          role: def?.role ?? r.role,
          zone: (def?.zone ?? r.zone) as Agent["zone"],
          state: r.state as AgentState,
          lifecycle: (def?.lifecycle ?? r.lifecycle) as Agent["lifecycle"],
          capabilities: def?.capabilities ?? [],
          tools: def?.tools ?? [],
          permissions: def?.permissions ?? [],
          updatedAt: r.updated_at,
        };
      });
    },

    async setAgentState(businessId, code, state, currentTask) {
      if (AGENTS_BY_CODE[code]?.lifecycle === "planned") return;
      const def = AGENTS_BY_CODE[code];
      await rest.insert(
        "agents",
        {
          business_id: businessId,
          code,
          name: def?.name ?? code,
          role: def?.role ?? "",
          zone: def?.zone ?? "reception",
          lifecycle: def?.lifecycle ?? "live",
          state,
          updated_at: new Date().toISOString(),
        },
        { upsert: "business_id,code" },
      );
      void currentTask;
    },

    async createTask({ businessId, conversationId, agentCode, title }) {
      const rows = await rest.insert<TaskRow>("tasks", {
        business_id: businessId,
        conversation_id: conversationId ?? null,
        agent_code: agentCode ?? null,
        title,
      });
      return { ...toTask(rows[0]), steps: [] };
    },

    async addTaskStep(taskId, step) {
      await rest.insert("task_steps", {
        task_id: taskId, seq: step.seq, label: step.label,
        status: step.status, detail: step.detail ?? null,
      });
    },

    async endTask(taskId, status) {
      await rest.patch("tasks", `id=eq.${enc(taskId)}`, {
        status, ended_at: new Date().toISOString(),
      });
    },

    async getTask(businessId, taskId) {
      const rows = await rest.select<TaskRow & { task_steps?: StepRow[] }>(
        "tasks",
        `select=*,task_steps(seq,label,status,detail,created_at)` +
          `&business_id=eq.${enc(businessId)}&id=eq.${enc(taskId)}&limit=1`,
      );
      if (!rows[0]) return null;
      return { ...toTask(rows[0]), steps: (rows[0].task_steps ?? []).map(toStep) };
    },

    async listTasks(businessId, limit = 30) {
      const rows = await rest.select<TaskRow & { task_steps?: StepRow[] }>(
        "tasks",
        `select=*,task_steps(seq,label,status,detail,created_at)` +
          `&business_id=eq.${enc(businessId)}&order=started_at.desc&limit=${limit}`,
      );
      return rows.map((r) => ({ ...toTask(r), steps: (r.task_steps ?? []).map(toStep) }));
    },

    async emitEvent(input) {
      const rows = await rest.insert<EventRow>("agent_events", {
        business_id: input.businessId,
        task_id: input.taskId ?? null,
        agent_code: input.agentCode ?? null,
        kind: input.kind,
        from_node: input.from ?? null,
        to_node: input.to ?? null,
        summary: input.summary,
        detail: input.detail ?? {},
      });
      return toEvent(rows[0]);
    },

    async listEvents(businessId, limit = 80) {
      const rows = await rest.select<EventRow>(
        "agent_events",
        `select=*&business_id=eq.${enc(businessId)}&order=created_at.desc&limit=${limit}`,
      );
      return rows.map(toEvent);
    },
  };

  return repo;
}

/* ── row shapes and mappers ──────────────────────────────────────────────── */

type ConversationRow = {
  id: string; business_id: string; customer_id: string | null; channel: string;
  status: string; intent: string | null; started_at: string; last_at: string;
};
function toConversation(r: ConversationRow): Conversation {
  return {
    id: r.id, businessId: r.business_id, customerId: r.customer_id ?? undefined,
    channel: r.channel as ChannelKind, status: r.status as Conversation["status"],
    intent: r.intent ?? undefined, startedAt: r.started_at, lastAt: r.last_at,
  };
}

type MessageRow = {
  id: string; conversation_id: string; role: string; body: string;
  external_id: string | null; created_at: string;
};
function toMessage(r: MessageRow): Message {
  return {
    id: r.id, conversationId: r.conversation_id, role: r.role as Message["role"],
    body: r.body, externalId: r.external_id ?? undefined, createdAt: r.created_at,
  };
}

type EscalationRow = {
  id: string; business_id: string; conversation_id: string | null; customer_id: string | null;
  reason: string; matched: string | null; customer_message: string;
  status: string; created_at: string; resolved_at: string | null;
};
function toEscalation(r: EscalationRow): EscalationRecord {
  return {
    id: r.id, businessId: r.business_id,
    conversationId: r.conversation_id ?? undefined,
    customerId: r.customer_id ?? undefined,
    reason: r.reason, matched: r.matched ?? undefined,
    customerMessage: r.customer_message,
    status: r.status as EscalationRecord["status"],
    createdAt: r.created_at, resolvedAt: r.resolved_at ?? undefined,
  };
}

type TaskRow = {
  id: string; business_id: string; conversation_id: string | null;
  agent_code: string | null; title: string; status: string;
  started_at: string; ended_at: string | null;
};
function toTask(r: TaskRow): Task {
  return {
    id: r.id, businessId: r.business_id,
    conversationId: r.conversation_id ?? undefined,
    agentCode: r.agent_code ?? undefined,
    title: r.title, status: r.status as Task["status"], steps: [],
    startedAt: r.started_at, endedAt: r.ended_at ?? undefined,
  };
}

type StepRow = { seq: number; label: string; status: string; detail: string | null; created_at: string };
function toStep(r: StepRow): TaskStep {
  return {
    seq: r.seq, label: r.label, status: r.status as TaskStep["status"],
    detail: r.detail ?? undefined, createdAt: r.created_at,
  };
}

type EventRow = {
  id: string; business_id: string; task_id: string | null; agent_code: string | null;
  kind: string; from_node: string | null; to_node: string | null;
  summary: string; detail: Record<string, unknown>; created_at: string;
};
function toEvent(r: EventRow): AgentEvent {
  return {
    id: r.id, businessId: r.business_id,
    taskId: r.task_id ?? undefined, agentCode: r.agent_code ?? undefined,
    kind: r.kind, from: r.from_node ?? undefined, to: r.to_node ?? undefined,
    summary: r.summary, detail: r.detail, createdAt: r.created_at,
  };
}
