# Launch runbook — مصابيح السيارة (Dash Light)

Everything left before this app can be submitted, in the order it has to happen,
with the exact names and commands. Each step says **why** it blocks, so you can
tell a real blocker from a nice-to-have when you are short of time.

Steps 1–5 are blockers: skip one and the app either does not work or does not
pass review. Steps 6–8 are the launch itself. Step 9 is the only one that
decides whether the product is any good.

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

**Why it blocks:** a privacy policy that 404s is an automatic App Review
rejection. The app links to `https://luka-ai.vercel.app/privacy/dashlight`, a
URL inferred from the Vercel project name that **has never been loaded by
anyone** (`src/legal.ts:12-17` says so).

The pages exist in the Next.js app at the repo root — `app/privacy/[app]/`,
`app/terms/`, `app/support/`.

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

**Also decide:** the support contact is a personal Gmail
(`app/privacy/apps.ts:30`). It is legal, but it goes on a public store listing.

---

## 2. Deploy the scan API, and pin its address

**Why it blocks:** without `EXPO_PUBLIC_API_URL`, a store build has no server to
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

**Then prove it works** before trusting it — this is one command and it saves a
build cycle:

```bash
curl -sS -X POST "$EXPO_PUBLIC_API_URL/api/scan" \
  -H 'Content-Type: application/json' \
  -d '{"packId":"dashlight"}'
```

A JSON error about a missing image means the route is live and the key is set.
`الخدمة غير مهيّأة` / "This service isn't set up on the server yet" means the
deployment has no `ANTHROPIC_API_KEY` — set it in the EAS/Vercel dashboard, not
just in your local `.env`.

---

## 3. Provision the shared rate limiter, and verify its wire format

**Why it blocks:** the paid routes are public and unauthenticated, and every
call spends money. Without a shared counter the limit lives in one instance's
memory: it resets on every deploy and does not span instances, so N instances
mean N times the allowance.

1. Create a free Redis database at <https://console.upstash.com>. Pick the
   region closest to most of your users, not to you — the API is a Cloudflare
   Worker running everywhere, so the database is the one fixed point.
2. Open the database, find its **REST API** section, and copy the URL and token
   into `.env`. The two lines are already there, commented out, carrying the
   example values — uncomment them and **replace the `xxx`**:
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
4. **Run the probe.** I wrote the Redis request without being able to reach
   Upstash's documentation — this container's network policy blocks the host —
   so this command is what confirms the shape is right:
   ```bash
   node scripts/check-ratelimit.js --probe "$UPSTASH_REDIS_REST_URL" "$UPSTASH_REDIS_REST_TOKEN"
   ```
   It prints the request, the raw response, and whether the shape matches what
   the code reads. If it fails, it says which part is wrong.
5. **Put both variables in the deployment's environment**, the same place
   `ANTHROPIC_API_KEY` went — the limiter runs in the deployed server, not on
   your machine. Then redeploy, because a deployment reads its environment when
   it is created:
   ```bash
   npx expo export --platform web
   npx eas-cli@latest deploy --prod
   ```
   Skipping this is the quiet failure: the probe passes locally, and production
   is still counting in one instance's memory.

Until it passes, nothing breaks — the limiter falls back to per-instance memory
and logs a warning once. That is what shipped before, so this is safe to leave
until the day you launch. It is just not safe to leave forever.

---

## 4. Set up the subscription

**Why it blocks:** `purchasesAvailable()` is `false` in every build that exists,
so after `FREE_SCANS = 2` the user hits a wall with no way through. App Review
rejects that.

### 4a. Decide the price first

The app currently offers **$6.99/week** and **$39.99/year** with a 3-day trial
(`src/packs/dashlight.ts:126-141`). That shape came from the gold-scanner idea.
Your own market brief recommends **$9.99/month** for this app
(`app-profit-research-2026.md:170`, beside this file). One of the two is wrong. Decide now,
because the products you create in App Store Connect have to match, and renaming
them later is painful.

### 4b. Create the products

In **App Store Connect** (and Play Console if shipping Android), under the app
`com.dashlight.scanner`, create the auto-renewable subscriptions you decided on.
The store-side product ids are yours to choose — the app never sees them.

### 4c. Wire RevenueCat

1. Create the app in RevenueCat, attach the store products.
2. Create an **entitlement named exactly `pro`** — lowercase, no spaces. The app
   reads `pack.pricing.entitlement`, which is `"pro"` for all three apps.
3. Create an offering, and name its packages either way — the code accepts both:
   - RevenueCat's standard `$rc_weekly` / `$rc_annual` / `$rc_monthly`, **or**
   - custom identifiers `weekly` / `annual` / `monthly`

   If they match neither, the plan rows still render from the pack's own prices,
   but the trial, the "الأفضل" badge and the yearly note silently disappear.
4. Put the **public SDK keys** in `.env`:
   ```
   EXPO_PUBLIC_RC_IOS_KEY=appl_xxx
   EXPO_PUBLIC_RC_ANDROID_KEY=goog_xxx
   ```
   These are safe to ship — they are public by design.

### 4d. Test it on a real device

`react-native-purchases` is a native module: **Expo Go cannot load it.** You need
a dev build (step 5). Then, in an App Store sandbox account, check all four:

- [ ] the plans show the store's real prices, not `$6.99` / `$39.99`
- [ ] the yearly plan is preselected and shows its badge and note
- [ ] the CTA says "ابدأ تجربة 3 أيام", and **cancelling Apple's sheet returns
      the button to normal** rather than leaving it spinning
- [ ] "استعادة عملية شراء سابقة" says something either way — Apple tests this

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
