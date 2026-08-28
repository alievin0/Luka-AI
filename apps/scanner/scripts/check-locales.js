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

/* ------------------------------------------- what Dash Light can actually show

   ui.ts is chrome shared by six apps and only one of them ships. Nearly forty
   per cent of its keys are reachable only from the lecture and program
   screens, and translating those is six languages of work with no reader.
   Coverage is therefore measured against the strings this app can render —
   otherwise 100% is unreachable and the number stops meaning anything. */

const OTHER_ARCHETYPES = [
  "src/components/AudioHome.tsx", "app/lecture.tsx", "app/record.tsx", "app/paste.tsx",
  "app/(tabs)/lectures.tsx", "app/(tabs)/study.tsx", "app/(tabs)/tasks.tsx",
  "app/(tabs)/search.tsx", "src/lecture-export.ts", "src/insights.ts", "src/study.ts",
  "src/lectures.ts", "src/concepts.ts",
  "src/components/ProgramHome.tsx", "app/session.tsx", "app/plan.tsx", "src/progress.ts",
];

/** Every ui.<key> a file mentions. */
const keysIn = (file) =>
  new Set([...fs.readFileSync(file, "utf8").matchAll(/\bui\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));

function unreachableKeys() {
  const walk = (dir, acc = []) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel, acc);
      else if (/\.tsx?$/.test(e.name)) acc.push(rel);
    }
    return acc;
  };
  const usage = {};
  for (const f of [...walk("app"), ...walk("src")]) {
    for (const key of keysIn(path.join(ROOT, f))) (usage[key] ??= new Set()).add(f);
  }
  return new Set(
    Object.entries(usage)
      .filter(([, files]) => [...files].every((f) => OTHER_ARCHETYPES.includes(f)))
      .map(([key]) => key),
  );
}

/** The English strings behind a set of ui keys. */
function stringsForKeys(keys) {
  const file = "src/i18n/ui.ts";
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2020, true);
  const out = new Set();
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && keys.has(node.name.getText(sf).replace(/['"]/g, ""))) {
      const walk = (n) => {
        if (
          ts.isCallExpression(n) &&
          ts.isIdentifier(n.expression) &&
          n.expression.text === "L" &&
          ts.isStringLiteralLike(n.arguments[0])
        ) {
          out.add(n.arguments[0].text);
        }
        ts.forEachChild(n, walk);
      };
      walk(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const everything = new Set();
for (const file of SOURCES) for (const s of englishStrings(file)) everything.add(s);

const unreachable = stringsForKeys(unreachableKeys());
const all = new Set([...everything].filter((s) => !unreachable.has(s)));

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

const table = (() => {
  const js = ts.transpileModule(
    fs.readFileSync(path.join(ROOT, "src/i18n/translations.ts"), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", js)(mod, mod.exports);
  return { rows: mod.exports.default ?? {}, order: mod.exports.ORDER ?? [] };
})();

console.log(
  `\n${all.size} strings Dash Light can render — ${unreachable.size} more belong to the ` +
    `lecture and program apps and are not counted. ${criticalText.size} are safety-critical.\n`,
);

// A row for a string the app no longer ships is a translation of something
// nobody reads, and it hides the real coverage number behind a bigger one.
const stale = Object.keys(table.rows).filter((k) => !everything.has(k));
ok(`no stale rows${stale.length ? ` (${stale.length}, e.g. "${stale[0].slice(0, 40)}")` : ""}`, stale.length === 0);

table.order.forEach((code, i) => {
  const done = [...all].filter((s) => table.rows[s]?.[i]).length;
  const missingCritical = [...criticalText].filter((s) => !table.rows[s]?.[i]);
  console.log(`${code}  ${String(Math.round((done / all.size) * 100)).padStart(3)}%  ${done}/${all.size}`);
  ok(
    `  ${code}: every safety line is translated${missingCritical.length ? ` (${missingCritical.length} missing)` : ""}`,
    missingCritical.length === 0,
  );
  for (const s of missingCritical.slice(0, 3)) console.log(`     ! ${s.slice(0, 68)}`);
});

console.log(
  `\n${problems.length ? `${problems.length} problems.` : "Every language can be trusted with the lines a driver acts on."}`,
);
if (problems.length) process.exit(1);
