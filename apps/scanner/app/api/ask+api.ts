import Anthropic from "@anthropic-ai/sdk";
import { PACKS } from "../../src/packs/registry";
import { ASK_MAX_PER_WINDOW, checkRateLimit, clientKey } from "../../src/rate-limit";
import { apiError } from "../../src/i18n/errors";

const MODEL = process.env.DASHLIGHT_MODEL || "claude-opus-5";

/** The device already narrows the semester to what the question needs; these
 *  are the ceilings the public route enforces rather than trusts. */
const MAX_EXCERPTS = 90;
const MAX_EXCERPT_CHARS = 60_000;
const MAX_OVERVIEW = 40;
const MAX_QUESTION_CHARS = 500;

type Excerpt = { lectureId?: string; lectureTitle?: string; at?: number; text?: string };
type Overview = { id?: string; title?: string; summary?: string; terms?: string[] };

type Citation = { lectureId: string; atSeconds?: number; quote?: string };
type Answer = { answered: boolean; answer: string; citations: Citation[] };

const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answered", "answer", "citations"],
  properties: {
    /** False when the excerpts simply do not cover the question. */
    answered: { type: "boolean" },
    answer: { type: "string" },
    citations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["lectureId"],
        properties: {
          lectureId: { type: "string" },
          atSeconds: { type: "number" },
          quote: { type: "string" },
        },
      },
    },
  },
} as const;

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

const flatten = (text: string) => text.replace(/[\s\p{P}]+/gu, " ").toLowerCase().trim();

/**
 * Throw away anything the excerpts do not support.
 *
 * This is the whole contract of the feature. A study tool that invents a
 * timestamp is worse than one that says it does not know: the student goes to
 * 42:18, hears something else, and now cannot trust any of the other answers
 * either. So a citation survives only if its lecture is one we sent and its
 * quotation is genuinely in the text we sent — and an answer that ends up
 * with no citations at all is reported as unanswered rather than served as a
 * bare assertion.
 */
function ground(answer: Answer, excerpts: Excerpt[]): Answer {
  const known = new Set(excerpts.map((e) => e.lectureId));
  const haystack = flatten(excerpts.map((e) => e.text ?? "").join(" "));

  const citations = (answer.citations ?? []).filter((citation) => {
    if (!known.has(citation.lectureId)) return false;
    if (!citation.quote) return true;
    const needle = flatten(citation.quote);
    return needle.length >= 8 && haystack.includes(needle);
  });

  return {
    ...answer,
    answered: answer.answered && citations.length > 0,
    citations,
  };
}

export async function POST(request: Request) {
  const limit = checkRateLimit(`${clientKey(request)}:ask`, ASK_MAX_PER_WINDOW);
  if (!limit.allowed) {
    return Response.json(
      { error: apiError.tooManyQuestions },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  // The message says only that the service is not set up: it is read by a
  // user who cannot set an environment variable. The variable is named here,
  // where the deployer is looking.
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: apiError.notConfigured },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    packId?: string;
    locale?: string;
    question?: string;
    excerpts?: Excerpt[];
    overview?: Overview[];
  } | null;

  const selected = PACKS[body?.packId ?? ""];
  if (!selected || selected.kind !== "audio") {
    return Response.json({ error: apiError.unknownPack }, { status: 400 });
  }

  const question = (body?.question ?? "").trim().slice(0, MAX_QUESTION_CHARS);
  if (!question) {
    return Response.json({ error: apiError.noQuestion }, { status: 400 });
  }

  const excerpts = (Array.isArray(body?.excerpts) ? body!.excerpts : [])
    .filter((e): e is Excerpt & { lectureId: string; text: string } =>
      Boolean(e && typeof e.lectureId === "string" && typeof e.text === "string"),
    )
    .slice(0, MAX_EXCERPTS);

  const overview = (Array.isArray(body?.overview) ? body!.overview : []).slice(0, MAX_OVERVIEW);

  if (excerpts.length === 0 && overview.length === 0) {
    return Response.json(
      { answered: false, answer: "", citations: [] } satisfies Answer,
      { status: 200 },
    );
  }

  const evidence = excerpts
    .map((e) => `[lecture:${e.lectureId} @ ${clock(e.at ?? 0)}] ${e.text}`)
    .join("\n")
    .slice(0, MAX_EXCERPT_CHARS);

  const catalogue = overview
    .map(
      (o) =>
        `lecture:${o.id} — "${o.title}"${o.terms?.length ? ` (concepts: ${o.terms.slice(0, 12).join(", ")})` : ""}\n  ${o.summary ?? ""}`,
    )
    .join("\n");

  const arabic = body?.locale === "ar";

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: `You answer a university student's questions about lectures they recorded themselves.

You have two sources and no others: a catalogue of their lectures, and passages from the transcripts that were selected because they match the question. Everything you say must come from those passages.

Rules, in order of importance:

1. Never state anything the passages do not support. If they do not cover the question, set "answered" to false and leave "answer" empty. Saying "your lectures do not cover this" is a correct and useful answer; guessing is not.
2. Every claim in the answer must be traceable. Fill "citations" with the passages you used: the lectureId exactly as given, the timestamp in seconds, and the quotation copied word for word from the passage. Never write a quotation from memory or tidy up its wording — it is checked against the transcript, and an altered one is discarded.
3. Do not present your own inference as something the lecturer said. If you are reasoning across passages, say so in the answer.
4. Be brief. Two or three sentences answers most questions. The student came for the answer and the place to hear it, not an essay.
5. Answer in ${arabic ? "Arabic, in the same everyday register the student is writing in" : "English"}.`,
      output_config: {
        format: {
          type: "json_schema",
          schema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
        },
      },
      messages: [
        {
          role: "user",
          content: `THE STUDENT'S LECTURES:

${catalogue || "(no summaries available)"}

---

PASSAGES FROM THOSE LECTURES, selected because they match the question. Each line is stamped with the lecture it came from and when it was said:

${evidence || "(no matching passages found)"}

---

QUESTION: ${question}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return Response.json({ error: apiError.cannotAnswer }, { status: 422 });
    }

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      return Response.json({ error: apiError.badResponse }, { status: 502 });
    }

    let parsed: Answer;
    try {
      parsed = JSON.parse(text.text) as Answer;
    } catch {
      return Response.json({ error: apiError.badResponse }, { status: 502 });
    }

    return Response.json(ground(parsed, excerpts));
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: apiError.busy }, { status: 429 });
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return Response.json({ error: apiError.badKey }, { status: 500 });
    }
    return Response.json({ error: apiError.failed }, { status: 502 });
  }
}
