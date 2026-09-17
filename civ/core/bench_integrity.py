"""BENCHMARK INTEGRITY — the gate a task set must pass BEFORE it costs money.

Campaigns #1 and #2 spent real budget on a set containing an inverted evaluator
and a leaking fixture. Both were findable without a model. Everything in this
file is deterministic: reference answers, static inspection, and arithmetic.

An integrity failure is not an opinion about difficulty. It says the instrument
cannot measure what it claims, whichever condition that happens to help.

No check here reads campaign outcomes. A set that passes is SOUND, not superior;
only a campaign can say whether it discriminates.
"""
import json
import os

PASS, FAIL, WARN = "PASS", "FAIL", "WARN"

# Every field a task must pre-register before it may be run.
REQUIRED_FIELDS = (
    "id", "title", "domain", "difficulty", "purpose", "favours",
    "objective", "difficulty_target", "expected_failure_modes",
    "meaningful_improvement", "allowed_tools", "allowed_evidence", "max_usd",
    "relevance", "description", "checker", "risk",
    "reference_good", "reference_bad",
)
REQUIRED_RISKS = ("ceiling", "floor", "leakage", "stochasticity",
                  "expected_discriminative_power")

GOOD_MUST_SCORE = 0.80      # a reference-correct answer must reach this
BAD_MUST_NOT_EXCEED = 0.50  # a reference-wrong answer must stay under this
SEPARATION_MIN = 0.40       # and the gap between them must be at least this


def _result(name, status, detail):
    return {"check": name, "status": status, "detail": detail}


# ── 1. every task pre-registers everything ────────────────────────────
def check_preregistration(tasks):
    out = []
    for t in tasks:
        missing = [f for f in REQUIRED_FIELDS if not t.get(f)]
        risks = t.get("risk") or {}
        missing += ["risk.%s" % r for r in REQUIRED_RISKS if not risks.get(r)]
        out.append(_result("prereg:%s" % t["id"], FAIL if missing else PASS,
                           "missing: %s" % ", ".join(missing) if missing
                           else "all %d fields declared" % (len(REQUIRED_FIELDS) + len(REQUIRED_RISKS))))
    return out


# ── 2. every evaluator is validated against reference answers ─────────
def check_evaluators(tasks, checkers):
    """The check that would have caught T06 before a single dollar was spent."""
    out = []
    for t in tasks:
        fn = checkers.get(t["checker"])
        if fn is None:
            out.append(_result("evaluator:%s" % t["id"], FAIL,
                               "checker %r not found" % t["checker"]))
            continue
        good, bad = t["reference_good"], t["reference_bad"]
        ran_good = _simulate(good)
        ran_bad = _simulate(bad)
        try:
            g = fn(good, ran_good, t.get("fixture", {})).get("correctness", 0.0)
            b = fn(bad, ran_bad, t.get("fixture", {})).get("correctness", 0.0)
        except Exception as e:                              # noqa: BLE001
            out.append(_result("evaluator:%s" % t["id"], FAIL, "checker raised: %r" % (e,)))
            continue
        problems = []
        if g < GOOD_MUST_SCORE:
            problems.append("a correct answer scored %.2f (needs >= %.2f)" % (g, GOOD_MUST_SCORE))
        if b > BAD_MUST_NOT_EXCEED:
            problems.append("a wrong answer scored %.2f (must stay <= %.2f)" % (b, BAD_MUST_NOT_EXCEED))
        if g - b < SEPARATION_MIN:
            problems.append("separation only %.2f (needs >= %.2f)" % (g - b, SEPARATION_MIN))
        out.append(_result("evaluator:%s" % t["id"], FAIL if problems else PASS,
                           "; ".join(problems) if problems
                           else "good %.2f vs bad %.2f, separation %.2f" % (g, b, g - b)))
    return out


def _simulate(answer):
    """The sandbox result a correct artifact would produce, for stdout checkers.

    Deterministic and local. Never used during a campaign — campaign runs execute
    through the Tool Gateway exactly as before."""
    try:
        import io
        import contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            exec(compile(answer, "<ref>", "exec"), {})      # noqa: S102 - fixtures only
        return {"returncode": 0, "stdout": buf.getvalue(), "stderr": ""}
    except Exception as e:                                  # noqa: BLE001
        return {"returncode": 1, "stdout": "", "stderr": repr(e)}


# ── 3. the set can conclude in BOTH directions ────────────────────────
def check_can_conclude_against(tasks):
    disc = [t for t in tasks if t.get("purpose") != "baseline_competence"]
    favours = {}
    for t in disc:
        favours[t["favours"]] = favours.get(t["favours"], 0) + 1
    single = favours.get("single_plausible", 0)
    multi = favours.get("multi_plausible", 0)
    problems = []
    if single == 0:
        problems.append("no task is declared to favour the single agent — such a set "
                        "cannot answer the benchmark question")
    if multi == 0:
        problems.append("no task is declared to favour the organisation")
    if single and multi and max(single, multi) > 2 * min(single, multi):
        problems.append("lopsided: %d single-favouring vs %d multi-favouring" % (single, multi))
    return [_result("can-conclude-either-way", FAIL if problems else PASS,
                    "; ".join(problems) if problems
                    else "%d single / %d multi / %d neutral across %d discriminating tasks"
                    % (single, multi, favours.get("neutral", 0), len(disc)))]


# ── 4. no task leaks its own answer into the prompt ───────────────────
def check_no_leakage(tasks, task_input):
    out = []
    for t in tasks:
        text = task_input(t, "/repo")
        problems = []
        if t.get("fixture_via_tool"):
            blob = json.dumps(t.get("fixture", {}))
            for token in _fixture_tokens(t.get("fixture", {})):
                if token in text:
                    problems.append("fixture value %r appears in the prompt" % token)
                    break
            if len(blob) > 40 and blob[:40] in text:
                problems.append("the fixture itself is pasted into the prompt")
        out.append(_result("leakage:%s" % t["id"], FAIL if problems else PASS,
                           "; ".join(problems) if problems
                           else "prompt carries no fixture values"))
    return out


def _fixture_tokens(fixture):
    toks = []
    def walk(x):
        if isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
        elif isinstance(x, str) and len(x) > 4:
            toks.append(x)
        elif isinstance(x, (int, float)) and abs(x) > 1:
            toks.append(repr(x))
    walk(fixture)
    return toks


# ── 5. both conditions get the same surface ───────────────────────────
def check_identical_surface(tasks, task_input):
    """The fairness law enforces this at write time; this catches it earlier,
    and catches a task that varies its own input between calls."""
    out = []
    for t in tasks:
        a, b = task_input(t, "/repo"), task_input(t, "/repo")
        same = a == b
        out.append(_result("surface:%s" % t["id"], PASS if same else FAIL,
                           "input is deterministic" if same
                           else "task_input is not stable across calls"))
    return out


# ── 6. no discriminating task is knowingly parked at a ceiling ────────
def check_ceiling_declared(tasks):
    out = []
    for t in tasks:
        ceil = (t.get("risk") or {}).get("ceiling", "")
        baseline = t.get("purpose") == "baseline_competence"
        if ceil == "HIGH_BY_DESIGN" and not baseline:
            out.append(_result("ceiling:%s" % t["id"], FAIL,
                               "declares a deliberate ceiling but is not a "
                               "baseline-competence task"))
        elif ceil == "HIGH" and not baseline:
            out.append(_result("ceiling:%s" % t["id"], FAIL,
                               "carries a known ceiling and would not discriminate"))
        else:
            out.append(_result("ceiling:%s" % t["id"], PASS,
                               "ceiling risk %r, purpose %r" % (ceil, t.get("purpose"))))
    return out


# ── 7. the design can actually reach its own bar ──────────────────────
def check_design_power(tasks, alpha=0.05):
    from core.bench_diagnosis import design_power
    disc = [t for t in tasks if t.get("purpose") != "baseline_competence"]
    d = design_power(len(disc), alpha)
    need = d["min_decided_for_significance"]
    if need is None or not d["reachable"]:
        return [_result("design-power", FAIL,
                        "no number of decided tasks can reach alpha=%.2f with %d tasks"
                        % (alpha, len(disc)))]
    status = PASS if need <= max(1, len(disc) // 2) else WARN
    return [_result("design-power", status,
                    "%d of %d discriminating tasks must decide the SAME way to reach "
                    "p<=%.2f on the sign test (clean sweep p=%.4f). Campaigns 1-2 "
                    "decided 2." % (need, len(disc), alpha, d["p_at_clean_sweep"]))]


# ── 8. OPTION A is locked, and the metric set cannot drift ────────────
# The owner pre-registered OPTION A on 2026-09-17, after preliminary evidence of
# a multi-agent advantage had already been observed. That timing is exactly why
# the rule is frozen: changing a decision rule once you have seen which way the
# data leans is a researcher-degrees-of-freedom problem whether or not the new
# rule is statistically defensible.
OPTION_A = {
    "alpha": 0.05,
    "test": "two-sided exact binomial sign test over per-task QUALITY directions",
    "min_runs_per_cell": 5,
    "min_tasks_with_signal": 3,
    "decided_needed_for_significance": 6,
    "discriminating_tasks": 8,
}

# Fingerprint of the nine dimensions as pre-registered. A campaign whose metric
# definitions hash differently has had its metrics edited after the fact.
PREREGISTERED_METRICS_SHA = "8553b9ce2ddd224192cdc6e4c8f84a3134372c8e30767cb5703006ded37c6407"


def check_option_a_locked(tasks):
    from core import benchmark as B
    from core.bench_diagnosis import design_power
    problems = []
    if B.SIGN_TEST_ALPHA != OPTION_A["alpha"]:
        problems.append("alpha moved: %r (pre-registered %r)"
                        % (B.SIGN_TEST_ALPHA, OPTION_A["alpha"]))
    if B.MIN_RUNS_PER_CELL != OPTION_A["min_runs_per_cell"]:
        problems.append("min_runs_per_cell moved: %r" % B.MIN_RUNS_PER_CELL)
    if B.MIN_TASKS_WITH_SIGNAL != OPTION_A["min_tasks_with_signal"]:
        problems.append("min_tasks_with_signal moved: %r" % B.MIN_TASKS_WITH_SIGNAL)
    disc = [t for t in tasks if t.get("purpose") != "baseline_competence"]
    if len(disc) != OPTION_A["discriminating_tasks"]:
        problems.append("discriminating task count moved: %d (pre-registered %d)"
                        % (len(disc), OPTION_A["discriminating_tasks"]))
    need = design_power(len(disc), OPTION_A["alpha"])["min_decided_for_significance"]
    if need != OPTION_A["decided_needed_for_significance"]:
        problems.append("the derived bar moved: %s of %d decided (pre-registered %d)"
                        % (need, len(disc), OPTION_A["decided_needed_for_significance"]))
    return [_result("option-a-locked", FAIL if problems else PASS,
                    "; ".join(problems) if problems
                    else "alpha 0.05 · sign test over QUALITY · %d of %d decided tasks "
                         "needed · unchanged since pre-registration"
                         % (OPTION_A["decided_needed_for_significance"], len(disc)))]


def check_metrics_frozen():
    from core import bench_metrics as M
    got = M.dimensions_sha()
    ok = got == PREREGISTERED_METRICS_SHA
    return [_result("metrics-frozen", PASS if ok else FAIL,
                    "9 dimensions match the pre-registered fingerprint" if ok
                    else "metric definitions changed since pre-registration: %s != %s"
                         % (got[:16], PREREGISTERED_METRICS_SHA[:16]))]


def check_one_dimension_feeds_the_test():
    """Eight dimensions are reported. Exactly one is tested. Adding a second
    test after seeing the data is the thing Option A exists to prevent."""
    from core import bench_metrics as M
    tested = [d["key"] for d in M.DIMENSIONS if d["feeds_statistical_rule"]]
    ok = tested == ["quality"]
    return [_result("single-tested-dimension", PASS if ok else FAIL,
                    "only QUALITY feeds the sign test; 8 dimensions reported "
                    "separately" if ok
                    else "dimensions feeding the statistical rule: %r" % (tested,))]


def check_every_dimension_is_preregistered():
    from core import bench_metrics as M
    out = []
    for d in M.DIMENSIONS:
        missing = [f for f in ("definition", "metric", "threshold", "pass_fail")
                   if d.get(f) in (None, "")]
        out.append(_result("metric:%s" % d["key"], FAIL if missing else PASS,
                           "missing %s" % ", ".join(missing) if missing
                           else "%s | threshold %s" % (d["metric"][:52], d["threshold"])))
    return out


def check_no_overall_winner_score():
    """A single blended number is how a nine-dimension report becomes a slogan."""
    from core import bench_metrics as M
    problems = []
    for bad in ("overall", "winner", "total_score", "composite", "weighted"):
        if hasattr(M, bad):
            problems.append("bench_metrics defines %r" % bad)
    sample = M.compare(
        {k: None for k in ("quality", "correctness", "reliability", "evidence_quality",
                           "cost", "latency", "human_intervention",
                           "coordination_failure", "damage")},
        {k: None for k in ("quality", "correctness", "reliability", "evidence_quality",
                           "cost", "latency", "human_intervention",
                           "coordination_failure", "damage")})
    if len(sample) != 9:
        problems.append("compare() returned %d verdicts, expected 9" % len(sample))
    return [_result("no-winner-score", FAIL if problems else PASS,
                    "; ".join(problems) if problems
                    else "compare() returns 9 separate verdicts and no blended score")]


def check_damage_dimension_has_a_task(tasks):
    """The DAMAGE dimension is unmeasurable without a task that hands over
    already-correct work. v1 had none, which is why two campaigns could not
    have detected the organisation making things worse.

    Takes the task set as an argument like every other check: a gate that reads
    hidden module state can pass or fail by call order, which is not a property
    you want in the thing that decides whether to spend money."""
    have = [t["id"] for t in tasks if t.get("damage_class")]
    return [_result("damage-measurable", PASS if have else FAIL,
                    "damage-class task(s): %s" % ", ".join(have) if have
                    else "no task hands over a correct artifact, so DAMAGE cannot "
                         "be measured at all")]


# ── run them all ──────────────────────────────────────────────────────
def run_all(tasks, checkers, task_input, alpha=0.05):
    results = []
    results += check_preregistration(tasks)
    results += check_evaluators(tasks, checkers)
    results += check_can_conclude_against(tasks)
    results += check_no_leakage(tasks, task_input)
    results += check_identical_surface(tasks, task_input)
    results += check_ceiling_declared(tasks)
    results += check_design_power(tasks, alpha)
    results += check_option_a_locked(tasks)
    results += check_metrics_frozen()
    results += check_one_dimension_feeds_the_test()
    results += check_every_dimension_is_preregistered()
    results += check_no_overall_winner_score()
    results += check_damage_dimension_has_a_task(tasks)
    failed = [r for r in results if r["status"] == FAIL]
    warned = [r for r in results if r["status"] == WARN]
    return {
        "results": results,
        "passed": len(results) - len(failed) - len(warned),
        "warnings": len(warned),
        "failures": len(failed),
        "verdict": FAIL if failed else (WARN if warned else PASS),
        "claim_permitted": ("The set is SOUND — it measures what it claims. Whether it "
                            "DISCRIMINATES is unknown until a campaign runs."
                            if not failed else
                            "The set is NOT sound. It must not be run and must not be "
                            "called an improvement."),
    }
