/**
 * Slices the Dash Light design into one PNG per element.
 *
 * The design lives in Canva, where every piece is a separate element with a
 * known box. This session cannot reach Canva's asset or export hosts — the
 * egress policy refuses media.canva.com and export-download.canva.com — so the
 * page render has to be fetched by hand and dropped next to this script. Once
 * it is here, this cuts every part out at whatever resolution that render has.
 *
 *   node scripts/slice-design.js <page.png> [outDir]
 *
 * The page is 711x1536 design units; boxes below are in those units and are
 * scaled to whatever the supplied image actually is, so a 4x export slices at
 * 4x with no edits here.
 *
 * Cropping runs through the headless browser rather than a decoder of our own:
 * the exports are palette PNGs, and writing a second image decoder to read
 * them would be a worse bet than the one already installed for visual QA.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const PAGE_W = 711;
const PAGE_H = 1536;

/** name, left, top, width, height — straight from the design's own elements. */
const PARTS = [
  ["scene", 0, 83, 711, 736],
  ["close", 32, 116, 33, 35],
  ["card-critical", 48, 333, 211, 235],
  ["card-warning", 258, 333, 195, 235],
  ["card-info", 452, 333, 211, 235],
  ["grade-ok", 96, 384, 115, 84],
  ["grade-caution", 307, 384, 97, 84],
  ["grade-stop", 500, 384, 115, 101],
  ["card-benefits", 32, 567, 647, 235],
  ["benefit-steps", 80, 634, 50, 51],
  ["benefit-cost", 193, 617, 66, 68],
  ["benefit-guide", 323, 634, 65, 51],
  ["benefit-car", 452, 634, 66, 51],
  ["benefit-seconds", 581, 617, 66, 68],
  ["card-plan-weekly", 32, 801, 647, 118],
  ["card-plan-annual", 32, 918, 647, 134],
  ["radio-off", 597, 834, 66, 51],
  ["radio-on", 597, 968, 66, 51],
  ["badge-best", 48, 901, 82, 51],
  ["card-trial", 32, 1051, 647, 118],
];

(async () => {
  const src = process.argv[2];
  const outDir = process.argv[3] || path.join(__dirname, "..", "assets", "dashlight");
  if (!src || !fs.existsSync(src)) {
    console.error("usage: node scripts/slice-design.js <page.png> [outDir]");
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const b64 = fs.readFileSync(src).toString("base64");

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium",
  });
  const page = await browser.newPage();
  const size = await page.evaluate(
    (data) =>
      new Promise((done) => {
        const img = new Image();
        img.onload = () => done({ w: img.naturalWidth, h: img.naturalHeight });
        img.src = "data:image/png;base64," + data;
      }),
    b64,
  );
  const scale = size.w / PAGE_W;
  console.log(`page ${size.w}x${size.h} — ${scale.toFixed(2)}x the design's ${PAGE_W}x${PAGE_H}`);

  for (const [name, l, t, w, h] of PARTS) {
    const cw = Math.round(w * scale);
    const ch = Math.round(h * scale);
    await page.setViewportSize({ width: cw, height: ch });
    await page.setContent(
      `<body style="margin:0;overflow:hidden"><img src="data:image/png;base64,${b64}"
        style="position:absolute;left:${-l * scale}px;top:${-t * scale}px;width:${size.w}px"></body>`,
    );
    await page.screenshot({ path: path.join(outDir, `${name}.png`), clip: { x: 0, y: 0, width: cw, height: ch } });
    console.log(`  ${name}.png  ${cw}x${ch}`);
  }
  await browser.close();
  console.log(`\n${PARTS.length} parts -> ${outDir}`);
})();
