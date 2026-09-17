import { NextResponse } from "next/server";
import { getTenant, listTenants, tenantIssues } from "@/lib/desk/tenants";
import { respond, type Turn } from "@/lib/desk/receptionist";
import { listBookings } from "@/lib/desk/bookings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Tenant list plus any configuration problems, for the console. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("tenant");
  if (id) {
    const tenant = getTenant(id);
    if (!tenant) return NextResponse.json({ error: "Unknown tenant." }, { status: 404 });
    return NextResponse.json({ tenant, bookings: listBookings(tenant.id) });
  }
  return NextResponse.json({
    tenants: listTenants().map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      isExample: !!t.isExample,
      services: t.services,
    })),
    issues: tenantIssues(),
  });
}

/**
 * One turn of a customer conversation.
 *
 * The console posts here directly; the WhatsApp webhook calls the same
 * `respond` underneath, so both channels behave identically.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    tenantId?: string;
    message?: string;
    history?: Turn[];
    contact?: string;
  } | null;

  const tenantId = body?.tenantId?.trim();
  const message = body?.message?.trim();

  if (!tenantId) return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
  if (!message) return NextResponse.json({ error: "message is required." }, { status: 400 });

  const tenant = getTenant(tenantId);
  if (!tenant) return NextResponse.json({ error: `Unknown tenant: ${tenantId}` }, { status: 404 });

  const history = Array.isArray(body?.history)
    ? body.history
        .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
        .slice(-20)
    : [];

  try {
    const result = await respond({
      tenant,
      history,
      message,
      customerContact: body?.contact?.trim() || undefined,
    });
    return NextResponse.json({
      reply: result.reply,
      escalation: result.escalation ?? null,
      bookings: result.bookings,
      used: result.used,
      allBookings: listBookings(tenant.id),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
