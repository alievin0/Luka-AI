/**
 * The scan contract, asserted rather than assumed.
 *
 * Two kinds of drift have already happened in this repo, and neither shows up
 * in a typecheck or on any screen until a real scan comes back:
 *
 *   1. **The result screen renders a field the schema does not require.** Six
 *      of them did, including the two the prompt calls REQUIRED in prose. A
 *      missing one raises nothing — the card just is not there, and the driver
 *      never learns what they were not told.
 *   2. **The glyph list drifts.** The pictogram a result shows is chosen from
 *      an enum in the route, drawn from files in `assets/symbols/`, indexed by
 *      `src/symbols.ts`, and offered to the model as a list inside the prompt.
 *      Four copies of one set. If any of them disagrees, the model picks a
 *      name nothing can draw and the result renders with no symbol at all.
 *
 * Run: node scripts/check-schema.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ts = require(path.join(ROOT, "node_modules/typescript"));

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const parse = (file) =>
  ts.createSourceFile(file, read(file), ts.ScriptTarget.ES2020, true);

const problems = [];
const fail = (message) => problems.push(message);

/* ------------------------------------------------------- the result schema */

/** Pull `RESULT_SCHEMA` out of the route by evaluating just that declaration.
 *  Reading it as data beats regexing it, and it cannot drift from the real
 *  object because it *is* the real object. */
function resultSchema() {
  const file = "app/api/scan+api.ts";
  const sf = parse(file);
  let text = null;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "RESULT_SCHEMA" &&
      node.initializer
    ) {
      // Strip the trailing `as const`, which is not JavaScript.
      const init = ts.isAsExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      text = init.getText(sf);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!text) throw new Error(`RESULT_SCHEMA not found in ${file}`);
  // eslint-disable-next-line no-new-func
  return new Function(`return (${text});`)();
}

const schema = resultSchema();
const required = new Set(schema.required);

/**
 * Fields the result screen reads off a reading, found by walking the source
 * for `result.<name>` rather than listing them by hand — a list would go stale
 * the first time someone adds a card.
 */
function renderedFields() {
  const file = "app/result.tsx";
  const sf = parse(file);
  const names = new Set();
  const visit = (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "result"
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

/** Read on the not-detected path, so not part of a reading's contract. */
const UNREAD_ONLY = new Set(["detected", "notDetectedReason"]);

/**
 * Optional on purpose, and why.
 *
 * The point of this check is that nothing is optional *by accident*. A field
 * that genuinely may be absent belongs here with its reason, so the next
 * person to add one has to say what it is rather than leave the silence.
 */
const OPTIONAL_ON_PURPOSE = {
  glyph:
    "not every light has a pictogram in the set, and the prompt would rather " +
    "show none than show the wrong one beside a correct answer",
  alsoDetected: "most photos have exactly one lit symbol",
};

for (const name of renderedFields()) {
  if (UNREAD_ONLY.has(name)) continue;
  if (name in OPTIONAL_ON_PURPOSE) {
    if (required.has(name)) {
      fail(
        `RESULT_SCHEMA requires ${name}, which check-schema.js records as optional ` +
          `on purpose (${OPTIONAL_ON_PURPOSE[name]}) — one of the two is out of date`,
      );
    }
    continue;
  }
  if (!(name in schema.properties)) {
    fail(`app/result.tsx renders result.${name}, which RESULT_SCHEMA does not define`);
  } else if (!required.has(name)) {
    fail(
      `app/result.tsx renders result.${name}, but RESULT_SCHEMA does not require it — ` +
        `a response without it drops that card silently`,
    );
  }
}

/** Lists the prompt asks for by count. An array that is required but empty
 *  still satisfies the schema, and an empty one deletes a whole tab. */
for (const name of ["facts", "causes", "actions", "seekHelpIf"]) {
  const field = schema.properties[name];
  if (!field) fail(`RESULT_SCHEMA has no ${name}`);
  else if (!(field.minItems > 0)) fail(`RESULT_SCHEMA.${name} has no minItems — [] would pass`);
}

/* ------------------------------------------------------------ the glyph set */

const fromFiles = new Set(
  fs
    .readdirSync(path.join(ROOT, "assets/symbols"))
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.slice(0, -4)),
);

const fromEnum = new Set(schema.properties.glyph.enum);

const fromIndex = new Set(
  [...read("src/symbols.ts").matchAll(/"([a-z0-9-]+)":\s*require\(/g)].map((m) => m[1]),
);

/** The prompt offers the model a comma-separated line of names. */
const fromPrompt = (() => {
  const src = read("src/packs/dashlight.ts");
  const line = src
    .split("\n")
    .find((l) => /^abs, airbag,/.test(l.trim()));
  if (!line) return null;
  return new Set(line.trim().split(/,\s*/));
})();

const compare = (aName, a, bName, b) => {
  const onlyA = [...a].filter((x) => !b.has(x));
  const onlyB = [...b].filter((x) => !a.has(x));
  if (onlyA.length) fail(`glyphs in ${aName} but not ${bName}: ${onlyA.join(", ")}`);
  if (onlyB.length) fail(`glyphs in ${bName} but not ${aName}: ${onlyB.join(", ")}`);
};

compare("assets/symbols", fromFiles, "src/symbols.ts", fromIndex);
compare("assets/symbols", fromFiles, "the scan schema enum", fromEnum);
if (!fromPrompt) fail("could not find the glyph list inside the Dash Light prompt");
else compare("assets/symbols", fromFiles, "the Dash Light prompt", fromPrompt);

/* --------------------------------------------------- every entry can be drawn */

const libraryGlyphs = new Set(
  [...read("src/packs/dashlight-library.ts").matchAll(/glyph:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]),
);
const undrawable = [...libraryGlyphs].filter((g) => !fromFiles.has(g));
if (undrawable.length) {
  fail(`light guide entries name glyphs with no artwork: ${undrawable.join(", ")}`);
}

/* --------------------------------------------------------------------- report */

console.log(`${required.size} required fields, ${fromFiles.size} glyphs, ${libraryGlyphs.size} used by the guide`);

if (problems.length) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n${problems.length} problems.`);
  process.exit(1);
}
console.log("The scan contract holds: nothing rendered is optional, and one glyph set throughout.");
