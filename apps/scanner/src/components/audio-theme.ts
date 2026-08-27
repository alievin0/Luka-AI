import { StyleSheet } from "react-native";
import { isRTL } from "../i18n";

/** Mahdar's palette and the chrome every lecture screen repeats: the gold on
 *  near-black, the wordmark pill, the panel. Shared so the record, analysing
 *  and review screens cannot drift away from the home screen. */

/** Body text runs with the reading direction. Hardcoding "right" mirrored
 *  every Mahdar screen on an English device, which reads as a broken app
 *  rather than a translated one. */
export const READ: "left" | "right" = isRTL ? "right" : "left";
/** Where a row of controls collects — the far edge of the reading direction. */
export const READ_END: "flex-start" | "flex-end" = isRTL ? "flex-end" : "flex-start";

export const GOLD = "#D9BE83";
export const INK = "#0E0D0B";
export const PANEL = "#141209";
export const PANEL_BORDER = "#241F14";
export const SURFACE = "#17150F";
export const SURFACE_BORDER = "#2A2519";
export const TEXT = "#E8E0CE";
export const TEXT_SOFT = "#9C9382";
export const TEXT_FAINT = "#6E685C";

export const audio = StyleSheet.create({
  root: { flex: 1, backgroundColor: INK },
  safe: { flex: 1 },
  pressed: { opacity: 0.85 },

  wordmarkWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    alignSelf: "center",
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: SURFACE_BORDER,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  langPill: {
    borderWidth: 1,
    borderColor: "#3A3324",
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 14,
  },
  langText: { color: "#C9BC9A", fontSize: 12, letterSpacing: 1.5, fontWeight: "600" },
  wordmarkLatin: { color: "#B8A87E", fontSize: 13, letterSpacing: 3, fontWeight: "500" },
  wordmarkDot: { color: GOLD, fontSize: 13 },
  wordmarkArabic: { color: GOLD, fontSize: 22, fontWeight: "700" },

  panel: {
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: 18,
  },

  tag: {
    backgroundColor: "#2A2210",
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  tagText: { color: GOLD, fontSize: 11, fontWeight: "700" },

  footer: {
    color: TEXT_FAINT,
    fontSize: 12,
    textAlign: "center",
    marginTop: 28,
  },
});
