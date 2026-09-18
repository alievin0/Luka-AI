/**
 * The pipeline every channel runs through.
 *
 *   incoming → channel → policy gate → receptionist → tools → response → log
 *
 * WhatsApp, Instagram and web chat all normalize to the same message shape and
 * call `handleIncoming`, so the reasoning, the guards and the audit trail exist
 * once rather than once per channel.
 *
 * Every hop emits an event with a `from` and a `to`. That is what lets the
 * world visualization be a mirror of the system: it draws the edges this
 * function records, not an animation invented separately.
 */

import type { BusinessProfile, ChannelKind, EscalationRecord, Task } from "./db/types";
import { getRepo } from "./db";
import { screen, ESCALATION_LABEL } from "./escalation";
import { respond, type Turn } from "./receptionist";

export type NormalizedMessage = {
  channel: ChannelKind;
  /** The channel account that received it (a WhatsApp phone_number_id, etc). */
  accountId?: string;
  /** Used when the channel carries no routing of its own, e.g. web chat. */
  businessRef?: string;
  /** The customer's address on that channel. */
  from: string;
  text: string;
  /** The channel's own message id — makes a retried delivery a no-op. */
  externalId?: string;
  profileName?: string;
};

export type HandleResult = {
  ok: boolean;
  /** True when this delivery was already processed; nothing was re-sent. */
  duplicate?: boolean;
  reply?: string;
  business?: BusinessProfile;
  conversationId?: string;
  taskId?: string;
  escalation?: EscalationRecord;
  error?: string;
};

export async function resolveBusiness(msg: NormalizedMessage): Promise<BusinessProfile | null> {
  const repo = getRepo();
  if (msg.accountId) {
    const routed = await repo.getBusinessByChannel(msg.channel, msg.accountId);
    if (routed) return routed;
  }
  if (msg.businessRef) return repo.getBusiness(msg.businessRef);
  return null;
}

export async function handleIncoming(msg: NormalizedMessage): Promise<HandleResult> {
  const repo = getRepo();

  const business = await resolveBusiness(msg);
  if (!business) {
    return { ok: false, error: "ما في نشاط تجاري مربوط بهذه القناة." };
  }

  const text = (msg.text ?? "").trim();
  if (!text) return { ok: false, business, error: "رسالة فاضية." };

  let task: Task | null = null;

  try {
    const customer = await repo.upsertCustomer({
      businessId: business.id,
      channel: msg.channel,
      contact: msg.from,
      name: msg.profileName,
    });

    const conversation = await repo.openConversation({
      businessId: business.id,
      customerId: customer.id,
      channel: msg.channel,
    });

    const stored = await repo.appendMessage({
      businessId: business.id,
      conversationId: conversation.id,
      role: "customer",
      body: text,
      externalId: msg.externalId,
    });

    // A retried webhook must not produce a second reply to the customer.
    if (stored.duplicate) {
      return {
        ok: true,
        duplicate: true,
        business,
        conversationId: conversation.id,
      };
    }

    task = await repo.createTask({
      businessId: business.id,
      conversationId: conversation.id,
      agentCode: "reception",
      title: text.slice(0, 80),
    });

    let seq = 0;
    const stepAndEvent = async (
      label: string,
      from: string,
      to: string,
      summary: string,
      ok = true,
    ) => {
      seq += 1;
      await repo.addTaskStep(task!.id, {
        seq,
        label,
        status: ok ? "done" : "failed",
        detail: summary,
      });
      await repo.emitEvent({
        businessId: business.id,
        taskId: task!.id,
        agentCode: to,
        kind: label,
        from,
        to,
        summary,
      });
    };

    await stepAndEvent("message_received", "customer", `channel-${msg.channel}`, text.slice(0, 120));

    /* ── the policy gate: before the model, and not negotiable by it ── */
    await repo.setAgentState(business.id, "policy", "processing", task.id);
    const verdict = screen(text, business);
    await repo.setAgentState(business.id, "policy", "idle");

    if (verdict.escalate && verdict.reason) {
      const label = ESCALATION_LABEL[verdict.reason];
      await stepAndEvent("policy_blocked", `channel-${msg.channel}`, "policy", label);

      const escalation = await repo.createEscalation({
        businessId: business.id,
        conversationId: conversation.id,
        customerId: customer.id,
        reason: verdict.reason,
        matched: verdict.matched,
        customerMessage: text,
      });

      await stepAndEvent("escalation_created", "policy", "handoff", label);
      await stepAndEvent("human_notified", "handoff", "business", label);

      const reply = verdict.reply ?? "عم بحوّلك لحدا من الفريق.";
      await repo.appendMessage({
        businessId: business.id,
        conversationId: conversation.id,
        role: "agent",
        body: reply,
      });
      await repo.setConversationStatus(business.id, conversation.id, "awaiting_human");
      await repo.endTask(task.id, "escalated");

      return {
        ok: true,
        reply,
        business,
        conversationId: conversation.id,
        taskId: task.id,
        escalation,
      };
    }

    await stepAndEvent("policy_passed", `channel-${msg.channel}`, "reception", "مرّت بوابة السياسات");

    /* ── the receptionist ── */
    await repo.setAgentState(business.id, "reception", "working", task.id);

    const priorMessages = await repo.listMessages(conversation.id, 20);
    const history: Turn[] = priorMessages
      .filter((m) => m.role !== "human")
      .slice(0, -1) // the message just stored is passed separately
      .map((m) => ({ role: m.role === "customer" ? "user" : "assistant", content: m.body }));

    const pendingTools: Array<{ name: string; ok: boolean; summary: string }> = [];
    const result = await respond({
      business,
      history,
      message: text,
      customerId: customer.id,
      onTool: (t) => pendingTools.push(t),
    });

    for (const t of pendingTools) {
      const zone =
        t.name === "get_availability" || t.name === "create_booking" ? "booking" : "knowledge";
      await stepAndEvent(t.name, "reception", zone, t.summary, t.ok);
      if (t.name === "create_booking" && t.ok) {
        await stepAndEvent("booking_confirmed", "booking", "customer", t.summary);
      }
    }

    if (result.customerName) {
      await repo.upsertCustomer({
        businessId: business.id,
        channel: msg.channel,
        contact: msg.from,
        name: result.customerName,
      });
    }

    await repo.appendMessage({
      businessId: business.id,
      conversationId: conversation.id,
      role: "agent",
      body: result.reply,
    });

    let escalation: EscalationRecord | undefined;
    if (result.handoff) {
      escalation = await repo.createEscalation({
        businessId: business.id,
        conversationId: conversation.id,
        customerId: customer.id,
        reason: result.failed ? "system_error" : "agent_uncertain",
        matched: result.handoff.why,
        customerMessage: text,
      });
      await stepAndEvent("escalation_created", "reception", "handoff", result.handoff.why);
      await repo.setConversationStatus(business.id, conversation.id, "awaiting_human");
    }

    await stepAndEvent("reply_sent", "reception", "customer", result.reply.slice(0, 120));
    await repo.setAgentState(business.id, "reception", "idle");
    await repo.endTask(
      task.id,
      result.failed ? "failed" : escalation ? "escalated" : "completed",
    );

    return {
      ok: !result.failed,
      reply: result.reply,
      business,
      conversationId: conversation.id,
      taskId: task.id,
      escalation,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[pipeline] failed:", detail);
    if (task) {
      await repo.endTask(task.id, "failed").catch(() => {});
      await repo
        .emitEvent({
          businessId: business.id,
          taskId: task.id,
          kind: "pipeline_error",
          from: "reception",
          to: "supervision",
          summary: detail,
        })
        .catch(() => {});
    }
    await repo.setAgentState(business.id, "reception", "error").catch(() => {});
    // Storage being down is never reported to the customer as success.
    return { ok: false, business, error: detail };
  }
}
