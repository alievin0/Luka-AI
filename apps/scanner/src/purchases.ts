import { Platform } from "react-native";

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
const ENTITLEMENT = "pro";

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

export type Offer = { id: string; title: string; price: string; period: string };

export async function getOffers(): Promise<Offer[]> {
  if (!purchasesAvailable() || !Purchases) return [];
  try {
    const offerings = await Purchases.getOfferings();
    const packages = offerings.current?.availablePackages ?? [];
    return packages.map((p) => ({
      id: p.identifier,
      title: p.product.title,
      price: p.product.priceString,
      period: p.packageType,
    }));
  } catch {
    return [];
  }
}

/** Returns true when the purchase completed and the entitlement is active. */
export async function purchase(packageId: string): Promise<boolean> {
  if (!purchasesAvailable() || !Purchases) return false;
  const offerings = await Purchases.getOfferings();
  const target = offerings.current?.availablePackages.find(
    (p) => p.identifier === packageId,
  );
  if (!target) return false;
  const { customerInfo } = await Purchases.purchasePackage(target);
  return typeof customerInfo.entitlements.active[ENTITLEMENT] !== "undefined";
}

export async function restore(): Promise<boolean> {
  if (!purchasesAvailable() || !Purchases) return false;
  const info = await Purchases.restorePurchases();
  return typeof info.entitlements.active[ENTITLEMENT] !== "undefined";
}
