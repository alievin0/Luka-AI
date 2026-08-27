import type { Text } from "../i18n";

/* Two app archetypes share this engine.
 *
 * A `scanner` pack answers one question from a photo.
 * A `program` pack runs someone through a plan, day after day.
 *
 * Every user-facing string is a `Text` pair (English + Arabic) resolved at
 * render time. English is the default because the apps ship worldwide; Arabic
 * is served to devices that ask for it.
 */

export type Severity = "critical" | "warning" | "info";
export type VerdictLevel = "stop" | "caution" | "ok";
export type Confidence = "high" | "medium" | "low";
export type Locale = "en" | "ar";

/**
 * An onboarding answer.
 *
 * Most answers only ever reach the model as prose, so a plain `Text` is
 * enough and what gets stored is the translated label. When the app has to
 * *branch* on the answer — picking a speech recogniser, say — the label is
 * the wrong thing to store, because it changes with the device language.
 * Those options carry an explicit, stable `value`.
 */
export type OnboardingOption = Text | { label: Text; value: string };

export type OnboardingStep = {
  key: string;
  question: Text;
  /** A short line under the question, when the reason for asking is not
   *  obvious from the question itself. */
  hint?: Text;
  /** Fixed choices. Omitted when the answer cannot be enumerated — there is
   *  no useful list of every car model, so those steps take typed input. */
  options?: OnboardingOption[];
  /** Free text. Optional by definition: an answer nobody can be made to give
   *  is worse as a blocked screen than as a blank. */
  input?: { placeholder: Text; keyboard?: "default" | "number-pad"; maxLength?: number };
};

const hasLabel = (option: OnboardingOption): option is { label: Text; value: string } =>
  "label" in option;

export const optionLabel = (option: OnboardingOption): Text =>
  hasLabel(option) ? option.label : option;

/** What gets written to the profile: the stable value where one is given,
 *  and otherwise the label, which is what every existing pack expects. */
export const optionValue = (option: OnboardingOption, resolve: (text: Text) => string) =>
  hasLabel(option) ? option.value : resolve(option);

/** An entry in a pack's offline reference library. */
export type LibraryEntry = {
  /** Which generated pictogram this entry shows. A dashboard-light app that
   *  shows no dashboard lights asks the driver to match the shape in front of
   *  them against a paragraph of prose. Names index `src/symbols.ts`. */
  glyph?: string;
  id: string;
  title: Text;
  /** Technical name — the same in both languages, so not a pair. */
  subtitle: string;
  severity: Severity;
  summary: Text;
  action: Text;
};

/* ------------------------------------------------------------------ pricing */

export type Product = {
  /** RevenueCat package identifier. */
  id: string;
  label: Text;
  /** Shown before RevenueCat loads, and in dev where it never does. */
  fallbackPrice: string;
  period: Text;
  note?: Text;
  badge?: Text;
  trialDays?: number;
};

export type Pricing = {
  entitlement: string;
  products: Product[];
  /** Pre-selected on the paywall — the one most people should pick. */
  defaultProductId: string;
};

/**
 * One line of the paywall's value list.
 *
 * A bare Text gets the default tick, which is the honest mark for "included".
 * The object form carries a glyph chosen to match what that particular line
 * promises — five identical ticks make five different promises look like one.
 */
export type PaywallBullet =
  | Text
  | {
      text: Text;
      /** A character, for packs that have not been given real icons. */
      glyph?: string;
      /** A Feather icon name — one family, one stroke weight. */
      icon?: string;
      /**
       * A mark drawn by scripts/make-symbols.py, for packs whose design
       * supplies its own artwork. Preferred over `icon` where both exist.
       */
      symbol?: string;
      /** The supporting line under the benefit. */
      detail?: Text;
    };

export const bulletText = (bullet: PaywallBullet): Text =>
  "text" in bullet ? bullet.text : bullet;

export const bulletGlyph = (bullet: PaywallBullet): string =>
  "text" in bullet ? (bullet.glyph ?? "✓") : "✓";

export const bulletIcon = (bullet: PaywallBullet): string | undefined =>
  "text" in bullet ? bullet.icon : undefined;

export const bulletSymbol = (bullet: PaywallBullet): string | undefined =>
  "text" in bullet ? bullet.symbol : undefined;

export const bulletDetail = (bullet: PaywallBullet): Text | undefined =>
  "text" in bullet ? bullet.detail : undefined;

/* ------------------------------------------------------------------ scanner */

/**
 * A scan that produced a reading.
 *
 * Everything here is guaranteed by `RESULT_SCHEMA` in `app/api/scan+api.ts`,
 * which is why none of it is optional. The two that still are — `glyph` and
 * `alsoDetected` — are genuinely absent sometimes: not every light has a
 * pictogram in the set, and most photos show only one lit symbol.
 */
export type ScanReading = {
  detected: true;
  title: string;
  subtitle: string;
  severity: Severity;
  confidence: Confidence;
  verdict: string;
  verdictLevel: VerdictLevel;
  summary: string;
  facts: { label: string; value: string }[];
  causes: string[];
  actions: string[];
  seekHelpIf: string[];
  /** What happens if this is ignored — the consequence that drives urgency. */
  ifIgnored?: string;
  /** Which shipped pictogram matches the light identified, so the result can
   *  show the driver the symbol rather than only describing it. Indexes
   *  `src/symbols.ts`; absent when nothing in the set matches. */
  glyph?: string;
  /** How this reads on the user's specific car, from their onboarding answers. */
  carContext?: string;
  cost?: { min: number; max: number; currency: string; note: string } | null;
  /** Anything else lit/visible in the same photo, most severe first. */
  alsoDetected?: { title: string; severity: Severity }[];
};

/**
 * A photo the model could not read.
 *
 * A separate shape rather than a reading with empty fields: the server strips
 * everything the schema made the model invent about a light nobody identified,
 * so there is nothing here to accidentally render. `reason` is what the driver
 * is told to change about the photo.
 */
export type ScanUnread = {
  detected: false;
  notDetectedReason?: string;
};

/** Discriminated on `detected`, so a screen cannot read a title off a photo
 *  that was never read. */
export type ScanResult = ScanReading | ScanUnread;

export type ScannerPack = {
  kind: "scanner";
  id: string;
  appName: Text;
  tagline: Text;
  accent: string;
  captureHint: Text;
  labels: { facts: Text; causes: Text; actions: Text; seekHelp: Text };
  showCost: boolean;
  disclaimer: Text;
  onboarding: OnboardingStep[];
  library?: LibraryEntry[];
  libraryTitle?: Text;
  paywall: { headline: Text; bullets: PaywallBullet[] };
  pricing: Pricing;
  /** The model answers in the user's language, so the locale goes in. */
  systemPrompt: (ctx: { currency: string; profile: string; locale: Locale }) => string;
};

/* ------------------------------------------------------------------ program */

/** One movement, drill or lesson inside a session. */
export type ProgramItem = {
  id: string;
  name: Text;
  /** Timed items set seconds; rep-based items set reps. One or the other. */
  seconds?: number;
  reps?: number;
  restSeconds: number;
  /** How to do it, step by step. */
  cues: Text[];
  /** What people get wrong — the part that makes an app worth paying for. */
  mistakes?: Text[];
};

export type Session = {
  id: string;
  title: Text;
  subtitle: Text;
  minutes: number;
  level: "beginner" | "intermediate" | "advanced";
  focus: Text;
  items: ProgramItem[];
};

export type ProgramPack = {
  kind: "program";
  id: string;
  appName: Text;
  tagline: Text;
  accent: string;
  /** Vocabulary, so the shared screens read naturally in each app. */
  nouns: { session: Text; item: Text; plan: Text };
  disclaimer: Text;
  onboarding: OnboardingStep[];
  paywall: { headline: Text; bullets: PaywallBullet[] };
  pricing: Pricing;
  plan: { weeks: number; daysPerWeek: number; promise: Text };
  sessions: Session[];
  /** Rotating daily tip on the home screen. */
  tips: Text[];
};

/* ------------------------------------------------------------------- audio */

/** One captured lecture and everything derived from it. */
export type Segment = {
  /** Seconds from the start of the lecture. */
  at: number;
  text: string;
  /** Loudness exactly as the recorder reported it, in dBFS (-160 silent,
   *  0 clipping). Always the raw measurement — the 0–1 emphasis score is
   *  derived at read time by `scoreEnergy`, never stored back over this. */
  energy?: number;
  /** The student pressed "mark this important" while this was being said. */
  marked?: boolean;
  /** Diarisation label from the accurate pass. Lets a student's question be
   *  told apart from the lecturer emphasising something. */
  speaker?: string;
};

/**
 * One closed slice of the recording.
 *
 * A single ninety-minute .m4a carries no index until it is closed, so a crash
 * or a force-quit at minute eighty leaves a file nothing can play — the whole
 * lecture, gone. Rotating the recorder means every slice but the last is
 * already complete on disk, and the cost is the fraction of a second it takes
 * to close one file and open the next.
 */
export type AudioChunk = {
  uri: string;
  /** Seconds from the start of the lecture at which this chunk begins. */
  at: number;
  /** Length of this chunk, in seconds. */
  duration: number;
};

export type Lecture = {
  id: string;
  title: string;
  /** When the lecture was recorded (epoch ms). */
  at: number;
  /** Seconds of recorded audio. */
  duration: number;
  /** The recording, in order. Empty for a pasted transcript. */
  audioChunks?: AudioChunk[];
  /** The transcript in timestamped pieces, so tapping a line seeks the audio. */
  segments: Segment[];
  analysis?: LectureAnalysis;
  /** Indices into analysis.tasks the student has ticked off. */
  done?: number[];
  /** Indices into analysis.tasks the student said were not tasks. Extracted
   *  work is a suggestion until they accept it, so this is how "no" is kept —
   *  without it the same wrong task is offered again on every visit. */
  dismissed?: number[];
  /** Indices the student has explicitly accepted. Absent means "not yet
   *  decided", which is what makes a candidate a candidate. */
  accepted?: number[];
  /** Seconds into the lecture the student last listened to. This is the whole
   *  basis of "continue learning": without it there is nowhere to resume to
   *  and no honest way to draw a progress bar. */
  playhead?: number;
  /** When the lecture was last opened (epoch ms). Distinguishes "analysed and
   *  never looked at" from "read", which is what the review prompt is for. */
  openedAt?: number;
  /** The on-device writer stopped before the lecture did, so the transcript
   *  it produced is truncated however complete it looks. Forces the accurate
   *  pass rather than summarising the first minutes as the whole hour. */
  liveWriterFailed?: boolean;
  status: "recording" | "processing" | "ready" | "failed";
  error?: string;
};

/**
 * Where a piece of AI output came from.
 *
 * This is the product. Anything can summarise a lecture; what makes the
 * summary worth trusting is being able to hear the lecturer say it. Every
 * derived claim carries the second it was said and the words that were said,
 * so a student can go from "solve chapter 4" back to the moment it was set
 * and play it.
 *
 * `quote` is the lecturer's own words, never a paraphrase — a paraphrase
 * presented as a quotation is exactly the trust failure this exists to avoid.
 * Both fields are optional because a model that cannot locate a claim must be
 * able to say so rather than inventing a timestamp.
 */
export type Provenance = {
  /** Seconds into the lecture, on the same timeline as the segments. */
  atSeconds?: number;
  /** Verbatim from the transcript. */
  quote?: string;
};

export type LectureTask = Provenance & {
  text: string;
  /** The due date exactly as the lecturer said it, not a parsed one. */
  due?: string;
  /** The same date resolved against the lecture's own date, ISO 8601, when
   *  the lecturer was specific enough to resolve it. Drives the calendar
   *  export and the reminders; absent means "don't guess". */
  dueISO?: string;
  /** Whether the deadline was stated or worked out. A student planning a week
   *  needs to know which of their deadlines are real. */
  dueIsExplicit?: boolean;
  difficulty?: "easy" | "medium" | "hard";
};

export type LectureAnalysis = {
  /** The lecturer, when they can be identified from the transcript — students
   *  introduce a recording by who gave it far more readily than by its title.
   *  Absent when nobody was named; never guessed. */
  lecturer?: string;
  summary: string;
  keyPoints: string[];
  /** Homework, deadlines and anything the lecturer told students to do. */
  tasks: LectureTask[];
  /** What the lecturer emphasised — the app's whole reason to exist. */
  emphasised: { text: string; atSeconds: number; reason: string }[];
  /** What is likely to appear on the exam, and why.
   *
   *  `basis` separates what the lecturer actually said from what the model
   *  worked out. Presenting an inference as a direct statement is the fastest
   *  way to lose a student's trust, and the one thing this feature cannot
   *  afford to get wrong. */
  examPredictions: (Provenance & {
    topic: string;
    confidence: "high" | "medium" | "low";
    why: string;
    basis?: "stated" | "inferred";
  })[];
  terms: (Provenance & { term: string; definition: string })[];
  /** خريطة المحاضرة — the lecture in chapters, each anchored to a timestamp. */
  chapters: { title: string; atSeconds: number; points: string[] }[];
  /** How much of the transcript the model could actually rely on, 0–100.
   *  Shown to the student so a bad recording reads as a bad recording. */
  confidence: number;
};

export type AudioPack = {
  kind: "audio";
  id: string;
  appName: Text;
  /** Second word of the wordmark, shown beside appName. */
  wordmark: string;
  tagline: Text;
  accent: string;
  badge: Text;
  headline: Text;
  intro: Text;
  primaryAction: Text;
  secondaryAction: Text;
  emptyTitle: Text;
  emptyBody: Text;
  disclaimer: Text;
  onboarding: OnboardingStep[];
  paywall: { headline: Text; bullets: PaywallBullet[] };
  pricing: Pricing;
  /** How many lectures a free user gets before the paywall. */
  freeLectures: number;
  /** The lines carrying the product's voice on the recording and analysing
   *  screens. They live on the pack because they name the app by hand. */
  voice: {
    liveWriterReady: Text;
    micWeak: Text;
    listening: Text;
    analysing: Text;
    /** Cycled underneath `analysing` while the lecture is being processed. */
    analysingSteps: Text[];
    footer: Text;
  };
  systemPrompt: (ctx: { locale: Locale; profile: string }) => string;
};

export type Pack = ScannerPack | ProgramPack | AudioPack;

export const isScanner = (p: Pack): p is ScannerPack => p.kind === "scanner";
export const isProgram = (p: Pack): p is ProgramPack => p.kind === "program";
export const isAudio = (p: Pack): p is AudioPack => p.kind === "audio";
