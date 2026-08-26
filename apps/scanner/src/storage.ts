import AsyncStorage from "@react-native-async-storage/async-storage";
import { activePackId, type ScanResult } from "./scanners";

/** Keys are namespaced per pack so the two apps never share state. */
const k = (name: string) => `@${activePackId}:${name}`;

const KEYS = {
  onboarded: k("onboarded"),
  aiConsent: k("aiConsent"),
  profile: k("profile"),
  scanCount: k("scanCount"),
  history: k("history"),
};

/** How many scans a user gets before the paywall. */
export const FREE_SCANS = 1;

export type HistoryEntry = {
  id: string;
  at: number;
  imageUri: string;
  result: ScanResult;
};

export type Profile = Record<string, string>;

const CURRENCY_BY_REGION: Record<string, string> = {
  "الكويت": "د.ك",
  "السعودية": "ر.س",
  "الإمارات": "د.إ",
  "الأردن": "د.أ",
  "مصر": "ج.م",
};

export const currencyFor = (profile: Profile) =>
  CURRENCY_BY_REGION[profile.region ?? ""] ?? "USD";

/** Flattens the onboarding answers into one line for the vision prompt. */
export const profileSummary = (profile: Profile) =>
  Object.entries(profile)
    .map(([key, value]) => `${key}: ${value}`)
    .join("، ");

export async function isOnboarded() {
  return (await AsyncStorage.getItem(KEYS.onboarded)) === "1";
}

export async function completeOnboarding(profile: Profile) {
  await AsyncStorage.setMany({
    [KEYS.onboarded]: "1",
    [KEYS.aiConsent]: "1",
    [KEYS.profile]: JSON.stringify(profile),
  });
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

export async function clearHistory() {
  await AsyncStorage.removeItem(KEYS.history);
}

/** Dev helper: wipe everything so you can replay onboarding + paywall. */
export async function resetAll() {
  await AsyncStorage.removeMany(Object.values(KEYS));
}
