import { NextRequest, NextResponse } from "next/server";
import { synthesize, status, MAX_CHARS } from "@/lib/desk/tts";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Speech for the console and, later, for the phone channel.
 *
 * This endpoint spends money on every miss, so it is deliberately narrow: a
 * short text, a modest per-caller rate, and no way to select a voice from the
 * request. Without those it is an open proxy to a paid TTS account that anyone
 * who finds the URL can drain.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, number[]>();

function rateLimited(request: NextRequest): boolean {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);

  // The map would otherwise grow without bound on a long-lived instance.
  if (hits.size > 500) {
    for (const [k, times] of Array.from(hits.entries())) {
      if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
    }
  }
  return recent.length > MAX_PER_WINDOW;
}

/** What the console needs to tell the operator which voice they are hearing. */
export async function GET() {
  return NextResponse.json(status());
}

export async function POST(request: NextRequest) {
  if (rateLimited(request)) {
    return NextResponse.json(
      { error: "طلبات كثيرة بوقت قصير. استنى شوي." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح." }, { status: 400 });
  }

  const text = (body as { text?: unknown })?.text;
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "لازم ترسل نص." }, { status: 400 });
  }
  if (text.length > MAX_CHARS) {
    return NextResponse.json(
      { error: `النص أطول من ${MAX_CHARS} حرف.` },
      { status: 413 },
    );
  }

  const result = await synthesize(text);
  if (!result.ok) {
    // 501 for "nobody configured a provider" separates a missing setup from a
    // provider that is configured and failing — the console says different
    // things about each, and the client falls back to the browser voice either
    // way rather than going silent.
    const code = result.reason === "unconfigured" ? 501 : 502;
    return NextResponse.json(
      { error: result.message, reason: result.reason },
      { status: code },
    );
  }

  return new NextResponse(Buffer.from(result.audio), {
    headers: {
      "Content-Type": result.contentType,
      "Content-Length": String(result.audio.byteLength),
      "Cache-Control": "private, max-age=3600",
      "X-Tts-Provider": result.provider,
      "X-Tts-Cached": result.cached ? "1" : "0",
    },
  });
}
