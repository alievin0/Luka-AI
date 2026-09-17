/**
 * The storage interface every part of the product talks to.
 *
 * Nothing above this layer knows whether the data lives in Postgres or in
 * process memory. That matters for one specific reason: the booking guards
 * must be enforceable by the database, so scaling the app past a single
 * instance cannot produce a double booking.
 *
 * Two adapters implement it:
 *   supabase — persistent, and the only one suitable for real customers
 *   memory   — for local development and tests; loses everything on restart
 */

import type {
  Agent,
  AgentEvent,
  AgentState,
  BlockedTime,
  Booking,
  BusinessProfile,
  ChannelKind,
  Conversation,
  Customer,
  EscalationRecord,
  Message,
  Task,
  TaskStep,
} from "./types";

export type CreateBookingInput = {
  businessId: string;
  serviceId: string;
  serviceName: string;
  durationMin: number;
  staffId?: string;
  customerId?: string;
  date: string;
  time: string;
  /** Absolute instants, resolved from the business timezone by the caller. */
  startsAt: string;
  endsAt: string;
  note?: string;
  source?: string;
};

export type CreateBookingResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: "conflict" | "storage"; message: string };

export type RepoHealth = {
  ok: boolean;
  kind: "supabase" | "memory";
  /** False means the data does not survive a restart — never for real customers. */
  persistent: boolean;
  message: string;
};

export interface Repo {
  readonly kind: "supabase" | "memory";
  readonly persistent: boolean;

  health(): Promise<RepoHealth>;

  /* business profile — the receptionist's closed world */
  listBusinesses(): Promise<Array<Pick<BusinessProfile, "id" | "slug" | "name" | "kind" | "isDemo">>>;
  getBusiness(idOrSlug: string): Promise<BusinessProfile | null>;
  /** Route an inbound channel account to the business that owns it. */
  getBusinessByChannel(kind: ChannelKind, externalId: string): Promise<BusinessProfile | null>;

  /* bookings */
  listBookings(
    businessId: string,
    opts?: { date?: string; from?: string; to?: string; includeCancelled?: boolean },
  ): Promise<Booking[]>;
  createBooking(input: CreateBookingInput): Promise<CreateBookingResult>;
  cancelBooking(businessId: string, bookingId: string): Promise<{ ok: boolean; message: string }>;
  listBlockedTimes(businessId: string, date: string): Promise<BlockedTime[]>;

  /* customers and conversations */
  findCustomer(businessId: string, channel: ChannelKind, contact: string): Promise<Customer | null>;
  upsertCustomer(input: {
    businessId: string;
    channel: ChannelKind;
    contact: string;
    name?: string;
  }): Promise<Customer>;

  openConversation(input: {
    businessId: string;
    customerId?: string;
    channel: ChannelKind;
  }): Promise<Conversation>;
  getConversation(businessId: string, conversationId: string): Promise<Conversation | null>;
  listConversations(businessId: string, limit?: number): Promise<Conversation[]>;
  setConversationStatus(
    businessId: string,
    conversationId: string,
    status: Conversation["status"],
  ): Promise<void>;

  /**
   * Append a message. `externalId` makes this idempotent: a channel that
   * retries a webhook must not produce a second stored message or a second
   * reply, so a duplicate resolves to `{ duplicate: true }`.
   */
  appendMessage(input: {
    businessId: string;
    conversationId: string;
    role: Message["role"];
    body: string;
    externalId?: string;
  }): Promise<{ message: Message; duplicate: boolean }>;
  listMessages(conversationId: string, limit?: number): Promise<Message[]>;

  /* escalations */
  createEscalation(input: {
    businessId: string;
    conversationId?: string;
    customerId?: string;
    reason: string;
    matched?: string;
    customerMessage: string;
  }): Promise<EscalationRecord>;
  listEscalations(businessId: string, opts?: { openOnly?: boolean }): Promise<EscalationRecord[]>;
  resolveEscalation(businessId: string, id: string): Promise<{ ok: boolean; message: string }>;

  /* agents, tasks, events — what the world visualization mirrors */
  listAgents(businessId: string): Promise<Agent[]>;
  setAgentState(businessId: string, code: string, state: AgentState, currentTask?: string): Promise<void>;

  createTask(input: {
    businessId: string;
    conversationId?: string;
    agentCode?: string;
    title: string;
  }): Promise<Task>;
  addTaskStep(taskId: string, step: Omit<TaskStep, "createdAt">): Promise<void>;
  endTask(taskId: string, status: Task["status"]): Promise<void>;
  getTask(businessId: string, taskId: string): Promise<Task | null>;
  listTasks(businessId: string, limit?: number): Promise<Task[]>;

  emitEvent(input: {
    businessId: string;
    taskId?: string;
    agentCode?: string;
    kind: string;
    from?: string;
    to?: string;
    summary: string;
    detail?: Record<string, unknown>;
  }): Promise<AgentEvent>;
  listEvents(businessId: string, limit?: number): Promise<AgentEvent[]>;
}
