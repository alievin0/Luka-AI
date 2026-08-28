/**
 * The two symbols the set was missing, drawn out of the two it already had.
 *
 * Dash Light shipped 41 pictograms for 48 guide entries. Seven were shared by
 * two entries each; five of those pairs are one real light in two states and
 * are correct. Two were not:
 *
 *   oil-level-low        showed oil-can    — the *pressure* can, with its drip
 *   transmission-overheat showed thermometer — the *engine coolant* thermometer
 *
 * Oil pressure is red, "stop now, it can seize within a minute". Oil level is
 * amber, "top it up this week". They rendered the same drawing, in different
 * colours, one row apart in a scrolling list — in an app whose whole premise is
 * *match the shape on your dashboard to the shape on the screen*.
 *
 * ## Why derive rather than draw
 *
 * A new icon has to sit beside its neighbour and read as the same hand: same
 * weight, same optical size, same corner treatment. The shipped 41 were cut
 * from design sheets by slice-symbols.js — they are not generated, so a fresh
 * drawing would not match them however carefully it was tuned. So each new
 * symbol reuses its neighbour's actual pixels and changes only what has to
 * change:
 *
 *   oil-level-min      = oil-can, drip deleted, level lines added
 *   transmission-temp  = thermometer's stem and bulb, inside a gear
 *
 * Even the level lines are not invented. thermometer.png draws liquid as a
 * sine, and measuring it gives the amplitude, period and weight used here, so
 * the waves under the oil can are the same waves that appear under the
 * coolant thermometer.
 *
 * ## Measured house style, from the shipped files
 *
 *   canvas   128 x 128 RGBA, white on transparent (tinted at display time)
 *   glyph    104 px wide, inset 12 px each side
 *   stroke   ~6 px
 *   wave     amplitude 3.2, period 26
 *
 * Run: node scripts/make-two-symbols.js [--check]
 *
 * `--check` regenerates into memory and compares against what is committed,
 * so the artwork cannot drift from the script that claims to produce it.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const SYMBOLS = path.join(ROOT, "assets/symbols");

const SIZE = 128;
const STROKE = 6;
const WAVE_AMPLITUDE = 3.2;
const WAVE_PERIOD = 26;

/* --------------------------------------------------------------- PNG codec */

/** Alpha is all these files carry — the colour is white everywhere and the
 *  app tints at render time — so decode down to one plane and back. */
function decode(file) {
  const b = fs.readFileSync(file);
  let p = 8;
  const idat = [];
  let w, h, depth, colour;
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString("ascii", p + 4, p + 8);
    if (type === "IHDR") {
      w = b.readUInt32BE(p + 8);
      h = b.readUInt32BE(p + 12);
      depth = b[p + 16];
      colour = b[p + 17];
    }
    if (type === "IDAT") idat.push(b.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  if (depth !== 8) throw new Error(`${file}: expected 8-bit, got ${depth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colour];
  if (!channels) throw new Error(`${file}: unsupported colour type ${colour}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const flat = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? flat[y * stride + x - channels] : 0;
      const up = y > 0 ? flat[(y - 1) * stride + x] : 0;
      const ul = x >= channels && y > 0 ? flat[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (a + up) >> 1;
      else if (filter === 4) {
        const guess = a + up - ul;
        const da = Math.abs(guess - a);
        const db = Math.abs(guess - up);
        const dc = Math.abs(guess - ul);
        v += da <= db && da <= dc ? a : db <= dc ? up : ul;
      }
      flat[y * stride + x] = v & 255;
    }
  }

  // The alpha channel where there is one; the grey value where there is not.
  const at = channels === 4 ? 3 : channels === 2 ? 1 : 0;
  const alpha = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = flat[i * channels + at] / 255;
  return { w, h, alpha };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function encode(w, h, alpha) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none — these are tiny and compress fine
    for (let x = 0; x < w; x++) {
      const o = y * (stride + 1) + 1 + x * 4;
      raw[o] = raw[o + 1] = raw[o + 2] = 255;
      raw[o + 3] = Math.max(0, Math.min(255, Math.round(alpha[y * w + x] * 255)));
    }
  }
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------- pixel tools */

const blank = () => new Float64Array(SIZE * SIZE);

/** Every 8-connected run of ink, largest first. Both source icons are made of
 *  separable parts — the oil can's drip is its own 195-pixel island — which is
 *  what makes "delete the drip, keep the can" a safe operation rather than a
 *  guess at a bounding box. */
function components({ w, h, alpha }, threshold = 0.35) {
  const label = new Int32Array(w * h).fill(-1);
  const found = [];
  for (let seed = 0; seed < w * h; seed++) {
    if (alpha[seed] < threshold || label[seed] >= 0) continue;
    const id = found.length;
    const stack = [seed];
    const pixels = [];
    label[seed] = id;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i / w) | 0;
      pixels.push(i);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (alpha[k] >= threshold && label[k] < 0) {
            label[k] = id;
            stack.push(k);
          }
        }
      }
    }
    found.push({ pixels, x0, y0, x1, y1, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } });
  }
  return found.sort((a, b) => b.pixels.length - a.pixels.length);
}

/**
 * Copy one component onto the canvas, offset and optionally scaled.
 *
 * Anti-aliased edges matter here: these are 6 px strokes at 40 px display, so
 * a nearest-neighbour copy would show as a visibly rougher icon beside its
 * neighbour. Sampling is bilinear, and the component is masked so a scaled
 * copy cannot drag in a pixel of whatever sat next to it.
 */
function stamp(dst, src, comp, { dx = 0, dy = 0, scale = 1 } = {}) {
  const mask = new Float64Array(src.w * src.h);
  for (const i of comp.pixels) mask[i] = 1;
  // Soft edges belong to the component too — take the source alpha wherever
  // the hard mask or any 8-neighbour of it is set.
  const near = new Float64Array(src.w * src.h);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      if (!mask[y * src.w + x]) continue;
      for (let ny = Math.max(0, y - 2); ny <= Math.min(src.h - 1, y + 2); ny++) {
        for (let nx = Math.max(0, x - 2); nx <= Math.min(src.w - 1, x + 2); nx++) {
          near[ny * src.w + nx] = 1;
        }
      }
    }
  }
  const sample = (fx, fy) => {
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const at = (x, y) =>
      x < 0 || y < 0 || x >= src.w || y >= src.h || !near[y * src.w + x]
        ? 0
        : src.alpha[y * src.w + x];
    return (
      at(x0, y0) * (1 - tx) * (1 - ty) +
      at(x0 + 1, y0) * tx * (1 - ty) +
      at(x0, y0 + 1) * (1 - tx) * ty +
      at(x0 + 1, y0 + 1) * tx * ty
    );
  };
  const outW = Math.round(comp.box.w * scale);
  const outH = Math.round(comp.box.h * scale);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const v = sample(comp.box.x + x / scale, comp.box.y + y / scale);
      if (v <= 0) continue;
      const px = dx + x, py = dy + y;
      if (px < 0 || py < 0 || px >= SIZE || py >= SIZE) continue;
      const at = py * SIZE + px;
      dst[at] = Math.max(dst[at], v);
    }
  }
  return { w: outW, h: outH };
}

/**
 * Stroke a polyline as a distance field.
 *
 * Every shape added here is a stroke of one constant width, which is exactly
 * what a distance field draws well: alpha falls off over one pixel either side
 * of the half-width, giving the same soft edge the cut artwork has.
 */
function stroke(dst, points, width = STROKE) {
  const r = width / 2;
  let x0 = SIZE, y0 = SIZE, x1 = 0, y1 = 0;
  for (const [px, py] of points) {
    x0 = Math.min(x0, px); x1 = Math.max(x1, px);
    y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  const pad = Math.ceil(r) + 2;
  for (let y = Math.max(0, Math.floor(y0 - pad)); y <= Math.min(SIZE - 1, Math.ceil(y1 + pad)); y++) {
    for (let x = Math.max(0, Math.floor(x0 - pad)); x <= Math.min(SIZE - 1, Math.ceil(x1 + pad)); x++) {
      let best = Infinity;
      for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1];
        const [bx, by] = points[i];
        const vx = bx - ax, vy = by - ay;
        const len2 = vx * vx + vy * vy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / len2));
        const ddx = x - (ax + t * vx), ddy = y - (ay + t * vy);
        const d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d < best) best = d;
      }
      // One pixel of falloff, centred on the stroke edge.
      const a = Math.max(0, Math.min(1, r + 0.5 - best));
      if (a > 0) {
        const at = y * SIZE + x;
        dst[at] = Math.max(dst[at], a);
      }
    }
  }
}

/** The liquid line thermometer.png draws, at whatever width is asked for. Two
 *  of these under the can are the low-level convention; the drip they replace
 *  is the low-pressure one. */
const wave = (cx, cy, width) => {
  const points = [];
  for (let i = 0; i <= width; i++) {
    const x = cx - width / 2 + i;
    points.push([x, cy + WAVE_AMPLITUDE * Math.sin((2 * Math.PI * i) / WAVE_PERIOD)]);
  }
  return points;
};

/**
 * A gear seen face on.
 *
 * The proportions are the whole job. Teeth that are wide with narrow gaps read
 * as a flower or a sun, which is the failure this icon cannot afford — it has
 * to say "gearbox" at 40 px in a list. Equal thirds work: the flat tip spans
 * about a third of each tooth's share of the circle, the root arc between two
 * teeth spans about another third, and the flanks take the rest.
 */
function gear(cx, cy, root, tip, teeth) {
  const points = [];
  const step = (2 * Math.PI) / teeth;
  const tipHalf = step * 0.17; // flat top of the tooth
  const rootHalf = step * 0.33; // where the flank meets the rim
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    points.push(
      [cx + root * Math.cos(a - rootHalf), cy + root * Math.sin(a - rootHalf)],
      [cx + tip * Math.cos(a - tipHalf), cy + tip * Math.sin(a - tipHalf)],
      [cx + tip * Math.cos(a + tipHalf), cy + tip * Math.sin(a + tipHalf)],
      [cx + root * Math.cos(a + rootHalf), cy + root * Math.sin(a + rootHalf)],
    );
    // Follow the rim round to the next tooth, so the gaps are arcs and not
    // chords — a straight gap makes the outline read as a polygon.
    const gap = step - rootHalf * 2;
    for (let s = 1; s < 6; s++) {
      const t = a + rootHalf + (gap * s) / 6;
      points.push([cx + root * Math.cos(t), cy + root * Math.sin(t)]);
    }
  }
  points.push(points[0]);
  return points;
}

/* ------------------------------------------------------------- the symbols */

/**
 * Oil level low.
 *
 * The can is oil-can.png untouched, moved up to make room. What changes is
 * below it: the drip — a separate 195-pixel island — is dropped, and two level
 * lines take its place, the lower one shorter so the pair reads as a surface
 * that has fallen rather than as two of the same thing.
 */
function oilLevelMin() {
  const src = decode(path.join(SYMBOLS, "oil-can.png"));
  const parts = components(src);
  if (parts.length !== 2) {
    throw new Error(`oil-can.png: expected the can and its drip, found ${parts.length} parts`);
  }
  const [can, drip] = parts;
  if (drip.pixels.length > can.pixels.length / 3) {
    throw new Error("oil-can.png: the smaller part is too big to be the drip — has the artwork changed?");
  }

  const out = blank();
  // Centre the can horizontally in the 104 px glyph box, and sit it high
  // enough that two waves and their margins fit underneath.
  const canTop = 14;
  stamp(out, src, can, { dx: Math.round((SIZE - can.box.w) / 2), dy: canTop });

  const cx = SIZE / 2;
  const bottom = canTop + can.box.h;
  stroke(out, wave(cx, bottom + 16, 62));
  stroke(out, wave(cx, bottom + 36, 44));
  return out;
}

/**
 * Transmission overheating.
 *
 * The thermometer is thermometer.png's own stem and bulb, scaled to sit inside
 * the gear. Deliberately the same thermometer: what tells this apart from
 * engine coolant is the gear around it, not a different instrument — a driver
 * matching shapes should see "temperature, of the gearbox", not two unrelated
 * drawings. The coolant icon's liquid waves are left behind; they belong to
 * the light this one is not.
 */
function transmissionTemp() {
  const src = decode(path.join(SYMBOLS, "thermometer.png"));
  const parts = components(src);
  const stem = parts[0];
  if (stem.box.h < stem.box.w * 1.5) {
    throw new Error("thermometer.png: the largest part is not the upright stem — has the artwork changed?");
  }

  const out = blank();
  const cx = SIZE / 2;
  const cy = SIZE / 2;

  // The glyph box is 104 px wide, so the gear's outermost ink has to land at
  // 52 from centre — which puts the tooth tip at 52 minus half a stroke, not
  // at 52. Getting that wrong is how an icon ends up 3 px wider than every
  // other one in the list and looks subtly misaligned without anyone being
  // able to say why. Short teeth — a 12 px rise — because tall ones eat the
  // space the thermometer needs and blur together at 40 px.
  const tip = 52 - STROKE / 2;
  stroke(out, gear(cx, cy, tip - 12, tip, 7));

  // As large as fits inside the gear's root circle with a little air. The
  // thermometer has to stay legible as a thermometer at 40 px, so it takes
  // every pixel the rim allows rather than sitting politely in the middle.
  const scale = 68 / stem.box.h;
  const w = Math.round(stem.box.w * scale);
  const h = Math.round(stem.box.h * scale);
  stamp(out, src, stem, { dx: Math.round(cx - w / 2), dy: Math.round(cy - h / 2), scale });
  return out;
}

/* ---------------------------------------------------------------------- main */

const TARGETS = [
  ["oil-level-min", oilLevelMin],
  ["transmission-temp", transmissionTemp],
];

const check = process.argv.includes("--check");
let problems = 0;

for (const [name, build] of TARGETS) {
  const file = path.join(SYMBOLS, `${name}.png`);
  const png = encode(SIZE, SIZE, build());
  if (check) {
    if (!fs.existsSync(file)) {
      console.log(`FAIL ${name}.png does not exist`);
      problems++;
    } else if (!fs.readFileSync(file).equals(png)) {
      console.log(`FAIL ${name}.png differs from what this script produces`);
      problems++;
    } else {
      console.log(`ok   ${name}.png matches`);
    }
  } else {
    fs.writeFileSync(file, png);
    console.log(`wrote ${name}.png (${png.length} bytes)`);
  }
}

if (check) {
  console.log(
    problems
      ? `\n${problems} problems. Run without --check to regenerate.`
      : "\nBoth derived symbols match their source artwork.",
  );
  if (problems) process.exit(1);
}
