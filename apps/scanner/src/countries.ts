import { L, t, type Text } from "./i18n";

/**
 * Countries offered in onboarding.
 *
 * Three things hang off this list, and they used to disagree with each other:
 *
 *   - **The label.** It was Arabic only, so an English user chose their
 *     country from a list of Arabic names and read `الأردن` back in Settings.
 *     Both languages ship, so the name is a `Text` pair like every other
 *     string in the app.
 *   - **The currency.** It was a written abbreviation — `ر.س`, `ر.ق`, `ر.ع` —
 *     which is what the model is told to price in, and what the result screen
 *     printed beside the number. Three of those differ by one letter, and none
 *     of them means anything to an English reader. It is an ISO 4217 code now;
 *     the symbol comes from `Intl.NumberFormat` at the point of display.
 *   - **The key.** `currencyForCountry` matched on the display name, and the
 *     profile stored that name, so editing any label would silently drop every
 *     existing user to `USD`. It matches on `code`.
 *
 * `aliases` let the search box match what people actually type — English
 * names, common misspellings, and Arabic spellings with or without "ال".
 */
export type Country = {
  code: string;
  name: Text;
  /** ISO 4217. Sent to the model and used to format the estimate. */
  currency: string;
  aliases: string[];
};

export const COUNTRIES: Country[] = [
  { code: "KW", name: L("Kuwait", "الكويت"), currency: "KWD", aliases: ["kuwait", "kw", "كويت"] },
  { code: "SA", name: L("Saudi Arabia", "السعودية"), currency: "SAR", aliases: ["saudi", "ksa", "sa", "سعودية", "المملكة"] },
  { code: "AE", name: L("United Arab Emirates", "الإمارات"), currency: "AED", aliases: ["uae", "emirates", "dubai", "ae", "امارات", "الامارات", "دبي"] },
  { code: "QA", name: L("Qatar", "قطر"), currency: "QAR", aliases: ["qatar", "qa", "قطر"] },
  { code: "BH", name: L("Bahrain", "البحرين"), currency: "BHD", aliases: ["bahrain", "bh", "بحرين"] },
  { code: "OM", name: L("Oman", "عُمان"), currency: "OMR", aliases: ["oman", "om", "عمان"] },
  { code: "JO", name: L("Jordan", "الأردن"), currency: "JOD", aliases: ["jordan", "jo", "اردن", "الاردن"] },
  { code: "LB", name: L("Lebanon", "لبنان"), currency: "LBP", aliases: ["lebanon", "lb", "لبنان"] },
  { code: "SY", name: L("Syria", "سوريا"), currency: "SYP", aliases: ["syria", "sy", "سوريا", "سورية"] },
  { code: "IQ", name: L("Iraq", "العراق"), currency: "IQD", aliases: ["iraq", "iq", "عراق"] },
  { code: "PS", name: L("Palestine", "فلسطين"), currency: "ILS", aliases: ["palestine", "ps", "فلسطين"] },
  { code: "EG", name: L("Egypt", "مصر"), currency: "EGP", aliases: ["egypt", "eg", "مصر"] },
  { code: "LY", name: L("Libya", "ليبيا"), currency: "LYD", aliases: ["libya", "ly", "ليبيا"] },
  { code: "TN", name: L("Tunisia", "تونس"), currency: "TND", aliases: ["tunisia", "tn", "تونس"] },
  { code: "DZ", name: L("Algeria", "الجزائر"), currency: "DZD", aliases: ["algeria", "dz", "جزائر", "الجزائر"] },
  { code: "MA", name: L("Morocco", "المغرب"), currency: "MAD", aliases: ["morocco", "ma", "مغرب", "المغرب"] },
  { code: "SD", name: L("Sudan", "السودان"), currency: "SDG", aliases: ["sudan", "sd", "سودان"] },
  { code: "YE", name: L("Yemen", "اليمن"), currency: "YER", aliases: ["yemen", "ye", "يمن"] },
  { code: "TR", name: L("Türkiye", "تركيا"), currency: "TRY", aliases: ["turkey", "turkiye", "tr", "تركيا"] },
  { code: "GB", name: L("United Kingdom", "بريطانيا"), currency: "GBP", aliases: ["uk", "britain", "england", "gb", "بريطانيا"] },
  { code: "US", name: L("United States", "أمريكا"), currency: "USD", aliases: ["usa", "us", "america", "امريكا", "أمريكا"] },
  { code: "CA", name: L("Canada", "كندا"), currency: "CAD", aliases: ["canada", "ca", "كندا"] },
  { code: "DE", name: L("Germany", "ألمانيا"), currency: "EUR", aliases: ["germany", "de", "المانيا", "ألمانيا"] },
  { code: "FR", name: L("France", "فرنسا"), currency: "EUR", aliases: ["france", "fr", "فرنسا"] },
  // "تاني" stays in the aliases although the label no longer says it: someone
  // typing the dialect word should still land here.
  { code: "OTHER", name: L("Somewhere else", "مكان آخر"), currency: "USD", aliases: ["other", "غير", "تاني", "اخرى", "اخر"] },
];

/** Strips Arabic diacritics and normalises alef/ya/ta-marbuta so that
 *  "الامارات", "الإمارات" and "امارات" all match the same entry. */
export function normalise(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/^ال/, "");
}

export function searchCountries(query: string): Country[] {
  const q = normalise(query);
  if (!q) return COUNTRIES;

  const scored = COUNTRIES.map((country) => {
    // Both names, whichever language the app is in: someone reading Arabic may
    // still type "kuwait", and someone reading English may paste "الكويت".
    const haystacks = [
      normalise(country.name.en),
      normalise(country.name.ar),
      ...country.aliases.map(normalise),
    ];
    let score = -1;
    for (const h of haystacks) {
      if (h === q) score = Math.max(score, 3);
      else if (h.startsWith(q)) score = Math.max(score, 2);
      else if (h.includes(q)) score = Math.max(score, 1);
    }
    return { country, score };
  }).filter((entry) => entry.score >= 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.country);
}

/**
 * The country a stored profile refers to.
 *
 * Profiles written before this file keyed on the display name stored the
 * Arabic label, so both are accepted. Anything unrecognised is `undefined`
 * rather than a guess.
 */
export const countryFor = (stored: string): Country | undefined =>
  COUNTRIES.find((c) => c.code === stored) ??
  COUNTRIES.find((c) => c.name.ar === stored || c.name.en === stored);

/** ISO 4217 for a stored profile value, defaulting to USD. */
export const currencyForCountry = (stored: string) => countryFor(stored)?.currency ?? "USD";

/** The country's name in the reader's language, or the raw stored value when
 *  it matches nothing — better than showing them nothing at all. */
export const countryLabel = (stored: string) => {
  const country = countryFor(stored);
  return country ? t(country.name) : stored;
};
