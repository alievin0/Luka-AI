"""THE NINE REPORTED DIMENSIONS — defined before Campaign #3 exists.

Owner directive, 2026-09-17. Every metric, threshold and PASS/FAIL rule here is
fixed BEFORE any Campaign #3 data exists. The set is hashed; the integrity gate
refuses a campaign whose metric definitions have drifted from the hash recorded
at pre-registration. That is what stops a favourable metric being selected after
the fact.

Two rules hold across every dimension:

  1. NO OVERALL WINNER SCORE. Nine dimensions are reported side by side. They
     are never averaged, weighted or collapsed. A system can be better on
     quality and worse on cost, and the honest report says exactly that.

  2. ONLY `quality` FEEDS THE STATISTICAL RULE. Option A, unchanged: a
     two-sided sign test over per-task QUALITY directions, alpha = 0.05. The
     other eight dimensions are reported and never tested — adding tests after
     seeing preliminary evidence is the researcher-degrees-of-freedom problem
     the owner ruled out.

Every function is direction-blind: it takes (single, multi) and its rule is
symmetric. A dimension that favours the single agent is computed, reported and
worded exactly as one that favours the organisation.
"""
import hashlib
import json

SINGLE, MULTI, NEITHER = "SINGLE", "MULTI", "NEITHER"

# Failure bands, pre-registered. Applied identically to both conditions.
CATASTROPHIC_AT = 0.05    # a total miss, or a run that never completed
MAJOR_AT = 0.50           # substantially wrong but not absent
FAILURE_FREE_ABOVE = 0.50 # a run with neither a catastrophic nor a major failure


def _favours(single, multi, threshold, higher_is_better=True):
    """Symmetric. Returns which condition a dimension favours, or NEITHER."""
    if single is None or multi is None:
        return NEITHER
    delta = multi - single
    if abs(delta) < threshold:
        return NEITHER
    if higher_is_better:
        return MULTI if delta > 0 else SINGLE
    return SINGLE if delta > 0 else MULTI


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


# ── 1. QUALITY — the graded rubric, and the ONLY input to the sign test ──
def quality(runs):
    """Mean graded score from the INDEPENDENT blind evaluator.

    The evaluator sees a blind token, never a condition label, and LAW 10
    refuses an evaluation authored by an agent that produced the run. Partial
    credit is kept: this is the graded dimension, distinct from `correctness`
    below, which is strict."""
    return _mean([r["correctness"] for r in runs])


QUALITY_THRESHOLD = 0.10      # below this a difference is not reported as one


# ── 2. CORRECTNESS — strict, binary, no partial credit ────────────────
def correctness(runs):
    """Proportion of runs that FULLY satisfied the task.

    A rubric mean of 0.80 can mean 'every run slightly imperfect' or 'four
    perfect and one absent'. Those are different systems. This dimension
    answers only: how often was the job actually done?"""
    if not runs:
        return None
    return sum(1 for r in runs if r["correctness"] >= 0.999) / len(runs)


CORRECTNESS_THRESHOLD = 0.20   # one run in five, at the pre-registered 5 repeats


# ── 3. RELIABILITY — per-run failures, never reduced to a mean ────────
def reliability(runs):
    """Per the directive: report per-run catastrophic and major failures, and
    the failure-free proportion. Reliability is NOT mean quality.

    Campaigns #1-2 showed why: T04's single agent read as 0.80 mean, which looks
    like slightly worse work. It was four perfect runs and one total absence."""
    if not runs:
        return None
    n = len(runs)
    catastrophic = [r for r in runs
                    if r["correctness"] <= CATASTROPHIC_AT or not r.get("completed", True)]
    major = [r for r in runs
             if CATASTROPHIC_AT < r["correctness"] <= MAJOR_AT and r.get("completed", True)]
    failure_free = [r for r in runs
                    if r["correctness"] > FAILURE_FREE_ABOVE and r.get("completed", True)]
    return {
        "attempts": n,
        "catastrophic": len(catastrophic),
        "catastrophic_rate": len(catastrophic) / n,
        "major": len(major),
        "major_rate": len(major) / n,
        "failure_free": len(failure_free),
        "failure_free_proportion": len(failure_free) / n,
        "worst_run": min(r["correctness"] for r in runs),
    }


RELIABILITY_THRESHOLD = 0.20   # difference in failure-free proportion


# ── 4. EVIDENCE QUALITY ───────────────────────────────────────────────
def evidence_quality(runs):
    """Unsupported claims per run, and the graded evidence score where the
    checker defines one. Lower unsupported claims is better."""
    if not runs:
        return None
    return {
        "unsupported_claims_per_run": _mean([r.get("unsupported_claims", 0) for r in runs]),
        "contradictions_per_run": _mean([r.get("contradictions", 0) for r in runs]),
        "graded": _mean([r.get("evidence_quality") for r in runs]),
        "runs_with_unsupported_claims": sum(
            1 for r in runs if (r.get("unsupported_claims") or 0) > 0),
    }


EVIDENCE_THRESHOLD = 0.20      # claims per run


# ── 5. COST — total, and per SUCCESSFUL VERIFIED result ───────────────
def cost(runs):
    """Per the directive: a cheaper system is not better unless it actually
    produced verified successes.

    `per_verified_success` is None when a condition produced none. None is not
    zero and must never be read as 'free' — a system that produces nothing
    usable has no cost-per-result, however little it spent."""
    if not runs:
        return None
    total = sum(r.get("usd", 0.0) for r in runs)
    verified = [r for r in runs
                if r["correctness"] >= 0.999 and r.get("verified", False)]
    return {
        "total_usd": round(total, 6),
        "usd_per_run": round(total / len(runs), 6),
        "verified_successes": len(verified),
        "per_verified_success": (round(total / len(verified), 6) if verified else None),
        "tokens": sum(r.get("tokens", 0) for r in runs),
    }


COST_RATIO_THRESHOLD = 1.25    # below a 25% difference, cost is reported as comparable


def cost_favours(single, multi):
    """Cheaper wins ONLY if it also produced verified successes."""
    if not single or not multi:
        return NEITHER
    s, m = single.get("per_verified_success"), multi.get("per_verified_success")
    if s is None and m is None:
        return NEITHER                      # neither produced a verified success
    if s is None:
        return MULTI                        # only multi produced anything usable
    if m is None:
        return SINGLE
    ratio = max(s, m) / min(s, m) if min(s, m) > 0 else 1.0
    if ratio < COST_RATIO_THRESHOLD:
        return NEITHER
    return SINGLE if s < m else MULTI


# ── 6. LATENCY ────────────────────────────────────────────────────────
def latency(runs):
    if not runs:
        return None
    vals = sorted(r.get("latency_ms", 0) for r in runs)
    return {"mean_ms": round(_mean(vals) or 0.0, 1),
            "worst_ms": vals[-1] if vals else 0,
            "median_ms": vals[len(vals) // 2] if vals else 0}


LATENCY_RATIO_THRESHOLD = 1.25


def latency_favours(single, multi):
    if not single or not multi:
        return NEITHER
    s, m = single["mean_ms"], multi["mean_ms"]
    if min(s, m) <= 0:
        return NEITHER
    if max(s, m) / min(s, m) < LATENCY_RATIO_THRESHOLD:
        return NEITHER
    return SINGLE if s < m else MULTI


# ── 7. HUMAN INTERVENTION ─────────────────────────────────────────────
def human_intervention(runs):
    """A benchmark run is autonomous by construction. Any intervention is a
    finding about the architecture, not a normal cost of doing business."""
    if not runs:
        return None
    n = sum(r.get("human_interventions", 0) for r in runs)
    return {"total": n, "per_run": n / len(runs),
            "runs_requiring_a_human": sum(
                1 for r in runs if (r.get("human_interventions") or 0) > 0)}


INTERVENTION_THRESHOLD = 0.10


# ── 8. COORDINATION FAILURE ───────────────────────────────────────────
def coordination_failure(runs, task=None):
    """Work lost in the machinery rather than in the thinking.

    Computed identically for both conditions. A single agent can retry, be
    denied a tool, or run out of budget too — this is not a multi-only tax and
    is not written as one. The one multi-shaped signature, a declared tool going
    uncalled on a task that needs it, is checked the same way for both."""
    if not runs:
        return None
    needs_tool = bool(task and task.get("fixture_via_tool"))
    lost_tool = sum(1 for r in runs
                    if needs_tool and (r.get("tool_calls") or 0) == 0
                    and r["correctness"] < 0.999)
    incomplete = sum(1 for r in runs if not r.get("completed", True))
    return {
        "retries": sum(r.get("retries", 0) for r in runs),
        "tool_denials": sum(r.get("tool_denials", 0) for r in runs),
        "budget_stops": sum(1 for r in runs if r.get("stopped_on_budget")),
        "incomplete_runs": incomplete,
        "tool_never_called_on_a_tool_task": lost_tool,
        "total_events": sum(r.get("retries", 0) for r in runs)
        + sum(r.get("tool_denials", 0) for r in runs) + incomplete + lost_tool,
        "per_run": (sum(r.get("retries", 0) for r in runs)
                    + sum(r.get("tool_denials", 0) for r in runs)
                    + incomplete + lost_tool) / len(runs),
    }


COORDINATION_THRESHOLD = 0.20


# ── 9. DAMAGE / REGRESSION ────────────────────────────────────────────
def damage(runs, task=None):
    """Did a condition modify an otherwise-correct artifact and break it?

    Measured by objective behavioural tests: V2-T08 hands over correct code and
    scores only whether every original behaviour still holds. Leaving it alone
    scores 1.00, so any shortfall is damage the condition inflicted.

    Reported for every task, but only a damage-class task can produce a non-zero
    reading — elsewhere there is no pre-existing correct artifact to break."""
    if not runs:
        return None
    is_damage_task = bool(task and task.get("damage_class"))
    damaged = [r for r in runs if is_damage_task and r["correctness"] < 0.999]
    return {
        "applicable": is_damage_task,
        "runs_that_damaged_a_working_artifact": len(damaged),
        "damage_rate": (len(damaged) / len(runs)) if is_damage_task else None,
        "behaviours_preserved_mean": (_mean([r["correctness"] for r in runs])
                                      if is_damage_task else None),
    }


DAMAGE_THRESHOLD = 0.20


# ── the registry: what is reported, how, and what counts as a difference ──
DIMENSIONS = [
    dict(key="quality", label="QUALITY",
         definition="Mean graded score from the independent blind evaluator, with "
                    "partial credit retained.",
         metric="mean(correctness) over all runs in the cell",
         threshold=QUALITY_THRESHOLD, higher_is_better=True,
         feeds_statistical_rule=True,
         pass_fail="A cell is only reportable with >= 5 completed runs. A task DECIDES "
                   "for a condition when the means differ by >= 0.10; otherwise TIE. "
                   "This and only this feeds the sign test."),
    dict(key="correctness", label="CORRECTNESS",
         definition="Strict proportion of runs that fully satisfied the task. No "
                    "partial credit.",
         metric="count(correctness >= 0.999) / attempts",
         threshold=CORRECTNESS_THRESHOLD, higher_is_better=True,
         feeds_statistical_rule=False,
         pass_fail="Reported difference when >= 0.20 (one run in five at 5 repeats). "
                   "Never combined with quality."),
    dict(key="reliability", label="RELIABILITY",
         definition="Per-run catastrophic and major failures, plus the failure-free "
                    "proportion. Explicitly NOT mean quality.",
         metric="catastrophic (<= 0.05 or incomplete), major (<= 0.50), "
                "failure_free (> 0.50), worst_run",
         threshold=RELIABILITY_THRESHOLD, higher_is_better=True,
         feeds_statistical_rule=False,
         pass_fail="Reported difference when failure-free proportions differ by "
                   ">= 0.20. Catastrophic counts are ALWAYS printed raw, per run, "
                   "whatever the difference."),
    dict(key="evidence_quality", label="EVIDENCE QUALITY",
         definition="Unsupported claims and contradictions per run; graded evidence "
                    "score where a checker defines one.",
         metric="mean(unsupported_claims), mean(contradictions), mean(evidence_quality)",
         threshold=EVIDENCE_THRESHOLD, higher_is_better=False,
         feeds_statistical_rule=False,
         pass_fail="Reported difference when unsupported claims per run differ by "
                   ">= 0.20."),
    dict(key="cost", label="COST",
         definition="Total spend, and spend per SUCCESSFUL VERIFIED result.",
         metric="total_usd; total_usd / count(correct AND verified)",
         threshold=COST_RATIO_THRESHOLD, higher_is_better=False,
         feeds_statistical_rule=False,
         pass_fail="Cheaper wins ONLY if the condition produced verified successes. "
                   "A condition with none has per_verified_success = None, which is "
                   "NOT zero and must not be read as free. Difference reported at a "
                   "ratio >= 1.25."),
    dict(key="latency", label="LATENCY",
         definition="Wall-clock per run.",
         metric="mean_ms, median_ms, worst_ms",
         threshold=LATENCY_RATIO_THRESHOLD, higher_is_better=False,
         feeds_statistical_rule=False,
         pass_fail="Difference reported at a mean ratio >= 1.25."),
    dict(key="human_intervention", label="HUMAN INTERVENTION",
         definition="Runs that could not proceed without a person.",
         metric="total interventions; runs_requiring_a_human / attempts",
         threshold=INTERVENTION_THRESHOLD, higher_is_better=False,
         feeds_statistical_rule=False,
         pass_fail="Expected 0 for both conditions; a benchmark run is autonomous by "
                   "construction. ANY non-zero value is reported as a finding, not "
                   "averaged away."),
    dict(key="coordination_failure", label="COORDINATION FAILURE",
         definition="Work lost in the machinery rather than the thinking: retries, "
                    "tool denials, budget stops, incomplete runs, and a declared tool "
                    "going uncalled on a task that requires it.",
         metric="total_events / attempts",
         threshold=COORDINATION_THRESHOLD, higher_is_better=False,
         feeds_statistical_rule=False,
         pass_fail="Computed identically for both conditions — a single agent can "
                   "retry and be denied too. Difference reported at >= 0.20 per run."),
    dict(key="damage", label="DAMAGE / REGRESSION",
         definition="Whether a condition modified an otherwise-correct artifact and "
                    "broke it, by objective behavioural test.",
         metric="runs that broke >= 1 original behaviour / attempts, on damage-class "
                "tasks (V2-T08)",
         threshold=DAMAGE_THRESHOLD, higher_is_better=False,
         feeds_statistical_rule=False,
         pass_fail="PASS is a damage rate of 0.00 — leaving correct work alone. Any "
                   "non-zero rate is reported as a cost of that architecture, "
                   "whichever condition incurs it."),
]


def dimensions_sha():
    """The pre-registration fingerprint.

    Covers every key, metric, threshold and PASS/FAIL rule. The integrity gate
    compares a campaign's hash to the one recorded here; a drifted definition
    means metrics moved after the fact, and the campaign is refused."""
    payload = json.dumps(
        [{k: d[k] for k in ("key", "label", "definition", "metric", "threshold",
                            "higher_is_better", "feeds_statistical_rule", "pass_fail")}
         for d in DIMENSIONS],
        sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def compute_all(runs, task=None):
    """Every dimension for one condition's runs on one task. Raw, nothing dropped."""
    return {
        "attempts": len(runs),
        "quality": quality(runs),
        "correctness": correctness(runs),
        "reliability": reliability(runs),
        "evidence_quality": evidence_quality(runs),
        "cost": cost(runs),
        "latency": latency(runs),
        "human_intervention": human_intervention(runs),
        "coordination_failure": coordination_failure(runs, task),
        "damage": damage(runs, task),
        "raw_scores": [r["correctness"] for r in runs],       # never summarised away
    }


def compare(single_m, multi_m):
    """Which condition each dimension favours. Nine answers, never one."""
    return {
        "quality": _favours(single_m["quality"], multi_m["quality"], QUALITY_THRESHOLD),
        "correctness": _favours(single_m["correctness"], multi_m["correctness"],
                                CORRECTNESS_THRESHOLD),
        "reliability": _favours(
            (single_m["reliability"] or {}).get("failure_free_proportion"),
            (multi_m["reliability"] or {}).get("failure_free_proportion"),
            RELIABILITY_THRESHOLD),
        "evidence_quality": _favours(
            (single_m["evidence_quality"] or {}).get("unsupported_claims_per_run"),
            (multi_m["evidence_quality"] or {}).get("unsupported_claims_per_run"),
            EVIDENCE_THRESHOLD, higher_is_better=False),
        "cost": cost_favours(single_m["cost"], multi_m["cost"]),
        "latency": latency_favours(single_m["latency"], multi_m["latency"]),
        "human_intervention": _favours(
            (single_m["human_intervention"] or {}).get("per_run"),
            (multi_m["human_intervention"] or {}).get("per_run"),
            INTERVENTION_THRESHOLD, higher_is_better=False),
        "coordination_failure": _favours(
            (single_m["coordination_failure"] or {}).get("per_run"),
            (multi_m["coordination_failure"] or {}).get("per_run"),
            COORDINATION_THRESHOLD, higher_is_better=False),
        "damage": _favours(
            (single_m["damage"] or {}).get("damage_rate"),
            (multi_m["damage"] or {}).get("damage_rate"),
            DAMAGE_THRESHOLD, higher_is_better=False),
    }
