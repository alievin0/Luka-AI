import { NextResponse } from "next/server";
import {
  getWhatsAppConfig,
  parseIncoming,
  sendText,
  verifySignature,
} from "@/lib/desk/whatsapp";
import { handleIncoming } from "@/lib/desk/pipeline";
import { ESCALATION_LABEL, type EscalationReason } from "@/lib/desk/escalation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Meta's webhook verification handshake, run when the URL is registered. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const config = getWhatsAppConfig();
  if (!config) {
    return NextResponse.json(
      { error: "WhatsApp is not configured. See DESK.md." },
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
  // and parsed only after the check passes.
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

  // Acknowledge immediately: Meta retries anything slow or non-200, which
  // would deliver the same customer message again.
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
  messageId: string;
  phoneNumberId: string;
  profileName?: string;
}): Promise<void> {
  const config = getWhatsAppConfig();
  if (!config) return;

  const result = await handleIncoming({
    channel: "whatsapp",
    accountId: msg.phoneNumberId,
    from: msg.from,
    text: msg.text,
    externalId: msg.messageId,
    profileName: msg.profileName,
  });

  // A duplicate delivery is a no-op: the customer already got this reply.
  if (result.duplicate) return;

  if (!result.ok || !result.reply) {
    console.error("[whatsapp] pipeline did not produce a reply:", result.error);
    return;
  }

  await sendText(msg.from, result.reply, config);

  if (result.escalation) {
    const owner = process.env.DESK_OWNER_WHATSAPP?.trim();
    const label =
      ESCALATION_LABEL[result.escalation.reason as EscalationReason] ?? result.escalation.reason;
    if (owner) {
      const who = msg.profileName ? `${msg.profileName} (${msg.from})` : msg.from;
      await sendText(
        owner,
        `🔔 تحويل من ${result.business?.name ?? "النشاط"}\n` +
          `السبب: ${label}\nالزبون: ${who}\nالرسالة: ${msg.text}`,
        config,
      );
    } else {
      console.warn("[whatsapp] escalation with no DESK_OWNER_WHATSAPP set — nobody was notified.");
    }
  }
}
