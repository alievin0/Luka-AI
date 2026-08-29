import { L } from "../i18n";
import type { ScannerPack } from "./types";
import { GOLDSCAN_LIBRARY } from "./goldscan-library";

export const goldscan: ScannerPack = {
  kind: "scanner",
  id: "goldscan",
  appName: L("Gold Buying Assistant", "مساعد شراء الذهب"),
  tagline: L(
    "Read the hallmark, then check whether the price you're being asked is fair",
    "اقرا الدمغة، وبعدها افحص إذا السعر المطلوب منك عادل",
  ),
  accent: "#D9A441",
  captureHint: L(
    "Get close to the hallmark stamped on the piece",
    "قرّب الكاميرا على الدمغة المحفورة على القطعة",
  ),
  labels: {
    facts: L("The piece", "معلومات القطعة"),
    causes: L("Watch out for", "علامات لازم تنتبهلها"),
    actions: L("What to do now", "شو تعمل هلق"),
    seekHelp: L("See a jeweller if", "روح على صائغ إذا"),
  },
  showCost: true,
  libraryTitle: L("Hallmark guide", "دليل الدمغات"),
  library: GOLDSCAN_LIBRARY,
  disclaimer: L(
    "This is guidance from a photo of a hallmark, not a certified appraisal or a certificate of authenticity. Real value depends on actual weight, the live gold price, and a jeweller's test. Never buy or sell on this estimate alone.",
    "هذا تقدير استرشادي مبني على صورة الدمغة، وليس تقييماً معتمداً ولا شهادة أصالة. القيمة الحقيقية بتعتمد على الوزن الفعلي وسعر الذهب اللحظي وفحص الصائغ. لا تشتري ولا تبيع بناءً على هذا التقدير وحده.",
  ),
  onboarding: [
    {
      key: "purpose",
      question: L("What are you doing?", "شو بدك تعمل؟"),
      options: [
        L("Buying a piece", "بدي أشتري قطعة"),
        L("Selling something I own", "بدي أبيع قطعة عندي"),
        L("Checking if it's real", "بدي أتأكد إنها أصلية"),
        L("Just curious", "بس فضول"),
      ],
    },
    {
      key: "itemType",
      question: L("What kind of piece?", "شو نوع القطعة؟"),
      options: [
        L("Ring", "خاتم"),
        L("Chain or bracelet", "سلسال أو أسورة"),
        L("Bar or coin", "سبيكة أو ليرة"),
        L("Full set", "طقم كامل"),
        L("Something else", "شي تاني"),
      ],
    },
    {
      key: "experience",
      question: L("How well do you know gold?", "قديش خبرتك بالذهب؟"),
      options: [
        L("First time", "أول مرة"),
        L("I buy occasionally", "بشتري من وقت للتاني"),
        L("I know the karats", "بفهم بالعيارات"),
        L("I work in the trade", "بشتغل بالمجال"),
      ],
    },
  ],
  paywall: {
    headline: L("Know what the gold is worth before you pay", "اعرف قديش بيسوى الذهب قبل ما تدفع"),
    bullets: [
      L("Is the making charge fair, or are you overpaying?", "المصنعية عادلة ولا إنت بتدفع زيادة؟"),
      L("Instant hallmark and karat reading", "قراءة فورية للدمغة والعيار"),
      L("Spots plated and gold-filled markings", "بيكشف الذهب المطلي والمغطى"),
      L("What you'd actually get selling it back", "قديش فعلاً بتاخذ لو بعتها"),
      L("A guide to 38 hallmarks worldwide, offline", "دليل 38 دمغة عالمية بدون إنترنت"),
    ],
  },
  pricing: {
    entitlement: "pro",
    defaultProductId: "annual",
    products: [
      { id: "weekly", label: L("Weekly", "أسبوعي"), fallbackPrice: "$7.99", period: L("week", "أسبوع"), storeTrialDays: 3 },
      {
        id: "annual",
        label: L("Yearly", "سنوي"),
        fallbackPrice: "$49.99",
        period: L("year", "سنة"),
        note: L("Under $0.96 a week", "أقل من $0.96 بالأسبوع"),
        badge: L("Best value", "الأوفر"),
      },
    ],
  },
  systemPrompt: ({ currency, profile, locale }) => `You are an expert in precious metals and hallmark identification. Analyse a photo of a gold item or the hallmark stamped on it.

User context: ${profile || "unknown"}
Currency for estimates: ${currency}

WRITE EVERY USER-FACING STRING IN ${locale === "ar" ? "ARABIC (simple spoken Arabic anyone understands)" : "ENGLISH (plain and direct)"}.

Mandatory rules:
1. Look for the stamped mark: millesimal numbers (999, 995, 916, 875, 750, 585, 375), karat stamps (24K–9K), or an assay/country mark.
2. Millesimal to karat: 999/995 = 24K, 916 = 22K, 875 = 21K, 750 = 18K, 585 = 14K, 375 = 9K. 21K is the Gulf default and 22K is common across South Asia — read the user's region for context.
3. If the mark is unreadable, the shot is too far, or it is blurry, return detected=false with precise instructions: get closer, use strong light, and look inside a ring band or at a chain's clasp where hallmarks usually sit.
4. WARN CLEARLY ABOUT PLATING. Marks such as GP, GEP, GF, HGE, RGP, 1/20 and "vermeil" mean plated or filled — NOT solid gold — and are worth a small fraction. On any of these: severity="critical", verdictLevel="stop", and the title must state plainly that it is not solid gold. This is the expensive mistake the app exists to prevent.
5. No hallmark at all does not prove a fake, but it warrants caution — raise the warning level and recommend a jeweller's test.
6. NEVER give a single definitive value. You do not know the weight or the live spot price. Give an estimated range PER GRAM in ${currency}, and state that final value = weight x live price, that making charges are added when buying and deducted when selling.
7. In actions, include checks the user can do themselves: the magnet test (gold is not magnetic), looking for wear at the edges where plating rubs through, and comparing weight against size.

Field shapes:
- title: the piece and its karat
- subtitle: the hallmark exactly as stamped (e.g. "875 / 21K")
- verdict: one line answering their real question
- facts: 3–4 (karat, purity %, gold colour, hallmark legibility)
- causes: 2–5 things to watch for on this specific piece
- actions: 2–5 practical steps in order
- seekHelpIf: 2–4 situations needing a certified jeweller
- cost: estimated range PER GRAM in ${currency}; the note must say it is per gram and that the spot price moves daily`,
};
