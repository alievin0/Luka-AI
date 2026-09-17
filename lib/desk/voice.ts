/**
 * Speech in the browser: hearing the receptionist, and talking back to it.
 *
 * Output has two engines and they are not equals. A neural provider on the
 * server (`/api/desk/speak`) sounds like a person; the browser's own
 * `speechSynthesis` is the unmistakable system robot, and on macOS it is a
 * voice every listener has heard before. So the server is tried first and the
 * browser is only the fallback — and `speak` reports which one actually spoke,
 * because "the demo sounded robotic" is worth knowing rather than hiding.
 *
 * This is NOT the phone channel either way. A real voice agent answers a
 * telephone number, which needs a telephony provider and is not built.
 *
 * Input support is uneven: recognition is WebKit-only in practice (Safari,
 * Chrome). Every function here reports what is actually available rather than
 * assuming.
 */

export type VoiceSupport = {
  canListen: boolean;
  canSpeak: boolean;
  /** Arabic voices the operating system actually offers. */
  arabicVoices: string[];
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type RecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function detectSupport(): VoiceSupport {
  if (typeof window === "undefined") {
    return { canListen: false, canSpeak: false, arabicVoices: [] };
  }
  const synth = window.speechSynthesis;
  const arabicVoices = synth
    ? synth.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("ar")).map((v) => v.name)
    : [];
  return {
    canListen: recognitionCtor() !== null,
    canSpeak: !!synth,
    arabicVoices,
  };
}

/**
 * Voices load asynchronously in most browsers, and `getVoices()` is empty on
 * the first call. Waiting for the event is what makes an Arabic voice
 * selectable instead of silently falling back to the default English one.
 */
export function whenVoicesReady(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.speechSynthesis) return () => {};
  const synth = window.speechSynthesis;
  if (synth.getVoices().length) {
    cb();
    return () => {};
  }
  const handler = () => cb();
  synth.addEventListener("voiceschanged", handler);
  return () => synth.removeEventListener("voiceschanged", handler);
}

function pickArabicVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  // Prefer a Levantine/Gulf voice, then any Arabic one, then give up rather
  // than reading Arabic text with an English voice.
  const preferred = ["ar-JO", "ar-SA", "ar-AE", "ar-EG", "ar"];
  for (const tag of preferred) {
    const hit = voices.find((v) => v.lang?.toLowerCase().startsWith(tag.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}

export type SpeakHandle = { cancel: () => void };

/** Which engine produced the sound the operator is hearing. */
export type SpeakEngine = "neural" | "browser";

export type TtsStatus = {
  configured: boolean;
  provider: string | null;
  voice: string | null;
  available: string[];
  note: string;
};

/** Ask the server which voice provider, if any, is wired up. */
export async function fetchTtsStatus(): Promise<TtsStatus | null> {
  try {
    const res = await fetch("/api/desk/speak");
    if (!res.ok) return null;
    return (await res.json()) as TtsStatus;
  } catch {
    return null;
  }
}

type SpeakOpts = {
  onStart?: (engine: SpeakEngine) => void;
  onEnd?: () => void;
  /** No voice at all could be produced — say so rather than failing silently. */
  onUnavailable?: (why: string) => void;
};

/**
 * Speak `text` with the best engine available.
 *
 * The neural clip is fetched whole before playing: it is a couple of seconds
 * of audio and streaming it would buy nothing but a chance to stall mid-word.
 */
export function speak(text: string, opts: SpeakOpts = {}): SpeakHandle {
  let cancelled = false;
  let audio: HTMLAudioElement | null = null;

  const cancel = () => {
    cancelled = true;
    if (audio) {
      audio.pause();
      audio.src = "";
      audio = null;
    }
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  };

  // Stop whatever is already playing: replies must never overlap.
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();

  (async () => {
    try {
      const res = await fetch("/api/desk/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (cancelled) return;

      if (res.ok) {
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        const el = new Audio(url);
        audio = el;
        const done = () => {
          URL.revokeObjectURL(url);
          if (audio === el) audio = null;
          opts.onEnd?.();
        };
        el.onended = done;
        el.onerror = done;
        el.onplay = () => opts.onStart?.("neural");
        await el.play();
        return;
      }
    } catch {
      // Network or playback failure: fall through to the browser voice rather
      // than leaving the operator with silence and no explanation.
    }
    if (!cancelled) speakWithBrowser(text, opts);
  })();

  return { cancel };
}

/** The fallback engine: always available, always obviously synthetic. */
export function speakWithBrowser(text: string, opts: SpeakOpts = {}): void {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    opts.onUnavailable?.("no_engine");
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  const voice = pickArabicVoice();
  if (!voice) {
    // No Arabic voice installed: say so rather than producing gibberish.
    opts.onUnavailable?.("no_arabic_voice");
    return;
  }
  utter.voice = voice;
  utter.lang = voice.lang;
  utter.rate = 1.0;
  utter.pitch = 1.0;
  utter.onstart = () => opts.onStart?.("browser");
  utter.onend = () => opts.onEnd?.();
  utter.onerror = () => opts.onEnd?.();
  synth.speak(utter);
}

export type ListenHandle = { stop: () => void };

export function listen(opts: {
  lang?: string;
  onResult: (text: string) => void;
  onError?: (reason: string) => void;
  onEnd?: () => void;
}): ListenHandle | null {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    opts.onError?.("unsupported");
    return null;
  }

  const rec = new Ctor();
  rec.lang = opts.lang ?? "ar-JO";
  rec.continuous = false;
  rec.interimResults = false;

  rec.onresult = (event) => {
    const first = event.results?.[0]?.[0]?.transcript;
    if (first?.trim()) opts.onResult(first.trim());
  };
  rec.onerror = (event) => {
    // "no-speech" and "aborted" are ordinary outcomes, not failures worth
    // shouting about; anything else is worth telling the operator.
    const reason = event?.error ?? "unknown";
    if (reason !== "no-speech" && reason !== "aborted") opts.onError?.(reason);
  };
  rec.onend = () => opts.onEnd?.();

  try {
    rec.start();
  } catch {
    opts.onError?.("start_failed");
    return null;
  }
  return { stop: () => rec.abort() };
}

export const VOICE_ERRORS: Record<string, string> = {
  unsupported: "متصفحك ما بيدعم التعرّف على الصوت. جرّب Safari أو Chrome.",
  "not-allowed": "لازم تسمح للموقع يستعمل المايك.",
  "service-not-allowed": "لازم تسمح للموقع يستعمل المايك.",
  "audio-capture": "ما لقيت مايك.",
  network: "مشكلة بالشبكة وقت التعرّف على الصوت.",
  start_failed: "ما قدرت أشغّل المايك.",
};
