import AsyncStorage from "@react-native-async-storage/async-storage";
import { activePackId, type ScanResult } from "./packs";
import { currencyForCountry } from "./countries";

/** Keys are namespaced per pack so the two apps never share state. */
const k = (name: string) => `@${activePackId}:${name}`;

const KEYS = {
  onboarded: k("onboarded"),
  aiConsent: k("aiConsent"),
  profile: k("profile"),
  scanCount: k("scanCount"),
  history: k("history"),
};

/**
 * How many scans a user gets before the paywall.
 *
 * Two rather than one: the first scan is often a test — a driver pointing the
 * camera at a dashboard that is not lit, or a photo too dark to read — and
 * spending someone's only free scan on their trial run means they hit the
 * paywall having never seen the app work. The second is the one that answers
 * a real question, and that is what they are being asked to pay for.
 */
export const FREE_SCANS = 2;

export type HistoryEntry = {
  id: string;
  at: number;
  imageUri: string;
  result: ScanResult;
};

export type Profile = Record<string, string>;

export const currencyFor = (profile: Profile) =>
  currencyForCountry(profile.region ?? "");

/** Flattens the onboarding answers into one line for the vision prompt. */
export const profileSummary = (profile: Profile) =>
  Object.entries(profile)
    .map(([key, value]) => `${key}: ${value}`)
    .join("، ");

export async function isOnboarded() {
  return (await AsyncStorage.getItem(KEYS.onboarded)) === "1";
}

export async function completeOnboarding(profile: Profile) {
  await AsyncStorage.multiSet([
    [KEYS.onboarded, "1"],
    [KEYS.aiConsent, "1"],
    [KEYS.profile, JSON.stringify(profile)],
  ]);
}

export async function getProfile(): Promise<Profile> {
  const raw = await AsyncStorage.getItem(KEYS.profile);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Profile;
  } catch {
    return {};
  }
}

export async function getScanCount() {
  return Number((await AsyncStorage.getItem(KEYS.scanCount)) ?? 0);
}

export async function bumpScanCount() {
  const next = (await getScanCount()) + 1;
  await AsyncStorage.setItem(KEYS.scanCount, String(next));
  return next;
}

export async function getHistory(): Promise<HistoryEntry[]> {
  const raw = await AsyncStorage.getItem(KEYS.history);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

export async function addToHistory(entry: HistoryEntry) {
  const history = [entry, ...(await getHistory())].slice(0, 50);
  await AsyncStorage.setItem(KEYS.history, JSON.stringify(history));
}

export async function removeFromHistory(id: string) {
  const history = (await getHistory()).filter((entry) => entry.id !== id);
  await AsyncStorage.setItem(KEYS.history, JSON.stringify(history));
  return history;
}

export async function updateProfile(patch: Profile) {
  const next = { ...(await getProfile()), ...patch };
  await AsyncStorage.setItem(KEYS.profile, JSON.stringify(next));
  return next;
}

export async function clearHistory() {
  await AsyncStorage.removeItem(KEYS.history);
}

/** Dev helper: wipe everything so you can replay onboarding + paywall. */
export async function resetAll() {
  await AsyncStorage.multiRemove(Object.values(KEYS));
}
