/**
 * WhatsApp Cloud API adapter.
 *
 * WhatsApp is the channel small businesses in Jordan and the Gulf actually
 * sell on, which is why the receptionist is built to sit behind it. Everything
 * here is complete and inert until four environment variables exist — they
 * come from a Meta Business account, which must be opened by the operator in
 * their own name.
 *
 * Meta signs every webhook delivery. That signature is verified before a
 * message is acted on: without the check, anyone who learns the URL could
 * impersonate a customer and drive the agent.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const GRAPH = "https://graph.facebook.com/v21.0";

export type WhatsAppConfig = {
  token: string;
  phoneNumberId: string;
  verifyToken: string;
  appSecret?: string;
};

export function getWhatsAppConfig(): WhatsAppConfig | null {
  const token = process.env.WHATSAPP_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  if (!token || !phoneNumberId || !verifyToken) return null;
  return { token, phoneNumberId, verifyToken, appSecret: process.env.WHATSAPP_APP_SECRET?.trim() };
}

/** Which tenant owns which WhatsApp number: {"<phone_number_id>": "<tenantId>"} */
export function routeToTenant(phoneNumberId: string): string | null {
  const raw = process.env.DESK_WHATSAPP_ROUTES?.trim();
  if (raw) {
    try {
      const map = JSON.parse(raw) as Record<string, string>;
      const hit = map?.[phoneNumberId];
      if (typeof hit === "string" && hit.trim()) return hit.trim();
    } catch {
      console.warn("[whatsapp] DESK_WHATSAPP_ROUTES is not valid JSON — ignoring it.");
    }
  }
  return process.env.DESK_DEFAULT_TENANT?.trim() || null;
}

/**
 * Verify Meta's `X-Hub-Signature-256` header against the raw request body.
 *
 * Returns false when an app secret is configured and the signature does not
 * match. With no app secret configured it returns true and logs once — the
 * caller decides whether to accept unverified traffic.
 */
export function verifySignature(rawBody: string, header: string | null, appSecret?: string): boolean {
  if (!appSecret) return true;
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type IncomingMessage = {
  from: string;
  text: string;
  messageId: string;
  phoneNumberId: string;
  profileName?: string;
};

/**
 * Pull the plain-text messages out of a webhook payload.
 *
 * Meta nests deeply and sends many event kinds through the same hook
 * (delivery receipts, reactions, status updates). Anything that is not a text
 * message from a customer is ignored rather than half-handled.
 */
export function parseIncoming(body: unknown): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  const entries = (body as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = (change as { value?: Record<string, unknown> })?.value;
      if (!value) continue;

      const phoneNumberId = String(
        (value.metadata as { phone_number_id?: string })?.phone_number_id ?? "",
      );
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];

      for (const raw of messages) {
        const m = raw as Record<string, unknown>;
        if (m.type !== "text") continue;
        const text = (m.text as { body?: string })?.body;
        const from = typeof m.from === "string" ? m.from : "";
        if (!text?.trim() || !from) continue;

        const contact = contacts.find(
          (c) => (c as { wa_id?: string })?.wa_id === from,
        ) as { profile?: { name?: string } } | undefined;

        out.push({
          from,
          text: text.trim(),
          messageId: String(m.id ?? ""),
          phoneNumberId,
          profileName: contact?.profile?.name,
        });
      }
    }
  }
  return out;
}

export type SendResult = { ok: boolean; error?: string };

export async function sendText(to: string, text: string, config: WhatsAppConfig): Promise<SendResult> {
  try {
    const res = await fetch(`${GRAPH}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text.slice(0, 4096) },
      }),
    });

    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      return { ok: false, error: detail?.error?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
