/* Two app archetypes share this engine.
 *
 * A `scanner` pack answers one question from a photo.
 * A `program` pack runs someone through a plan, day after day.
 *
 * Everything else — onboarding, paywall, pricing, settings, storage, theme —
 * is shared, so a new app in either shape is a content file, not a project.
 */

export type Severity = "critical" | "warning" | "info";
export type VerdictLevel = "stop" | "caution" | "ok";
export type Confidence = "high" | "medium" | "low";

export type OnboardingStep = {
  key: string;
  question: string;
  options: string[];
};

/** An entry in a pack's offline reference library. */
export type LibraryEntry = {
  id: string;
  title: string;
  subtitle: string;
  severity: Severity;
  summary: string;
  action: string;
};

/* ------------------------------------------------------------------ pricing */

export type Product = {
  /** RevenueCat package identifier. */
  id: string;
  label: string;
  /** Shown before RevenueCat loads, and in dev where it never does. */
  fallbackPrice: string;
  period: string;
  /** Small line under the price, e.g. per-week equivalent. */
  note?: string;
  badge?: string;
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
  cost?: { min: number; max: number; currency: string; note: string } | null;
  /** Anything else lit/visible in the same photo, most severe first. */
  alsoDetected?: { title: string; severity: Severity }[];
};

export type ScannerPack = {
  kind: "scanner";
  id: string;
  appName: string;
  tagline: string;
  accent: string;
  captureHint: string;
  labels: { facts: string; causes: string; actions: string; seekHelp: string };
  showCost: boolean;
  disclaimer: string;
  onboarding: OnboardingStep[];
  library?: LibraryEntry[];
  libraryTitle?: string;
  paywall: { headline: string; bullets: string[] };
  pricing: Pricing;
  systemPrompt: (ctx: { currency: string; profile: string }) => string;
};

/* ------------------------------------------------------------------ program */

/** One movement, drill or lesson inside a session. */
export type ProgramItem = {
  id: string;
  name: string;
  nameEn: string;
  /** Timed items set seconds; rep-based items set reps. One or the other. */
  seconds?: number;
  reps?: number;
  restSeconds: number;
  /** How to do it, step by step. */
  cues: string[];
  /** What people get wrong — the part that makes an app worth paying for. */
  mistakes?: string[];
};

export type Session = {
  id: string;
  title: string;
  subtitle: string;
  minutes: number;
  level: "beginner" | "intermediate" | "advanced";
  focus: string;
  items: ProgramItem[];
};

export type ProgramPack = {
  kind: "program";
  id: string;
  appName: string;
  tagline: string;
  accent: string;
  /** Vocabulary, so the shared screens read naturally in each app. */
  nouns: {
    session: string;
    item: string;
    plan: string;
    streakUnit: string;
  };
  disclaimer: string;
  onboarding: OnboardingStep[];
  paywall: { headline: string; bullets: string[] };
  pricing: Pricing;
  plan: { weeks: number; daysPerWeek: number; promise: string };
  sessions: Session[];
  /** Rotating daily tip on the home screen. */
  tips: string[];
};

export type Pack = ScannerPack | ProgramPack;

export const isScanner = (p: Pack): p is ScannerPack => p.kind === "scanner";
export const isProgram = (p: Pack): p is ProgramPack => p.kind === "program";
