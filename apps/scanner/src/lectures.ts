import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { activePackId, type Lecture, type Segment } from "./packs";

/** Lecture storage. Namespaced per pack like the rest of the engine.
 *
 *  Only the metadata lives in AsyncStorage; the audio stays on disk and is
 *  referenced by uri. A one-hour recording is far too big to serialise into
 *  a key-value store, and re-transcribing needs the original file anyway. */

const KEY = `@${activePackId}:lectures`;

export async function getLectures(): Promise<Lecture[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Lecture[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function getLecture(id: string): Promise<Lecture | undefined> {
  return (await getLectures()).find((l) => l.id === id);
}

async function write(lectures: Lecture[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(lectures));
  return lectures;
}

export async function saveLecture(lecture: Lecture) {
  const rest = (await getLectures()).filter((l) => l.id !== lecture.id);
  return write([lecture, ...rest].sort((a, b) => b.at - a.at));
}

/** Patch one lecture in place. Re-reads first so a slow analysis finishing
 *  after the student renamed the lecture doesn't overwrite the new title. */
export async function updateLecture(id: string, patch: Partial<Lecture>) {
  const lectures = await getLectures();
  const index = lectures.findIndex((l) => l.id === id);
  if (index === -1) return lectures;
  lectures[index] = { ...lectures[index], ...patch };
  return write(lectures);
}

export async function deleteLecture(id: string) {
  return write((await getLectures()).filter((l) => l.id !== id));
}

/** How many lectures have been recorded, ever — the free-tier counter.
 *  Kept separate from the list so deleting a lecture doesn't buy a new one. */
const COUNT_KEY = `@${activePackId}:lectureCount`;

export async function getLectureCount(): Promise<number> {
  return Number((await AsyncStorage.getItem(COUNT_KEY)) ?? 0);
}

export async function bumpLectureCount() {
  const next = (await getLectureCount()) + 1;
  await AsyncStorage.setItem(COUNT_KEY, String(next));
  return next;
}

/* ------------------------------------------------------------------ helpers */

export const newLectureId = () => `L${Date.now()}`;

/** The transcript as one string — what the model is given, and what the
 *  "full text" tab shows. Derived rather than stored so the two can't drift. */
export const transcriptOfSegments = (segments: Segment[]) =>
  segments.map((s) => s.text).join(" ").trim();

/** mm:ss — lectures are rarely over an hour, and hh:mm:ss reads worse. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** dBFS values at or above this are handling noise, not speech — the phone
 *  brushing a desk clips where a voice does not. */
const CLIPPING_DBFS = -1;
/** Android reports exactly this when the amplitude reads zero. */
const ANDROID_FLOOR_DBFS = -160;
/** Half-width of the baseline window. Two minutes is long enough that one
 *  emphatic passage cannot drag the baseline up to meet itself, and short
 *  enough to follow a lecturer who moves around the hall. */
const BASELINE_HALF_WINDOW_S = 60;
/**
 * How far above their own baseline the lecturer has to get.
 *
 * iOS reports AVAudioRecorder's average power and Android reports peak
 * amplitude, which sits higher and swings harder on transients — so the same
 * number would mean two different things. These are calibrated separately.
 */
const RAISE_DB = Platform.OS === "android" ? 3.5 : 4.5;
/** Samples this far below the median are silence; letting them into the
 *  baseline drags it down until every ordinary sentence looks emphatic. */
const SILENCE_GATE_DB = 15;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * Scores how far each segment rose above the lecturer's own voice.
 *
 * Absolute loudness says nothing: a quiet lecturer in a quiet hall and a loud
 * one in a noisy one produce completely different dB. What carries meaning is
 * the rise against *this* speaker's baseline at *that* point in the lecture —
 * so the reference is a rolling median rather than one figure for the hour,
 * which would let a single emphatic stretch raise the bar on itself.
 *
 * Runs on the device over metering we already collect, so the feature that
 * makes the app worth paying for costs nothing per lecture.
 */
export function scoreEnergy(segments: Segment[]): Segment[] {
  const usable = segments.filter(
    (s) =>
      typeof s.energy === "number" &&
      Number.isFinite(s.energy) &&
      s.energy < CLIPPING_DBFS &&
      s.energy > ANDROID_FLOOR_DBFS,
  );
  if (usable.length < 6) return segments.map((s) => ({ ...s, energy: 0 }));

  const overall = median(usable.map((s) => s.energy!));
  // Speech only. Pauses would otherwise define the baseline.
  const speech = usable.filter((s) => s.energy! > overall - SILENCE_GATE_DB);
  if (speech.length < 4) return segments.map((s) => ({ ...s, energy: 0 }));

  return segments.map((segment) => {
    const energy = segment.energy;
    if (
      typeof energy !== "number" ||
      !Number.isFinite(energy) ||
      energy >= CLIPPING_DBFS ||
      energy <= ANDROID_FLOOR_DBFS
    ) {
      return { ...segment, energy: 0 };
    }

    const nearby = speech.filter(
      (other) => Math.abs(other.at - segment.at) <= BASELINE_HALF_WINDOW_S,
    );
    const baseline = nearby.length >= 4 ? median(nearby.map((s) => s.energy!)) : overall;
    const rise = energy - baseline;

    // Below the threshold is ordinary delivery; the top of the scale is
    // reached at roughly twice the threshold, which in practice is a lecturer
    // who is genuinely raising their voice rather than merely audible.
    if (rise <= RAISE_DB) return { ...segment, energy: 0 };
    return { ...segment, energy: Math.max(0, Math.min(1, (rise - RAISE_DB) / RAISE_DB)) };
  });
}

/** The moments worth handing the model: what the student marked by hand,
 *  plus the loudest passages. Capped so a noisy hall can't flood the prompt. */
export function emphasisCandidates(segments: Segment[], limit = 24) {
  const scored = scoreEnergy(segments);
  const marked = scored.filter((s) => s.marked);
  const loud = scored
    .filter((s) => !s.marked && (s.energy ?? 0) >= 0.5)
    .sort((a, b) => (b.energy ?? 0) - (a.energy ?? 0))
    .slice(0, Math.max(0, limit - marked.length));

  return [...marked, ...loud].sort((a, b) => a.at - b.at);
}

/* --------------------------------------------------------------- recordings */

/**
 * Moves a finished recording out of the cache directory.
 *
 * expo-audio writes into cache, which the OS is free to purge whenever it
 * wants the space — and the recording is the one thing in this app that
 * cannot be regenerated. Returns the original uri if the move fails, since a
 * recording in a risky place still beats no recording.
 */
export async function persistRecording(uri: string, id: string): Promise<string> {
  try {
    const { File, Directory, Paths } = require("expo-file-system") as typeof import("expo-file-system");
    const folder = new Directory(Paths.document, "lectures");
    if (!folder.exists) folder.create({ intermediates: true });
    const extension = uri.split(".").pop()?.split("?")[0] || "m4a";
    const source = new File(uri);
    const target = new File(folder, `${id}.${extension}`);
    source.move(target);
    return target.uri;
  } catch {
    return uri;
  }
}

/** Deletes a lecture's audio along with its metadata. */
export async function deleteRecording(uri?: string) {
  if (!uri) return;
  try {
    const { File } = require("expo-file-system") as typeof import("expo-file-system");
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone, or never written. Nothing to clean up.
  }
}
