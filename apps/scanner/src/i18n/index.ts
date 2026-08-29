import { getLocales } from "expo-localization";
import TRANSLATIONS, { ORDER } from "./translations";

/**
 * English-first localisation.
 *
 * The apps ship worldwide, so English is the default and Arabic is selected
 * only when the device asks for it. Everything user-facing — UI chrome and
 * pack content alike — is a `Text` pair resolved through `t()`.
 */

export type Locale = "en" | "ar" | "es" | "pt" | "fr" | "de" | "tr" | "it";

/**
 * The shipped languages, and why these.
 *
 * Chosen on car ownership × iOS spend × how little English is read. A language
 * whose speakers read English fluently — Swedish, Dutch — buys comfort rather
 * than downloads; one whose market is cheap Android buys downloads rather than
 * subscriptions. None of these is right-to-left, so `isRTL` stays a question
 * about Arabic alone and no layout work follows from adding them.
 *
 * The name is what the model is told to answer in, so it is the language's own
 * name for itself where that is what a speaker would expect to see.
 */
export const LOCALES: { code: Locale; name: string; english: string }[] = [
  { code: "en", name: "English", english: "English" },
  { code: "ar", name: "العربية", english: "Modern Standard Arabic" },
  { code: "es", name: "Español", english: "Spanish" },
  { code: "pt", name: "Português", english: "Brazilian Portuguese" },
  { code: "fr", name: "Français", english: "French" },
  { code: "de", name: "Deutsch", english: "German" },
  { code: "tr", name: "Türkçe", english: "Turkish" },
  { code: "it", name: "Italiano", english: "Italian" },
];

const CODES = LOCALES.map((l) => l.code);
const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (CODES as string[]).includes(value);

/**
 * A string in the two languages the content files are authored in.
 *
 * Deliberately still a pair. `L(en, ar)` appears over nine hundred times, and
 * every other language arrives as an overlay keyed on the English string
 * rather than as two more fields on every call — see `translations` below.
 * Adding a language is then a data file, not an edit to nine hundred lines.
 */
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
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function device(): Locale {
  try {
    const tag = getLocales()[0]?.languageCode?.toLowerCase();
    return isLocale(tag) ? tag : "en";
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

/**
 * Everything that is not English or Arabic, keyed on the English string.
 * One table with every language on each row — see src/i18n/translations.ts.
 */
const column = ORDER.indexOf(locale as (typeof ORDER)[number]);

export const t = (text: Text): string => {
  if (locale === "en") return text.en;
  if (locale === "ar") return text.ar || text.en;
  return TRANSLATIONS[text.en]?.[column] || text.en;
};

/**
 * Resolve an error a server route sent back.
 *
 * The routes reply with whole `Text` pairs so the language is decided on the
 * device, but a body can also be an older plain string, or malformed, or from
 * a proxy that never saw the route at all. Anything that is not a usable pair
 * or a non-empty string is `null`, and the caller falls back to its own copy.
 */
export const remote = (value: unknown): string | null => {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value === "object") {
    const pair = value as Partial<Text>;
    if (typeof pair.en === "string" && typeof pair.ar === "string") return t(pair as Text);
  }
  return null;
};

/** Pick a value by locale without building a Text pair. Arabic against the
 *  rest, which is what every caller is actually asking about — RTL layout and
 *  Arabic-specific typography. */
export const pick = <T,>(en: T, ar: T): T => (locale === "ar" ? ar : en);

/** The running language's own name, for the model and for a language picker. */
export const localeName = (code: Locale = locale): string =>
  LOCALES.find((l) => l.code === code)?.name ?? "English";

/** Its English name, which is what the vision prompt is written in. */
export const localeEnglishName = (code: Locale = locale): string =>
  LOCALES.find((l) => l.code === code)?.english ?? "English";

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
