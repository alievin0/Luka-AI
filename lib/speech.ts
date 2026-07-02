// Browser speech helpers (client-only): interviewer voice + candidate speech-to-text.
//
// Voice cloning note: in production the interviewer's voice comes from a
// cloning provider (e.g. ElevenLabs / Higgsfield voice API) seeded with a
// professional speaker in the candidate's field. This module exposes the same
// speak() contract backed by the browser's SpeechSynthesis so the app works
// with zero extra keys; swap the internals to plug a cloning API.

export type SpeechLang = "ar" | "en";

const LANG_TAGS: Record<SpeechLang, string[]> = {
  ar: ["ar-SA", "ar-AE", "ar-EG", "ar"],
  en: ["en-US", "en-GB", "en"],
};

function pickVoice(lang: SpeechLang): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  for (const tag of LANG_TAGS[lang]) {
    // Prefer non-default "premium"-sounding voices when several match.
    const matches = voices.filter((v) =>
      v.lang.toLowerCase().startsWith(tag.toLowerCase()),
    );
    if (matches.length) {
      return matches.find((v) => !v.default) ?? matches[0];
    }
  }
  return null;
}

/** Speaks text with a professional pace; resolves when playback ends. */
export function speak(text: string, lang: SpeechLang): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(lang);
    if (voice) utter.voice = voice;
    utter.lang = voice?.lang ?? (lang === "ar" ? "ar-SA" : "en-US");
    utter.rate = 0.95;
    utter.pitch = 0.9; // slightly lower = calmer, more "senior interviewer"
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    window.speechSynthesis.speak(utter);
  });
}

export function stopSpeaking() {
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

/** Warms up the voice list (Chrome loads voices asynchronously). */
export function preloadVoices() {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () =>
    window.speechSynthesis.getVoices();
}

export type RecognitionHandle = { stop: () => void };

/**
 * Streams speech-to-text from the mic. Calls onText with the accumulated
 * transcript (finals + current interim). Returns null when unsupported.
 */
export function startRecognition(
  lang: SpeechLang,
  onText: (fullText: string) => void,
): RecognitionHandle | null {
  const Ctor =
    (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = lang === "ar" ? "ar-SA" : "en-US";
  rec.continuous = true;
  rec.interimResults = true;

  let finals = "";
  let stopped = false;

  rec.onresult = (event: any) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const chunk = event.results[i][0].transcript;
      if (event.results[i].isFinal) finals += chunk + " ";
      else interim += chunk;
    }
    onText((finals + interim).trim());
  };
  // Chrome stops recognition after silence; restart until told to stop.
  rec.onend = () => {
    if (!stopped) {
      try {
        rec.start();
      } catch {
        /* already started */
      }
    }
  };
  rec.onerror = () => {
    /* ignore transient errors; onend handles restart */
  };

  try {
    rec.start();
  } catch {
    return null;
  }

  return {
    stop: () => {
      stopped = true;
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    },
  };
}
