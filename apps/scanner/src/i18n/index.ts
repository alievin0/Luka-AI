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

/**
 * The language, resolved once at startup.
 *
 * A chosen language has to be readable *before* anything else imports this
 * module, because `isRTL` and the layout constants derived from it are
 * evaluated at import time. AsyncStorage cannot do that — it is async, and by
 * the time it answers the styles are already built. expo-sqlite's key-value
 * store has a synchronous read, which is the whole reason it is here.
 *
 * Falls back to the device language when nothing has been chosen, and to the
 * device language again if the store cannot be read at all.
 */
const CHOICE_KEY = "app:locale";

function stored(): Locale | null {
  try {
    const Storage = require("expo-sqlite/kv-store").default;
    const value = Storage.getItemSync(CHOICE_KEY);
    return value === "ar" || value === "en" ? value : null;
  } catch {
    return null;
  }
}

function device(): Locale {
  try {
    const tag = getLocales()[0]?.languageCode?.toLowerCase();
    return tag === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

const detect = (): Locale => stored() ?? device();

/** Whether the current language was chosen by the user or inherited. */
export const localeWasChosen = () => stored() !== null;

/** Records the choice. Takes effect on the next launch, which is why the
 *  caller reloads — RTL cannot be flipped on a running app. */
export function rememberLocale(next: Locale) {
  const Storage = require("expo-sqlite/kv-store").default;
  Storage.setItemSync(CHOICE_KEY, next);
}

/** Resolved once at startup. Changing it needs a reload, because the layout
 *  direction is fixed at native level when the app starts. */
export const locale: Locale = detect();

export const isRTL = locale === "ar";

/** Resolve a Text pair, falling back to English if a translation is missing. */
export const t = (text: Text): string => text[locale] || text.en;

/** Pick a value by locale without building a Text pair. */
export const pick = <T,>(en: T, ar: T): T => (locale === "ar" ? ar : en);

/**
 * Fill a placeholder string: fill(ui.dueIn, { n: 3 }).
 *
 * Sentences that stitch a number between two translated fragments read fine
 * in English and fall apart in Arabic, where the number's position in the
 * sentence is different. A whole templated sentence per language keeps that
 * decision with the translator instead of in the layout code.
 */
export const fill = (text: Text, values: Record<string, string | number>): string =>
  t(text).replace(/\{(\w+)\}/g, (_, key: string) =>
    key in values ? String(values[key]) : `{${key}}`,
  );
