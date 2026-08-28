/**
 * What the scan route will not tell you, over a folder of real photographs.
 *
 * `app/api/scan+api.ts` maps every `Anthropic.APIError` to one sentence —
 * "Something went wrong during analysis" — which is right for a driver and
 * useless for finding out why. This sends the same request the route sends,
 * with the same schema, and prints what actually came back.
 *
 * It then re-sends without the parts of the schema that structured outputs
 * documents as unsupported, so a single run says whether the schema is the
 * problem rather than leaving you to guess.
 *
 *   node scripts/probe-scan.js <jpeg>              one photo, verbose
 *   node scripts/probe-scan.js --matrix <folder>   every photo, as a table
 *
 * `--matrix` is the one that matters. Nothing in this app has ever been run
 * against a real dashboard, and a schema that parses is not an answer that is
 * true. It sends every image in the folder, prints what came back beside what
 * the filename claims the photo is, and flags results that break the decision
 * hierarchy — a critical light that came back "ok", a not-detected answer that
 * still carries a reading, a lamp named outside the 43 the app can draw.
 *
 * Name the files after what they are and it will check the claim for you:
 *
 *   normal reading   engine-1.jpg  abs-2.jpg  battery-3.jpg
 *   by colour        red-1.jpg  amber-2.jpg  green-3.jpg  blue-4.jpg
 *   hard conditions  night-1.jpg  glare-2.jpg  reflection-3.jpg
 *                    blurry-4.jpg  far-5.jpg  obscured-6.jpg  dark-7.jpg
 *   logical cases    multi-1.jpg  nowarning-2.jpg  notdashboard-3.jpg
 *                    unknown-4.jpg
 *
 * The word before the first dash is the expectation.
 *   a glyph name   ("engine", "abs")  must come back as that glyph
 *   a colour       ("red", "amber")   must come back at that severity —
 *                                     a green light graded as a warning is as
 *                                     wrong as a red one missed
 *   "night"        is a condition, not an excuse: it must still read
 *   "blurry" "dark" "glare" "reflection" "far" "obscured" "notdashboard"
 *                                     must come back detected:false
 *   "nowarning"    an unlit dashboard — must not invent a lamp
 *   "multi"        must populate alsoDetected
 *   "unknown"      a symbol outside the 43 — must leave glyph unset rather
 *                                     than forcing the nearest match
 *
 * Needs ANTHROPIC_API_KEY in the environment (`set -a; source .env; set +a`).
 * Costs one scan per image, about 4 cents each.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ts = require(path.join(ROOT, "node_modules/typescript"));

/* ------------------------------------- the same schema the route really sends */

/** Evaluate the RESULT_SCHEMA declaration out of the route, so this cannot
 *  drift from it — the same trick check-schema.js uses. */
function resultSchema() {
  const file = "app/api/scan+api.ts";
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2020, true);
  let text = null;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "RESULT_SCHEMA" &&
      node.initializer
    ) {
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

const readConst = (name, fallback) => {
  const src = fs.readFileSync(path.join(ROOT, "app/api/scan+api.ts"), "utf8");
  const m = src.match(new RegExp(`const ${name} = process\\.env\\.\\w+ \\|\\| "([^"]+)"`));
  return m ? m[1] : fallback;
};

/**
 * Constraints structured outputs lists as unsupported: numerical bounds,
 * string lengths, and array constraints. Stripped from a copy so the second
 * attempt isolates them as the cause.
 */
const UNSUPPORTED = [
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "multipleOf",
  "pattern",
];

function strip(node) {
  if (Array.isArray(node)) return node.map(strip);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED.includes(key)) continue;
    out[key] = strip(value);
  }
  return out;
}

/* ------------------------------------------------------------------ the file

   The API accepts four image types and rejects anything else. Sending a PNG
   labelled image/jpeg is a 400 that reads as a schema problem, which is
   exactly the confusion this script exists to remove. iPhones shoot HEIC by
   default and the API does not take it at all, so that gets its own answer
   rather than a silent skip. */

const MEDIA = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };

const READABLE = /\.(jpe?g|png|gif|webp)$/i;
const HEIC = /\.(heic|heif)$/i;

function mediaTypeOf(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return MEDIA[ext] || null;
}

/** What to say when a folder holds photographs the API cannot read. macOS
 *  ships `sips`, so the fix is one line the user already has. */
function heicAdvice(dir, names) {
  console.log(
    `\n✗ ${names.length} photo${names.length === 1 ? "" : "s"} in HEIC — the format iPhones shoot by\n` +
      `  default. The API does not accept it. Convert them in place:\n\n` +
      `    cd ${dir}\n` +
      `    for f in *.[Hh][Ee][Ii][Cc]; do sips -s format jpeg "$f" --out "\${f%.*}.jpg"; done\n` +
      `    rm *.[Hh][Ee][Ii][Cc]\n\n` +
      `  Or turn it off at the source: Settings → Camera → Formats → Most Compatible.\n`,
  );
}

/* ------------------------------------------------------------------ the call */

async function send(label, schema, image, mediaType, model, effort) {
  console.log(`\n── ${label} ─────────────────────────────────────`);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system: "Answer with the JSON the schema describes.",
      output_config: { effort, format: { type: "json_schema", schema } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: "Analyse this photo." },
          ],
        },
      ],
    }),
  });

  const text = await response.text();
  console.log(`HTTP ${response.status}`);
  if (response.ok) {
    let usage;
    try {
      usage = JSON.parse(text).usage;
    } catch {}
    console.log(usage ? `in=${usage.input_tokens} out=${usage.output_tokens}` : text.slice(0, 400));
    console.log("✓ accepted");
    return true;
  }
  console.log(text.slice(0, 1200));
  return false;
}

/* ------------------------------------------------------ the decision hierarchy

   The order the app enforces on screen, checked here against what actually
   came back. A schema that parses proves the shape; these prove the answer.

     1. the photo is readable        detected
     2. the lamp is identified       title, glyph
     3. severity                     critical | warning | info
     4. the driving decision         verdictLevel
     5. movement                     roadside
     6. everything else              causes, cost, context

   A result that skips a step is a bug in the answer, not in the rendering, and
   the app cannot fix it after the fact — clampForSafety catches two of these
   and nothing catches the rest.                                              */

/** Filenames whose leading word says the photo should defeat the reader. */
const UNREADABLE = ["blurry", "dark", "glare", "reflection", "far", "obscured", "notdashboard", "unreadable"];

/** Filenames that name a colour rather than a lamp: the expectation is the
 *  severity band, not a glyph. Green and blue lights are information, and a
 *  reader that grades them as warnings is as wrong as one that misses a red. */
const COLOUR_SEVERITY = { red: "critical", amber: "warning", green: "info", blue: "info" };

/** A dashboard with nothing lit is the quietest failure available: it invites
 *  the model to find a lamp that is not there. */
const NO_WARNING = ["nowarning", "clean", "unlit"];

function violations(r, expectation) {
  const out = [];
  const shouldFail = UNREADABLE.includes(expectation) || NO_WARNING.includes(expectation);
  if (!r.detected) {
    if (expectation && !shouldFail) out.push(`expected ${expectation}, read nothing`);
    if (!r.notDetectedReason) out.push("not-detected with no reason to retake");
    // The server strips these; if any survive, clampForSafety did not run.
    for (const key of ["title", "verdict", "facts"]) {
      if (key in r) out.push(`not-detected still carries ${key}`);
    }
    return out;
  }
  if (UNREADABLE.includes(expectation)) out.push(`unreadable photo read as "${r.title}"`);
  if (NO_WARNING.includes(expectation)) out.push(`invented a lamp on an unlit dashboard: "${r.title}"`);
  if (COLOUR_SEVERITY[expectation] && r.severity !== COLOUR_SEVERITY[expectation]) {
    out.push(`a ${expectation} light graded ${r.severity}, expected ${COLOUR_SEVERITY[expectation]}`);
  }
  if (expectation === "unknown" && r.glyph) {
    out.push(`a symbol outside the 43 was matched to "${r.glyph}"`);
  }
  if (expectation === "multi" && !(r.alsoDetected || []).length) {
    out.push("several lamps lit, only one reported");
  }
  if (
    expectation &&
    r.glyph &&
    !shouldFail &&
    !COLOUR_SEVERITY[expectation] &&
    !["unknown", "multi"].includes(expectation) &&
    r.glyph !== expectation
  ) {
    out.push(`expected glyph ${expectation}, got ${r.glyph}`);
  }
  if (r.glyph && !GLYPHS.includes(r.glyph)) out.push(`glyph "${r.glyph}" is not one the app can draw`);
  if (r.severity === "critical" && r.verdictLevel === "ok") out.push("critical but verdictLevel ok");
  if (r.confidence === "low" && r.verdictLevel === "ok") out.push("low confidence but verdictLevel ok");
  if (r.severity === "critical" && ["drive-with-care", "monitor"].includes(r.roadside)) {
    out.push(`critical but roadside ${r.roadside}`);
  }
  if (!r.roadside) out.push("no roadside decision");
  if (/\bsafe\b|بأمان/i.test(r.verdict || "")) out.push(`verdict claims the car is safe: "${r.verdict}"`);
  if (!r.ifIgnored) out.push("no consequence for ignoring it");
  return out;
}

/** The glyphs the app ships artwork for, read out of the route's own enum. */
const GLYPHS = (() => {
  const schema = resultSchema();
  return schema.properties?.glyph?.enum ?? [];
})();

/* ---------------------------------------------------------------- the matrix */

async function one(file, schema, model, effort) {
  const image = fs.readFileSync(file).toString("base64");
  const mediaType = mediaTypeOf(file);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort, format: { type: "json_schema", schema } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: "Analyse this photo." },
          ],
        },
      ],
    }),
  });
  const text = await response.text();
  if (!response.ok) return { error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
  const body = JSON.parse(text);
  const content = body.content?.find((c) => c.type === "text")?.text ?? "{}";
  return { result: JSON.parse(content), usage: body.usage };
}

/** The pack's real system prompt, so this tests what ships. */
const SYSTEM = (() => {
  const src = fs.readFileSync(path.join(ROOT, "src/packs/dashlight.ts"), "utf8");
  const m = src.match(/systemPrompt: \(\{[^}]*\}\) => `([\s\S]*?)`,\n/);
  if (!m) throw new Error("systemPrompt not found in src/packs/dashlight.ts");
  return m[1]
    .replace(/\$\{currency\}/g, "KWD")
    .replace(/\$\{profile \|\| "unknown"\}/g, "Toyota Camry 2021, petrol")
    .replace(/\$\{locale === "ar" \? ([\s\S]*?) : ([\s\S]*?)\}/g, (_, ar) => ar);
})();

async function matrix(dir, schema, model, effort) {
  const entries = fs.readdirSync(dir);
  const files = entries.filter((f) => READABLE.test(f)).sort();
  const heic = entries.filter((f) => HEIC.test(f));

  // Named before the count, because a folder of twenty HEIC photographs is
  // not an empty folder and saying so would send you looking in the wrong
  // place.
  if (heic.length) heicAdvice(dir, heic);
  if (!files.length) {
    if (!heic.length) console.log(`✗ No images in ${dir}`);
    process.exit(2);
  }
  console.log(`${files.length} photograph${files.length === 1 ? "" : "s"} · model=${model} effort=${effort}\n`);

  let bad = 0;
  let tokens = 0;
  const tally = {
    namedRight: 0, namedTotal: 0,
    falseOk: 0,
    refusedRight: 0, refusedTotal: 0,
    multiRight: 0, multiTotal: 0,
    unknownRight: 0, unknownTotal: 0,
  };
  for (const name of files) {
    const expectation = name.split(/[-.]/)[0].toLowerCase();
    const { result, usage, error } = await one(path.join(dir, name), schema, model, effort);
    if (error) {
      console.log(`✗ ${name}\n   ${error}\n`);
      // A rejected key rejects every image. Carrying on would print the same
      // line twenty times and, with a key that is merely out of credit rather
      // than wrong, spend twenty requests finding that out.
      if (/HTTP 40[13]/.test(error)) {
        console.log("Stopping: that is an authentication problem, not a photograph problem.");
        process.exit(2);
      }
      bad += 1;
      continue;
    }
    tokens += (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
    const problems = violations(result, expectation);

    // The five figures worth reading afterwards, counted per photograph rather
    // than inferred from the failure list — a photo can be counted right on
    // recognition and wrong on grading.
    if (UNREADABLE.includes(expectation) || NO_WARNING.includes(expectation)) {
      tally.refusedTotal += 1;
      if (!result.detected) tally.refusedRight += 1;
    } else if (expectation === "multi") {
      tally.multiTotal += 1;
      if ((result.alsoDetected || []).length) tally.multiRight += 1;
    } else if (expectation === "unknown") {
      tally.unknownTotal += 1;
      if (!result.glyph) tally.unknownRight += 1;
    } else if (COLOUR_SEVERITY[expectation]) {
      tally.namedTotal += 1;
      if (result.severity === COLOUR_SEVERITY[expectation]) tally.namedRight += 1;
    } else if (expectation) {
      tally.namedTotal += 1;
      if (result.glyph === expectation) tally.namedRight += 1;
    }
    if (result.detected && result.verdictLevel === "ok" && (result.severity === "critical" || result.confidence === "low")) {
      tally.falseOk += 1;
    }
    const summary = result.detected
      ? `${result.glyph ?? "—"} · ${result.severity} · ${result.verdictLevel} · ${result.roadside} · ${result.confidence}`
      : `not detected — ${String(result.notDetectedReason).slice(0, 60)}`;
    console.log(`${problems.length ? "✗" : "ok"} ${name.padEnd(26)} ${summary}`);
    if (result.detected) console.log(`   "${result.verdict}"`);
    for (const p of problems) console.log(`   ! ${p}`);
    if (problems.length) bad += 1;
    console.log();
  }

  const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "—");
  console.log("─".repeat(60));
  console.log(`recognition           ${pct(tally.namedRight, tally.namedTotal)}  (${tally.namedRight}/${tally.namedTotal} lamps named as expected)`);
  console.log(`false "ok"            ${pct(tally.falseOk, files.length)}  (${tally.falseOk} reassured when they should not have)`);
  console.log(`bad-image fallback    ${pct(tally.refusedRight, tally.refusedTotal)}  (${tally.refusedRight}/${tally.refusedTotal} unreadable photos refused)`);
  console.log(`multi-light           ${pct(tally.multiRight, tally.multiTotal)}  (${tally.multiRight}/${tally.multiTotal} reported the other lamps)`);
  console.log(`unknown symbols       ${pct(tally.unknownRight, tally.unknownTotal)}  (${tally.unknownTotal ? "left unmatched rather than forced" : "none tested"})`);
  console.log("─".repeat(60));
  console.log(
    bad
      ? `\n${bad} of ${files.length} photographs produced an answer that breaks the hierarchy.`
      : `\nAll ${files.length} answers hold. ~${tokens} tokens.`,
  );
  process.exit(bad ? 1 : 0);
}

/* ---------------------------------------------------------------------- main */

(async () => {
  const args = process.argv.slice(2);
  const isMatrix = args[0] === "--matrix";
  const file = isMatrix ? args[1] : args[0];
  if (!file) {
    console.log(
      "usage: node scripts/probe-scan.js <jpeg>\n" +
        "       node scripts/probe-scan.js --matrix <folder-of-real-dashboards>",
    );
    process.exit(2);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("✗ ANTHROPIC_API_KEY is not set.\n\n   set -a; source .env; set +a");
    process.exit(2);
  }
  if (!fs.existsSync(file)) {
    console.log(`✗ No such file: ${file}`);
    process.exit(2);
  }

  const model = readConst("MODEL", "claude-opus-5");
  const effort = readConst("EFFORT", "high");
  const schema = resultSchema();
  if (isMatrix) return matrix(file, schema, model, effort);

  if (HEIC.test(file)) {
    heicAdvice(path.dirname(file), [path.basename(file)]);
    process.exit(2);
  }
  const mediaType = mediaTypeOf(file);
  if (!mediaType) {
    console.log(`✗ ${path.extname(file) || "that"} is not an image type the API reads. Use jpg, png, gif or webp.`);
    process.exit(2);
  }
  const image = fs.readFileSync(file).toString("base64");
  const stripped = strip(schema);

  console.log(`model=${model} effort=${effort} image=${path.basename(file)} (${image.length} b64 chars)`);

  const asIs = await send("the schema exactly as the route sends it", schema, image, mediaType, model, effort);
  if (asIs) {
    console.log(
      "\nThe schema is fine. Whatever the route hit is elsewhere — the image, " +
        "the prompt, or the deployment's own environment.",
    );
    return;
  }

  const removed = JSON.stringify(schema) === JSON.stringify(stripped) ? [] : UNSUPPORTED;
  if (!removed.length) {
    console.log("\nNothing unsupported to strip — the rejection is something else. Read the error above.");
    return;
  }

  const without = await send("the same schema minus unsupported constraints", stripped, image, mediaType, model, effort);
  console.log(
    without
      ? "\n→ The constraints are the cause. Structured outputs does not accept them;\n" +
          "  the minimum-count promise has to be enforced after parsing instead."
      : "\n→ Not the constraints. Both were rejected — read the two errors above.",
  );
})();
