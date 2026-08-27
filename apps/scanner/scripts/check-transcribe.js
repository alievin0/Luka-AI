/**
 * Regression check for the Scribe word grouping.
 *
 * Scribe interleaves `spacing` entries between words, and those entries span
 * the pause between them. Treating one as a word made every measured gap zero
 * — so the silence split never fired — and let a spacing token open a segment,
 * stamping it with the previous sentence's end time. Both failures are
 * invisible in the output: you get text, just chopped in the wrong places and
 * timed to seek the audio somewhere else.
 *
 * Run: node scripts/check-transcribe.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ts = require(path.join(ROOT, "node_modules/typescript"));

// Pull toSegments out of the route without executing the route's imports.
const source = fs.readFileSync(path.join(ROOT, "app/api/transcribe+api.ts"), "utf8");
const stripped = source
  .replace(/^import[\s\S]*?;$/gm, "")
  .replace(/export async function POST[\s\S]*$/m, "");
const { outputText } = ts.transpileModule(stripped + "\nmodule.exports = { toSegments };", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const sandbox = { module: { exports: {} }, exports: {} };
new Function("module", "exports", outputText)(sandbox.module, sandbox.exports);
const { toSegments } = sandbox.module.exports;

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
};

/** Builds Scribe's real output shape: a spacing entry between every word,
 *  spanning whatever silence sits there. */
function scribe(pieces) {
  const words = [];
  let t = pieces[0].at;
  pieces.forEach((piece, i) => {
    if (i > 0) {
      words.push({ text: " ", start: t, end: piece.at, type: "spacing" });
      t = piece.at;
    }
    words.push({ text: piece.text, start: t, end: t + 0.5, type: "word", speaker_id: piece.speaker });
    t += 0.5;
  });
  return words;
}

// A two-second pause mid-lecture is a new thought and must open a new line.
const pause = toSegments(
  scribe([
    { at: 9.4, text: "theorem" },
    { at: 10.0, text: "holds" },
    { at: 14.0, text: "now" },
    { at: 14.6, text: "consider" },
  ]),
);
check("a long silence starts a new segment", pause.length, 2);
check("the second segment is stamped where speech resumes", pause[1].at, 14);
check("no text is lost across the split", pause.map((s) => s.text).join(" "), "theorem holds now consider");

// After a sentence ends, the next token Scribe emits is always a spacing one.
// Letting it open the segment stamped that segment at the previous sentence's
// end, seeking the player into the tail of the sentence before.
const punctuated = toSegments(
  scribe([
    { at: 9.4, text: "on the exam." },
    { at: 12.0, text: "Now" },
    { at: 12.4, text: "turn over." },
  ]),
);
check("punctuation ends a segment", punctuated.length, 2);
check("a spacing token never opens a segment", punctuated[1].at, 12);
check("the sentence after the break is intact", punctuated[1].text, "Now turn over.");

// Continuous speech with no punctuation and no pauses must not be split by
// the silence rule at all — only by the word ceiling.
const flowing = toSegments(
  scribe(Array.from({ length: 20 }, (_, i) => ({ at: 1 + i * 0.6, text: `w${i}` }))),
);
check("uninterrupted speech stays in one segment", flowing.length, 1);
check("it is stamped at the first word", flowing[0].at, 1);

// Diarisation is what separates a student's question from the lecturer.
const speakers = toSegments(
  scribe([
    { at: 0, text: "Any questions?", speaker: "speaker_0" },
    { at: 5.0, text: "Yes,", speaker: "speaker_1" },
    { at: 5.4, text: "one.", speaker: "speaker_1" },
  ]),
);
check("each segment keeps its speaker", speakers.map((s) => s.speaker), ["speaker_0", "speaker_1"]);

check("an empty word list yields nothing", toSegments([]), []);
check(
  "audio events are dropped, not transcribed",
  toSegments([
    { text: "(cough)", start: 0, end: 1, type: "audio_event" },
    { text: "right", start: 1, end: 1.5, type: "word" },
  ]).map((s) => s.text),
  ["right"],
);

console.log(failures === 0 ? "\nAll transcribe checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
