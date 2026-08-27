/**
 * Countries offered in onboarding. `currency` drives cost estimates, and the
 * country name is passed to the vision prompt as user context (which insects
 * and which car models are plausible depends heavily on where you are).
 *
 * `aliases` let the search box match what people actually type — English
 * names, common misspellings, and Arabic spellings with or without "ال".
 */
export type Country = {
  code: string;
  name: string;
  currency: string;
  aliases: string[];
};

export const COUNTRIES: Country[] = [
  { code: "KW", name: "الكويت", currency: "د.ك", aliases: ["kuwait", "kw", "كويت"] },
  { code: "SA", name: "السعودية", currency: "ر.س", aliases: ["saudi", "ksa", "sa", "سعودية", "المملكة"] },
  { code: "AE", name: "الإمارات", currency: "د.إ", aliases: ["uae", "emirates", "dubai", "ae", "امارات", "الامارات", "دبي"] },
  { code: "QA", name: "قطر", currency: "ر.ق", aliases: ["qatar", "qa", "قطر"] },
  { code: "BH", name: "البحرين", currency: "د.ب", aliases: ["bahrain", "bh", "بحرين"] },
  { code: "OM", name: "عُمان", currency: "ر.ع", aliases: ["oman", "om", "عمان"] },
  { code: "JO", name: "الأردن", currency: "د.أ", aliases: ["jordan", "jo", "اردن", "الاردن"] },
  { code: "LB", name: "لبنان", currency: "ل.ل", aliases: ["lebanon", "lb", "لبنان"] },
  { code: "SY", name: "سوريا", currency: "ل.س", aliases: ["syria", "sy", "سوريا", "سورية"] },
  { code: "IQ", name: "العراق", currency: "د.ع", aliases: ["iraq", "iq", "عراق"] },
  { code: "PS", name: "فلسطين", currency: "₪", aliases: ["palestine", "ps", "فلسطين"] },
  { code: "EG", name: "مصر", currency: "ج.م", aliases: ["egypt", "eg", "مصر"] },
  { code: "LY", name: "ليبيا", currency: "د.ل", aliases: ["libya", "ly", "ليبيا"] },
  { code: "TN", name: "تونس", currency: "د.ت", aliases: ["tunisia", "tn", "تونس"] },
  { code: "DZ", name: "الجزائر", currency: "د.ج", aliases: ["algeria", "dz", "جزائر", "الجزائر"] },
  { code: "MA", name: "المغرب", currency: "د.م", aliases: ["morocco", "ma", "مغرب", "المغرب"] },
  { code: "SD", name: "السودان", currency: "ج.س", aliases: ["sudan", "sd", "سودان"] },
  { code: "YE", name: "اليمن", currency: "ر.ي", aliases: ["yemen", "ye", "يمن"] },
  { code: "TR", name: "تركيا", currency: "₺", aliases: ["turkey", "turkiye", "tr", "تركيا"] },
  { code: "GB", name: "بريطانيا", currency: "£", aliases: ["uk", "britain", "england", "gb", "بريطانيا"] },
  { code: "US", name: "أمريكا", currency: "$", aliases: ["usa", "us", "america", "امريكا", "أمريكا"] },
  { code: "CA", name: "كندا", currency: "C$", aliases: ["canada", "ca", "كندا"] },
  { code: "DE", name: "ألمانيا", currency: "€", aliases: ["germany", "de", "المانيا", "ألمانيا"] },
  { code: "FR", name: "فرنسا", currency: "€", aliases: ["france", "fr", "فرنسا"] },
  // "تاني" stays in the aliases although the label no longer says it: someone
  // typing the dialect word should still land here.
  { code: "OTHER", name: "مكان آخر", currency: "$", aliases: ["other", "غير", "تاني", "اخرى", "اخر"] },
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
    const haystacks = [normalise(country.name), ...country.aliases.map(normalise)];
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

export const currencyForCountry = (name: string) =>
  COUNTRIES.find((c) => c.name === name)?.currency ?? "$";
