/**
 * The store listing, held to the same rules as the app.
 *
 * Two kinds of failure live here and neither shows up in a build.
 *
 * The cheap one is arithmetic. Apple truncates a name at 30 characters, a
 * subtitle at 30 and the keyword field at 100, and it indexes all three as one
 * bag — so a word spent twice is a word thrown away, and nobody notices until
 * a listing is live in eight languages.
 *
 * The expensive one is the app's own rule, escaping into marketing. Dash Light
 * never says the car is safe: it is one photograph of one lamp, and it cannot
 * see smoke, hear a bearing or feel the steering. `check-clamp.js` holds that
 * line inside the app. A screenshot headline reading "Safe to go" would break
 * it in the one place a driver reads before they have the app at all, and no
 * check in this repository would have seen it.
 *
 *   node scripts/check-aso.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const aso = require(path.join(ROOT, "store/aso.json"));

const problems = [];
const ok = (what, condition) => {
  if (condition) console.log(`ok   ${what}`);
  else {
    console.log(`FAIL ${what}`);
    problems.push(what);
  }
};

/** Apple's own limits. Not ours to argue with. */
const LIMIT = { name: 30, subtitle: 30, keywords: 100 };

/** Ours: a headline burned into a screenshot has to read at thumbnail size,
 *  and every language below has to fit the same box as English. */
const SHOT = 38;

const locales = Object.keys(aso).filter((k) => !k.startsWith("_"));

/* ------------------------------------------- the listing speaks the app's own
   languages, and no others

   A storefront listing in a language the app does not render converts a
   download into a refund and a one-star review. Read off `src/i18n/index.ts`
   rather than asserted here, so adding a ninth language to the app is what
   permits a ninth listing. */

const i18n = fs.readFileSync(path.join(ROOT, "src/i18n/index.ts"), "utf8");
const declared = (i18n.match(/export type Locale =([^;]+);/)?.[1] ?? "")
  .split("|")
  .map((s) => s.trim().replace(/"/g, ""))
  .filter(Boolean);

ok(`the app declares ${declared.length} languages (${declared.join(" ")})`, declared.length > 0);
ok(
  `and the listing covers each exactly once (${locales.length} storefronts)`,
  declared.length === locales.length &&
    declared.every((code) => locales.filter((l) => l.split("-")[0] === code).length === 1),
);

/* --------------------------------------------------------- Apple's arithmetic */

/** Apple counts characters, and an emoji or a bullet is a character. */
const len = (s) => [...s].length;

for (const locale of locales) {
  const entry = aso[locale];

  for (const field of ["name", "subtitle", "keywords"]) {
    const value = entry[field] ?? "";
    ok(
      `${locale} ${field}: ${len(value)}/${LIMIT[field]}`,
      len(value) > 0 && len(value) <= LIMIT[field],
    );
  }

  // Apple's keyword field is comma-separated and a space after a comma is a
  // character spent on nothing.
  ok(`${locale} keywords: no wasted spaces`, !/,\s/.test(entry.keywords));

  /* A word in the name is already indexed. Repeating it in the keyword field
     buys nothing and costs the characters a word that is not indexed yet would
     have used. */
  const words = (s) =>
    new Set(
      s
        .toLowerCase()
        .split(/[\s,:·|/–—-]+/)
        .map((w) => w.replace(/[?!.،؟]/g, ""))
        .filter((w) => len(w) > 2),
    );
  const named = new Set([...words(entry.name), ...words(entry.subtitle)]);
  const repeated = [...words(entry.keywords)].filter((w) => named.has(w));
  ok(
    `${locale} keywords: nothing already in the name${repeated.length ? ` — repeats ${repeated.join(", ")}` : ""}`,
    repeated.length === 0,
  );

  ok(`${locale}: six screenshot headlines`, entry.shots?.length === 6);
  for (const shot of entry.shots ?? []) {
    ok(`${locale} shot: "${shot}" (${len(shot)}/${SHOT})`, len(shot) <= SHOT);
  }
}

/* ------------------------------------------------ the app's rule, in marketing

   `check-clamp.js` asserts that no screen states the car is safe. The store
   listing is read by more people than any screen, and by all of them before
   they can judge it. So the same word is banned here.

   "No need to stop" is what the app says and what this may say: a statement
   about the lamp, not about the vehicle. */

const SAFE = [
  [/\bsafe\b|\bsafely\b/i, "en"],
  [/آمن|بأمان|سليمة/, "ar"],
  [/\bsegur[oa]s?\b/i, "es/pt"],
  [/\bsûre?\b|\bsécurit/i, "fr"],
  [/\bsicher\b|\bunbedenklich\b/i, "de"],
  [/\bgüvenli\b/i, "tr"],
  [/\bsicur[oa]\b/i, "it"],
];

for (const locale of locales) {
  const copy = [aso[locale].name, aso[locale].subtitle, ...(aso[locale].shots ?? [])].join(" ");
  const hit = SAFE.find(([pattern]) => pattern.test(copy));
  ok(
    `${locale}: never calls the car safe${hit ? ` — found "${copy.match(hit[0])[0]}"` : ""}`,
    !hit,
  );
}

console.log(
  `\n${problems.length ? `${problems.length} problems.` : "Every field fits, nothing is indexed twice, and no listing promises a safe car."}`,
);
if (problems.length) process.exit(1);
