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

export type OnboardingStep = {
  key: string;
  question: Text;
  options: Text[];
};

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

export type Pack = ScannerPack | ProgramPack;

export const isScanner = (p: Pack): p is ScannerPack => p.kind === "scanner";
export const isProgram = (p: Pack): p is ProgramPack => p.kind === "program";
