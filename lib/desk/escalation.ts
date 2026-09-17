/**
 * The supervisor: decides what the receptionist is NOT allowed to answer alone.
 *
 * This runs BEFORE the model sees the message, and its verdict is not
 * negotiable by the model. A medical question, a complaint, a refund demand or
 * a discount request reaches a person — an agent that improvises on any of
 * those can cost a clinic a patient or a business a lawsuit.
 *
 * Rules are deterministic keyword matches on normalized text, so a customer
 * cannot get past them by rephrasing politely, and so the same input always
 * produces the same verdict.
 */

import type { Tenant } from "./tenants";

export type EscalationReason =
  | "medical"
  | "legal"
  | "complaint"
  | "refund"
  | "discount"
  | "payment"
  | "human_requested"
  | "emergency"
  | "tenant_topic";

export type Verdict = {
  escalate: boolean;
  reason?: EscalationReason;
  /** The phrase that triggered it — shown to the owner so the rule is auditable. */
  matched?: string;
  /** What the customer is told while a person is fetched. */
  reply?: string;
};

/**
 * Arabic is written with optional diacritics and several spellings of the same
 * letter, so a raw `includes` misses most real messages. Normalizing first is
 * what makes these rules actually fire.
 */
export function normalizeArabic(input: string): string {
  return (input ?? "")
    .replace(/[ً-ْٰـ]/g, "") // harakat + tatweel
    .replace(/[أإآٱ]/g, "ا") // أ إ آ ٱ → ا
    .replace(/ى/g, "ي") // ى → ي
    .replace(/ة/g, "ه") // ة → ه
    .replace(/ؤ/g, "و") // ؤ → و
    .replace(/ئ/g, "ي") // ئ → ي
    .replace(/[؟?!.,،؛:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

type Rule = { reason: EscalationReason; reply: string; triggers: string[] };

// Triggers are stored already-normalized so matching is a plain substring test.
const RULES: Rule[] = [
  {
    reason: "emergency",
    reply: "هاي حالة مستعجلة — عم بحوّلك لحدا من الفريق هلأ. إذا في خطر، اتصل بالإسعاف فوراً.",
    triggers: ["اسعاف", "طوارئ", "حاله طارئه", "نزيف", "اغما", "مستعجل كتير", "emergency", "ambulance"],
  },
  {
    reason: "medical",
    reply: "هاد سؤال طبي، وما بقدر أجاوب عليه أنا. عم بحوّلك للدكتور وبيرد عليك.",
    triggers: [
      "تشخيص", "شو مرضي", "شو علاجي", "دوا", "دواء", "جرعه", "مضاد حيوي",
      "اعراض", "عندي الم", "وجع شديد", "حامل", "حساسيه", "التهاب", "ورم",
      "ضغط الدم", "سكري", "عمليه", "تخدير", "اشعه", "تحليل",
      "diagnosis", "symptom", "prescription", "dosage", "pregnant",
    ],
  },
  {
    reason: "complaint",
    reply: "آسف إنه صار معك هيك — هاد إشي بدو حدا من الفريق. عم بحوّل شكواك هلأ وبيتواصلوا معك.",
    triggers: [
      "شكوي", "بدي اشتكي", "زعلان", "مقصرين", "سيء", "ما عجبني", "تعامل سيء",
      "تاخرتو", "ضيعتو", "غلط معي", "بدي المدير", "complaint", "unacceptable",
    ],
  },
  {
    reason: "refund",
    reply: "موضوع الاسترجاع بدو موافقة من الإدارة — عم بحوّلك لحدا بيقدر يقرر.",
    triggers: ["استرجاع", "ارجعولي", "استرداد", "بدي فلوسي", "رجعولي المصاري", "refund", "money back"],
  },
  {
    reason: "discount",
    reply: "موضوع الأسعار والخصومات بقرره صاحب المحل — عم بحوّلك إله.",
    triggers: ["خصم", "تخفيض", "بسعر اقل", "نزلولي السعر", "غالي كتير", "عرض خاص", "discount", "cheaper"],
  },
  {
    reason: "payment",
    reply: "ما بستقبل أي بيانات دفع هون لحمايتك. الدفع بصير بالمحل مباشرة، وعم بحوّلك لحدا يشرحلك.",
    triggers: [
      "رقم البطاقه", "رقم الفيزا", "بطاقه ائتمان", "حوالي بنكيه", "ايبان", "iban",
      "credit card", "card number", "cvv", "paypal",
    ],
  },
  {
    reason: "legal",
    reply: "هاد موضوع قانوني وما بقدر أتصرف فيه — عم بحوّلك لحدا مسؤول.",
    triggers: ["محامي", "قضيه", "محكمه", "بدي اقاضي", "تعويض", "lawyer", "sue", "legal action"],
  },
  {
    reason: "human_requested",
    reply: "أكيد — عم بحوّلك لحدا من الفريق هلأ.",
    triggers: [
      "بدي احكي مع حدا", "بدي حدا حقيقي", "بدي انسان", "حولني", "وين المدير",
      "بدي صاحب", "مش بوت", "بدي موظف", "human", "real person", "talk to someone",
    ],
  },
];

/**
 * Screen one incoming customer message.
 *
 * The first matching rule wins, and the order above is deliberate: an
 * emergency outranks everything, and a plain request for a human outranks
 * nothing else so it never masks a complaint.
 */
export function screen(message: string, tenant?: Tenant | null): Verdict {
  const text = normalizeArabic(message);
  if (!text) return { escalate: false };

  for (const rule of RULES) {
    for (const trigger of rule.triggers) {
      if (text.includes(trigger)) {
        return { escalate: true, reason: rule.reason, matched: trigger, reply: rule.reply };
      }
    }
  }

  // Subjects this particular owner asked to always handle themselves.
  for (const topic of tenant?.escalation?.topics ?? []) {
    const needle = normalizeArabic(topic);
    if (needle && text.includes(needle)) {
      return {
        escalate: true,
        reason: "tenant_topic",
        matched: topic,
        reply: "هاد الموضوع بحبّ صاحب المحل يرد عليه بنفسه — عم بحوّله إله.",
      };
    }
  }

  return { escalate: false };
}

export const ESCALATION_LABEL: Record<EscalationReason, string> = {
  medical: "سؤال طبي",
  legal: "موضوع قانوني",
  complaint: "شكوى",
  refund: "طلب استرجاع",
  discount: "طلب خصم",
  payment: "بيانات دفع",
  human_requested: "طلب موظف بشري",
  emergency: "حالة طارئة",
  tenant_topic: "موضوع خاص بالمحل",
};
