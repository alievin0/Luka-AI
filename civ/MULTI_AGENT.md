# A world of agents on one model

**STATUS: the code is in the repository and tested. The run is RECORDED, NOT
REPRODUCED.** A run on 2026-09-18 reported `20 of 20` and is quoted in commit
`2d62429`. Nothing since has re-run it: this container holds no credential, and
the environment's key was removed by the Owner afterwards. Treat the recorded
output as recorded — and read §7 before citing it, because one of its twenty
checks was read by a parser that has since been fixed.

```
CIV_PROVIDER=gemini CIV_ASSUME_FREE=1 CIV_MODEL=gemini-3.1-flash-lite \
    CIV_MAX_CALLS=35 python3 real_world_demo.py
```

[`REAL_INFERENCE.md`](REAL_INFERENCE.md) established that **one** agent's turn
can be driven by a real model. This is the different and harder claim: that a
**world** of them runs on one — that the Researcher's real conclusion arrives as
the Builder's real input, and that a Reviewer which has actually read the work
decides whether it is acceptable.

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

## 6. The twenty checks

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

The report also prints, side by side and ungraded, what the code concluded and
what the reviewer concluded for each artifact. A reviewer that agrees is not
thereby an echo — but one that *cannot* differ is not a reviewer, and printing
both is the only honest way to show the difference.

## 7. What is NOT established

1. **The recorded run has not been reproduced, and one check in it is suspect.**
   Its Reviewer verdict was read by the scanning parser described in §5, before
   that was fixed. If the model's answer did not open with the word, the verdict
   stored in `reviews` for that run may be the opposite of what it said. The
   database of that run went with its container, so this cannot be checked —
   only re-run.
2. **The REJECT path did not fire.** It is armed and the supervisor routes on
   it, but nothing in that run forced a rejection and nothing was arranged to
   provoke one. *Not exercised* is not *not reachable*, and it is not claimed as
   passing. Manufacturing a rejection to demonstrate the correction loop would
   make the demonstration worthless.
3. **Reasoning quality is not measured anywhere.** That the decisions came out
   of a model is a row in `runs`; that they were *good* decisions is not
   something this file tests.
4. **Twenty requests per day, per model.** Google AI Studio's free tier is
   small. It costs nothing and it is not unlimited, and a run that exhausts it
   stops at the cap rather than spending.
5. **Three agents, one objective, one afternoon.** Nothing here says anything
   about scale, about long-horizon work, or about a world left running for days.

---

## Files

| | |
|---|---|
| `real_world_demo.py` | the run: the Owner's one objective, then the supervisor |
| `core/world_supervisor.py` | `review_for`, and the escalation when no verdict comes back |
| `core/spend.py` | the cap that refuses the call, and the kill switch |
| `core/provider.py` | `GeminiProvider`, `OpenAICompatProvider`, and `from_env` |
| `test_multi_agent.py` | the verdict rule and the handoff measure, pinned |
| [`REAL_INFERENCE.md`](REAL_INFERENCE.md) | one agent, and the gate that closed |
| [`AGENT_COGNITION.md`](AGENT_COGNITION.md) | the loop itself, exercised with no model |
