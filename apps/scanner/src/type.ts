import { useFonts } from "expo-font";
import {
  ReadexPro_200ExtraLight,
  ReadexPro_300Light,
  ReadexPro_400Regular,
  ReadexPro_500Medium,
  ReadexPro_600SemiBold,
  ReadexPro_700Bold,
} from "@expo-google-fonts/readex-pro";
import { Amiri_400Regular_Italic, Amiri_700Bold } from "@expo-google-fonts/amiri";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from "@expo-google-fonts/ibm-plex-sans-arabic";

/**
 * The typefaces.
 *
 * The system font is what made this look like a prototype: it carries no
 * point of view, and on an Arabic device it falls back to whatever the OS
 * happens to ship, which is different on every phone.
 *
 * Readex Pro is a genuine Arabic-and-Latin superfamily — the same shapes and
 * the same weights in both scripts — so a bilingual screen holds together
 * instead of looking like two apps stitched at the seam.
 *
 * Amiri is a classical naskh, and it is used deliberately in exactly two
 * places: the app's own name, and the line the app says while it is thinking.
 * "مَحضَر" means a written record of what was said in a room. A manuscript
 * face is the whole idea of the product in one word, and it earns its place
 * precisely because nothing else on the screen uses it.
 */
export const FONTS = {
  /** Headlines, the wordmark's Latin half, numerals. */
  display: "ReadexPro_600SemiBold",
  displayBold: "ReadexPro_700Bold",
  /** Body copy, at a light weight — long Arabic paragraphs set heavy read as shouting. */
  body: "ReadexPro_300Light",
  bodyMedium: "ReadexPro_500Medium",
  bodyRegular: "ReadexPro_400Regular",
  /** Labels and timestamps. */
  thin: "ReadexPro_200ExtraLight",
  /** The manuscript voice. Used twice, on purpose. */
  script: "Amiri_700Bold",
  scriptItalic: "Amiri_400Regular_Italic",
} as const;

/**
 * The type scale.
 *
 * Arabic and Latin do not want the same numbers. Arabic needs generous line
 * height for its ascenders and diacritics; the same value applied to Latin
 * leaves the lines floating apart and a headline eats the whole screen — which
 * is exactly what the first pass did. Sizes are also capped against the screen
 * width so a long English headline shrinks rather than wrapping to four lines.
 */
import { Dimensions } from "react-native";
import { isRTL } from "./i18n";

const { width } = Dimensions.get("window");
/** Below this the phone is small enough that everything steps down a notch. */
const NARROW = width < 380;

const leading = (multiplier: number) => (isRTL ? multiplier + 0.35 : multiplier);

export const SCALE = {
  hero: NARROW ? 26 : 29,
  heroLine: Math.round((NARROW ? 26 : 29) * leading(1.28)),
  title: NARROW ? 22 : 25,
  titleLine: Math.round((NARROW ? 22 : 25) * leading(1.3)),
  section: 17,
  sectionLine: Math.round(17 * leading(1.4)),
  body: 14.5,
  bodyLine: Math.round(14.5 * leading(1.55)),
  label: 12.5,
  labelLine: Math.round(12.5 * leading(1.5)),
  micro: 11,
} as const;

/**
 * The faces each archetype actually uses.
 *
 * `activePackId` is fixed at build time, so this map is constant for the life
 * of the app and safe to hand a hook. Loading all of them regardless would
 * put a megabyte of Arabic outlines into a scanner that never draws one.
 *
 * The scanner apps use Inter for Latin and IBM Plex Sans Arabic for Arabic —
 * two faces drawn to the same brief, so a bilingual screen keeps one voice
 * while each script gets a face made for it. Mahdar keeps Readex Pro, a real
 * superfamily, because a bilingual lecture transcript wants one voice.
 */
const AUDIO_FACES = {
  ReadexPro_200ExtraLight,
  ReadexPro_300Light,
  ReadexPro_400Regular,
  ReadexPro_500Medium,
  ReadexPro_600SemiBold,
  ReadexPro_700Bold,
  Amiri_400Regular_Italic,
  Amiri_700Bold,
};

const SCANNER_FACES = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
};

export function useAppFonts() {
  const [loaded, error] = useFonts(
    require("./packs").pack.kind === "audio" ? AUDIO_FACES : SCANNER_FACES,
  );
  // A font that fails to load must not hold the app hostage — the system face
  // is worse, not fatal.
  return loaded || Boolean(error);
}
