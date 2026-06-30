import { getProductById, Product, CURRENCY } from "./products";

export type CartItem = {
  product: Product;
  quantity: number;
  lineTotal: number;
};

export type CartView = {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  currency: string;
};

// In-memory cart store keyed by an opaque session id supplied by the client.
// This is intentionally simple — for a real app you'd back this with a DB.
const carts = new Map<string, Map<string, number>>();

function getStore(sessionId: string): Map<string, number> {
  let store = carts.get(sessionId);
  if (!store) {
    store = new Map();
    carts.set(sessionId, store);
  }
  return store;
}

export function addToCart(
  sessionId: string,
  productId: string,
  quantity = 1,
): { ok: boolean; message: string } {
  const product = getProductById(productId);
  if (!product) {
    return { ok: false, message: `No product found with id "${productId}".` };
  }
  if (!product.inStock) {
    return { ok: false, message: `${product.name} is out of stock.` };
  }
  const qty = Math.max(1, Math.floor(quantity || 1));
  const store = getStore(sessionId);
  store.set(productId, (store.get(productId) || 0) + qty);
  return {
    ok: true,
    message: `Added ${qty} × ${product.name} to the cart.`,
  };
}

export function removeFromCart(
  sessionId: string,
  productId: string,
  quantity?: number,
): { ok: boolean; message: string } {
  const store = getStore(sessionId);
  const current = store.get(productId);
  const product = getProductById(productId);
  const label = product ? product.name : productId;
  if (!current) {
    return { ok: false, message: `${label} is not in the cart.` };
  }
  if (quantity === undefined || quantity >= current) {
    store.delete(productId);
    return { ok: true, message: `Removed ${label} from the cart.` };
  }
  store.set(productId, current - Math.max(1, Math.floor(quantity)));
  return { ok: true, message: `Updated quantity for ${label}.` };
}

export function clearCart(sessionId: string): void {
  carts.delete(sessionId);
}

export function getCart(sessionId: string): CartView {
  const store = carts.get(sessionId);
  const items: CartItem[] = [];
  let subtotal = 0;
  let itemCount = 0;

  if (store) {
    for (const [productId, quantity] of Array.from(store.entries())) {
      const product = getProductById(productId);
      if (!product) continue;
      const lineTotal = round2(product.price * quantity);
      subtotal += lineTotal;
      itemCount += quantity;
      items.push({ product, quantity, lineTotal });
    }
  }

  return {
    items,
    itemCount,
    subtotal: round2(subtotal),
    currency: CURRENCY,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
