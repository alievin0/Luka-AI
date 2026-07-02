import type Anthropic from "@anthropic-ai/sdk";
import {
  addToCart,
  removeFromCart,
  getCart,
  clearCart,
  type ExternalProduct,
  type CartView,
} from "./cart";

// Custom (client-executed) tools. Web search / web fetch are server tools and
// are appended in the API route.
export const TOOLS: Anthropic.Tool[] = [
  {
    name: "present_products",
    description:
      "Display a curated list of products you found on the web as rich cards in the " +
      "shopping UI. Call this with your top picks (up to 8) after researching, so the " +
      "shopper sees name, price, store, and a working link for each. Only include " +
      "products you actually found via web search/fetch — never invent items, prices, " +
      "or URLs.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "The products to display, best recommendation first.",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Product name/title." },
              url: {
                type: "string",
                description: "Direct link to the product page you found.",
              },
              store: {
                type: "string",
                description: "Store or marketplace name (e.g. Amazon, Noon).",
              },
              price: {
                type: "number",
                description: "Price as a number, if known.",
              },
              currency: {
                type: "string",
                description: "ISO currency code or symbol (e.g. USD, SAR, €).",
              },
              rating: {
                type: "number",
                description: "Average rating out of 5, if shown on the page.",
              },
              note: {
                type: "string",
                description:
                  "One short line on why this pick fits the shopper (in their language).",
              },
              emoji: {
                type: "string",
                description: "A single emoji representing the product.",
              },
            },
            required: ["title"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "add_to_cart",
    description:
      "Save a product you found on the web to the shopper's cart (a shortlist with " +
      "links — no real purchase happens). Include as many details as you know. Call " +
      "this when the shopper asks to add an item, or when they asked you to pick for " +
      "them and you're adding your top choice.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Product name/title." },
        url: { type: "string", description: "Direct product page link." },
        store: { type: "string", description: "Store or marketplace name." },
        price: { type: "number", description: "Price as a number, if known." },
        currency: { type: "string", description: "Currency code or symbol." },
        rating: { type: "number", description: "Rating out of 5, if known." },
        note: { type: "string", description: "Short note on why it was picked." },
        emoji: { type: "string", description: "A single emoji for the product." },
        quantity: { type: "number", description: "Quantity to add (default 1)." },
      },
      required: ["title"],
    },
  },
  {
    name: "remove_from_cart",
    description:
      "Remove an item from the cart. Pass the item id from view_cart, or the product " +
      "title (partial match works).",
    input_schema: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "Cart item id, product title, or product URL.",
        },
      },
      required: ["ref"],
    },
  },
  {
    name: "view_cart",
    description:
      "View the current cart contents and per-currency totals. Use when the shopper " +
      "asks what's saved or how much everything costs.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "clear_cart",
    description: "Empty the shopper's cart completely.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

// A UI payload streamed alongside the model's text so the frontend can render
// rich product / cart cards.
export type ToolUi =
  | { kind: "products"; products: ExternalProduct[] }
  | { kind: "cart"; cart: CartView }
  | { kind: "notice"; message: string };

export type ToolExecResult = {
  /** Text content returned to the model as the tool_result. */
  resultText: string;
  /** Optional rich payload rendered by the frontend. */
  ui?: ToolUi;
};

export function executeTool(
  name: string,
  input: Record<string, unknown>,
  sessionId: string,
): ToolExecResult {
  try {
    switch (name) {
      case "present_products": {
        const raw = Array.isArray(input.items) ? input.items : [];
        const products = raw
          .map(coerceProduct)
          .filter((p): p is ExternalProduct => p !== null)
          .slice(0, 8);
        if (products.length === 0) {
          return {
            resultText:
              "No valid items were provided; nothing was displayed. Each item needs at least a title.",
          };
        }
        return {
          resultText: `Displayed ${products.length} product card(s) to the shopper. Don't repeat every spec in prose — summarize your recommendation briefly.`,
          ui: { kind: "products", products },
        };
      }

      case "add_to_cart": {
        const product = coerceProduct(input);
        if (!product) {
          return { resultText: "add_to_cart requires at least a title." };
        }
        const qty = asNumber(input.quantity) ?? 1;
        const res = addToCart(sessionId, product, qty);
        return {
          resultText: res.message,
          ui: { kind: "cart", cart: getCart(sessionId) },
        };
      }

      case "remove_from_cart": {
        const ref = asString(input.ref) ?? "";
        const res = removeFromCart(sessionId, ref);
        return {
          resultText: res.message,
          ui: { kind: "cart", cart: getCart(sessionId) },
        };
      }

      case "view_cart": {
        const cart = getCart(sessionId);
        return {
          resultText: JSON.stringify(cart),
          ui: { kind: "cart", cart },
        };
      }

      case "clear_cart": {
        clearCart(sessionId);
        return {
          resultText: "Cart cleared.",
          ui: { kind: "cart", cart: getCart(sessionId) },
        };
      }

      default:
        return { resultText: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { resultText: `Tool "${name}" failed: ${message}` };
  }
}

function coerceProduct(v: unknown): ExternalProduct | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const title = asString(o.title);
  if (!title) return null;
  return {
    title,
    url: asString(o.url),
    store: asString(o.store),
    price: asNumber(o.price),
    currency: asString(o.currency),
    rating: asNumber(o.rating),
    note: asString(o.note),
    emoji: asString(o.emoji),
  };
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
}
