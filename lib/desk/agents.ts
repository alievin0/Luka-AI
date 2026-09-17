/**
 * The agent roster.
 *
 * One entry per function that actually exists in this architecture — not one
 * per shape that would look good in a visualization. `lifecycle: "live"` means
 * there is code in this repository doing the work; `"planned"` means the
 * function is designed and not written, and every surface must say so.
 *
 * The world visualization reads this roster. It is the reason the world can be
 * a mirror of the system rather than a separate animation.
 */

import type { Agent, AgentZone, AgentLifecycle } from "./db/types";

export type AgentDefinition = {
  code: string;
  name: string;
  role: string;
  zone: AgentZone;
  lifecycle: AgentLifecycle;
  /** The file that implements it, or null when it is not built. */
  implementation: string | null;
  capabilities: string[];
  tools: string[];
  permissions: string[];
};

export const AGENT_ROSTER: AgentDefinition[] = [
  {
    code: "reception",
    name: "وكيل الاستقبال",
    role: "يستقبل العميل ويرد عليه",
    zone: "reception",
    lifecycle: "live",
    implementation: "lib/desk/receptionist.ts",
    capabilities: [
      "الرد على أسئلة النشاط التجاري",
      "قراءة قائمة الخدمات والأسعار",
      "فحص الأوقات المتاحة",
      "إنشاء حجز",
      "تحويل الطلبات الحساسة",
    ],
    tools: ["get_business_info", "get_services", "get_availability", "create_booking"],
    permissions: ["قراءة الخدمات", "قراءة التوفر", "إنشاء حجز", "تحويل للإنسان"],
  },
  {
    code: "policy",
    name: "بوابة السياسات",
    role: "يفحص كل رسالة قبل النموذج",
    zone: "escalation",
    lifecycle: "live",
    implementation: "lib/desk/escalation.ts",
    capabilities: [
      "فحص كل رسالة واردة قبل وصولها للنموذج",
      "إيقاف الطلبات الطبية والقانونية",
      "إيقاف الشكاوى وطلبات الاسترجاع والخصم",
      "رفض استقبال بيانات الدفع",
    ],
    tools: [],
    permissions: ["قراءة الرسالة", "منع الرد", "إنشاء تصعيد"],
  },
  {
    code: "booking",
    name: "وكيل الحجوزات",
    role: "مصدر الحقيقة للتوفر",
    zone: "booking",
    lifecycle: "live",
    implementation: "lib/desk/bookings.ts",
    capabilities: [
      "حساب الأوقات المتاحة فعلياً",
      "رفض الماضي وخارج الدوام والمحجوز",
      "احترام أوقات الإغلاق والعطل",
      "تثبيت الحجز بقاعدة البيانات",
    ],
    tools: ["database"],
    permissions: ["قراءة الحجوزات", "إنشاء حجز", "إلغاء حجز"],
  },
  {
    code: "knowledge",
    name: "وكيل المعرفة",
    role: "يزوّد الحقائق المسموح قولها",
    zone: "knowledge",
    lifecycle: "live",
    implementation: "lib/desk/db/repo.ts",
    capabilities: [
      "تزويد بيانات النشاط والخدمات والأسعار",
      "تزويد أوقات الدوام والسياسات",
      "إرجاع «غير معروف» بدل التخمين",
    ],
    tools: ["database"],
    permissions: ["قراءة بيانات النشاط"],
  },
  {
    code: "channel-whatsapp",
    name: "قناة واتساب",
    role: "يستقبل ويرسل عبر واتساب",
    zone: "tools",
    lifecycle: "live",
    implementation: "lib/desk/whatsapp.ts",
    capabilities: [
      "التحقق من توقيع ميتا قبل التصرف",
      "تحويل رسائل واتساب لصيغة موحّدة",
      "إرسال الرد للعميل",
      "تجاهل التسليم المكرر",
    ],
    tools: ["whatsapp_cloud_api"],
    permissions: ["استقبال رسائل", "إرسال رسائل"],
  },
  {
    code: "handoff",
    name: "التحويل البشري",
    role: "يوصل الحالة لصاحب العمل",
    zone: "business",
    lifecycle: "live",
    implementation: "lib/desk/pipeline.ts",
    capabilities: [
      "تسجيل التصعيد بقاعدة البيانات",
      "تنبيه صاحب العمل بالسبب والمحادثة",
      "تعليم المحادثة «بانتظار إنسان»",
    ],
    tools: ["whatsapp_cloud_api", "database"],
    permissions: ["إنشاء تصعيد", "إرسال تنبيه"],
  },
  {
    code: "channel-instagram",
    name: "قناة إنستغرام",
    role: "نفس النواة، قناة ثانية",
    zone: "tools",
    lifecycle: "planned",
    implementation: null,
    capabilities: ["تحويل رسائل إنستغرام لنفس الصيغة الموحّدة"],
    tools: ["instagram_messaging_api"],
    permissions: [],
  },
  {
    code: "voice",
    name: "الوكيل الصوتي",
    role: "يرد على المكالمات",
    zone: "reception",
    lifecycle: "planned",
    implementation: null,
    capabilities: [
      "تحويل الكلام لنص",
      "استعمال نفس بوابة السياسات ونفس محرك الحجز",
      "تحويل الرد لصوت",
    ],
    tools: ["telephony_provider", "speech_to_text", "text_to_speech"],
    permissions: [],
  },
  {
    code: "supervisor",
    name: "وكيل المراقبة",
    role: "يراقب صحة النظام",
    zone: "supervision",
    lifecycle: "planned",
    implementation: null,
    capabilities: ["رصد المهام الفاشلة", "رصد التصعيدات غير المحلولة", "تقرير صحة النظام"],
    tools: ["database"],
    permissions: [],
  },
];

export const AGENTS_BY_CODE: Record<string, AgentDefinition> = Object.fromEntries(
  AGENT_ROSTER.map((a) => [a.code, a]),
);

/** A fresh roster snapshot, all idle — the starting state for a business. */
export function seedAgents(): Agent[] {
  const now = new Date().toISOString();
  return AGENT_ROSTER.map((d) => ({
    code: d.code,
    name: d.name,
    role: d.role,
    zone: d.zone,
    // A planned agent is offline because it does not exist, not because it
    // crashed. The distinction has to survive into the UI.
    state: d.lifecycle === "live" ? "idle" : "offline",
    lifecycle: d.lifecycle,
    capabilities: d.capabilities,
    tools: d.tools,
    permissions: d.permissions,
    updatedAt: now,
  }));
}

export const ZONE_LABELS: Record<AgentZone, string> = {
  reception: "الاستقبال",
  booking: "الحجوزات",
  knowledge: "المعرفة",
  tools: "الأدوات والقنوات",
  escalation: "التصعيد",
  supervision: "المراقبة",
  workshop: "ورشة الوكلاء",
  business: "صاحب العمل",
};

export const STATE_LABELS: Record<Agent["state"], string> = {
  idle: "جاهز",
  working: "شغّال",
  processing: "عم يعالج",
  waiting: "بينتظر",
  using_tool: "بيستعمل أداة",
  escalated: "حوّل للإنسان",
  error: "خطأ",
  offline: "غير مبني",
  deploying: "قيد النشر",
};
