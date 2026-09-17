/**
 * Telegram publishing.
 *
 * Telegram is the cheapest distribution channel to start from zero: a channel
 * costs nothing, posts are permanent and searchable, links are clickable with
 * no "link in bio" friction, and a bot can post unattended on a schedule.
 *
 * Requires TELEGRAM_BOT_TOKEN (from @BotFather) and TELEGRAM_CHAT_ID (the
 * channel, e.g. "@luka_deals", with the bot added as an administrator).
 */

import type { Deal } from "./deals";

const API_BASE = "https://api.telegram.org";

/**
 * Affiliate disclosure. Required by Amazon Associates' operating agreement and
 * by consumer-protection rules in most markets — an undisclosed affiliate link
 * is grounds for termination and forfeited earnings, so it is not optional and
 * must not be removed to make posts look cleaner.
 */
export const DISCLOSURE_AR =
  "بعض الروابط روابط تسويق بالعمولة — إذا اشتريت من خلالها بوصلني عمولة بسيطة بدون أي فرق بالسعر عليك.";
export const DISCLOSURE_EN =
  "Some links are affiliate links — if you buy through them I earn a small commission at no extra cost to you.";

/** Telegram's HTML parse mode only needs these three escaped. */
function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatPrice(amount?: number, currency?: string): string | null {
  if (amount === undefined) return null;
  const rounded = Math.round(amount * 100) / 100;
  return currency ? `${rounded} ${currency}` : `${rounded}`;
}

/** Render one deal as a Telegram HTML message. */
export function formatDeal(deal: Deal, opts: { disclosure?: string } = {}): string {
  const disclosure = opts.disclosure ?? DISCLOSURE_AR;
  const link = deal.affiliateUrl || deal.url;
  const lines: string[] = [];

  const emoji = deal.emoji ? `${deal.emoji} ` : "🔥 ";
  lines.push(`${emoji}<b>${esc(deal.title)}</b>`);

  const now = formatPrice(deal.price, deal.currency);
  const was = formatPrice(deal.wasPrice, deal.currency);
  if (now && was) {
    lines.push(`💰 <b>${esc(now)}</b>  <s>${esc(was)}</s>`);
  } else if (now) {
    lines.push(`💰 <b>${esc(now)}</b>`);
  }

  if (deal.discountPct !== undefined) lines.push(`📉 خصم ${deal.discountPct}%`);
  if (deal.store) lines.push(`🏬 ${esc(deal.store)}`);
  if (deal.note) lines.push(`\n${esc(deal.note)}`);

  lines.push(`\n🛒 <a href="${esc(link)}">اشتري من هون</a>`);
  lines.push(`\n<i>${esc(disclosure)}</i>`);

  return lines.join("\n");
}

/** Render several deals as a single digest message. */
export function formatDigest(
  deals: Deal[],
  opts: { heading?: string; disclosure?: string } = {},
): string {
  const heading = opts.heading ?? "🔥 أقوى عروض اليوم";
  const disclosure = opts.disclosure ?? DISCLOSURE_AR;
  const parts: string[] = [`<b>${esc(heading)}</b>\n`];

  deals.forEach((deal, index) => {
    const link = deal.affiliateUrl || deal.url;
    const price = formatPrice(deal.price, deal.currency);
    const bits = [
      `${index + 1}. ${deal.emoji ?? "🛍"} <a href="${esc(link)}">${esc(deal.title)}</a>`,
    ];
    const meta = [
      price ? `💰 ${price}` : null,
      deal.discountPct !== undefined ? `📉 -${deal.discountPct}%` : null,
      deal.store ? `🏬 ${deal.store}` : null,
    ]
      .filter(Boolean)
      .join("  ");
    if (meta) bits.push(`   ${esc(meta)}`);
    if (deal.note) bits.push(`   <i>${esc(deal.note)}</i>`);
    parts.push(bits.join("\n"));
  });

  parts.push(`\n<i>${esc(disclosure)}</i>`);
  return parts.join("\n");
}

export type TelegramConfig = { token: string; chatId: string };

export function getTelegramConfig(): TelegramConfig | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return null;
  return { token, chatId };
}

export type SendResult = { ok: boolean; error?: string };

export async function sendMessage(
  text: string,
  config: TelegramConfig,
): Promise<SendResult> {
  try {
    const res = await fetch(`${API_BASE}/bot${config.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      }),
    });

    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; description?: string }
      | null;

    if (!res.ok || !body?.ok) {
      // Telegram puts the useful part in `description` ("chat not found",
      // "bot is not a member of the channel chat", …).
      return { ok: false, error: body?.description ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type PublishOptions = {
  /** "individual" posts one message per deal; "digest" posts a single roundup. */
  mode?: "individual" | "digest";
  heading?: string;
  disclosure?: string;
};

export type PublishResult = { sent: number; failed: number; errors: string[] };

export async function publishDeals(
  deals: Deal[],
  options: PublishOptions = {},
): Promise<PublishResult> {
  const config = getTelegramConfig();
  if (!config) {
    throw new Error(
      "Telegram is not configured — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.",
    );
  }
  if (deals.length === 0) return { sent: 0, failed: 0, errors: [] };

  const { mode = "individual" } = options;
  const result: PublishResult = { sent: 0, failed: 0, errors: [] };

  if (mode === "digest") {
    const res = await sendMessage(formatDigest(deals, options), config);
    if (res.ok) result.sent += 1;
    else {
      result.failed += 1;
      result.errors.push(res.error ?? "unknown error");
    }
    return result;
  }

  for (const [index, deal] of deals.entries()) {
    const res = await sendMessage(formatDeal(deal, options), config);
    if (res.ok) result.sent += 1;
    else {
      result.failed += 1;
      result.errors.push(`${deal.title}: ${res.error ?? "unknown error"}`);
    }
    // Telegram throttles bursts; a short gap keeps a run of posts from being
    // rejected partway through.
    if (index < deals.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }

  return result;
}
