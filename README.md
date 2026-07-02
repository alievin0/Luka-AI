# 🛍️ Luka — AI Agent

Luka is an AI agent powered by [Claude](https://www.anthropic.com/claude), with four
bilingual (Arabic/English, RTL) experiences in one Next.js app:

![stack](https://img.shields.io/badge/Next.js-14-black) ![stack](https://img.shields.io/badge/TypeScript-5-blue) ![model](https://img.shields.io/badge/Claude-Opus%204.8-7c3aed)

| Page | What it does |
| --- | --- |
| `/` | **Shopping agent** — conversational shopping with tool use and a live cart. |
| `/interview` | **Interview simulator** — a virtual interviewer with a professional voice asks real interview questions in Arabic *and* English, transcribes your spoken answers, scores each one, and coaches your **body language live from your camera** (Claude vision analyzes frames while you answer — nothing is recorded or stored). Ends with a full hiring-panel report. |
| `/coach` | **Daily companion** — a daily mood/anxiety check-in with warm, trend-aware feedback, tiny actionable steps, streaks, and a 14-day chart. Entries live only in your browser's localStorage. Supportive companion, not a substitute for professional care. |
| `/events` | **Family events extractor** — upload your exported WhatsApp family-group chat (with consent) and Luka extracts every occasion mentioned in conversation (عزيمة، عرس، عزاء، عيد ميلاد…), resolves relative dates, and generates `.ics` files for your calendar — because in Gulf culture, invitations happen in the group chat, not on paper. |

### Voice notes (interview simulator)

- The interviewer speaks via the browser's SpeechSynthesis with a calm, senior tone.
  `lib/speech.ts` keeps a single `speak()` contract so a real voice-cloning provider
  (e.g. ElevenLabs) can be plugged in to give the interviewer a cloned professional
  voice in your field.
- Your answers are transcribed live with the Web Speech API (Chrome recommended);
  a text fallback is shown where speech recognition is unsupported.

## ✨ Shopping features

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
| `app/interview/page.tsx` | Interview UI: TTS interviewer, speech-to-text answers, live camera coaching, report |
| `app/api/interview/route.ts` | Question generation, per-answer scoring, final report (structured tool output) |
| `app/api/interview/vision/route.ts` | Live body-language tips from camera frames (Claude vision) |
| `app/coach/page.tsx` + `app/api/coach/route.ts` | Daily check-in UI + companion replies |
| `app/events/page.tsx` + `app/api/events/route.ts` | WhatsApp export → occasions → `.ics` calendar files |
| `lib/anthropic.ts` | Shared `structuredCall` helper (forced tool → guaranteed JSON) |
| `lib/speech.ts` | Browser TTS (interviewer voice) + speech recognition wrappers |

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
