/** Shared result shape every scanner pack returns. */
export type Severity = "critical" | "warning" | "info";
export type VerdictLevel = "stop" | "caution" | "ok";
export type Confidence = "high" | "medium" | "low";

export type ScanResult = {
  /** false when the photo doesn't contain what this pack scans for. */
  detected: boolean;
  /** Arabic, only when detected is false — tells the user how to retake. */
  notDetectedReason?: string;
  /** Arabic name of the thing identified. */
  title: string;
  /** English or scientific name — helps the user search further. */
  subtitle: string;
  severity: Severity;
  confidence: Confidence;
  /** Short Arabic headline answering the user's real question. */
  verdict: string;
  verdictLevel: VerdictLevel;
  /** Arabic, 1–2 sentences explaining what this is. */
  summary: string;
  /** Quick key/value facts shown as a grid. */
  facts: { label: string; value: string }[];
  /** Arabic — likely causes (dashlight) or expected symptoms (bugscan). */
  causes: string[];
  /** Arabic — concrete steps to take right now. */
  actions: string[];
  /** Arabic — when to escalate to a professional. */
  seekHelpIf: string[];
  /** Estimated cost range, only for packs where money is the question. */
  cost?: { min: number; max: number; currency: string; note: string } | null;
};

export type OnboardingStep = {
  key: string;
  question: string;
  options: string[];
};

export type ScannerPack = {
  id: string;
  appName: string;
  tagline: string;
  accent: string;
  /** Viewfinder instruction. */
  captureHint: string;
  /** Section headings — they differ per pack. */
  labels: { facts: string; causes: string; actions: string; seekHelp: string };
  /** Does this pack show a cost block? */
  showCost: boolean;
  /** Permanent disclaimer pinned under every result. */
  disclaimer: string;
  onboarding: OnboardingStep[];
  paywall: { headline: string; bullets: string[] };
  /** System prompt for the vision call. */
  systemPrompt: (ctx: { currency: string; profile: string }) => string;
};
