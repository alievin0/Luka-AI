# 🛍️ Luka — Autonomous AI Shopping Agent

Luka is an autonomous AI personal shopper powered by [Claude](https://www.anthropic.com/claude).
Tell it what you want — in **Arabic or English** — and it shops the **real internet**
for you: it searches online stores worldwide, opens product pages, compares prices
and reviews, and brings back the best options as cards with working store links.

![stack](https://img.shields.io/badge/Next.js-14-black) ![stack](https://img.shields.io/badge/TypeScript-5-blue) ![model](https://img.shields.io/badge/Claude-Opus%204.8-7c3aed)

> 🤖 **جديد:** نواة عقل وجسم لروبوت فيزيائي حقيقي مستقل — انظر [`robot/`](robot/README.md)
> (حلقة إحساس→تفكير→تنفيذ بالعربي، محاكاة على اللابتوب + جسم Raspberry Pi حقيقي، وخارطة طريق كاملة لبناء الجسم).

## ✨ Features

- **Shops the real web autonomously** — uses Claude's server-side `web_search` and
  `web_fetch` tools to find products across real stores (global marketplaces and
  regional ones), no permission-asking per step.
- **Price comparison** — checks multiple stores before recommending, respects your
  budget and currency/region.
- **Rich product cards** — the agent calls a `present_products` tool to render its
  top picks live, with price, store, rating, and a direct "open in store" link.
- **Shortlist cart** — saves finds with per-currency totals; checkout happens on the
  store's own website via the link (no real payment in the app).
- **Streaming + live status** — replies stream over SSE, with "searching the web…"
  indicators while the agent works.
- **Bilingual + RTL** — replies in the shopper's language; the UI is right-to-left.

## 🏗️ How it works

```
Browser (chat UI)  ──POST /api/chat──▶  Agentic loop (server)
      ▲                                      │
      │  SSE: text deltas, status,           │  client.messages.stream(...)
      │  product cards, cart                 ▼
      └────────────────────────  Claude + web_search / web_fetch (server tools)
                                        + present_products / cart (custom tools)
```

The server (`app/api/chat/route.ts`) runs a manual agentic loop. Web search and
web fetch execute **on Anthropic's side** (the model browses real stores itself);
custom tools (`present_products`, cart operations) execute locally and stream rich
UI cards to the browser. The loop handles `pause_turn` (long server-tool runs) and
`tool_use` until the agent finishes.

| File | Responsibility |
| --- | --- |
| `app/page.tsx` | Chat UI, product/cart cards, live status, SSE client |
| `app/api/chat/route.ts` | Agentic loop + server web tools + SSE streaming |
| `lib/tools.ts` | Custom tool definitions + executor |
| `lib/cart.ts` | In-memory per-session shortlist with per-currency totals |

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

Get a key from the [Anthropic Console](https://console.anthropic.com/). Web search
must be enabled for your organization (Console → Settings → Web search).

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and start chatting.

## ⚙️ Configuration

| Env var | Default | Description |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | _(required)_ | Your Anthropic API key. |
| `LUKA_MODEL` | `claude-opus-4-8` | Model used by the agent (needs web-search support). |

## 🧪 Try these prompts

- `بدي سماعات سوني WH-1000XM5 بأرخص سعر — قارن المتاجر`
- `اختارلي أفضل لابتوب للدراسة بحدود ١٠٠٠ دولار`
- `Find me the best-rated air fryer under $120`
- `شو صار بسلتي؟`

## 📝 Notes & limits

- The agent **researches and links — it never pays or places orders**. Checkout
  happens on the store's own site via the product link.
- Prices shown are approximate: they change and vary by region, so the UI and the
  agent present them with `~`.
- Coverage is what web search can reach — broad, but not literally "every store on
  earth"; store pages behind logins or aggressive bot-blocking may not be readable.
- The cart is in-memory per session — restarting the server clears it. Swap
  `lib/cart.ts` for a database to persist.
