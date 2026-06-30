import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, executeTool } from "@/lib/tools";
import { getCart } from "@/lib/cart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.LUKA_MODEL || "claude-opus-4-8";
const MAX_TOOL_ITERATIONS = 8;

const SYSTEM_PROMPT = `You are Luka, a friendly and knowledgeable AI shopping assistant for an online store.

Your job is to help shoppers find the right products, compare options, stay within
their budget, and build a cart — then guide them toward checkout.

Language:
- Reply in the SAME language the shopper uses. If they write in Arabic (including
  Levantine/colloquial Arabic), reply in Arabic. If they write in English, reply in English.
- Keep replies warm, concise, and easy to scan. Avoid long walls of text.

Using tools:
- You can ONLY recommend products returned by the search_products / get_product_details
  tools. Never invent products, prices, ids, or specs.
- When a shopper asks for something to buy, call search_products before answering.
- Respect any budget the shopper mentions (use maxPrice).
- When comparing, briefly highlight the key trade-offs (price, rating, use-case).
- Only call add_to_cart after the shopper clearly wants to add an item.
- After adding/removing items, confirm what's in the cart and the subtotal.
- The frontend renders product and cart cards automatically from your tool calls,
  so you don't need to repeat every spec in prose — give a short, helpful recommendation
  and let the cards show the details.

Be proactive: ask a clarifying question only when it's genuinely needed (e.g. budget or
use-case), otherwise make a sensible recommendation and offer alternatives.`;

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

      // Build the running conversation for the Messages API.
      const convo: Anthropic.MessageParam[] = messages
        .filter((m) => m.content && (m.role === "user" || m.role === "assistant"))
        .map((m) => ({ role: m.role, content: m.content }));

      if (convo.length === 0) {
        send({ type: "error", message: "No message provided." });
        controller.close();
        return;
      }

      try {
        for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
          const runner = client.messages.stream({
            model: MODEL,
            max_tokens: 2048,
            system: SYSTEM_PROMPT,
            tools: TOOLS,
            messages: convo,
          });

          runner.on("text", (delta) => {
            if (delta) send({ type: "text", delta });
          });

          const final = await runner.finalMessage();
          convo.push({ role: "assistant", content: final.content });

          if (final.stop_reason !== "tool_use") {
            break;
          }

          // Execute every tool_use block in this turn and feed results back.
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
