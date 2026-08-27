/**
 * The Arabic register guard.
 *
 * The apps ship bilingual, and every Arabic string is one half of an
 * `L(en, ar)` pair. Two things can go wrong when that Arabic is rewritten, and
 * neither shows up in a typecheck:
 *
 *   - a placeholder is dropped or renamed, so `fill()` leaves `{n}` on screen
 *     or silently substitutes nothing;
 *   - a sentence is skimmed and left in dialect, which is invisible in a diff
 *     of 900 strings but obvious to the reader.
 *
 * The copy is Modern Standard Arabic by decision, so the second one is a
 * failure rather than a preference. This reads every pair through the
 * TypeScript parser — not a regex over source text, because the strings
 * themselves contain quotes, braces and Arabic punctuation.
 *
 * Run: node scripts/check-arabic.js [--all]
 *
 * Without --all it guards only the files converted so far, listed in SCOPE.
 * That is deliberate: the three unconverted packs would drown the signal.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ts = require(path.join(ROOT, "node_modules/typescript"));

/** Files whose Arabic has been converted and must stay converted. */
const SCOPE = [
  "src/i18n/ui.ts",
  "src/packs/dashlight.ts",
  "src/packs/dashlight-library.ts",
  "src/packs/mahdar.ts",
  "src/packs/womensfit.ts",
];

const EVERYTHING = [
  ...SCOPE,
  "src/packs/bugscan.ts",
  "src/packs/bugscan-library.ts",
  "src/packs/goldscan.ts",
  "src/packs/goldscan-library.ts",
  "src/packs/dogtrain.ts",
];

/**
 * Dialect markers, as whole words. Arabic has no case, but it does glue
 * proclitics on, so each pattern allows the ب/و/ل/ف/ال prefixes where the word
 * takes them and refuses a letter on the far side — otherwise `بس` matches
 * inside `بسبب`, `رح` inside `الجرح`, and the guard cries wolf.
 */
const AR = "\\u0600-\\u06FF";
const marker = (body) => new RegExp(`(?<![${AR}])(?:[وفبل])?${body}(?![${AR}])`, "u");

const DIALECT = [
  ["شو", marker("شو")],
  ["هلق", marker("هلق")],
  ["عم (حرف استمرار)", /(?<![؀-ۿ])عم\s+[يتنأ][؀-ۿ]+/u],
  ["بدك/بدها/بدي/بده", marker("بد[كهيتنا]ا?")],
  ["كمان", marker("كمان")],
  ["هيك", marker("هيك")],
  ["منشان/مشان", marker("م[ن]?شان")],
  ["عشان", marker("عشان")],
  ["كتير", marker("كتير")],
  ["ما عاد", /(?<![؀-ۿ])ما\s+عاد(?![؀-ۿ])/u],
  ["رح (حرف استقبال)", /(?<![؀-ۿ])رح\s+[يتنأ][؀-ۿ]+/u],
  ["بس", marker("بس")],
  ["وين", marker("وين")],
  ["اللي", marker("اللي")],
  ["مو", marker("مو")],
  ["مش", marker("مش")],
  ["ما في", /(?<![؀-ۿ])ما\s+في(?![؀-ۿ])/u],
  ["شي/إشي", marker("إ?شي")],
  ["هال-", /(?<![؀-ۿ])[بو]?هال[؀-ۿ]{2,}/u],
  ["لازم", marker("لازم")],
  ["قديش", marker("قديش")],
  ["دقايق", marker("دقايق")],
  ["لين", marker("لين")],
  ["هذي", marker("هذي")],
  ["بعدين", marker("بعدين")],
  ["هون", marker("هون")],
  ["برّا", marker("بر[ّا]?ا")],
  ["فيك/فيكي", marker("فيك[ي]?")],
  ["هاد/هاي", marker("ها[دي]")],
  ["تاني (بمعنى آخر)", marker("تاني[ةه]?")],
  ["خربان", marker("خربان[ةه]?")],
  ["اركن", marker("اركن")],
  ["ولعت", marker("ولعت")],
  ["سواقة", marker("سواقة")],
  ["زحمة", marker("زحمة")],
  ["غطا (بدون همزة)", marker("غطا")],
  // Borrowed workshop terms the glossary replaces outright.
  ["لمبة", marker("لمب[ةات]+")],
  ["الطبلون", marker("طبلون")],
  ["الكتالايست", marker("كتالايست")],
  ["الشكمان", marker("شكمان")],
  ["الكبوت", marker("كبوت")],
  ["الجير", marker("جير")],
  ["الدركسون", marker("دركسون")],
  ["البوجيهات", marker("بوجيهات")],
  ["الدينمو", marker("دينمو")],
  ["بونش", marker("بونش")],
  ["فحمات", marker("فحمات")],
  ["دعسة", marker("دعسة")],
  ["الموتور", marker("موتور")],
  ["الصرفية", marker("صرفية")],
  ["ورشة", marker("ورشة")],
];

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Every L(en, ar) call in a file, with the line it sits on. */
function pairs(file) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2020, true);
  const found = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "L" &&
      node.arguments.length === 2 &&
      node.arguments.every((a) => ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))
    ) {
      found.push({
        en: node.arguments[0].text,
        ar: node.arguments[1].text,
        line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const files = process.argv.includes("--all") ? EVERYTHING : SCOPE;
let failures = 0;
let checked = 0;

for (const file of files) {
  if (!fs.existsSync(path.join(ROOT, file))) continue;
  const found = pairs(file);
  checked += found.length;
  const problems = [];

  for (const { en, ar, line } of found) {
    if (!ar.trim()) {
      problems.push(`${file}:${line}  the Arabic half is empty`);
      continue;
    }
    const a = placeholders(ar).join(",");
    const e = placeholders(en).join(",");
    if (a !== e) {
      problems.push(`${file}:${line}  placeholders differ — en {${e || "—"}} vs ar {${a || "—"}}`);
    }
    // The two language toggles are the same word in both halves by design.
    if (ar === en && !/^(العربية|English)$/.test(ar)) {
      problems.push(`${file}:${line}  Arabic is identical to English — "${ar}"`);
    }
    for (const [name, re] of DIALECT) {
      const hit = ar.match(re);
      if (hit) {
        problems.push(`${file}:${line}  dialect “${name}” → …${context(ar, hit.index)}…`);
        break;
      }
    }
  }

  const label = `${file} (${found.length} pairs)`;
  if (problems.length) {
    failures += problems.length;
    console.log(`FAIL ${label}`);
    for (const p of problems.slice(0, 40)) console.log(`       ${p}`);
    if (problems.length > 40) console.log(`       … and ${problems.length - 40} more`);
  } else {
    console.log(`ok   ${label}`);
  }
}

function context(s, at) {
  const from = Math.max(0, at - 24);
  return s.slice(from, Math.min(s.length, at + 36));
}

console.log(`\n${checked} pairs checked`);
if (failures) {
  console.log(`${failures} problems.`);
  process.exit(1);
}
console.log("Arabic is Modern Standard throughout, and every placeholder survives.");
