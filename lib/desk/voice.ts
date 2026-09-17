/**
 * Browser speech, for hearing the receptionist and talking back to it.
 *
 * This is NOT the phone channel. A real voice agent answers a telephone
 * number, which needs a telephony provider and is not built. What this does
 * give is a genuine spoken conversation with the same engine, in the browser,
 * with no account of any kind — enough to hear whether the agent sounds right
 * before paying anyone for a phone line.
 *
 * Support is uneven: recognition is WebKit-only in practice (Safari, Chrome),
 * and the set of Arabic voices depends entirely on the operating system. Every
 * function here reports what is actually available rather than assuming.
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

export function speak(
  text: string,
  opts: { onStart?: () => void; onEnd?: () => void; onUnavailable?: () => void } = {},
): SpeakHandle {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    opts.onUnavailable?.();
    return { cancel: () => {} };
  }
  const synth = window.speechSynthesis;
  synth.cancel(); // never stack utterances on top of each other

  const utter = new SpeechSynthesisUtterance(text);
  const voice = pickArabicVoice();
  if (voice) {
    utter.voice = voice;
    utter.lang = voice.lang;
  } else {
    // No Arabic voice installed: say so rather than producing gibberish.
    opts.onUnavailable?.();
    return { cancel: () => {} };
  }
  utter.rate = 1.0;
  utter.pitch = 1.0;
  utter.onstart = () => opts.onStart?.();
  utter.onend = () => opts.onEnd?.();
  utter.onerror = () => opts.onEnd?.();

  synth.speak(utter);
  return { cancel: () => synth.cancel() };
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
