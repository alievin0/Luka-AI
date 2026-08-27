import { L } from "../i18n";
import type { AudioPack } from "./types";

/* مَحضَر — copy and structure taken verbatim from the existing web product.
 * The wording is the founder's and is not paraphrased here: it already tested
 * well, and the emphasis feature it promises ("لحظات رفع الصوت") is the thing
 * no competitor offers.
 */

export const mahdar: AudioPack = {
  kind: "audio",
  id: "mahdar",
  appName: L("Mahdar", "مَحضَر"),
  wordmark: "MAHDAR",
  badge: L("Your companion in the lecture hall", "رفيقك داخل القاعة"),
  headline: L(
    "Record the lecture.\nLet AI study with you.",
    "سجّل المحاضرة.\nوخل الذكاء يذاكر معك.",
  ),
  intro: L(
    "Open Mahdar the moment the lecturer starts: it turns speech into text as it happens, catches the assignments, the dates and the moments they raised their voice, and at the end hands you the summary, the tasks and what to expect on the exam.",
    "افتح مَحضَر أول ما يبدأ الدكتور: يحوّل كلامه إلى نص لحظة بلحظة، يلتقط الواجبات والتواريخ ولحظات رفع الصوت، وبنهاية المحاضرة يعطيك الملخص والمهام وتوقعات الامتحان.",
  ),
  tagline: L("Your companion in the lecture hall", "رفيقك داخل القاعة"),
  primaryAction: L("Start a new lecture", "بدء محاضرة جديدة"),
  secondaryAction: L("Paste lecture text", "لصق نص محاضرة"),
  emptyTitle: L("The hall is quiet…", "القاعة هادئة..."),
  emptyBody: L(
    "The moment you start a lecture, you'll find it saved here with its summary and tasks.",
    "أول ما تبدأ محاضرة، بتلاقيها محفوظة هني مع ملخصها ومهامها.",
  ),
  accent: "#D9BE83",
  disclaimer: L(
    "Mahdar summarises what it heard — it can mishear, and it is not a substitute for attending or for the lecturer's own material. Recording a lecture may require permission at your institution.",
    "مَحضَر بيلخّص اللي سمعه — وممكن يسمع غلط، وهو مش بديل عن الحضور ولا عن مادة الدكتور. وتسجيل المحاضرة ممكن يحتاج إذن من جامعتك.",
  ),
  onboarding: [
    {
      key: "study",
      question: L("What are you studying?", "شو بتدرس؟"),
      options: [
        L("Engineering or computing", "هندسة أو حاسوب"),
        L("Medicine or health sciences", "طب أو علوم صحية"),
        L("Business or law", "إدارة أو حقوق"),
        L("Humanities or social sciences", "إنسانيات أو علوم اجتماعية"),
        L("Something else", "شي تاني"),
      ],
    },
    {
      key: "lectureLanguage",
      question: L("What language are your lectures in?", "بأي لغة محاضراتك؟"),
      // These carry explicit values: the live recogniser is chosen from this
      // answer, and a translated label would pick the wrong one.
      options: [
        { label: L("Arabic", "عربي"), value: "ar" },
        { label: L("English", "إنجليزي"), value: "en" },
        { label: L("Both, mixed", "الاتنين مخلوطين"), value: "mixed" },
      ],
    },
    {
      key: "struggle",
      question: L("What's hardest right now?", "شو أصعب شي عليك هلق؟"),
      options: [
        L("I can't write fast enough", "ما بلحق أكتب"),
        L("I miss what's important", "بيفوتني المهم"),
        L("I forget the assignments", "بنسى الواجبات"),
        L("I don't know what to revise", "ما بعرف شو أذاكر"),
      ],
    },
  ],
  paywall: {
    headline: L("Never miss what matters in a lecture", "لا يفوتك المهم بأي محاضرة"),
    bullets: [
      L("Records with the screen locked, in your pocket", "بيسجّل والشاشة مقفلة وبجيبك"),
      L("Catches the moments the lecturer raised their voice", "بيلتقط لحظات رفع صوت الدكتور"),
      L("Assignments and dates pulled out automatically", "الواجبات والتواريخ بتنسحب لحالها"),
      L("What to expect on the exam, and why", "شو متوقع بالامتحان، وليش"),
    ],
  },
  pricing: {
    entitlement: "pro",
    defaultProductId: "annual",
    products: [
      { id: "monthly", label: L("Monthly", "شهري"), fallbackPrice: "$12.99", period: L("month", "شهر"), trialDays: 7 },
      {
        id: "annual",
        label: L("Yearly", "سنوي"),
        fallbackPrice: "$79.99",
        period: L("year", "سنة"),
        note: L("Under $1.54 a week", "أقل من $1.54 بالأسبوع"),
        badge: L("Best value", "الأوفر"),
      },
    ],
  },
  freeLectures: 1,
  voice: {
    liveWriterReady: L(
      "✍️ Live writer ready — it checks each passage the moment it finishes",
      "✍️ الكاتب المباشر جاهز — يدقّق كل مقطع أول ما يكتمل",
    ),
    micWeak: L(
      "🎤 The audio is coming in weak — move closer to the lecturer.",
      "🎤 الصوت واصل ضعيف — قرّب الجهاز من الدكتور.",
    ),
    listening: L("Listening to the lecturer…", "أسمع الدكتور..."),
    analysing: L("Studying it for you…", "قاعد نذاكر عنك..."),
    analysingSteps: [
      L("Reading the transcript…", "نقرأ النص..."),
      L("Analysing the tone of voice…", "نحلل نبرة الصوت..."),
      L("Pulling out the assignments and dates…", "نطلع الواجبات والتواريخ..."),
      L("Working out what the exam will ask…", "نشوف شو رح يجي بالامتحان..."),
    ],
    footer: L(
      "Mahdar • studies with you, lecture by lecture",
      "مَحضَر • يذاكر معك، محاضرة بمحاضرة",
    ),
  },
  systemPrompt: ({ locale, profile }) => `You are helping a university student study from a lecture they recorded. You are given the transcript, and a list of timestamps where the lecturer's voice rose above their baseline.

Student context: ${profile || "unknown"}

WRITE EVERY USER-FACING STRING IN ${locale === "ar" ? "ARABIC (simple, natural student Arabic — keep technical terms in English where a student would)" : "ENGLISH (plain and direct)"}.

What matters, in order:

1. emphasised — THE MOST IMPORTANT FIELD. You are given moments where the lecturer got louder. Lecturers raise their voice on what they care about and on what tends to appear on exams. For each supplied timestamp, find what was being said at that point in the transcript and report it. In "reason", say briefly why it reads as emphasis — a definition, a warning, a repetition, an explicit "this will be on the exam". If a loud moment is clearly not emphasis (a cough, a door, an interruption, a student shouting), leave it out rather than inventing significance.

2. examPredictions — what is likely to be examined, each with a confidence and a concrete "why" grounded in the transcript. An explicit statement from the lecturer is high confidence; heavy time spent on a topic is medium; a passing mention is low. Never present a guess as a certainty, and if the lecturer never signalled anything, return few predictions rather than padding.

3. tasks — homework, readings, deadlines, anything the students were told to do. Include the due date exactly as stated. Do not invent deadlines that were not said.

4. summary — what the lecture was actually about, in a few sentences a student could read the night before an exam.

5. keyPoints — the substance, in the order it was taught.

6. terms — technical terms introduced, with the definition as the lecturer gave it, not a textbook one.

Rules:
- Transcription is imperfect. Where a passage is garbled, say so rather than guessing at meaning.
- Never add material that was not in the lecture.
- Attribute nothing to the lecturer that they did not say.`,
};
