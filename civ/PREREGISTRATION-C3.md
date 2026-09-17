# Campaign #3 — pre-registration, sealed

**Campaign #3 has NOT been run and is NOT authorised.**

Owner directive, 2026-09-17: Option A, unchanged; nine dimensions reported
separately; metrics defined before any Campaign #3 data exists.

Reproduce every claim below with `cd civ && python3 bench_recalibrate.py` (free,
no model, no campaign).

Metric fingerprint: `8553b9ce2ddd224192cdc6e4c8f84a3134372c8e30767cb5703006ded37c6407`
— the integrity gate refuses a campaign whose metric definitions hash
differently. That is what makes "no favourable metric selected after the fact"
enforceable rather than a promise.

---

## 1. Final pre-registered task list

Nine tasks, `core/bench_tasks_v2.py`. v1 is untouched; campaigns #1 and #2 stay
reproducible and remain immutable under LAW 12.

| # | Task | Purpose | Favours | Difficulty target | Evaluator |
|---|---|---|---|---|---|
| 1 | **V2-T01-baseline** | baseline competence | single | 1.00 both — ceiling is correct here | exact stdout |
| 2 | **V2-T02-interacting-constraints** | discrimination | neutral | 0.4–0.9 | execution against 3 input shapes |
| 3 | **V2-T03-silent-wrong** | discrimination | neutral | 0.0–1.0 | execution; ordinary cases gate, hard cases score |
| 4 | **V2-T04-conflicting-spec** | discrimination | multi | **unchanged from v1** | flags the contradiction |
| 5 | **V2-T05-tool-required** | discrimination | neutral | 0.5–1.0 | exact figure, fixture on disk (R17) |
| 6 | **V2-T06-factual-verification** | discrimination | multi | 0.3–0.9 | per-sentence attribution (R16) |
| 7 | **V2-T07-long-chain** | discrimination | **single** | 0.3–0.9 | exact 4-decimal value |
| 8 | **V2-T08-do-no-harm** | discrimination | **single** | high both; multi can lose | behavioural preservation, 7 cases |
| 9 | **V2-T09-find-defect** | discrimination | multi | 0.3–0.8 | names the contract violation |

**8 discriminating tasks: 2 single-favouring · 3 multi-favouring · 3 neutral.**
V2-T01 is excluded from the discriminating count; its ceiling is declared and is
its job.

**V2-T04 is byte-identical to v1.** A test compares the two checkers' behaviour
across six probes rather than their prose. A task that works is not retuned
after the fact.

**V2-T08 carries `damage_class=True`** and is the only task in either version
where the organisation can be measured making things worse.

Every task pre-registers: objective · difficulty target · expected failure
modes · objective evaluator · what counts as meaningful improvement · allowed
tools · allowed evidence · resource budget · relevance to the benchmark
question · ceiling/floor/leakage/stochasticity/discriminative-power risk ·
a reference-correct and a reference-wrong answer.

---

## 2. Final metrics — nine dimensions, reported separately

`core/bench_metrics.py`. Never averaged, weighted or collapsed. A system can be
better on quality and worse on cost, and the report says exactly that.

| # | Dimension | Metric | PASS / FAIL criterion |
|---|---|---|---|
| 1 | **QUALITY** | `mean(correctness)` from the independent blind evaluator, partial credit retained | Cell reportable at ≥ 5 completed runs. Task DECIDES at \|Δ\| ≥ 0.10, else TIE. **The only dimension that feeds the statistical rule.** |
| 2 | **CORRECTNESS** | `count(correctness ≥ 0.999) / attempts` — strict, no partial credit | Difference reported at ≥ 0.20 (one run in five). Never combined with quality. |
| 3 | **RELIABILITY** | catastrophic (≤ 0.05 **or** incomplete), major (≤ 0.50), failure-free (> 0.50), worst run | Difference reported when failure-free proportions differ by ≥ 0.20. **Catastrophic counts are always printed raw, per run, whatever the difference.** Never reduced to mean quality. |
| 4 | **EVIDENCE QUALITY** | unsupported claims/run, contradictions/run, graded evidence score | Difference reported at ≥ 0.20 claims per run. Lower is better. |
| 5 | **COST** | `total_usd`; `total_usd / count(correct AND verified)` | Cheaper wins **only** if the condition produced verified successes. No verified success ⇒ `per_verified_success = None`, which is **not zero** and must never read as free. Difference at ratio ≥ 1.25. |
| 6 | **LATENCY** | mean / median / worst ms per run | Difference at mean ratio ≥ 1.25. |
| 7 | **HUMAN INTERVENTION** | total interventions; `runs_requiring_a_human / attempts` | Expected 0 for both — a benchmark run is autonomous by construction. **Any non-zero value is reported as a finding, not averaged away.** |
| 8 | **COORDINATION FAILURE** | retries + tool denials + budget stops + incomplete runs + a declared tool going uncalled on a task that needs it, per run | Computed identically for both conditions — a single agent retries and is denied too. Difference at ≥ 0.20 per run. |
| 9 | **DAMAGE / REGRESSION** | on damage-class tasks: runs that broke ≥ 1 original behaviour / attempts | **PASS is a damage rate of 0.00** — leaving correct work alone. Any non-zero rate is a cost of that architecture, whichever condition incurs it. |

### Standing rules across all nine

- **Raw observations are preserved.** `compute_all()` returns `raw_scores`, the
  per-run list, alongside every summary. A test asserts it is never summarised
  away.
- **No unsuccessful run is hidden.** Every attempt is written to `bench_runs`
  before it is judged, so a failed run cannot be dropped afterwards.
- **Every comparison is symmetric.** A test swaps the two conditions across all
  nine dimensions and asserts every verdict mirrors exactly. A rule that reads
  differently depending on who is being measured is a thumb on the scale.
- **The evaluator never learns which condition produced a result.** It sees a
  blind token; **LAW 10** refuses an evaluation authored by an agent that
  produced the run.
- **No overall winner score exists.** `compare()` returns nine separate
  verdicts, and an integrity check fails the build if a blended score appears.

---

## 3. Final statistical rule — OPTION A, sealed

```
test                     two-sided exact binomial sign test
over                     per-task QUALITY directions
alpha                    0.05
min runs per cell        5
min tasks with signal    3
discriminating tasks     8
decided tasks needed     6, all pointing the same way
p at a clean sweep of 6  0.0312   (significant)
p at a clean sweep of 5  0.0625   (NOT significant)
```

**Nothing here may move after Campaign #3 runs.** `check_option_a_locked`
fails the gate if α, the cell minimums, the task count or the derived bar
changes; tests assert that moving α to 0.10, or adding a ninth discriminating
task, both fail the gate.

The owner's stated reason is recorded with the rule: preliminary evidence of a
multi-agent advantage has already been observed, so changing the decision rule
now would create a researcher-degrees-of-freedom problem **even if the change
were statistically defensible**. I proposed C+B; the owner declined; the
proposal is not revisited.

The other eight dimensions are **reported and never tested**. Adding a second
statistical test after seeing preliminary evidence is precisely what Option A
exists to prevent, and an integrity check asserts exactly one dimension feeds
the rule.

**What this rule can and cannot do**, stated in advance so the result is not
reinterpreted afterwards: with 8 discriminating tasks, a 5-of-8 clean sweep in
either direction does **not** clear α. Campaign #3 concluding
`INSUFFICIENT_EVIDENCE` is therefore a likely and legitimate outcome, and would
be a true statement about weak evidence — not a finding against either
architecture. The nine dimensions are where the useful reading will be.

---

## 4. Final integrity-gate result

```
60 passed · 1 warning · 0 failures        VERDICT: WARN
```

The one warning is the design-power note, left standing deliberately:

```
WARN  design-power   6 of 8 discriminating tasks must decide the SAME way to
                     reach p<=0.05 on the sign test (clean sweep p=0.0312).
                     Campaigns 1-2 decided 2.
```

What the gate covers: pre-registration completeness (9 tasks × 22 fields) ·
evaluator validation against reference answers (9) · the set can conclude in
both directions · no fixture leaks into a prompt (9) · input is deterministic
(9) · no discriminating task sits at a declared ceiling (9) · design power ·
Option A locked · metric fingerprint frozen · exactly one dimension tested ·
all nine metrics pre-registered · no blended winner score · the damage
dimension has a task to measure it on.

**The only claim this licenses:**

> The set is **SOUND** — it measures what it claims. Whether it
> **DISCRIMINATES** is unknown until a campaign runs.

It is not claimed to be better than v1.

**251 tests across seven suites, one loud skip.**

---

## 5. The exact command that would run Campaign #3

Not to be run without explicit authorisation.

```bash
cd ~/luka-bench
git pull origin claude/agents-count-tf5el8      # the clone used for #2 is stale

cd civ
python3 bench_recalibrate.py                    # free: re-verify the gate locally

export ANTHROPIC_API_KEY=sk-ant-...             # a rotated key
python3 bench_run.py --task-set v2 --repeats 5 --fresh

cat bench_report.json
```

`--task-set v2` is never implicit: the default remains `v1`, so nothing
silently upgrades a run to a set that has not been authorised, and campaigns #1
and #2 stay reproducible from the same binary.

- **90 runs** — 9 tasks × 5 repeats × 2 conditions
- **≈ $0.80–1.10** on `claude-sonnet-5`; roughly half on
  `CIV_MODEL=claude-haiku-4-5`; **$0** on `CIV_PROVIDER=local` with Ollama,
  subject to a local model's own ability
- `--fresh` starts a new world file so Campaign #3 cannot inherit state from
  the frozen campaigns

A free rehearsal that concludes nothing and costs nothing:

```bash
python3 bench_run.py --task-set v2 --dry-run
```

---

## What remains untouched

- **Campaigns #1 and #2** — immutable, LAW 12, defects recorded exactly as they
  occurred. T05's leakage and T06's inverted evaluator stay in the record; R16
  and R17 are **not** applied retroactively.
- **V2-T04** — byte-identical to v1.
- **G1 evidence** — untouched.
- **α, the cell minimums, and the sign test** — Option A, sealed.

**STOP. Awaiting authorisation.**
