# The agent loop

An agent in this world can be woken, work out what to do, ask for a tool, see
what came back, decide again on the strength of it, tell a colleague, be checked
by code and reviewed by somebody else, and — when it is rejected — come back with
the rejection in front of it and answer it.

**What decides is not a model.** No model is reachable in this environment: no
local runtime answers and no key is set. Everything below is the machinery
around a model, exercised with the model absent. That distinction is kept
everywhere in this document, because it is the whole difference between a
working agent and a working demo.

---

## What was missing

The tool-use loop was already real. `agent_runtime.run_agent_turn` has always
done model → parse → gateway → observation → model, with denial caps, reserved
arguments, and artifacts that resolve only against bytes the gateway actually
wrote. None of that needed building.

Four things above it did.

### 1. The agent was woken with its memory thrown away

```python
mem = A.wake_memory(con, agent, task["project_id"])     # fetched
turn = RT.run_agent_turn(..., instruction=w.instruction_for(task))   # not passed
return {..., "memory_recalled": len(mem)}               # reported anyway
```

The memory went into a local variable, never reached the agent, and the handler
reported `memory_recalled: N` to the supervisor. The record said memory had been
recalled while nothing had recalled it to anybody.

### 2. A commissioned agent could never be employed

`_worker_for`, `W.assign` and `contract_prompt` each consulted
`ROLE_CAPABILITY` — a hard-coded map of the five founding agents. An agent the
factory created has its capabilities in `agent_capabilities` instead, so all
three concluded it could do nothing. It could be commissioned, approved,
embodied, given a desk, and then never selected for a single task. The Agent
Factory produced unemployable agents.

`W.capabilities_of(con, agent_id)` reads both, and is now the only resolver.
`form_team_for` had the same defect and the same fix.

### 3. Agents could not talk to each other

Every message between agents was sent **by the supervisor on their behalf**.
That is choreography, not communication.

### 4. A correction could not see what it was correcting

`h_correction_needed` created the correction as a new task with no link to the
failed one — deliberately a new row, so the failure stays FAILED in the record,
but with nothing pointing back. The agent picking it up saw an empty history and
was being asked to guess what had been wrong.

---

## The briefing

`core/agent_context.py` assembles what an agent knows when it wakes. Every line
of it is a row:

| | |
|---|---|
| the task | what was asked, and the conditions declared **when it was created** |
| prior attempts | artifacts on this task *and its parents*, each with its verification result and any review |
| recorded failures | `failures.lesson` for this task's lineage |
| memory | `wake_memory` — its own, the project's, the organisation's |
| inbox | messages actually addressed to it |
| its own work | artifacts it produced before, by name and sha |
| where it is | the room it is standing in |
| what it holds | the tools its permissions grant, with their argument shapes |

It ends with `Decide what to do next.` and contains no plan. A test fails if
`first read`, `then write`, `step 1`, `begin by` or similar appear in it — the
sequence is supposed to come from the task and the agent's decisions, and a
briefing carrying the answer would make the decision ceremonial.

A Researcher and a Builder woken on the same task get the same *shape* of
briefing and differ only by what they hold and what they remember.

### Lessons reach the agent without being promoted

A `failures.lesson` only enters `memories` when the owner plane **promotes** it,
which is a law, and nothing promotes anything in an unattended run. So the
briefing reads the failure record directly, scoped to this task's lineage. That
needs no promotion and invents nothing — it is the row written when the attempt
failed.

---

## Agents talk, through the gateway

`SEND_MESSAGE` is a real capability with a real tool behind it. An agent chooses
to send; the gateway decides whether it may.

```
SEND_MESSAGE  args: {"to": "<AGT-…>", "text": "…",
                     "kind": "REPORT|REQUEST|ANSWER|HANDOFF|…"}
```

Every worker holds it, rate-limited to 4 per lease and 60 per hour. Telling a
colleague something is a baseline capability: an agent that cannot say *this is
rejected and here is why* needs the supervisor to say it for it.

It is confined, and a test pins each of these:

- **The sender is authenticated, never asserted.** The gateway supplies it. A
  caller that supplies `principal_id` itself gets `None` handed to the tool and
  is refused — not the forged name it asked for. `agent_runtime.RESERVED_ARGS`
  refuses it one layer earlier with a clean denial, so a model meets the first
  check and never the second. LAW 21 is unreachable rather than merely enforced.
- **It reaches nothing but `agent_messages`.** No file, no process, no grant.
- **The owner plane is not a peer.** Messaging it is refused: text an agent read
  out of a file could otherwise arrive in the Owner's view wearing an agent's
  name. Reaching the Owner is escalation, which is a different, reviewed path.
- **An unknown `kind` is a readable denial**, not an `IntegrityError` the agent
  cannot interpret.

### Why the binding is in a subclass

`Gateway.call` does not pass the principal to the bound tool, and **it cannot be
changed to**: its source is inside the campaign #3 harness seal. Editing it
would rewrite the execution model underneath a closed campaign — and when that
was tried, `test_recalibration` caught it:

```
the harness changed since the re-seal: gateway_call: efb1c8cb97e9 -> 95a640ded90f
```

The change was reverted. `WorldGateway` subclasses `Gateway` and does the
binding there. The benchmark keeps the sealed gateway byte for byte; the world
uses the subclass; every check — pause, lease, grant, scope, rate, audit — is
the inherited one. `bench_seal.drift()` reports NONE.

---

## Teams are derived, not declared

`form_team_for(con, required_caps)` takes what a task needs and returns the
minimum set of agents covering it, greedy over who covers the most, agent id
breaking ties — so the same requirement always produces the same team.

```
["research"]                          → Researcher
["research","build","review"]         → Researcher, Builder, Reviewer
["research","quantitative_analysis"]  → Researcher, AGT-000006
["research","time_travel"]            → Researcher, uncovered: ["time_travel"]
```

Nothing anywhere says *Researcher + Builder + Reviewer*. `strict=False` returns
what could not be covered instead of raising, which is what a caller routing to
the Skill or Agent Factory needs.

---

## The real inference path

`LocalProvider` is complete: it POSTs system + prompt to an Ollama-compatible
`/api/generate` and returns the text. It is selected by `CIV_PROVIDER=local`
plus `LOCAL_MODEL_NAME`. **It has never been run**, here or anywhere: no local
runtime answers in this container.

`model_check.py` is the preflight for when one does:

```
CIV_PROVIDER=local LOCAL_MODEL_NAME=<name> python3 model_check.py
```

It puts three briefings of exactly the shape a real agent gets to whatever
provider is configured and asks:

1. does it ask for a tool it holds, with the right argument?
2. having read something, does it move on rather than re-reading?
3. **does it treat injected text inside a file as data rather than as an order?**

With nothing configured it makes no network call and says what is missing. A
model that cannot produce one JSON object reliably will burn its turns on
denials and look from the outside like a broken world; this says so before the
world is pointed at it.

---

## What the run actually does

```
python3 real_agent_demo.py --fresh
```

One objective. No further commands. Observed:

```
TASK #2  Investigate …                                    → FAILED
  READ_REPO ALLOW · WRITE_ARTIFACT ALLOW · SEND_MESSAGE ALLOW
  ART #1 findings_t2.md (589 bytes, sha 530adce656)
  VERIFY FAILED — names its source=ok; makes a recommendation=ok;
                  cites evidence=ok; states its limitations=FAILED

TASK #4  Correct: Investigate …                           → ACCEPTED
  READ_REPO ALLOW · WRITE_ARTIFACT ALLOW · SEND_MESSAGE ALLOW
  ART #2 findings_t4.md (775 bytes, sha 3a4417d1b0)
  VERIFY PASSED — all four
  REVIEW APPROVE by AGT-REVIEWER
```

Two agents, two corrections, 4 agent-to-agent messages, 4 artifacts with
distinct shas, 2 independent reviews, 3 journeys, and the Owner issued one
command.

The correction is the part worth looking at. `states its limitations` is **not**
announced in the briefing. The first attempt does not know about it, produces a
reasonable artifact, and fails verification. The correction task names its
parent, so the next agent's briefing carries:

```
WHAT THIS TASK ALREADY TRIED:
  artifact #1 'findings_t2.md' by AGT-RESEARCHER
    verification: FAILED — … states its limitations=FAILED

WHAT THIS LINE OF WORK HAS ALREADY BEEN FOUND TO GET WRONG:
  task #2: deterministic verification failed — an artifact that omits a
           declared section is rejected by verification before a reviewer reads it
```

It reads which requirement failed, takes the section title from the failure text
itself, and adds it. That arm of the loop is reached by observation, not by a
script that knew the answer.

---

## Real · deterministic · not demonstrated

> The audit of that last column, and the gate that closes it, is
> [`REAL_INFERENCE.md`](REAL_INFERENCE.md) — run `python3 real_inference_gate.py`.

| | |
|---|---|
| **REAL** | the loop, the briefing and every row in it, the gateway's decisions, the tool results, artifacts and their shas, agent-to-agent messages, verification, review, the correction chain, the failure record, movement, the whole causal chain |
| **DETERMINISTIC** | **the decisions.** `ReactiveWorker` is a hand-written policy that branches on what the gateway actually returned. It is not a model and never claims to be — every artifact it produces carries `NOT MODEL OUTPUT` in its body, and a test asserts that |
| **NOT DEMONSTRATED** | inference. No model is reachable, so no reasoning has been shown — only the machinery for it |
| **SIMULATED** | nothing. There is no ambient behaviour, no idle wandering, no decorative motion anywhere in the runtime |

### Why a double still tests something

A scripted demo decides the sequence in advance. Here the sequence is a
consequence, and the suite proves it by changing the circumstances:

- revoke `READ_REPO` and the same double takes a different path and writes
  *"No source was read: the gateway refused it"* rather than claiming a source
- give an agent no writing tool and it answers in words instead of declaring an
  artifact that does not exist
- the artifact body contains the byte count and the first lines the gateway
  actually returned, so it cannot be a canned string

What that establishes is that the loop **carries** decisions. It establishes
nothing about whether a model would make good ones.

---

## Security, unchanged

Every existing boundary holds, and the suite re-checks the ones this work came
near:

- an agent cannot grant itself a capability
- an agent cannot send in another agent's name
- an agent cannot message the control plane
- text inside a file is data: the system prompt says so and the gateway does not
  care what a file says
- a declaration naming a file the gateway never wrote resolves to nothing — a
  test drives a deliberately lying provider through the runtime to prove it
- campaigns #1–#3 untouched; `bench_seal.drift()` NONE before and after

**The OS sandbox is still not a complete security boundary.** `EXECUTE_SANDBOX`
runs a subprocess as the same user, constrained by argv allow-lists and path
roots in the grant, not by the operating system. Before any production external
action: container isolation, network isolation, filesystem isolation, scoped
credentials, audit.

---

## Known limitations

1. **No inference has been demonstrated.** The single most important line here.
2. **`LocalProvider` has never been executed** against a live runtime.
3. **Lessons are read from `failures`, not from promoted org memory.** Promotion
   is an Owner act by law, so an unattended world never promotes; the lesson
   reaches the next attempt on that task's lineage and no further.
4. **A review rejection was not exercised end to end** — verification catches
   the defect first, which is the correct order, so the reviewer approved in
   every run. The REJECT path has its own coverage in the deterministic suites.
5. **Team formation is implemented and tested but the supervisor still assigns
   one agent per task**; teams are formed at project level, not per task.
6. **`ReactiveWorker` is a policy I wrote.** It reacts to real observations, and
   it is still my policy reacting, not an agent's judgement.
