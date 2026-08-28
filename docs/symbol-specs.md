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

## How they were made

Not generated. Each is its neighbour's own pixels with one thing changed, by
`apps/scanner/scripts/make-two-symbols.js`:

| | derived from | the change |
| --- | --- | --- |
| `oil-level-min` | `oil-can.png` | the drip — a separate 195-pixel island — deleted, and two level lines added below |
| `transmission-temp` | `thermometer.png` | the stem and bulb only, scaled and set inside a gear; the coolant waves left behind |

Deriving beats drawing here. The shipped 41 were cut from design sheets by
`slice-symbols.js`, so they are photographs of an icon set rather than generated
shapes — a fresh drawing would not match them however carefully it was tuned,
and the one thing these two icons must do is sit beside their neighbour and read
as the same hand. Even the level lines are not invented: `thermometer.png` draws
liquid as a sine, and measuring it gave the amplitude, period and weight used
here, so the waves under the oil can are the waves under the coolant thermometer.

Re-run it with `node scripts/make-two-symbols.js`; `--check` compares what it
would produce against what is committed, and runs inside `npm run check`, so the
artwork cannot drift from the script that claims to produce it.

### The house style, measured from the shipped files

Not estimated — decoded. Every value below came from reading the PNGs:

| | |
| --- | --- |
| canvas | 128 × 128 RGBA |
| glyph box | **104 px wide, inset 12 px** each side — consistent across every icon measured |
| stroke | **≈ 6 px** (median run: oil-can 5, battery 6, engine 7, key 6) |
| wave | amplitude 3.2, period 26 |
| colour | white only, on transparent — the app tints to the grade at render time |

An earlier draft of this file said 8 px, which was a guess and was wrong. If you
add a third symbol, measure rather than infer.

---

## What each one has to be

### `oil-level-min` — oil level, low

The standard engine-oil can, and **no drop anywhere**. Instead, two short
horizontal wavy lines beneath it, the lower one shorter, reading as the surface
of a liquid that has fallen.

**Why the wavy lines.** The drip and the level lines are the two conventions real
instrument clusters use, and they are the pair drivers already read as "pressure"
and "level". Some makers write MIN beside the can instead; text does not survive
tinting to 40 px and does not translate, so lines it is.

### `transmission-temp` — transmission overheating

A gear wheel with a thermometer inside it. **The same thermometer** as engine
temperature — same bulb, same stem, same graduations. What separates them is the
gear around it, not a different instrument: a driver matching shapes should read
"temperature, of the gearbox", not two unrelated drawings.

The gear's proportions are the whole job. Teeth that are wide with narrow gaps
read as a flower or a sun. Roughly equal thirds work — flat tip, flank, root arc
— with seven teeth and a 12 px rise, which stays countable at 40 px.

**Why a gear and not text.** Several makers show "A/T OIL TEMP" or "AT TEMP"
instead of a pictogram. Text is unreadable at 40 px, does not tint well, and
would be the only English in an Arabic guide entry.

---

## The gate

Five places, each guarded by `apps/scanner/scripts/check-schema.js`, so missing
one turns `npm run check` red rather than shipping quietly:

1. the PNG in `apps/scanner/assets/symbols/`
2. the entry in `apps/scanner/src/symbols.ts`
3. the enum in `apps/scanner/app/api/scan+api.ts`
4. the list inside the prompt in `apps/scanner/src/packs/dashlight.ts`
5. the `glyph:` on the entry in `apps/scanner/src/packs/dashlight-library.ts`

Then `node apps/scanner/scripts/contact-sheet.js`, which renders all 48 entries
tinted to their grade on the app's own background at both sizes the app uses.
**That sheet is the gate**, and it is the only check that catches the failure
this file exists for: someone has to look at all 48 and confirm the drawing above
"Oil Level Low" is not the drawing above "Oil Pressure". It is the same gate the
first 41 went through, and these two passed it.

The old `oil-can` and `thermometer` are untouched — still correct for
`oil-pressure` and `coolant-temp-high`. This added two symbols; it replaced none.
