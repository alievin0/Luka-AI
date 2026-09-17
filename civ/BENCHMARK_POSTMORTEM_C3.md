# Benchmark methodology post-mortem — Campaigns #1, #2, #3

**No model was run for this document.** Every claim below comes from the frozen
campaign records, from executing the checkers against constructed answers, and
from reading `bench_run.py`. No campaign data was modified, no threshold moved,
nothing deployed.

**Scope:** can we construct a benchmark that genuinely measures whether the
multi-agent organisation provides value over one strong agent? This report
answers that question and nothing else.

---

## 0. The finding that governs everything else

Before auditing individual tasks, the harness itself has to be described
accurately, because most of the task-level defects are downstream of it.

```
SINGLE  = 1 model call.                    act() once, afterwards.
MULTI   = 3 model calls: build → critique → revise.   act() once, afterwards.
```

Three consequences, all verified in `bench_run.py`:

**(a) There is no tool-use loop.** `act()` is called *after* `output` has
already been assigned, and no `invoke()` follows it. A model can ask to read a
file; the content becomes the local variable `path` and is never returned to any
model. **Reading a file cannot inform an answer.**

**(b) The "organisation" under test is exactly one thing:** draft → independent
critique → revise, on the same model, with a fixed three-step pipeline. No agent
chooses a decomposition, spawns a peer, retries, or gathers evidence. Whatever
we measure, we are not measuring "a multi-agent organisation" in the general
sense — we are measuring **adversarial self-review by a second context**.

**(c) The MULTI path truncates.** The critic sees `draft[:4000]`; the reviser
sees `draft[:3000]` and `crit[:2000]`. On a long artifact the pipeline
*structurally loses information* that SINGLE never loses. And `SYS_REVISE` says
*"Apply the critique"* — which pressures a change even when the critique is
empty or wrong.

(c) is important and was not designed in deliberately: it is a genuine,
measurable mechanism by which this architecture can *lose*, and the only two
task types that could have detected it (long artifacts, already-correct
artifacts) were either at ceiling or mis-scored.

---

## 1. Task validity audit

Verdicts computed by `core/bench_diagnosis.py` against frozen data, plus manual
rubric inspection. **Bias column = which condition the defect could favour.**

### Campaign #1 / #2 task set (v1)

| Task | Verdict | Exact reason | Bias | Disposition |
|---|---|---|---|---|
| T01 exact-output | **CEILING** | 1.00/1.00 both campaigns | neither | **Retire as a scored task**; keep as cost control only |
| T02 multi-constraint | VALID (weak) | Only decided task besides T04; multi lead fell 0.24 → 0.08 between campaigns | neither | **Replace** — the checker grepped source text |
| T03 edge-cases | **CEILING** | 1.00/1.00 both campaigns | neither | **Replace** |
| T04 conflicting-spec | **VALID** | Decided both campaigns; single scored 0 on 2/10 runs, multi 0/10 | neither (rubric is keyword-based — see §3) | **Repair the rubric, keep the task** |
| T05 tool-required | **INVALID** | Fixture pasted into the prompt; single scored 1.00 with zero tool calls | **SINGLE** — it removed the need for the capability MULTI might have used better | **Replace** |
| T06 factual | **INVALID** | Evaluator inverted: punished any answer citing the brochure *in order to reject it*. Correct answer 0.00, lazy answer 1.00 | **neither** (both conditions hit the floor identically) | Repaired as R16; **keep repaired** |
| T07 long-chain | **CEILING** | 1.00/1.00 both campaigns | neither | **Replace** |

### Campaign #3 task set (v2)

| Task | Verdict | Exact reason | Bias | Disposition |
|---|---|---|---|---|
| V2-T01 baseline | **CEILING (by design)** | 1.00/1.00 — declared `baseline_competence` | neither | **Keep**, unscored |
| V2-T02 constraints | **CEILING (rubric-caused)** | 1.00/1.00. Probed: averaging over the wrong base, rounding per-row, and returning `{}` for empty **all score 1.0000**. The checker cannot fail a plausible function | neither | **Replace the rubric** |
| V2-T03 silent-wrong | **AMBIGUOUS** | Exactly 0.6667 on all 10 runs. Both failed only `negative_baseline_sign`. `pct_change(-50,-25)` is −50% by `(new-old)/old` and +50% by `(new-old)/abs(old)`; **the spec states neither** | neither (penalises both equally) | **Repair the spec**, keep the shape |
| V2-T04 conflicting-spec | **CEILING + rubric defect** | 1.00/1.00. Rubric keys on six trigger words: a fully correct explanation without them scores **0.00**; a *wrong* answer saying only "ambiguous" scores **1.00** | **either**, depending on phrasing habit | **Repair the rubric** |
| V2-T05 tool-required | **INVALID — IMPOSSIBLE** | 0.00 on all 10 runs. Grants `READ_REPO`, hands over a path, and the response schema has no shape for reading. R17 removed the prompt paste and exposed that the read path never existed | neither (impossible for both) | **Retire until the harness has a tool loop** |
| V2-T06 factual | **UNSTABLE** | The only decided task. Single 1,1,1,**0,0**; multi **0**,1,1,1,1. Gap is one run in five. Symmetric-instability rule (written pre-campaign) classifies this as noise | neither | **Keep, repair rubric, raise repeats** |
| V2-T07 long-chain | **CEILING + rubric/spec mismatch** | 1.00/1.00. Spec demands "rounded to exactly 4 decimals"; **unrounded full-precision output also scores 1.00** | neither | **Replace** |
| V2-T08 do-no-harm | **CEILING + metric defect** | 1.00/1.00. Prose saying "it is correct, ship unchanged" scores **0.0000** and is recorded as *DAMAGE*. Returning an `int` scores 1.0000 though the spec demands a float | **MULTI** — a refusal-to-change, which is the *correct* behaviour here, is scored as destruction | **Repair**, it is the most important task in the set |
| V2-T09 find-defect | **CEILING + gameable rubric** | 1.00/1.00. A *wrong* diagnosis containing the word "ties" scores **0.70**, the same as a correct diagnosis phrased without `>=` | **either** | **Replace the rubric with a behavioural patch test** |

**Totals — v2 as run:** 1 impossible · 1 ambiguous · 6 ceiling · 1 unstable.
**Zero tasks in Campaign #3 produced a trustworthy discriminating measurement.**

---

## 2. Information-access audit

Every task, every condition, checked against what the response schema actually
permits: `{"tool":"WRITE_ARTIFACT",…}` or `{"answer":…}`.

| Check | Result |
|---|---|
| **Tool grants** | `READ_REPO` granted on 4 tasks (T05, T06, V2-T05, V2-T06) |
| **Response schema** | Permits **only** `WRITE_ARTIFACT` and `answer`. No shape expresses a read |
| **Is a granted capability usable?** | **`READ_REPO` is unreachable on all four tasks.** Even if a model guessed the shape, `act()` runs after the answer is fixed and the content is never returned |
| **Fixture availability** | `materialise_fixtures()` writes V2-T05's fixture correctly to `<repo>/bench_fixtures/`, inside the gateway's `path_prefix`. The file exists and is readable. **The failure is not access — it is that nothing can ask for it** |
| **Hidden information** | None found. Both conditions receive byte-identical input (`LAW 11` enforces it; the integrity gate re-checks determinism) |
| **Asymmetry between conditions** | **None in information or tools.** The only asymmetries are: MULTI gets 3× the model calls, and MULTI's handoffs truncate at 4000/3000/2000 chars |

**Conclusion:** information access is symmetric and honest. The defect is that
**a declared capability was never wired to a usable interface**, which made one
task impossible and made another's tool grant decorative.

---

## 3. Rubric audit

For each checker: is the expected answer uniquely determined by the stated task?

| Checker | Uniquely determined? | Unstated convention | Two reasonable answers scored differently? | Tests the evaluator's assumption? |
|---|---|---|---|---|
| `check_exact` | **Yes** | none | no | no |
| `check_interacting` (V2-T02) | **No** | "average" has no stated base; rounding order unstated | **No — worse: four different answers all score 1.0** | Yes: it claims to test rounding order and does not |
| `check_silent_wrong` (V2-T03) | **No** | negative-baseline convention never stated | **Yes** — textbook formula scores 0.667, `abs()` scores 1.0 | **Yes**, decisively |
| `check_conflict` (V2-T04) | **No** | requires one of six specific words | **Yes** — correct reasoning without a keyword = 0.00; wrong answer with "ambiguous" = 1.00 | **Yes** — it tests vocabulary |
| `check_tool_required` (V2-T05) | Yes (unreachable) | none | n/a | no |
| `check_factual` (V2-T06) | Mostly | a neutral mention of the 5% claim reads as an assertion; a hedged-but-correct answer scores 0.00 | borderline | partially |
| `check_long_chain` (V2-T07) | **No** | spec says "exactly 4 decimals"; checker accepts ±0.00005, so unrounded output passes | **Yes** | **Yes** — it does not test the stated requirement |
| `check_do_no_harm` (V2-T08) | **No** | requires code output; an explicit "no change needed" scores 0.00. `int` vs `float` requirement not tested | **Yes** | **Yes** — conflates format non-compliance with *damage* |
| `check_find_defect` (V2-T09) | **No** | keys on the word "ties" | **Yes** — wrong diagnosis with the word beats correct diagnosis without it | **Yes** |

**7 of 9 checkers test something other than the task's stated requirement.**
This is the single largest source of invalid measurement, larger than task
difficulty. It also explains the ceiling: several 1.00/1.00 results are not
"both architectures succeeded" but "the checker could not fail either".

---

## 4. Ceiling / floor audit

| Reason a task cannot discriminate | Campaign #3 tasks |
|---|---|
| Both near 1.0 — **task genuinely easy** | V2-T01 (by design) |
| Both near 1.0 — **rubric too permissive** | V2-T02, V2-T04, V2-T07, V2-T08, V2-T09 |
| Both near 0.0 — **task impossible** | V2-T05 |
| Deterministic partial — **ambiguous spec** | V2-T03 |
| Does not exercise the architectural difference | V2-T01, V2-T07 (single-pass arithmetic; the critic has nothing to add) |

**The distinction that matters:** five of the six ceilings are *rubric* ceilings,
not *difficulty* ceilings. The v2 recalibration raised task difficulty and left
the checkers permissive, so difficulty never reached the score.

**Necessary condition for any future discrimination, stated plainly:**

> If SINGLE scores 1.0, MULTI cannot beat it. A task can only discriminate if
> **one strong agent's single-pass success rate is strictly between 0 and 1** —
> in practice around 0.4–0.7. This is not a design choice; it is arithmetic.

No task in any campaign was ever verified to satisfy this before being run.

---

## 5. Architectural discrimination

The architecture actually under test is **draft → independent critique →
revise**. Categories must be judged against *that*, not against an idealised
organisation.

### Where this architecture could plausibly show an advantage

| Category | Testable in this harness? | Why it could differ |
|---|---|---|
| **Adversarial review** | **Yes** | The critic reads the artifact with only the requirements, without the builder's commitment to its own approach |
| **Conflicting requirements** | **Yes** | The critic re-reads the requirement list cold; the builder has already chosen a reading |
| **Defect discovery** | **Yes** | Detection and repair are separate cognitive acts; the pipeline separates them |
| **Requirement-coverage under load** | **Yes** | Omission probability compounds across many constraints; a second pass over an explicit list recovers omissions |
| **Factual cross-checking** | **Partly** | Only for claims checkable against supplied text. Nothing can be looked up |
| **Independent verification** | **No** | Verification requires executing or reading. No tool loop |
| **Parallel research** | **No** | No parallelism, no retrieval |
| **Recovery from partial failure** | **No** | No retry loop; a failed call raises and ends the run |
| **Decomposition / replanning** | **No** | The pipeline is fixed in code; no agent chooses it |
| **Evidence synthesis** | **No** | No evidence is gathered |

**Five of ten claimed categories are untestable by construction.** Any benchmark
built today can only address the top four-and-a-half.

### Where one strong agent should plausibly be equal or better

| Category | Testable? | Why |
|---|---|---|
| **Simple deterministic work** | Yes | 3× cost, no headroom. Confirmed: V2-T01 at 5.6× cost for an identical answer |
| **Short transformations** | Yes | Coordination overhead dominates |
| **Long single artifacts** | **Yes, and untested** | The handoff truncates at 4000/3000/2000 chars. SINGLE never truncates |
| **Already-correct work** | **Yes, and mis-scored** | `SYS_REVISE` says "Apply the critique" — structural pressure to change something that is already right |
| **Low-branching tasks** | Yes | Nothing for a critic to catch |

The two strongest *a priori* reasons the organisation should lose — **handoff
truncation** and **revision pressure** — have never been measured, because the
only tasks that could have detected them were at ceiling or mis-scored.

---

## 6. Anti-gaming audit

Could either condition win because the benchmark was built around its shape?

| Risk | Present? | Evidence |
|---|---|---|
| Tasks chosen to reward decomposition | **No** | Balance was declared pre-registration and enforced by `check_can_conclude_against` |
| Rubrics that reward review-shaped prose | **Yes, latent** | `check_conflict` and `check_find_defect` reward *stating* a finding. MULTI's output appends `# CRITIQUE CONSIDERED:` to the artifact (`parse_out`), which injects critique text into the graded output. **On any keyword-scored rubric this is a structural advantage to MULTI** |
| Metrics that flatter multi | **No** | Cost, latency and damage all favour SINGLE and are reported unweighted; no blended score exists |
| Tasks impossible for one condition | **No** | V2-T05 was impossible for **both** |
| Evaluator sees the condition | **No** | Blind token; `LAW 10` refuses self-evaluation |
| Post-hoc metric selection | **No** | Metric set frozen by hash; `check_metrics_frozen` fails the build on drift |

**One real gaming vector found:** MULTI's output carries the critique text into
the artifact, and three rubrics score on keywords. Any future rubric must be
**behavioural or structurally extracted**, never keyword-matched, or MULTI wins
on prose volume rather than on correctness.

---

## 7. Proposed benchmark design

Seven discriminating tasks plus one baseline. Small and hard, not large and
easy. **Every task below is a proposal only; nothing is pre-registered yet.**

Common requirements, applied to all:
- Scored by **execution or structured extraction**. No keyword matching anywhere.
- The graded artifact is the **code only** — `parse_out`'s critique appendix must
  be excluded before scoring, or the gaming vector in §6 persists.
- Reference answer, and at least one *technically reasonable alternative* that
  must score identically. A rubric that splits two defensible answers is
  rejected before the campaign.
- Solvable with **no tool loop** (until the harness gains one).

| # | Task | Favours | Architectural hypothesis | Failure modes | Anti-gaming rationale |
|---|---|---|---|---|---|
| **N1** | **Twelve numbered requirements**, each independently executable, on one function | **MULTI** | Omission probability compounds; a critic re-reading an explicit numbered list recovers dropped items | builder drops 1–3; critic misses the same ones; reviser breaks a satisfied requirement while fixing another | Requirements are mechanical and content-neutral; nothing rewards prose. Score = fraction of 12 assertions passing |
| **N2** | **Idiom trap** — a requirement that contradicts a strong language default (e.g. *must mutate in place AND return the original object*) | neutral | The builder follows its prior; the critic checks literal conformance — but may share the prior | both follow the idiom; critic invents a non-existent violation | Behavioural test only. Neither architecture is advantaged by the *content* |
| **N3** | **Planted defect + hidden tests.** Given code and a failing property, produce a patch | **MULTI** | Detect-then-repair are separate acts; the pipeline separates them | declares it correct; patches the wrong line; breaks a passing test | Scored by hidden tests, not by naming the bug. Fixes §3's V2-T09 defect directly |
| **N4** | **Self-contradicting spec** — V2-T04's intent, rebuilt | **MULTI** | Replicated in C1 and C2 as a *reliability* effect (single 0/10 twice) | silently picks one rule; names a conflict that is not there | Scored by **structured extraction**: does the answer identify *both* specific rules? Not by keyword |
| **N5** | **Long artifact, internally consistent** — a spec and its implementation that must agree across >4000 characters | **SINGLE** | **The MULTI handoff truncates at 4000/3000/2000 chars.** SINGLE never truncates | multi loses the tail; critique addresses only the visible prefix | Measures a real, code-level property of this pipeline. Cannot be gamed — the truncation is mechanical |
| **N6** | **Already-correct artifact**, V2-T08 rebuilt | **SINGLE** | `SYS_REVISE` says "Apply the critique" — pressure to change what is already right | reviser rewrites and regresses; critic manufactures a complaint | **Accepts an explicit "no change required" as a full-credit answer**, fixing the defect where a correct refusal scored 0.00 as *damage* |
| **N7** | **Unsupported claim vs supplied source**, V2-T06 rebuilt | neutral | A critic asks "is this supported?"; the builder is fluent | repeats the claim; over-hedges | Structured extraction of the asserted proposition, not sentence heuristics |
| **N8** | **Baseline** — print exactly 42 | n/a | none; cost control only | none | Excluded from the decided count |

**Balance across the 7 discriminating tasks: 3 MULTI · 2 SINGLE · 2 neutral.**
Within the ≤2× rule the integrity gate already enforces.

### §8 — Why each task could realistically produce different outcomes

This is the question the whole benchmark rests on, so each answer is a
*mechanism*, not a hope:

- **N1** — Dropping a requirement is an **omission**, and omissions are not
  visible to the agent that made them. A second context holding the numbered
  list can diff artifact against list. This is the clearest mechanism there is.
- **N2** — A strong prior overrides a written instruction. The critic's *only*
  job is literal conformance, so it is not carrying the builder's prior about
  how the function "should" work. It may still share it — which is why this is
  declared neutral rather than multi-favouring.
- **N3** — Finding a bug and fixing a bug use different attention. One pass must
  do both while committed to an initial reading; the pipeline gets a fresh read.
- **N4** — Already replicated twice, as **reliability**: the solo agent was
  perfect 8 times in 10 and absent twice. The mechanism is that a contradiction
  is invisible once you have chosen a side, and the critic has not chosen.
- **N5** — Mechanical and certain: the critic literally cannot see past
  character 4000 of the draft. Any requirement living in the tail is invisible
  to review. **SINGLE has no such blind spot.**
- **N6** — The reviser is *instructed* to apply a critique. When the work is
  already correct the correct action is to do nothing, and the prompt pushes the
  other way. This is the organisation's most plausible *cost*.
- **N7** — Fluency and accuracy come apart; a reader asking "what supports this?"
  is doing a different task from a writer producing prose.

**And where they could not differ:** N8, and any task where single-pass success
is already ~1.0. Which is why the gate below exists.

---

## 9. Pre-registration design

**The Campaign #3 statistical rule is not modified.** α stays 0.05, the
two-sided exact binomial sign test over per-task QUALITY stays, and the
requirement of 6 of 8 decided tasks in one direction stays. The owner's reason —
that preliminary evidence had already been observed — is unaffected by anything
in this report, and none of the findings above give a results-independent reason
to change the decision rule.

One **power** change is proposed, and it is results-independent because it was
computable before any campaign ran:

> With 5 runs per cell and binary outcomes, the standard error on a cell
> proportion is ≈ 0.22. The pre-registered decision threshold is |Δ| ≥ 0.10 —
> **well inside noise.** V2-T06 demonstrated exactly this: a "decided" task
> whose entire margin was one run in five.

**Proposal: raise runs per cell from 5 to 15.** This changes no threshold, no α,
and no test — it reduces the chance that a *direction* is noise. It is the one
change justified purely by the arithmetic of the sampling design, which was
knowable in advance and was in fact flagged as the `design-power` warning before
Campaign #1.

### Freezing procedure for any Campaign #4

1. **Calibration gate first, and it is not a campaign.** Run **SINGLE only**,
   15 runs × 7 tasks. One condition cannot produce a comparison, so it cannot
   leak a result. Purpose: confirm each task's single-pass success rate lands in
   **(0.2, 0.9)**. Any task at 1.0 or 0.0 is **rejected before pre-registration**.
   Cost ≈ $0.15. *This requires owner authorisation and has not been run.*
2. Only tasks that pass the gate enter the pre-registration.
3. Seal exactly as Campaign #3 was sealed: task hashes over everything the model
   sees and is graded on, evaluator hashes over checker source, metric
   fingerprint, `check_option_a_locked`.
4. **New mandatory integrity check:** every checker must score its reference
   answer *and* its declared reasonable-alternative identically. This is the
   check that would have caught V2-T03, V2-T04, V2-T07 and V2-T09 for free.
5. **New mandatory integrity check:** the graded output must exclude the
   `# CRITIQUE CONSIDERED:` appendix, closing the §6 gaming vector.
6. Run once. Report the nine dimensions. Do not re-run to a different answer.

---

## 10. Final recommendation — the three possible next states

### A. Benchmark redesign required
**Evidence that would establish A:** the calibration gate in §9.1 returns
single-pass success rates inside (0.2, 0.9) for at least 5 of the 7 proposed
tasks. That would show a discriminating task set is *constructible* and the
ceiling was an artifact of rubric and difficulty choices, not a fact about the
problem domain.

### B. Architecture experiment required
**Evidence that would establish B:** the calibration gate passes, a properly
sealed Campaign #4 runs at 15 runs per cell, and the result is still
`INSUFFICIENT_EVIDENCE` or `NO_MEANINGFUL_DIFFERENCE_DETECTED`. That would mean
the benchmark is sound and **the architecture is what has nothing to show** — at
which point the thing to change is the architecture (a real tool loop, genuine
decomposition, retry on failure), not the measuring instrument. §5 already shows
five of ten claimed advantage categories are untestable without that work.

### C. Evidence sufficient to stop pursuing multi-agent
**Evidence that would establish C:** a *valid* benchmark — one that passes the
calibration gate and the reference/alternative rubric check — showing no
meaningful difference **with adequate power**, across at least two independent
campaigns, while cost stays ≈3× and damage is non-zero.

**What the current evidence supports:** none of the three, yet.

Three campaigns and 230 runs have produced **zero trustworthy discriminating
measurements**. C is specifically *not* supported: you cannot conclude "no value"
from an instrument that never measured. `INSUFFICIENT_EVIDENCE` three times is a
statement about this benchmark, not about the architecture.

**The single cheapest fact that would move us off the current state** is §9.1 —
a SINGLE-only calibration run costing about fifteen cents, which cannot produce
a comparison and therefore cannot bias anything. Until a task set is known to
have headroom, every further campaign will re-measure the ceiling.

---

## What this report did not do

- No model was run.
- Campaigns #1, #2 and #3 are untouched; Campaign #3 remains
  `INSUFFICIENT_EVIDENCE` and frozen under LAW 12.
- No threshold, α, task, evaluator or metric definition was changed.
- Nothing was deployed.
- The proposed task set is a **proposal**. It is not sealed, not pre-registered,
  and not authorised to run.
