import { Platform } from "react-native";
import { isRTL } from "./i18n";

/**
 * Dash Light Scanner's design system.
 *
 * Built to one brief: a driver has stopped on the hard shoulder at night, is
 * holding the phone in one hand, and wants a single answer before anything
 * else — can I keep driving, or do I stop? Every decision below serves that
 * moment. The type scale is large because the screen is read at arm's length
 * by someone whose hands are not steady; the spacing is generous because a
 * cramped safety screen reads as a cheap one.
 *
 * The one rule that outranks everything: colour here is a language, not
 * decoration.
 */

/* ---- ground ------------------------------------------------------------ */

export const BG = "#0C0E13";
export const SURFACE = "#141B20";
export const SURFACE_HIGH = "#1B2229";
export const BORDER = "#2A3039";
export const TEXT = "#F2F4F8";
export const TEXT_SOFT = "#9AA3B2";
export const TEXT_FAINT = "#69717F";

/**
 * The brand accent.
 *
 * Amber, which is also the colour of a caution warning — so it may never be
 * used for a primary action. A driver who mistakes a button for a warning, or
 * a warning for a button, is exactly the failure this app cannot afford. The
 * accent marks brand and selection only; actions get ACTION below.
 */
export const ACCENT = "#F2A33C";

/** Primary actions. Deliberately outside the severity language — a blue-white
 *  that means "press this" and cannot be read as a warning of any grade. */
export const ACTION = "#E8EDF2";
export const ACTION_TEXT = "#0C0E13";

/* ---- the severity language --------------------------------------------- */

export type Severity = "critical" | "warning" | "info";
export type VerdictLevel = "stop" | "caution" | "ok";

/**
 * Red stops you, amber slows you, green lets you go.
 *
 * Each grade carries a colour AND a word, because colour alone is not a
 * signal a colour-blind driver can read, and this is the one screen where
 * being misread has a physical consequence.
 */
export const GRADE = {
  critical: { fg: "#FF5A5F", bg: "#2A1417", line: "#5A2126", glyph: "!" },
  warning: { fg: "#F2A33C", bg: "#2A1F11", line: "#4E3818", glyph: "▲" },
  info: { fg: "#3DD68C", bg: "#0F2419", line: "#1D4430", glyph: "✓" },
} as const;

export const gradeOf = (severity: Severity) => GRADE[severity];

/** A verdict and its severity must always agree; both resolve here so they
 *  cannot drift apart in one screen's markup. */
export const verdictGrade = (level: VerdictLevel) =>
  level === "stop" ? GRADE.critical : level === "caution" ? GRADE.warning : GRADE.info;

/* ---- type -------------------------------------------------------------- */

/**
 * Inter for Latin, Cairo for Arabic.
 *
 * Two faces rather than one because no single family draws both scripts this
 * well at this size, and legibility beats tidiness on a screen someone reads
 * while frightened. They are matched on x-height and weight so a bilingual
 * screen still holds together.
 */
export const FONT = {
  bold: isRTL ? "Cairo_700Bold" : "Inter_700Bold",
  semibold: isRTL ? "Cairo_600SemiBold" : "Inter_600SemiBold",
  medium: isRTL ? "Cairo_500Medium" : "Inter_500Medium",
  regular: isRTL ? "Cairo_400Regular" : "Inter_400Regular",
  /** Latin always, for the English subtitle under an Arabic title and for
   *  anything that is a proper name in the manual. */
  latin: "Inter_400Regular",
  latinMedium: "Inter_500Medium",
} as const;

/**
 * The scale from the style guide, in size/leading pairs.
 *
 * Arabic needs more leading than Latin at the same size for its ascenders and
 * diacritics; applying one number to both is what makes a bilingual app look
 * broken in one of its languages.
 */
const lead = (px: number, multiple: number) => Math.round(px * (isRTL ? multiple + 0.18 : multiple));

export const TYPE = {
  /** The verdict. Nothing else on the screen is allowed to be this big. */
  verdict: { fontSize: 34, lineHeight: lead(34, 1.29) },
  title: { fontSize: 24, lineHeight: lead(24, 1.33) },
  section: { fontSize: 18, lineHeight: lead(18, 1.33) },
  body: { fontSize: 16, lineHeight: lead(16, 1.5) },
  caption: { fontSize: 14, lineHeight: lead(14, 1.43) },
  small: { fontSize: 12, lineHeight: lead(12, 1.33) },
} as const;

/* ---- rhythm ------------------------------------------------------------ */

/** A 4pt grid, used everywhere so vertical rhythm is decided once. */
export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, section: 48 } as const;

export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

/** The smallest a tappable thing may be. One hand, in the dark, rattled. */
export const TAP = 44;

/* ---- direction --------------------------------------------------------- */

/** Text runs with the reading direction. React Native mirrors rows under
 *  forced RTL on its own, but textAlign maps to physical sides, so it does not. */
export const READ: "left" | "right" = isRTL ? "right" : "left";
export const READ_END: "flex-start" | "flex-end" = isRTL ? "flex-end" : "flex-start";
/** The chevron that means "back", pointing the way the reader came from. */
export const BACK = isRTL ? "›" : "‹";

/* ---- depth ------------------------------------------------------------- */

/** Barely there. Everything floating is the same as nothing floating. */
export const lift = Platform.select({
  ios: {
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  default: { elevation: 4 },
}) as object;
