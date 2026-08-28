/**
 * How much of each language actually exists.
 *
 * English and Arabic are authored on every `L(en, ar)` pair. The other six
 * arrive as an overlay keyed on the English string, and `t()` falls back to
 * English for anything missing — which is the right behaviour at runtime and
 * a terrible one to be unaware of, because a half-translated app looks fine
 * in the language you happen to speak and reads as broken in the others.
 *
 * So this prints coverage, and fails on the strings that must never fall back:
 * the ones a driver acts on. A "Stop the car" that silently reverts to English
 * in Turkish is not a cosmetic gap.
 *
 *   node scripts/check-locales.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ts = require(path.join(ROOT, "node_modules/typescript"));

const problems = [];
const ok = (what, condition) => {
  if (condition) console.log(`ok   ${what}`);
  else {
    console.log(`FAIL ${what}`);
    problems.push(what);
  }
};

/* ------------------------------------------ every English string the app ships */

const SOURCES = [
  "src/i18n/ui.ts",
  "src/i18n/errors.ts",
  "src/packs/dashlight.ts",
  "src/packs/dashlight-library.ts",
];

/** The first argument of every L(...) call, read as syntax rather than regex —
 *  these strings contain commas, quotes and Arabic, and a regex gets them
 *  wrong in exactly the places that matter. */
function englishStrings(file) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2020, true);
  const out = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "L" &&
      node.arguments.length >= 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const all = new Set();
for (const file of SOURCES) for (const s of englishStrings(file)) all.add(s);

/* ------------------------------------------------------- what must not fall back

   The lines a driver acts on. Everything else can read English for a while
   without anyone coming to harm; these cannot. Identified by the ui.ts keys
   they are authored under, so renaming a key breaks this loudly rather than
   quietly dropping a line out of the safety set. */

const CRITICAL_KEYS = [
  "cardStopLine", "cardCautionLine", "cardOkLine",
  "roadDoNotMoveTitle", "roadDoNotMoveLine",
  "roadMoveToSafetyTitle", "roadMoveToSafetyLine",
  "roadDriveWithCareTitle", "roadDriveWithCareLine",
  "roadMonitorTitle", "roadMonitorLine",
  "safePlaceQuestion", "safePlaceYes", "safePlaceNo", "safePlaceGood", "safePlaceSteps",
  "symptomQuestion", "symptomStopTitle", "symptomStopBody", "symptomOverrode", "symptomNoneBody",
  "lampOnly",
];

function criticalStrings() {
  const file = "src/i18n/ui.ts";
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2020, true);
  const found = new Map();
  const visit = (node) => {
    if (ts.isPropertyAssignment(node)) {
      const key = node.name.getText(sf).replace(/['"]/g, "");
      if (CRITICAL_KEYS.includes(key)) found.set(key, englishStrings(file).length ? collect(node, sf) : []);
    }
    ts.forEachChild(node, visit);
  };
  const collect = (node, sf) => {
    const out = [];
    const walk = (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "L" &&
        ts.isStringLiteralLike(n.arguments[0])
      ) {
        out.push(n.arguments[0].text);
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
    return out;
  };
  visit(sf);
  return found;
}

const critical = criticalStrings();
const missingKeys = CRITICAL_KEYS.filter((k) => !critical.has(k));
ok(
  `all ${CRITICAL_KEYS.length} safety keys still exist${missingKeys.length ? ` (missing: ${missingKeys.join(", ")})` : ""}`,
  missingKeys.length === 0,
);
const criticalText = new Set([...critical.values()].flat());

/* ------------------------------------------------------------------ coverage */

const LOCALES = ["es", "pt", "fr", "de", "tr", "it"];
console.log(`\n${all.size} English strings, ${criticalText.size} of them safety-critical\n`);

for (const code of LOCALES) {
  const file = path.join(ROOT, `src/i18n/locales/${code}.ts`);
  if (!fs.existsSync(file)) {
    ok(`${code}: a translation file exists`, false);
    continue;
  }
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", js)(mod, mod.exports);
  const dict = mod.exports.default ?? {};

  const done = [...all].filter((s) => dict[s]).length;
  const stale = Object.keys(dict).filter((k) => !all.has(k));
  const missingCritical = [...criticalText].filter((s) => !dict[s]);
  const pct = Math.round((done / all.size) * 100);

  console.log(`${code}  ${String(pct).padStart(3)}%  ${done}/${all.size}${stale.length ? `  · ${stale.length} stale` : ""}`);
  ok(
    `  ${code}: every safety line is translated${missingCritical.length ? ` (${missingCritical.length} missing)` : ""}`,
    missingCritical.length === 0,
  );
  if (missingCritical.length) {
    for (const s of missingCritical.slice(0, 4)) console.log(`     ! ${s.slice(0, 68)}`);
  }
}

console.log(
  `\n${problems.length ? `${problems.length} problems.` : "Every language can be trusted with the lines a driver acts on."}`,
);
if (problems.length) process.exit(1);
