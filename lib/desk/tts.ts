/**
 * Neural text-to-speech for the receptionist.
 *
 * The browser's built-in voice is unmistakably synthetic — on macOS it is the
 * system voice everyone has heard, and a customer hears a robot the moment it
 * speaks. That is fine for checking the plumbing works and useless for a
 * business that is paying to sound professional. So speech is synthesized
 * server-side by a real neural provider, and the browser voice stays only as
 * the fallback when no provider is configured.
 *
 * Three providers are supported and any one of them is enough. They are not
 * interchangeable in the way that matters here:
 *
 *   - Azure has genuine *Jordanian* voices (ar-JO-Taim, ar-JO-Sana) plus Gulf
 *     and Egyptian ones. A Jordanian clinic's customers hear their own accent,
 *     not textbook Arabic. Its free grant is also the largest by far.
 *   - ElevenLabs is the most natural-sounding overall, but speaks Modern
 *     Standard Arabic — correct, warm, and not local to anywhere.
 *   - OpenAI is the easiest to add if a key is already on hand; its Arabic
 *     carries a noticeable foreign accent.
 *
 * Nothing here runs without a key. With none set, `status()` reports that and
 * the console says plainly that the robotic browser voice is what is playing.
 */

import { createHash } from "node:crypto";

export type ProviderName = "azure" | "elevenlabs" | "openai";

export type TtsStatus = {
  configured: boolean;
  /** The provider that will actually be used, if any. */
  provider: ProviderName | null;
  /** The voice id/name that provider will speak with. */
  voice: string | null;
  /** Every provider that has a usable key, in preference order. */
  available: ProviderName[];
  /** Human-readable Arabic explanation for the console. */
  note: string;
};

export type Synthesized = {
  ok: true;
  audio: Uint8Array;
  contentType: string;
  provider: ProviderName;
  voice: string;
  cached: boolean;
};

export type SynthFailure = {
  ok: false;
  /** Machine-readable so the client can decide whether to fall back. */
  reason: "unconfigured" | "too_long" | "empty" | "provider_error";
  message: string;
};

/** A receptionist reply is a couple of sentences; anything longer is misuse. */
export const MAX_CHARS = 1200;

/* ── provider configuration ──────────────────────────────────────────── */

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/**
 * Azure's Jordanian male voice. Chosen as the default because the first
 * customers are Jordanian and a local accent is the whole point of preferring
 * Azure; any voice name from Azure's catalogue can replace it.
 */
const AZURE_DEFAULT_VOICE = "ar-JO-TaimNeural";
/** ElevenLabs "Rachel" — a stable, always-present stock voice. */
const ELEVEN_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";
const ELEVEN_DEFAULT_MODEL = "eleven_multilingual_v2";
const OPENAI_DEFAULT_VOICE = "alloy";
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini-tts";

function azureConfig() {
  const key = env("AZURE_SPEECH_KEY");
  const region = env("AZURE_SPEECH_REGION");
  if (!key || !region) return null;
  return { key, region, voice: env("AZURE_SPEECH_VOICE") ?? AZURE_DEFAULT_VOICE };
}

function elevenConfig() {
  const key = env("ELEVENLABS_API_KEY");
  if (!key) return null;
  return {
    key,
    voice: env("ELEVENLABS_VOICE_ID") ?? ELEVEN_DEFAULT_VOICE,
    model: env("ELEVENLABS_MODEL") ?? ELEVEN_DEFAULT_MODEL,
  };
}

function openaiConfig() {
  const key = env("OPENAI_API_KEY");
  if (!key) return null;
  return {
    key,
    voice: env("OPENAI_TTS_VOICE") ?? OPENAI_DEFAULT_VOICE,
    model: env("OPENAI_TTS_MODEL") ?? OPENAI_DEFAULT_MODEL,
  };
}

/** Preference order when several keys are present: local accent first. */
const ORDER: ProviderName[] = ["azure", "elevenlabs", "openai"];

function configuredProviders(): ProviderName[] {
  const has: Record<ProviderName, boolean> = {
    azure: azureConfig() !== null,
    elevenlabs: elevenConfig() !== null,
    openai: openaiConfig() !== null,
  };
  return ORDER.filter((p) => has[p]);
}

function chosenProvider(): ProviderName | null {
  const available = configuredProviders();
  const forced = env("TTS_PROVIDER")?.toLowerCase() as ProviderName | undefined;
  // An explicit choice only counts if its key is actually there — otherwise a
  // typo in one variable would silence the voice with no explanation.
  if (forced && available.includes(forced)) return forced;
  return available[0] ?? null;
}

function voiceOf(provider: ProviderName): string | null {
  if (provider === "azure") return azureConfig()?.voice ?? null;
  if (provider === "elevenlabs") return elevenConfig()?.voice ?? null;
  return openaiConfig()?.voice ?? null;
}

export function status(): TtsStatus {
  const available = configuredProviders();
  const provider = chosenProvider();
  const voice = provider ? voiceOf(provider) : null;

  if (!provider) {
    return {
      configured: false,
      provider: null,
      voice: null,
      available,
      note: "ما في مزوّد صوت مضبوط — الصوت اللي بتسمعه صوت المتصفح الآلي.",
    };
  }
  const label: Record<ProviderName, string> = {
    azure: "Azure — صوت أردني عصبي",
    elevenlabs: "ElevenLabs — عربي فصيح طبيعي",
    openai: "OpenAI — عربي بلكنة أجنبية خفيفة",
  };
  return {
    configured: true,
    provider,
    voice,
    available,
    note: `${label[provider]} (${voice})`,
  };
}

/* ── cache ───────────────────────────────────────────────────────────── */

/**
 * Receptionists repeat themselves — greetings, the service list, "شو اسمك؟".
 * Caching by the exact text spares the quota and removes the delay on the
 * second time a phrase is spoken. In-memory, so it empties on deploy; that is
 * the right trade for something that is only ever an optimization.
 */
const cache = new Map<string, { audio: Uint8Array; contentType: string }>();
let cacheBytes = 0;
const CACHE_LIMIT_BYTES = 24 * 1024 * 1024;

function cacheKey(provider: string, voice: string, text: string): string {
  return createHash("sha256").update(`${provider}|${voice}|${text}`).digest("hex");
}

function remember(key: string, audio: Uint8Array, contentType: string): void {
  // Evict oldest-first until the new clip fits. Map preserves insertion order.
  while (cacheBytes + audio.byteLength > CACHE_LIMIT_BYTES && cache.size > 0) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const dropped = cache.get(oldest);
    cache.delete(oldest);
    cacheBytes -= dropped?.audio.byteLength ?? 0;
  }
  if (audio.byteLength > CACHE_LIMIT_BYTES) return;
  cache.set(key, { audio, contentType });
  cacheBytes += audio.byteLength;
}

/** Test seam: the cache is process-wide and would leak between cases. */
export function resetCache(): void {
  cache.clear();
  cacheBytes = 0;
}

/* ── synthesis ───────────────────────────────────────────────────────── */

export async function synthesize(text: string): Promise<Synthesized | SynthFailure> {
  const clean = text.trim();
  if (!clean) return { ok: false, reason: "empty", message: "ما في نص لقراءته." };
  if (clean.length > MAX_CHARS) {
    return {
      ok: false,
      reason: "too_long",
      message: `النص أطول من ${MAX_CHARS} حرف.`,
    };
  }

  const provider = chosenProvider();
  if (!provider) {
    return {
      ok: false,
      reason: "unconfigured",
      message: "ما في مزوّد صوت مضبوط على السيرفر.",
    };
  }
  const voice = voiceOf(provider) ?? "";
  const key = cacheKey(provider, voice, clean);

  const hit = cache.get(key);
  if (hit) {
    return {
      ok: true,
      audio: hit.audio,
      contentType: hit.contentType,
      provider,
      voice,
      cached: true,
    };
  }

  try {
    const out =
      provider === "azure"
        ? await speakAzure(clean)
        : provider === "elevenlabs"
          ? await speakEleven(clean)
          : await speakOpenAi(clean);
    remember(key, out.audio, out.contentType);
    return { ok: true, ...out, provider, voice, cached: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "provider_error", message };
  }
}

type Clip = { audio: Uint8Array; contentType: string };

/** Azure speaks SSML, so anything in the reply that looks like markup must go. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function speakAzure(text: string): Promise<Clip> {
  const cfg = azureConfig();
  if (!cfg) throw new Error("Azure Speech is not configured.");
  // The locale must match the voice, otherwise Azure falls back to a default
  // voice in the requested locale and the chosen accent is silently lost.
  const locale = cfg.voice.split("-").slice(0, 2).join("-") || "ar-JO";
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">` +
    `<voice name="${escapeXml(cfg.voice)}">` +
    `<prosody rate="0%">${escapeXml(text)}</prosody>` +
    `</voice></speak>`;

  const res = await fetch(
    `https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": cfg.key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "luka-desk",
      },
      body: ssml,
    },
  );
  if (!res.ok) {
    throw new Error(`Azure TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return {
    audio: new Uint8Array(await res.arrayBuffer()),
    contentType: "audio/mpeg",
  };
}

async function speakEleven(text: string): Promise<Clip> {
  const cfg = elevenConfig();
  if (!cfg) throw new Error("ElevenLabs is not configured.");
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(cfg.voice)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": cfg.key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: cfg.model,
        voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.15 },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return {
    audio: new Uint8Array(await res.arrayBuffer()),
    contentType: "audio/mpeg",
  };
}

async function speakOpenAi(text: string): Promise<Clip> {
  const cfg = openaiConfig();
  if (!cfg) throw new Error("OpenAI TTS is not configured.");
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      voice: cfg.voice,
      input: text,
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return {
    audio: new Uint8Array(await res.arrayBuffer()),
    contentType: "audio/mpeg",
  };
}
