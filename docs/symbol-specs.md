# Two symbols to draw

Dash Light ships 41 pictograms for 48 guide entries, so seven are shared by two
entries each. Five of those pairs are correct: `engine` flashing and steady are
one real symbol and the flashing is the difference; `warning-triangle` red and
amber is one triangle carrying two grades through its tint; `skid-car`,
`battery` and `key` are the same light in two states.

Two are wrong, and in an app whose whole premise is *match the shape on your
dashboard to the shape on the screen*, a picture that means two different things
is the failure that matters most.

| entry | today | should be |
| --- | --- | --- |
| `oil-level-low` — "Oil Level Low" | `oil-can`, the pressure can with a falling drip | **`oil-level-min`** |
| `transmission-overheat` — "Transmission Overheating" | `thermometer`, the coolant thermometer in wavy liquid | **`transmission-temp`** |

`oil-can` is the **pressure** warning: red, "stop the engine now, it can seize
within a minute". `oil-level-low` is amber, "top it up this week". They render
the same drawing today, in different colours, one row apart in the guide.

`thermometer` is the **engine coolant** symbol. Transmission temperature is a
different light, a different cause and a different action — you stop and let the
gearbox cool in Park rather than opening a bonnet.

---

## How to use this

Paste one block at a time into whatever you generate with. Each block describes
the new icon **as a change to an existing one**, because the new drawing has to
sit next to its neighbour in a scrolling list and read as the same family — same
hand, same weight, same optical size. Describing it from nothing gets you a
correct symbol in the wrong style, which looks like a mistake.

Send back a PNG per symbol and I will wire them in.

### The house style, true of both

- **White on transparent.** The app tints every symbol to its grade at render
  time — red, amber or green — so the artwork must carry no colour of its own.
  A coloured icon would fight the severity it is being tinted to.
- **128 × 128, RGBA**, the glyph centred with a small margin, filling roughly
  the same optical area as the icon it sits beside.
- **Line art, uniform stroke.** No fills, no gradients, no shadows, no outline
  around the outline.
- **Legible at 40 px.** That is the size in the guide list, which is where the
  driver actually scans for their symbol. If the difference from its neighbour
  disappears at 40 px, the icon has not done its job.

---

## 1. `oil-level-min` — oil level, low

> Draw a dashboard warning symbol: an **oil can**, seen from the side, with a
> long angled spout rising to the upper left and a rounded body — the standard
> engine-oil pictogram used on car instrument clusters.
>
> The distinguishing feature: instead of a single drop falling from the tip of
> the spout, draw **two short horizontal wavy lines beneath the can**, one above
> the other, the lower one slightly shorter. They read as the surface of a
> liquid that has dropped — the low-level convention, not the low-pressure one.
> There is **no drop** anywhere in this icon.
>
> White strokes on a fully transparent background. Uniform stroke weight, the
> weight of a clean line icon at 128 px — roughly 8 px. No fill inside the can,
> no colour, no shadow, no gradient. Square canvas 128 × 128, the symbol
> centred with a small even margin.
>
> It must be told apart at a glance from the same oil can drawn with a falling
> drop, at 40 px, in a vertical list where the two appear a few rows apart.

**Why the wavy lines.** The drip and the level lines are the two conventions
real instrument clusters use, and they are the pair drivers already read as
"pressure" and "level". Some makers write MIN beside the can instead; text does
not survive tinting to 40 px and does not translate, so lines it is.

---

## 2. `transmission-temp` — transmission overheating

> Draw a dashboard warning symbol: a **gear wheel** — a circle with squared
> teeth around its rim and an open circular hole at the centre — with a
> **thermometer** inside it: a narrow vertical stem with a round bulb at the
> bottom, the stem's column filled toward the top to read as high.
>
> The thermometer must match the one used for engine temperature — same bulb
> size relative to the stem, same rounded top — so the two icons read as the
> same family. What separates them is the gear around it, not a different
> thermometer.
>
> The gear's stroke weight matches the thermometer's and the rest of the set —
> roughly 8 px at 128 px. White strokes on a fully transparent background. No
> fill inside the gear, no colour, no shadow, no gradient. Square canvas
> 128 × 128, centred with a small even margin.
>
> At 40 px the gear teeth must still be countable enough to read as a gear and
> not as a sun or a flower — use six to eight broad teeth rather than many
> narrow ones.

**Why a gear and not text.** Several makers show "A/T OIL TEMP" or "AT TEMP"
instead of a pictogram. Text is unreadable at 40 px, does not tint well, and
would be the only English in an Arabic guide entry. The cog-with-thermometer is
the pictogram European makers use and the one that stays a picture.

---

## After the artwork lands

Five places, each already guarded by `apps/scanner/scripts/check-schema.js`, so
missing one turns `npm run check` red rather than shipping quietly:

1. the PNG in `apps/scanner/assets/symbols/`
2. the entry in `apps/scanner/src/symbols.ts`
3. the enum in `apps/scanner/app/api/scan+api.ts`
4. the list inside the prompt in `apps/scanner/src/packs/dashlight.ts`
5. the `glyph:` on the entry in `apps/scanner/src/packs/dashlight-library.ts`

Then `node apps/scanner/scripts/contact-sheet.js`, which renders all 48 entries
tinted to their grade on the app's own background at both sizes the app uses.
That sheet is the gate: someone has to look at all 48 and confirm the drawing
above "Oil Level Low" is not the drawing above "Oil Pressure". It is the same
gate the first 41 went through.

The old `oil-can` and `thermometer` files stay exactly as they are — they are
still correct for `oil-pressure` and `coolant-temp-high`. This adds two symbols;
it does not replace any.
