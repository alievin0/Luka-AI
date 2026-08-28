import { Alert, Platform } from "react-native";
// Type-only, so it is erased at compile time and pulls in no native
// module — the whole reason the runtime import below is lazy.
import type { PurchasesIntroPrice } from "react-native-purchases";
import { t } from "./i18n";
import { ui } from "./i18n/ui";
import { pack } from "./packs";

/**
 * Thin RevenueCat wrapper.
 *
 * react-native-purchases is a native module, so it cannot run in Expo Go.
 * Until you make a dev build (`npx expo run:ios` / EAS build) and set the
 * EXPO_PUBLIC_RC_* keys, this falls back to "no entitlement, purchases
 * unavailable" — which keeps the whole app testable today.
 */

const IOS_KEY = process.env.EXPO_PUBLIC_RC_IOS_KEY;
const ANDROID_KEY = process.env.EXPO_PUBLIC_RC_ANDROID_KEY;
/** The pack declares the entitlement its paywall sells; there is no second
 *  source of truth for it. */
const ENTITLEMENT = pack.pricing.entitlement;

/**
 * RevenueCat's predefined packages carry reserved identifiers, not the ids a
 * pack declares. An offering built from the standard durations comes back as
 * `$rc_annual`, so matching it against the pack's `annual` fails — silently,
 * because a missing match only means the trial, badge and note stop rendering.
 * Custom packages keep whatever identifier they were given, so both spellings
 * have to work.
 */
const RC_ALIASES: Record<string, string> = {
  $rc_weekly: "weekly",
  $rc_monthly: "monthly",
  $rc_two_month: "two_month",
  $rc_three_month: "three_month",
  $rc_six_month: "six_month",
  $rc_annual: "annual",
  $rc_lifetime: "lifetime",
};

const productIdFor = (identifier: string) => RC_ALIASES[identifier] ?? identifier;

const apiKey = Platform.OS === "ios" ? IOS_KEY : ANDROID_KEY;

type PurchasesModule = typeof import("react-native-purchases").default;

let Purchases: PurchasesModule | null = null;
let configured = false;

/** True once RevenueCat is actually wired up on a native build. */
export function purchasesAvailable() {
  return Boolean(apiKey) && Purchases !== null;
}

export async function initPurchases() {
  if (configured || !apiKey) return;
  try {
    Purchases = require("react-native-purchases").default as PurchasesModule;
    await Purchases.configure({ apiKey });
    configured = true;
  } catch {
    // Expo Go, or the native module isn't linked yet — stay in free mode.
    Purchases = null;
  }
}

export async function isPro(): Promise<boolean> {
  if (!purchasesAvailable() || !Purchases) return false;
  try {
    const info = await Purchases.getCustomerInfo();
    return typeof info.entitlements.active[ENTITLEMENT] !== "undefined";
  } catch {
    return false;
  }
}

/**
 * A live price for one of the pack's products, and whether this person can
 * actually have the free trial.
 *
 * Only the price comes from the store. The title and period are the pack's
 * own `Text` pairs — RevenueCat returns `product.title` as whatever was typed
 * into App Store Connect and `packageType` as a bare enum (`ANNUAL`), and
 * printing either puts untranslated English on an Arabic paywall.
 */
export type Offer = { id: string; price: string; freeTrialDays: number | null };

/** What one unit of an introductory offer's period is worth in days. */
const DAYS_PER_UNIT: Record<string, number> = {
  DAY: 1,
  WEEK: 7,
  MONTH: 30,
  YEAR: 365,
};

/**
 * How long this product's *free* trial runs, in days, or null for no free
 * trial at all.
 *
 * Two things are being separated here. `introPrice` is present for any
 * introductory offer, and a discounted one — a first week at $0.99 — is not a
 * free trial. Selling that as "مجاناً" is the same false claim in a smaller
 * font, so a non-zero price returns null.
 *
 * The length is the store's own, not the pack's, for the same reason the price
 * is: the number on screen should be the number the buyer will be charged
 * against. `cycles` is 1 for an Apple free trial, but an offer that repeats
 * runs for its period that many times, so it is multiplied rather than assumed.
 */
function freeTrialDays(product: { introPrice: PurchasesIntroPrice | null }): number | null {
  const intro = product.introPrice;
  if (!intro || intro.price !== 0) return null;
  const perUnit = DAYS_PER_UNIT[String(intro.periodUnit).toUpperCase()];
  if (!perUnit || !intro.periodNumberOfUnits) return null;
  return perUnit * intro.periodNumberOfUnits * (intro.cycles || 1);
}

/**
 * Which of these store products Apple will actually grant the trial on.
 *
 * Apple gives one introductory offer per *subscription group*, not per
 * product, so someone who took the weekly trial and cancelled is ineligible on
 * the yearly plan too — the plan the paywall preselects, at $29.99. Asking is
 * the only way to know; the pack cannot.
 *
 * Anything short of an explicit yes counts as no. `UNKNOWN` is what the SDK
 * returns when it could not collect the subscription group, and what Android
 * returns always; its own documentation says to show the non-intro pricing
 * there rather than create a misleading situation. A throw is the same answer:
 * it costs the trial badge, never the prices.
 */
async function eligibleForTrial(productIds: string[]): Promise<Set<string>> {
  if (!Purchases || productIds.length === 0) return new Set();
  try {
    const eligibility = await Purchases.checkTrialOrIntroductoryPriceEligibility(productIds);
    const yes = Purchases.INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE;
    return new Set(productIds.filter((id) => eligibility[id]?.status === yes));
  } catch {
    return new Set();
  }
}

export async function getOffers(): Promise<Offer[]> {
  if (!purchasesAvailable() || !Purchases) return [];
  try {
    const offerings = await Purchases.getOfferings();
    const packages = offerings.current?.availablePackages ?? [];
    // Only ask about the products that carry a free trial at all — the
    // eligibility call is a store round-trip, and the answer for a product
    // with no offer is a foregone `NO_INTRO_OFFER_EXISTS`.
    const eligible = await eligibleForTrial(
      packages.filter((p) => freeTrialDays(p.product) !== null).map((p) => p.product.identifier),
    );
    return packages.map((p) => ({
      id: productIdFor(p.identifier),
      price: p.product.priceString,
      freeTrialDays: eligible.has(p.product.identifier) ? freeTrialDays(p.product) : null,
    }));
  } catch {
    return [];
  }
}

/**
 * What came of a purchase or a restore.
 *
 * Four outcomes rather than a boolean, because two of them must not look the
 * same on screen: backing out of Apple's sheet is a decision the user made and
 * deserves silence, while a failure deserves an explanation. RevenueCat
 * signals both by throwing.
 */
export type Outcome = "active" | "inactive" | "cancelled" | "failed";

const userCancelled = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { userCancelled?: boolean }).userCancelled === true;

export async function purchase(productId: string): Promise<Outcome> {
  if (!purchasesAvailable() || !Purchases) return "failed";
  try {
    const offerings = await Purchases.getOfferings();
    const target = offerings.current?.availablePackages.find(
      (p) => productIdFor(p.identifier) === productId,
    );
    if (!target) return "failed";
    const { customerInfo } = await Purchases.purchasePackage(target);
    return customerInfo.entitlements.active[ENTITLEMENT] ? "active" : "inactive";
  } catch (error) {
    return userCancelled(error) ? "cancelled" : "failed";
  }
}

export async function restore(): Promise<Outcome> {
  if (!purchasesAvailable() || !Purchases) return "failed";
  try {
    const info = await Purchases.restorePurchases();
    return info.entitlements.active[ENTITLEMENT] ? "active" : "inactive";
  } catch {
    return "failed";
  }
}

/**
 * Restore, and say what happened.
 *
 * Both the paywall and Settings offer this, and App Review checks it: a
 * Restore button that reports nothing reads as a broken button whether or not
 * there was anything to restore. Keeping the alerts here is what stops the two
 * screens drifting into answering the same tap differently.
 */
export async function restoreAndReport(): Promise<boolean> {
  if (!purchasesAvailable()) {
    Alert.alert(t(ui.unavailable), t(ui.purchasesOff));
    return false;
  }
  const outcome = await restore();
  if (outcome === "active") {
    Alert.alert(t(ui.restored), t(ui.restoredBody));
    return true;
  }
  Alert.alert(
    outcome === "failed" ? t(ui.purchaseFailed) : t(ui.noPriorPurchase),
    outcome === "failed" ? t(ui.purchaseFailedBody) : t(ui.noPriorPurchaseBody),
  );
  return false;
}
