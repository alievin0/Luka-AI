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

export function useAppFonts() {
  const [loaded, error] = useFonts({
    ReadexPro_200ExtraLight,
    ReadexPro_300Light,
    ReadexPro_400Regular,
    ReadexPro_500Medium,
    ReadexPro_600SemiBold,
    ReadexPro_700Bold,
    Amiri_400Regular_Italic,
    Amiri_700Bold,
  });
  // A font that fails to load must not hold the app hostage — the system face
  // is worse, not fatal.
  return loaded || Boolean(error);
}
