import { isRTL } from "./i18n";
import { pack } from "./packs";

/**
 * The faces for screens every app shares.
 *
 * Onboarding, the paywall and settings are one implementation serving three
 * archetypes, and the archetypes do not use the same typefaces: the scanners
 * are set in Inter and Cairo, Mahdar in Readex Pro. Only the faces that
 * archetype loaded are available at runtime, so a shared screen has to ask
 * rather than assume — naming a face that was never loaded silently drops the
 * screen back to the system font, which is exactly the drift this avoids.
 */
const AUDIO = {
  bold: "ReadexPro_700Bold",
  semibold: "ReadexPro_600SemiBold",
  medium: "ReadexPro_500Medium",
  regular: "ReadexPro_400Regular",
} as const;

const SCANNER = {
  bold: isRTL ? "Cairo_700Bold" : "Inter_700Bold",
  semibold: isRTL ? "Cairo_600SemiBold" : "Inter_600SemiBold",
  medium: isRTL ? "Cairo_500Medium" : "Inter_500Medium",
  regular: isRTL ? "Cairo_400Regular" : "Inter_400Regular",
} as const;

export const UI_FONT: { bold: string; semibold: string; medium: string; regular: string } =
  pack.kind === "audio" ? AUDIO : SCANNER;
