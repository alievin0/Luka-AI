import { NextResponse } from "next/server";
import { getClickStats, getRecentClicks } from "@/lib/clicks";
import { affiliateStatus } from "@/lib/affiliate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator dashboard data: which programs are live, and what shoppers clicked.
 *
 * Click data is business information, so this is gated on LUKA_ADMIN_SECRET.
 * Without that variable the endpoint is disabled rather than public.
 */
export async function GET(req: Request) {
  const expected = process.env.LUKA_ADMIN_SECRET?.trim();
  if (!expected) {
    return NextResponse.json(
      { error: "Stats are disabled. Set LUKA_ADMIN_SECRET to enable this endpoint." },
      { status: 404 },
    );
  }

  const url = new URL(req.url);
  const provided =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    url.searchParams.get("secret")?.trim();

  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return NextResponse.json({
    affiliate: affiliateStatus(),
    clicks: getClickStats(),
    recent: getRecentClicks(50),
    note:
      "Clicks are counted in memory per server instance and reset on deploy. " +
      "Set LUKA_CLICK_LOG to persist them, and always reconcile earnings " +
      "against each affiliate program's own dashboard.",
  });
}
