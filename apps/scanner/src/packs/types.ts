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
  options: OnboardingOption[];
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

/* ------------------------------------------------------------------ scanner */

export type ScanResult = {
  detected: boolean;
  notDetectedReason?: string;
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
  /** How this reads on the user's specific car, from their onboarding answers. */
  carContext?: string;
  cost?: { min: number; max: number; currency: string; note: string } | null;
  /** Anything else lit/visible in the same photo, most severe first. */
  alsoDetected?: { title: string; severity: Severity }[];
};

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
  paywall: { headline: Text; bullets: Text[] };
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
  paywall: { headline: Text; bullets: Text[] };
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
  /** The on-device writer stopped before the lecture did, so the transcript
   *  it produced is truncated however complete it looks. Forces the accurate
   *  pass rather than summarising the first minutes as the whole hour. */
  liveWriterFailed?: boolean;
  status: "recording" | "processing" | "ready" | "failed";
  error?: string;
};

export type LectureTask = {
  text: string;
  /** The due date exactly as the lecturer said it, not a parsed one. */
  due?: string;
  /** The same date resolved against the lecture's own date, ISO 8601, when
   *  the lecturer was specific enough to resolve it. Drives the calendar
   *  export and the reminders; absent means "don't guess". */
  dueISO?: string;
  difficulty?: "easy" | "medium" | "hard";
};

export type LectureAnalysis = {
  summary: string;
  keyPoints: string[];
  /** Homework, deadlines and anything the lecturer told students to do. */
  tasks: LectureTask[];
  /** What the lecturer emphasised — the app's whole reason to exist. */
  emphasised: { text: string; atSeconds: number; reason: string }[];
  /** What is likely to appear on the exam, and why. */
  examPredictions: { topic: string; confidence: "high" | "medium" | "low"; why: string }[];
  terms: { term: string; definition: string }[];
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
  paywall: { headline: Text; bullets: Text[] };
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
