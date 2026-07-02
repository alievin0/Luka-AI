// The cart holds products the agent discovered on the real web — a shortlist
// with links back to the store. No real purchase happens here.

export type ExternalProduct = {
  title: string;
  url?: string;
  store?: string;
  price?: number;
  currency?: string;
  rating?: number;
  note?: string;
  emoji?: string;
};

export type CartItem = {
  id: string;
  product: ExternalProduct;
  quantity: number;
};

export type CartView = {
  items: CartItem[];
  itemCount: number;
  /** Per-currency totals, since finds can come from stores in different currencies. */
  totals: Array<{ currency: string; amount: number }>;
};

// In-memory store keyed by an opaque session id supplied by the client.
// For a real app you'd back this with a database.
const carts = new Map<string, CartItem[]>();

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `f-${Date.now().toString(36)}-${idCounter}`;
}

function getStore(sessionId: string): CartItem[] {
  let store = carts.get(sessionId);
  if (!store) {
    store = [];
    carts.set(sessionId, store);
  }
  return store;
}

export function addToCart(
  sessionId: string,
  product: ExternalProduct,
  quantity = 1,
): { ok: boolean; message: string } {
  if (!product.title?.trim()) {
    return { ok: false, message: "Cannot add an item without a title." };
  }
  const qty = Math.max(1, Math.floor(quantity || 1));
  const store = getStore(sessionId);

  // If the same product (by URL, or by title when no URL) is already saved,
  // just bump the quantity instead of duplicating.
  const existing = store.find((item) =>
    product.url
      ? item.product.url === product.url
      : item.product.title.toLowerCase() === product.title.toLowerCase(),
  );
  if (existing) {
    existing.quantity += qty;
    return {
      ok: true,
      message: `Increased quantity of "${product.title}" to ${existing.quantity}.`,
    };
  }

  store.push({ id: nextId(), product, quantity: qty });
  return { ok: true, message: `Added "${product.title}" to the cart.` };
}

export function removeFromCart(
  sessionId: string,
  ref: string,
): { ok: boolean; message: string } {
  const store = getStore(sessionId);
  const needle = ref.trim().toLowerCase();
  const idx = store.findIndex(
    (item) =>
      item.id === ref ||
      item.product.title.toLowerCase().includes(needle) ||
      (item.product.url && item.product.url.toLowerCase() === needle),
  );
  if (idx === -1) {
    return { ok: false, message: `No cart item matches "${ref}".` };
  }
  const [removed] = store.splice(idx, 1);
  return { ok: true, message: `Removed "${removed.product.title}" from the cart.` };
}

export function clearCart(sessionId: string): void {
  carts.delete(sessionId);
}

export function getCart(sessionId: string): CartView {
  const store = carts.get(sessionId) ?? [];
  const totalsMap = new Map<string, number>();
  let itemCount = 0;

  for (const item of store) {
    itemCount += item.quantity;
    if (typeof item.product.price === "number") {
      const currency = item.product.currency?.trim() || "USD";
      totalsMap.set(
        currency,
        (totalsMap.get(currency) || 0) + item.product.price * item.quantity,
      );
    }
  }

  const totals = Array.from(totalsMap.entries()).map(([currency, amount]) => ({
    currency,
    amount: Math.round(amount * 100) / 100,
  }));

  return { items: [...store], itemCount, totals };
}
