/**
 * Extracted work, and the shape of the recording.
 *
 * Two things this file protects.
 *
 * First: task confirmation was added after people had already been using the
 * app, so lectures analysed before it have no record of the student agreeing
 * to anything. If "no record" were read as "not agreed", a semester of
 * accepted work would vanish from their list the moment they updated. Absent
 * has to mean already accepted, and that is checked here.
 *
 * Second: the waveform is presented as a picture of the lecture, so it must
 * be one — derived from the loudness actually measured, and absent rather
 * than invented when nothing was.
 *
 * Run: node scripts/check-candidates.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ts = require(path.join(ROOT, "node_modules/typescript"));

function load(file, { prelude = "", append = "" } = {}) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8").replace(/^import[\s\S]*?;$/gm, "");
  const { outputText } = ts.transpileModule(prelude + source + append, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const box = { module: { exports: {} }, exports: {} };
  new Function("module", "exports", outputText)(box.module, box.exports);
  return box.module.exports;
}

/* Storage and the pack registry are irrelevant to the pure functions under
 * test, but the module body touches them at import time. */
const STUBS = `
  const activePackId = "mahdar";
  const AsyncStorage = { getItem: async () => null, setItem: async () => {} };
  const Platform = { OS: "ios" };
`;

const { waveformOf, listenedFraction, awaitingReview } = load("src/lectures.ts", {
  prelude: STUBS,
  append: "\nmodule.exports = { waveformOf, listenedFraction, awaitingReview };",
});

const { tasksOf, candidatesOf } = load("src/tasks.ts", {
  prelude: "const getLectures = async () => [];\n",
  append: "\nmodule.exports = { tasksOf, candidatesOf };",
});

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`,
  );
};

/* --------------------------------------------- accepting and refusing work */

const lecture = (over) => ({
  id: "L1",
  title: "Lecture",
  at: 1_700_000_000_000,
  duration: 3600,
  segments: [],
  status: "ready",
  analysis: {
    summary: "",
    keyPoints: [],
    tasks: [{ text: "Chapter 4" }, { text: "Read pages 50-70" }, { text: "aside, not work" }],
    emphasised: [],
    examPredictions: [],
    terms: [],
    chapters: [],
    confidence: 80,
  },
  ...over,
});

// The migration case. This is the one that would lose a user's data.
const legacy = [lecture({})];
check("a lecture from before confirmation keeps all its tasks", tasksOf(legacy).length, 3);
check("and offers nothing for confirmation", candidatesOf(legacy), []);

// A freshly analysed lecture starts with everything unconfirmed.
const fresh = [lecture({ accepted: [], dismissed: [] })];
check("newly extracted work is not a task yet", tasksOf(fresh), []);
check("it is offered instead", candidatesOf(fresh).length, 3);

const partly = [lecture({ accepted: [0], dismissed: [2] })];
check("an accepted task becomes a task", tasksOf(partly).map((t) => t.task.text), ["Chapter 4"]);
check(
  "a refused one is offered to nobody, ever again",
  candidatesOf(partly).map((t) => t.task.text),
  ["Read pages 50-70"],
);
check(
  "and never reappears in the task list",
  tasksOf(partly).some((t) => t.task.text === "aside, not work"),
  false,
);

// Every task, in either list, carries where it came from.
check("a candidate knows its lecture", candidatesOf(partly)[0].lectureId, "L1");
check("and its index, which is what a decision is recorded against", candidatesOf(partly)[0].index, 1);

/* ------------------------------------------------------------- the picture */

const at = (i) => i * 10;
const quiet = Array.from({ length: 60 }, (_, i) => ({ at: at(i), text: "x", energy: -40 }));
const varied = quiet.map((seg, i) => ({ ...seg, energy: i % 12 === 0 ? -12 : -40 }));

check("a lecture with real dynamics gets a shape", waveformOf(varied, 24).length, 24);
check("every bar is inside the drawable range", waveformOf(varied, 24).every((b) => b > 0 && b <= 1), true);
check(
  "the loud stretches are taller than the quiet ones",
  Math.max(...waveformOf(varied, 24)) > Math.min(...waveformOf(varied, 24)),
  true,
);

// A recording delivered at one flat level has no shape to show, but it was
// still recorded — so it gets an even strip rather than a false dynamic.
const flat = waveformOf(quiet, 24);
check("an unvarying lecture gets an even strip", new Set(flat).size, 1);

// Nothing measured means nothing to draw. Inventing bars here would be the
// interface claiming to know something it does not.
check("no metering means no waveform", waveformOf([{ at: 0, text: "x" }], 24), []);
check("too few segments means no waveform", waveformOf(quiet.slice(0, 2), 24), []);
// Android reports a floor value for silence and 0 dBFS for clipping; neither
// is a measurement of the lecturer's voice.
check(
  "unusable metering is not mistaken for loudness",
  waveformOf(
    Array.from({ length: 60 }, (_, i) => ({ at: at(i), text: "x", energy: -160 })),
    24,
  ),
  [],
);

/* ------------------------------------------------------- resume and review */

check("no playhead is no progress", listenedFraction({ duration: 3600, segments: [] }), 0);
check("halfway through is half", listenedFraction({ duration: 3600, playhead: 1800, segments: [] }), 0.5);
check(
  "a playhead past the end still reads as finished, not more than finished",
  listenedFraction({ duration: 3600, playhead: 4000, segments: [] }),
  1,
);

check("an analysed lecture nobody opened is waiting", awaitingReview({ status: "ready" }), true);
check("once opened it is not", awaitingReview({ status: "ready", openedAt: 1 }), false);
check("and one still processing is not offered for review", awaitingReview({ status: "processing" }), false);

console.log(failures === 0 ? "\nAll candidate checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
