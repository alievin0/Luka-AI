# Design brief — Dash Light Scanner

Written to be handed to a designer, or to an image model, without further
explanation. Everything here is a constraint the product already lives under,
not a mood board.

---

## The one sentence

**A driver has stopped on the hard shoulder and has about four seconds of
attention. The screen answers one question — can I keep driving? — and then
gets out of the way.**

Every decision below follows from that sentence. If a choice makes the screen
prettier and slower to read, it is the wrong choice.

## Who is looking at it

Not a car enthusiast. Somebody who has never opened the manual, is somewhere
between annoyed and frightened, is holding the phone one-handed, and may be
doing this at night with headlights going past. Half of them are reading
Arabic, right to left.

They are not browsing. They will not scroll to find the answer.

---

## The rule that governs the palette

**Amber is the caution grade. It may never also mean "press this."**

This is the single most important constraint in the whole design. The app
speaks a three-colour safety language — red, amber, green — and those three
colours are reserved for saying how dangerous something is. A button wearing
amber is a driver mistaking a warning for an action, or an action for a
warning, at the exact moment that confusion costs the most.

Actions therefore wear a near-white (`#E8EDF2`) that sits outside the severity
language entirely. Nothing else in the app is that colour.

| | | Means |
|---|---|---|
| Critical | red | stop |
| Warning | amber | attention soon |
| Info | green / blue | nothing to do |
| Action | near-white | press this |

Ground is near-black. Surfaces sit one shade off the ground; separation comes
from a hairline border and from space, never from a drop shadow.

## The tone

**An instrument, not an atmosphere.** No photographs behind text, no gradients
behind content, no glow, no glass, no floating cards, no illustration of a
worried person beside a car. An instrument that arrives wrapped in mood is not
one anybody trusts at a roadside.

The single exception already in the app is a faint night-road texture behind
the paywall header, which fades out before the first card. It is a texture, not
a photograph, and nothing else gets one.

## Hierarchy, in the order the eye should land

1. **The verdict.** The largest thing on the screen — 34pt, and nothing else
   is allowed to be that size. *Stop the car now.* Not the light's name.
2. **What to do with the car.** Do not move it / move only to safety / continue
   carefully / keep an eye on it.
3. **Which light it was**, with its pictogram large, because matching a shape
   is faster than reading a name.
4. Everything else.

The reason the verdict outranks the light's name: a driver who is *told* the
answer has it in one second; a driver who has to *find* it in a paragraph has
an emergency reference app instead of an emergency tool.

## Type

Two families, matched on x-height so a bilingual screen does not look
assembled: **Inter** for Latin, **IBM Plex Sans Arabic** for Arabic. No single
family draws both scripts this well at this size, and legibility beats
tidiness on a screen read by someone who is rattled.

Scale: 34 / 24 / 18 / 16 / 14 / 12, with its own Arabic line height — Arabic
needs more leading than Latin at the same size, and using one number for both
gives you cramped Arabic or airy English.

Everything sits on a 4pt grid. Corners are 26 on cards, and every card in the
app is cut from the same radius so none reads as a different part of the
product.

## Right-to-left is not a mirror of an afterthought

The Arabic build is not the English one flipped. Text runs with the reading
direction, rows mirror, and the badge that sits top-left in English sits
top-right in Arabic. React Native mirrors `flexDirection: row` on its own under
forced RTL — writing a helper that flips it again produces a layout mirrored
twice, which is a bug that looks like a design.

## What the screens are

**Camera.** Opens straight to it. No home screen, no menu. A frame with corner
marks, one line of guidance, a torch, a shutter, a gallery button. The count of
free scans sits small in a corner and never becomes a nag.

**Analysing.** An indeterminate ring, not a percentage. The API reports no
progress, so a number would be invented — and the whole product rests on not
inventing things.

**Result.** Verdict band, then the roadside decision with its safe-place
question, then the symptom question, then the light's identity, then the locked
report or the full one.

**Not detected.** Its own screen, not a result with empty fields. It says what
was wrong with *this* photograph and offers the gallery, because retaking at
the roadside is not always possible.

**Guide.** 48 lights, most dangerous first, searchable. A search that finds
nothing sends the driver to the camera rather than stopping at "no results".

**Paywall.** Flat, undecorated, and it talks about the result that sent them
there — *your reading says: stop the car* — not about a subscription.

## Store screenshots, in order

1. ولعت اللمبة؟ اعرف ماذا تفعل الآن.
2. 🔴 أوقف · 🟠 انتبه · 🟢 لا تحتاج إجراء
3. صوّرها ← اعرف القرار
4. على سيارتك أنت
5. اعرف تكلفة الإصلاح
6. لا تعرف اللمبة؟ ابحث عنها

Sell the moment, never the technology. Nobody buys "AI-powered"; they buy
knowing whether to keep driving.

---

## The prompt, for an image model

> A mobile app screen for a car dashboard warning-light scanner, shown on an
> iPhone. Near-black background (#0E1114), one surface shade above it (#171B20),
> hairline borders, no shadows, no gradients, no glow.
>
> At the top, a full-width band in deep red with a 34pt bold headline reading
> "Stop the car now" and one line of smaller grey text beneath it. Below that, a
> card with a red hairline border containing a large line-art warning symbol —
> an oil can — and the light's name in 24pt, with a small red severity pill to
> the side.
>
> Beneath, a second card asking "Are you somewhere safe?" with two outlined pill
> buttons, Yes and No.
>
> One near-white (#E8EDF2) full-width button with 20px radius near the bottom.
> Nothing else in the image is that colour.
>
> Flat, precise, instrument-like. Generous space. 4pt rhythm. Inter for Latin
> type. No photography, no people, no car imagery, no 3D, no reflections, no
> decorative shapes. It should look like an aviation instrument, not a
> consumer app.

For an Arabic version, add: *right-to-left layout, IBM Plex Sans Arabic, all
text in Modern Standard Arabic, badges and icons mirrored to the right edge.*

## What to refuse

- Amber buttons.
- A percentage on the analysing screen.
- A stock photo of a broken-down car.
- Rounded, friendly, "reassuring" illustration. The situation is not reassuring
  and pretending otherwise reads as not understanding it.
- Any screen where the light's name is larger than the verdict.
