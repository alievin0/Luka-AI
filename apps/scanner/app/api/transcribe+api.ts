import { checkRateLimit, clientKey, LECTURE_MAX_PER_WINDOW } from "../../src/rate-limit";
import type { Segment } from "../../src/packs/types";
import { apiError } from "../../src/i18n/errors";

/**
 * The accurate transcription pass.
 *
 * ElevenLabs Scribe is used rather than Whisper because the students this is
 * built for switch between Arabic and English inside one sentence, and Whisper
 * degrades badly there. Scribe also returns word-level timestamps, which is
 * what lets a tap on a line of the transcript seek the recording.
 *
 * This runs on demand, not on every lecture: the on-device live writer already
 * produced a transcript for free while the lecture was happening. Paying per
 * hour for audio we have already transcribed acceptably would put the unit
 * economics underwater at any subscription price a student would pay.
 */

const ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";
const MODEL = process.env.SCRIBE_MODEL || "scribe_v2";

/** 16 kHz mono AAC runs ~15 MB/hour, so this is roughly four hours. The cap
 *  exists because the route is public and unauthenticated. */
const MAX_AUDIO_BYTES = 60_000_000;

/** One lecturer plus a handful of students who ask questions. Bounding this
 *  is what lets diarisation separate a student shouting a question from the
 *  lecturer emphasising a point — without it, questions get summarised as
 *  though the lecturer had said them. */
const MAX_SPEAKERS = "4";

/** A silence this long between words is a new thought, so a new line. */
const SPLIT_SILENCE = 0.9;
/** Stop one unpunctuated monologue becoming a single unreadable paragraph. */
const MAX_SEGMENT_WORDS = 42;

type ScribeWord = {
  text: string;
  start?: number;
  end?: number;
  type?: "word" | "spacing" | "audio_event";
  speaker_id?: string;
};

/**
 * Groups Scribe's words into the timestamped lines the app displays.
 *
 * Sentence-ending punctuation is the primary boundary, in both scripts —
 * Arabic uses ؟ and ، and the Arabic full stop is the Latin one. Silence and
 * a word ceiling are the fallbacks for speech that arrives unpunctuated.
 */
function toSegments(words: ScribeWord[]): Segment[] {
  const segments: Segment[] = [];
  let current: string[] = [];
  let startedAt = 0;
  let previousEnd: number | null = null;

  let speaker: string | undefined;

  const flush = () => {
    const text = current.join("").trim();
    if (text) segments.push({ at: Math.round(startedAt * 10) / 10, text, speaker });
    current = [];
    speaker = undefined;
  };

  for (const word of words) {
    if (word.type === "audio_event") continue;
    const text = word.text ?? "";
    if (!text) continue;

    // Scribe puts a spacing entry between every pair of words, and that entry
    // spans the pause. Letting one open a segment stamps the segment with the
    // previous sentence's end time, and letting one advance previousEnd makes
    // every gap measure zero — which silently killed the silence split below.
    const isSpacing = word.type === "spacing";
    if (isSpacing && current.length === 0) continue;

    const gap =
      previousEnd !== null && typeof word.start === "number"
        ? word.start - previousEnd
        : 0;

    if (current.length === 0) {
      startedAt = word.start ?? previousEnd ?? 0;
    } else if (!isSpacing && gap > SPLIT_SILENCE) {
      flush();
      startedAt = word.start ?? 0;
    }

    current.push(text);
    if (!isSpacing && word.speaker_id) speaker ??= word.speaker_id;
    if (!isSpacing && typeof word.end === "number") previousEnd = word.end;

    const ends = !isSpacing && /[.!?؟]\s*$/.test(text);
    const tooLong = current.filter((piece) => piece.trim()).length >= MAX_SEGMENT_WORDS;
    if (ends || tooLong) flush();
  }
  flush();

  return segments;
}

export async function POST(request: Request) {
  const limit = checkRateLimit(`${clientKey(request)}:lecture`, LECTURE_MAX_PER_WINDOW);
  if (!limit.allowed) {
    return Response.json(
      { error: apiError.tooManyUploads },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return Response.json(
      { error: apiError.transcriptionOff },
      { status: 501 },
    );
  }

  /* The audio arrives as streamed multipart rather than base64 in JSON:
   * base64 adds a third to the size and forces the whole recording through
   * the phone's JS heap, which kills mid-range Android on a long lecture. */
  /* React Native's global FormData type is write-only and shadows the server
   * one this route actually receives, so the readable shape is spelled out
   * here rather than fighting the ambient declaration. */
  const upload = (await request.formData().catch(() => null)) as
    | { get(name: string): unknown }
    | null;
  if (!upload) {
    return Response.json({ error: apiError.noRecording }, { status: 400 });
  }

  const file = upload.get("file");
  if (!(file instanceof Blob)) {
    return Response.json({ error: apiError.noRecording }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: apiError.recordingTooLong }, { status: 413 });
  }
  if (file.size < 1024) {
    return Response.json({ error: apiError.noSpeech }, { status: 422 });
  }

  const form = new FormData();
  form.append("file", file as Blob, "lecture.m4a");
  form.append("model_id", MODEL);
  form.append("timestamps_granularity", "word");
  form.append("diarize", "true");
  form.append("num_speakers", MAX_SPEAKERS);
  /* language_code is deliberately never set. These lectures switch between
   * Arabic and English inside a single sentence, and pinning one language
   * turns off exactly the multi-language detection that handles that. */

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "xi-api-key": key },
      // React Native's global FormData type shadows the server one this route
      // actually runs against; the value is a real multipart body either way.
      body: form as unknown as BodyInit,
    });
  } catch {
    return Response.json({ error: apiError.transcriptionUnreachable }, { status: 502 });
  }

  if (!response.ok) {
    if (response.status === 429) {
      return Response.json({ error: apiError.transcriptionBusy }, { status: 429 });
    }
    if (response.status === 401) {
      return Response.json({ error: apiError.transcriptionBadKey }, { status: 500 });
    }
    return Response.json({ error: apiError.transcriptionFailed }, { status: 502 });
  }

  const parsed = (await response.json().catch(() => null)) as
    | { text?: string; words?: ScribeWord[] }
    | null;

  if (!parsed) {
    return Response.json({ error: apiError.transcriptionBadResponse }, { status: 502 });
  }

  const segments = Array.isArray(parsed.words) && parsed.words.length > 0
    ? toSegments(parsed.words)
    : parsed.text
      ? [{ at: 0, text: parsed.text }]
      : [];

  if (segments.length === 0) {
    return Response.json({ error: apiError.noSpeech }, { status: 422 });
  }

  return Response.json({ segments });
}
