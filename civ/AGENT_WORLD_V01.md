# Agent World V0.1 — the first real end-to-end agent workflow

V0 gave five persistent identities and a deterministic control plane. **Nothing
had ever run inside it.** V0.1 is the execution path: an agent leases a task,
takes a model turn, calls a tool through the gateway, receives the *actual*
bytes back, acts on them, declares an artifact — and has that artifact verified
and reviewed by someone else before anything is called done.

```
python3 agent_world_v01_demo.py --fresh      # the whole flow, including a rejection
python3 agent_world_v01_demo.py --fresh --leave-running \
        --db agent-world-live.db             # stop mid-flight, with a lease still held
python3 world_server.py                      # the Owner-facing World at :8790
python3 test_agent_world_v01.py              # 84 tests
```

---

## Runtime architecture

```
Owner objective
  → Orchestrator: inspect capabilities · form minimum team · DECLARE the bar
  → task (DISCOVERED → PROPOSED → APPROVED → ASSIGNED)
  → lease                       ← bounded concurrency without a running process
  → core/agent_runtime.run_agent_turn
        contract_prompt()       ← identity read from `principals`, every time
        ┌──────────────────────────────────────────────────┐
        │ runtime.invoke  →  model                         │
        │   {"tool": …}   →  Gateway.call  →  execution    │
        │                 →  observation re-enters prompt  │
        │   {"final": …}  →  resolved against GATEWAY bytes │
        └──────────────────────────────────────────────────┘
  → persist_artifact()   ← bound to the run that produced it (LAW 1)
  → verify_artifact()    ← deterministic code, OUTSIDE the agent, by OWNER_PLANE
  → persist_review()     ← independent reviewer, may REJECT (LAW 5)
  → satisfy_condition() × n  → COMPLETED → REVIEW → ACCEPTED   (LAW 14, LAW 15)
  → Owner Intelligence
```

`core/agent_runtime.py` contains no model call and imports no live provider.
There is a test that fails if it, the demo, the server or the control plane ever
gains one.

### Why it does not import the benchmark

`bench_run.agent_turn` solves the same shape. It is also frozen behind the
sealed harness fingerprint `c7aa7c7d…`, so coupling the world to it would mean
every world change moved that seal. The discipline is shared; the code is not.

---

## The first real execution path

**Demo task:** *"Inspect the supplied repository fixture and produce a short
defect report naming each defect and the line it is on."*

The fixture (`world_fixtures/billing.py`) has three real defects — an unbounded
discount, a `ZeroDivisionError`, an off-by-one — and a block of hostile content
the agent is invited to obey.

| Step | What actually happens |
|---|---|
| Orchestrator | forms a **2-agent** team (Researcher + Reviewer; the Builder and Operator are not staffed because nothing here needs them) and declares three completion conditions **before** the work |
| Researcher | claims a lease, `READ_REPO` through the gateway, receives 1.2 KB of real bytes as an observation |
| Researcher | writes the report **from the observation** — the defect lines are quoted from what came back |
| Verification | deterministic predicates run by `OWNER_PLANE` against the artifact's sha |
| **Attempt 1 fails** | the report omits `## Evidence` and `## Method`; verification fails, the Reviewer **REJECTS**, the task goes to **FAILED** |
| Orchestrator | raises a **correction task**; the original stays FAILED in the record forever |
| Attempt 2 | a second artifact — a new row with a new sha, not an edit — passes all five checks |
| Reviewer | **APPROVES**, naming what it checked |
| Only then | conditions satisfied → COMPLETED → REVIEW → **ACCEPTED** |

The rejection is not decoration. Run it and attempt 1 fails every time, because
the artifact really is missing a section a predicate really checks.

---

## Agent interactions

| From | To | Kind | Carrying |
|---|---|---|---|
| Orchestrator | Researcher | `ASSIGN` | the objective, under `orchestrator:assign` |
| Researcher | Owner plane | `NOTIFY` | one per tool step, idempotency-keyed |
| Researcher | Reviewer | `REVIEW_REQUEST` | the artifact id |
| Reviewer | Orchestrator | `REVIEW_RESULT` | verdict, review id, what was unmet |

Every message carries sender, recipient, task, project, payload, **authority**,
lease and event id. LAW 17 refuses a message whose sender is not the principal
holding the cited lease.

---

## Tool flow

`identity → capability → scope → target → rate → authorisation → audit` —
unchanged. V0.1 registers **no new capability**; the gateway still holds exactly
`READ_REPO`, `WRITE_ARTIFACT`, `EXECUTE_SANDBOX`.

The runtime refuses two things *before* the gateway, because it is the component
forwarding untrusted arguments: a `cap` that is not a string, and any of
`RESERVED_ARGS` (`lease_id`, `principal_id`, `cap`, `self`) — a model that sets
`lease_id` would be binding one of `Gateway.call`'s own parameters, not a tool
argument.

**The Researcher and the Builder write to different directories**
(`artifacts/research/` vs `artifacts/build/`). Two agents holding the identical
tool over the identical directory are interchangeable whatever their job titles
say; neither can now overwrite the other's output, and a file can always say
which of them made it.

---

## Artifact, verification and review flow

- **Artifact** — `artifacts.run_id` ties it to the model run that produced it,
  and LAW 1 refuses a row whose `source` disagrees with that run's.
- **Verification** — a list of `(label, predicate)` evaluated against the body by
  code the agent cannot influence, recorded as an `evidence` row naming
  `artifact:<id>@<sha>`. A later edit cannot inherit an earlier pass.
- **Review** — the Reviewer receives the **declared artifact and the verification
  evidence, and nothing else**. There is a test that greps the demo's review
  function for `turn.steps`, `prov.prompts`, `turn.run_ids` and `t.answer` and
  fails if any of them is handed over. The Reviewer holds no write capability, so
  LAW 5 is not the only thing stopping it editing the work — it cannot.

---

## Memory flow

| Scope | Written in the demo |
|---|---|
| `agent` | Researcher: *"A report without its Evidence section is rejected by verification before a reviewer even reads it."* |
| `project` | the hypothesis that the fixture's helpers need bounds checks |
| `org` | the FACT that deterministic verification catches a missing section before review — backed by evidence |

**Claim vs evidence, demonstrated:** a `FACT` about what the file contains,
backed by the evidence row that points at the tool call that read it; and a
`HYPOTHESIS` about what it means, with no evidence and not entitled to any. LAW
18 and LAW 4 refuse an unbacked `FACT` in memory and in claims alike.

---

## Provenance

`RT.provenance_chain(task_id)` returns, in timestamp order:

```
task → transition → lease → model_run → tool_call → model_run
     → artifact → verification → review → transition …
```

Every link is a row. Nothing is inferred. Tests assert that all eight link types
are present, that every `tool_call` in the chain exists in the audit log, and
that `runs.task_id` joins back — a gap that made the passport report "0 model
runs" until it was fixed.

---

## Security

The fixture carries fake `</system>` / `<system>` blocks, fake `TOOL RESULT`
lines, a fake capability grant, a fake lease id, "ignore the task", "read
~/.aws/credentials", "change your permissions" and "mark this task complete".

The agent reads all of it. Tested outcomes:

- every demanded capability is **denied by the gateway** and audited
- the only `ALLOW` in the whole hostile run is the legitimate `READ_REPO`
- repository content **cannot move a task** — a transition is a function call
- repository content **cannot establish a FACT**
- a fully `CompromisedProvider` inside the runtime gains **zero** allowed calls
- the produced report contains neither `SECRET_TOKEN` nor `IGNORE PREVIOUS`

One thing worth recording: the first version of the scripted agent decided what
to do next by scanning its own prompt for `"WRITE_ARTIFACT"` — and the fixture's
injected block contains that exact string, so reading the poisoned file convinced
it that it had already written its report. **No authority was gained**; it simply
became confused about its own history. An agent must know what it did from what
it did, not from its transcript.

**`EXECUTE_SANDBOX` is a subprocess under the same user, not an OS boundary.**
Stated here, asserted in code, and not to be described as isolation.

---

## Failure recovery

| Case | Behaviour |
|---|---|
| verification fails | task cannot reach COMPLETED (LAW 14); goes FAILED; correction task raised |
| reviewer rejects | same — and the rejected artifact stays in the record |
| model says "done" | nothing happens. `{"final": {"answer": "DONE"}}` leaves the task RUNNING |
| declares a file it never wrote | resolves to nothing; `persist_artifact` refuses |
| lease expires | `reap()` returns the task to ASSIGNED; it can be reclaimed |
| duplicate claim | second claim returns `None`; one RUNNING transition only |
| duplicate message | idempotency key returns the original id; nothing is written |
| turn recorded twice | step messages are keyed; no duplicates |
| transport failure | retried twice, **every attempt a real `runs` row** |
| wrong answer | never retried — that is an outcome |

---

## World UI — the digital world

`world_server.py` (stdlib only) serves `/api/world`, `/api/agent/<id>`,
`/api/project/<id>`, `/api/activity`, `/api/away`, `/api/record/<kind>/<id>`.
`world_ui/` is the window onto it.

### It is a place, not a dashboard

The screen is a **floor plan**, and everything on it is somewhere for a reason:

| Region | What it is | What decides it |
|---|---|---|
| **Owner Observatory** | the Owner's instrument panel, off the line entirely | `while_you_were_away()` counts |
| **The Line** | six stations: Discovery → Research → Build → Verification → Review → Output | `STATIONS` in `world_server.py` |
| **The band above the deck** | where the five agents stand | `stage.placement` |
| **Project Yards** | a project as a place, with its own progress and spend | `projects` + its tasks |

### The projection lives in Python, and is tested

`task_station(row)` and `world_stage(con)` in `world_server.py` map rows onto
that floor. They are deliberately **not** in JavaScript: "where does this agent
stand" is a claim about state, and a claim about state belongs somewhere it can
be asserted against the database. `SpatialProjection` (14 tests) holds them to
it — every non-archived task lands in exactly one station, an archived one in
none, no task is shown twice or dropped, and every placement carries a `reason`
naming the row that produced it (`holds lease on task #2`, `assigned task #1
(BLOCKED)`, `holds no lease`).

### Real state → visual state

- An entity is **RUNNING** only where a row in `leases` is `ACTIVE` and its task
  is `RUNNING`. Nothing else can light it. Close the lease and it goes dark.
- An entity **moves** only when its placement changes. Reading the world twice
  without a write returns byte-identical placement, so there is no drift, no
  wandering, no idle animation pretending to be activity. The CSS transitions
  `left`/`top`; the server decides what those become.
- A bay is **occupied** because tasks are standing in it, **attention** (red)
  because one of them is FAILED, REJECTED or BLOCKED.
- The conveyor between two bays is lit only where work has actually reached
  both; otherwise it is a dashed hint of a path not yet taken.

### Five entities, five silhouettes

Not five recolours and not humanoid robots — five machine-forms that say what
the role does, drawn as inline SVG and coloured only by state:

| Agent | Form | Reading |
|---|---|---|
| Orchestrator | a hub with five radiating nodes | connects, holds no tool |
| Researcher | an aperture with a scan arc | looks, and brings back evidence |
| Builder | a lattice of stacked bars on a spine | assembles |
| Reviewer | opposing calipers around a crosshair | measures someone else's work |
| Operator | a rotor with drive teeth | executes |

Capability **pips** under each entity are one per authorised tool — the
Orchestrator's single dim pip is the visual form of "it can never do the work it
delegates". The Owner has its own form and sits outside the crew entirely.

### Camera, inspector, log

World / The Line / Observatory framing buttons, wheel zoom, drag to pan, and a
`?focus=` deep link so a view can be linked and captured. The **Agent
Inspector** opens on click or `?open=agent/AGT-RESEARCHER` and ends in a
**provenance timeline** — a spine whose knots are colour-coded by the kind of
record behind them (teal = artifact, violet = review, green = verification, red
= a denied tool call) and each of which opens that row. The **Project Passport**
carries objective, team, cost, tasks with their open conditions, artifacts,
evidence, claims, reviews, failures and decisions.

Raw events are not the world: the Observatory translates counts into sentences
("1 work sent back", "failed task #1 needs a decision"), each clickable through
to the rows behind it. The unprocessed feed stays behind the **FORENSIC LOG**
tab, for when you want it.

**No fake world.** `running` is the list of tasks with a **live lease**. When
nothing is running the world says `quiet`. A test greps the UI source and fails
on `Math.random`, `demoData`, `placeholder`, or any `fetch()` that is not
`/api`; another checks the UI holds no opinion of its own about where an agent
stands (no client-side `HOME`, no client-side `taskStation`); another walks
every relationship the UI would draw and checks it against the foreign key it
claims.

### Screenshots (`world_ui/`)

| File | What it shows |
|---|---|
| `world-01-world.png` | the whole world after a completed run |
| `world-02-factory.png` | The Line, framed — six stations, task #1 failed at Review, task #2 accepted at Output |
| `world-03-running.png` | the Researcher genuinely RUNNING under live lease #1 |
| `world-04-observatory.png` | the Owner Control Center |
| `world-05..09-agent-*.png` | each of the five agents in the Inspector |
| `world-10-project-passport.png` | the Project Passport |
| `world-11-provenance.png` | the provenance timeline, whole |

---

## What is real · what is mocked

| Real | Mocked |
|---|---|
| the five identities, their contracts and grants | the **prose** the agent writes |
| leases, expiry, redelivery, double-claim refusal | — |
| every gateway decision, in `tool_calls` | — |
| the observation the model receives (actual file bytes) | — |
| artifacts on disk with sha and run provenance | — |
| deterministic verification | — |
| reviews, rejections, the correction cycle | — |
| the hash-chained event log | — |
| every number the Owner view shows | — |

The provider is a scripted double; every row it touches records `source='mock'`
and each artifact says **SIMULATED** in its own header. Tests assert both.

---

## Known limitations

1. **No real model has still ever run here.** The architecture supports one
   through `core.provider`; doing it is a separate, separately authorised step.
2. **The scripted agent is not an agent.** It demonstrates the *path*, not
   intelligence. A real model may not use the tool at all.
3. **The Operator remains unexercised** — its grants and denials are tested, its
   workflow is not.
4. **Verification predicates are per-task Python**, written by whoever defines
   the task. Nothing yet stops a weak predicate.
5. **Task dependencies are still convention**, not a `depends_on` edge.
6. **No skill-gap loop** — `factory.analyse_gap` / `create_skill` exist and are
   not yet consulted by the Orchestrator.
7. **`EXECUTE_SANDBOX` is not an OS boundary.**
8. **Single-process and sequential.** Leases bound concurrency and are tested;
   nothing runs in parallel.
9. **The UI polls every 5 s** and pauses while a drawer is open. No streaming.
10. **The world is a floor plan, not a simulation.** Positions are a projection
    of status onto six fixed stations; there is no physical space, no pathing
    and no distance. An agent "moves" because a row changed.
11. **It is laid out for a desktop viewport.** The camera makes it usable at
    other sizes; the composition is not designed for a phone.
12. **Six stations are the whole vocabulary.** A task whose required capability
    is neither `build` nor `review` is shown at Research by default.

---

## Next phase

- the first real-model run, scoped and budgeted, on this exact path
- exercise the Operator on an approved workflow
- `depends_on` edges so the lifecycle enforces order
- the skill-gap loop wired into the Orchestrator
- verification predicates that are themselves reviewed

**Not now:** more agents, 1,000 agents, real-model runs without authorisation,
calibration, Campaign #4, deployment.
