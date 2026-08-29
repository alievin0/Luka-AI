/**
 * The safety clamp, exercised rather than described.
 *
 * `clampForSafety` decides whether a driver is told to get out of the car. It
 * is the last thing standing between a model that disobeyed rule 3 and a red
 * light rendered as "no need to stop", and until now the only thing asserting
 * it was a regex in check-paywall.js — which proves the code has a shape, not
 * that the shape behaves.
 *
 * The real function body is lifted out of the route and evaluated, the way
 * probe-scan.js lifts the real RESULT_SCHEMA. A mirror of the logic written
 * here would pass forever after the original stopped matching it.
 *
 *   node scripts/check-clamp.js
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

/* ------------------------------------------- the real function, not a copy */

const file = "app/api/scan+api.ts";
const src = fs.readFileSync(path.join(ROOT, file), "utf8");
const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2020, true);

let text = null;
const visit = (node) => {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "clampForSafety") {
    text = node.getText(sf);
  }
  ts.forEachChild(node, visit);
};
visit(sf);
if (!text) {
  console.log(`✗ clampForSafety not found in ${file}`);
  process.exit(1);
}

// Its only free variable is `clampedVerdict`. Stubbed with recognisable values
// so a replacement is distinguishable from the model's own sentence.
const STUB = {
  stop: { en: "[[stop]]", ar: "[[توقف]]" },
  caution: { en: "[[caution]]", ar: "[[حذر]]" },
};
const js = ts.transpileModule(`${text}; module.exports = clampForSafety;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const module_ = { exports: {} };
new Function("module", "exports", "clampedVerdict", js)(module_, module_.exports, STUB);
const clamp = module_.exports;

/* ---------------------------------------------------------- the truth table */

const reading = (over) => ({
  detected: true,
  title: "Engine",
  severity: "warning",
  confidence: "high",
  verdict: "MODEL SAID THIS",
  verdictLevel: "ok",
  roadside: "monitor",
  summary: "why",
  facts: [],
  causes: [],
  actions: [],
  seekHelpIf: [],
  ...over,
});

// The failure this exists for: the model calls a critical light safe.
const critical = clamp(reading({ severity: "critical" }), "en");
ok("a critical light can never come back as ok", critical.verdictLevel === "stop");
ok("and the model's reassuring sentence does not survive it", critical.verdict === "[[stop]]");
ok("and the journey does not continue either", critical.roadside === "move-to-safety");
ok("while the summary, which explains the light, is kept", critical.summary === "why");

// Same clamp, the user's own language.
ok("the replacement is in the request's locale", clamp(reading({ severity: "critical" }), "ar").verdict === "[[توقف]]");

// A guess is not a verdict.
const unsure = clamp(reading({ confidence: "low" }), "en");
ok("a low-confidence ok is lowered to caution", unsure.verdictLevel === "caution");
ok("and it loses the confident sentence too", unsure.verdict === "[[caution]]");

// Raising roadside on its own, with the level already right.
const stopButRolling = clamp(
  reading({ severity: "critical", verdictLevel: "stop", roadside: "drive-with-care" }),
  "en",
);
ok("a critical light may not say drive on", stopButRolling.roadside === "move-to-safety");
ok(
  "and a verdict that never contradicted itself keeps the model's words",
  stopButRolling.verdict === "MODEL SAID THIS",
);

// Everything else is left alone: over-clamping teaches drivers to ignore it.
const fine = clamp(reading({ severity: "info", verdictLevel: "ok", roadside: "monitor" }), "en");
ok("an ordinary ok result is untouched", fine.verdict === "MODEL SAID THIS" && fine.verdictLevel === "ok");
const caut = clamp(reading({ severity: "warning", verdictLevel: "caution" }), "en");
ok("so is a warning that already says caution", caut.verdict === "MODEL SAID THIS");

// A photo nobody could read must not arrive carrying a reading.
const blind = clamp({ detected: false, notDetectedReason: "too dark", title: "Engine", verdict: "x" }, "en");
ok("an unread photo is stripped to its reason", Object.keys(blind).sort().join() === "detected,notDetectedReason");

console.log(
  `\n${problems.length ? `${problems.length} problems.` : "The clamp overrules the colour, the words and the movement together."}`,
);
if (problems.length) process.exit(1);
