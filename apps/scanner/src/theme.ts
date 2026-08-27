import Constants from "expo-constants";
import { GRADE, verdictGrade, type Severity, type VerdictLevel } from "./scanner-ui";
import { pack } from "./packs";
import { t } from "./i18n";
import { ui } from "./i18n/ui";

const accent = (Constants.expoConfig?.extra?.accent as string) || "#F2A33C";

/**
 * The tokens the screens shared across all six apps still read.
 *
 * Values match `src/scanner-ui.ts` so a screen that has been moved onto the
 * design system and one that has not cannot sit next to each other looking
 * like two different products. The scanner screens should prefer scanner-ui
 * directly; this exists for onboarding, the paywall, settings and the
 * programme screens, which serve every archetype.
 */
export const theme = {
  accent,
  bg: "#0C0E13",
  surface: "#182028",
  surfaceAlt: "#1F2831",
  border: "#2A3039",
  text: "#F2F4F8",
  textSoft: "#9AA3B2",
  textFaint: "#69717F",
  critical: GRADE.critical.fg,
  criticalBg: GRADE.critical.bg,
  warning: GRADE.warning.fg,
  warningBg: GRADE.warning.bg,
  info: GRADE.info.fg,
  infoBg: GRADE.info.bg,
  /**
   * Primary actions.
   *
   * In the scanners the accent is amber, which is also the colour of a
   * caution warning — so it may not double as "press this". A driver who
   * mistakes a button for a warning, or a warning for a button, is the
   * failure those apps cannot afford, and a near-white sits outside the
   * severity language entirely. Mahdar has no severity language competing
   * for its gold, so there the accent stays the action.
   */
  action: pack.kind === "audio" ? accent : "#E8EDF2",
  onAction: "#0C0E13",
  radius: 20,
  space: (n: number) => n * 4,
} as const;

/** Hex colour with an alpha channel, for gradients and glows. */
export const withAlpha = (hex: string, alpha: number) => {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
};

/**
 * One severity language.
 *
 * Resolved from `GRADE` rather than restated here, so a colour can never drift
 * between the screens that use this and the screens that use scanner-ui. The
 * label comes from the string table for the same reason it exists at all: a
 * colour on its own is not a signal a colour-blind driver can read.
 */
export const severityStyle = (s: Severity) => ({
  color: GRADE[s].fg,
  bg: GRADE[s].bg,
  line: GRADE[s].line,
  label: t(s === "critical" ? ui.gradeCritical : s === "warning" ? ui.gradeWarning : ui.gradeInfo),
});

/** A verdict and its severity are two views of one judgement, so they share
 *  a resolver and cannot contradict each other on screen. */
export const verdictStyle = (v: VerdictLevel) => {
  const grade = verdictGrade(v);
  return { color: grade.fg, bg: grade.bg, line: grade.line };
};
