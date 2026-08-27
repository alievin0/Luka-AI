/**
 * The grounding guard for Ask Mahdar.
 *
 * The answer panel exists on one promise: nothing it says comes from anywhere
 * but the student's own lectures, and every citation can be opened and heard.
 * Two things have to hold for that to be true — the device must pick the right
 * evidence to send, and the server must throw away any citation that evidence
 * does not support. Both are checked here.
 *
 * Run: node scripts/check-study.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ts = require(path.join(ROOT, "node_modules/typescript"));

/** Transpile one TypeScript module with its imports stubbed out. */
function load(file, { strip = [], append = "", prelude = "" } = {}) {
  let source = fs.readFileSync(path.join(ROOT, file), "utf8").replace(/^import[\s\S]*?;$/gm, "");
  for (const pattern of strip) source = source.replace(pattern, "");
  const { outputText } = ts.transpileModule(prelude + source + append, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const box = { module: { exports: {} }, exports: {} };
  new Function("module", "exports", outputText)(box.module, box.exports);
  return box.module.exports;
}

/* `normalise` is the app's own text folding — lower-cased, punctuation and
 * Arabic diacritics stripped — and both files under test depend on it. */
const normaliseSource = fs
  .readFileSync(path.join(ROOT, "src/countries.ts"), "utf8")
  .match(/export function normalise[\s\S]*?\n\}\n/);
if (!normaliseSource) throw new Error("could not lift normalise() out of src/countries.ts");

const { contextFor, suggestionsFor } = load("src/study.ts", {
  prelude: normaliseSource[0] + "\n",
  append: "\nmodule.exports = { contextFor, suggestionsFor };",
});

const { ground } = load("app/api/ask+api.ts", {
  strip: [/export async function POST[\s\S]*$/m],
  append: "\nmodule.exports = { ground };",
});

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`,
  );
};

/* ------------------------------------------------------- retrieval */

const seg = (at, text) => ({ at, text });

const LECTURES = [
  {
    id: "L1",
    title: "Introduction to Translation",
    at: 1_700_000_000_000,
    status: "ready",
    duration: 3600,
    segments: [
      seg(0, "good morning everyone welcome back"),
      seg(30, "today we are talking about equivalence in translation"),
      seg(60, "equivalence is never one hundred percent between two languages"),
      seg(90, "so keep that in mind for your assignments"),
    ],
    analysis: {
      summary: "An introduction to equivalence.",
      keyPoints: [],
      tasks: [],
      emphasised: [],
      examPredictions: [],
      terms: [{ term: "Equivalence", definition: "Sameness of effect across languages." }],
      chapters: [],
      confidence: 80,
    },
  },
  {
    id: "L2",
    title: "Phonetics",
    at: 1_699_000_000_000,
    status: "ready",
    duration: 3600,
    segments: [
      seg(0, "vowels are produced without obstruction of the airflow"),
      seg(40, "consonants involve some constriction somewhere in the tract"),
    ],
    analysis: {
      summary: "Vowels and consonants.",
      keyPoints: [],
      tasks: [],
      emphasised: [],
      examPredictions: [],
      terms: [{ term: "Vowel", definition: "A sound made with an open tract." }],
      chapters: [],
      confidence: 80,
    },
  },
];

const found = contextFor("what did he say about equivalence", LECTURES);

check(
  "the question reaches the lecture that discussed it",
  found.excerpts.some((e) => e.lectureId === "L1" && e.at === 60),
  true,
);
check(
  "an unrelated lecture contributes nothing",
  found.excerpts.some((e) => e.lectureId === "L2"),
  false,
);
// A quotation cut off at the sentence that matched is a quotation that reads
// as nonsense, so hits travel with their neighbours.
check(
  "a hit brings its surrounding lines with it",
  found.excerpts.filter((e) => e.lectureId === "L1").length > 1,
  true,
);
check(
  "every lecture is catalogued, matched or not",
  found.overview.map((o) => o.id),
  ["L1", "L2"],
);

// Nothing to search on must not silently return the whole semester.
check("a question of only short words retrieves nothing", contextFor("is a", LECTURES).excerpts, []);

check("suggestions are built from the student's own concepts", suggestionsFor(LECTURES), [
  "Equivalence",
  "Vowel",
]);
check("with no lectures there is nothing to suggest", suggestionsFor([]), []);

/* ------------------------------------------------------- grounding */

const EXCERPTS = [
  { lectureId: "L1", at: 60, text: "equivalence is never one hundred percent between two languages" },
  { lectureId: "L1", at: 90, text: "so keep that in mind for your assignments" },
];

const real = ground(
  {
    answered: true,
    answer: "Your lecturer said equivalence is never complete.",
    citations: [
      { lectureId: "L1", atSeconds: 60, quote: "equivalence is never one hundred percent" },
    ],
  },
  EXCERPTS,
);
check("a genuine citation survives", real.citations.length, 1);
check("and the answer stands", real.answered, true);

// The words matter; the commas do not.
const messy = ground(
  {
    answered: true,
    answer: "x",
    citations: [{ lectureId: "L1", atSeconds: 60, quote: "Equivalence is never, one hundred percent!" }],
  },
  EXCERPTS,
);
check("punctuation and case differences still count as the same words", messy.citations.length, 1);

// This is the failure the whole feature is built to prevent.
const invented = ground(
  {
    answered: true,
    answer: "Your lecturer said the exam is on Tuesday.",
    citations: [{ lectureId: "L1", atSeconds: 60, quote: "the exam will be on Tuesday morning" }],
  },
  EXCERPTS,
);
check("an invented quotation is discarded", invented.citations, []);
check("and the answer is no longer served as grounded", invented.answered, false);

const wrongLecture = ground(
  {
    answered: true,
    answer: "x",
    citations: [{ lectureId: "L9", atSeconds: 10, quote: "equivalence is never one hundred percent" }],
  },
  EXCERPTS,
);
check("a citation to a lecture we never sent is discarded", wrongLecture.citations, []);

// Too short to distinguish a real match from a coincidence.
const fragment = ground(
  { answered: true, answer: "x", citations: [{ lectureId: "L1", atSeconds: 60, quote: "is" }] },
  EXCERPTS,
);
check("a fragment too short to verify is discarded", fragment.citations, []);

// A citation with no quotation is a pointer, not a claim about wording.
const pointer = ground(
  { answered: true, answer: "x", citations: [{ lectureId: "L1", atSeconds: 90 }] },
  EXCERPTS,
);
check("a citation with no quotation is kept as a pointer", pointer.citations.length, 1);

const nothing = ground({ answered: true, answer: "Something.", citations: [] }, EXCERPTS);
check("an answer with no sources at all is not presented as one", nothing.answered, false);

console.log(failures === 0 ? "\nAll study checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
