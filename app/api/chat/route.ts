import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, executeTool } from "@/lib/tools";
import { getCart } from "@/lib/cart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = process.env.LUKA_MODEL || "claude-opus-4-8";
const MAX_ITERATIONS = 16;

const SYSTEM_PROMPT = `You are Luka, an autonomous AI personal shopper. You shop the real
internet on the shopper's behalf: you search online stores worldwide, open product pages,
compare prices and reviews, and bring back the best options with working links.

Language:
- Reply in the SAME language the shopper uses. Arabic (including colloquial/Levantine)
  gets Arabic replies; English gets English.
- Keep replies warm, concise, and easy to scan.

How you shop (autonomously — don't ask permission to search):
- Use web_search to find candidate products across multiple real stores and marketplaces
  (global ones like Amazon, and regional ones relevant to the shopper — e.g. Noon, Jarir,
  Extra for the Middle East). Run several searches with different phrasings if needed.
- Use web_fetch to open promising product pages and confirm price, availability, and specs.
- Compare at least 2–3 options/stores before recommending, when results allow it.
- Respect any budget the shopper gives. If they mention a currency or country, prefer
  stores that serve them.

Honesty rules (critical):
- NEVER invent products, prices, ratings, or URLs. Only present what you actually found
  in search/fetch results, with the real link.
- Prices change and vary by region — present them as approximate ("~", "تقريباً").
- If you couldn't verify something, say so.

Presenting results:
- After researching, call present_products with your top picks (3–6, best first) so the
  shopper sees cards with name, price, store, and link. Then give a short recommendation
  in prose — don't repeat every spec, the cards show the details.
- The cart is a shortlist with links — no real purchase happens. Add items when the
  shopper asks, or add your single top pick when they explicitly told you to choose for
  them (and tell them you did). Checkout happens on the store's own website via the link.

Be proactive: ask a clarifying question only when genuinely needed (budget, size, country
for shipping) — otherwise make sensible assumptions, state them, and start shopping.`;

type IncomingMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    messages?: IncomingMessage[];
    sessionId?: string;
  } | null;

  const messages = body?.messages ?? [];
  const sessionId = body?.sessionId?.trim() || "anonymous";

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      if (!process.env.ANTHROPIC_API_KEY) {
        send({
          type: "error",
          message:
            "Server is missing ANTHROPIC_API_KEY. Add it to .env.local and restart.",
        });
        controller.close();
        return;
      }

      const client = new Anthropic();

      const convo: Anthropic.MessageParam[] = messages
        .filter((m) => m.content && (m.role === "user" || m.role === "assistant"))
        .map((m) => ({ role: m.role, content: m.content }));

      if (convo.length === 0) {
        send({ type: "error", message: "No message provided." });
        controller.close();
        return;
      }

      const tools: Anthropic.Messages.ToolUnion[] = [
        ...TOOLS,
        { type: "web_search_20260209", name: "web_search", max_uses: 10 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 10 },
      ];

      try {
        for (let i = 0; i < MAX_ITERATIONS; i++) {
          const runner = client.messages.stream({
            model: MODEL,
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            tools,
            messages: convo,
          });

          runner.on("text", (delta) => {
            if (delta) send({ type: "text", delta });
          });

          // Surface server-tool activity ("searching the web…") to the UI.
          runner.on("streamEvent", (event) => {
            if (
              event.type === "content_block_start" &&
              event.content_block.type === "server_tool_use"
            ) {
              send({ type: "status", tool: event.content_block.name });
            }
          });

          const final = await runner.finalMessage();
          convo.push({ role: "assistant", content: final.content });

          // Server tools hit their internal iteration limit — just continue.
          if (final.stop_reason === "pause_turn") {
            continue;
          }

          if (final.stop_reason !== "tool_use") {
            break;
          }

          // Execute our custom tools (server_tool_use blocks are handled by the
          // API itself and never appear as "tool_use").
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of final.content) {
            if (block.type !== "tool_use") continue;
            const { resultText, ui } = executeTool(
              block.name,
              (block.input ?? {}) as Record<string, unknown>,
              sessionId,
            );
            if (ui) send({ type: "tool", tool: block.name, ui });
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: resultText,
            });
          }

          if (toolResults.length === 0) break;
          convo.push({ role: "user", content: toolResults });
        }

        // Always send the authoritative cart state at the end.
        send({ type: "cart", cart: getCart(sessionId) });
        send({ type: "done" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
