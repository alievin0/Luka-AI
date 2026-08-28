/**
 * The decision hierarchy, given inputs and asked what it concluded.
 *
 * `--matrix` in probe-scan.js answers a different question: does the model
 * read the photograph correctly? This answers the one after it — given what
 * the model returned, and what the driver then said, what does the screen
 * decide? The two are separate because the second has no API in it. The
 * symptom question is answered in the app, after the scan; the model never
 * receives it, so no probe run can exercise this and no prompt can enforce it.
 *
 * Deterministic, free, and part of `npm run check`.
 *
 *   node scripts/check-decision.js
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

/* ------------------------------------------------- the real decide(), not a copy */

const src = fs.readFileSync(path.join(ROOT, "src/decision.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const mod = { exports: {} };
new Function("module", "exports", "require", js)(mod, mod.exports, () => ({}));
const { decide } = mod.exports;

const reading = (over) => ({
  detected: true,
  title: "Check engine",
  severity: "info",
  confidence: "high",
  verdict: "No need to stop",
  verdictLevel: "ok",
  roadside: "monitor",
  ...over,
});

/* ------------------------------------------------------------ the truth table */

// The case that started this: a reassuring reading, and a driver who can smell
// burning. The screen used to show both at once — green band, red card.
const green = reading();
const smells = decide(green, true);
ok("a reported symptom overrules a reassuring reading", smells.level === "stop");
ok("and raises the severity with it", smells.severity === "critical");
ok("and stops the car being moved at all", smells.roadside === "do-not-move");
ok("and says the driver caused it, not the photo", smells.overridden === true);

// The same reading, unanswered and answered no.
for (const [label, answer] of [["unanswered", null], ["answered no", false]]) {
  const d = decide(green, answer);
  ok(
    `${label}: the model's reading stands untouched`,
    d.level === "ok" && d.severity === "info" && d.roadside === "monitor" && !d.overridden,
  );
}

// It may never lower. A "no" is the absence of what a driver can perceive, not
// an inspection — and a red screen that a tap can talk down is worse than one
// that cannot be talked up.
const red = reading({ severity: "critical", verdictLevel: "stop", roadside: "do-not-move" });
for (const [label, answer] of [["no", false], ["unanswered", null], ["yes", true]]) {
  const d = decide(red, answer);
  ok(`a critical reading survives "${label}"`, d.level === "stop" && d.severity === "critical");
}

// A caution that gets a symptom becomes a stop, not a louder caution.
const amber = decide(reading({ severity: "warning", verdictLevel: "caution", roadside: "drive-with-care" }), true);
ok("a caution plus a symptom is a stop", amber.level === "stop" && amber.roadside === "do-not-move");

// Results saved before `roadside` existed still render.
const old = reading();
delete old.roadside;
ok("an old result with no roadside class does not crash", decide(old, null).roadside === "monitor");
ok("and still overrides on a symptom", decide(old, true).roadside === "do-not-move");

// Nothing in here may quietly reach for the network or a clock.
ok("the decision is pure", !/fetch|Date\.|Math\.random/.test(src));

console.log(
  `\n${problems.length ? `${problems.length} problems.` : "A symptom outranks the photograph, and nothing lowers a verdict."}`,
);
if (problems.length) process.exit(1);
