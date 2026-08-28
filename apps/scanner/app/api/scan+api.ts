import Anthropic from "@anthropic-ai/sdk";
import { SCANNER_PACKS } from "../../src/packs/registry";
import { checkRateLimit, clientKey } from "../../src/rate-limit";
import type { ScanResult } from "../../src/packs/types";
import { apiError } from "../../src/i18n/errors";

const MODEL = process.env.DASHLIGHT_MODEL || "claude-opus-5";

/**
 * How hard the model thinks about one photo.
 *
 * The route never set this, which on Claude Opus 5 means adaptive thinking at
 * the default effort — the most expensive setting there is, chosen by
 * omission rather than on purpose. That may well be right: this is the answer
 * a driver acts on at the roadside, and reasoning is what separates "amber,
 * drive on" from "amber, stop now".
 *
 * So it stays at the default and becomes a dial instead of a silence. Lower it
 * only against measured results — `low` and `medium` are real savings on a
 * constrained classification, and a wrong verdict costs more than either.
 */
const EFFORT = (process.env.SCAN_EFFORT || "high") as "low" | "medium" | "high" | "xhigh" | "max";

/**
 * JSON schema for the vision response. Structured outputs guarantee the shape,
 * so the client never has to defend against a half-parsed answer.
 */
const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  /**
   * What the result screen renders unconditionally has to be here, or the
   * guarantee this file claims is only a claim.
   *
   * `ifIgnored`, `carContext` and `cost` were optional while the prompt called
   * two of them REQUIRED in prose — and `ifIgnored` is described there as "the
   * field people are actually paying for". A missing one does not error; the
   * card just silently disappears. `notDetectedReason` is here for the
   * opposite reason: it is the only field the not-detected screen reads, and
   * without it the driver gets a generic capture hint instead of being told
   * what was actually wrong with their photo.
   *
   * `cost` stays nullable rather than optional — some lights have no repair to
   * price, and `null` says that where an absent key says nothing.
   *
   * The honest shape here is two shapes, chosen on `detected`: a photo the
   * model could not read is still forced to invent a title, a verdict and
   * three facts, which cost tokens and are thrown away. `clampForSafety` drops
   * them below so nothing invented is stored or shown, but the model is still
   * paying to write them. Splitting the schema on `detected` needs a live call
   * to confirm the API's structured-output support for it, and there is no key
   * in this environment to make one.
   */
  required: [
    "detected",
    "notDetectedReason",
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
    "ifIgnored",
    "carContext",
    "cost",
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
      minItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value"],
        properties: { label: { type: "string" }, value: { type: "string" } },
      },
    },
    // Without a minimum, `[]` satisfies "required" and the screen quietly
    // drops a whole tab. The numbers are the ones the prompt asks for.
    causes: { type: "array", minItems: 2, items: { type: "string" } },
    actions: { type: "array", minItems: 2, items: { type: "string" } },
    seekHelpIf: { type: "array", minItems: 2, items: { type: "string" } },
    ifIgnored: { type: "string" },
    glyph: {
      type: "string",
      enum: ["abs", "airbag", "battery", "brake", "bulb", "catalytic", "coolant", "cruise", "door-ajar", "dpf", "droplet", "engine", "epb", "esc-off", "ev-battery", "ev-fault", "ev-ready", "fuel-pump", "glow-plug", "high-beam", "hybrid", "key", "oil-can", "pad-wear", "plug", "radar-car", "rear-fog", "regen", "seatbelt", "skid-car", "snowflake", "spanner", "start-stop", "steering", "suspension", "thermometer", "turtle", "tyre", "warning-triangle", "washer", "water-in-fuel"],
    },
    carContext: { type: "string" },
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
 *
 * It also drops what the schema forces the model to write about a photo it
 * said it could not read. One flat shape means a not-detected answer still
 * carries a title, a verdict and three facts; they are guesses about a light
 * nobody identified, they get saved to history with the scan, and none of them
 * is ever shown. Keeping them would make an honest "I could not read this"
 * look like a reading.
 */
function clampForSafety(result: ScanResult): ScanResult {
  if (!result.detected) {
    return { detected: false, notDetectedReason: result.notDetectedReason };
  }
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
  const limit = await checkRateLimit(clientKey(request));
  if (!limit.allowed) {
    return Response.json(
      { error: apiError.tooManyScans },
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
    base64?: string;
    currency?: string;
    profile?: string;
    locale?: string;
  } | null;

  const selected = SCANNER_PACKS[body?.packId ?? ""];
  if (!selected) {
    return Response.json({ error: apiError.unknownScanType }, { status: 400 });
  }
  if (!body?.base64) {
    return Response.json({ error: apiError.noImage }, { status: 400 });
  }
  if (body.base64.length > MAX_IMAGE_BYTES) {
    return Response.json({ error: apiError.imageTooLarge }, { status: 413 });
  }

  const client = new Anthropic();
  const locale = body.locale === "ar" ? "ar" : "en";

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: selected.systemPrompt({
        currency: body.currency || "USD",
        profile: body.profile || "",
        locale,
      }),
      output_config: {
        effort: EFFORT,
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
            // The system prompt sets the answer's language; this turn was
            // Arabic for everyone, which leans on the model to answer in
            // Arabic for an English user against its own instructions.
            {
              type: "text",
              text: locale === "ar" ? "حلّل هذه الصورة." : "Analyse this photo.",
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return Response.json(
        { error: apiError.cannotRead },
        { status: 422 },
      );
    }

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      return Response.json(
        { error: apiError.badResponse },
        { status: 502 },
      );
    }

    // One line per scan, so what a scan costs is a number someone can read off
    // the logs rather than a guess. Nothing here identifies a user: it is the
    // pack, the settings the request ran under, and the token counts.
    const usage = response.usage;
    console.log(
      JSON.stringify({
        scan: body.packId,
        model: MODEL,
        effort: EFFORT,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      }),
    );

    const parsed = JSON.parse(text.text) as ScanResult;
    return Response.json(clampForSafety(parsed));
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json(
        { error: apiError.busy },
        { status: 429 },
      );
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return Response.json(
        { error: apiError.badKey },
        { status: 500 },
      );
    }
    if (error instanceof Anthropic.APIError) {
      return Response.json(
        { error: apiError.analysisFailed },
        { status: 502 },
      );
    }
    return Response.json(
      { error: apiError.unexpected },
      { status: 500 },
    );
  }
}
