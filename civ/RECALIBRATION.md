# Benchmark recalibration — diagnosis, repairs, and a proposed Campaign #3

**Status: PROPOSAL. Campaign #3 is not authorised and has not been run.**
No model was called during this work. Everything below is deterministic:
frozen evidence, reference answers, static inspection and arithmetic.

Reproduce it with `cd civ && python3 bench_recalibrate.py` (free).

---

## 1. What is frozen

Campaigns #1 and #2 are preserved exactly as run, defects included, in
`civ/bench_history/campaigns-1-2.json` (sha256
`3ea2f54e1d40e96545a58c4370903aa893bc2b81b0c998cf809b5721220b4a08`).

**LAW 12** makes this structural rather than a promise:

```
sqlite3.IntegrityError: LAW 12: a closed campaign cannot be rewritten;
                        run a new campaign instead
```

Four triggers refuse UPDATE or DELETE on a closed campaign, its runs and its
evaluations. The temptation recalibration creates is to re-score the campaigns
that exposed the fault — a fixed evaluator applied backwards would produce
numbers no model ever earned. T06 still reads 0.00 in the record, and a test
asserts that it does.

---

## 2. Diagnosis of T01–T07

Computed from 140 frozen runs by `core/bench_diagnosis.py`, with thresholds
declared before the diagnosis ran: ceiling ≥ 0.95, floor ≤ 0.05, instability
span ≥ 0.50, meaningful delta ≥ 0.10, replication ≥ 2 campaigns.

**The diagnosis never reads which condition won.** A test flips the two
conditions throughout the frozen data and asserts every verdict is unchanged.

| Task | Verdict | Ceiling | Floor | Evaluator | Leakage | Stochasticity | Discriminative power |
|---|---|---|---|---|---|---|---|
| T01 exact output | NEEDS REVISION | **HIGH** | LOW | LOW | N/A | LOW | NONE — tied both campaigns |
| T02 five constraints | **VALID** | LOW | LOW | LOW | N/A | MEDIUM | DEMONSTRATED (multi, max Δ 0.24) |
| T03 edge cases | NEEDS REVISION | **HIGH** | LOW | LOW | N/A | LOW | NONE — tied both campaigns |
| T04 contradictory spec | **VALID** | LOW | LOW | LOW | N/A | **ASYMMETRIC** | DEMONSTRATED (multi, max Δ 0.20) |
| T05 tool required | **INVALID** | MEDIUM | LOW | LOW | **HIGH** | LOW | NONE — tied both campaigns |
| T06 factual | **INVALID** | — | HIGH | **HIGH** | LOW | LOW | NONE — both at floor |
| T07 long chain | NEEDS REVISION | **HIGH** | LOW | LOW | N/A | LOW | NONE — tied both campaigns |

**2 INVALID · 3 NEEDS REVISION · 2 VALID.**

### Ambiguous specification

Only T04 contains a deliberate ambiguity, and resolving it *is* the task. No
other task was found to be accidentally ambiguous: every one that tied did so
with both conditions at an identical score, which is the signature of a task
that is too easy rather than one that is unclear.

### The finding I had under-stated

T04's result is **not a quality gap**. Counting catastrophic failures rather
than averaging:

| | zero-scored runs |
|---|---|
| single agent | **2 of 10** |
| organisation | **0 of 10** |

The solo agent is perfect eight times out of ten and absent twice. Mean
correctness renders that as "0.80 vs 1.00", which reads like slightly worse
work and is nothing of the kind. **T04 measures reliability.**

The stochasticity rule was corrected to distinguish *symmetric* instability
(both conditions swing → noise, the task is broken) from *asymmetric*
instability (one swings, one holds → that asymmetry is the measurement). The
rule is direction-blind: a test asserts that an unstable MULTI against a steady
SINGLE is reported identically, as evidence for the single agent.

### Whether each task could distinguish the architectures at all

| Task | Capability under test | Could it separate? |
|---|---|---|
| T01 | none — baseline competence | No, and that is its job |
| T02 | keeping interacting constraints whole | Yes, weakly — observed |
| T03 | noticing an unhandled edge | Not as written; everyone passed |
| T04 | catching a self-contradicting spec | **Yes — replicated** |
| T05 | tool use surviving extra hops | Unknown; never actually tested |
| T06 | resisting a fluent unsourced claim | Unknown; never actually scored |
| T07 | holding one dependent chain | Not as written; everyone passed |

Nothing in v1 tested whether the organisation could make things **worse**.
Two campaigns could not have detected the most likely real cost of multi-agent
work — churn on things that were already fine.

---

## 3. The two repairs

### T06 — the evaluator was inverted (R16)

Original intent: *a fluent, unsourced claim contradicts the supplied note; the
note wins.* That intent is preserved exactly.

The defect: `repeated_brochure = "kuwait" in low and "5%" in low` fired on any
answer that cited the brochure **in order to reject it** — which is what the
task asks for. The full answer scored 0.00; a lazy answer that ignored half the
task scored 1.00.

The repair judges per sentence and in either word order. Correctness now turns
on the only thing that can be wrong — asserting that Kuwait levies VAT. Whether
the brochure was explicitly weighed moved to `completeness`/`evidence_quality`,
where it belongs.

Not designed to favour either condition, and verifiable: in both campaigns
*both* conditions had `correct=True` under the old checker (completeness 1.00),
so under the repaired checker both score 1.00 and **T06 remains a tie**. The fix
changes no conclusion. That is the point — a repair that flipped a result would
deserve suspicion.

### T05 — the prompt contained the answer (R17)

`task_input` pasted the whole fixture into the prompt, so "the answer is only in
the file" was answerable from the prompt. The single agent scored 1.00 having
made **zero tool calls**.

The fixture is now written to disk and the prompt carries only its path. Both
conditions receive byte-identical input and identical tool grants; the fairness
law (LAW 11) is untouched and still refuses any campaign where they differ. A
test asserts no fixture value appears in the prompt text, and another asserts
reverting the fix reintroduces the leak.

---

## 4. Pre-registration for Campaign #3

Nine tasks in `core/bench_tasks_v2.py`. v1 is untouched, so campaigns #1 and #2
stay reproducible. Every task declares all nine required fields **before** any
result exists; `check_preregistration` fails the set if any is missing.

| Task | Purpose | Favours | Difficulty target | Why it is in the benchmark |
|---|---|---|---|---|
| **V2-T01** baseline | baseline competence | single | 1.00 both — ceiling is correct here | Prices coordination overhead in isolation from quality |
| **V2-T02** interacting constraints | discrimination | neutral | 0.4–0.9 | Constraints that cannot be satisfied independently; now scored by execution, not by grepping source |
| **V2-T03** silent wrong | discrimination | neutral | 0.0–1.0 | A zero baseline has no percentage; the naive answer returns one anyway |
| **V2-T04** contradictory spec | discrimination | multi | **unchanged from v1** | The one task that worked. Not retuned after the fact |
| **V2-T05** tool required | discrimination | neutral | 0.5–1.0 | Carries R17's fix; finally tests what it claims |
| **V2-T06** factual | discrimination | multi | 0.3–0.9 | Carries R16's fix; finally scores what it claims |
| **V2-T07** long chain | discrimination | **single** | 0.3–0.9 | Eight dependent steps and a non-terminating division. One coherent chain plausibly beats handoffs |
| **V2-T08** do no harm | discrimination | **single** | high both, but multi can lose | **New.** Correct code submitted for review. Changing nothing scores 1.00 |
| **V2-T09** find defect | discrimination | multi | 0.3–0.8 | **New.** One subtle contract violation in code that runs and looks right |

**Balance across the 8 discriminating tasks: 2 single-favouring · 3
multi-favouring · 3 neutral.** The integrity gate fails any set with zero
single-favouring tasks.

**V2-T08 is the important addition.** It is the only task in either version
where the organisation can be measured doing damage: a critic that "improves"
working code into broken code is caught here and nowhere else. Its scoring is
purely preservation of the original behaviours.

### Difficulty was raised honestly

Per requirement 7, no puzzle was invented to make an architecture fail. The two
levers used are both realistic:

- **Silent failure** — the wrong answer is a plausible number, not a crash
  (T03, T07, T09). This is the failure that review exists to catch in real work.
- **Interacting requirements** — satisfying one changes another (T02).

T01's ceiling is kept deliberately and declared `baseline_competence`, per
requirement 6's exception. It is excluded from the discriminating count.

### Resource budget

9 tasks × 5 repeats × 2 conditions = **90 runs**. At the rates campaigns #1–2
actually cost (~$0.61 for 70 runs after R19), Campaign #3 is roughly
**$0.80–1.10** on Sonnet 5, or about half that on Haiku 4.5.

---

## 5. Integrity gate

`core/bench_integrity.py`, 47 checks, all deterministic.

**Result: 46 PASS · 1 WARN · 0 FAIL.**

The gate caught two defects during this work, both before they could cost
anything:

1. **V2-T03's rubric was a ceiling in disguise.** Two of its five sub-checks
   were ordinary cases everyone passes, so the naive answer banked 0.60 for
   free and the whole measurement was squeezed into 0.60–1.00. The ordinary
   cases now **gate** rather than score: fail them and the answer is 0.0; pass
   them and the score comes only from the cases that separate. The naive answer
   now scores 0.33 against the correct answer's 1.00.
2. A test feeds v1's actual inverted T06 checker through the gate and asserts
   it is **rejected**. This is the check that did not exist when it cost two
   campaigns.

### What the gate does and does not license

> The set is **SOUND** — it measures what it claims. Whether it
> **DISCRIMINATES** is unknown until a campaign runs.

Per your instruction, I am not claiming the new set is superior. Soundness is
a property of the instrument; discrimination is an empirical result that does
not exist yet.

---

## 6. The one warning, and a decision that is yours

```
WARN  design-power   6 of 8 discriminating tasks must decide the SAME way to
                     reach p<=0.05 on the sign test (clean sweep p=0.0312).
                     Campaigns 1-2 decided 2.
```

The sign test collapses each task to a single direction, discarding the
magnitudes and the per-run data. A clean sweep of 5 decided tasks gives
p = 0.0625 — **above α**. So the instrument needs 6 of 8 tasks to decide
identically before it can say anything at all, having decided 2 in each of two
campaigns.

**This is a property of the instrument, not of the organisation**, and it cuts
both ways: the benchmark is equally unable to demonstrate that one strong agent
wins.

I am not changing it. Choosing a more powerful test *after* seeing that multi
leads on the decided tasks would be exactly the manipulation you have told me
to avoid, however well-motivated. The options, for you to pre-register before
Campaign #3 runs:

| Option | What changes | Honest assessment |
|---|---|---|
| **A. Leave it** | Nothing. α = 0.05, sign test over tasks, 6 of 8 needed | Most conservative. Campaign #3 will very likely conclude `INSUFFICIENT_EVIDENCE` again, and that would be a true statement about weak evidence |
| **B. More tasks** | Grow to 12–16 discriminating tasks | Still needs 6 decided, but 6 of 16 is far more reachable than 6 of 8. Costs proportionally more per campaign |
| **C. A test that uses the data** | Keep α = 0.05; add a pre-registered paired permutation test over per-run scores | Uses ~90 measurements instead of 8 directions. Legitimate **only** because it would be fixed in writing before data that does not yet exist |
| **D. Report effects, drop the verdict** | Report per-task effects with confidence intervals; no single significance claim | Most honest about what a 9-task benchmark can support, but gives no clean go/no-go gate |

α stays at 0.05 under every option. `MIN_RUNS_PER_CELL` and
`MIN_TASKS_WITH_SIGNAL` are unchanged and a test asserts it.

My recommendation is **C + B together**, and I want to be explicit about why
you should discount that recommendation somewhat: it is the option most likely
to let the organisation demonstrate an effect, and I am the one who built the
organisation. Option A is the one that most protects you from me.

---

## 7. What has not been done

- **Campaign #3 has not been run** and is not authorised.
- **No claim that v2 is better than v1.** It is sound; that is all that has
  been established.
- **No threshold, weight or checker moved in a direction that flatters the
  organisation.** T04, the only task the organisation demonstrably wins, was
  carried over byte-identical; a test compares the two checkers' behaviour
  across six probes rather than their prose.
- **G1 evidence untouched.**

**227 tests across seven suites, one loud skip.**

Campaign #3 waits on your explicit authorisation, and on your choice from
section 6.
