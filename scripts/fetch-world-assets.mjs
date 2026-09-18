#!/usr/bin/env node
/**
 * Downloads the world's generated art into `public/world/sprites/`.
 *
 * The assets were generated with Higgsfield Soul 2.0 and live on Higgsfield's
 * CDN. This session's network policy blocks that CDN outright, so the files
 * cannot be committed from here — run this once from a machine that can reach
 * it and commit what lands, and the world switches from the single flat render
 * to the composed scene on its own.
 *
 *   node scripts/fetch-world-assets.mjs
 *
 * It is safe to re-run: an existing, valid file is left alone unless --force.
 * Nothing about the page depends on it having been run — without the files the
 * world renders the flat fallback, which is why this is a script and not a
 * build step.
 */

import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "world", "sprites");
const force = process.argv.includes("--force");

/* The manifest is the single source of truth; it is read out of the TypeScript
   module rather than duplicated here, so the two can never drift apart. */
const src = await import("node:fs").then((fs) =>
  fs.readFileSync(join(root, "app", "world", "sprites.ts"), "utf8"),
);

const assets = [];
const re = /file:\s*"([^"]+)",\s*\n\s*source:\s*\n?\s*"([^"]+)"/g;
for (const m of src.matchAll(re)) assets.push({ file: m[1], source: m[2] });

if (!assets.length) {
  console.error("✗ No assets found in app/world/sprites.ts — has the format changed?");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
let written = 0;
let skipped = 0;
let failed = 0;

for (const { file, source } of assets) {
  const dest = join(outDir, file);
  if (!force && existsSync(dest) && statSync(dest).size > 1024) {
    console.log(`  · ${file} — already here`);
    skipped += 1;
    continue;
  }
  try {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // A CDN that has expired a link tends to answer 200 with an error page;
    // writing that as a .png would fail silently in the browser instead.
    if (!buf.subarray(0, 4).equals(PNG_MAGIC)) {
      throw new Error(`not a PNG (${buf.length} bytes)`);
    }
    writeFileSync(dest, buf);
    console.log(`  ✓ ${file} — ${(buf.length / 1024).toFixed(0)} KB`);
    written += 1;
  } catch (err) {
    console.error(`  ✗ ${file} — ${err.message}`);
    failed += 1;
  }
}

const manifest = {
  generatedWith: "Higgsfield Soul 2.0 (text2image_soul_v2)",
  fetchedAt: new Date().toISOString(),
  files: assets.map((a) => a.file),
};

if (failed === 0) {
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\n✓ ${written} downloaded, ${skipped} already present — wrote manifest.json`);
  console.log("  The world will now render the composed scene.");
} else {
  console.error(
    `\n✗ ${failed} failed — manifest.json not written, so the world keeps the flat fallback.`,
  );
  process.exitCode = 1;
}
