/**
 * Renders every library entry's symbol the way the app renders it — tinted to
 * its grade, on the app's own background, at both sizes the app uses.
 *
 *   node scripts/contact-sheet.js [out.png] [symbolsDir]
 *
 * This is the gate before a symbol set is committed. Swapping artwork in a
 * car-safety app is only safe if someone has actually looked at all 48 and
 * confirmed that the drawing above "Brake System" is a brake.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const ROOT = path.join(__dirname, "..");
const BG = "#0C0E13";
const GRADE = { critical: "#FF6469", warning: "#F2A33C", info: "#55C97A" };
const COLS = 4;
const CELL_W = 320;
const CELL_H = 132;
const PAD = 24;

/** Pulls id / glyph / severity / title out of the library without a TS build. */
function entries() {
  const src = fs.readFileSync(path.join(ROOT, "src/packs/dashlight-library.ts"), "utf8");
  const out = [];
  const re = /id:\s*"([^"]+)",\s*\n\s*glyph:\s*"([^"]+)",\s*\n\s*title:\s*L\("([^"]*)"/g;
  let m;
  while ((m = re.exec(src))) {
    const after = src.slice(m.index, m.index + 1200);
    const sev = /severity:\s*"([^"]+)"/.exec(after);
    out.push({ id: m[1], glyph: m[2], title: m[3], severity: sev ? sev[1] : "info" });
  }
  return out;
}

(async () => {
  const outFile = process.argv[2] || path.join(ROOT, "symbols-contact-sheet.png");
  const symbolsDir = process.argv[3] || path.join(ROOT, "assets/symbols");
  const list = entries();
  if (!list.length) {
    console.error("no entries parsed from dashlight-library.ts");
    process.exit(1);
  }

  const art = {};
  for (const e of list) {
    if (art[e.glyph] !== undefined) continue;
    const f = path.join(symbolsDir, `${e.glyph}.png`);
    art[e.glyph] = fs.existsSync(f) ? fs.readFileSync(f).toString("base64") : null;
  }
  const missing = Object.entries(art).filter(([, v]) => !v).map(([k]) => k);

  const rows = Math.ceil(list.length / COLS);
  const W = COLS * CELL_W + PAD * 2;
  const H = rows * CELL_H + PAD * 2 + 56;

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium",
  });
  const page = await browser.newPage();
  await page.setContent("<body></body>");
  const png = await page.evaluate(
    async ({ list, art, W, H, COLS, CELL_W, CELL_H, PAD, BG, GRADE, title }) => {
      const load = (b64) =>
        new Promise((done) => {
          if (!b64) return done(null);
          const i = new Image();
          i.onload = () => done(i);
          i.onerror = () => done(null);
          i.src = "data:image/png;base64," + b64;
        });
      const imgs = {};
      for (const k of Object.keys(art)) imgs[k] = await load(art[k]);

      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const x = c.getContext("2d");
      x.fillStyle = BG; x.fillRect(0, 0, W, H);
      x.fillStyle = "#E8ECF1";
      x.font = "600 22px system-ui, sans-serif";
      x.fillText(title, PAD, PAD + 24);

      // One mask, tinted, drawn at a size — source-in over a scratch canvas so
      // the PNG's own white is replaced rather than blended with.
      const tint = (img, colour, size) => {
        const s = document.createElement("canvas");
        s.width = size; s.height = size;
        const sx = s.getContext("2d");
        sx.imageSmoothingQuality = "high";
        sx.drawImage(img, 0, 0, size, size);
        sx.globalCompositeOperation = "source-in";
        sx.fillStyle = colour;
        sx.fillRect(0, 0, size, size);
        return s;
      };

      list.forEach((e, n) => {
        const col = n % COLS;
        const row = Math.floor(n / COLS);
        const ox = PAD + col * CELL_W;
        const oy = PAD + 56 + row * CELL_H;
        const colour = GRADE[e.severity] || GRADE.info;

        x.strokeStyle = "#1E2630";
        x.strokeRect(ox + 0.5, oy + 0.5, CELL_W - 8, CELL_H - 8);

        const img = imgs[e.glyph];
        if (img) {
          x.drawImage(tint(img, colour, 76), ox + 12, oy + 16);
          x.drawImage(tint(img, colour, 40), ox + 96, oy + 34);
        } else {
          x.fillStyle = "#FF6469";
          x.font = "600 13px system-ui, sans-serif";
          x.fillText("MISSING", ox + 16, oy + 50);
        }

        x.fillStyle = "#E8ECF1";
        x.font = "600 14px system-ui, sans-serif";
        // Measured, not counted — em dashes and capitals make a character
        // budget clip some titles and leave others short.
        const room = CELL_W - 148 - 16;
        let t = e.title;
        while (t.length > 4 && x.measureText(t + "…").width > room) t = t.slice(0, -1);
        x.fillText(t === e.title ? t : t + "…", ox + 148, oy + 44);
        x.fillStyle = colour;
        x.font = "500 12px ui-monospace, monospace";
        x.fillText(e.glyph, ox + 148, oy + 66);
        x.fillStyle = "#69717F";
        x.font = "400 11px ui-monospace, monospace";
        x.fillText(e.severity, ox + 148, oy + 86);
      });
      return c.toDataURL("image/png").split(",")[1];
    },
    { list, art, W, H, COLS, CELL_W, CELL_H, PAD, BG, GRADE, title: `${list.length} entries · ${Object.keys(art).length} symbols · ${symbolsDir.split("/").slice(-2).join("/")}` },
  );
  await browser.close();
  fs.writeFileSync(outFile, Buffer.from(png, "base64"));
  console.log(`${outFile}  ${W}x${H}  —  ${list.length} entries, ${Object.keys(art).length} distinct symbols`);
  if (missing.length) console.log(`missing artwork: ${missing.join(", ")}`);
})();
