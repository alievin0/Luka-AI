/**
 * Cuts the 41 guide symbols out of the OEM Icon Master Set.
 *
 * The design (Canva DAHTe_FF9Yc) draws every warning light as its own element
 * with a known box, so this crops by that box rather than by anything guessed
 * off a screenshot. As with slice-design.js, the render has to be fetched by
 * hand — this session's egress policy refuses media.canva.com and
 * export-download.canva.com, and the export URL is signed for the latter, so
 * it cannot be re-pointed at the S3 host that is reachable.
 *
 *   node scripts/slice-symbols.js <dir-of-page-pngs> [outDir]
 *
 * The directory holds page-2.png ... page-7.png at any resolution; boxes are in
 * the design's own 374x794 units and scale to whatever was exported, so a 3x
 * export slices at 3x with no edits here.
 *
 * The artwork is coloured line art on white and the app needs a white mask it
 * can tint per severity, so each crop is keyed rather than merely cropped:
 * alpha comes from how far a pixel sits from the white ground, normalised so
 * the core of a stroke is fully opaque, and every surviving pixel is written
 * white. A plain "white becomes transparent" cut would leave pale fringes on
 * #0C0E13; this does not. It also means a white counter inside a shape stays a
 * hole, which is what it is.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const PAGE_W = 374;
const SIZE = 128;
/** Content spans this much of the box, matching make-symbols.py's pen scale. */
const INK = 104;
/** Ground noise below this is the card, not the drawing. */
const FLOOR = 0.06;

/**
 * key, page, left, top, width, height — straight from the design's elements.
 * A null key is a light the library has no entry for yet; it is still cut, into
 * _extra/, because the boxes were expensive to gather and those are the
 * candidates for new entries.
 */
const PARTS = [
  ["high-beam",   null, 2, 42.25, 137.94, 128.03, 86.41],
  [null,     "low-beam",       2, 50.89, 267.23, 119.39, 86.73],
  [null,     "front-fog",      2, 50.89, 396.85, 110.75, 86.41],
  ["rear-fog",    null, 2, 59.21, 526.15, 85.46, 86.41],
  [null,     "turn-signals",   2, 33.93, 672.73, 144.68, 60.81],

  ["door-ajar",   null, 3, 50.89, 129.30, 110.75, 103.69],
  [null,     "hood-open",      3, 42.25, 284.52, 128.03, 60.81],
  [null,     "trunk-open",     3, 33.93, 405.17, 136.35, 69.45],
  ["key",         null, 3, 50.89, 526.15, 119.39, 86.41],
  [null,     "key-battery",    3, 50.89, 646.80, 136.35, 95.37],

  [null,     "lane-departure", 4, 59.21, 137.94, 85.46, 86.41],
  [null,     "blind-spot",     4, 229.50, 129.30, 85.46, 95.05],
  ["radar-car",   null, 4, 42.25, 310.44, 119.39, 78.09],
  ["cruise",      null, 4, 229.50, 301.80, 85.46, 86.73],
  [null,     "adaptive-cruise", 4, 67.86, 457.02, 68.50, 95.37],
  [null,     "parking-sensors", 4, 212.53, 465.66, 119.39, 86.73],
  [null,     "lane-keep",      4, 127.39, 629.52, 111.07, 86.73],

  ["skid-car",    null, 5, 67.86, 129.30, 68.50, 69.13],
  ["steering",    null, 5, 229.50, 129.30, 85.46, 69.13],
  ["engine",      null, 5, 59.21, 267.23, 85.46, 60.81],
  ["battery",     null, 5, 229.50, 267.23, 85.46, 60.81],
  ["tyre",        null, 5, 59.21, 396.85, 77.14, 69.13],
  [null,     "transmission",   5, 229.50, 388.21, 76.82, 77.77],
  ["epb",         null, 5, 50.89, 526.15, 93.78, 69.13],
  [null,     "fuel-level",     5, 237.82, 526.15, 68.50, 69.13],
  ["washer",      null, 5, 59.21, 655.44, 85.46, 69.45],
  ["fuel-pump",   null, 5, 237.82, 655.44, 68.50, 69.45],

  ["oil-can",     null, 6, 25.29, 181.14, 93.78, 43.21],
  ["glow-plug",   null, 6, 144.36, 163.86, 85.46, 69.13],
  ["dpf",         null, 6, 255.10, 172.50, 93.78, 60.49],
  ["droplet",     null, 6, 25.29, 388.21, 85.46, 95.05],
  ["hybrid",      null, 6, 144.36, 405.17, 85.46, 60.81],
  ["ev-fault",    null, 6, 255.10, 388.21, 93.78, 86.41],
  ["regen",       null, 6, 33.93, 603.60, 76.82, 69.45],
  ["spanner",     null, 6, 153.00, 603.60, 68.18, 78.09],
  ["snowflake",   null, 6, 263.43, 603.60, 68.50, 78.09],

  ["abs",         null, 7, 280.39, 189.78, 68.50, 51.85],
  ["airbag",      null, 7, 42.25, 327.72, 51.53, 60.81],
  ["ev-ready",    null, 7, 246.46, 336.36, 68.50, 43.53],
];

const load = (file) => fs.readFileSync(file).toString("base64");

(async () => {
  const srcDir = process.argv[2];
  const outDir = process.argv[3] || path.join(__dirname, "..", "assets", "symbols");
  if (!srcDir || !fs.existsSync(srcDir)) {
    console.error("usage: node scripts/slice-symbols.js <dir-of-page-pngs> [outDir]");
    process.exit(1);
  }
  const extraDir = path.join(outDir, "_extra");
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(extraDir, { recursive: true });

  const pages = {};
  for (const n of [2, 3, 4, 5, 6, 7]) {
    const f = path.join(srcDir, `page-${n}.png`);
    if (fs.existsSync(f)) pages[n] = load(f);
  }
  const missingPages = [2, 3, 4, 5, 6, 7].filter((n) => !pages[n]);
  if (missingPages.length) console.warn(`missing page-${missingPages.join(".png, page-")}.png — those rows are skipped`);

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium",
  });
  const page = await browser.newPage();
  await page.setContent("<body></body>");

  let done = 0;
  for (const [key, label, pageNo, l, t, w, h] of PARTS) {
    if (!pages[pageNo]) continue;
    const name = key ?? label;
    const png = await page.evaluate(
      async ({ data, l, t, w, h, PAGE_W, SIZE, INK, FLOOR }) => {
        const img = new Image();
        await new Promise((r) => { img.onload = r; img.src = "data:image/png;base64," + data; });
        const scale = img.naturalWidth / PAGE_W;

        // Lift the box out at the render's own resolution.
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const cut = document.createElement("canvas");
        cut.width = cw; cut.height = ch;
        const cx = cut.getContext("2d", { willReadFrequently: true });
        cx.drawImage(img, -Math.round(l * scale), -Math.round(t * scale));
        const px = cx.getImageData(0, 0, cw, ch);
        const d = px.data;

        // How far each pixel sits from the white ground, then normalised so the
        // core of a stroke reads as solid rather than as whatever its hue
        // happens to leave in its darkest channel.
        const dist = new Float32Array(cw * ch);
        let peak = 0;
        for (let i = 0, p = 0; i < d.length; i += 4, p++) {
          const v = 1 - Math.min(d[i], d[i + 1], d[i + 2]) / 255;
          dist[p] = v;
          if (v > peak) peak = v;
        }
        if (peak < 0.15) return null; // an empty box: nothing was drawn here
        // The floor comes off the peak too, or the brightest stroke in the box
        // never reaches full opacity and every icon reads slightly washed.
        const span = Math.max(1e-6, (peak - FLOOR) / (1 - FLOOR));
        let minX = cw, minY = ch, maxX = -1, maxY = -1;
        for (let y = 0, p = 0; y < ch; y++) {
          for (let x = 0; x < cw; x++, p++) {
            let a = (dist[p] - FLOOR) / (1 - FLOOR);
            a = a <= 0 ? 0 : Math.min(1, a / span);
            dist[p] = a;
            if (a > 0.08) {
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX < 0) return null;

        // White everywhere, alpha from the key, then trimmed to the ink.
        for (let i = 0, p = 0; i < d.length; i += 4, p++) {
          d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
          d[i + 3] = Math.round(dist[p] * 255);
        }
        cx.putImageData(px, 0, 0);

        const tw = maxX - minX + 1;
        const th = maxY - minY + 1;
        const k = INK / Math.max(tw, th);
        const dw = Math.max(1, Math.round(tw * k));
        const dh = Math.max(1, Math.round(th * k));
        const out = document.createElement("canvas");
        out.width = SIZE; out.height = SIZE;
        const ox = out.getContext("2d");
        ox.imageSmoothingQuality = "high";
        ox.drawImage(cut, minX, minY, tw, th, Math.round((SIZE - dw) / 2), Math.round((SIZE - dh) / 2), dw, dh);
        return out.toDataURL("image/png").split(",")[1];
      },
      { data: pages[pageNo], l, t, w, h, PAGE_W, SIZE, INK, FLOOR },
    );

    if (!png) { console.warn(`  ${name}: box is blank — check the table`); continue; }
    const dest = path.join(key ? outDir : extraDir, `${name}.png`);
    fs.writeFileSync(dest, Buffer.from(png, "base64"));
    console.log(`  ${key ? "" : "_extra/"}${name}.png`);
    done++;
  }
  await browser.close();
  console.log(`\n${done}/${PARTS.length} cut`);
})();
