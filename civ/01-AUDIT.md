# PHASE 0 — CURRENT STATE AUDIT

**Method.** Every finding below was produced by running the code in this
repository on 2026-09-17, not by reading it and not by trusting the previous
session's claims — including my own. Each finding names the command or query
that produced it so you can re-run it. Where I could not verify something, the
finding says **UNVERIFIED** and explains what is blocking verification.

**Verdict in one line.** `world/` is a working *simulation* of a workforce. It
contains **no runtime**, **no tools**, **no permissions**, **no memory**, **no
evidence**, and **no provenance** — and its own live-model path has never once
been executed. It is a legitimate Stage 0 and an illegitimate Stage 1.

---

## 1. What actually exists

```
world/README.md         182 lines
world/king.py           307 lines    CLI
world/test_world.py     148 lines    16 tests
world/sim/db.py         161 lines    schema
world/sim/engine.py     240 lines    the day loop
world/sim/ideas.py      162 lines    organs, gates, death
world/sim/mind.py       150 lines    model bridge
world/sim/names.py      166 lines    lexicons
world/sim/population.py 135 lines    founding
                      -----
                       1651 lines
```

**What holds up under measurement:**

| Claim | Verified? | Measurement |
|---|---|---|
| 16 tests pass | ✅ **TESTED** | `python3 test_world.py` → `Ran 16 tests … OK` in 2.59s |
| 1000 agents × 60 days is laptop-cheap | ✅ **TESTED** | 3.55 s wall clock; `world.db` = 4.4 MB |
| Runs with no third-party dependency | ✅ **TESTED** | imports clean on system Python 3.11 |
| Scoring gates cut weak ideas | ✅ **TESTED** | covered by 4 of the 16 tests |

That is the entire list of things that survived.

---

## 2. Findings

### F1 — The database cannot tell simulated text from model text · **CRITICAL**

`engine.py:153` calls `mind.think()`, which returns `(text, strength, src)`.
`src` is the provenance. It is used for **one counter** and then thrown away:

```python
text, strength, src = mind.think(a, idea, organ, _bodytext(...), rng)
if src != "offline":
    stats["thought"] += 1        # ← the only use
...
ideas.grow(con, idea["id"], organ, text, strength, d, a["id"])   # src not passed
```

The `organs` table has columns `idea_id, organ, text, strength, day, by_agent`.
**There is no source column.** Once written, an organ composed from a lexicon and
an organ reasoned by a model are byte-identical in kind and indistinguishable
forever.

This is a direct violation of the non-negotiable principle: *"If something is
simulated, label it SIMULATION."* The CLI labels the mode at the top of the
screen; **the data does not.** Hand someone a `world.db` and nothing in it
answers "was any of this thought?"

### F2 — The world does not record which mode produced it · **CRITICAL**

Keys persisted in the `world` table, queried directly:
`['day', 'founded', 'seed', 'size', 'treasury']`. No mode, no provider, no model,
no run history. A world built in `offline` and a world built in `claude` are
structurally identical files. F1 and F2 together mean **the honesty is in the
print statements, not in the system.**

### F3 — The memory system does not exist · **HIGH**

`db.py` declares a `memories` table and an index on it. A grep for any writer
finds exactly one line — the index declaration itself. **Nothing ever inserts a
memory.** The README and schema imply persistent agent memory; there is none.
Agents carry four floats and a trait string, and nothing else survives a day.

### F4 — "1000 distinct agents" is false by the standard now required · **HIGH**

Measured:

```
rows in agents:         1000
distinct (house, role):   21
```

The `agents` table columns are
`id, name, house, role, born_day, died_day, energy, coin, skill, nerve, eye,
patience, standing, trait, mentor_id, focus_idea`.

Checked against the distinctness invariant written in `civ/00-REALITY-CHECK.md`
— `UNIQUE(tools, permissions, memory_scope, success_metrics, escalation_rules)`:

| required column | present? |
|---|---|
| tools | **ABSENT** |
| permissions | **ABSENT** |
| memory_scope | **ABSENT** |
| success_metrics | **ABSENT** |
| escalation_rules | **ABSENT** |
| capabilities | **ABSENT** |
| autonomy_level | **ABSENT** |

The invariant I proposed last turn **cannot even be evaluated** against the
system I shipped the turn before. Behaviourally there are **21 kinds of agent**,
differing in a name and four random floats. Calling that 1000 distinct agents is
the padding I warned you about, and I did it.

### F5 — History is mutable · **HIGH**

No triggers, no hash chain in `db.py`. Proved by executing it:

```
deleted a history row with one statement. 11040 -> 11039.
```

Any code with a connection can rewrite the past. The audit log is a suggestion.

### F6 — There is no runtime · **CRITICAL for the stated goal**

Table existence check against `sim/db.py`:

| table | status |
|---|---|
| tasks | **ABSENT** |
| leases | **ABSENT** |
| runs | **ABSENT** |
| tools | **ABSENT** |
| permissions | **ABSENT** |
| evidence | **ABSENT** |
| claims | **ABSENT** |
| approvals | **ABSENT** |
| model_runs | **ABSENT** |

`engine.py` is a `for` loop over every living agent, once per simulated day. That
is not a scheduler. There are no leases, no deadlines, no token budgets, no
concurrency control, no crash recovery, no retries, no idempotency. If the
process dies mid-day the day is simply lost. Nothing in `world/` can host a live
execution, and no amount of adding a model call to it would change that.

### F7 — The live path has never been executed · **CRITICAL**

`mind.py` contains `_claude()` and `_ollama()`. Grep of `test_world.py` for
`WORLD_MIND`, `_claude`, `_ollama`, `ANTHROPIC` returns **nothing**. The one test
that calls `mind.think()` runs with `mind.available()` false, so it exercises
`_offline()` and never reaches the HTTP path.

`world/sim/mind.py` lines 88–103 are **UNVERIFIED CODE**. They have never made a
request. The JSON parsing, the `usage` accounting, the error handling and the
strength cap are all untested assertions. I described this system as having a
live mode. It has live *code*.

### F8 — I cannot verify a live agent from this container · **BLOCKING**

```
ANTHROPIC_API_KEY    NOT SET
OPENAI_API_KEY       NOT SET
ollama (127.0.0.1:11434)   NOT REACHABLE
```

There is no model provider reachable from this environment. **I cannot build and
prove a first live agent here.** Any claim I made to the contrary would be the
exact fake you forbade. This is the one hard blocker in the audit, and §3.3 says
what to do about it.

### F9 — Most of the population is inert even inside the simulation · **MEDIUM**

Over 60 simulated days, of 1000 living agents:

```
grew an organ:      739
authored an idea:   240
appear in events:   430
```

More than half never appear in the world's own history. The simulation is not
1000 agents working; it is roughly 240 agents producing and 500 doing bookkeeping
that leaves no trace.

---

## 3. Classification

### 3.1 SIMULATION (works, honestly useful, keep and relabel)

| Component | Judgement |
|---|---|
| `names.py` lexicons | Fixtures. Valuable for deterministic tests, worthless as content. |
| `_offline()` in `mind.py` | Composition, not reasoning. Correctly labelled in the CLI, not in the data (F1). |
| `engine.py` day loop | A clock for testing lifecycle and population dynamics. Not a runtime. |
| `population.py` | Founding + standings. Reusable shape, unusable schema (F4). |

### 3.2 REAL (verified by execution)

| Component | Judgement |
|---|---|
| `db.py` connection + WAL | Sound. Keep the pattern, replace the schema. |
| `ideas.py` gates and caps | **The best thing in the repository.** A weighted score with hard floors is exactly the shape an evidence gate needs. Port the mechanism, change what it gates on. |
| `test_world.py` | Real discipline: 3 of the 16 exist because running the code found real defects. Keep and extend. |
| Performance envelope | 1000 rows × 60 ticks in 3.5 s proves Law 1 (an agent is a row) is affordable. |

### 3.3 UNVERIFIED / NOT IMPLEMENTED

| Component | Status |
|---|---|
| `_claude()`, `_ollama()` | **IMPLEMENTED · UNVERIFIED** — never executed (F7) |
| Memory | **NOT IMPLEMENTED** — table declared, never written (F3) |
| Tools, permissions, gateway | **NOT IMPLEMENTED** — no table, no code (F6) |
| Tasks, leases, budgets, runs | **NOT IMPLEMENTED** (F6) |
| Evidence, claims, provenance | **NOT IMPLEMENTED** (F1, F6) |
| Agent Factory | **NOT IMPLEMENTED** |
| Owner control plane, PAUSE_ALL | **NOT IMPLEMENTED** |
| Immutable audit log | **NOT IMPLEMENTED** (F5) |

---

## 4. What is architecturally wrong (not just missing)

1. **Provenance is computed and discarded.** The information needed for honesty
   exists at runtime and is deliberately dropped one line before persistence.
   This is the worst defect because it is the cheapest to fix and the most
   damaging to leave.
2. **The day loop cannot become a scheduler.** A synchronous pass over all rows
   has no place to put a deadline, a budget, or a failure. It must be replaced by
   a claim/lease queue, not extended.
3. **Agent identity is too thin to carry capability.** Adding tools and
   permissions to the current `agents` table is not a migration, it is a new
   entity. The current row describes a *character*; a live agent needs a
   *principal*.
4. **Honesty lives in the presentation layer.** Every truthful label in this
   system is a `print()`. Truth must move into the schema, where it survives
   being copied, queried, and shown by a UI that did not write it.

---

## 5. Minimum change to a first REAL live agent

Per the development rule, before code.

**CURRENT STATE.** A simulation that can model 1000 agents cheaply, with good
gate mechanics and a real test habit, and with zero runtime, zero tools, zero
provenance, and an unverified provider path.

**PROBLEM.** The first live agent needs five things that do not exist: a recorded
model call, a task with a lease and a budget, a provenance-tagged output, an
evidence row pointing at something outside the system, and a provider that is
allowed to be absent without the system lying about it.

**PROPOSED CHANGE — a new `civ/` runtime beside `world/`, not a rewrite of it.**

| New file | Purpose |
|---|---|
| `civ/core/schema.sql` | `principals, tasks, leases, runs, tool_calls, artifacts, claims, evidence, events(hash-chained), approvals, world_meta` |
| `civ/core/store.py` | Connection, migrations, and the triggers that enforce the laws |
| `civ/core/provider.py` | `Provider` ABC + `ClaudeProvider` + `MockProvider(labelled MOCK)` + `NotConfigured` |
| `civ/core/runs.py` | Every model call recorded before and after: provider, model, prompt hash, tokens in/out, cost, latency, outcome |
| `civ/core/queue.py` | Claim-with-lease task queue; expired lease = redeliverable |
| `civ/core/agent.py` | The behaviour loop; one lease = one bounded run |
| `civ/owner.py` | Deterministic control plane: `PAUSE_ALL`, budgets, approvals. No model anywhere in this file. |
| `civ/test_runtime.py` | Conformance suite every provider must pass |

**The four enforced laws, as schema not prose:**

1. `runs.source` is `NOT NULL CHECK (source IN ('model','mock','lexicon','human'))`
   and every generated row carries `run_id REFERENCES runs(id)`. **F1 becomes
   impossible.**
2. `world_meta.mode` is written at founding and a trigger refuses a `model` run
   into a world founded as `simulation`. **F2 becomes impossible.**
3. `events` carries `prev_hash`; a `BEFORE DELETE`/`BEFORE UPDATE` trigger raises.
   **F5 becomes impossible.**
4. `claims` may not reach status `FACT` without a matching `evidence` row holding
   external provenance. Enforced by trigger.

**FILES TO CHANGE IN `world/`:** none in this step. `world/` keeps working and
gets relabelled `SIMULATION` in a later, separate change.

**RISKS.**
- *The provider path stays unverified until a key exists (F8).* Mitigated, not
  removed, by the conformance suite: the same tests run against `MockProvider`
  here and against `ClaudeProvider` on your machine, and the runtime reports
  `REQUIRES_CONFIGURATION` rather than pretending.
- *Schema churn.* The first schema will be wrong somewhere. Mitigated by keeping
  `civ/` separate from `world/` so a reset costs nothing.
- *Scope creep into the factory and the 1000 registry.* Explicitly out of scope
  until one agent completes one real task with one evidence row.

**TEST PLAN — acceptance for this step only.**

| ID | Test | Pass condition |
|---|---|---|
| L1 | A run with no provider configured | status `NOT_CONFIGURED`, zero fabricated output |
| L2 | A run against `MockProvider` | artifact written, `runs.source='mock'`, artifact labelled MOCK |
| L3 | Provenance is unforgeable | INSERT of a generated row without `run_id` is **rejected by the database** |
| L4 | Mode cannot be mixed | a `model` run into a `simulation` world is **rejected** |
| L5 | History is immutable | `DELETE FROM events` **raises** |
| L6 | A claim cannot become FACT without evidence | INSERT **raises** |
| L7 | Lease expiry | killed task is redelivered, no partial artifact |
| L8 | Restart | kill mid-run; world, tasks and events survive |
| L9 | `PAUSE_ALL` | no lease granted, no tool call, state intact |
| L10 | Provider conformance | identical suite passes on Mock; **runs on Claude the moment a key exists** |

L1–L9 are fully verifiable in this container today. **L10 is the one that needs
you.**

---

## 6. The one thing I need

I cannot produce a verified live agent without a model provider (F8). Everything
else in this step — the runtime, the queue, the provenance enforcement, the owner
plane, nine of the ten acceptance tests — I can build and prove here with no key
at all.

Two ways to unblock L10, in order of preference:

1. **Run it on your laptop with `ANTHROPIC_API_KEY` set.** I write the runtime
   and the conformance suite; you run one command; it either passes against the
   real provider or fails visibly. Cost of that first proof: well under one US
   dollar.
2. **Ollama on your laptop.** Free, slower, and proves the abstraction works
   against a second provider — which is worth more architecturally than proving
   it against one.

Until one of those exists, any "live agent" I report would be F7 repeated with
more confidence, and I will not do that.
