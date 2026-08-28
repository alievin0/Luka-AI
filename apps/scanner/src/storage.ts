import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { activePackId, type ScanResult } from "./packs";
import { countryFor, currencyForCountry, deviceCountry } from "./countries";

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
 * Two, and each returns the verdict only.
 *
 * The count is set against the market rather than derived: Signal, the closest
 * direct competitor, gives two free camera scans, and arriving with one would
 * read as meaner for no gain anybody notices. What matters is not how many
 * scans are free but how much of the answer each returns, and on that axis two
 * verdicts are still less than what Signal gives away. Two scans cost 8 cents.
 *
 * The reason there used to be two no longer applies. It was that a first scan
 * is often a test — a dashboard that is not lit, a photo too dark to read —
 * and burning someone's only try on it would send them to the paywall having
 * never seen the app work. That is now handled where it belongs:
 * `ScannerHome` only calls `bumpScanCount()` when `result.detected`, so a
 * photo the model could not read costs nothing.
 *
 * The one free scan is not the whole answer either. It returns the verdict and
 * the light's name — the part a driver on the hard shoulder needs to decide
 * whether to keep driving, which is never sold — and the report behind it is
 * what the subscription is for.
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
  currencyForCountry(profile.region || deviceCountry());

/**
 * Flattens the onboarding answers into one line for the vision prompt.
 *
 * `region` is stored as a country code so a label can be edited without
 * orphaning every profile, but "KW" is thinner context than "Kuwait" for a
 * model asked which cars and which repair prices are plausible there — so it
 * is expanded on the way out, in English, which is the prompt's language.
 */
export const profileSummary = (profile: Profile) =>
  Object.entries(profile)
    .map(([key, value]) =>
      key === "region" ? `region: ${countryFor(value)?.name.en ?? value}` : `${key}: ${value}`,
    )
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

/**
 * Where a scan's photo lives once the scan is kept.
 *
 * ImageManipulator writes its output into the OS cache directory, and that is
 * the path history used to store. iOS reclaims Library/Caches under disk
 * pressure and Android clears cacheDir the same way, so a list holding fifty
 * scans would degrade into grey squares on its own — soonest for the oldest
 * entries, which are the ones someone is scrolling back to find.
 *
 * Everything here is best-effort: on the web build there is no such directory,
 * and a runtime that cannot copy is not a reason to lose the scan. Failing
 * falls back to the cache path, which is exactly the old behaviour.
 */
const PHOTOS = "scans";

function photoDir(): Directory {
  const dir = new Directory(Paths.document, PHOTOS);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function keepPhoto(sourceUri: string, id: string): string {
  if (!sourceUri) return sourceUri;
  try {
    const source = new File(sourceUri);
    if (!source.exists) return sourceUri;
    const target = new File(photoDir(), `${id}.jpg`);
    source.copy(target);
    return target.uri;
  } catch {
    return sourceUri;
  }
}

/** Only ever deletes a file this module wrote. An entry whose uri still points
 *  at the camera cache — or, one day, at a gallery original — is left alone. */
function dropPhoto(uri: string) {
  try {
    if (!uri.startsWith(photoDir().uri)) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone, or no filesystem here. Either way there is nothing owed.
  }
}

export async function addToHistory(entry: HistoryEntry) {
  const kept = { ...entry, imageUri: keepPhoto(entry.imageUri, entry.id) };
  const previous = await getHistory();
  const history = [kept, ...previous].slice(0, 50);

  // The fifty-first scan pushes the oldest one out; its photo goes with it,
  // or the directory grows without bound behind a list that has forgotten it.
  const surviving = new Set(history.map((h) => h.id));
  for (const dropped of previous) {
    if (!surviving.has(dropped.id)) dropPhoto(dropped.imageUri);
  }

  await AsyncStorage.setItem(KEYS.history, JSON.stringify(history));
}

export async function removeFromHistory(id: string) {
  const previous = await getHistory();
  const history = previous.filter((entry) => entry.id !== id);
  for (const gone of previous) {
    if (gone.id === id) dropPhoto(gone.imageUri);
  }
  await AsyncStorage.setItem(KEYS.history, JSON.stringify(history));
  return history;
}

export async function updateProfile(patch: Profile) {
  const next = { ...(await getProfile()), ...patch };
  await AsyncStorage.setItem(KEYS.profile, JSON.stringify(next));
  return next;
}

export async function clearHistory() {
  for (const entry of await getHistory()) dropPhoto(entry.imageUri);
  await AsyncStorage.removeItem(KEYS.history);
}

/** Dev helper: wipe everything so you can replay onboarding + paywall. */
export async function resetAll() {
  await AsyncStorage.multiRemove(Object.values(KEYS));
}
