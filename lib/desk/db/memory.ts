/**
 * In-memory adapter — development and tests only.
 *
 * It implements the same contract as the Supabase adapter, including the
 * overlap rule that the database enforces with an exclusion constraint, so a
 * flow that works here behaves the same against Postgres. What it cannot give
 * you is persistence or safety across instances: everything is lost on
 * restart, and two server instances do not see each other's bookings.
 * `persistent: false` is how the rest of the product knows that, and the UI
 * says it out loud rather than pretending.
 *
 * Businesses come from the DESK_TENANTS environment variable via the existing
 * tenant loader, so the local setup that worked before still works.
 */

import type { Repo, CreateBookingInput, CreateBookingResult, RepoHealth } from "./repo";
import type {
  Agent, AgentEvent, AgentState, BlockedTime, Booking, BusinessProfile,
  ChannelKind, Conversation, Customer, EscalationRecord, Message, Task, TaskStep,
} from "./types";
import { listTenants, type Tenant } from "../tenants";
import { seedAgents } from "../agents";

let seq = 0;
function id(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}
const nowIso = () => new Date().toISOString();

/** Bring an env-configured tenant up to the full business profile shape. */
function toProfile(t: Tenant): BusinessProfile {
  return {
    id: t.id,
    slug: t.id,
    name: t.name,
    kind: t.kind,
    timezone: t.timezone,
    currency: t.services.find((s) => s.currency)?.currency ?? "JOD",
    city: t.city,
    address: t.address,
    mapUrl: t.mapUrl,
    phone: t.phone,
    hours: t.hours,
    services: t.services.map((s) => ({
      id: s.id,
      code: s.id,
      name: s.name,
      durationMin: s.durationMin,
      price: s.price,
      currency: s.currency,
      note: s.note,
      active: true,
    })),
    staff: [],
    knowledge: (t.facts ?? []).map((f, i) => ({
      id: `${t.id}-k${i}`,
      question: f.q,
      answer: f.a,
    })),
    policies: {
      ...(t.policies ?? {}),
      // The gate reads the owner's own topics from policies, so carry them
      // across from the legacy tenant shape rather than dropping them.
      ...(t.escalation?.topics?.length ? { escalateTopics: t.escalation.topics } : {}),
    },
    escalationContact: t.escalation?.ownerContact,
    leadTimeMin: t.leadTimeMin,
    slotStepMin: t.slotStepMin,
    horizonDays: t.horizonDays,
    isDemo: !!t.isExample,
  };
}

type Tables = {
  bookings: Booking[];
  blocked: BlockedTime[];
  customers: Customer[];
  conversations: Conversation[];
  messages: Message[];
  escalations: EscalationRecord[];
  agents: Agent[];
  tasks: Task[];
  events: AgentEvent[];
};

const tables = new Map<string, Tables>();

function tablesFor(businessId: string): Tables {
  let t = tables.get(businessId);
  if (!t) {
    t = {
      bookings: [], blocked: [], customers: [], conversations: [], messages: [],
      escalations: [], agents: seedAgents(), tasks: [], events: [],
    };
    tables.set(businessId, t);
  }
  return t;
}

/** Test seam: forget everything. */
export function resetMemory(): void {
  tables.clear();
  seq = 0;
}

export function createMemoryRepo(): Repo {
  const profiles = () => listTenants().map(toProfile);

  const repo: Repo = {
    kind: "memory",
    persistent: false,

    async health(): Promise<RepoHealth> {
      return {
        ok: true,
        kind: "memory",
        persistent: false,
        message:
          "تخزين مؤقت بالذاكرة — بينمسح مع كل إعادة تشغيل وما بينشارك بين النسخ. " +
          "للاستخدام الحقيقي لازم Supabase.",
      };
    },

    async listBusinesses() {
      return profiles().map((b) => ({
        id: b.id, slug: b.slug, name: b.name, kind: b.kind, isDemo: b.isDemo,
      }));
    },

    async getBusiness(idOrSlug) {
      const key = (idOrSlug ?? "").trim();
      return profiles().find((b) => b.id === key || b.slug === key) ?? null;
    },

    async getBusinessByChannel(kind, externalId) {
      // Routing comes from configuration in the memory setup; the Supabase
      // adapter reads the channels table instead.
      const raw = process.env.DESK_WHATSAPP_ROUTES?.trim();
      if (kind === "whatsapp" && raw) {
        try {
          const map = JSON.parse(raw) as Record<string, string>;
          const slug = map?.[externalId];
          if (slug) return repo.getBusiness(slug);
        } catch {
          /* a malformed route map falls through to the default below */
        }
      }
      const fallback = process.env.DESK_DEFAULT_TENANT?.trim();
      return fallback ? repo.getBusiness(fallback) : null;
    },

    async listBookings(businessId, opts = {}) {
      const t = tablesFor(businessId);
      return t.bookings
        .filter((b) => (opts.includeCancelled ? true : b.status === "confirmed"))
        .filter((b) => (opts.date ? b.date === opts.date : true))
        .filter((b) => (opts.from ? b.date >= opts.from : true))
        .filter((b) => (opts.to ? b.date <= opts.to : true))
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    },

    async createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
      const t = tablesFor(input.businessId);
      const start = Date.parse(input.startsAt);
      const end = Date.parse(input.endsAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return { ok: false, reason: "storage", message: "وقت الحجز غير صالح." };
      }

      // The same rule the database enforces: confirmed bookings for the same
      // business and the same staff member may not overlap.
      const clash = t.bookings.some((b) => {
        if (b.status !== "confirmed") return false;
        if ((b.staffId ?? null) !== (input.staffId ?? null)) return false;
        const span = absolute.get(b.id);
        if (!span) return false;
        return start < span.end && span.start < end;
      });
      if (clash) {
        return { ok: false, reason: "conflict", message: "هاد الوقت محجوز." };
      }

      const booking: Booking = {
        id: id("bk"),
        businessId: input.businessId,
        serviceId: input.serviceId,
        serviceName: input.serviceName,
        staffId: input.staffId,
        customerId: input.customerId,
        date: input.date,
        time: input.time,
        durationMin: input.durationMin,
        status: "confirmed",
        note: input.note,
        source: input.source ?? "agent",
        createdAt: nowIso(),
      };
      // Keep the absolute instants so later overlap checks are exact.
      absolute.set(booking.id, { start, end });
      t.bookings.push(booking);
      return { ok: true, booking };
    },

    async cancelBooking(businessId, bookingId) {
      const t = tablesFor(businessId);
      const found = t.bookings.find((b) => b.id === bookingId);
      if (!found) return { ok: false, message: "ما لقيت هاد الحجز." };
      if (found.status === "cancelled") return { ok: false, message: "هاد الحجز ملغي أصلاً." };
      found.status = "cancelled";
      return { ok: true, message: `تم إلغاء ${found.serviceName} يوم ${found.date}.` };
    },

    async listBlockedTimes(businessId, date) {
      return tablesFor(businessId).blocked.filter((b) => b.date === date);
    },

    async findCustomer(businessId, channel, contact) {
      return (
        tablesFor(businessId).customers.find(
          (c) => c.channel === channel && c.contact === contact,
        ) ?? null
      );
    },

    async upsertCustomer({ businessId, channel, contact, name }) {
      const t = tablesFor(businessId);
      const existing = t.customers.find((c) => c.channel === channel && c.contact === contact);
      if (existing) {
        if (name && !existing.name) existing.name = name;
        return existing;
      }
      const customer: Customer = {
        id: id("cust"), businessId, name, contact, channel, createdAt: nowIso(),
      };
      t.customers.push(customer);
      return customer;
    },

    async openConversation({ businessId, customerId, channel }) {
      const t = tablesFor(businessId);
      const open = t.conversations.find(
        (c) => c.customerId === customerId && c.channel === channel && c.status !== "closed",
      );
      if (open) return open;
      const convo: Conversation = {
        id: id("conv"), businessId, customerId, channel,
        status: "open", startedAt: nowIso(), lastAt: nowIso(),
      };
      t.conversations.push(convo);
      return convo;
    },

    async getConversation(businessId, conversationId) {
      return tablesFor(businessId).conversations.find((c) => c.id === conversationId) ?? null;
    },

    async listConversations(businessId, limit = 50) {
      return [...tablesFor(businessId).conversations]
        .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
        .slice(0, limit);
    },

    async setConversationStatus(businessId, conversationId, status) {
      const c = tablesFor(businessId).conversations.find((x) => x.id === conversationId);
      if (c) { c.status = status; c.lastAt = nowIso(); }
    },

    async appendMessage({ businessId, conversationId, role, body, externalId }) {
      const t = tablesFor(businessId);
      if (externalId) {
        const dupe = t.messages.find((m) => m.externalId === externalId);
        // A retried webhook must not produce a second message or a second reply.
        if (dupe) return { message: dupe, duplicate: true };
      }
      const message: Message = {
        id: id("msg"), conversationId, role, body, externalId, createdAt: nowIso(),
      };
      t.messages.push(message);
      const convo = t.conversations.find((c) => c.id === conversationId);
      if (convo) convo.lastAt = message.createdAt;
      return { message, duplicate: false };
    },

    async listMessages(conversationId, limit = 40) {
      for (const t of Array.from(tables.values())) {
        const found = t.messages.filter((m) => m.conversationId === conversationId);
        if (found.length) return found.slice(-limit);
      }
      return [];
    },

    async createEscalation(input) {
      const t = tablesFor(input.businessId);
      const rec: EscalationRecord = {
        id: id("esc"),
        businessId: input.businessId,
        conversationId: input.conversationId,
        customerId: input.customerId,
        reason: input.reason,
        matched: input.matched,
        customerMessage: input.customerMessage,
        status: "open",
        createdAt: nowIso(),
      };
      t.escalations.push(rec);
      return rec;
    },

    async listEscalations(businessId, opts = {}) {
      return tablesFor(businessId)
        .escalations.filter((e) => (opts.openOnly ? e.status === "open" : true))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async resolveEscalation(businessId, escId) {
      const e = tablesFor(businessId).escalations.find((x) => x.id === escId);
      if (!e) return { ok: false, message: "ما لقيت هاد التصعيد." };
      e.status = "resolved";
      e.resolvedAt = nowIso();
      return { ok: true, message: "تم." };
    },

    async listAgents(businessId) {
      return tablesFor(businessId).agents;
    },

    async setAgentState(businessId, code, state: AgentState, currentTask) {
      const a = tablesFor(businessId).agents.find((x) => x.code === code);
      if (!a) return;
      // A planned agent has no code behind it; it cannot start working.
      if (a.lifecycle === "planned") return;
      a.state = state;
      a.currentTask = currentTask;
      a.updatedAt = nowIso();
    },

    async createTask({ businessId, conversationId, agentCode, title }) {
      const t = tablesFor(businessId);
      const task: Task = {
        id: id("task"), businessId, conversationId, agentCode, title,
        status: "running", steps: [], startedAt: nowIso(),
      };
      t.tasks.push(task);
      return task;
    },

    async addTaskStep(taskId, step) {
      for (const t of Array.from(tables.values())) {
        const task = t.tasks.find((x) => x.id === taskId);
        if (task) {
          task.steps.push({ ...step, createdAt: nowIso() } as TaskStep);
          return;
        }
      }
    },

    async endTask(taskId, status) {
      for (const t of Array.from(tables.values())) {
        const task = t.tasks.find((x) => x.id === taskId);
        if (task) { task.status = status; task.endedAt = nowIso(); return; }
      }
    },

    async getTask(businessId, taskId) {
      return tablesFor(businessId).tasks.find((t) => t.id === taskId) ?? null;
    },

    async listTasks(businessId, limit = 30) {
      return [...tablesFor(businessId).tasks]
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit);
    },

    async emitEvent(input) {
      const t = tablesFor(input.businessId);
      const ev: AgentEvent = {
        id: id("ev"),
        businessId: input.businessId,
        taskId: input.taskId,
        agentCode: input.agentCode,
        kind: input.kind,
        from: input.from,
        to: input.to,
        summary: input.summary,
        detail: input.detail,
        createdAt: nowIso(),
      };
      t.events.push(ev);
      if (t.events.length > 500) t.events.splice(0, t.events.length - 500);
      return ev;
    },

    async listEvents(businessId, limit = 80) {
      return [...tablesFor(businessId).events]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    },
  };

  return repo;
}

/* Absolute instants per booking, so the overlap test compares real times
   rather than local strings from possibly different offsets. Kept beside the
   table because Booking is the shape the rest of the product consumes. */
const absolute = new Map<string, { start: number; end: number }>();
