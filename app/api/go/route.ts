import { NextResponse } from "next/server";
import { resolveTarget } from "@/lib/links";
import { recordClick } from "@/lib/clicks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Outbound click handler: record the click, then send the shopper to the store.
 *
 * `resolveTarget` decides whether a destination may be followed at all — see
 * lib/links.ts for the signature and allowlist guards.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const resolved = resolveTarget(params);

  if (!resolved.ok) {
    return NextResponse.json(
      { error: `Link could not be followed (${resolved.reason}).` },
      { status: resolved.reason === "missing" ? 400 : 403 },
    );
  }

  recordClick({
    at: new Date().toISOString(),
    host: resolved.url.hostname.replace(/^www\./, ""),
    network: params.get("n"),
    title: params.get("t") ?? undefined,
    source: params.get("s") ?? undefined,
    session: params.get("sid") ?? undefined,
  });

  // 302, not 301: affiliate destinations change, and a cached permanent
  // redirect would keep sending shoppers to a stale tagged URL.
  return NextResponse.redirect(resolved.url.toString(), {
    status: 302,
    headers: {
      // Don't leak our page URL to the merchant, and don't let a proxy cache
      // one shopper's destination for another.
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
