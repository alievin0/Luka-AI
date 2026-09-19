# A world of agents on one model

**STATUS: REAL MULTI-AGENT WORLD DEMONSTRATED, WITH REVIEW-QUOTA INTERRUPTION
AND REJECT PATH STILL UNEXERCISED — 2026-09-18, Google AI Studio free tier,
reproduced from commit `391a6e4`.**

Three agents each took real turns on a real model, the Researcher's own
conclusion reached the Builder as the Builder's input, and a Reviewer that had
read the work returned its own verdict. Then the free tier ran out mid-sequence
and the second review never happened. Both halves of that sentence are the
result; §7 is where the second half is kept, and it is longer than this section.

```
CIV_PROVIDER=gemini CIV_ASSUME_FREE=1 CIV_MODEL=gemini-3.1-flash-lite \
    CIV_MAX_CALLS=35 python3 real_world_demo.py
```

[`REAL_INFERENCE.md`](REAL_INFERENCE.md) established that **one** agent's turn
can be driven by a real model. This is the different and harder claim: that a
**world** of them runs on one.

## 0. What the reproduction recorded

Every number below is a row in the run's own database, read back after the fact.

| | |
|---|---|
| model calls | **17**, all `source='model'` · 14 OK, 3 FAILED on HTTP 429 · cap 35, never reached |
| model | `gemini-3.1-flash-lite` — the named model answered; no substitution |
| mock runs | **0** · ReactiveWorker runs: **0** · fallback providers: **0** |
| tool decisions from model output | **9** (each immediately after a `MODEL_RUN` event) |
| tool events from the harness | **1** — the bootstrap scan, 28 events before any model turn existed, its discovery row labelled `source='mock'` (§6) |
| what the gateway actually returned | sha256 `c509a1c5c5510f79a555243c6f81d9987d248bd4515081b0ee5c24582bda976e` — `AGENT_COGNITION.md`, 14676 bytes, verified against the file in the repository |
| observation dependency | demonstrated: `tokens_in` 930 → 2941 across the gateway's return, and the artifact reconstructs a sentence that is line-wrapped in the source file |
| the handoff | **16** distinctive words shared with the artifact **after the briefing is subtracted**; longest phrase repeated verbatim: **15 words** |
| the Reviewer | read-only — `fs.read` only, **zero write capabilities**, zero artifacts, and its verdict came from a run with `source='model'` |
| artifacts | 2, with different shas — different work, not a copy |
| `bench_seal.drift()` | **NONE** |
| the demo's own tally | 20 PASS / 0 FAIL — which is **not** proof that every artifact was reviewed (§7) |

---

## 1. What the Owner supplies, and what it does not

The Owner emits one `OWNER_OBJECTIVE` and stops. Everything after that is
`world_supervisor.run` turning its own handle.

What the file supplies is what an owner supplies: **the objective, the source to
work from, the bar the work is judged against, and who the work is for.** That
is a specification. It is not a decision.

What it does not supply, and a test or a printed record covers each:

| | |
|---|---|
| no tool is named for an agent | the briefing lists what it holds; the agent picks |
| no path is chosen for it | `WRITE_ARTIFACT`'s scope is a grant, not an instruction |
| no message text is written for it | the handoff is the Researcher's own words (§4) |
| no verdict is pre-selected | the Reviewer's first word decides it (§5) |

The objective is deliberately a question with a checkable answer, about a
document in this repository: *what does `AGENT_COGNITION.md` claim about whether
a model can drive this world, and does that claim still hold?* The agents are
told where to look and what to produce. Working out what the document actually
says is the first half of the task.

## 2. No double, and the database is what says so

The world is founded `live`, so **LAW 2's trigger refuses to record a `mock` run
in it.** The no-fallback guarantee is SQL, not a promise in Python:

```
IntegrityError: LAW 2: a mock run cannot enter a world founded as live
```

The same trigger runs the other way in a `simulation` world, which is what
refuses a real model run there. Which of the two answered is therefore a row,
never a claim — and §6's first check reads that row back.

## 3. A cap in front of the call, not a ledger behind it

`core/spend.py` bounds what the **next** call could cost and refuses it if that
would cross the ceiling. `CIV_MAX_CALLS` bounds the whole world — every agent in
it shares one `Cap` — and a stop-file halts a running world with `touch`, with
no database and nothing to wait for.

An unpriced model is refused rather than assumed free. A free-tier endpoint is
free only because the Owner said so (`CIV_ASSUME_FREE=1`), and that assertion
skips the pricing requirement and nothing else: the call cap still applies,
because an unbounded loop against a free endpoint is still an unbounded loop.

## 4. The handoff, and what it is evidence of

The Researcher messages the Builder through the gateway, which sets the sender —
`authority='agent'`, not the supervisor sending on anyone's behalf. The Builder
receives it in its inbox and its briefing carries it.

Whether the message carried the Researcher's **own result** or merely an
acknowledgement is measured, not assumed: vocabulary the message shares with the
artifact it wrote, **minus the briefing**. Words the agent was handed are not
evidence that it worked, so the objective, the conditions and the source's name
are all subtracted. Four surviving words is the bar. The longest phrase repeated
verbatim from the artifact is printed alongside it — stronger evidence still,
and deliberately not graded, because a handoff that paraphrases its own result
is a real handoff and failing it for that would be measuring style.

> This check used to claim the subtraction in its comment and not perform it,
> which let a message restating its instructions score as one that had worked.
> `test_multi_agent.py` now pins both directions.

## 5. The Reviewer

**A separate execution path.** Not `h_task_ready`: no assignment, no lease, no
workspace claim, no artifact. It reads through the same gateway as everybody
else and is read-only *because its GRANT is read-only* — `WRITE_ARTIFACT`,
`EXECUTE_SANDBOX` and `GRANT` are refused to it by the gateway whatever it
decides to try.

**It can disagree.** `h_review_requested` used to compute the verdict itself —
`APPROVE if not unmet` — so the Reviewer was a deterministic echo of
verification. `review_for` is now injected like `provider_for`, and the default
`deterministic_review` keeps the old behaviour exactly for every existing
caller. The Reviewer is shown what deterministic verification concluded, and
told in terms that it may disagree in either direction, because code can see
whether a heading is present and not whether what is under it is true.

**The verdict is the first word, or there isn't one.** The prompt asks for
exactly that, and the parser reads exactly that; both share one `VERDICT_RULE`
string so they cannot drift apart. Searching the whole answer for either word is
the rule that looks more forgiving and gets plain English backwards:

```
"I see no reason to REJECT this work, so: APPROVE"   →  a rejection
```

**An unreadable answer is not a verdict.** It is not an approval and not a
rejection: the artifact keeps its `REVIEW` status, a HIGH signal carries what
the reviewer actually said, and a person is told. *Could not be reviewed* is not
*approved*, and picking a side on the reviewer's behalf would be the supervisor
deciding while the record said the reviewer had.

## 6. The twenty-one checks

The report grades exactly what the rows show, and prints every decision every
agent made, in order.

| | |
|---|---|
| **the runs** | every run is a model run · only the three agents ran · both workers were used |
| **the researcher** | ran on the model · produced an artifact · its artifact is model-sourced · read something through the gateway |
| **the handoff** | messaged the builder itself · the message carries its actual result · the message reached the builder's inbox |
| **the builder** | ran on the model · produced its own artifact · the two artifacts are different work |
| **the reviewer** | a review was recorded · every verdict came from a model run · never produced the work · never wrote anything |
| **the world** | the owner gave exactly one instruction · it went quiet on its own · the cap was never exceeded |
| **the finish** | nothing is left unfinished without the record saying why (§8) |

One caution about reading a full tally, learned from the run in §0: twenty of
these grade whether real agents did real work, and every one of them can pass
while the workflow stops short. The twenty-first is the only one that is about
finishing, and even it passes an honest stop — what it refuses is a silent one.

The report also prints, side by side and ungraded, what the code concluded and
what the reviewer concluded for each artifact. A reviewer that agrees is not
thereby an echo — but one that *cannot* differ is not a reviewer, and printing
both is the only honest way to show the difference.

## 7. What is NOT established

The run above is the strongest evidence this repository has. It is also a single
afternoon on a free tier, and the list below is longer than the result.

**The interruption, in full.** The second review attempt hit **HTTP 429**. The
free-tier allowance ended at roughly **15 requests**, not the 20 assumed. **Task
#3 remained RUNNING with no final review verdict**, and its artifact carries
none. The workflow state for that run is `QUOTA_EXHAUSTED`, and §8 is the check
that now makes that impossible to omit.

**The 20/20 is not what it looks like.** A full tally of the demo's own checks is
**not** proof that every artifact received a review — that run scored 20 PASS
while an artifact sat unreviewed. The tally measures whether real agents did real
work; completion is measured separately, by §8.

**`usd = 0.0` is not a verified billing fact.** The run was told
`CIV_ASSUME_FREE=1` and recorded the assumption it was given. Nothing here reads
an invoice.

**The REJECT branch was not exercised.** Zero rejections. Nothing provoked one,
**no artificial rejection was injected**, and a manufactured one would have made
the demonstration worthless. The path is armed, routed and unit-tested; it has
not fired against a real model.

This demonstration does **not** establish:

- **model quality** — that a decision came out of a model is a row in `runs`;
  that it was a *good* decision is not something any test here asks
- **reliability under quota exhaustion** — the one time it happened, the
  workflow stopped
- **successful correction after rejection** — the correction path was not walked
  end to end on a real model
- **large-scale autonomy** — three agents, one objective, one afternoon
- **operation at 100, 1,000 or 10,000 agents**
- **autonomous business creation**
- **the Agent Factory or a Skill Factory**
- **physical embodiment**

Two further limits carried forward from the code itself: `LocalProvider` has
never been executed against a live runtime, and `ClaudeProvider` has never been
called at all.

## 8. The completion invariant

A tally of passing checks is not a finished workflow, and until `391a6e4` the
demo could not tell the difference. `completion_state()` now computes what
actually happened, from rows:

> **Every artifact carries a terminal verification state; every artifact whose
> verification PASSED carries a review outcome; and no task is left RUNNING —
> unless the run terminates explicitly as INCOMPLETE, QUOTA_EXHAUSTED or
> FAILED.**

Four states, and the verdict line carries the one it reached, so the verdict
cannot be quoted without it:

| | |
|---|---|
| `COMPLETE` | every artifact verified, every passing artifact reviewed, nothing left running |
| `INCOMPLETE` | something unfinished — including a stop the world escalated to a person |
| `FAILED` | a run ended badly and the record names it |
| `QUOTA_EXHAUSTED` | a run ran out of allowance: `HTTP 429`, `RESOURCE_EXHAUSTED`, "exceeded your current quota" |

Three things it deliberately does **not** do:

1. **It does not require APPROVE.** A REJECT is a review outcome and the
   entrance to the correction path; demanding an approval would be demanding a
   verdict rather than a review.
2. **It does not demand a review for an artifact that failed verification.**
   Verification runs first and a failure routes to correction without a reviewer
   ever seeing it, so the superseded first attempts in an ordinary run are not
   unfinished work.
3. **It does not match a bare `429`.** That number occurs inside token counts,
   byte counts and shas; each quota marker is matched with its prefix. A guard
   that reads `$0.50000` as a 500 is a defect this repository has already had
   once.

The graded check fails on one thing only: something unfinished with **nothing in
the database accounting for it** — no failed run, no HIGH signal raised to a
person. An honest stop passes and is named; a silent hole fails. The exit code
follows: `0` demonstrated and COMPLETE, `2` demonstrated but stopped short, `1`
not demonstrated.

`test_multi_agent.py` pins all of it: approval completes, rejection is an
outcome and not a hole, a missing review is INCOMPLETE, a 429 during review is
QUOTA_EXHAUSTED, a 503 is FAILED, "429 tokens" in an error message is neither,
no artifact is never a completion, an artifact with no verification evidence is
not complete, the schema itself refuses an artifact that names no run, and the
verdict line carries the state.

## Files

| | |
|---|---|
| `real_world_demo.py` | the run: the Owner's one objective, then the supervisor |
| `core/world_supervisor.py` | `review_for`, and the escalation when no verdict comes back |
| `real_world_demo.py` · `completion_state` | the four states, and the invariant in §8 |
| `core/spend.py` | the cap that refuses the call, and the kill switch |
| `core/provider.py` | `GeminiProvider`, `OpenAICompatProvider`, and `from_env` |
| `test_multi_agent.py` | the verdict rule and the handoff measure, pinned |
| [`REAL_INFERENCE.md`](REAL_INFERENCE.md) | one agent, and the gate that closed |
| [`AGENT_COGNITION.md`](AGENT_COGNITION.md) | the loop itself, exercised with no model |
