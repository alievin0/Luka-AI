import { NextResponse } from "next/server";
import {
  getWhatsAppConfig,
  parseIncoming,
  routeToTenant,
  sendText,
  verifySignature,
} from "@/lib/desk/whatsapp";
import { getTenant } from "@/lib/desk/tenants";
import { respond, getThread, appendThread } from "@/lib/desk/receptionist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Meta's webhook verification handshake. Called once when the webhook URL is
 * registered in the Meta dashboard, and again whenever it is re-verified.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const config = getWhatsAppConfig();

  if (!config) {
    return NextResponse.json(
      { error: "WhatsApp is not configured. See MONETIZATION-DESK.md." },
      { status: 503 },
    );
  }

  if (
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === config.verifyToken
  ) {
    // Meta expects the raw challenge string, not JSON.
    return new Response(params.get("hub.challenge") ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return NextResponse.json({ error: "Verification failed." }, { status: 403 });
}

export async function POST(req: Request) {
  const config = getWhatsAppConfig();
  if (!config) {
    return NextResponse.json({ error: "WhatsApp is not configured." }, { status: 503 });
  }

  // The signature covers the exact bytes Meta sent, so the body is read raw
  // and only parsed after the check passes.
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), config.appSecret)) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }
  if (!config.appSecret) {
    console.warn("[whatsapp] WHATSAPP_APP_SECRET is not set — deliveries are unverified.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  const incoming = parseIncoming(payload);

  // Acknowledge fast and unconditionally: Meta retries anything that is slow
  // or non-200, which would deliver the same customer message twice.
  for (const msg of incoming) {
    handle(msg).catch((err) => {
      console.error("[whatsapp] failed to handle message:", err?.message ?? err);
    });
  }

  return NextResponse.json({ received: incoming.length });
}

async function handle(msg: {
  from: string;
  text: string;
  phoneNumberId: string;
  profileName?: string;
}): Promise<void> {
  const config = getWhatsAppConfig();
  if (!config) return;

  const tenantId = routeToTenant(msg.phoneNumberId);
  const tenant = tenantId ? getTenant(tenantId) : null;
  if (!tenant) {
    console.warn(`[whatsapp] no tenant routed for phone_number_id ${msg.phoneNumberId}`);
    return;
  }

  const history = getThread(tenant.id, msg.from);
  const result = await respond({
    tenant,
    history,
    message: msg.text,
    customerContact: msg.from,
  });

  appendThread(tenant.id, msg.from, [
    { role: "user", content: msg.text },
    { role: "assistant", content: result.reply },
  ]);

  await sendText(msg.from, result.reply, config);

  if (result.escalation) {
    const owner = process.env.DESK_OWNER_WHATSAPP?.trim();
    if (owner) {
      const name = msg.profileName ? `${msg.profileName} (${msg.from})` : msg.from;
      await sendText(
        owner,
        `🔔 تحويل من ${tenant.name}\nالسبب: ${result.escalation.label}\nالزبون: ${name}\nالرسالة: ${msg.text}`,
        config,
      );
    } else {
      console.warn("[whatsapp] escalation with no DESK_OWNER_WHATSAPP set — nobody was notified.");
    }
  }
}
