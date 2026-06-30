# 🛍️ Luka — AI Shopping Agent

Luka is an AI shopping assistant powered by [Claude](https://www.anthropic.com/claude).
Chat with it in **Arabic or English**, and it will search a product catalog,
recommend and compare options, respect your budget, and build a cart for you — all
through natural conversation backed by **tool use**.

![stack](https://img.shields.io/badge/Next.js-14-black) ![stack](https://img.shields.io/badge/TypeScript-5-blue) ![model](https://img.shields.io/badge/Claude-Opus%204.8-7c3aed)

## ✨ Features

- **Conversational shopping** — describe what you want ("a laptop for work under $1200")
  and Luka finds it.
- **Agentic tool use** — Claude calls real tools to `search_products`,
  `get_product_details`, `add_to_cart`, `remove_from_cart`, `view_cart`, and `clear_cart`.
- **Streaming replies** — responses stream token-by-token over SSE, with product and
  cart cards rendered live as the agent works.
- **Bilingual + RTL** — replies in the shopper's language; the UI is right-to-left.
- **Live cart** — a cart panel updates in real time and tracks the subtotal.

## 🏗️ How it works

```
Browser (chat UI)  ──POST /api/chat──▶  Agentic loop (server)
      ▲                                      │
      │   SSE: text deltas + tool cards      │  client.messages.stream(...)
      │   + authoritative cart               ▼
      └──────────────────────────────  Claude + tools ──▶ catalog / cart
```

The server (`app/api/chat/route.ts`) runs a manual agentic loop: it streams the
model's text, and whenever Claude emits `tool_use` blocks it executes them
(`lib/tools.ts`), streams rich UI cards to the browser, feeds the `tool_result`
back, and continues until the model is done.

| File | Responsibility |
| --- | --- |
| `app/page.tsx` | Chat UI, product/cart cards, SSE client |
| `app/api/chat/route.ts` | Agentic loop + SSE streaming |
| `lib/tools.ts` | Tool definitions + executor |
| `lib/products.ts` | Mock product catalog + search/filter |
| `lib/cart.ts` | In-memory per-session cart |

## 🚀 Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Add your Anthropic API key

```bash
cp .env.example .env.local
# then edit .env.local and set ANTHROPIC_API_KEY=sk-ant-...
```

Get a key from the [Anthropic Console](https://console.anthropic.com/).

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and start chatting.

## ⚙️ Configuration

| Env var | Default | Description |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | _(required)_ | Your Anthropic API key. |
| `LUKA_MODEL` | `claude-opus-4-8` | Override the model the agent uses. |

## 🧪 Try these prompts

- `بدي سماعات لاسلكية تحت ١٠٠ دولار` (wireless headphones under $100)
- `Compare your two laptops`
- `أضف لابتوب لومين 14 إلى السلة` (add the Lumin 14 to the cart)
- `What's in my cart?`

## 📝 Notes

- The product catalog and cart are **mock data** held in memory — restarting the
  server clears all carts. Swap `lib/products.ts` and `lib/cart.ts` for a real
  database/commerce backend to productionize.
- Checkout is a demo button only; no payment is processed.
