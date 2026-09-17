# 🛍️ Luka — Autonomous AI Shopping Agent

Luka is an autonomous AI personal shopper powered by [Claude](https://www.anthropic.com/claude).
Tell it what you want — in **Arabic or English** — and it shops the **real internet**
for you: it searches online stores worldwide, opens product pages, compares prices
and reviews, and brings back the best options as cards with working store links.

![stack](https://img.shields.io/badge/Next.js-14-black) ![stack](https://img.shields.io/badge/TypeScript-5-blue) ![model](https://img.shields.io/badge/Claude-Opus%204.8-7c3aed)

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

## 🤖 Robotics: Luka's abilities

The repo also carries a **robotics kernel** — thirteen programmed, tested robot
abilities that run against a seeded physics simulator, and against real hardware
through the same interface.

```bash
npm test                 # 53 tests across the kernel, the statistics and every ability
npm run demo             # 11 demonstrations that check their own outcomes
npm run dev              # then open /robots for the live visualisation
npm run robo -- list     # the catalogue
```

| Ability | What it does |
| --- | --- |
| `reflex.shield` | 50 Hz guardian that measures time-to-collision and brakes before anything else notices |
| `motion.telegraph` | Announces the next move with a pre-cue that rules out the goals it is *not* going to |
| `balance.recover` | Catches a fall using the capture point, or braces when the fall is already lost |
| `memory.spatial` | Remembers where things were, and learns per object how fast that knowledge goes stale |
| `learn.demo` | Watches a movement once, then performs it toward any new target, at any speed |
| `grasp.adaptive` | Measures an unknown object's stiffness by squeezing, holds at the least force that works — or refuses |
| `power.lifeline` | Learns the real cost per metre and calls the mission at the point of no return |
| `swarm.auction` | Robots divide work by bidding their true costs — no dispatcher, no single point of failure |
| `sense.anomaly` | Learns this robot's own normal and reports sustained departures before they become failures |
| `plan.rehearse` | Runs a plan hundreds of times in a forked copy of the world before touching a motor |
| `hri.handover` | Presents an object and releases on the feel of a person's pull, never into empty air |
| `explore.frontier` | Maps an unknown space by driving to the boundary between the known and the unseen |
| `navigate.to` | Gets to a point, steering around whatever appears |
| `safety.stoppable` | Answers continuously whether the robot could still come to rest without falling or hitting anything |

It also ships `lib/robotics/eval/` — protocol fingerprints, Wilson intervals,
paired McNemar comparisons and power calculations — because a success rate
without an interval is not evidence. The `measured-crossing` demo uses it to
report something uncomfortable and true: 20/20 clean crossings when people watch
where they are going, 0/20 when they do not.

Full documentation, the ability contract, the researched backlog, and how to put
these on a real robot over ROS 2: [`lib/robotics/README.md`](lib/robotics/README.md)
and [`lib/robotics/RESEARCH.md`](lib/robotics/RESEARCH.md).

## 📝 Notes & limits

- The agent **researches and links — it never pays or places orders**. Checkout
  happens on the store's own site via the product link.
- Prices shown are approximate: they change and vary by region, so the UI and the
  agent present them with `~`.
- Coverage is what web search can reach — broad, but not literally "every store on
  earth"; store pages behind logins or aggressive bot-blocking may not be readable.
- The cart is in-memory per session — restarting the server clears it. Swap
  `lib/cart.ts` for a database to persist.
