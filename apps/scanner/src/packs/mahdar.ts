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
    "سجّل المحاضرة.\nودع الذكاء الاصطناعي يذاكر معك.",
  ),
  intro: L(
    "Open Mahdar the moment the lecturer starts: it turns speech into text as it happens, catches the assignments, the dates and the moments they raised their voice, and at the end hands you the summary, the tasks and what to expect on the exam.",
    "افتح مَحضَر ما إن يبدأ المحاضر: يحوّل كلامه إلى نص لحظة بلحظة، ويلتقط الواجبات والتواريخ ولحظات ارتفاع الصوت، وفي نهاية المحاضرة يقدّم لك الملخص والمهام وتوقعات الامتحان.",
  ),
  tagline: L("Your companion in the lecture hall", "رفيقك داخل القاعة"),
  primaryAction: L("Start a new lecture", "بدء محاضرة جديدة"),
  secondaryAction: L("Paste lecture text", "لصق نص محاضرة"),
  emptyTitle: L("The hall is quiet…", "القاعة هادئة..."),
  emptyBody: L(
    "The moment you start a lecture, you'll find it saved here with its summary and tasks.",
    "ما إن تبدأ محاضرة، تجدها محفوظة هنا مع ملخصها ومهامها.",
  ),
  accent: "#D9BE83",
  disclaimer: L(
    "Mahdar summarises what it heard — it can mishear, and it is not a substitute for attending or for the lecturer's own material. Recording a lecture may require permission at your institution.",
    "يلخّص مَحضَر ما سمعه، وقد يخطئ في السماع، وهو ليس بديلاً عن الحضور ولا عن مادة المحاضر. وقد يتطلب تسجيل المحاضرة إذناً من جامعتك.",
  ),
  onboarding: [
    {
      key: "study",
      question: L("What are you studying?", "ماذا تدرس؟"),
      options: [
        L("Engineering or computing", "هندسة أو حاسوب"),
        L("Medicine or health sciences", "طب أو علوم صحية"),
        L("Business or law", "إدارة أو حقوق"),
        L("Humanities or social sciences", "إنسانيات أو علوم اجتماعية"),
        L("Something else", "تخصص آخر"),
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
        { label: L("Both, mixed", "كلتاهما معاً"), value: "mixed" },
      ],
    },
    {
      key: "struggle",
      question: L("What's hardest right now?", "ما أصعب ما تواجهه الآن؟"),
      options: [
        L("I can't write fast enough", "لا ألحق بالكتابة"),
        L("I miss what's important", "يفوتني المهم"),
        L("I forget the assignments", "أنسى الواجبات"),
        L("I don't know what to revise", "لا أعرف ماذا أذاكر"),
      ],
    },
  ],
  paywall: {
    headline: L("Never miss what matters in a lecture", "لا يفوتك المهم بأي محاضرة"),
    bullets: [
      L("Records with the screen locked, in your pocket", "يسجّل والشاشة مقفلة وهو في جيبك"),
      L("Catches the moments the lecturer raised their voice", "يلتقط لحظات ارتفاع صوت المحاضر"),
      L("Assignments and dates pulled out automatically", "استخراج الواجبات والتواريخ تلقائياً"),
      L("What to expect on the exam, and why", "ما المتوقع في الامتحان، ولماذا"),
    ],
  },
  pricing: {
    entitlement: "pro",
    defaultProductId: "annual",
    products: [
      { id: "monthly", label: L("Monthly", "شهري"), fallbackPrice: "$12.99", period: L("month", "شهر"), storeTrialDays: 7 },
      {
        id: "annual",
        label: L("Yearly", "سنوي"),
        fallbackPrice: "$79.99",
        period: L("year", "سنة"),
        note: L("Under $1.54 a week", "أقل من $1.54 أسبوعياً"),
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
      "🎤 الصوت ضعيف — قرّب الجهاز من المحاضر.",
    ),
    listening: L("Listening to the lecturer…", "أستمع إلى المحاضر..."),
    analysing: L("Studying it for you…", "نذاكر عنك الآن..."),
    analysingSteps: [
      L("Reading the transcript…", "نقرأ النص..."),
      L("Analysing the tone of voice…", "نحلل نبرة الصوت..."),
      L("Pulling out the assignments and dates…", "نستخرج الواجبات والتواريخ..."),
      L("Working out what the exam will ask…", "نستنتج ما سيرد في الامتحان..."),
    ],
    footer: L(
      "Mahdar • studies with you, lecture by lecture",
      "مَحضَر • يذاكر معك، محاضرة بمحاضرة",
    ),
  },
  systemPrompt: ({ locale, profile }) => `You are helping a university student study from a lecture they recorded. You are given the transcript, and a list of timestamps where the lecturer's voice rose above their baseline.

Student context: ${profile || "unknown"}

WRITE EVERY USER-FACING STRING IN ${locale === "ar" ? "MODERN STANDARD ARABIC (فصحى) — clear and direct, the register of a well-written textbook. Never colloquial or dialect. Keep technical terms in English where a student would" : "ENGLISH (plain and direct)"}.

What matters, in order:

1. emphasised — THE MOST IMPORTANT FIELD. You are given moments where the lecturer got louder. Lecturers raise their voice on what they care about and on what tends to appear on exams. For each supplied timestamp, find what was being said at that point in the transcript and report it. In "reason", say briefly why it reads as emphasis — a definition, a warning, a repetition, an explicit "this will be on the exam". If a loud moment is clearly not emphasis (a cough, a door, an interruption, a student shouting), leave it out rather than inventing significance.

2. examPredictions — what is likely to be examined, each with a confidence and a concrete "why" grounded in the transcript. An explicit statement from the lecturer is high confidence; heavy time spent on a topic is medium; a passing mention is low. Never present a guess as a certainty, and if the lecturer never signalled anything, return few predictions rather than padding.

3. tasks — homework, readings, deadlines, anything the students were told to do. Include the due date exactly as stated, and set "dueIsExplicit" to true only when the lecturer gave the date themselves rather than you working it out.

4. summary — what the lecture was actually about, in a few sentences a student could read the night before an exam.

5. keyPoints — the substance, in the order it was taught.

6. terms — technical terms introduced, with the definition as the lecturer gave it, not a textbook one.

PROVENANCE — this is what the product is for.

A summary of a lecture is worth little on its own; anything can produce one. What makes it worth trusting is that the student can go back and hear the lecturer say it. So for every task, every exam prediction and every term:

- "atSeconds": the second in the lecture where it was said. Each transcript line is stamped [mm:ss] — convert that to seconds. Use the line where the thing was actually said, not where the topic was introduced.
- "quote": the lecturer's own words from that line, VERBATIM. Copy the transcript text. Never paraphrase into the quote field, never tidy the grammar, never merge two sentences from different places. A paraphrase in a quotation is a lie to the student and it is the one thing that would make this feature worse than useless.

If you cannot locate where something was said, leave BOTH fields out. An item with no timestamp is honest; an item with a guessed timestamp sends a student to the wrong part of a ninety-minute recording and teaches them not to trust any of it.

For exam predictions also set "basis":
- "stated" — the lecturer explicitly connected this to the exam. The quote must contain that statement.
- "inferred" — you concluded it from emphasis, repetition or time spent. Do not let a "why" for an inferred prediction read as though the lecturer said it.

Rules:
- Transcription is imperfect. Where a passage is garbled, say so rather than guessing at meaning.
- Never add material that was not in the lecture.
- Attribute nothing to the lecturer that they did not say.`,
};
