/**
 * What the scan route will not tell you.
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
 *   node scripts/probe-scan.js <path-to-jpeg>
 *
 * Needs ANTHROPIC_API_KEY in the environment (`set -a; source .env; set +a`).
 * Costs one scan, twice at worst.
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

/* ---------------------------------------------------------------------- main */

(async () => {
  const file = process.argv[2];
  if (!file) {
    console.log("usage: node scripts/probe-scan.js <path-to-jpeg>");
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

  const image = fs.readFileSync(file).toString("base64");
  const model = readConst("MODEL", "claude-opus-5");
  const effort = readConst("EFFORT", "high");
  const schema = resultSchema();
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
