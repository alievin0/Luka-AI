/**
 * Cuts the guide's symbols out of the Canva icon sheets.
 *
 * Three sheets, because no single one covers the set:
 *
 *   oem      DAHTe_FF9Yc  "OEM Icon Master Set", pages 2-7   26 symbols
 *   pack48   DAHTevrIKak  "48 Icon Pack", page 1              7 symbols
 *   iconset  DAHTemejARE  "Icon Set", page 1                  2 symbols
 *   extra6   generated to fill the six none of them draw       6 symbols
 *
 * Every light on all three is its own element with a known box, so the table
 * below is read off the designs rather than guessed from a screenshot. Boxes
 * are in each sheet's own canvas units and scale to whatever was exported, so
 * a 3x render slices at 3x with no edits here.
 *
 *   node scripts/slice-symbols.js <dir> [outDir]
 *
 * The directory holds oem-2.png ... oem-7.png, pack48.png, iconset.png and
 * extra6.png. The first three are sliced by the box table; extra6 is a bare
 * grid with no cards and no labels, so it is cut by dividing the image into
 * cells instead — nothing to measure, and it survives any resolution.
 * The renders have to be fetched by hand: this session's egress policy refuses
 * media.canva.com and export-download.canva.com, and Canva signs the export URL
 * for the latter with the host inside the signature, so it cannot be re-pointed
 * at the S3 endpoint that is reachable.
 *
 * The cut is also a key, not just a crop. The app needs a white mask it can
 * tint per severity, and these sheets are coloured line art — dark on white on
 * the OEM pages, light on near-black on the 48 pack. So rather than assume a
 * ground, each crop measures its own from its border pixels, takes alpha from
 * how far each pixel sits from it, and normalises so the core of a stroke lands
 * fully opaque. Then every surviving pixel is written white. Keying rather than
 * thresholding matters: a flat "ground becomes transparent" cut leaves fringes
 * at every antialiased edge.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const SIZE = 128;
/** Content spans this much of the box, matching make-symbols.py's pen scale. */
const INK = 104;
/** Ground noise below this is the card, not the drawing. */
const FLOOR = 0.06;

/** file -> that sheet's canvas width, which is what the boxes are measured in. */
const SHEETS = {
  "oem-2": 374, "oem-3": 374, "oem-4": 374, "oem-5": 374, "oem-6": 374, "oem-7": 374,
  pack48: 800, iconset: 800,
};

/** key, sheet, left, top, width, height. A null key is a light the library has
 *  no entry for yet; it is still cut, into _extra/, because those are the
 *  candidates for new entries and the boxes were expensive to gather. */
const PARTS = [
  // OEM Icon Master Set — the primary source: newest, cleanest, and labelled.
  ["high-beam", "oem-2", 42.25, 137.94, 128.03, 86.41],
  [null, "oem-2", 50.89, 267.23, 119.39, 86.73, "low-beam"],
  [null, "oem-2", 50.89, 396.85, 110.75, 86.41, "front-fog"],
  ["rear-fog", "oem-2", 59.21, 526.15, 85.46, 86.41],
  [null, "oem-2", 33.93, 672.73, 144.68, 60.81, "turn-signals"],

  ["door-ajar", "oem-3", 50.89, 129.30, 110.75, 103.69],
  [null, "oem-3", 42.25, 284.52, 128.03, 60.81, "hood-open"],
  [null, "oem-3", 33.93, 405.17, 136.35, 69.45, "trunk-open"],
  ["key", "oem-3", 50.89, 526.15, 119.39, 86.41],
  [null, "oem-3", 50.89, 646.80, 136.35, 95.37, "key-battery"],

  [null, "oem-4", 59.21, 137.94, 85.46, 86.41, "lane-departure"],
  [null, "oem-4", 229.50, 129.30, 85.46, 95.05, "blind-spot"],
  ["radar-car", "oem-4", 42.25, 310.44, 119.39, 78.09],
  ["cruise", "oem-4", 229.50, 301.80, 85.46, 86.73],
  [null, "oem-4", 67.86, 457.02, 68.50, 95.37, "adaptive-cruise"],
  [null, "oem-4", 212.53, 465.66, 119.39, 86.73, "parking-sensors"],
  [null, "oem-4", 127.39, 629.52, 111.07, 86.73, "lane-keep"],

  ["skid-car", "oem-5", 67.86, 129.30, 68.50, 69.13],
  ["steering", "oem-5", 229.50, 129.30, 85.46, 69.13],
  ["engine", "oem-5", 59.21, 267.23, 85.46, 60.81],
  ["battery", "oem-5", 229.50, 267.23, 85.46, 60.81],
  ["tyre", "oem-5", 59.21, 396.85, 77.14, 69.13],
  [null, "oem-5", 229.50, 388.21, 76.82, 77.77, "transmission"],
  ["epb", "oem-5", 50.89, 526.15, 93.78, 69.13],
  [null, "oem-5", 237.82, 526.15, 68.50, 69.13, "fuel-level"],
  ["washer", "oem-5", 59.21, 655.44, 85.46, 69.45],
  ["fuel-pump", "oem-5", 237.82, 655.44, 68.50, 69.45],

  ["oil-can", "oem-6", 25.29, 181.14, 93.78, 43.21],
  ["glow-plug", "oem-6", 144.36, 163.86, 85.46, 69.13],
  ["dpf", "oem-6", 255.10, 172.50, 93.78, 60.49],
  ["droplet", "oem-6", 25.29, 388.21, 85.46, 95.05],
  ["hybrid", "oem-6", 144.36, 405.17, 85.46, 60.81],
  ["ev-fault", "oem-6", 255.10, 388.21, 93.78, 86.41],
  ["regen", "oem-6", 33.93, 603.60, 76.82, 69.45],
  ["spanner", "oem-6", 153.00, 603.60, 68.18, 78.09],
  ["snowflake", "oem-6", 263.43, 603.60, 68.50, 78.09],

  ["abs", "oem-7", 280.39, 189.78, 68.50, 51.85],
  ["airbag", "oem-7", 42.25, 327.72, 51.53, 60.81],
  ["ev-ready", "oem-7", 246.46, 336.36, 68.50, 43.53],

  // 48 Icon Pack — the seven the OEM sheet does not draw at all.
  ["thermometer", "pack48", 345, 130, 110, 88],
  ["brake", "pack48", 490, 130, 110, 88],
  ["warning-triangle", "pack48", 636, 108, 110, 110],
  ["seatbelt", "pack48", 363, 282, 74, 110],
  ["esc-off", "pack48", 654, 434, 92, 132],
  ["start-stop", "pack48", 54, 1130, 92, 110],
  ["bulb", "pack48", 345, 630, 110, 88],

  // Icon Set — the two EV lights neither other sheet has.
  ["plug", "iconset", 36, 1217, 92, 110],
  ["ev-battery", "iconset", 163, 1239, 92, 66],
];

/**
 * Sheets that are a plain grid of icons on a flat ground: no cards, no labels,
 * evenly spaced. Cut by cell rather than by box, reading left to right and top
 * to bottom, so the order below IS the mapping.
 */
const GRIDS = {
  extra6: {
    cols: 3,
    rows: 2,
    keys: ["catalytic", "coolant", "pad-wear", "suspension", "turtle", "water-in-fuel"],
  },
};

(async () => {
  const srcDir = process.argv[2];
  const outDir = process.argv[3] || path.join(__dirname, "..", "assets", "symbols");
  if (!srcDir || !fs.existsSync(srcDir)) {
    console.error("usage: node scripts/slice-symbols.js <dir> [outDir]");
    console.error(`expects: ${Object.keys(SHEETS).map((s) => s + ".png").join(", ")}`);
    process.exit(1);
  }
  const extraDir = path.join(outDir, "_extra");
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(extraDir, { recursive: true });

  const sheets = {};
  for (const name of [...Object.keys(SHEETS), ...Object.keys(GRIDS)]) {
    const f = path.join(srcDir, `${name}.png`);
    if (fs.existsSync(f)) sheets[name] = fs.readFileSync(f).toString("base64");
  }
  const absent = [...Object.keys(SHEETS), ...Object.keys(GRIDS)].filter((n) => !sheets[n]);
  if (absent.length) console.warn(`no render for ${absent.join(", ")} — those rows are skipped\n`);

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium",
  });
  const page = await browser.newPage();
  await page.setContent("<body></body>");

  let done = 0;
  const blank = [];

  /** Crop, key and fit one icon. Give it a box in sheet units, or a cell. */
  const cutOne = (data, canvasW, box, cell) =>
    page.evaluate(
      async ({ data, canvasW, box, cell, SIZE, INK, FLOOR }) => {
        const img = new Image();
        await new Promise((r) => { img.onload = r; img.src = "data:image/png;base64," + data; });

        let l, t, w, h;
        if (cell) {
          w = img.naturalWidth / cell.cols;
          h = img.naturalHeight / cell.rows;
          l = cell.col * w;
          t = cell.row * h;
        } else {
          const scale = img.naturalWidth / canvasW;
          l = box.l * scale; t = box.t * scale; w = box.w * scale; h = box.h * scale;
        }

        const cw = Math.max(1, Math.round(w));
        const ch = Math.max(1, Math.round(h));
        const cut = document.createElement("canvas");
        cut.width = cw; cut.height = ch;
        const cx = cut.getContext("2d", { willReadFrequently: true });
        cx.drawImage(img, -Math.round(l), -Math.round(t));
        const px = cx.getImageData(0, 0, cw, ch);
        const d = px.data;

        // The ground is whatever the border of the box is — white on the OEM
        // pages, near-black on the 48 pack. Measured, not assumed, so one
        // routine serves every sheet. Median of the border beats the mean:
        // a stroke that runs to the edge would drag a mean with it.
        const at = (x, y) => (y * cw + x) * 4;
        const edge = [[], [], []];
        for (let x = 0; x < cw; x++) for (const y of [0, ch - 1]) {
          const i = at(x, y); edge[0].push(d[i]); edge[1].push(d[i + 1]); edge[2].push(d[i + 2]);
        }
        for (let y = 0; y < ch; y++) for (const x of [0, cw - 1]) {
          const i = at(x, y); edge[0].push(d[i]); edge[1].push(d[i + 1]); edge[2].push(d[i + 2]);
        }
        const ground = edge.map((c) => { c.sort((a, b) => a - b); return c[c.length >> 1]; });

        const dist = new Float32Array(cw * ch);
        let peak = 0;
        for (let i = 0, p = 0; i < d.length; i += 4, p++) {
          const v = Math.max(
            Math.abs(d[i] - ground[0]), Math.abs(d[i + 1] - ground[1]), Math.abs(d[i + 2] - ground[2]),
          ) / 255;
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
      { data, canvasW, box, cell, SIZE, INK, FLOOR },
    );

  const write = (key, name, png) => {
    if (!png) { blank.push(name); return; }
    fs.writeFileSync(path.join(key ? outDir : extraDir, `${name}.png`), Buffer.from(png, "base64"));
    console.log(`  ${key ? "" : "_extra/"}${name}.png`);
    done++;
  };

  for (const [key, sheet, l, t, w, h, label] of PARTS) {
    if (!sheets[sheet]) continue;
    write(key, key ?? label, await cutOne(sheets[sheet], SHEETS[sheet], { l, t, w, h }, null));
  }

  for (const [name, g] of Object.entries(GRIDS)) {
    if (!sheets[name]) continue;
    for (let i = 0; i < g.keys.length; i++) {
      const cell = { col: i % g.cols, row: Math.floor(i / g.cols), cols: g.cols, rows: g.rows };
      write(g.keys[i], g.keys[i], await cutOne(sheets[name], null, null, cell));
    }
  }

  await browser.close();
  const total = PARTS.length + Object.values(GRIDS).reduce((n, g) => n + g.keys.length, 0);
  console.log(`\n${done}/${total} cut`);
  if (blank.length) console.log(`blank boxes — check the table: ${blank.join(", ")}`);
})();
