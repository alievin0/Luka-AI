/**
 * The data model, in one place.
 *
 * `BusinessProfile` is the closed world the receptionist may speak from: if a
 * fact is not here, the agent does not have it and must escalate. Everything
 * else hangs off a business id, and nothing in the system reads across
 * businesses.
 */

import type { Weekday } from "../time";

export type ChannelKind = "whatsapp" | "instagram" | "web" | "voice";

export type Service = {
  id: string;
  /** Stable short code used by tools and URLs, e.g. "clean". */
  code: string;
  name: string;
  durationMin: number;
  price?: number;
  currency?: string;
  note?: string;
  active: boolean;
};

export type StaffMember = {
  id: string;
  name: string;
  role?: string;
  active: boolean;
};

export type DayHours = { open: string; close: string } | null;

export type BlockedTime = {
  id: string;
  staffId?: string;
  date: string;
  /** Null start/end means the whole day is blocked. */
  start?: string;
  end?: string;
  reason?: string;
};

export type KnowledgeItem = { id: string; question: string; answer: string };

export type BusinessPolicies = {
  cancellationHours?: number;
  depositRequired?: boolean;
  walkIns?: boolean;
  parking?: string;
  refund?: string;
  discounts?: string;
  /** Extra subjects this owner always wants a person to handle. */
  escalateTopics?: string[];
};

export type BusinessProfile = {
  id: string;
  /** Human-facing identifier used in URLs and channel routing. */
  slug: string;
  name: string;
  kind: string;
  timezone: string;
  currency: string;
  city?: string;
  address?: string;
  mapUrl?: string;
  phone?: string;
  hours: Record<Weekday, DayHours>;
  services: Service[];
  staff: StaffMember[];
  knowledge: KnowledgeItem[];
  policies: BusinessPolicies;
  escalationContact?: string;
  leadTimeMin: number;
  slotStepMin: number;
  horizonDays: number;
  /** True for the bundled demo business — surfaced in the UI, never hidden. */
  isDemo: boolean;
};

export type BookingStatus = "confirmed" | "cancelled" | "completed" | "no_show";

export type Booking = {
  id: string;
  businessId: string;
  serviceId: string;
  serviceName: string;
  staffId?: string;
  staffName?: string;
  customerId?: string;
  customerName?: string;
  /** Business-local date, "YYYY-MM-DD". */
  date: string;
  /** Business-local start, "HH:MM". */
  time: string;
  durationMin: number;
  status: BookingStatus;
  note?: string;
  source: string;
  createdAt: string;
};

export type Customer = {
  id: string;
  businessId: string;
  name?: string;
  contact: string;
  channel: ChannelKind;
  createdAt: string;
};

export type ConversationStatus = "open" | "awaiting_human" | "closed";

export type Conversation = {
  id: string;
  businessId: string;
  customerId?: string;
  channel: ChannelKind;
  status: ConversationStatus;
  intent?: string;
  startedAt: string;
  lastAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  role: "customer" | "agent" | "human";
  body: string;
  externalId?: string;
  createdAt: string;
};

export type EscalationRecord = {
  id: string;
  businessId: string;
  conversationId?: string;
  customerId?: string;
  reason: string;
  matched?: string;
  customerMessage: string;
  status: "open" | "acknowledged" | "resolved";
  createdAt: string;
  resolvedAt?: string;
};

/* ── the agent / task / event model the world visualization mirrors ──────── */

export type AgentZone =
  | "reception"
  | "booking"
  | "knowledge"
  | "tools"
  | "escalation"
  | "supervision"
  | "workshop"
  | "business";

export type AgentState =
  | "idle"
  | "working"
  | "processing"
  | "waiting"
  | "using_tool"
  | "escalated"
  | "error"
  | "offline"
  | "deploying";

/** `live` means code exists and runs; `planned` means designed, not built. */
export type AgentLifecycle = "live" | "planned";

export type Agent = {
  code: string;
  name: string;
  role: string;
  zone: AgentZone;
  state: AgentState;
  lifecycle: AgentLifecycle;
  /** What it is doing right now, when it is doing something. */
  currentTask?: string;
  capabilities: string[];
  tools: string[];
  permissions: string[];
  updatedAt: string;
};

export type TaskStatus = "running" | "completed" | "failed" | "escalated";

export type TaskStep = {
  seq: number;
  label: string;
  status: "done" | "failed" | "skipped";
  detail?: string;
  createdAt: string;
};

export type Task = {
  id: string;
  businessId: string;
  conversationId?: string;
  agentCode?: string;
  title: string;
  status: TaskStatus;
  steps: TaskStep[];
  startedAt: string;
  endedAt?: string;
};

/** One line of the event stream, and one edge the world can draw. */
export type AgentEvent = {
  id: string;
  businessId: string;
  taskId?: string;
  agentCode?: string;
  kind: string;
  /** The visual edge: who → whom. Node ids are zones, agent codes, or "customer". */
  from?: string;
  to?: string;
  summary: string;
  detail?: Record<string, unknown>;
  createdAt: string;
};
