/**
 * A lecture is a student's recording. Deleting one, or failing to, is the most
 * consequential thing this app does to their data — and both directions have
 * already gone wrong here in ways nothing else would have caught:
 *
 *   1. **The autosave dropped the audio.** `saveLecture` is a full replace, and
 *      the 15-second autosave in `app/record.tsx` wrote the lecture without
 *      `audioChunks`. A lecture that ended normally was fine, because `end()`
 *      puts them back — so only a force-quit showed it, leaving the .m4a files
 *      on disk with nothing pointing at them. `audioChunks` is optional on the
 *      type, so the compiler had no opinion.
 *   2. **Delete-all deleted nothing.** Mahdar's settings row called the
 *      scanner's `clearHistory()`, which drops a key Mahdar never writes.
 *
 * Both are shape problems in code that typechecks. This asserts the shape.
 *
 * Run: node scripts/check-lectures.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ts = require(path.join(ROOT, "node_modules/typescript"));

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const parse = (file) => ts.createSourceFile(file, read(file), ts.ScriptTarget.ES2020, true);

const problems = [];
const fail = (message) => problems.push(message);

/* ------------------------------------------------- the autosave keeps the audio */

/**
 * Every `saveLecture({...})` in the recording screen, as the set of property
 * names its object literal carries.
 *
 * `end()` writes the authoritative record; the autosave writes the same lecture
 * every 15 seconds. Because the write replaces rather than merges, any field
 * `end()` sets and the autosave omits is erased for the whole recording — which
 * is the bug this file exists for.
 */
function saveLectureShapes() {
  const file = "app/record.tsx";
  const sf = parse(file);
  const shapes = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "saveLecture" &&
      node.arguments.length === 1 &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      shapes.push({
        line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        keys: new Set(
          node.arguments[0].properties
            .filter((p) => p.name && ts.isIdentifier(p.name))
            .map((p) => p.name.text),
        ),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return shapes;
}

/** Fields that must survive a crash: without them the recording is unreachable
 *  or the record cannot be recovered at all. */
const MUST_PERSIST = ["id", "at", "duration", "audioChunks", "segments", "status"];

const shapes = saveLectureShapes();
if (shapes.length < 2) {
  fail(
    `app/record.tsx: expected both the autosave and end() to call saveLecture, found ${shapes.length}`,
  );
}
for (const shape of shapes) {
  for (const key of MUST_PERSIST) {
    if (!shape.keys.has(key)) {
      fail(
        `app/record.tsx:${shape.line} saveLecture omits "${key}" — the write replaces, ` +
          `so this erases it for the whole recording`,
      );
    }
  }
}

/* ------------------------------------------- removing a lecture removes all of it */

const lectures = read("src/lectures.ts");

/** The three things a lecture leaves behind. Whatever removes one must deal
 *  with all three, which is why they live in a single function. */
const REMOVAL_PARTS = [
  ["its scheduled task reminders", /cancelTaskReminders/],
  ["its audio files", /deleteRecording/],
  ["its folder on disk", /dropLectureFolder/],
  ["the record itself", /deleteLecture/],
];

const removeLecture = lectures.match(
  /export async function removeLecture[\s\S]*?\n}/,
);
if (!removeLecture) fail("src/lectures.ts has no removeLecture()");
else {
  for (const [what, re] of REMOVAL_PARTS) {
    if (!re.test(removeLecture[0])) fail(`removeLecture() does not remove ${what}`);
  }
}

const deleteAll = lectures.match(/export async function deleteAllLectures[\s\S]*?\n}/);
if (!deleteAll) fail("src/lectures.ts has no deleteAllLectures()");
else {
  if (!/cancelTaskReminders/.test(deleteAll[0]))
    fail("deleteAllLectures() does not cancel scheduled task reminders");
  if (!/deleteRecording/.test(deleteAll[0]))
    fail("deleteAllLectures() does not delete the audio files");
  if (!/"lectures"/.test(deleteAll[0]))
    fail("deleteAllLectures() does not delete the lectures directory");
  // The free-tier counter is a lifetime count. Resetting it on delete would
  // make record → read → delete → repeat an unlimited free tier.
  if (/COUNT_KEY/.test(deleteAll[0]))
    fail("deleteAllLectures() touches the lifetime lecture counter — it must not");
}

/* ------------------------------- no screen deletes a lecture the long way round */

/** Screens must go through removeLecture, or one of them will forget a part. */
for (const file of ["app/lecture.tsx", "app/(tabs)/lectures.tsx"]) {
  const src = read(file);
  if (/\bdeleteLecture\s*\(/.test(src)) {
    fail(`${file} calls deleteLecture directly — use removeLecture so nothing is left behind`);
  }
}

/* ------------------------------ the destructive row matches the kind of app it is */

const settings = read("app/(tabs)/settings.tsx");
if (!/isAudio\(pack\)\s*\?[\s\S]{0,120}?ui\.clearLectures/.test(settings)) {
  fail(
    "app/(tabs)/settings.tsx: the destructive row has no isAudio branch — an audio pack " +
      "falls through to the scanner's 'delete all scans', which clears a key it never writes",
  );
}

/* --------------------------------------------------------------------- report */

console.log(`${shapes.length} saveLecture call sites, ${REMOVAL_PARTS.length} removal parts`);

if (problems.length) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} problems.`);
  process.exit(1);
}
console.log("A lecture keeps its audio while it lives, and takes all of it when it goes.");
