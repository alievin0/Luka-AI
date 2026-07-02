// Browser speech helpers (client-only): interviewer voice + candidate speech-to-text.
//
// Interviewer voice: speak() first tries the server's /api/tts route, which is
// backed by ElevenLabs (multilingual — the same professional voice speaks both
// Arabic and English; set ELEVENLABS_VOICE_ID to a cloned professional voice
// in your field). When ElevenLabs isn't configured or a request fails, it
// falls back to the browser's SpeechSynthesis so the app works with no keys.

export type SpeechLang = "ar" | "en";

const LANG_TAGS: Record<SpeechLang, string[]> = {
  ar: ["ar-SA", "ar-AE", "ar-EG", "ar"],
  en: ["en-US", "en-GB", "en"],
};

let elevenEnabled: boolean | null = null;
let currentAudio: HTMLAudioElement | null = null;

async function elevenAvailable(): Promise<boolean> {
  if (elevenEnabled !== null) return elevenEnabled;
  try {
    const res = await fetch("/api/tts");
    const data = await res.json();
    elevenEnabled = Boolean(data?.enabled);
  } catch {
    elevenEnabled = false;
  }
  return elevenEnabled;
}

async function speakEleven(text: string): Promise<boolean> {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    await new Promise<void>((resolve) => {
      const audio = new Audio(url);
      currentAudio = audio;
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
    });
    URL.revokeObjectURL(url);
    currentAudio = null;
    return true;
  } catch {
    return false;
  }
}

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

function speakBrowser(text: string, lang: SpeechLang): Promise<void> {
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

/** Speaks text with a professional voice; resolves when playback ends. */
export async function speak(text: string, lang: SpeechLang): Promise<void> {
  if (await elevenAvailable()) {
    const ok = await speakEleven(text);
    if (ok) return;
  }
  await speakBrowser(text, lang);
}

export function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.onended = null;
    currentAudio = null;
  }
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

/** Warms up the ElevenLabs status + browser voice list. */
export function preloadVoices() {
  void elevenAvailable();
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
