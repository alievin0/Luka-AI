# Agent World V0

**Five persistent agents inside the real runtime.** Not a simulation of an
organisation — the same `principals`, `leases`, `tool_calls`, `artifacts`,
`evidence`, `claims`, `reviews` and hash-chained `events` the rest of this
system already runs on.

Run it: `python3 agent_world_demo.py --fresh` · Test it: `python3 test_agent_world.py`

---

## Architecture

```
Owner
  ↓  objective
Control Plane  ── deterministic Python. No model reaches it.
  ↓
Agent Registry (principals)  ── identity · contract · grants · memory scope · lifecycle
  ↓
Task Engine (tasks · task_conditions · task_transitions)
  ↓
Leases  ── bounded concurrency without a running process
  ↓
Tool Gateway  ── identity → capability → scope → target → rate → authorisation → audit
```

Alongside, never underneath: `agent_messages` (who said what to whom, under what
authority), `memories` (agent / project / org, separated), `artifacts` +
`evidence` + `claims` + `reviews` (what was produced and whether it holds up).

**The control plane is ordinary code.** `core/agent_world.py` contains no model
call and imports no live provider — there is a test that fails if it ever does.
A model may write the *content* of an artifact. It may never decide a
permission, a lifecycle transition, a team, a budget or an acceptance.

### What V0 reuses rather than rebuilds

`principals` · `contract.register/transition` · `tasks` · `leases` ·
`runtime.Gateway` (unchanged, same three tools, **no new capability registered**)
· `artifacts` · `evidence` · `claims` · `reviews` · `events` · `projects` ·
`teams` · `skills` · `capabilities` · `owner_state`.

### What V0 adds

| Table | Why it did not exist before |
|---|---|
| `task_transitions` | `tasks.status` says where a task *is*; nothing said how it got there |
| `task_conditions` | "done" had no definition that could be checked |
| `agent_messages` | agents had no way to talk that left a record |
| `memories` | `memory_scope` was declared on every agent and nothing wrote to it |

Plus `tasks.status` widened from 6 states to the full lifecycle, by the same
verified lossless migration used for `bench_runs` and `tool_calls`. **No row
moves.** The runtime's own `QUEUED/LEASED/DONE` vocabulary is untouched and still
works; the world lifecycle is additive.

---

## The five agents

Persistent **identities**, not processes. Nothing runs between runs; identity
survives because it lives in the database with its contract, grants, memory and
history. Founding twice does not create a second set — there is a test that
closes the world, reopens it in a new connection, and checks the agent is the
same row with the same memories.

| Agent | Role | Tools | Capabilities it may be assigned |
|---|---|---|---|
| **AGT-ORCHESTRATOR** | decomposes objectives, assigns, forms teams, records | **none** | decompose · assign · coordinate |
| **AGT-RESEARCHER** | investigates, gathers evidence, separates claim from evidence | `READ_REPO` | research · evidence · read |
| **AGT-BUILDER** | turns approved tasks into artifacts, reports what was produced | `READ_REPO` `WRITE_ARTIFACT` | build · write · read |
| **AGT-REVIEWER** | judges someone else's work, may reject | `READ_REPO` **only** | review · read |
| **AGT-OPERATOR** | executes approved workflows, records every action | `READ_REPO` `EXECUTE_SANDBOX` | execute · operate · read |

Two of these are deliberate and tested:

- **The Orchestrator holds no tool at all.** It cannot read, write or execute. So
  it can never quietly do the work it delegates, and a task it reports as done
  was done by someone it can name.
- **The Reviewer can read but not write.** A reviewer that can edit the artifact
  is a co-author, and LAW 5 would have nothing left to protect.

Each agent carries a full contract — mission, success metrics, escalation rules,
autonomy level, memory scope — not a prompt string.

---

## Lifecycle

```
DISCOVERED → PROPOSED → APPROVED → ASSIGNED → RUNNING → COMPLETED → REVIEW
                ↑                      ↓          ↓                    ↓
             REJECTED ←──────────── BLOCKED    FAILED        ACCEPTED / REJECTED
                                                                       ↓
                                                                   ARCHIVED
```

The graph is a dict in `agent_world.LIFECYCLE`. An edge that is not in it does
not exist, no matter who asks. Every transition writes a `task_transitions` row
with the actor, the reason and the event id — and those rows refuse `UPDATE` and
`DELETE` (LAW 13).

### No fake completion

Completion conditions are declared **when the task is created**, before anyone
knows whether they will be met. A bar written after the work is a bar the work
was always going to clear.

- **LAW 14** — a task cannot reach `COMPLETED` while any declared condition is
  unsatisfied, and cannot reach it with fewer evidence conditions met than
  `evidence_required`.
- **LAW 15** — `ACCEPTED` and `REJECTED` are reachable only out of `REVIEW`, so
  nothing skips the reviewer.

Both are triggers. A rule that lives only in Python is a rule an agent can be
talked out of.

---

## Permissions

Unchanged: everything goes through `runtime.Gateway.call` —
identity → capability → scope → target → rate → authorisation → audit.
V0 registers **no new capability**; there is a test asserting the gateway holds
exactly `READ_REPO`, `WRITE_ARTIFACT`, `EXECUTE_SANDBOX`.

Tested and refused: reading outside the repo, `~` expansion, `../` traversal,
absolute-path escape, writing outside the artifact directory, an interpreter with
`-c`, a shell, and `GRANT_PERMISSION` from every one of the five agents. Every
refusal is audited — including one where the authorised tool then raised
(`decision='ERROR'`).

---

## Memory

Three scopes that do not leak into each other:

| Scope | Owner | Who may write |
|---|---|---|
| `agent` | the agent itself | **only that agent** (LAW 19) |
| `project` | `project:<n>` | any team member |
| `org` | `ORG` | any agent |

- **LAW 19** — an agent may not write into another agent's memory. That is not
  communication; `agent_messages` is.
- **LAW 18** — a `FACT` in memory requires an evidence row, exactly as a claim
  does. `claims` already had LAW 4; memory is the other door into the same room.

### Claim vs evidence

> "Customer demand is high."

This is storable as a `CLAIM`, a `HYPOTHESIS` or an `OBSERVATION`. It is **not**
storable as a `FACT` — the insert is refused by the database, in both `claims`
and `memories`. A `FACT` needs an `evidence` row, and evidence names something
*outside* this system: a file that was read, a command that ran, a query, a
human.

In the demo the Researcher produces exactly this split: a `FACT` about what the
file contained (backed by evidence #1, which points at the tool call that read
it), and a `HYPOTHESIS` about what it means (no evidence, and not entitled to
any — nothing was measured).

---

## Communication

Every message carries sender, recipient, kind, task, project, payload,
authority, optional evidence/artifact, lease, event id and timestamp.

- **LAW 16** — a sent message cannot be rewritten or deleted.
- **LAW 17** — the sender must be the principal holding the cited lease. No agent
  may send in another's name.
- **Idempotency** — a message with a repeated `idempotency_key` returns the
  *original* id and writes nothing. A queue that delivers twice cannot make the
  history say something happened twice.

`thread(con, task_id)` returns the whole conversation under a task, in order.

---

## Events

Unchanged and hash-chained: every transition, message, tool call, denial, team
formation and lease is an `events` row, `UPDATE` and `DELETE` refused (LAW 6).
`store.verify_chain()` recomputes the whole chain; the demo prints the result.

---

## Owner Intelligence

`while_you_were_away(con)` returns counts computed by `COUNT(*)` over real rows —
tasks discovered/completed/accepted/rejected/failed, artifacts, reviews (and how
many were rejections), messages, evidence, facts established, memories written —
plus decisions waiting and **named** blockers.

There is no field in that function that could hold something other than what
happened. When nothing happened it returns `quiet: true` and an empty dict.

`project_passport(con, pid)` assembles objective, owner, team, tasks (with open
conditions), artifacts, evidence, claims, reviews, decisions, failures, costs,
activity timeline, blockers and **next required action** — all computed, none
stored separately, so it cannot drift from the record.

`world_state(con)` is what a UI may draw **and nothing else**: `running` is the
list of tasks with a *live lease*. An agent drawn as working is an agent holding
one. When nothing is running, `quiet` is true and the world is allowed to be
quiet.

---

## Security boundaries

Preserved exactly: untrusted content is **data**. A file an agent reads may
contain `IGNORE PREVIOUS INSTRUCTIONS`, fake `<system>` blocks, fake tool
results and fake capability grants — tested — and confers nothing. It cannot
move a task, establish a fact, widen a grant or reach a capability. A fully
`CompromisedProvider` inside the world gains zero allowed calls.

**The sandbox is not an OS boundary.** `EXECUTE_SANDBOX` is a subprocess under
the same user. This is stated here, asserted in code, and must not be described
as isolation.

---

## What is real · what is simulated

| Real | Simulated |
|---|---|
| the five agent identities and their contracts | the **prose** in the demo's artifact |
| every permission check and denial | — |
| every tool call, in `tool_calls` | — |
| artifacts on disk, with sha and provenance | — |
| evidence rows pointing at real files | — |
| leases, expiry, redelivery | — |
| the hash-chained event log | — |
| every number in "while you were away" | — |

The demo's model calls go to `MockProvider`; every row it touches is labelled
`source='mock'`, and the artifact body says **SIMULATED** in its own header.
There is a test asserting both.

---

## Known limitations

1. **No model has run inside this world.** Everything is MockProvider or a
   scripted double. That is deliberate for testing an architecture — a
   well-behaved model would pass by declining — but it means the first real run
   is still the first real run.
2. **The Operator is built but unexercised by the demo**, because the demo needs
   no execution. Its grants and denials are tested; its workflow is not.
3. **No UI.** `world_state()` is the API a UI would read. Nothing is drawn yet,
   which is the correct order.
4. **Team formation is capability-matching, not negotiation.** The Orchestrator
   picks the minimum cover; it does not reason about load or history.
5. **No skill-gap loop yet.** `factory.analyse_gap` / `create_skill` exist from
   the earlier work and are not yet wired into the Orchestrator's decision.
6. **Dependencies between tasks are recorded by convention** (the demo approves
   the build task only after research is accepted), not enforced by a
   `depends_on` edge.
7. **`EXECUTE_SANDBOX` is not an OS boundary** — see above.
8. **Single-process, sequential.** Leases give bounded concurrency and are tested
   against double-claiming and expiry, but nothing runs in parallel yet.

---

## Next phase

- wire the skill-gap loop into the Orchestrator: detect gap → search skills →
  reuse → else propose → test → approve → grant
- a real `depends_on` edge, so the lifecycle enforces order rather than the demo
- exercise the Operator on an approved workflow
- the first real-model run, deliberately scoped and budgeted
- the owner-facing view, reading `world_state()` and nothing else

**Not now:** 1,000 agents, robots, unrestricted network, autonomous financial or
legal authority, unrestricted credentials.
