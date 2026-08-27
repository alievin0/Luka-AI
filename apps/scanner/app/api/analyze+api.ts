import Anthropic from "@anthropic-ai/sdk";
import { PACKS } from "../../src/packs/registry";
import { checkRateLimit, clientKey, LECTURE_MAX_PER_WINDOW } from "../../src/rate-limit";
import type { AudioPack, LectureAnalysis, Segment } from "../../src/packs/types";

const MODEL = process.env.DASHLIGHT_MODEL || "claude-opus-5";

/** A three-hour lecture transcribed is still well inside the context window,
 *  but an unbounded body is a denial-of-wallet vector on a public route. */
const MAX_TRANSCRIPT_CHARS = 200_000;

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
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
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
        },
      },
    },
    terms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["term", "definition"],
        properties: { term: { type: "string" }, definition: { type: "string" } },
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
function clampAnalysis(analysis: LectureAnalysis, words: number): LectureAnalysis {
  const ceiling = words < 120 ? 35 : words < 400 ? 65 : 100;
  return {
    ...analysis,
    confidence: Math.max(0, Math.min(ceiling, Math.round(analysis.confidence ?? 0))),
    examPredictions: (analysis.examPredictions ?? []).map((p) =>
      p.confidence === "high" && !p.why?.trim() ? { ...p, confidence: "medium" as const } : p,
    ),
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

  const emphasis = (body?.emphasis ?? [])
    .map((e) => `[${clock(e.at)}]${e.marked ? " (the student marked this by hand)" : ""} ${e.text}`)
    .join("\n");

  const words = transcript.split(/\s+/).filter(Boolean).length;

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: audioPack.systemPrompt({
        locale: body?.locale === "ar" ? "ar" : "en",
        profile: body?.profile || "",
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

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      return Response.json({ error: "ما وصلنا رد صالح. جرّب كمان مرة." }, { status: 502 });
    }

    const parsed = JSON.parse(text.text) as LectureAnalysis & { title: string };
    const { title, ...analysis } = parsed;
    return Response.json({ title, analysis: clampAnalysis(analysis, words) });
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
