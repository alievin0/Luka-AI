# Design prompt — Dash Light Scanner

Paste the block below into a design generator (Claude Design, Figma Make,
Midjourney, Higgsfield, v0 — anything that takes a written brief).

Everything in it is taken from the app as built: the real palette, the real
result fields, the real copy, the real 48-entry light guide. Nothing is
invented, so what comes back can actually be built.

---

## THE PROMPT

You are designing a native mobile app called **Dash Light Scanner** (Arabic
name: **مصابيح السيارة**). Produce high-fidelity screen designs.

### What the app is

A warning light comes on in someone's car. They point their phone at the
dashboard, take one photo, and the app tells them — in seconds — whether it is
safe to keep driving, what is probably wrong, and roughly what the repair will
cost in their own currency.

### The moment it is used — design for this, not for a showcase

It is night. The driver is on the hard shoulder, or stopped at a light with
traffic behind them. An unfamiliar symbol just lit up on the dashboard. They
are holding the phone in one hand, they are a little frightened, and they want
**one** answer before anything else:

> **Can I keep driving, or do I stop?**

Everything else — causes, cost, advice — is secondary and can wait until they
scroll. If the design makes them read a paragraph to find that answer, the
design has failed. The verdict must be readable at arm's length, in one
glance, on a dim screen, by someone whose hands are not steady.

This is not a car-enthusiast app. It is not a dashboard of statistics. It is
closer to a first-aid instruction card than to a product tour.

### Screens to design

**1 — Camera (the home screen).** The app opens straight into the live camera.
There is no menu, no feed, no welcome. Full-bleed camera view, a framing
reticle made of four corner brackets in the centre, and one line of guidance
under it: *"Point the camera at the lit symbol on your dashboard"* / *"وجّه
الكاميرا على اللمبة اللي ولعت بالطبلون"*. A large shutter button at the
bottom centre, "Gallery" as a quiet text button to its left. Along the top, a
row of small, low-contrast pills: History, Light guide, Price check, and a
gear. The camera is the interface; the chrome must not compete with it.

**2 — Analysing.** The captured photo held on screen, dimmed, with a calm
progress state over it. A few seconds only. It must feel like the app is
working, not like it has hung.

**3 — Result — the critical case.** This is the most important screen in the
product. Design it for this exact content:

- Symbol: a flashing engine pictogram, drawn as a real dashboard glyph
- Title: **Check Engine — Flashing** / **لمبة المحرك ترمش**
- Subtitle in smaller Latin type: *Check Engine Light (Flashing)*
- A severity badge: **CRITICAL** — red
- **The verdict, given the most visual weight on the screen: "Stop driving."**
  It should be a band or a card that is impossible to miss or misread.
- A confidence indicator (high / medium / low)
- Summary: *"A flashing check engine light means the engine is misfiring right
  now and pushing unburned fuel into the exhaust. That can melt the catalytic
  converter within minutes."*
- **If you ignore this** — a distinct block naming the consequence
- **At a glance** — three or four label/value pairs
- **Likely causes** — a short list
- **What to do now** — a short list of instructions
- **See a mechanic if** — a short list
- **Estimated repair cost** — a range with currency, e.g. *45 – 190 KWD*, plus
  a line noting it varies by workshop and part
- **On your car** — one line reading the result against the driver's own
  vehicle (make, age, fuel type), because the app asked during onboarding
- If other lights were visible in the same photo, a small "also lit" list
- A disclaimer at the foot: guidance from a photo, not a technical diagnosis

Design the same screen in its **amber / "caution"** state and its **green /
"ok"** state, so the severity system is visible as a system.

**4 — Not detected.** The photo was not a dashboard, or was too dark or
blurry. Say so plainly and give one specific instruction on how to retake it.
This must not read as an error or a failure of the user.

**5 — Light guide.** A browsable, offline reference of **48 warning lights**.
A searchable list, each row showing the pictogram, the name, and a severity
dot. Tapping one opens the full entry. This is the screen that justifies a
subscription between emergencies.

**6 — Onboarding.** Four questions, one per screen, large type, big tappable
options: what do you drive / how old is it / petrol, diesel or electric /
what worries you most when a light comes on. Then a plain-language notice that
photos are analysed by AI, with consent.

**7 — Paywall.** Headline: *"Am I in trouble, and can I keep driving?"* /
*"أنا بورطة؟ وبقدر أكمل سواقة؟"* Five value lines. Two plans: Weekly $4.99
with a 3-day trial, and Yearly $29.99 marked "Best value" and preselected,
with the note *"Under $0.58 a week"*.

### Visual direction

Dark, calm, engineered, serious. Think automotive instrument cluster and
aviation checklist — not a consumer social app, and not a garage-poster
aesthetic. It should feel like an instrument the driver can trust at 1am.

Use exactly this palette:

- Background: `#0C0E13` — near-black, slightly blue
- Card / raised surface: a hair lighter than the background
- Border / divider: `#2A3039`
- Primary text: `#F2F4F8`
- Secondary text: `#9AA3B2`
- Faint text: `#69717F`
- Brand accent (amber): `#F2A33C`

The severity colours are a **language**, not decoration, and this is the rule
that matters most:

- **Red** = critical, stop driving
- **Amber** = warning, drive with caution
- **Green / blue** = information, no action

The brand accent is amber, which means amber cannot also mean "button". Pick a
distinct treatment for primary actions so a driver never mistakes a button for
a warning, or a warning for a button. Never use red anywhere it does not mean
danger.

### Typography and spacing

One clean, highly legible sans that supports **both Arabic and Latin in the
same family**, so a bilingual screen holds together. Big, unambiguous
hierarchy: verdict, then title, then body, then metadata. Generous line
height — this is read under stress. Numbers (costs, ranges) in tabular figures.

Spacing on a 4pt grid: 4 / 8 / 12 / 16 / 24 / 32 / 48. Give the content room;
a cramped safety screen reads as a cheap one.

### Hard requirements

1. **The app is fully bilingual, English and Arabic, and Arabic is not an
   afterthought.** Produce every screen in **both** languages. In Arabic the
   entire layout mirrors right-to-left — alignment, icon positions, back
   arrows, list indentation — not just the text direction.
2. **Never show a "safe to drive" verdict in a red or critical state.** The
   verdict and the severity must always agree.
3. **No fabricated data.** Use the real content given above. No lorem ipsum,
   no invented statistics, no fake charts.
4. **No dashboard-of-metrics screen.** This app has no analytics for the user.
5. **Touch targets at least 44pt.** One-handed use, in the dark, by someone
   who is rattled.
6. **Design for a small phone first** (390×844), then show how the result
   screen adapts on a larger one.

### Deliver

A screen set — camera, analysing, result (critical), result (caution), result
(ok), not-detected, light guide list, light guide entry, onboarding, paywall —
in both English and Arabic, laid out on one canvas, plus a small style sheet
showing the palette, the severity colours with their meanings, the type scale,
and the pictogram style.
