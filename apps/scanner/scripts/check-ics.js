/**
 * Regression check for the calendar export.
 *
 * The parts that fail silently: RFC 5545 escaping (a raw comma or semicolon
 * splits a property and mangles the rest of the file), and 75-octet line
 * folding — where the octet count matters because Arabic is two bytes per
 * character, and where a naive byte split would tear a character in half.
 *
 * Run: node scripts/check-ics.js
 */
const Module = require("module");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ts = require(path.join(ROOT, "node_modules/typescript"));

const STUBS = {
  "expo-notifications": {},
  "./i18n": { t: (x) => (x && x.en) || "" },
  "./i18n/ui": { ui: new Proxy({}, { get: () => ({ en: "", ar: "" }) }) },
  "./packs": {},
  "./lectures": { clock: (s) => String(s), transcriptOfSegments: () => "" },
};
const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (STUBS[request]) return "stub:" + request;
  return originalResolve.call(this, request, ...rest);
};
Module._load = function (request, ...rest) {
  if (STUBS[request]) return STUBS[request];
  return originalLoad.call(this, request, ...rest);
};
require.extensions[".ts"] = (mod, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  mod._compile(outputText, filename);
};

const { toIcs } = require(path.join(ROOT, "src/lecture-export.ts"));

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
};

const lecture = (tasks) => ({
  id: "L1",
  title: "محاضرة الترجمة",
  at: Date.parse("2026-08-27T08:00:00Z"),
  duration: 3600,
  segments: [],
  status: "ready",
  analysis: { summary: "", keyPoints: [], tasks, emphasised: [], examPredictions: [], terms: [], chapters: [], confidence: 80 },
});

const DUE = "2026-09-03T20:00:00.000Z";

check("no dated tasks means no calendar at all", toIcs(lecture([{ text: "read" }])), null);

const basic = toIcs(lecture([{ text: "Read chapter 4", dueISO: DUE }]));
check("uses CRLF throughout", basic.includes("\n") && !basic.includes("\n") === false && !/[^\r]\n/.test(basic), true);
check("opens and closes the calendar", [basic.startsWith("BEGIN:VCALENDAR"), basic.trimEnd().endsWith("END:VCALENDAR")], [true, true]);
check("stamps DTSTART in UTC basic format", /DTSTART:20260903T200000Z/.test(basic), true);

// A comma or semicolon left raw ends the property early and corrupts the file.
const risky = toIcs(lecture([{ text: "Read ch. 4, 5; then, revise", dueISO: DUE }]));
const summary = risky.split("\r\n").find((l) => l.startsWith("SUMMARY:"));
// Assert on meaning, not on a literal: every separator must arrive escaped,
// and unescaping must give the original text back exactly.
const unescape = (v) => v.replace(/\\([\\;,n])/g, (_, c) => (c === "n" ? "\n" : c));
check("leaves no separator unescaped", /(^|[^\\])[;,]/.test(summary.slice("SUMMARY:".length)), false);
check("escaping round-trips to the original text", unescape(summary.slice("SUMMARY:".length)), "Read ch. 4, 5; then, revise");

// Every line must respect the 75-octet recommendation, counted in octets.
const longArabic = "اقرأ الفصل الرابع والخامس كامل قبل المحاضرة الجاية وجهّز أسئلتك عشان نناقشها سوا بالقاعة";
const folded = toIcs(lecture([{ text: longArabic, dueISO: DUE }]));
const overLong = folded.split("\r\n").filter((l) => Buffer.byteLength(l, "utf8") > 75);
check("no line exceeds 75 octets", overLong, []);
// A continuation may legitimately begin with two spaces — the fold space plus
// a space that is genuinely part of the text. What must hold is that every
// continuation is introduced by exactly one fold space, which the reversibility
// check below proves; here just assert the file has no empty continuation.
check("no continuation line is empty", folded.split("\r\n").filter((l) => l === " "), []);

// Unfolding (strip CRLF + one space) must give the text back byte for byte —
// this is what proves no character was split across the boundary.
const unfolded = folded.replace(/\r\n /g, "");
check("folding is reversible without corrupting characters", unfolded.includes(`SUMMARY:${longArabic}`), true);
check("no replacement characters were introduced", /�/.test(folded), false);

const two = toIcs(lecture([
  { text: "One", dueISO: DUE },
  { text: "Two", dueISO: "2026-09-04T20:00:00.000Z" },
]));
check("one VEVENT per dated task", two.split("BEGIN:VEVENT").length - 1, 2);
check("event UIDs are distinct", new Set(two.split("\r\n").filter((l) => l.startsWith("UID:"))).size, 2);
check("a task with an unparseable date is skipped", toIcs(lecture([{ text: "x", dueISO: "next tuesday" }])), null);

console.log(failures === 0 ? "\nAll calendar checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
