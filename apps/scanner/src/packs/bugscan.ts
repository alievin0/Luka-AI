import { L } from "../i18n";
import type { ScannerPack } from "./types";
import { BUGSCAN_LIBRARY } from "./bugscan-library";

export const bugscan: ScannerPack = {
  kind: "scanner",
  id: "bugscan",
  appName: L("Insect Identifier", "ماسح الحشرات"),
  tagline: L(
    "What is this bug? And is that bite dangerous?",
    "شو هالحشرة؟ وهاي القرصة خطيرة ولا لأ؟",
  ),
  accent: "#5BC08A",
  captureHint: L(
    "Get close to the insect or the bite",
    "صوّر الحشرة أو مكان اللدغة عن قرب",
  ),
  labels: {
    facts: L("At a glance", "معلومات سريعة"),
    causes: L("What to expect", "الأعراض المتوقعة"),
    actions: L("What to do now", "شو تعمل هلق"),
    seekHelp: L("Get medical help if", "روح على الطوارئ إذا"),
  },
  showCost: false,
  libraryTitle: L("Insect guide", "دليل الحشرات"),
  library: BUGSCAN_LIBRARY,
  disclaimer: L(
    "This is identification guidance from a photo, not a medical diagnosis, and it does not replace a doctor. If there is difficulty breathing, swelling of the face or throat, or severe dizziness — call emergency services immediately and do not wait.",
    "هذا تعريف استرشادي مبني على صورة، وليس تشخيصاً طبياً ولا يغني عن الطبيب. عند ظهور صعوبة تنفس أو تورم بالوجه أو الحلق أو دوخة شديدة — اتصل بالطوارئ فوراً ولا تنتظر.",
  ),
  onboarding: [
    {
      key: "target",
      question: L("What are you checking?", "شو بدك تفحص؟"),
      options: [
        L("An insect I saw", "حشرة شفتها"),
        L("A bite or sting on skin", "لدغة أو قرصة على الجلد"),
        L("Both", "التنتين"),
      ],
    },
    {
      key: "who",
      question: L("Who is it for?", "لمين؟"),
      options: [
        L("Me", "إلي"),
        L("A child", "لطفل"),
        L("An older adult", "لشخص كبير بالعمر"),
        L("Someone else", "لحدا تاني"),
      ],
    },
    {
      key: "allergy",
      question: L("Any known sting allergy?", "في حساسية معروفة من اللدغات؟"),
      options: [
        L("No", "لأ"),
        L("Yes", "أه"),
        L("Not sure", "ما بعرف"),
      ],
    },
  ],
  paywall: {
    headline: L("Know if it's dangerous — in seconds", "اعرف إذا كانت خطيرة — بثانية"),
    bullets: [
      L("Instant ID for insects and bites", "تعرّف فوري على الحشرات واللدغات"),
      L("A straight answer on whether it's dangerous", "جواب واضح: خطيرة ولا عادية"),
      L("First-aid steps you can follow now", "خطوات إسعاف أولي مباشرة"),
      L("A guide to 40 species worldwide, offline", "دليل 40 نوع عالمي بدون إنترنت"),
    ],
  },
  pricing: {
    entitlement: "pro",
    defaultProductId: "annual",
    products: [
      { id: "weekly", label: L("Weekly", "أسبوعي"), fallbackPrice: "$4.99", period: L("week", "أسبوع"), trialDays: 3 },
      {
        id: "annual",
        label: L("Yearly", "سنوي"),
        fallbackPrice: "$29.99",
        period: L("year", "سنة"),
        note: L("Under $0.58 a week", "أقل من $0.58 بالأسبوع"),
        badge: L("Best value", "الأوفر"),
      },
    ],
  },
  systemPrompt: ({ profile, locale }) => `You are an entomologist with first-aid training. Analyse a photo of an insect, arachnid, or a bite/sting on skin.

User context: ${profile || "unknown"}

WRITE EVERY USER-FACING STRING IN ${locale === "ar" ? "ARABIC (simple spoken Arabic anyone understands)" : "ENGLISH (plain and direct)"}.

Mandatory rules:
1. Identify the most likely species, or for a bite, the most likely culprit.
2. If the photo is not an insect or a bite, or is too blurry, return detected=false with clear instructions on retaking it.
3. SAFETY FIRST, AND THIS MATTERS MOST. If the creature is venomous or medically significant (scorpion, black widow, brown recluse, wasp/hornet for an allergic person, snake), severity="critical", verdictLevel="stop", and the first action must be to seek emergency care.
4. NEVER give a definitive medical diagnosis and never name a prescription medicine. General first-aid information only.
5. ALWAYS include anaphylaxis warning signs in seekHelpIf — difficulty breathing, swelling of face or throat, dizziness, spreading rash. That is an emergency regardless of species.
6. If unsure of the species, lower confidence and raise caution. Erring toward caution is fine; erring toward reassurance is not.

Field shapes:
- title: the common name
- subtitle: scientific or English name (always English, even in Arabic mode)
- verdict: one line answering their real question
- facts: 3–4 (venomous?, pain level, how long symptoms last, common in their region?)
- causes: 2–5 expected symptoms in time order
- actions: 2–5 practical first-aid steps in order
- seekHelpIf: 3–4 signs that need a doctor or emergency care now`,
};
