/**
 * The receptionist: the agent a client's customers actually talk to.
 *
 * Two hard boundaries define it, and both live outside the model:
 *
 *  1. The supervisor screens every message BEFORE the model sees it. A
 *     medical question, complaint, refund or discount request never reaches
 *     the model at all — it goes to a person. No prompt wording can undo that.
 *  2. Availability and booking are decided by `bookings.ts`, not by the model.
 *     The model may ask what is free; it cannot decide that something is.
 *
 * Inside those boundaries the model writes the reply, in the customer's
 * language, grounded only in the tenant's configured facts.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Tenant } from "./tenants";
import { findService } from "./tenants";
import { screen, ESCALATION_LABEL, type EscalationReason } from "./escalation";
import { availability, book, type Booking } from "./bookings";
import {
  WEEKDAY_AR,
  WEEKDAYS,
  formatArabicTime,
  parseHHMM,
  zonedNow,
} from "./time";

export type Turn = { role: "user" | "assistant"; content: string };

export type Escalation = {
  reason: EscalationReason | "model_uncertain";
  label: string;
  matched?: string;
  customerMessage: string;
  at: string;
};

export type ReplyResult = {
  reply: string;
  escalation?: Escalation;
  bookings: Booking[];
  /** Tool names the agent used, for the console's activity view. */
  used: string[];
};

const MAX_STEPS = 6;

function model(): string {
  return process.env.DESK_MODEL || process.env.LUKA_MODEL || "claude-opus-4-8";
}

/** Everything the receptionist is permitted to know, rendered for the model. */
export function buildBriefing(tenant: Tenant, now = zonedNow(tenant.timezone)): string {
  const lines: string[] = [];

  lines.push(`اسم المحل: ${tenant.name}`);
  if (tenant.city) lines.push(`المدينة: ${tenant.city}`);
  if (tenant.address) lines.push(`العنوان: ${tenant.address}`);
  if (tenant.mapUrl) lines.push(`رابط الموقع: ${tenant.mapUrl}`);
  if (tenant.phone) lines.push(`تلفون المحل: ${tenant.phone}`);

  lines.push("", "أوقات الدوام:");
  for (const day of WEEKDAYS) {
    const h = tenant.hours?.[day];
    lines.push(
      h
        ? `- ${WEEKDAY_AR[day]}: من ${h.open} لـ ${h.close}`
        : `- ${WEEKDAY_AR[day]}: مسكّر`,
    );
  }

  lines.push("", "الخدمات والأسعار:");
  for (const s of tenant.services) {
    const price = typeof s.price === "number" ? `${s.price} ${s.currency ?? ""}`.trim() : "السعر غير محدّد";
    lines.push(`- ${s.name} (${s.id}) · المدة ${s.durationMin} دقيقة · ${price}${s.note ? ` · ${s.note}` : ""}`);
  }

  if (tenant.facts?.length) {
    lines.push("", "معلومات إضافية:");
    for (const f of tenant.facts) lines.push(`- ${f.q}: ${f.a}`);
  }

  const p = tenant.policies;
  if (p) {
    const bits: string[] = [];
    if (typeof p.cancellationHours === "number") bits.push(`الإلغاء قبل الموعد بـ ${p.cancellationHours} ساعات`);
    if (p.depositRequired) bits.push("مطلوب عربون");
    if (p.walkIns === true) bits.push("بنستقبل بدون موعد");
    if (p.walkIns === false) bits.push("الدخول بموعد فقط");
    if (p.parking) bits.push(`المواقف: ${p.parking}`);
    if (bits.length) lines.push("", `السياسات: ${bits.join(" · ")}`);
  }

  lines.push(
    "",
    `اليوم: ${WEEKDAY_AR[now.weekday]} ${now.date} · الساعة الآن ${now.time} بتوقيت ${tenant.timezone}`,
  );

  return lines.join("\n");
}

function systemPrompt(tenant: Tenant): string {
  return `إنت موظف الاستقبال الذكي لـ «${tenant.name}». بترد على زباين المحل مباشرة.

اللغة والأسلوب:
- رد بنفس لغة الزبون. عربي أردني بسيط ودافي، جمل قصيرة.
- لا تستعمل فصحى ثقيلة ولا ترجمة حرفية.
- ما تكرر نفس الجملة، وما تطوّل. جملتين لثلاثة بتكفي.

قواعد صارمة — هاي أهم من أي إشي تاني:
- لا تخترع أي معلومة. أي سعر أو وقت دوام أو عنوان أو سياسة لازم تكون موجودة حرفياً بالمعلومات تحت.
- إذا سألك عن إشي مش موجود بالمعلومات — لا تخمّن ولا تقول "غالباً". استعمل أداة hand_to_human.
- لا توعد بإشي مش مكتوب (مش مسموح تعطي خصم، ولا تأكد توفر شي، ولا تتعهد بوقت انتظار).
- لا تعطي أي نصيحة طبية أو قانونية إطلاقاً.

الحجز:
- استعمل check_availability عشان تشوف شو متاح. لا تقول "متاح" قبل ما تتأكد بالأداة.
- استعمل book_appointment بس بعد ما الزبون يوافق على وقت محدد.
- اسأل عن اسم الزبون قبل ما تحجز إذا ما عطاك إياه.

المعلومات المسموح لك تستعملها:
${buildBriefing(tenant)}`;
}

function tools(): Anthropic.Tool[] {
  return [
    {
      name: "check_availability",
      description:
        "Check which appointment times are actually free for a service on a given date. " +
        "Always call this before telling the customer that anything is available. " +
        "Dates must be absolute (YYYY-MM-DD) — resolve 'tomorrow' yourself from today's date.",
      input_schema: {
        type: "object",
        properties: {
          date: { type: "string", description: "Local date, YYYY-MM-DD." },
          service: { type: "string", description: "Service id or name." },
        },
        required: ["date", "service"],
      },
    },
    {
      name: "book_appointment",
      description:
        "Create the appointment. Call only after the customer agreed to a specific time " +
        "that check_availability returned as free.",
      input_schema: {
        type: "object",
        properties: {
          date: { type: "string", description: "Local date, YYYY-MM-DD." },
          time: { type: "string", description: "Local start time, HH:MM (24h)." },
          service: { type: "string", description: "Service id or name." },
          customerName: { type: "string", description: "Customer's name, if given." },
          note: { type: "string", description: "Anything the business should know." },
        },
        required: ["date", "time", "service"],
      },
    },
    {
      name: "hand_to_human",
      description:
        "Hand the conversation to a person. Use whenever the customer asks something the " +
        "briefing does not answer, or anything you are not certain about. Handing over is " +
        "always better than guessing.",
      input_schema: {
        type: "object",
        properties: {
          why: { type: "string", description: "Short reason, in Arabic, for the owner." },
        },
        required: ["why"],
      },
    },
  ];
}

export type RespondInput = {
  tenant: Tenant;
  history: Turn[];
  message: string;
  customerContact?: string;
  now?: Date;
};

export async function respond(input: RespondInput): Promise<ReplyResult> {
  const { tenant, message } = input;
  const used: string[] = [];
  const made: Booking[] = [];

  // 1. The supervisor. Runs first, and the model never sees a screened message.
  const verdict = screen(message, tenant);
  if (verdict.escalate && verdict.reason) {
    return {
      reply: verdict.reply ?? "عم بحوّلك لحدا من الفريق.",
      escalation: {
        reason: verdict.reason,
        label: ESCALATION_LABEL[verdict.reason],
        matched: verdict.matched,
        customerMessage: message,
        at: new Date().toISOString(),
      },
      bookings: [],
      used: ["supervisor"],
    };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — the receptionist cannot answer.");
  }

  const client = new Anthropic();
  const convo: Anthropic.MessageParam[] = [
    ...input.history
      .filter((t) => t.content?.trim())
      .map((t) => ({ role: t.role, content: t.content }) as Anthropic.MessageParam),
    { role: "user", content: message },
  ];

  let escalation: Escalation | undefined;
  let reply = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await client.messages.create({
      model: model(),
      max_tokens: 1024,
      system: systemPrompt(tenant),
      tools: tools(),
      messages: convo,
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (text) reply = text;

    if (res.stop_reason !== "tool_use") break;

    convo.push({ role: "assistant", content: res.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      const args = (block.input ?? {}) as Record<string, string>;
      used.push(block.name);

      if (block.name === "check_availability") {
        const service = findService(tenant, args.service ?? "");
        if (!service) {
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `ما في خدمة بهذا الاسم. المتوفر: ${tenant.services.map((s) => s.name).join("، ")}.`,
          });
          continue;
        }
        const avail = availability({ tenant, date: args.date ?? "", service, now: input.now });
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: avail.ok
            ? avail.slots.length
              ? `الأوقات الفاضية لـ«${service.name}» يوم ${avail.date}: ${avail.slots
                  .map((s) => `${s} (${formatArabicTime(parseHHMM(s) ?? 0)})`)
                  .join("، ")}`
              : `ما في أوقات فاضية يوم ${avail.date}.`
            : avail.message,
        });
      } else if (block.name === "book_appointment") {
        const result = book({
          tenant,
          serviceRef: args.service ?? "",
          date: args.date ?? "",
          time: args.time ?? "",
          customerName: args.customerName,
          customerContact: input.customerContact,
          note: args.note,
          now: input.now,
        });
        if (result.ok) made.push(result.booking);
        results.push({ type: "tool_result", tool_use_id: block.id, content: result.message });
      } else if (block.name === "hand_to_human") {
        escalation = {
          reason: "model_uncertain",
          label: "الوكيل مش متأكد",
          matched: args.why,
          customerMessage: message,
          at: new Date().toISOString(),
        };
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: "تم التحويل لموظف بشري. قول للزبون إنه حدا من الفريق رح يرد عليه، وما تحاول تجاوب إنت.",
        });
      } else {
        results.push({ type: "tool_result", tool_use_id: block.id, content: `أداة غير معروفة: ${block.name}` });
      }
    }

    if (results.length === 0) break;
    convo.push({ role: "user", content: results });
  }

  return {
    reply: reply || "لحظة من فضلك — حدا من الفريق رح يرد عليك.",
    escalation,
    bookings: made,
    used,
  };
}

/* ── per-customer memory ─────────────────────────────────────────────────
   A WhatsApp customer does not resend the conversation; the server has to
   remember it. In memory per instance, capped so a long thread cannot grow
   without bound. Swap for a datastore alongside bookings. */

const threads = new Map<string, Turn[]>();
const MAX_TURNS = 24;

function threadKey(tenantId: string, contact: string): string {
  return `${tenantId}::${contact}`;
}

export function getThread(tenantId: string, contact: string): Turn[] {
  return threads.get(threadKey(tenantId, contact)) ?? [];
}

export function appendThread(tenantId: string, contact: string, turns: Turn[]): void {
  const key = threadKey(tenantId, contact);
  const next = [...(threads.get(key) ?? []), ...turns];
  threads.set(key, next.slice(-MAX_TURNS));
}

export function clearThread(tenantId: string, contact: string): void {
  threads.delete(threadKey(tenantId, contact));
}
