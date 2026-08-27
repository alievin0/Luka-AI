import { locale } from "./i18n";

/**
 * The live writer — on-device speech recognition while the lecture runs.
 *
 * Two things make this worth the trouble:
 *
 * 1. It is free. iOS SFSpeechRecognizer and Android SpeechRecognizer run on
 *    the phone, so the student sees text appearing as the lecturer talks
 *    without a single API call. The paid, high-accuracy pass over the saved
 *    audio then becomes something they ask for, not something every minute
 *    of every lecture costs us. That difference is the business.
 *
 * 2. It keeps working with no signal. Lecture halls are basements.
 *
 * expo-speech-recognition is a native module and is not in Expo Go, so it is
 * loaded defensively: without it the recording still happens and the
 * transcript arrives from the server pass once the lecture ends.
 */

type Listener = { remove: () => void };

type SpeechModule = {
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  start: (options: Record<string, unknown>) => void;
  stop: () => void;
  abort?: () => void;
  addListener: (event: string, handler: (payload: any) => void) => Listener;
};

let cached: SpeechModule | null | undefined;

function load(): SpeechModule | null {
  if (cached !== undefined) return cached;
  try {
    cached = require("expo-speech-recognition").ExpoSpeechRecognitionModule as SpeechModule;
  } catch {
    cached = null;
  }
  return cached;
}

/** Whether live transcription can run at all on this build. */
export const liveWriterAvailable = () => load() !== null;

/** BCP-47 tag for the recogniser. Arabic lectures in the Gulf and the Levant
 *  are dialect-heavy; the regional tag recognises them far better than "ar". */
export function recogniserLocale(lectureLanguage?: string): string {
  if (lectureLanguage === "en") return "en-US";
  if (lectureLanguage === "ar") return "ar-SA";
  return locale === "ar" ? "ar-SA" : "en-US";
}

export type LiveResult = {
  /** The recognised text so far for the current utterance. */
  text: string;
  /** False while the recogniser may still revise this text. */
  isFinal: boolean;
};

export type LiveWriter = {
  stop: () => void;
};

/** Errors the recogniser raises during any ordinary pause between sentences.
 *  Treating one as a failure would tear the writer down mid-lecture. */
const TRANSIENT = new Set(["no-speech", "speech-timeout"]);

/**
 * Starts listening. `onResult` fires continuously with interim text and once
 * more with `isFinal` when a passage settles — that settling is what the
 * recording screen calls "checks each passage the moment it finishes".
 *
 * Returns null when the module isn't present, which the caller treats as
 * "record anyway, transcribe later" rather than an error.
 */
export async function startLiveWriter(opts: {
  lang: string;
  onResult: (result: LiveResult) => void;
  onError?: (message: string) => void;
  /**
   * The recognition session has ended and will produce nothing further.
   *
   * This is not optional bookkeeping. `continuous` is unsupported on Android
   * 12 and below, where the session ends after the first final result, and on
   * every platform an incoming call ends the task outright. Without this the
   * writer dies at minute one of a ninety-minute lecture and the screen goes
   * on claiming it is running.
   */
  onEnd?: () => void;
}): Promise<LiveWriter | null> {
  const speech = load();
  if (!speech) return null;

  try {
    const permission = await speech.requestPermissionsAsync();
    if (!permission.granted) return null;
  } catch {
    return null;
  }

  const listeners: Listener[] = [];
  let stopped = false;

  listeners.push(
    speech.addListener("result", (event: { results?: { transcript?: string }[]; isFinal?: boolean }) => {
      const text = event?.results?.[0]?.transcript ?? "";
      if (text) opts.onResult({ text, isFinal: Boolean(event?.isFinal) });
    }),
  );

  listeners.push(
    speech.addListener("error", (event: { message?: string; error?: string }) => {
      const code = event?.error ?? "";
      if (TRANSIENT.has(code)) return;
      opts.onError?.(event?.message ?? code);
    }),
  );

  listeners.push(
    speech.addListener("end", () => {
      // A stop() we asked for also raises this; only an unrequested end is
      // news to the caller.
      if (stopped) return;
      opts.onEnd?.();
    }),
  );

  try {
    speech.start({
      lang: opts.lang,
      interimResults: true,
      continuous: true,
      // Lecturers name people, places and modules that no general model has
      // seen; without this the recogniser silently drops them.
      addsPunctuation: true,
      requiresOnDeviceRecognition: false,
    });
  } catch (error) {
    listeners.forEach((l) => l.remove());
    opts.onError?.(String(error));
    return null;
  }

  return {
    stop: () => {
      stopped = true;
      try {
        speech.stop();
      } catch {
        // Already stopped, or the recogniser died with the screen. Either way
        // the listeners still have to go.
      }
      listeners.forEach((l) => l.remove());
    },
  };
}
