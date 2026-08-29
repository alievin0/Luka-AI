/**
 * The gold buying assistant's maths.
 *
 * A photo cannot tell solid gold from plated — only an acid, XRF or density
 * test can. So the app stops claiming to "test" gold and does the thing a
 * buyer actually needs at the counter: read the stamp for what it is worth,
 * then check whether the price being asked is fair.
 *
 * That second part is where the money is. Across the Gulf and South Asia a
 * piece is priced as (weight x spot x purity) + a making charge, and the
 * making charge is where buyers are quietly overcharged — it is negotiable,
 * unregulated, and rarely itemised.
 */

/** Millesimal fineness by karat — the fraction of the piece that is gold. */
export const PURITY: Record<number, number> = {
  24: 0.999,
  22: 0.916,
  21: 0.875,
  18: 0.75,
  14: 0.585,
  10: 0.4167,
  9: 0.375,
};

export const KARATS = [24, 22, 21, 18, 14, 10, 9];

export type Quote = {
  /** Grams. */
  weight: number;
  karat: number;
  /** Spot price per gram of pure (24K) gold, in the user's currency. */
  spotPerGram: number;
  /** What the seller is asking, total. Optional — omit to just value it. */
  askingPrice?: number;
};

export type Valuation = {
  /** Pure gold content in grams. */
  goldGrams: number;
  /** What the metal alone is worth. */
  metalValue: number;
  /** Asking price minus metal value — the making charge, if a price was given. */
  makingCharge: number | null;
  /** Making charge as a percentage of metal value. */
  makingPercent: number | null;
  /** Where that lands against what jewellers typically charge. */
  verdict: "fair" | "high" | "very-high" | "below-metal" | "unknown";
  /** Roughly what you would be paid selling it back today. */
  scrapValue: number;
};

/**
 * Typical making charges run 8–20% of metal value for machine-made pieces and
 * 20–35% for handmade or branded work. Past 40% the buyer is paying for the
 * shop, not the gold — which is the thing worth telling them.
 */
const FAIR_MAX = 20;
const HIGH_MAX = 40;

/** Buy-back is quoted on metal only, usually a few percent under spot. */
const SCRAP_DISCOUNT = 0.95;

export function valuate({ weight, karat, spotPerGram, askingPrice }: Quote): Valuation {
  const purity = PURITY[karat] ?? 0;
  const goldGrams = weight * purity;
  const metalValue = goldGrams * spotPerGram;
  const scrapValue = metalValue * SCRAP_DISCOUNT;

  if (askingPrice === undefined || metalValue <= 0) {
    return {
      goldGrams,
      metalValue,
      makingCharge: null,
      makingPercent: null,
      verdict: "unknown",
      scrapValue,
    };
  }

  const makingCharge = askingPrice - metalValue;
  const makingPercent = (makingCharge / metalValue) * 100;

  const verdict: Valuation["verdict"] =
    makingCharge < 0
      ? "below-metal"
      : makingPercent <= FAIR_MAX
        ? "fair"
        : makingPercent <= HIGH_MAX
          ? "high"
          : "very-high";

  return { goldGrams, metalValue, makingCharge, makingPercent, verdict, scrapValue };
}

/** Rounds money for display without pretending to more precision than we have. */
export const money = (n: number) =>
  n >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toFixed(2);
