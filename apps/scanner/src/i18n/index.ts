import { getLocales } from "expo-localization";

/**
 * English-first localisation.
 *
 * The apps ship worldwide, so English is the default and Arabic is selected
 * only when the device asks for it. Everything user-facing — UI chrome and
 * pack content alike — is a `Text` pair resolved through `t()`.
 */

export type Locale = "en" | "ar";

/** A string in both shipped languages. */
export type Text = { en: string; ar: string };

/** Authoring helper so content files stay readable: L("Sit", "اجلس"). */
export const L = (en: string, ar: string): Text => ({ en, ar });

function detect(): Locale {
  try {
    const tag = getLocales()[0]?.languageCode?.toLowerCase();
    return tag === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

/** Resolved once at startup; changing it needs an app reload, which is what
 *  the OS does anyway when the device language changes. */
export const locale: Locale = detect();

export const isRTL = locale === "ar";

/** Resolve a Text pair, falling back to English if a translation is missing. */
export const t = (text: Text): string => text[locale] || text.en;

/** Pick a value by locale without building a Text pair. */
export const pick = <T,>(en: T, ar: T): T => (locale === "ar" ? ar : en);
