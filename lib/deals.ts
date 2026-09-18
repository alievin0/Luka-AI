/**
 * The deal hunter.
 *
 * Luka's chat agent is reactive — it waits for a shopper. This module makes it
 * proactive: on a schedule it searches the real web for discounts that are live
 * right now, and hands back structured deals ready to publish with affiliate
 * links attached.
 *
 * This is the part that can earn without an audience watching in real time:
 * posts accumulate, and a deal posted today can still be clicked next week.
 */

import Anthropic from "@anthropic-ai/sdk";
import { buildClickUrl } from "./links";
import { monetizeUrl } from "./affiliate";

export type Deal = {
  title: string;
  url: string;
  store?: string;
  price?: number;
  wasPrice?: number;
  currency?: string;
  discountPct?: number;
  /** One line on why this is worth buying, in the audience's language. */
  note?: string;
  emoji?: string;
  /** Tagged, click-tracked link — filled in after the model returns. */
  affiliateUrl?: string;
  network?: string | null;
};

export type HuntOptions = {
  /** What to hunt for, e.g. "سماعات وأجهزة صوتية" or "kitchen gadgets". */
  category?: string;
  /** Market to shop, e.g. "الأردن" / "GCC" / "US". Steers store selection. */
  region?: string;
  /** Language for the write-up. */
  language?: string;
  /** How many deals to return. */
  limit?: number;
  currency?: string;
  model?: string;
};

const DEAL_TOOL: Anthropic.Tool = {
  name: "report_deals",
  description:
    "Report the verified discounts you found. Call this exactly once, at the end, " +
    "with only deals you actually confirmed on a real store page you opened. " +
    "Never invent a product, price, discount, or URL — a fabricated deal destroys " +
    "the channel's credibility and violates affiliate program terms.",
  input_schema: {
    type: "object",
    properties: {
      deals: {
        type: "array",
        description: "The verified deals, strongest discount first.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Product name as the store lists it." },
            url: { type: "string", description: "Direct link to the product page you opened." },
            store: { type: "string", description: "Store name, e.g. Amazon, Noon." },
            price: { type: "number", description: "Current price as a number." },
            wasPrice: { type: "number", description: "Pre-discount price, if the page shows one." },
            currency: { type: "string", description: "Currency code, e.g. USD, JOD, AED." },
            discountPct: { type: "number", description: "Discount percentage, if shown or computable." },
            note: { type: "string", description: "One short line on why it's a good buy, in the target language." },
            emoji: { type: "string", description: "A single emoji for the product." },
          },
          required: ["title", "url"],
        },
      },
    },
    required: ["deals"],
  },
};

const SYSTEM_PROMPT = `You are Luka's deal scout. Your job is to find discounts that are
genuinely live RIGHT NOW on real online stores, and report them for publication.

Method:
- Use web_search to find current sales, price drops, and coupon events in the requested
  category and region. Try several phrasings and several stores.
- Use web_fetch to OPEN the product pages of your candidates. A deal you have not opened
  and read is not verified and must not be reported.
- Prefer real discounts on things people actually want over deep discounts on junk.

Absolute honesty rules — these matter more than finding a full list:
- Report ONLY deals you confirmed by opening the page. Never invent or guess a product,
  price, discount percentage, or URL.
- Never report a "discount" you could not verify against a real listed price. Inflated
  "was" prices are common; if the original price looks unreliable, omit wasPrice rather
  than repeating a marketing number.
- If you can only verify two real deals, report two. An honest short list is the correct
  output. Reporting zero deals is better than reporting one fabricated one.
- URLs must be exactly what you opened — no shortened, guessed, or reconstructed links.

Finish by calling report_deals exactly once with what you verified.`;

export type HuntResult = {
  deals: Deal[];
  /** Human-readable note on what happened, for logs and the API response. */
  summary: string;
};

export async function huntDeals(options: HuntOptions = {}): Promise<HuntResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — the deal hunter cannot run.");
  }

  const {
    category = "إلكترونيات وأجهزة منزلية",
    region = "الأردن والخليج",
    language = "Arabic (Levantine, friendly)",
    limit = 5,
    currency,
    model = process.env.LUKA_MODEL || "claude-opus-4-8",
  } = options;

  const client = new Anthropic();

  const prompt = [
    `Find up to ${limit} discounts that are live right now.`,
    `Category: ${category}`,
    `Market / region: ${region}`,
    currency ? `Preferred currency: ${currency}` : "",
    `Write each note in: ${language}`,
    "",
    "Search, open the product pages to verify, then call report_deals with only what you confirmed.",
  ]
    .filter(Boolean)
    .join("\n");

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  const tools: Anthropic.Messages.ToolUnion[] = [
    DEAL_TOOL,
    { type: "web_search_20260209", name: "web_search", max_uses: 12 },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 12 },
  ];

  let reported: Deal[] | null = null;

  // The server tools pause the turn when they hit their internal limit, so the
  // hunt runs as a loop until the model actually reports.
  for (let i = 0; i < 12 && reported === null; i++) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "pause_turn") continue;

    if (response.stop_reason !== "tool_use") break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use" || block.name !== "report_deals") continue;
      const input = (block.input ?? {}) as { deals?: unknown };
      reported = Array.isArray(input.deals)
        ? input.deals.map(coerceDeal).filter((d): d is Deal => d !== null)
        : [];
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: `Recorded ${reported.length} deal(s).`,
      });
    }

    if (toolResults.length === 0) break;
    messages.push({ role: "user", content: toolResults });
  }

  if (reported === null) {
    return { deals: [], summary: "The hunt ended without a report_deals call." };
  }

  const deals = reported.slice(0, limit).map((deal) => ({
    ...deal,
    affiliateUrl: buildClickUrl({ url: deal.url, title: deal.title, source: "telegram" }),
    network: monetizeUrl(deal.url).network,
  }));

  const tagged = deals.filter((d) => d.network).length;
  return {
    deals,
    summary:
      `Verified ${deals.length} deal(s); ${tagged} carry an affiliate tag` +
      (tagged < deals.length
        ? ". Untagged ones are stores with no program configured — see MONETIZATION.md."
        : "."),
  };
}

function coerceDeal(value: unknown): Deal | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const url = typeof o.url === "string" ? o.url.trim() : "";
  // A deal with no link cannot be published or earn anything.
  if (!title || !url) return null;

  const num = (v: unknown): number | undefined => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      return Number(v);
    }
    return undefined;
  };
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

  const price = num(o.price);
  const wasPrice = num(o.wasPrice);
  let discountPct = num(o.discountPct);

  // Prefer a percentage we can derive from the two prices over one the model
  // asserted, and drop nonsense rather than publishing it.
  if (price !== undefined && wasPrice !== undefined && wasPrice > price && wasPrice > 0) {
    discountPct = Math.round(((wasPrice - price) / wasPrice) * 100);
  }
  if (discountPct !== undefined && (discountPct <= 0 || discountPct >= 100)) {
    discountPct = undefined;
  }

  return {
    title,
    url,
    store: str(o.store),
    price,
    wasPrice,
    currency: str(o.currency),
    discountPct,
    note: str(o.note),
    emoji: str(o.emoji),
  };
}
