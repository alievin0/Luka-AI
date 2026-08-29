/**
 * The provenance guard.
 *
 * Every task, term and exam prediction can carry the lecturer's own words and
 * the second they were said. That is the product's central claim, so the one
 * thing that must never happen is a quotation the lecturer never uttered —
 * a paraphrase presented as a quotation is worse than no quotation at all.
 *
 * Run: node scripts/check-provenance.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ts = require(path.join(ROOT, "node_modules/typescript"));

// Lift clampAnalysis out of the route without running the route's imports.
const source = fs.readFileSync(path.join(ROOT, "app/api/analyze+api.ts"), "utf8");
const stripped = source
  .replace(/^import[\s\S]*?;$/gm, "")
  .replace(/export async function POST[\s\S]*$/m, "");
const { outputText } = ts.transpileModule(
  stripped + "\nmodule.exports = { clampAnalysis };",
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
);
const box = { module: { exports: {} }, exports: {} };
new Function("module", "exports", outputText)(box.module, box.exports);
const { clampAnalysis } = box.module.exports;

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
};

const TRANSCRIPT = [
  "[00:12] okay everyone, today we are looking at translation theory",
  "[02:40] solve the chapter four exercises before Sunday, all of them",
  "[05:03] this distinction — equivalence versus adequacy — matters a great deal",
  "[41:22] and I will say this once: that definition is going to be on the exam",
].join("\n");

const base = {
  summary: "s", keyPoints: [], tasks: [], emphasised: [],
  examPredictions: [], terms: [], chapters: [], confidence: 90,
};
const WORDS = 500;

// A real quotation survives untouched, timestamp and all.
const real = clampAnalysis({
  ...base,
  tasks: [{ text: "Chapter 4 exercises", atSeconds: 160, quote: "solve the chapter four exercises before Sunday" }],
}, WORDS, TRANSCRIPT);
check("a genuine quotation is kept", real.tasks[0].quote, "solve the chapter four exercises before Sunday");
check("its timestamp is kept", real.tasks[0].atSeconds, 160);

// Punctuation and spacing differences are the model being untidy, not lying.
const messy = clampAnalysis({
  ...base,
  tasks: [{ text: "x", atSeconds: 160, quote: "Solve the chapter four exercises, before Sunday." }],
}, WORDS, TRANSCRIPT);
check("punctuation and case differences still count as the same words", Boolean(messy.tasks[0].quote), true);

// A paraphrase is not a quotation, however true it is.
const paraphrased = clampAnalysis({
  ...base,
  tasks: [{ text: "x", atSeconds: 160, quote: "You must complete all of chapter four's exercises by the weekend" }],
}, WORDS, TRANSCRIPT);
check("a paraphrase is stripped", paraphrased.tasks[0].quote, undefined);
check("but the timestamp survives, because it may still be right", paraphrased.tasks[0].atSeconds, 160);

// The same rule applies everywhere a quote can appear.
const invented = clampAnalysis({
  ...base,
  terms: [{ term: "equivalence", definition: "d", quote: "equivalence means sameness of meaning" }],
  examPredictions: [{ topic: "t", confidence: "high", why: "w", basis: "stated", quote: "this will definitely be in the final paper" }],
}, WORDS, TRANSCRIPT);
check("an invented term quotation is stripped", invented.terms[0].quote, undefined);
check("an invented exam quotation is stripped", invented.examPredictions[0].quote, undefined);
// And a prediction that claimed the lecturer said it, with nothing to show, is downgraded.
check("'stated' without a surviving quote becomes 'inferred'", invented.examPredictions[0].basis, "inferred");

const honest = clampAnalysis({
  ...base,
  examPredictions: [{ topic: "t", confidence: "high", why: "w", basis: "stated", quote: "that definition is going to be on the exam" }],
}, WORDS, TRANSCRIPT);
check("a real exam quotation keeps its 'stated' basis", honest.examPredictions[0].basis, "stated");

// An item with no quote at all is honest and must pass through untouched.
const bare = clampAnalysis({ ...base, tasks: [{ text: "x", atSeconds: 12 }] }, WORDS, TRANSCRIPT);
check("an unquoted item is left alone", bare.tasks[0], { text: "x", atSeconds: 12 });

// Too short to be meaningfully verified — must not pass on a coincidence.
const tiny = clampAnalysis({ ...base, tasks: [{ text: "x", quote: "the" }] }, WORDS, TRANSCRIPT);
check("a fragment too short to verify is stripped", tiny.tasks[0].quote, undefined);


/* ------------------------------------------------------------ task buckets */

// Loaded the same way: tasks.ts imports storage, which cannot run here.
const tasksSrc = fs.readFileSync(path.join(ROOT, "src/tasks.ts"), "utf8")
  .replace(/^import[\s\S]*?;$/gm, "")
  .replace(/export const allTasks[\s\S]*?;\n/m, "");
const tOut = ts.transpileModule(
  tasksSrc + "\nmodule.exports = { bucketOf, tasksOf, groupTasks, taskSummary };",
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;
const tBox = { module: { exports: {} }, exports: {} };
new Function("module", "exports", tOut)(tBox.module, tBox.exports);
const { bucketOf, tasksOf, groupTasks, taskSummary } = tBox.module.exports;

const NOW = Date.parse("2026-08-27T09:00:00Z");
const DAY = 86400000;
const at = (offset) => ({ key: "k", done: false, due: NOW + offset, lectureAt: 0, index: 0, task: {} });

check("yesterday is overdue", bucketOf(at(-DAY), NOW), "overdue");
// Same calendar day but earlier than now is still today's work, not overdue —
// comparing raw timestamps would wrongly bury a task due at 08:00.
check("earlier today is still today", bucketOf(at(-2 * 3600 * 1000), NOW), "today");
check("later today is today", bucketOf(at(6 * 3600 * 1000), NOW), "today");
check("three days out is soon", bucketOf(at(3 * DAY), NOW), "soon");
check("a month out is later", bucketOf(at(40 * DAY), NOW), "later");
check("no deadline is undated", bucketOf({ ...at(0), due: null }, NOW), "undated");
check("finished outranks its deadline", bucketOf({ ...at(-DAY), done: true }, NOW), "done");

// Provenance has to survive the flattening, or the Tasks screen cannot show
// which lecture a deadline came from — which is the whole point of it.
const flat = tasksOf([
  {
    id: "L1", title: "Translation", at: 1000, duration: 0, segments: [], status: "ready",
    done: [1],
    analysis: { ...base, tasks: [
      { text: "Chapter 4", dueISO: new Date(NOW + DAY).toISOString(), atSeconds: 160, quote: "q" },
      { text: "Reading", atSeconds: 900 },
    ] },
  },
]);
check("both tasks are flattened", flat.length, 2);
check("the source lecture travels with the task", flat[0].lectureTitle, "Translation");
check("the timestamp travels with it", flat[0].task.atSeconds, 160);
check("a ticked task is marked done", flat[1].done, true);
check("keys are unique per lecture and index", new Set(flat.map((f) => f.key)).size, 2);

// Due tomorrow, so it belongs in "soon" — "today" would be wrong.
check(
  "groups come back in the order a student reads them",
  groupTasks(flat, NOW).map((g) => g.bucket),
  ["soon", "done"],
);
check("the summary counts only open work", taskSummary(flat, NOW).open, 1);

console.log(failures === 0 ? "\nAll provenance checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
