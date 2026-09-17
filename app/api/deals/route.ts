import { NextResponse } from "next/server";
import { huntDeals } from "@/lib/deals";
import { publishDeals, getTelegramConfig } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Hunting involves a dozen web searches and page fetches; give it room.
// Vercel rejects a build whose maxDuration exceeds the plan's limit (60s on
// Hobby, higher on paid plans), so this stays at the value every plan accepts.
// Raise it only after confirming the deployment plan allows it.
export const maxDuration = 60;

/**
 * Run the deal hunter and publish what it verified.
 *
 * Meant to be called on a schedule (Vercel Cron, GitHub Actions, cron-job.org).
 * Every call spends API credits and posts publicly, so it is gated on
 * CRON_SECRET and refuses to run when that is unset.
 */
async function handle(req: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return NextResponse.json(
      {
        error:
          "CRON_SECRET is not set. Set it before enabling this endpoint — without " +
          "it anyone could spend your API credits and post to your channel.",
      },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const provided =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    url.searchParams.get("secret")?.trim();

  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body =
    req.method === "POST"
      ? ((await req.json().catch(() => ({}))) as Record<string, unknown>)
      : {};

  const param = (name: string): string | undefined => {
    const fromBody = body[name];
    if (typeof fromBody === "string" && fromBody.trim()) return fromBody.trim();
    return url.searchParams.get(name)?.trim() || undefined;
  };

  const limitRaw = param("limit");
  const parsedLimit = limitRaw ? Number(limitRaw) : NaN;
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(10, Math.max(1, Math.floor(parsedLimit)))
    : 5;

  // `dryRun` hunts and returns the deals without posting — the safe way to see
  // what the bot would publish before pointing it at a live channel.
  const dryRun = param("dryRun") === "true" || body.dryRun === true;

  try {
    const { deals, summary } = await huntDeals({
      category: param("category"),
      region: param("region"),
      language: param("language"),
      currency: param("currency"),
      limit,
    });

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, summary, deals });
    }

    if (deals.length === 0) {
      return NextResponse.json({
        ok: true,
        published: 0,
        summary: `${summary} Nothing was published.`,
        deals: [],
      });
    }

    if (!getTelegramConfig()) {
      return NextResponse.json(
        {
          ok: false,
          summary,
          deals,
          error:
            "Deals were found but Telegram is not configured — set " +
            "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to publish them.",
        },
        { status: 503 },
      );
    }

    const published = await publishDeals(deals, {
      mode: param("mode") === "digest" ? "digest" : "individual",
      heading: param("heading"),
    });

    return NextResponse.json({
      ok: published.failed === 0,
      published: published.sent,
      failed: published.failed,
      errors: published.errors,
      summary,
      deals,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
