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
 *   engine-red.jpg  abs-amber.jpg  green-only.jpg  multi-3lights.jpg
 *   blurry.jpg  dark.jpg  night.jpg  notdashboard-wall.jpg  unknown-lamp.jpg
 *
 * A leading word before the first dash is read as the expectation: "engine",
 * "abs" and so on are matched against the glyph; "blurry", "dark", "night",
 * "notdashboard" are expected to come back detected:false.
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

/* ------------------------------------------------------------------ the call */

async function send(label, schema, image, model, effort) {
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
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
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

const NOT_A_DASHBOARD = ["blurry", "dark", "notdashboard", "unreadable"];

function violations(r, expectation) {
  const out = [];
  if (!r.detected) {
    if (expectation && !NOT_A_DASHBOARD.includes(expectation)) {
      out.push(`expected ${expectation}, read nothing`);
    }
    if (!r.notDetectedReason) out.push("not-detected with no reason to retake");
    // The server strips these; if any survive, clampForSafety did not run.
    for (const key of ["title", "verdict", "facts"]) {
      if (key in r) out.push(`not-detected still carries ${key}`);
    }
    return out;
  }
  if (expectation && NOT_A_DASHBOARD.includes(expectation)) {
    out.push(`unreadable photo read as "${r.title}"`);
  }
  if (expectation && r.glyph && !NOT_A_DASHBOARD.includes(expectation) && r.glyph !== expectation) {
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
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
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
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort();
  if (!files.length) {
    console.log(`✗ No images in ${dir}`);
    process.exit(2);
  }
  console.log(`${files.length} photographs · model=${model} effort=${effort}\n`);

  let bad = 0;
  let tokens = 0;
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
    const summary = result.detected
      ? `${result.glyph ?? "—"} · ${result.severity} · ${result.verdictLevel} · ${result.roadside} · ${result.confidence}`
      : `not detected — ${String(result.notDetectedReason).slice(0, 60)}`;
    console.log(`${problems.length ? "✗" : "ok"} ${name.padEnd(26)} ${summary}`);
    if (result.detected) console.log(`   "${result.verdict}"`);
    for (const p of problems) console.log(`   ! ${p}`);
    if (problems.length) bad += 1;
    console.log();
  }

  console.log(
    bad
      ? `${bad} of ${files.length} photographs produced an answer that breaks the hierarchy.`
      : `All ${files.length} answers hold. ~${tokens} tokens.`,
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

  const image = fs.readFileSync(file).toString("base64");
  const stripped = strip(schema);

  console.log(`model=${model} effort=${effort} image=${path.basename(file)} (${image.length} b64 chars)`);

  const asIs = await send("the schema exactly as the route sends it", schema, image, model, effort);
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

  const without = await send("the same schema minus unsupported constraints", stripped, image, model, effort);
  console.log(
    without
      ? "\n→ The constraints are the cause. Structured outputs does not accept them;\n" +
          "  the minimum-count promise has to be enforced after parsing instead."
      : "\n→ Not the constraints. Both were rejected — read the two errors above.",
  );
})();
