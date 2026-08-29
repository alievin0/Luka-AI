import type { Locale, Text } from "./index";

/**
 * The errors the API routes send back.
 *
 * A route has no device to ask which language the reader wants, and the first
 * version of these guessed: every one of them answered in Arabic, to everyone,
 * including the English speakers the rest of the app is written for. So the
 * whole `Text` pair now travels over the wire and the device resolves it, the
 * same way every other string in these apps is resolved.
 *
 * Nothing here is imported at runtime — `Text` is a type, erased at compile
 * time. That is deliberate: this module is loaded inside the server bundle,
 * where the locale module's device lookups have nothing to answer with.
 */
const L = (en: string, ar: string): Text => ({ en, ar });

/**
 * The verdict the app writes when it overrules the model's.
 *
 * `clampForSafety` raises the level of a result that contradicts itself, and
 * the model's own sentence cannot come along: it was written for the level it
 * has just lost. These replace it. They are deliberately shorter and blunter
 * than anything the model produces — the app is overruling a judgement here,
 * not paraphrasing one, and it knows less than the model did about the light.
 *
 * Indexed by the request's locale rather than resolved through `t()`, which
 * reads a module-level locale fixed at startup and on a server is nobody's.
 */
export const clampedVerdict: Record<"stop" | "caution", Record<Locale, string>> = {
  stop: {
    en: "Stop driving now",
    ar: "أوقف القيادة الآن",
    es: "Deje de conducir ahora",
    pt: "Pare de dirigir agora",
    fr: "Arrêtez-vous immédiatement",
    de: "Fahren Sie sofort nicht weiter",
    tr: "Şimdi sürmeyi bırakın",
    it: "Fermati subito",
  },
  caution: {
    en: "Not certain — treat it with caution",
    ar: "النتيجة غير مؤكدة — تعامل معها بحذر",
    es: "No es seguro: tómelo con precaución",
    pt: "Não é certo — trate com cautela",
    fr: "Incertain — soyez prudent",
    de: "Nicht sicher — mit Vorsicht behandeln",
    tr: "Kesin değil — dikkatli olun",
    it: "Non è certo — trattalo con prudenza",
  },
};

export const apiError = {
  // Rate limits. Worded per surface, because what there was too much of is
  // the only part of the sentence the reader can act on.
  tooManyScans: L(
    "Too many scans in a short time. Try again shortly.",
    "عدد الفحوصات كبير في وقت قصير. حاول بعد قليل.",
  ),
  tooManyLectures: L(
    "Too many analyses in a short time. Try again shortly.",
    "عدد التحليلات كبير في وقت قصير. حاول بعد قليل.",
  ),
  tooManyUploads: L(
    "Too many requests in a short time. Try again shortly.",
    "عدد الطلبات كبير في وقت قصير. حاول بعد قليل.",
  ),
  tooManyQuestions: L(
    "Too many questions in a short time. Try again shortly.",
    "عدد الأسئلة كبير في وقت قصير. حاول بعد قليل.",
  ),

  // Server configuration. These name no vendor and no environment variable:
  // they are read by a user who can do nothing about either. The variable a
  // deployer actually has to set is named in the route that checks it.
  notConfigured: L(
    "This service isn't set up on the server yet.",
    "هذه الخدمة غير مهيّأة على الخادم.",
  ),
  badKey: L(
    "The server's access key isn't valid.",
    "مفتاح الوصول على الخادم غير صالح.",
  ),
  transcriptionOff: L(
    "Accurate transcription isn't enabled on the server.",
    "التفريغ الدقيق غير مفعّل على الخادم.",
  ),
  transcriptionBadKey: L(
    "The transcription key isn't valid.",
    "مفتاح خدمة التفريغ غير صالح.",
  ),

  // What the request was missing.
  unknownScanType: L("That scan type isn't recognised.", "نوع الفحص غير معروف."),
  unknownPack: L("That app isn't recognised.", "نوع التطبيق غير معروف."),
  noImage: L("No image received.", "لم تصلنا صورة."),
  imageTooLarge: L("That image is too large.", "الصورة كبيرة جداً."),
  noLectureText: L("There's no lecture text to analyse.", "لا يوجد نص محاضرة لتحليله."),
  lectureTooLong: L(
    "That lecture is too long to analyse in one pass. Try splitting it.",
    "المحاضرة أطول من أن تُحلَّل دفعة واحدة. حاول تقسيمها.",
  ),
  noRecording: L("No recording received.", "لم يصلنا تسجيل."),
  recordingTooLong: L("That recording is too long.", "التسجيل طويل جداً."),
  noQuestion: L("No question received.", "لم يصلنا سؤال."),

  // What the model could not do.
  cannotRead: L(
    "We couldn't read that image. Try another photo.",
    "تعذّرت قراءة هذه الصورة. جرّب صورة أخرى.",
  ),
  cannotAnalyseLecture: L("We couldn't analyse that lecture.", "تعذّر تحليل هذه المحاضرة."),
  cannotAnswer: L("We couldn't answer that question.", "تعذّرت الإجابة عن هذا السؤال."),
  badResponse: L("The reply came back unreadable. Try again.", "وصل رد غير صالح. حاول مرة أخرى."),
  busy: L(
    "The service is busy right now. Try again shortly.",
    "الخدمة مزدحمة الآن. حاول بعد قليل.",
  ),

  // Transcription, which is a different service and fails on its own terms.
  noSpeech: L(
    "We couldn't hear any speech in the recording.",
    "لم نسمع أي كلام في التسجيل.",
  ),
  transcriptionUnreachable: L(
    "We couldn't reach the transcription service.",
    "تعذّر الوصول إلى خدمة التفريغ.",
  ),
  transcriptionBusy: L(
    "The transcription service is busy. Try again shortly.",
    "خدمة التفريغ مزدحمة. حاول بعد قليل.",
  ),
  transcriptionFailed: L(
    "We couldn't transcribe the recording. Try again.",
    "تعذّر تفريغ التسجيل. حاول مرة أخرى.",
  ),
  transcriptionBadResponse: L(
    "The transcription service returned an unreadable reply.",
    "وصل رد غير صالح من خدمة التفريغ.",
  ),

  // Last resort, when the failure has no better name than its surface.
  analysisFailed: L(
    "Something went wrong during analysis. Try again.",
    "حدث خطأ في أثناء التحليل. حاول مرة أخرى.",
  ),
  failed: L("Something went wrong. Try again.", "حدث خطأ. حاول مرة أخرى."),
  unexpected: L(
    "Something unexpected went wrong. Try again.",
    "حدث خطأ غير متوقع. حاول مرة أخرى.",
  ),
};
