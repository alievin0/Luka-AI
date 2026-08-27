import { L } from "../i18n";
import type { ScannerPack } from "./types";
import { DASHLIGHT_LIBRARY } from "./dashlight-library";

export const dashlight: ScannerPack = {
  kind: "scanner",
  id: "dashlight",
  appName: L("Dash Light Scanner", "لمبات السيارة"),
  tagline: L(
    "A light came on. Can you keep driving, and what will it cost?",
    "ولعت لمبة. بتقدر تكمل سواقة؟ وقديش رح تكلفك؟",
  ),
  accent: "#F2A33C",
  captureHint: L(
    "Point the camera at the lit symbol on your dashboard",
    "وجّه الكاميرا على اللمبة اللي ولعت بالطبلون",
  ),
  labels: {
    facts: L("At a glance", "معلومات سريعة"),
    causes: L("Likely causes", "الأسباب المحتملة"),
    actions: L("What to do now", "شو تعمل هلق"),
    seekHelp: L("See a mechanic if", "روح على الميكانيكي إذا"),
  },
  showCost: true,
  libraryTitle: L("Light guide", "دليل اللمبات"),
  library: DASHLIGHT_LIBRARY,
  disclaimer: L(
    "This is guidance from a photo, not a technical diagnosis. It does not replace inspection by a qualified mechanic — never rely on it alone for a safety decision.",
    "هذا تقدير استرشادي مبني على صورة، وليس تشخيصاً فنياً. لا يغني عن فحص ميكانيكي مختص، ولا تعتمد عليه وحده في قرار متعلق بالسلامة.",
  ),
  onboarding: [
    {
      key: "brand",
      question: L("What do you drive?", "شو نوع سيارتك؟"),
      options: [
        L("Toyota / Lexus", "تويوتا / لكزس"),
        L("Ford / Chevrolet", "فورد / شيفروليه"),
        L("VW / Audi / BMW / Mercedes", "فولكس / أودي / BMW / مرسيدس"),
        L("Hyundai / Kia / Nissan", "هيونداي / كيا / نيسان"),
        L("Something else", "شي تاني"),
      ],
    },
    {
      key: "age",
      question: L("How old is it?", "قديش عمر السيارة؟"),
      options: [
        L("Under 3 years", "أقل من ٣ سنين"),
        L("3–7 years", "٣ – ٧ سنين"),
        L("7–15 years", "٧ – ١٥ سنة"),
        L("Over 15 years", "أكثر من ١٥ سنة"),
      ],
    },
    {
      key: "fuel",
      question: L("Petrol, diesel or electric?", "بنزين، ديزل، ولا كهربا؟"),
      options: [
        L("Petrol", "بنزين"),
        L("Diesel", "ديزل"),
        L("Hybrid", "هايبرد"),
        L("Electric", "كهربائية"),
      ],
    },
    {
      key: "worry",
      question: L(
        "What worries you most when a light comes on?",
        "شو أكثر شي بقلقك لما تولع لمبة؟",
      ),
      options: [
        L("Whether I can keep driving", "إذا بقدر أكمل سواقة"),
        L("How much it will cost", "قديش رح تكلفني"),
        L("Whether the engine is at risk", "إذا في خطر على المحرك"),
        L("All of it", "كلهم"),
      ],
    },
  ],
  paywall: {
    headline: L(
      "Am I in trouble, and can I keep driving?",
      "أنا بورطة؟ وبقدر أكمل سواقة؟",
    ),
    // Each glyph matches what its own line promises: the verdict, the
    // consequence, the car, the estimate, the guide.
    bullets: [
      {
        glyph: "✓",
        text: L("A straight answer on whether it's safe to drive", "جواب واضح: تقدر تكمل سواقة ولا لأ"),
      },
      {
        glyph: "!",
        text: L("What actually happens if you ignore it", "شو بيصير فعلياً إذا تجاهلتها"),
      },
      {
        glyph: "⚙",
        text: L("Read against your own car, not a generic manual", "مقروءة على سيارتك إنت مش على دليل عام"),
      },
      {
        glyph: "≈",
        text: L("Repair cost estimated in your currency", "تقدير كلفة التصليح بعملة بلدك"),
      },
      {
        glyph: "▤",
        text: L("A guide to 48 warning lights, offline", "دليل ٤٨ لمبة تحذيرية بدون إنترنت"),
      },
    ],
  },
  pricing: {
    entitlement: "pro",
    defaultProductId: "annual",
    products: [
      { id: "weekly", label: L("Weekly", "أسبوعي"), fallbackPrice: "$6.99", period: L("week", "أسبوع"), trialDays: 3 },
      {
        id: "annual",
        label: L("Yearly", "سنوي"),
        fallbackPrice: "$39.99",
        period: L("year", "سنة"),
        note: L("Under $0.77 a week", "أقل من $0.77 بالأسبوع"),
        badge: L("Best value", "الأوفر"),
      },
    ],
  },
  systemPrompt: ({ currency, profile, locale }) => `You are a car mechanic. Analyse a photo of a vehicle dashboard and identify the illuminated warning light.

User context: ${profile || "unknown"}
Currency for estimates: ${currency}

WRITE EVERY USER-FACING STRING IN ${locale === "ar" ? "ARABIC (simple spoken Arabic any driver understands — not formal MSA)" : "ENGLISH (plain, direct, no jargon without explanation)"}.

Mandatory rules:
1. Identify the most prominent LIT symbol. If several are lit, lead with the most dangerous.
2. If the photo is not a dashboard, no symbol is clearly lit, or it is blurry or too dark, return detected=false with a specific instruction on how to retake it.
3. SAFETY FIRST. If the light is red, or relates to oil pressure, engine temperature, brakes, or charging, severity MUST be "critical" and verdictLevel MUST be "stop". Never tell the user it is safe to continue driving in those cases.
4. Amber lights are normally "warning" with verdictLevel "caution". Green and blue are "info" and "ok".
5. If unsure which symbol it is, lower confidence and raise caution. Do not guess confidently.
6. Set "glyph" to the pictogram matching the light you identified, so the driver is shown the symbol and not only told about it. Choose from exactly these, or leave it out entirely if none of them is the light in the photo — a wrong symbol beside a correct answer makes the answer look wrong:
abs, airbag, battery, brake, bulb, catalytic, coolant, cruise, door-ajar, dpf, droplet, engine, epb, esc-off, ev-battery, ev-fault, ev-ready, fuel-pump, glow-plug, high-beam, hybrid, key, oil-can, pad-wear, plug, radar-car, rear-fog, regen, seatbelt, skid-car, snowflake, spanner, start-stop, steering, suspension, thermometer, turtle, tyre, warning-triangle, washer, water-in-fuel
7. "verdict" is the single largest thing on the result screen and the only thing many drivers will read. Write it as a short instruction in the imperative — "Stop driving now", "Safe to keep driving, get it checked this week", "No action needed" — never as a description of the light and never longer than about six words. "summary" sits directly beneath it as one plain sentence saying why.

8. Cost must be a realistic range in ${currency} for the user's market, noting that price varies by workshop and part.
7. alsoDetected: list every other lit symbol in the same photo, most dangerous first. Leave empty if there are none.
8. ifIgnored is REQUIRED and is the field people are actually paying for. State the concrete consequence of driving on with this light, with a rough timescale — what breaks, and roughly how soon. Be specific and honest: "the engine can seize within minutes" for oil pressure; "the catalytic converter will need replacing, typically several hundred to a couple of thousand" for a flashing check engine; "nothing breaks, but you'll fail an inspection" where that is the truth. Never inflate a minor light into a catastrophe, and never soften a serious one.
9. carContext is REQUIRED whenever the user's brand, age or fuel type is known. Say what this specific light typically means on THAT car: a known common fault for the model, whether age makes a sensor failure more likely than a real fault, and anything fuel-specific (a DPF light means something different on a car used only for short trips). If you genuinely have nothing car-specific to add, say plainly that this light behaves the same across makes rather than inventing a detail.

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
