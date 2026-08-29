import { L, localeEnglishName } from "../i18n";
import type { ScannerPack } from "./types";
import { DASHLIGHT_LIBRARY } from "./dashlight-library";

export const dashlight: ScannerPack = {
  kind: "scanner",
  id: "dashlight",
  appName: L("Dash Light Scanner", "مصابيح السيارة"),
  tagline: L(
    "A light came on. Can you keep driving, and what will it cost?",
    "أضاء مصباح تحذيري. هل تستطيع متابعة القيادة؟ وكم سيكلّفك ذلك؟",
  ),
  accent: "#F2A33C",
  captureHint: L(
    "Point the camera at the lit symbol on your dashboard",
    "وجّه الكاميرا نحو المصباح المضاء في لوحة القيادة",
  ),
  labels: {
    facts: L("At a glance", "معلومات سريعة"),
    causes: L("Likely causes", "الأسباب المحتملة"),
    actions: L("What to do now", "ما العمل الآن"),
    seekHelp: L("See a mechanic if", "راجع الميكانيكي إذا"),
  },
  showCost: true,
  libraryTitle: L("Light guide", "دليل المصابيح"),
  library: DASHLIGHT_LIBRARY,
  disclaimer: L(
    "This is guidance from a photo, not a technical diagnosis. It does not replace inspection by a qualified mechanic — never rely on it alone for a safety decision.",
    "هذا تقدير استرشادي مبني على صورة، وليس تشخيصاً فنياً. لا يغني عن فحص ميكانيكي مختص، ولا تعتمد عليه وحده في قرار متعلق بالسلامة.",
  ),
  onboarding: [
    {
      key: "brand",
      question: L("What do you drive?", "ما نوع سيارتك؟"),
      // Grouped for the Gulf, where this ships first. Land Rover had no bucket
      // at all and is common here; GMC and Cadillac are too, and both behave
      // nothing like the Japanese saloons they were lumped in with. The
      // groups exist to give the model a useful prior, so a bucket that mixes
      // unrelated cars is worse than one more row.
      options: [
        L("Toyota / Lexus", "تويوتا / لكزس"),
        L("Nissan / Infiniti", "نيسان / إنفينيتي"),
        L("GMC / Chevrolet / Cadillac", "جي إم سي / شيفروليه / كاديلاك"),
        L("Ford / Lincoln", "فورد / لينكولن"),
        L("Hyundai / Kia", "هيونداي / كيا"),
        L("Land Rover / Jaguar", "لاند روفر / جاكوار"),
        L("Mercedes / BMW / Audi / VW", "مرسيدس / BMW / أودي / فولكس"),
        L("Honda / Mitsubishi / Mazda", "هوندا / ميتسوبيشي / مازدا"),
        L("Something else", "نوع آخر"),
      ],
    },
    {
      key: "model",
      question: L("Which model?", "ما طراز السيارة؟"),
      hint: L(
        "So the estimate is for your car, not for cars in general.",
        "لكي يكون التقدير مبنياً على سيارتك تحديداً، لا على السيارات عموماً.",
      ),
      input: { placeholder: L("Camry, Corolla, Patrol…", "كامري، كورولا، باترول…"), maxLength: 40 },
    },
    {
      key: "year",
      question: L("What year?", "ما سنة الصنع؟"),
      input: { placeholder: L("2019", "2019"), keyboard: "number-pad", maxLength: 4 },
    },
    {
      key: "age",
      question: L("How old is it?", "كم عمر السيارة؟"),
      options: [
        L("Under 3 years", "أقل من 3 سنوات"),
        L("3–7 years", "3 – 7 سنوات"),
        L("7–15 years", "7 – 15 سنة"),
        L("Over 15 years", "أكثر من 15 سنة"),
      ],
    },
    {
      key: "fuel",
      question: L("Petrol, diesel or electric?", "بنزين أم ديزل أم كهرباء؟"),
      options: [
        L("Petrol", "بنزين"),
        L("Diesel", "ديزل"),
        L("Hybrid", "هجينة"),
        L("Electric", "كهربائية"),
      ],
    },
    {
      key: "worry",
      question: L(
        "What worries you most when a light comes on?",
        "ما أكثر ما يقلقك عند إضاءة مصباح تحذيري؟",
      ),
      options: [
        L("Whether I can keep driving", "هل أستطيع متابعة القيادة"),
        L("How much it will cost", "كم سيكلّفني الإصلاح"),
        L("Whether the engine is at risk", "هل المحرك في خطر"),
        L("All of it", "كل ما سبق"),
      ],
    },
  ],
  paywall: {
    headline: L(
      "Am I in trouble, and can I keep driving?",
      "هل المشكلة خطيرة؟ وهل أستطيع متابعة القيادة؟",
    ),
    // Each line is a title and the promise under it, marked with the file
    // the design itself uses — see src/design-assets.ts.
    bullets: [
      {
        symbol: "benefitSeconds",
        text: L("In seconds", "خلال ثوانٍ"),
        detail: L("Photograph the light, get the answer", "صوّر المصباح واحصل على الجواب"),
      },
      {
        symbol: "benefitCar",
        text: L("Read on your car", "مخصّص لسيارتك"),
        detail: L("Sharper answers for your make and year", "نتائج أدق حسب نوع سيارتك"),
      },
      {
        // This line used to read "The whole guide — 48 warning lights,
        // offline". The guide is a free tab with no entitlement check
        // anywhere, so selling it was selling something the reader already
        // has. What the subscription buys is the scanning; the claim is now
        // about what the scanner will recognise.
        symbol: "benefitGuide",
        text: L("Every warning light", "كل المصابيح التحذيرية"),
        detail: L("The rare ones too, not only the familiar", "بما فيها النادرة، لا المألوفة فقط"),
      },
      {
        symbol: "benefitCost",
        text: L("What it costs", "تكلفة تقريبية"),
        detail: L("Know the repair before the workshop does", "اعرف الكلفة المتوقعة للإصلاح"),
      },
      {
        symbol: "benefitSteps",
        text: L("Clear steps", "خطوات واضحة"),
        detail: L("What to do now, in order", "ما العمل الآن، خطوة بخطوة"),
      },
    ],
  },
  /**
   * A warning light comes on two to four times a year, so this is a crisis
   * app and not a habit: the weekly plan is what converts in the moment, and
   * the yearly one serves the smaller group who want the guide and the
   * history. Monthly was rejected for being both too dear to buy on impulse
   * and too short to retain.
   *
   * Priced low on purpose. A scan costs about 4 cents to serve, so break-even
   * is over a hundred scans a week — cost has no opinion here, and what a
   * lower price buys instead is conversion, fewer refunds, and fewer people
   * paying only because they missed a renewal date. That last one is policy,
   * not a hoped-for side-effect: see the runbook's §4a.
   *
   * `fallbackPrice` is only what the paywall shows before RevenueCat answers.
   * The real prices come from the store, so changing a number here changes
   * nothing a customer is charged — App Store Connect has to be changed too,
   * and these have to be kept equal to it or the paywall lies for a moment.
   */
  pricing: {
    entitlement: "pro",
    defaultProductId: "annual",
    products: [
      {
        id: "annual",
        label: L("Yearly", "سنوي"),
        fallbackPrice: "$29.99",
        period: L("year", "سنة"),
        // Only the fallback. The paywall prefers the store's own
        // `pricePerWeekString`, so this is what shows before RevenueCat
        // answers — and it is the one number here that could go stale, since
        // nothing recomputes 29.99 / 52 when the yearly price moves.
        note: L("Under $0.58 a week", "أقل من $0.58 أسبوعياً"),
        badge: L("Best value", "الأفضل"),
        storeTrialDays: 3,
      },
      { id: "weekly", label: L("Weekly", "أسبوعي"), fallbackPrice: "$4.99", period: L("week", "أسبوع"), storeTrialDays: 3 },
    ],
  },
  systemPrompt: ({ currency, profile, locale }) => `You are a car mechanic. Analyse a photo of a vehicle dashboard and identify the illuminated warning light.

User context: ${profile || "unknown"}
Currency for estimates: ${currency}

WRITE EVERY USER-FACING STRING IN ${locale === "ar" ? "MODERN STANDARD ARABIC (فصحى) — clear and direct, at the level of a car owner's manual. Never colloquial or dialect. Use standard terms: مصباح تحذيري, لوحة القيادة, المحوّل الحفّاز, ناقل الحركة, المقود, العادم, غطاء المحرك" : `${localeEnglishName(locale).toUpperCase()} — plain and direct, at the level of a car owner's manual, using the words that country's drivers and garages actually use for these parts. No jargon without explanation, and never English words left untranslated where a normal term exists`}.

Mandatory rules:
1. Identify the most prominent LIT symbol. If several are lit, lead with the most dangerous.
2. If the photo is not a dashboard, no symbol is clearly lit, or it is blurry or too dark, return detected=false and put a specific instruction on how to retake it in "notDetectedReason" — name what was wrong with THIS photo, not generic advice. Everything else you return is discarded on that path, so keep the other fields to the shortest thing the schema will accept rather than guessing at a light you could not see.
3. SAFETY FIRST. If the light is red, or relates to oil pressure, engine temperature, brakes, or charging, severity MUST be "critical" and verdictLevel MUST be "stop". Never tell the user it is safe to continue driving in those cases.
3b. "roadside" is REQUIRED and answers a different question from verdictLevel: may the car be moved at all, right now? A brake failure and a flashing engine light are both "stop" and differ here.
   - "do-not-move": moving it risks a fire, a crash, or destroying the engine. Oil pressure, brake failure, severe overheating.
   - "move-to-safety": do not continue the journey, but reaching the hard shoulder or a car park is safer than stopping in traffic.
   - "drive-with-care": the journey may continue, at reduced speed or load, with a garage visit soon.
   - "monitor": nothing to change now; watch for the named symptom.
   Only these four; the app writes the instruction the driver sees, so choose the class and nothing else. If severity is "critical" you may not choose "drive-with-care" or "monitor".
4. Amber lights are normally "warning" with verdictLevel "caution". Green and blue are "info" and "ok".
5. If unsure which symbol it is, lower confidence and raise caution. Do not guess confidently.
6. Set "glyph" to the pictogram matching the light you identified, so the driver is shown the symbol and not only told about it. Choose from exactly these, or leave it out entirely if none of them is the light in the photo — a wrong symbol beside a correct answer makes the answer look wrong:
abs, airbag, battery, brake, bulb, catalytic, coolant, cruise, door-ajar, dpf, droplet, engine, epb, esc-off, ev-battery, ev-fault, ev-ready, fuel-pump, glow-plug, high-beam, hybrid, key, oil-can, oil-level-min, pad-wear, plug, radar-car, rear-fog, regen, seatbelt, skid-car, snowflake, spanner, start-stop, steering, suspension, thermometer, transmission-temp, turtle, tyre, warning-triangle, washer, water-in-fuel
7. "verdict" is the single largest thing on the result screen and the only thing many drivers will read. Write it as a short instruction in the imperative — "Stop driving now", "No need to stop, book a check this week", "No action needed" — never as a description of the light and never longer than about six words. "summary" sits directly beneath it as one plain sentence saying why.
   You are looking at one photo of one lamp. You cannot see smoke, smell fuel, hear a bearing, or feel the steering. So never write that the car is "safe" or "safe to drive": that is a claim about a vehicle you have not examined. Say what the lamp does or does not require — "no need to stop" — not what the car is.

8. Cost must be a realistic range in ${currency} for the user's market, noting that price varies by workshop and part. The user context above names their make, model and year where they gave it — price the repair for that car, not for cars in general, and say so in the note when the car changes the answer.
9. alsoDetected: list every other lit symbol in the same photo, most dangerous first. Leave empty if there are none.
10. ifIgnored is REQUIRED and is the field people are actually paying for. State the concrete consequence of driving on with this light, with a rough timescale — what breaks, and roughly how soon. Be specific and honest: "the engine can seize within minutes" for oil pressure; "the catalytic converter will need replacing, typically several hundred to a couple of thousand" for a flashing check engine; "nothing breaks, but you'll fail an inspection" where that is the truth. Never inflate a minor light into a catastrophe, and never soften a serious one.
11. carContext is REQUIRED whenever the user's brand, age or fuel type is known. Say what this specific light typically means on THAT car: a known common fault for the model, whether age makes a sensor failure more likely than a real fault, and anything fuel-specific (a DPF light means something different on a car used only for short trips). If you genuinely have nothing car-specific to add, say plainly that this light behaves the same across makes rather than inventing a detail.

Field shapes:
- title: the light's name
- subtitle: its standard English name (always English, even in Arabic mode)
- verdict: one line answering the driver's real question
- facts: 3–4 quick facts (colour, severity, how soon to act, drivable)
- causes: 2–5 likely causes, most likely first
- actions: 2–5 practical steps in order
- seekHelpIf: 2–4 situations needing a mechanic now
- ifIgnored: one or two sentences — the consequence and its timescale
- carContext: one or two sentences tied to their brand, age or fuel type`,
};
