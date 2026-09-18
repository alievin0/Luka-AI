/**
 * The receptionist agent.
 *
 * Two boundaries define it, and both are outside the model:
 *
 *  1. The policy gate runs before this function is ever called. A screened
 *     message never reaches the model. See `pipeline.ts` and `escalation.ts`.
 *  2. Availability and booking are decided by `bookings.ts` against stored
 *     data. The model may ask what is free; it cannot decide that anything is,
 *     and it is told in the tool result — not in the prompt — what happened.
 *
 * Inside those boundaries the model writes the reply, in the customer's
 * language, grounded only in the business profile it is given.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { BusinessProfile } from "./db/types";
import { availability, book, findService, type BookResult } from "./bookings";
import {
  WEEKDAY_AR, WEEKDAYS, formatArabicTime, parseHHMM, zonedNow,
} from "./time";

export type Turn = { role: "user" | "assistant"; content: string };

export type ToolTrace = {
  name: string;
  ok: boolean;
  summary: string;
};

export type ReplyResult = {
  reply: string;
  /** Set when the model itself decided it could not answer safely. */
  handoff?: { why: string };
  /** Bookings actually written to storage. Never populated speculatively. */
  bookings: BookResult[];
  /** A name the customer gave, for the pipeline to persist. */
  customerName?: string;
  trace: ToolTrace[];
  /** True when the model could not be reached at all. */
  failed?: boolean;
};

const MAX_STEPS = 6;

function modelId(): string {
  return process.env.DESK_MODEL || process.env.LUKA_MODEL || "claude-opus-4-8";
}

/** Everything the receptionist is permitted to know, rendered for the model. */
export function buildBriefing(business: BusinessProfile, now = zonedNow(business.timezone)): string {
  const lines: string[] = [];
  lines.push(`اسم النشاط: ${business.name}`);
  if (business.city) lines.push(`المدينة: ${business.city}`);
  if (business.address) lines.push(`العنوان: ${business.address}`);
  if (business.mapUrl) lines.push(`رابط الموقع: ${business.mapUrl}`);
  if (business.phone) lines.push(`التلفون: ${business.phone}`);

  lines.push("", "أوقات الدوام:");
  for (const day of WEEKDAYS) {
    const h = business.hours?.[day];
    lines.push(h ? `- ${WEEKDAY_AR[day]}: من ${h.open} لـ ${h.close}` : `- ${WEEKDAY_AR[day]}: مسكّر`);
  }

  lines.push("", "الخدمات والأسعار:");
  for (const s of business.services) {
    const price =
      typeof s.price === "number"
        ? `${s.price} ${s.currency ?? business.currency}`.trim()
        : "السعر غير محدّد";
    lines.push(`- ${s.name} (${s.code}) · المدة ${s.durationMin} دقيقة · ${price}${s.note ? ` · ${s.note}` : ""}`);
  }

  if (business.staff.length) {
    lines.push("", `الموظفون: ${business.staff.map((s) => s.name).join("، ")}`);
  }

  if (business.knowledge.length) {
    lines.push("", "معلومات إضافية:");
    for (const k of business.knowledge) lines.push(`- ${k.question}: ${k.answer}`);
  }

  const p = business.policies;
  const bits: string[] = [];
  if (typeof p.cancellationHours === "number") bits.push(`الإلغاء قبل الموعد بـ ${p.cancellationHours} ساعات`);
  if (p.depositRequired) bits.push("مطلوب عربون");
  if (p.walkIns === true) bits.push("بنستقبل بدون موعد");
  if (p.walkIns === false) bits.push("الدخول بموعد فقط");
  if (p.parking) bits.push(`المواقف: ${p.parking}`);
  if (p.refund) bits.push(`الاسترجاع: ${p.refund}`);
  if (p.discounts) bits.push(`الخصومات: ${p.discounts}`);
  if (bits.length) lines.push("", `السياسات: ${bits.join(" · ")}`);

  lines.push("", `اليوم: ${WEEKDAY_AR[now.weekday]} ${now.date} · الساعة الآن ${now.time} بتوقيت ${business.timezone}`);
  return lines.join("\n");
}

function systemPrompt(business: BusinessProfile): string {
  return `إنت موظف الاستقبال لـ «${business.name}». بترد على زباين النشاط مباشرة.

اللغة:
- رد بنفس لغة الزبون. عربي أردني بسيط ودافي، جمل قصيرة.
- جملتين لثلاثة بتكفي. ما تكرر ولا تطوّل.

قواعد صارمة — أهم من أي إشي تاني:
- لا تخترع أي معلومة. أي سعر أو دوام أو عنوان أو سياسة لازم تكون موجودة حرفياً بالمعلومات تحت.
- إذا سألك عن إشي مش موجود بالمعلومات — لا تخمّن ولا تقول "غالباً". استعمل escalate_to_human.
- لا توعد بإشي مش مكتوب: لا خصم، ولا استثناء، ولا وقت انتظار.
- لا تعطي أي نصيحة طبية أو قانونية إطلاقاً.

الحجز:
- استعمل get_availability قبل ما تقول إنه في وقت متاح. لا تقترح وقت من راسك.
- استعمل create_booking بس بعد ما الزبون يوافق على وقت محدد.
- **لا تقول "حجزتلك" إلا إذا رجعت create_booking إنه نجح فعلاً.** إذا فشلت، قول للزبون شو صار واعرض البدائل.
- إذا عطاك اسمه، سجّله بـ save_customer_name.

المعلومات المسموح لك تستعملها:
${buildBriefing(business)}`;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_business_info",
    description: "Read the business profile: address, phone, hours, policies. Use it instead of guessing any of them.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_services",
    description: "List the services this business offers with real durations and prices.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_availability",
    description:
      "Which start times are actually free for a service on a date. Always call this before telling the " +
      "customer anything is available. Dates are absolute (YYYY-MM-DD) — resolve 'tomorrow' yourself.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Local date, YYYY-MM-DD." },
        service: { type: "string", description: "Service code or name." },
        staff: { type: "string", description: "Staff member name, if the customer asked for one." },
      },
      required: ["date", "service"],
    },
  },
  {
    name: "create_booking",
    description:
      "Create the appointment. Only after the customer agreed to a time that get_availability returned. " +
      "Read the result: it may fail, and then the appointment does NOT exist.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Local date, YYYY-MM-DD." },
        time: { type: "string", description: "Local start time, HH:MM (24h)." },
        service: { type: "string", description: "Service code or name." },
        staff: { type: "string", description: "Staff member name, if requested." },
        note: { type: "string", description: "Anything the business should know." },
      },
      required: ["date", "time", "service"],
    },
  },
  {
    name: "save_customer_name",
    description: "Record the customer's name once they give it, so the business has it on the booking.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "The name the customer gave." } },
      required: ["name"],
    },
  },
  {
    name: "escalate_to_human",
    description:
      "Hand the conversation to a person. Use whenever the briefing does not answer the question, or " +
      "whenever you are not certain. Handing over is always better than guessing.",
    input_schema: {
      type: "object",
      properties: { why: { type: "string", description: "Short reason, in Arabic, for the owner." } },
      required: ["why"],
    },
  },
];

export type RespondInput = {
  business: BusinessProfile;
  history: Turn[];
  message: string;
  customerId?: string;
  /** Called for every tool use, so the pipeline can record steps and events. */
  onTool?: (trace: ToolTrace) => void;
  now?: Date;
};

export async function respond(input: RespondInput): Promise<ReplyResult> {
  const { business, message } = input;
  const trace: ToolTrace[] = [];
  const bookings: BookResult[] = [];
  let handoff: { why: string } | undefined;
  let customerName: string | undefined;
  let reply = "";

  const note = (t: ToolTrace) => {
    trace.push(t);
    input.onTool?.(t);
  };

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      reply: "عذراً، في مشكلة تقنية مؤقتة. حدا من الفريق رح يتواصل معك.",
      bookings: [],
      trace: [],
      failed: true,
    };
  }

  const client = new Anthropic();
  const convo: Anthropic.MessageParam[] = [
    ...input.history
      .filter((t) => t.content?.trim())
      .map((t) => ({ role: t.role, content: t.content }) as Anthropic.MessageParam),
    { role: "user", content: message },
  ];

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await client.messages.create({
        model: modelId(),
        max_tokens: 1024,
        system: systemPrompt(business),
        tools: TOOLS,
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
        let content = "";

        if (block.name === "get_business_info") {
          content = buildBriefing(business, zonedNow(business.timezone, input.now));
          note({ name: block.name, ok: true, summary: "قرأ بيانات النشاط" });
        } else if (block.name === "get_services") {
          content = business.services
            .map((s) => `${s.name} (${s.code}) · ${s.durationMin} دقيقة · ${
              typeof s.price === "number" ? `${s.price} ${s.currency ?? business.currency}` : "السعر غير محدّد"
            }`)
            .join("\n");
          note({ name: block.name, ok: true, summary: `قرأ ${business.services.length} خدمة` });
        } else if (block.name === "get_availability") {
          const service = findService(business, args.service ?? "");
          if (!service) {
            content = `ما في خدمة بهذا الاسم. المتوفر: ${business.services.map((s) => s.name).join("، ")}.`;
            note({ name: block.name, ok: false, summary: "خدمة غير معروفة" });
          } else {
            const staffId = business.staff.find((s) => s.name === args.staff)?.id;
            const a = await availability({
              business, date: args.date ?? "", service, staffId, now: input.now,
            });
            content = a.ok
              ? a.slots.length
                ? `الأوقات الفاضية لـ«${service.name}» يوم ${a.date}: ${a.slots
                    .map((s) => `${s} (${formatArabicTime(parseHHMM(s) ?? 0)})`)
                    .join("، ")}`
                : `ما في أوقات فاضية يوم ${a.date}.`
              : a.message;
            note({
              name: block.name,
              ok: a.ok,
              summary: a.ok ? `${a.slots.length} وقت متاح يوم ${a.date}` : a.message,
            });
          }
        } else if (block.name === "create_booking") {
          const staffId = business.staff.find((s) => s.name === args.staff)?.id;
          const result = await book({
            business,
            serviceRef: args.service ?? "",
            date: args.date ?? "",
            time: args.time ?? "",
            staffId,
            customerId: input.customerId,
            note: args.note,
            source: "agent",
            now: input.now,
          });
          bookings.push(result);
          // The model is told plainly whether the row exists, so it cannot
          // report a confirmation the database refused.
          content = result.ok
            ? `تم إنشاء الحجز فعلياً. ${result.message}`
            : `فشل الحجز ولم يتم إنشاء أي موعد. السبب: ${result.message}` +
              (result.alternatives?.length ? ` الأوقات البديلة: ${result.alternatives.join("، ")}` : "");
          note({ name: block.name, ok: result.ok, summary: result.message });
        } else if (block.name === "save_customer_name") {
          customerName = (args.name ?? "").trim() || undefined;
          content = customerName ? "تم تسجيل الاسم." : "الاسم فاضي.";
          note({ name: block.name, ok: !!customerName, summary: customerName ?? "اسم فاضي" });
        } else if (block.name === "escalate_to_human") {
          handoff = { why: (args.why ?? "").trim() || "الوكيل مش متأكد" };
          content = "تم التحويل لموظف بشري. قول للزبون إنه حدا من الفريق رح يرد عليه، وما تحاول تجاوب إنت.";
          note({ name: block.name, ok: true, summary: handoff.why });
        } else {
          content = `أداة غير معروفة: ${block.name}`;
          note({ name: block.name, ok: false, summary: "أداة غير معروفة" });
        }

        results.push({ type: "tool_result", tool_use_id: block.id, content });
      }

      if (!results.length) break;
      convo.push({ role: "user", content: results });
    }
  } catch (err) {
    // The model being unreachable must not look like a normal reply.
    console.error("[receptionist] model call failed:", err instanceof Error ? err.message : err);
    return {
      reply: "عذراً، في مشكلة تقنية مؤقتة. حدا من الفريق رح يتواصل معك.",
      bookings,
      trace,
      failed: true,
      handoff: { why: "تعذّر الوصول للنموذج" },
    };
  }

  return {
    reply: reply || "لحظة من فضلك — حدا من الفريق رح يرد عليك.",
    handoff,
    bookings,
    customerName,
    trace,
  };
}
