import Anthropic from "@anthropic-ai/sdk";
import { PACKS } from "../../src/packs/registry";
import { checkRateLimit, clientKey, LECTURE_MAX_PER_WINDOW } from "../../src/rate-limit";
import type { AudioPack, LectureAnalysis, Segment } from "../../src/packs/types";

const MODEL = process.env.DASHLIGHT_MODEL || "claude-opus-5";

/** A three-hour lecture transcribed is still well inside the context window,
 *  but an unbounded body is a denial-of-wallet vector on a public route. */
const MAX_TRANSCRIPT_CHARS = 200_000;
/* Capping the transcript alone is not a cap: every other client-supplied
 * field lands in the same prompt and is charged at the same rate. The app
 * sends at most 24 emphasis moments and a one-line profile; the route is
 * public, so it enforces that rather than trusting it. */
const MAX_EMPHASIS_ENTRIES = 24;
const MAX_EMPHASIS_CHARS = 8_000;
const MAX_PROFILE_CHARS = 400;

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "summary",
    "keyPoints",
    "tasks",
    "emphasised",
    "examPredictions",
    "terms",
    "chapters",
    "confidence",
  ],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    keyPoints: { type: "array", items: { type: "string" } },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          text: { type: "string" },
          due: { type: "string" },
          dueISO: { type: "string" },
          dueIsExplicit: { type: "boolean" },
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
          atSeconds: { type: "number" },
          quote: { type: "string" },
        },
      },
    },
    emphasised: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "atSeconds", "reason"],
        properties: {
          text: { type: "string" },
          atSeconds: { type: "number" },
          reason: { type: "string" },
        },
      },
    },
    examPredictions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "confidence", "why"],
        properties: {
          topic: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          why: { type: "string" },
          basis: { type: "string", enum: ["stated", "inferred"] },
          atSeconds: { type: "number" },
          quote: { type: "string" },
        },
      },
    },
    terms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["term", "definition"],
        properties: {
          term: { type: "string" },
          definition: { type: "string" },
          atSeconds: { type: "number" },
          quote: { type: "string" },
        },
      },
    },
    chapters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "atSeconds", "points"],
        properties: {
          title: { type: "string" },
          atSeconds: { type: "number" },
          points: { type: "array", items: { type: "string" } },
        },
      },
    },
    confidence: { type: "number" },
  },
} as const;

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/**
 * Keeps the model honest about the two things students would be hurt by.
 *
 * A prediction the lecturer never hinted at is worse than no prediction —
 * someone revises the wrong topic — so an examPrediction may not claim high
 * confidence unless it cites the lecturer. And the confidence figure is shown
 * to the student as a quality signal, so it cannot exceed what the transcript
 * actually supports: a near-empty transcript cannot produce a confident read.
 */
function clampAnalysis(
  analysis: LectureAnalysis,
  words: number,
  transcript: string,
): LectureAnalysis {
  /* A quotation the transcript does not contain is a fabrication, and the
   * whole provenance feature rests on it being real. Compared loosely —
   * collapsed whitespace, no punctuation — because the model reproduces the
   * words faithfully far more often than it reproduces the commas. */
  const flat = transcript.replace(/[\s\p{P}]+/gu, " ").toLowerCase();
  const grounded = <T extends { quote?: string; atSeconds?: number }>(item: T): T => {
    if (!item.quote) return item;
    const needle = item.quote.replace(/[\s\p{P}]+/gu, " ").toLowerCase().trim();
    if (needle.length >= 8 && flat.includes(needle)) return item;
    // Drop the quote, keep the timestamp: the claim may still be right, but
    // it will not be presented as something the lecturer was heard to say.
    const { quote, ...rest } = item;
    return rest as T;
  };

  const ceiling = words < 120 ? 35 : words < 400 ? 65 : 100;
  return {
    ...analysis,
    confidence: Math.max(0, Math.min(ceiling, Math.round(analysis.confidence ?? 0))),
    tasks: (analysis.tasks ?? []).map(grounded),
    terms: (analysis.terms ?? []).map(grounded),
    examPredictions: (analysis.examPredictions ?? [])
      .map(grounded)
      .map((p) =>
        p.confidence === "high" && !p.why?.trim() ? { ...p, confidence: "medium" as const } : p,
      )
      // A prediction claiming the lecturer stated it, with nothing quoted to
      // show for it, is downgraded to what it actually is.
      .map((p) => (p.basis === "stated" && !p.quote ? { ...p, basis: "inferred" as const } : p)),
  };
}

export async function POST(request: Request) {
  const limit = checkRateLimit(`${clientKey(request)}:lecture`, LECTURE_MAX_PER_WINDOW);
  if (!limit.allowed) {
    return Response.json(
      { error: "كترت التحليلات بوقت قصير. جرّب بعد شوي." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "الخادم غير مهيأ: مفتاح ANTHROPIC_API_KEY مفقود." },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    packId?: string;
    segments?: Segment[];
    emphasis?: { at: number; text: string; marked?: boolean }[];
    profile?: string;
    duration?: number;
    recordedAt?: number;
    locale?: string;
  } | null;

  const selected = PACKS[body?.packId ?? ""];
  if (!selected || selected.kind !== "audio") {
    return Response.json({ error: "نوع التطبيق غير معروف." }, { status: 400 });
  }
  const audioPack = selected as AudioPack;

  const segments = Array.isArray(body?.segments) ? body!.segments : [];
  if (segments.length === 0) {
    return Response.json({ error: "ما في نص محاضرة نحلله." }, { status: 400 });
  }

  const transcript = segments
    .map((s) => `[${clock(s.at)}] ${s.text}`)
    .join("\n")
    .slice(0, MAX_TRANSCRIPT_CHARS);

  const emphasis = (Array.isArray(body?.emphasis) ? body!.emphasis : [])
    .slice(0, MAX_EMPHASIS_ENTRIES)
    .map((e) => `[${clock(e.at)}]${e.marked ? " (the student marked this by hand)" : ""} ${e.text}`)
    .join("\n")
    .slice(0, MAX_EMPHASIS_CHARS);

  const profile = (body?.profile || "").slice(0, MAX_PROFILE_CHARS);

  const words = transcript.split(/\s+/).filter(Boolean).length;

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: audioPack.systemPrompt({
        locale: body?.locale === "ar" ? "ar" : "en",
        profile,
      }),
      output_config: {
        format: {
          type: "json_schema",
          schema: ANALYSIS_SCHEMA as unknown as Record<string, unknown>,
        },
      },
      messages: [
        {
          role: "user",
          content: `LECTURE TRANSCRIPT (each line is stamped with when it was said, mm:ss):

${transcript}

---

MOMENTS THE LECTURER'S VOICE ROSE ABOVE THEIR OWN BASELINE, or that the student marked by hand:

${emphasis || "(none detected — the lecture was delivered at an even volume)"}

---

Also give the lecture a short title naming what it was actually about, in the student's language. And give "confidence": how much of this transcript you could genuinely rely on, 0–100 — low when the text is garbled, sparse, or clearly missing stretches of the lecture. "chapters" is the lecture broken into its parts in order, each anchored to the timestamp where that part began.

Total recorded length: ${Math.round((body?.duration ?? 0) / 60)} minutes.
This lecture was recorded on ${new Date(body?.recordedAt ?? Date.now()).toISOString()}.

For each task, also set "dueISO" — the deadline resolved into an ISO 8601 timestamp against that recording date, so "next Tuesday" or "before 11pm" becomes a real date. Only set it when the lecturer was specific enough that you are not guessing; leave it out otherwise. It is used to put the deadline in the student's calendar, so a wrong date is worse than no date.`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return Response.json({ error: "ما قدرنا نحلل هذي المحاضرة." }, { status: 422 });
    }

    // A response cut off at max_tokens is truncated mid-JSON. Letting it fall
    // through to the catch below would report it as a transient failure and
    // invite a retry that costs the same and fails identically every time,
    // burning the hourly allowance for nothing.
    if (response.stop_reason === "max_tokens") {
      return Response.json(
        { error: "المحاضرة طويلة كتير عالتحليل مرة وحدة. جرّب تقسمها." },
        { status: 413 },
      );
    }

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      return Response.json({ error: "ما وصلنا رد صالح. جرّب كمان مرة." }, { status: 502 });
    }

    let parsed: LectureAnalysis & { title: string };
    try {
      parsed = JSON.parse(text.text) as LectureAnalysis & { title: string };
    } catch {
      // Distinguished from an API failure: retrying this is not free, and a
      // malformed payload is not something waiting will fix.
      return Response.json({ error: "ما وصلنا رد صالح. جرّب كمان مرة." }, { status: 502 });
    }
    const { title, ...analysis } = parsed;
    return Response.json({ title, analysis: clampAnalysis(analysis, words, transcript) });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "في ضغط على الخدمة هلق. جرّب بعد شوي." }, { status: 429 });
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: "الخادم غير مهيأ: مفتاح الـ API غير صالح." }, { status: 500 });
    }
    return Response.json({ error: "صار خطأ أثناء التحليل. جرّب كمان مرة." }, { status: 502 });
  }
}
