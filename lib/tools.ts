import type Anthropic from "@anthropic-ai/sdk";
import {
  searchProducts,
  getProductById,
  CATEGORIES,
  type SearchParams,
} from "./products";
import { addToCart, removeFromCart, getCart, clearCart } from "./cart";

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_products",
    description:
      "Search the Luka product catalog. Use this whenever the shopper is looking " +
      "for something, asking for recommendations, comparing options, or filtering " +
      "by budget. Returns matching products with id, name, brand, price, and rating. " +
      "Only products returned here exist — never invent products.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Free-text search terms in English or Arabic (e.g. 'laptop for work', 'سماعات').",
        },
        category: {
          type: "string",
          enum: CATEGORIES,
          description: "Optional category filter.",
        },
        minPrice: { type: "number", description: "Minimum price filter." },
        maxPrice: {
          type: "number",
          description: "Maximum price / budget filter.",
        },
        minRating: {
          type: "number",
          description: "Minimum average rating (0-5).",
        },
        brand: { type: "string", description: "Optional brand filter." },
        sortBy: {
          type: "string",
          enum: ["price_asc", "price_desc", "rating_desc"],
          description: "How to sort the results.",
        },
        limit: {
          type: "number",
          description: "Max number of results to return (default 6).",
        },
      },
      required: [],
    },
  },
  {
    name: "get_product_details",
    description:
      "Get full details for a single product by its id (e.g. 'p-1003'). Use after " +
      "search when the shopper wants more information about a specific item.",
    input_schema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "The product id, e.g. 'p-1003'." },
      },
      required: ["productId"],
    },
  },
  {
    name: "add_to_cart",
    description:
      "Add a product to the shopper's cart by id. Only call this after the shopper " +
      "has expressed clear intent to buy or add the item.",
    input_schema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "The product id to add." },
        quantity: {
          type: "number",
          description: "Quantity to add (default 1).",
        },
      },
      required: ["productId"],
    },
  },
  {
    name: "remove_from_cart",
    description: "Remove a product from the cart by id (or reduce its quantity).",
    input_schema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "The product id to remove." },
        quantity: {
          type: "number",
          description:
            "Quantity to remove. Omit to remove the item entirely.",
        },
      },
      required: ["productId"],
    },
  },
  {
    name: "view_cart",
    description:
      "View the current contents and subtotal of the shopper's cart. Use when the " +
      "shopper asks what's in their cart or how much it costs.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "clear_cart",
    description: "Empty the shopper's cart completely.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// A UI payload streamed alongside the model's text so the frontend can render
// rich product / cart cards.
export type ToolUi =
  | { kind: "products"; products: ReturnType<typeof searchProducts> }
  | { kind: "product"; product: NonNullable<ReturnType<typeof getProductById>> }
  | { kind: "cart"; cart: ReturnType<typeof getCart> }
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
      case "search_products": {
        const params: SearchParams = {
          query: asString(input.query),
          category: input.category as SearchParams["category"],
          minPrice: asNumber(input.minPrice),
          maxPrice: asNumber(input.maxPrice),
          minRating: asNumber(input.minRating),
          brand: asString(input.brand),
          sortBy: input.sortBy as SearchParams["sortBy"],
          limit: asNumber(input.limit),
        };
        const products = searchProducts(params);
        if (products.length === 0) {
          return {
            resultText:
              "No products matched those filters. Suggest loosening the budget or trying a different category.",
            ui: { kind: "notice", message: "No matching products found." },
          };
        }
        return {
          resultText: JSON.stringify(
            products.map((p) => ({
              id: p.id,
              name: p.name,
              brand: p.brand,
              category: p.category,
              price: p.price,
              rating: p.rating,
            })),
          ),
          ui: { kind: "products", products },
        };
      }

      case "get_product_details": {
        const id = asString(input.productId);
        const product = id ? getProductById(id) : undefined;
        if (!product) {
          return {
            resultText: `No product found with id "${id}".`,
            ui: { kind: "notice", message: `Unknown product: ${id}` },
          };
        }
        return {
          resultText: JSON.stringify(product),
          ui: { kind: "product", product },
        };
      }

      case "add_to_cart": {
        const id = asString(input.productId) ?? "";
        const qty = asNumber(input.quantity) ?? 1;
        const res = addToCart(sessionId, id, qty);
        return {
          resultText: res.message,
          ui: { kind: "cart", cart: getCart(sessionId) },
        };
      }

      case "remove_from_cart": {
        const id = asString(input.productId) ?? "";
        const qty = asNumber(input.quantity);
        const res = removeFromCart(sessionId, id, qty);
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

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
}
