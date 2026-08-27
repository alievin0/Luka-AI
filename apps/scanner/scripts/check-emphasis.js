/**
 * Regression check for the emphasis scorer — the one piece of logic the whole
 * product rests on, and the one with no visible failure mode: if it silently
 * returns nothing, the app still runs, still transcribes, still summarises,
 * and quietly stops doing the thing people subscribed for.
 *
 * Run: node scripts/check-emphasis.js
 */
const Module = require("module");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ts = require(path.join(ROOT, "node_modules/typescript"));

// lectures.ts imports two native modules that can't load outside the app.
const STUBS = {
  "react-native": { Platform: { OS: "ios" } },
  "@react-native-async-storage/async-storage": { default: {} },
};
const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;
const isPack = (r) => r === "./packs" || r === "../packs";
Module._resolveFilename = function (request, ...rest) {
  if (STUBS[request] || isPack(request)) return "stub:" + request;
  return originalResolve.call(this, request, ...rest);
};
Module._load = function (request, ...rest) {
  if (STUBS[request]) return STUBS[request];
  if (isPack(request)) return {};
  return originalLoad.call(this, request, ...rest);
};
require.extensions[".ts"] = (mod, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  mod._compile(outputText, filename);
};

const { scoreEnergy, emphasisCandidates, mergeTranscript, locate, offsetSegments, audioDuration } = require(path.join(ROOT, "src/lectures.ts"));

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
};

/** An even lecture around -30 dBFS with three genuinely raised passages, one
 *  knock against the phone that clips, and one stretch at the silence floor. */
function lecture() {
  const BASE = -30;
  const RAISED = [8, 20, 33];
  const segments = [];
  for (let i = 0; i < 40; i += 1) {
    let energy = BASE + (i % 5) - 2;
    if (RAISED.includes(i)) energy = BASE + 11;
    if (i === 14) energy = -0.5;
    if (i === 25) energy = -160;
    segments.push({ at: i * 12, text: `line ${i}`, energy });
  }
  segments[5].marked = true;
  return segments;
}

const segments = lecture();
const scored = scoreEnergy(segments);
const raisedAt = (list) => list.filter((s) => s.emphasis >= 0.5).map((s) => s.at / 12);

check("detects the passages the lecturer raised their voice on", raisedAt(scored), [8, 20, 33]);
check("rejects a clipping knock as handling noise", scored[14].emphasis, 0);
check("rejects the Android silence floor", scored[25].emphasis, 0);
check("leaves the raw dBFS measurement untouched", scored[8].energy, -19);
check("carries the hand-marked flag through", scored[5].marked, true);

// Scoring is a read-time derivation, so applying it twice must be identical.
// When the 0-1 score was written back over `energy`, the second pass read
// those values as clipping and zeroed every emphasis in the lecture.
check("is idempotent across a storage round-trip", raisedAt(scoreEnergy(scored)), [8, 20, 33]);

check(
  "hands the model the marked moment plus the raised ones",
  emphasisCandidates(segments).map((c) => c.at),
  [60, 96, 240, 396],
);

// A lecture delivered at one flat volume has nothing to report, and saying so
// is more useful than stretching noise into a ranking.
check(
  "reports nothing when delivery is flat",
  raisedAt(scoreEnergy(Array.from({ length: 40 }, (_, i) => ({ at: i * 12, text: "x", energy: -30 })))),
  [],
);
check(
  "reports nothing when there is too little to judge",
  scoreEnergy([{ at: 0, text: "a", energy: -30 }, { at: 5, text: "b", energy: -12 }]).map((s) => s.emphasis),
  [0, 0],
);


/* ------------------------------------------------------ transcript merging */

// The accurate server pass returns better words but knows nothing the
// microphone knew. Replacing the segments outright threw away every loudness
// reading and every moment the student marked during the lecture — and the
// loudness cannot be recovered, because metering only exists while recording.
const recorded = [
  { at: 0, text: "intro", energy: -30 },
  { at: 10, text: "the important bit", energy: -18, marked: true },
  { at: 25, text: "aside", energy: -31 },
];
const fromServer = [
  { at: 0, text: "Introduction to the topic." },
  { at: 11, text: "The important bit, said properly." },
  { at: 26, text: "An aside." },
];
const merged = mergeTranscript(fromServer, recorded);

check("merge keeps the server's better wording", merged.map((m) => m.text), fromServer.map((m) => m.text));
check("merge carries the loudness readings across", merged.map((m) => m.energy), [-30, -18, -31]);
check("merge preserves what the student marked by hand", merged[1].marked, true);
check("merge does not invent marks", [merged[0].marked, merged[2].marked], [undefined, undefined]);
check(
  "merged segments still score as emphasis",
  scoreEnergy(
    mergeTranscript(
      Array.from({ length: 40 }, (_, i) => ({ at: i * 12, text: `s${i}` })),
      lecture(),
    ),
  )
    .filter((s) => s.emphasis >= 0.5)
    .map((s) => s.at / 12),
  [8, 20, 33],
);
check(
  "merge passes through untouched when nothing was measured",
  mergeTranscript(fromServer, []).map((m) => m.energy),
  [undefined, undefined, undefined],
);


/* ------------------------------------------------------- chunked recordings */

// The recording is stored as closed 5-minute files so a crash costs one slice
// rather than the lecture. Everything the student sees still has to behave as
// one continuous timeline — so locating a moment must land on the right file
// at the right offset, or "tap any moment of emphasis" plays the wrong audio.
const CHUNKS = [
  { uri: "a.m4a", at: 0, duration: 300 },
  { uri: "b.m4a", at: 300, duration: 300 },
  { uri: "c.m4a", at: 600, duration: 137 },
];

check("total duration is the sum of the slices", audioDuration(CHUNKS), 737);
check("the start of the lecture", locate(CHUNKS, 0), { index: 0, offset: 0 });
check("mid-way through the first slice", locate(CHUNKS, 120), { index: 0, offset: 120 });
// The boundary is the off-by-one that would silently play the wrong file.
check("the last moment of a slice stays in it", locate(CHUNKS, 299.5), { index: 0, offset: 299.5 });
check("the first moment of the next slice crosses over", locate(CHUNKS, 300), { index: 1, offset: 0 });
check("a moment in the final slice", locate(CHUNKS, 700), { index: 2, offset: 100 });
// A timestamp can sit slightly past the audio when the model rounds up; that
// should play the end rather than silently doing nothing.
check("past the end clamps to the end", locate(CHUNKS, 5000), { index: 2, offset: 137 });
check("a negative time clamps to the start", locate(CHUNKS, -10), { index: 0, offset: 0 });
check("no chunks means nothing to locate", locate([], 10), null);
check("undefined chunks means nothing to locate", locate(undefined, 10), null);

// Each slice is transcribed on its own and comes back starting at zero, so
// the offsets are what make the transcript one lecture again.
check(
  "chunk transcripts are shifted onto the lecture timeline",
  offsetSegments([{ at: 0, text: "a" }, { at: 42.5, text: "b" }], 300).map((s) => s.at),
  [300, 342.5],
);
check(
  "every located segment round-trips to its own slice",
  offsetSegments([{ at: 0, text: "x" }, { at: 299, text: "y" }], 300)
    .map((s) => locate(CHUNKS, s.at))
    .map((r) => r.index),
  [1, 1],
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
