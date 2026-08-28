# Launch runbook — مصابيح السيارة (Dash Light)

Everything left before this app can be submitted, in the order it has to happen,
with the exact names and commands.

Every step carries one of three labels, because they are not the same kind of
thing and treating them alike wastes the time you have least of:

- **عائق — Blocks:** you cannot ship without it. Skipping it means the build
  refuses to be made, or App Review rejects the app. §§1, 2, 4.
- **خطر مؤجّل — Risk once live:** the app ships and works without it. It starts
  costing you the day real users can reach it, not before. §3.
- **Not a blocker:** something is wrong, but nothing stops. §6.

§§5, 7, 8 are the launch itself. §9 is the only one that decides whether the
product is any good.

Nothing here needs me. Everything that could be done from a container is done.

---

## 0. First, five minutes: revoke the leaked key

The `sk-ant-…` key was pasted into a chat. Treat it as public.

1. <https://console.anthropic.com> → **API keys** → revoke it → create a new one.
2. Clear it out of your shell history:
   ```bash
   sed -i '' '/sk-ant/d' ~/.zsh_history
   ```
3. Put the new one in `apps/scanner/.env` — **never in a chat window**:
   ```bash
   cd apps/scanner
   cp .env.example .env      # then edit .env
   ```
   `.env` is gitignored and this repository is public. Check before you commit:
   ```bash
   git check-ignore -v apps/scanner/.env    # must print a .gitignore line
   ```

---

## 1. Deploy the privacy pages, and open them in a browser

**عائق — Blocks:** a privacy policy that 404s is an automatic App Review
rejection.

The domain is now known and loaded: `https://luka-ai-psi.vercel.app`. Vercel
appended `-psi` because the bare name was taken, which is why the first guess in
`src/legal.ts` was wrong — it is now the default there, and
`EXPO_PUBLIC_SITE_URL` still overrides it when a custom domain is attached.

The pages exist in the Next.js app at the repo root — `app/privacy/[app]/`,
`app/terms/[app]/`, `app/support/[app]/`. All three take the app id, so a
reviewer opening Dash Light's terms reads Dash Light's terms and nothing about
gold hallmarks or lecture recordings.

```bash
# from the repo root
npx vercel --prod
```

Then open all three in a browser and read them:

- `https://<your-domain>/privacy/dashlight`
- `https://<your-domain>/terms/dashlight`
- `https://<your-domain>/support/dashlight`

If the domain is not `luka-ai.vercel.app`, put the real one in `.env`:

```
EXPO_PUBLIC_SITE_URL=https://your-real-domain.com
```

**Decided, 28 Aug 2026:** the support contact is `lukai.help@gmail.com`, one
address for all six apps, written once at `app/privacy/apps.ts`. It replaced a
personal Gmail, which was legal but published on the store listing.

That became worth doing when the distribution question was settled: **all
countries, including the EU**, which requires declaring trader status under the
Digital Services Act — name, address, phone and email displayed publicly on the
EU listing. The email is the one part of that exposure that can be reduced.

**Enter the same address in both other places**, or the store listing and the
legal pages disagree, which is a review finding: the DSA trader declaration
(App Store Connect → Business → the compliance banner), and the app record's
support and marketing contact.

---

## 2. Deploy the scan API, and pin its address

**عائق — Blocks:** without `EXPO_PUBLIC_API_URL`, a store build has no server to
reach and every scan fails. The build now refuses to be made at all rather than
shipping like that — `app.config.ts` throws on an EAS production build with the
variable unset — so this step cannot be skipped by accident.

The API is `apps/scanner/app/api/*+api.ts`, served by Expo's server output.

```bash
cd apps/scanner
npx expo export --platform web
npx eas deploy
```

Take the origin it prints and put it in `.env`:

```
EXPO_PUBLIC_API_URL=https://your-deployment.expo.app
```

**Then prove it works** — with a real image. Send a real photo:

```bash
set -a; source .env; set +a
IMG=$(base64 -i <some-photo>.jpg | tr -d '\n')
curl -sS -X POST "$EXPO_PUBLIC_API_URL/api/scan" \
  -H 'Content-Type: application/json' \
  -d "{\"packId\":\"dashlight\",\"locale\":\"ar\",\"base64\":\"$IMG\"}"
```

A JSON body containing `detected` — `true` with the light, or `false` with a
reason — is the feature working.

**Do not use the empty-payload version of this** (`-d '{"packId":"dashlight"}'`)
as the proof. It returns `No image received.` and reads like success, but the
route answers it before it ever calls the model, so it passes identically when
the API key is revoked and when the request the model gets is malformed. Both
of those happened on 28 Aug 2026, one after the other, and that curl reported
health through both. It tells you the route is deployed and nothing else.

What the failures look like, and what each means:

| Response | Cause |
| --- | --- |
| `الخدمة غير مهيّأة` | no `ANTHROPIC_API_KEY` in the deployment |
| `مفتاح الوصول على الخادم غير صالح` | the key is there and rejected — revoked, or the deployment predates the new one |
| `حدث خطأ في أثناء التحليل` | the model call itself failed. The route discards the reason; `node scripts/probe-scan.js <photo.jpg>` sends the same request and prints it |

A deployment reads its environment when it is created, so a key changed in
`.env` after the last deploy is not the key production is using. Redeploy.

---

## 3. Provision the shared rate limiter, and verify its wire format

**خطر مؤجّل — Risk once live.** Do this before you press Submit, not before
you build.

> **Done, and confirmed in production on 28 Aug 2026.** After the redeploy, one
> request to `/api/scan` produced `ratelimit:<caller-ip>` in the database with
> value `1` and a TTL of 57 minutes — the shared store is what the deployed
> Worker is counting in, the key prefix is namespaced, and `EXPIRE … NX` took.
> That last one is the failure that would have been invisible: without a TTL the
> key never expires, every address hits the limit once and stays locked out
> forever, and nothing logs a word about it.
>
> The steps below stand for the next database, or for the other two apps.

**Today the risk is zero.** The app is not on a store, and nobody but you knows
the API origin. Nothing here is stopping anything.

**The day it is published, the risk is real.** The paid routes are public and
unauthenticated — they have to be, the app ships no secret — and every call
spends money. The origin is visible to anyone who watches the app's own traffic,
so the only thing standing between a stranger's `while true` loop and your API
bill is the limiter.

And the limiter's `MAX_PER_WINDOW = 30` is not the number that gets enforced.
Without a shared counter it lives in one instance's memory, which fails in two
directions at once: the API runs as many Cloudflare instances, each with its own
count, so the real allowance is 30 × instances; and every deploy wipes them, so
it resets on its own.

1. Create a free Redis database at <https://console.upstash.com>. Pick the
   region closest to most of your users, not to you — the API is a Cloudflare
   Worker running everywhere, so the database is the one fixed point.

   An existing Upstash database from another project works too. Keys are
   namespaced `ratelimit:<client>`, so they cannot collide, and at three
   commands per request the free tier's 500k/month is roughly 166k scans — not
   a real ceiling at this size. The only cost of sharing is blast radius: flush
   or delete that database while working on the other project and this app's
   limiter silently drops back to memory.
2. On the database's **Details** tab, scroll to the **Connect** panel, choose
   the **REST** tab, and leave **Read-Only Token** unchecked — the limiter
   writes (`INCR`, `EXPIRE`), so a read-only token is refused. Reveal the token
   with the eye icon and copy. Put both into `.env`; the two lines are already
   there, commented out, carrying the example values — uncomment them and
   **replace the `xxx`**:
   ```
   UPSTASH_REDIS_REST_URL=https://<your-database>.upstash.io
   UPSTASH_REDIS_REST_TOKEN=<your-token>
   ```
   `https://xxx.upstash.io` is the placeholder, not an address. Leaving it there
   is what produces a bare `fetch failed` from the probe below.
3. **Reload the shell**, or it keeps whatever it read before the edit:
   ```bash
   cd apps/scanner
   set -a; source .env; set +a
   echo "$UPSTASH_REDIS_REST_URL"     # must print your database, not xxx
   ```
4. **Run the probe.** The Redis request was written without being able to
   reach Upstash's documentation — this container's network policy blocks the
   host — so this command is the only thing that confirms the shape. It passed
   on 28 Aug 2026 against `moved-dory-149679.upstash.io`; run it again for a
   new database:
   ```bash
   node scripts/check-ratelimit.js --probe "$UPSTASH_REDIS_REST_URL" "$UPSTASH_REDIS_REST_TOKEN"
   ```
   It prints the request, the raw response, and whether the shape matches what
   the code reads. If it fails, it says which part is wrong.
5. **Put both variables in the deployment's environment**, the same place
   `ANTHROPIC_API_KEY` went — the limiter runs in the deployed server, not on
   your machine, and a passing probe on your laptop says nothing about it. A
   deployment reads its environment when it is created, so set them *first*,
   then redeploy:
   ```bash
   npx expo export --platform web
   npx eas-cli@latest deploy --prod
   ```
6. **Prove production is using it.** Send one request to the deployed origin:
   ```bash
   curl -sS -X POST "$EXPO_PUBLIC_API_URL/api/scan" \
     -H 'Content-Type: application/json' -d '{"packId":"dashlight"}'
   ```
   `checkRateLimit` runs at `app/api/scan+api.ts:158`, before the key check
   (`:169`) and the image check (`:189`), so this costs nothing at the model and
   still spends one unit of the allowance.

   Then open the database's **Data Browser** and look for a key named
   `ratelimit:…`.

   - **Key there** → production wrote to the shared store. Done.
   - **No key** → it fell back to memory. Read the deployment log for
     `[rate-limit] shared store unavailable (…)`; the reason is in the
     parentheses, and it is logged once per instance, not once per request.

   Do not prove the limit by hitting it. `MAX_PER_WINDOW` is 30 an hour per IP,
   so the thirty-first request locks your own address out for the rest of the
   hour, and the key's presence is the same evidence for free.

Until it passes, nothing breaks — the limiter falls back to per-instance memory
and logs a warning once. That is what shipped before, so this is safe to leave
until the day you launch. It is just not safe to leave once you have.

---

## 4. Set up the subscription

**عائق — Blocks:** `purchasesAvailable()` is `false` in every build that exists,
so after `FREE_SCANS = 2` the user hits a wall with no way through. App Review
rejects that.

### 4a. The price — decided, 28 Aug 2026

**$4.99 a week and $29.99 a year, both with a 3-day trial.** Create exactly
these in App Store Connect; the app's `fallbackPrice` values are kept equal to
them so the paywall does not lie in the moment before RevenueCat answers.

The code used to carry $6.99 / $39.99, inherited from the gold-scanner idea in
`app-profit-research-2026.md:164`, while the same brief recommended $9.99 a
month for this app at line 170. Two things settled it.

**Cost had no opinion.** A scan is a 1024 px JPEG, a ~1160-token system prompt,
a ~505-token schema and ~1000 output tokens including thinking: about **4 cents**
on Opus 5, which is what the probe actually billed. Break-even at $4.99 a week is
over a hundred scans a week. Every candidate price was profitable by two orders
of magnitude, so unit economics could not choose.

**Usage frequency did.** A warning light comes on two to four times a year, so
this is a crisis app rather than a habit. Monthly is the worst fit — too dear to
buy on impulse, too short to retain. Weekly converts in the moment; yearly serves
the smaller group who want the guide and the history.

**Why the lower pair.** A weekly plan on a crisis app inevitably earns some of
its revenue from someone forgetting to cancel. That is worth being deliberate
about rather than pretending otherwise: a lower price means better conversion,
fewer refunds, fewer one-star reviews, and less exposure at review time. The
three defences already in the app — the 3-day trial, a paywall that states the
terms plainly, and a restore button that reports its outcome — are the rest of
that answer, and none of them should be weakened.

**Also do this:** enrol in **Apple's Small Business Program**. It cuts the
commission from 30% to 15% for anyone under $1M a year, it is free, and this
account qualifies. On $4.99 a week it is the difference between $3.49 and $4.24.

### 4b. Create the products

**App Store Connect → the app → Monetization → Subscriptions.** Apple moves
these labels; what matters is the shape, not the button names.

**One subscription group** holding both plans. A group is what lets a
subscriber move between weekly and yearly without cancelling, and Apple counts
the free trial per group — which is why both plans cannot each hand out a
separate trial, and why the paywall asks before promising one (§4e). The
group's reference name is internal; its **localized display name is shown to
buyers**, so set English and Arabic, as the app is bilingual.

Then two auto-renewable subscriptions inside it. The product ids are yours to
choose and the app never sees them — it reads RevenueCat's package
identifiers — so pick ones that stay legible in the RevenueCat dashboard:

| | Product id | Duration | Price (US) | Introductory offer |
|---|---|---|---|---|
| Weekly | `com.dashlight.scanner.weekly` | 1 week | $4.99 | Free trial, 3 days, all territories |
| Yearly | `com.dashlight.scanner.annual` | 1 year | $29.99 | Free trial, 3 days, all territories |

Set the US price and Apple fills the other storefronts from its own matrix.
Each product also needs a localized **display name and description** — these
appear in Apple's own purchase sheet and in Settings → Subscriptions, so write
them in both languages.

**The ordering trap.** Each subscription needs a **review screenshot of the
paywall** before it can be submitted, and you cannot take one until the paywall
runs — which needs the dev build in §5. So §4 and §5 interleave: create the
products and wire RevenueCat, build, screenshot the paywall, then come back and
attach it. Nothing here is wasted by doing it in that order; it just is not a
straight line.

The per-app trial lengths live in each pack's `storeTrialDays` (3 days for
dashlight, bugscan and goldscan; 7 for mahdar, womensfit and dogtrain). That
field is configuration intent only — no screen renders it, and
`npm run check:trial` fails if one starts to.

### 4c. Wire RevenueCat

1. Create the project, add an **App Store app**, bundle id
   `com.dashlight.scanner`.
2. **Give RevenueCat its App Store credential.** In App Store Connect,
   Users and Access → Integrations → In-App Purchase, generate a key and upload
   the `.p8` to RevenueCat (the app-specific shared secret is the older path and
   also works). Without it RevenueCat cannot validate receipts: purchases
   succeed at Apple, the entitlement never turns on, and the money has already
   moved. This step was missing from earlier drafts of this runbook.
3. Import both product ids from step 4b.
4. Create an **entitlement named exactly `pro`** — lowercase, no spaces — and
   attach both products. The app reads `pack.pricing.entitlement`, which is
   `"pro"` for all six packs.
5. Create an offering, **mark it current**, with two packages:
   - RevenueCat's standard `$rc_weekly` / `$rc_annual`, **or**
   - custom identifiers `weekly` / `annual`

   Either works — `RC_ALIASES` in `src/purchases.ts:29` maps the reserved
   spellings onto the pack's ids. If they match neither, the plan rows still
   render from the pack's own prices, but the trial, the "الأفضل" badge and the
   yearly note silently disappear.
6. Put the **public SDK keys** in `.env` — typed locally, never pasted into a
   chat, and `.env` stays git-ignored:
   ```
   EXPO_PUBLIC_RC_IOS_KEY=appl_xxx
   EXPO_PUBLIC_RC_ANDROID_KEY=goog_xxx
   ```
   These are safe to ship — they are public by design.

### 4d. Test it on a real device

`react-native-purchases` is a native module: **Expo Go cannot load it.** You
need a dev build (§5), and — because the trial is now conditional — **two
sandbox accounts**, or one used twice.

On a **fresh** sandbox account:

- [ ] the plans show the store's real prices, not the `$4.99` / `$29.99` fallbacks
- [ ] the yearly plan is preselected and shows its badge and note
- [ ] the CTA says "ابدأ تجربة 3 أيام" and the green reassurance box is there
- [ ] **cancelling Apple's sheet returns the button to normal** rather than
      leaving it spinning
- [ ] "استعادة عملية شراء سابقة" says something either way — Apple tests this

Then, on **the same account after taking the trial and cancelling**:

- [ ] the CTA says "اشترك", the green box is gone, and the price still reads
      $29.99

That second block is the case that would otherwise have shipped as a lie, and
it is the only one that cannot be checked from a keyboard. If the CTA still
offers a trial there, the eligibility call is not reaching Apple — check the
credential in step 4c.2 before anything else.

In dev, and in any build with no RevenueCat key, the CTA now reads "اشترك"
rather than offering a trial. That is correct: it is what an ineligible buyer
sees, and eligibility is unknowable without asking.

### 4e. Why the trial is not simply printed

Apple grants **one introductory offer per subscription group per Apple ID** —
not one per product. Someone who took the weekly trial, cancelled, and came
back for the yearly plan is ineligible, and the yearly plan is the one this
paywall preselects at $29.99.

The paywall used to read `trialDays` straight off the pack, so it promised the
trial to everyone. It now asks
`checkTrialOrIntroductoryPriceEligibility` and shows the promise only on an
explicit `ELIGIBLE`; `UNKNOWN` — which is what Android always returns, and what
iOS returns when it could not read the subscription group — counts as no, on
the SDK's own advice. It also requires the offer's price to be **zero**, so a
discounted introductory price is never sold as free.

`npm run check:trial` asserts that chain, because removing it leaves a paywall
that looks identical and charges returning customers who were promised nothing
would be charged.

---

## 5. Link the EAS project and make a build

```bash
cd apps/scanner
npx eas init          # writes extra.eas.projectId and owner into app.config.ts
npx expo install --check   # could not run in the container; the proxy blocks Expo's API
```

Build profiles are already written in `eas.json`, one set per app:

```bash
npx eas build --profile development           # dev build, Dash Light — needed for RevenueCat
npx eas build --profile preview               # internal test build
npx eas build --profile production            # store build
```

For the other two apps, append the name: `production:mahdar`,
`production:womensfit`. Build numbers come from EAS (`autoIncrement`), so you
never edit a version by hand — six apps share one `app.config.ts` and a
hardcoded number would be the same number for all of them.

---

## 6. Draw the two symbols

Two guide entries show the wrong picture, and in an app whose premise is
*match the shape on your dashboard*, that is the worst kind of wrong:

- **`oil-level-low`** shows the oil **pressure** can. Red "stop the engine now"
  and amber "top it up this week" are the same drawing, one row apart.
- **`transmission-overheat`** shows the **engine coolant** thermometer.

`symbol-specs.md`, beside this file, has a written brief for each — paste one block at a time
into whatever you generate with, the same way the 41 that shipped were made.
Send me the two PNGs and I will wire them in; it is five places and a contact
sheet to read.

Not a blocker. The app ships correctly without it — the pictures are just wrong
for two of forty-eight entries.

---

## 7. File the store listings

Outside the repository entirely. Both languages, since you are launching both:

- **Name (English):** `Dash Light Scanner` — the store name should be the
  keyword people search, not a clever name.
- **Name (Arabic):** `مصابيح السيارة`
- The home-screen icon already says `Dash Light` / `المصابيح` per device
  language — that is set, do not repeat it here.
- Description, keywords and screenshots in both languages. Screenshots are the
  single biggest lever on conversion; shoot them from a real device.

---

## 8. Before you press submit

- [ ] Open `<domain>/privacy/dashlight` one more time on the **production**
      domain, not the preview one
- [ ] A sandbox purchase completes and unlocks scanning
- [ ] Restore reports its outcome
- [ ] The AI-disclosure screen appears during onboarding — App Review has
      required it since Nov 2025, and it is already there
- [ ] The shared rate limiter is provisioned and its probe passes (§3)
- [ ] `npm run check` passes from `apps/scanner`

---

## 9. The one that actually matters

**Photograph a real dashboard, at night and in daylight.**

The README has said since the first commit that this has never been done once.
Everything else on this list is plumbing — it can be fixed after launch. This is
the test that tells you whether the product works at all: whether the model
reads a real warning light, on a real dashboard, through a real phone camera, in
the dark, held by someone who is worried.

Do it before you spend a dinar on ads. Try:

- a light you know the meaning of, so you can grade the answer
- a dim dashboard at night, with and without the torch
- a dashboard with two lights on at once
- a photo that is deliberately bad — blurry, too far — and check it says so
  rather than guessing

While you do it, watch the server log. Every scan now prints its token counts:

```json
{"scan":"dashlight","model":"claude-opus-5","effort":"high","inputTokens":…,"outputTokens":…}
```

That is your cost per scan. Multiply by the scans a subscriber makes in a month
and compare it to what you charge them. If the margin is thin, `SCAN_EFFORT` and
`DASHLIGHT_MODEL` are the two dials — but only turn them against measured
results. A wrong verdict on a dashboard costs more than the tokens that produced
it.
