# Who else sells this — August 2026

Written after finding that the market this app was designed for is not empty.
It exists to stop us re-deciding, six months from now, things that were settled
by looking.

**Caveat that governs everything below.** No reliable public revenue data was
found for any of these apps. Their existence proves competition and suggests
demand. It does not prove any of them makes money, and none of the numbers in
`app-profit-research-2026.md` were measured on this category.

---

## The commodity

| App | Where seen |
|---|---|
| Signal: Dashboard Lights | App Store |
| DashLightAI | App Store |
| Car Dashboard Light AI | App Store |
| AI DashScan | Google Play |
| CarLightFix | App Store |
| CarLightScan | web / store listing |
| Warning Light Camera | App Store, since 2019 |
| Car Aide AI | store listing |
| DashOrNOT | web app, not a store app |
| CarSight / Car Scanner AI | App Store |
| CarSense: AI Car Diagnostics | App Store |
| Clarafiy, FixioCar, CarVet | broader "AI mechanic" platforms |

Between them they already ship: photograph the lamp → identify → severity →
"can I keep driving?" → likely causes → repair-cost estimate → history →
multiple vehicles.

**So "AI dashboard light scanner" is a feature, not a product.** Warning Light
Camera has been doing the core of it since 2019. AI made the identification
easier; it did not create the market.

Shipping that list and nothing else makes us the twelfth clone.

## The three gaps

Found by reading what they advertise, not their screens — the App Store is
unreachable from the build environment, so nobody here has seen their paywalls.

**1. Every one of them stops at the verdict.** Not one advertises anything
about the next minute: whether the car may be moved at all, whether the driver
is somewhere safe, how to get somewhere safe. This is the wedge, and it is now
the top of our result screen.

**2. Nobody claims a local price.** They all say "repair cost estimate", which
is a converted general figure. See the rule below — we do not claim better yet.

**3. Nobody states uncertainty.** No competitor advertises a confidence level
or an "I could not read this photo" path. Both have shipped here since the
first build. In a category where a wrong answer is a safety event, saying how
sure you are is a feature.

Arabic is a fourth gap — several are English-only — but on its own it is a
translation, not a moat.

## The price finding

Signal, the closest direct competitor, lists **$4.99 per month** and $29.99 per
year.

| | Dash Light | Signal | |
|---|---|---|---|
| Yearly | $29.99 | $29.99 | parity |
| Short plan | $4.99 / **week** | $4.99 / **month** | **4.3× dearer** |

Both display "$4.99". A shopper reads the number before the period, and the
App Store shows in-app purchase prices on the listing page, so the comparison
is available before install.

This is a known, deliberate position rather than an oversight: the yearly plan
is preselected, listed first, and at parity. Both plans are quoted per week on
the paywall so the difference is stated rather than hidden. The number to watch
after launch is **trial-to-paid per plan**, which RevenueCat reports natively.

## The rule about repair cost

The app localises the *currency*. It does not have local *prices*.
`currencyFor(profile)` and the prompt's `Currency for estimates` make the model
answer in KWD; the model is still converting a general estimate.

**So the app may say "تقدير" and show the user's currency. It may not say
"النطاق المعتاد في الكويت", or anything else implying the figure came from
Kuwaiti garages, until parts prices, labour rates and real quotes have actually
been collected.** Claiming it before then is precisely what this file criticises
the competitors for.

That data is the moat. Arabic can be translated in a sprint and the roadside
layer can be copied in two. Local price data cannot be, and it is the one thing
on our list a competitor in San Francisco cannot build from where they sit.

## What is already built, and what is not

Written down because the feature list above is easy to read as a backlog, and
most of it is not one.

**Shipped:** camera, identification, safety verdict, the roadside decision and
its two questions, confidence, vehicle profile, history, the 48-light guide,
the paywall. That is V1, and it is complete.

**The guide already works offline.** `src/packs/dashlight-library.ts` is 48
entries compiled into the bundle; neither the list nor the entry screen calls
the network. Matching Signal on offline reference needed no work — it was true
already. Only the scan itself needs a connection, and it always will.

**Confidence is three levels, not a percentage.** The model returns
`high | medium | low`; there is no 94% anywhere in the system. Printing one
would be inventing precision, which is the same mistake the analysing screen
already refuses — it shows an indeterminate ring rather than the design's
mocked "72%", because the scan API reports no progress. A fabricated confidence
figure is worse than that in a safety category: it is exactly the false
authority this file criticises elsewhere. If a number is genuinely wanted, the
honest route is to ask the model for a calibrated one and then check whether it
is calibrated — which is a research task, not a UI change.

**V1.5 — the local cost engine.** Parts, labour, real quotes, by city and by
model. Not to be started with invented data. See §4a-1 of the runbook for the
rule that governs what the app may claim before that data exists.

**V2 — the quote checker.** Photograph the garage's quote, compare it against
the local range, and hand the driver the questions to ask. It cannot be built
before V1.5: without real local prices there is nothing to check a quote
against, and a checker that guesses would send people to argue with a mechanic
on the strength of a converted American average.

**Deliberately not built:** OBD, live gauges, diagnostic codes, a metrics
dashboard. CarSense and CarSight are already there, and adding it in year one
buys a worse version of their product at the cost of the one thing this app is
clear about.

## Finding it in the store

Not "car scanner" — too broad, too crowded, and it describes the tool rather
than the moment. The set worth owning is narrow and specific:

```
dashboard warning light · car warning light · check engine light
dashboard lights · لمبات السيارة · لمبات الطبلون · لمبة المحرك
```

Apple ranks on relevance, downloads, ratings and reviews together, so the
keyword set is the start and not the plan. Search Ads buys visibility on those
terms while the organic ranking is built by reviews.

## The store listing

Sell the outcome, not the technology — nobody buys "AI-powered".

> **لمبات السيارة**
> صوّر اللمبة. اعرف ماذا تفعل.

Screens in this order, each selling the moment rather than the technology:

1. ولعت اللمبة؟ اعرف ماذا تفعل الآن.
2. 🔴 أوقف · 🟠 انتبه · 🟢 لا تحتاج إجراء
3. صوّرها ← اعرف القرار
4. على سيارتك أنت
5. اعرف تكلفة الإصلاح
6. لا تعرف اللمبة؟ ابحث عنها

## Distribution

Sell the situation, never the model behind it. Nobody buys "our revolutionary
AI"; they buy knowing whether to keep driving.

The hook has to work without the app installed. "إذا هذه اللمبة اشتعلت عندك، لا
تُكمل القيادة" is a video somebody watches to the end; "AI dashboard scanner"
is not. Then the seven-second form the research brief already describes:
problem → screen → one action.

## What we are not trying to win

CarSight, CarSense and Clarafiy are becoming general AI mechanics — OBD, codes,
live data, vehicle health, recalls, workshops. We will not beat them at that in
year one and should not try. The target is narrower and marketable:

**the best app in the world for the minute after a warning light comes on.**

Widen later, in this order: warning light → roadside help → vehicle profile →
repair cost → workshop quote → maintenance.
