import { NextResponse } from "next/server";
import { getRepo, repoHealth } from "@/lib/desk/db";
import { handleIncoming } from "@/lib/desk/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Whether this deployment can reach the model at all.
 *
 * A missing key and a failed API call used to look identical to the operator
 * — both surfaced as "a temporary technical problem". Reporting the
 * configuration separately is what makes a misconfigured deployment
 * diagnosable without reading server logs.
 *
 * Only ever a boolean and the key's length: the value itself never leaves
 * the server.
 */
function modelStatus(): { configured: boolean; keyLength: number } {
  const key = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  return { configured: key.length > 0, keyLength: key.length };
}

/**
 * Operator-facing read surface, and the web chat channel.
 *
 * Both the console and the world read from here, so what the world draws is
 * the same state the product runs on.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ref = url.searchParams.get("business") || url.searchParams.get("tenant");
  const repo = getRepo();

  if (!ref) {
    const [businesses, health] = await Promise.all([repo.listBusinesses(), repoHealth()]);
    return NextResponse.json({ businesses, storage: health, model: modelStatus() });
  }

  const business = await repo.getBusiness(ref);
  if (!business) {
    return NextResponse.json({ error: `Unknown business: ${ref}` }, { status: 404 });
  }

  const [bookings, escalations, agents, events, tasks, conversations, health] = await Promise.all([
    repo.listBookings(business.id),
    repo.listEscalations(business.id, { openOnly: true }),
    repo.listAgents(business.id),
    repo.listEvents(business.id, 60),
    repo.listTasks(business.id, 20),
    repo.listConversations(business.id, 30),
    repoHealth(),
  ]);

  return NextResponse.json({
    business,
    bookings,
    escalations,
    agents,
    events,
    tasks,
    conversations,
    storage: health,
    model: modelStatus(),
  });
}

/** One turn of a web-chat conversation, through the same pipeline as WhatsApp. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    businessId?: string;
    tenantId?: string;
    message?: string;
    contact?: string;
  } | null;

  const businessRef = (body?.businessId ?? body?.tenantId ?? "").trim();
  const message = body?.message?.trim();

  if (!businessRef) return NextResponse.json({ error: "businessId is required." }, { status: 400 });
  if (!message) return NextResponse.json({ error: "message is required." }, { status: 400 });

  const result = await handleIncoming({
    channel: "web",
    businessRef,
    from: body?.contact?.trim() || "console",
    text: message,
  });

  if (!result.ok && result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const repo = getRepo();
  const businessId = result.business!.id;
  const [bookings, escalations] = await Promise.all([
    repo.listBookings(businessId),
    repo.listEscalations(businessId, { openOnly: true }),
  ]);

  return NextResponse.json({
    reply: result.reply,
    escalation: result.escalation ?? null,
    conversationId: result.conversationId,
    taskId: result.taskId,
    bookings,
    escalations,
  });
}
