"use client";

import { useEffect, useRef, useState } from "react";
import type { Product } from "@/lib/products";
import type { CartView } from "@/lib/cart";

type ToolUi =
  | { kind: "products"; products: Product[] }
  | { kind: "product"; product: Product }
  | { kind: "cart"; cart: CartView }
  | { kind: "notice"; message: string };

type Card =
  | { kind: "products"; products: Product[] }
  | { kind: "product"; product: Product }
  | { kind: "notice"; message: string };

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  cards: Card[];
};

const SUGGESTIONS = [
  "بدي سماعات لاسلكية تحت ١٠٠ دولار",
  "لابتوب للشغل والدراسة",
  "Compare your two laptops",
  "شو في عندك هدايا رياضية؟",
];

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [cart, setCart] = useState<CartView>({
    items: [],
    itemCount: 0,
    subtotal: 0,
    currency: "$",
  });
  const [sessionId, setSessionId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let sid = localStorage.getItem("luka_session");
    if (!sid) {
      sid = newId();
      localStorage.setItem("luka_session", sid);
    }
    setSessionId(sid);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);

    const userMsg: ChatMessage = {
      id: newId(),
      role: "user",
      text: trimmed,
      cards: [],
    };
    const assistantId = newId();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      text: "",
      cards: [],
    };

    const history = [...messages, userMsg];
    setMessages([...history, assistantMsg]);
    setInput("");
    setLoading(true);

    const updateAssistant = (fn: (m: ChatMessage) => ChatMessage) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? fn(m) : m)),
      );
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          messages: history.map((m) => ({ role: m.role, content: m.text })),
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json) continue;

          let event: { type: string; [k: string]: unknown };
          try {
            event = JSON.parse(json);
          } catch {
            continue;
          }
          handleEvent(event, updateAssistant);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function handleEvent(
    event: { type: string; [k: string]: unknown },
    updateAssistant: (fn: (m: ChatMessage) => ChatMessage) => void,
  ) {
    switch (event.type) {
      case "text":
        updateAssistant((m) => ({
          ...m,
          text: m.text + String(event.delta ?? ""),
        }));
        break;
      case "tool": {
        const ui = event.ui as ToolUi | undefined;
        if (!ui) break;
        if (ui.kind === "cart") {
          setCart(ui.cart);
        } else {
          updateAssistant((m) => ({ ...m, cards: [...m.cards, ui as Card] }));
        }
        break;
      }
      case "cart":
        setCart(event.cart as CartView);
        break;
      case "error":
        setError(String(event.message ?? "Something went wrong."));
        break;
      case "done":
      default:
        break;
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <Header itemCount={cart.itemCount} />

      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-4 overflow-hidden p-4">
        {/* Chat column */}
        <main className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div
            ref={scrollRef}
            className="scroll-area flex-1 space-y-4 overflow-y-auto p-4 sm:p-6"
          >
            {messages.length === 0 && <EmptyState onPick={sendMessage} />}

            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} onAsk={sendMessage} />
            ))}

            {loading &&
              messages[messages.length - 1]?.role === "assistant" &&
              messages[messages.length - 1]?.text === "" &&
              messages[messages.length - 1]?.cards.length === 0 && (
                <TypingIndicator />
              )}

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                ⚠️ {error}
              </div>
            )}
          </div>

          <form
            onSubmit={onSubmit}
            className="flex items-center gap-2 border-t border-slate-200 p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="اكتب رسالتك… مثلاً: بدي سماعات تحت ١٠٠ دولار"
              className="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              إرسال
            </button>
          </form>
        </main>

        {/* Cart column */}
        <aside className="hidden w-80 shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:flex">
          <CartPanel cart={cart} />
        </aside>
      </div>
    </div>
  );
}

function Header({ itemCount }: { itemCount: number }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-xl">
            🛍️
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Luka</h1>
            <p className="text-xs text-slate-500">AI Shopping Agent</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700">
          🛒 <span>{itemCount}</span>
        </div>
      </div>
    </header>
  );
}

function EmptyState({ onPick }: { onPick: (t: string) => void }) {
  return (
    <div className="mx-auto max-w-xl py-10 text-center">
      <div className="mb-3 text-5xl">🛍️</div>
      <h2 className="text-xl font-bold">أهلاً! أنا Luka، مساعدك للتسوّق</h2>
      <p className="mt-2 text-sm text-slate-500">
        خبّرني شو بتدوّر عليه وميزانيتك، ورح ساعدك تلاقي أفضل خيار وتجهّز سلتك.
      </p>
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-right text-sm text-slate-700 transition hover:border-brand-300 hover:bg-brand-50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onAsk,
}: {
  message: ChatMessage;
  onAsk: (t: string) => void;
}) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-start" : "justify-start"}`}>
      <div className={`flex w-full gap-3 ${isUser ? "flex-row" : "flex-row"}`}>
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${
            isUser ? "bg-slate-200" : "bg-brand-600 text-white"
          }`}
        >
          {isUser ? "🙂" : "🛍️"}
        </div>
        <div className="flex-1 space-y-3">
          {message.text && (
            <div
              className={`inline-block max-w-full whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                isUser
                  ? "bg-slate-100 text-slate-800"
                  : "bg-brand-50 text-slate-800"
              }`}
            >
              {message.text}
            </div>
          )}

          {message.cards.map((card, idx) => (
            <CardRenderer key={idx} card={card} onAsk={onAsk} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CardRenderer({
  card,
  onAsk,
}: {
  card: Card;
  onAsk: (t: string) => void;
}) {
  if (card.kind === "notice") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
        {card.message}
      </div>
    );
  }
  if (card.kind === "product") {
    return (
      <div className="grid grid-cols-1">
        <ProductCard product={card.product} onAsk={onAsk} detailed />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {card.products.map((p) => (
        <ProductCard key={p.id} product={p} onAsk={onAsk} />
      ))}
    </div>
  );
}

function ProductCard({
  product,
  onAsk,
  detailed = false,
}: {
  product: Product;
  onAsk: (t: string) => void;
  detailed?: boolean;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-brand-300">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-3xl">
        {product.emoji}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{product.nameAr}</p>
            <p className="truncate text-xs text-slate-400">{product.name}</p>
          </div>
          <p className="shrink-0 text-sm font-bold text-brand-700">
            ${product.price.toFixed(2)}
          </p>
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
          <span>⭐ {product.rating.toFixed(1)}</span>
          <span>•</span>
          <span>{product.brand}</span>
        </div>
        {detailed && (
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            {product.descriptionAr}
          </p>
        )}
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => onAsk(`أضف ${product.nameAr} إلى السلة`)}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
          >
            أضف للسلة
          </button>
          <button
            onClick={() => onAsk(`خبّرني أكثر عن ${product.nameAr}`)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
          >
            تفاصيل
          </button>
        </div>
      </div>
    </div>
  );
}

function CartPanel({ cart }: { cart: CartView }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-bold">🛒 سلة التسوّق</h2>
      </div>
      <div className="scroll-area flex-1 space-y-2 overflow-y-auto p-3">
        {cart.items.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            السلة فارغة بعد
          </p>
        ) : (
          cart.items.map((item) => (
            <div
              key={item.product.id}
              className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded bg-white text-xl">
                {item.product.emoji}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">
                  {item.product.nameAr}
                </p>
                <p className="text-[11px] text-slate-400">
                  {item.quantity} × ${item.product.price.toFixed(2)}
                </p>
              </div>
              <p className="text-xs font-bold text-slate-700">
                ${item.lineTotal.toFixed(2)}
              </p>
            </div>
          ))
        )}
      </div>
      <div className="border-t border-slate-200 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">المجموع</span>
          <span className="text-lg font-bold">
            ${cart.subtotal.toFixed(2)}
          </span>
        </div>
        <button
          disabled={cart.items.length === 0}
          className="mt-3 w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => alert("Checkout is a demo — no real payment is taken.")}
        >
          إتمام الشراء
        </button>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm text-white">
        🛍️
      </div>
      <div className="flex gap-1 rounded-2xl bg-brand-50 px-4 py-3">
        <span className="typing-dot h-2 w-2 rounded-full bg-brand-400" />
        <span className="typing-dot h-2 w-2 rounded-full bg-brand-400" />
        <span className="typing-dot h-2 w-2 rounded-full bg-brand-400" />
      </div>
    </div>
  );
}
