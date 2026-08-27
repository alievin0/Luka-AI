import { StyleSheet } from "react-native";
import { isRTL } from "../i18n";
import { FONTS } from "../type";

/**
 * Mahdar's surface.
 *
 * The first pass used one flat colour per element, which is what made the app
 * read as a prototype: real surfaces have a light source. Everything here is
 * built from a single premise — a warm lamp above and behind the content, on
 * a near-black that is brown rather than grey, the way a lecture hall at
 * night actually looks. Cards catch a little of that light at their top edge;
 * the gold is the only saturated thing on the screen and so it always means
 * "this is the thing to press".
 */

export const GOLD = "#D9BE83";
export const GOLD_BRIGHT = "#EBD6A6";
export const GOLD_DEEP = "#A8894A";
export const INK = "#0E0D0B";

/** Card fills, given as gradient pairs so surfaces have a top-lit edge. */
export const PANEL_GRADIENT = ["#191610", "#121009"] as const;
export const RAISED_GRADIENT = ["#221D14", "#17140D"] as const;
/** The warm bloom behind the top of every screen. */
export const BLOOM = ["#241E12", "#12100A", "#0E0D0B"] as const;

export const PANEL_BORDER = "#2A2318";
export const HAIRLINE = "#1F1B13";
export const SURFACE = "#17150F";
export const SURFACE_BORDER = "#2A2519";

export const TEXT = "#F1E9D8";
export const TEXT_SOFT = "#A99E88";
export const TEXT_FAINT = "#6F6757";

/** Body text runs with the reading direction. Hardcoding "right" mirrored
 *  every Mahdar screen on an English device, which reads as a broken app
 *  rather than a translated one. */
export const READ: "left" | "right" = isRTL ? "right" : "left";
export const READ_END: "flex-start" | "flex-end" = isRTL ? "flex-end" : "flex-start";

/** Gold carries a glow rather than a drop shadow — a warm element on a dark
 *  ground should look lit, not lifted. */
export const glow = (colour = GOLD, radius = 24, opacity = 0.32) => ({
  shadowColor: colour,
  shadowOpacity: opacity,
  shadowRadius: radius,
  shadowOffset: { width: 0, height: 6 },
  elevation: 10,
});

export const lift = {
  shadowColor: "#000",
  shadowOpacity: 0.45,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 10 },
  elevation: 6,
};

/**
 * One spacing scale. Every gap and pad comes from here, so vertical rhythm is
 * a decision made once rather than a number guessed per screen — which is
 * what made the first pass feel loose and inconsistent.
 */
export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22, xxl: 30, section: 38 } as const;

export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

/**
 * Semantic states.
 *
 * Gold is the accent and means "act on this" — it cannot also mean "warning",
 * or it stops meaning anything. These are the other things the interface has
 * to say, each with a colour AND a label, because colour alone is not a
 * signal a colour-blind student can read.
 */
export const STATE = {
  /** The model worked this out. Never dressed up as something that was said. */
  inferred: { fg: "#8FA8C4", bg: "#16202C", line: "#24374C" },
  /** The lecturer said this, and we can play it back. */
  stated: { fg: "#7FC49B", bg: "#13251B", line: "#1F3A2B" },
  /** A deadline close enough to matter today. */
  urgent: { fg: "#E0A05C", bg: "#2A1D0E", line: "#43301A" },
  /** Something failed and the student has to know. */
  danger: { fg: "#E08878", bg: "#2A1310", line: "#4A241E" },
  /** Work in flight. */
  busy: { fg: "#C9BC9A", bg: "#221E14", line: "#332C1E" },
  /** Finished, and quiet about it. */
  done: { fg: "#6F6757", bg: "#191712", line: "#241F17" },
} as const;

export type StateName = keyof typeof STATE;

export const audio = StyleSheet.create({
  root: { flex: 1, backgroundColor: INK },
  safe: { flex: 1 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },

  wordmarkWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 11,
    alignSelf: "center",
    backgroundColor: "rgba(30,26,18,0.72)",
    borderWidth: 1,
    borderColor: SURFACE_BORDER,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 15,
    marginTop: 12,
  },
  langPill: {
    borderWidth: 1,
    borderColor: "#403826",
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 13,
  },
  langText: {
    color: "#C9BC9A",
    fontSize: 11,
    letterSpacing: 1.6,
    fontFamily: FONTS.bodyMedium,
  },
  wordmarkLatin: {
    color: "#9C8B63",
    fontSize: 11,
    letterSpacing: 3.4,
    fontFamily: FONTS.bodyMedium,
  },
  wordmarkDot: { color: GOLD_DEEP, fontSize: 11 },
  /* The one place the manuscript face carries the brand. */
  wordmarkArabic: { color: GOLD, fontSize: 25, fontFamily: FONTS.script, lineHeight: 34 },

  panel: {
    backgroundColor: "#141109",
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: 20,
    overflow: "hidden",
  },

  tag: {
    backgroundColor: "#2E2512",
    borderRadius: 7,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  tagText: { color: GOLD, fontSize: 10.5, fontFamily: FONTS.bodyMedium },

  footer: {
    color: TEXT_FAINT,
    fontSize: 11.5,
    textAlign: "center",
    marginTop: 28,
    fontFamily: FONTS.body,
    letterSpacing: 0.3,
  },
});
