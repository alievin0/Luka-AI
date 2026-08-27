import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Spot gold price, per gram, in the user's currency.
 *
 * Deliberately NOT wired to a live feed yet. Every free gold API either
 * requires a key, rate-limits below what a consumer app needs, or has no
 * uptime guarantee — and a buying assistant that quotes a stale price at the
 * counter is worse than one that admits it doesn't know.
 *
 * So: the user enters today's rate (every gold buyer in this market already
 * knows it, it is on the shop's board), and it is cached with a timestamp.
 * Anything older than STALE_AFTER is shown as stale rather than used silently.
 *
 * To wire a real feed, implement `fetchSpot` against your provider and call it
 * from `getSpot` before falling back to the cached manual value. Keep the
 * staleness check — it is the honest part.
 */

const KEY = "@gold:spot";
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type Spot = {
  /** Price per gram of 24K gold. */
  perGram: number;
  currency: string;
  at: number;
};

export async function getSpot(): Promise<Spot | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Spot;
  } catch {
    return null;
  }
}

export async function setSpot(perGram: number, currency: string): Promise<Spot> {
  const spot: Spot = { perGram, currency, at: Date.now() };
  await AsyncStorage.setItem(KEY, JSON.stringify(spot));
  return spot;
}

export const isStale = (spot: Spot | null) =>
  spot === null || Date.now() - spot.at > STALE_AFTER_MS;
