import { locale } from "./i18n";

/**
 * Money, written the way the reader writes it.
 *
 * The cost estimate used to be printed as `{min} – {max} {currency}` with the
 * currency straight out of the model's answer — an Arabic abbreviation that an
 * English user read as `180 – 340 د.ك`, with no thousands separators and no
 * Arabic-Indic digits where those are expected.
 *
 * Two details that matter more than they look:
 *
 *   - **No fraction digits.** A repair estimate is a round number, and the
 *     three-decimal Gulf currencies would otherwise render `KD 180.000`.
 *   - **A fallback.** `Intl` with full currency data is present in Hermes on
 *     both platforms, but it is the kind of thing a runtime can ship without,
 *     and a thrown formatter would take down the whole result screen for the
 *     sake of a price. Every entry point falls back to the plain code.
 */
const nf = (currency: string) =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });

export function formatMoney(amount: number, currency: string): string {
  try {
    return nf(currency).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
}

/** A cost range. Both ends carry the currency: "KD 180 – KD 340" reads as two
 *  prices, which is what an estimate is, where "180 – 340 KD" reads as one. */
export function formatMoneyRange(min: number, max: number, currency: string): string {
  return `${formatMoney(min, currency)} – ${formatMoney(max, currency)}`;
}

/** Just the symbol, for places that label a currency rather than quote one. */
export function currencySymbol(currency: string): string {
  try {
    const part = nf(currency)
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}
