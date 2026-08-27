import { L } from "../i18n";
import type { ScannerPack } from "./types";
import { DASHLIGHT_LIBRARY } from "./dashlight-library";

export const dashlight: ScannerPack = {
  kind: "scanner",
  id: "dashlight",
  appName: L("Dash Light Scanner", "لمبات السيارة"),
  tagline: L(
    "Photograph the light on your dash — know what it means and what it costs",
    "صوّر اللمبة اللي ولعت — واعرف شو معناها وقديش تصليحها",
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
      "Know what it means before it costs you",
      "اعرف شو معناها قبل ما تكلفك",
    ),
    bullets: [
      L("Instant ID for any dashboard warning light", "تعرّف فوري على أي لمبة تحذيرية"),
      L("A straight answer on whether it's safe to drive", "جواب واضح: تقدر تكمل سواقة ولا لأ"),
      L("Repair cost estimated in your currency", "تقدير كلفة التصليح بعملة بلدك"),
      L("A guide to 48 warning lights, offline", "دليل ٤٨ لمبة تحذيرية بدون إنترنت"),
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
6. Cost must be a realistic range in ${currency} for the user's market, noting that price varies by workshop and part.
7. alsoDetected: list every other lit symbol in the same photo, most dangerous first. Leave empty if there are none.

Field shapes:
- title: the light's name
- subtitle: its standard English name (always English, even in Arabic mode)
- verdict: one line answering the driver's real question
- facts: 3–4 quick facts (colour, severity, how soon to act, drivable)
- causes: 2–5 likely causes, most likely first
- actions: 2–5 practical steps in order
- seekHelpIf: 2–4 situations needing a mechanic now`,
};
