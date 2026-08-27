import Anthropic from "@anthropic-ai/sdk";
import { SCANNER_PACKS } from "../../src/packs/registry";
import { checkRateLimit, clientKey } from "../../src/rate-limit";
import type { ScanResult } from "../../src/packs/types";

const MODEL = process.env.DASHLIGHT_MODEL || "claude-opus-5";

/**
 * JSON schema for the vision response. Structured outputs guarantee the shape,
 * so the client never has to defend against a half-parsed answer.
 */
const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "detected",
    "title",
    "subtitle",
    "severity",
    "confidence",
    "verdict",
    "verdictLevel",
    "summary",
    "facts",
    "causes",
    "actions",
    "seekHelpIf",
  ],
  properties: {
    detected: { type: "boolean" },
    notDetectedReason: { type: "string" },
    title: { type: "string" },
    subtitle: { type: "string" },
    severity: { type: "string", enum: ["critical", "warning", "info"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    verdict: { type: "string" },
    verdictLevel: { type: "string", enum: ["stop", "caution", "ok"] },
    summary: { type: "string" },
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value"],
        properties: { label: { type: "string" }, value: { type: "string" } },
      },
    },
    causes: { type: "array", items: { type: "string" } },
    actions: { type: "array", items: { type: "string" } },
    seekHelpIf: { type: "array", items: { type: "string" } },
    alsoDetected: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "severity"],
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: ["critical", "warning", "info"] },
        },
      },
    },
    cost: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["min", "max", "currency", "note"],
      properties: {
        min: { type: "number" },
        max: { type: "number" },
        currency: { type: "string" },
        note: { type: "string" },
      },
    },
  },
} as const;

/**
 * Safety clamp. The prompt already forbids reassuring the user about a
 * critical finding, but a prompt is not a guarantee — this makes it one.
 * Never let a critical result read as "safe to continue".
 */
function clampForSafety(result: ScanResult): ScanResult {
  if (result.severity === "critical" && result.verdictLevel === "ok") {
    return { ...result, verdictLevel: "stop" };
  }
  if (result.confidence === "low" && result.verdictLevel === "ok") {
    return { ...result, verdictLevel: "caution" };
  }
  return result;
}

/** Roughly 1024px of JPEG at q0.7, base64 — well above what the app sends. */
const MAX_IMAGE_BYTES = 4_000_000;

export async function POST(request: Request) {
  const limit = checkRateLimit(clientKey(request));
  if (!limit.allowed) {
    return Response.json(
      { error: "كترت الفحوصات بوقت قصير. جرّب بعد شوي." },
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
    base64?: string;
    currency?: string;
    profile?: string;
  } | null;

  const selected = SCANNER_PACKS[body?.packId ?? ""];
  if (!selected) {
    return Response.json({ error: "نوع الفحص غير معروف." }, { status: 400 });
  }
  if (!body?.base64) {
    return Response.json({ error: "ما وصلتنا صورة." }, { status: 400 });
  }
  if (body.base64.length > MAX_IMAGE_BYTES) {
    return Response.json({ error: "الصورة كبيرة كتير." }, { status: 413 });
  }

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: selected.systemPrompt({
        currency: body.currency || "USD",
        profile: body.profile || "",
      }),
      output_config: {
        format: {
          type: "json_schema",
          schema: RESULT_SCHEMA as unknown as Record<string, unknown>,
        },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: body.base64,
              },
            },
            { type: "text", text: "حلّل هذي الصورة." },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return Response.json(
        { error: "ما قدرنا نحلل هذي الصورة. جرّب صورة ثانية." },
        { status: 422 },
      );
    }

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      return Response.json(
        { error: "ما وصلنا رد صالح. جرّب كمان مرة." },
        { status: 502 },
      );
    }

    const parsed = JSON.parse(text.text) as ScanResult;
    return Response.json(clampForSafety(parsed));
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json(
        { error: "في ضغط على الخدمة هلق. جرّب بعد شوي." },
        { status: 429 },
      );
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return Response.json(
        { error: "الخادم غير مهيأ: مفتاح الـ API غير صالح." },
        { status: 500 },
      );
    }
    if (error instanceof Anthropic.APIError) {
      return Response.json(
        { error: "صار خطأ أثناء التحليل. جرّب كمان مرة." },
        { status: 502 },
      );
    }
    return Response.json(
      { error: "صار خطأ غير متوقع. جرّب كمان مرة." },
      { status: 500 },
    );
  }
}
