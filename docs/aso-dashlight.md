# App Store optimisation — Dash Light

The method in the ASO material is sound and most of it is already done here.
The revenue figure attached to it does not transfer to this category, and
saying so first is the difference between doing this work with the right
expectation and being disappointed by it.

## The method transfers. The numbers do not.

ASO pays where there is search volume. A calorie tracker or a water reminder is
searched by millions of people who have not decided which app they want — that
is the situation the whole technique is built for, and in that situation
ranking top-ten on a term is worth real money.

A dashboard warning light is not that situation. From `competitors-2026.md`:
the largest visible app in this category takes about **1,200 downloads a
month**, and that is roughly the ceiling of the category's organic search, not
one competitor's share of a larger pool. A warning light comes on two to four
times a year, so nobody browses for this app — they search it once, in an
emergency, and then not again for months.

So the honest expectation:

- ASO is worth doing here because it is **nearly free** and most of the work is
  already built — not because it will produce a four-figure month.
- The number it moves is Dash Light's **share** of a small, fixed demand.
- Nothing on this page is a substitute for §9 of the runbook. An app that reads
  a real dashboard badly will rank and refund.

## Already done

| | |
|---|---|
| App localised | eight languages, 491/491 strings, `check-locales.js` |
| Language picker in Settings | yes — the device language is a default, not a sentence |
| Store name in both scripts | `Dash Light Scanner` / `مصابيح السيارة` |
| Keyword direction | `competitors-2026.md` §"Finding it in the store" |
| Screenshot headline order | same file, six screens |

What did not exist until now is the listing copy itself, per storefront, with
Apple's character limits actually counted.

## The listing — `apps/scanner/store/aso.json`

Name, subtitle, keywords and six screenshot headlines for each of the eight
languages the app speaks. `npm run check:aso` enforces four things:

1. **Apple's limits** — name 30, subtitle 30, keywords 100, counted in
   characters rather than bytes, because a bullet and an emoji each cost one.
2. **Nothing indexed twice.** Apple reads name, subtitle and keywords as one
   bag. A word already in the name buys nothing in the keyword field and costs
   the characters an unindexed word would have used.
3. **One listing per language the app renders.** A ninth storefront would be a
   listing in a language the app does not speak, which turns a download into a
   refund and a one-star review. The count is read off `src/i18n/index.ts`, so
   adding a language to the app is what permits a listing.
4. **The app's own safety rule, in marketing.** Dash Light never states the car
   is safe — it is one photograph of one lamp and cannot see smoke, hear a
   bearing or feel the steering. `check-clamp.js` holds that line inside the
   app; nothing held it in the listing, which more people read and all of them
   read *first*. "Safe to drive" as a screenshot headline is the single easiest
   way to break the app's hardest invariant, in seven languages at once, with a
   passing build. It is now banned by name in each of them.

### The Arabic listing is not in Modern Standard Arabic, deliberately

The app is MSA and must stay MSA: a roadside instruction has to mean exactly
one thing. The **keyword field is a different surface** — it is not read, it is
matched against what people type, and people type «لمبات» and «الطبلون», not
«مصابيح» and «لوحة القيادة». So the store name leads with the searched form and
carries the formal one after it. The MSA rule governs what the app says, not
what the store matches.

### What I could not supply

**Keyword popularity.** Astro, AppTweak and Sensor Tower are all unreachable
from here, and every popularity figure any of them reports is a proxy for a
number Apple stopped publishing. So the keyword sets above are chosen for
**relevance and intent**, which is judgement, not measurement. Run them through
a real tool before filing, and change what the data disagrees with.

Two judgement calls worth knowing, in case a tool argues:

- **`obd` is deliberately absent.** It has volume, and it is wrong: Dash Light
  is a camera, not a dongle reader. Everyone who searches it and installs will
  bounce, and Apple ranks on what happens after the tap.
- **Broad terms like `car scanner` are absent** for the same reason — they
  describe a tool rather than the moment, and the moment is what this app owns.

## The item worth the most is not keywords

**Localise the price.** Dash Light already speaks eight languages, and the
roadside is where the app is most useful in exactly the countries where $29.99
a year is unreachable. There is no marginal cost per subscriber that makes a
lower price unprofitable here — the cost is per *scan*, about four cents, and a
subscriber who never scans costs nothing.

Three bands, set in App Store Connect per storefront (Apple snaps to its own
price points, so these are targets):

| Band | Weekly | Yearly | Storefronts |
|---|---|---|---|
| Full | $4.99 | $29.99 | US, Canada, UK, western Europe, Australia, NZ, Japan, Korea, Singapore, Hong Kong, Israel, Taiwan, **GCC** |
| −40% | ~$2.99 | ~$17.99 | Eastern Europe, Brazil, Mexico, Argentina, Chile, Colombia, **Turkey**, Malaysia, Thailand, South Africa |
| −70% | ~$1.49 | ~$8.99 | **Egypt, Morocco, Algeria, Tunisia, Jordan, Iraq**, Pakistan, India, Indonesia, Philippines, Vietnam, Nigeria, Kenya |

The bolded rows are the ones this app is actually built for: Arabic-speaking
storefronts where roadside assistance is scarce and a wrong decision costs a
gearbox. Charging Egypt the Kuwait price is the difference between some sales
and none.

**Never state the discount in the app.** A paywall reading "you got a discount"
is a review finding waiting to happen. The buyer sees their own price; that is
all.

This does not affect `fallbackPrice`. Those figures are labelled US dollars and
are only shown in the moment before RevenueCat answers; the store's own
localised price replaces them.

## Screenshots

The listing's conversion is decided here, not in the keyword field.

1. Run the app on a simulator and capture **six** real screens — camera, the
   verdict, the report, the guide list, a light entry, history.
2. Place each on an iPhone mockup over a flat background. Alternate two
   backgrounds down the set so the row reads with contrast at thumbnail size.
3. Burn in the headline for that screen from `store/aso.json`, per language.
   `check-aso.js` caps them at 38 characters so every language fits the box
   English fits.
4. Do the iPad set too — it is the same capture on a different simulator.

Two things that make this repeatable rather than a one-off afternoon: a debug
button that grants pro access, and one that seeds sample history. Without them
every re-shoot is a sandbox purchase.

**Do not generate the screenshots.** A fully synthetic store screenshot — phone,
interface and text invented together — reads as low quality to anyone under
sixty, and this app is asking to be trusted with a safety decision.

## Filing it

Metadata and builds both go up from the terminal rather than by hand; eight
languages by hand is where mistakes get made. Whatever tool does the upload,
the source of truth is `store/aso.json`, so a listing change is a diff.

One trap: **promo text can come back empty on a new version.** Check it after
every version bump; the previous version still has the text to copy.

And add a contact route in Settings before launch. Eight listings means mail in
eight languages, and most of it will not be in English.
