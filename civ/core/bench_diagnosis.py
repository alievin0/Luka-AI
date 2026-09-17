"""TASK VALIDITY — diagnosed from evidence, separately from who won.

A task can be INVALID while the organisation is winning on it, and VALID while
the organisation is losing. Those are different questions and this module answers
only the first. Nothing here reads `multi_led`, and nothing here may be tuned by
looking at which condition a verdict helps.

Every threshold below is declared BEFORE the diagnosis runs and applies
identically to both conditions. Two campaigns of frozen evidence are the input;
no model is called.
"""
import json
import os
import statistics

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HISTORY = os.path.join(HERE, "bench_history", "campaigns-1-2.json")

# ── pre-registered thresholds ─────────────────────────────────────────
CEILING_AT = 0.95      # both conditions at or above this -> cannot discriminate
FLOOR_AT = 0.05        # both conditions at or below this -> cannot discriminate
SPREAD_AT = 0.50       # a condition whose repeats span this much is unstable
MEANINGFUL_DELTA = 0.10   # a difference below this is not worth a campaign
REPLICATION_MIN = 2    # campaigns a direction must survive to count as replicated

# Verdicts. Deliberately not a score: a task is usable, unusable, or fixable.
VALID = "VALID"
NEEDS_REVISION = "NEEDS_REVISION"
INVALID = "INVALID"


def load_history(path=HISTORY):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)["campaigns"]


def _observations(campaigns, task_id):
    out = []
    for c in campaigns:
        row = c["per_task"].get(task_id)
        if row:
            out.append((c["campaign_id"], row))
    return out


def _direction(s, m):
    if abs(m - s) < 1e-9:
        return "TIE"
    return "MULTI" if m > s else "SINGLE"


def ceiling_risk(obs):
    """Both conditions at the top in every campaign observed."""
    if not obs:
        return "UNKNOWN", "never run"
    hits = [cid for cid, r in obs if r["s"] >= CEILING_AT and r["m"] >= CEILING_AT]
    if len(hits) == len(obs):
        return "HIGH", "both conditions >= %.2f in campaigns %s" % (CEILING_AT, hits)
    if hits:
        return "MEDIUM", "both conditions at ceiling in campaigns %s" % hits
    return "LOW", "at least one condition below %.2f in every campaign" % CEILING_AT


def floor_risk(obs):
    if not obs:
        return "UNKNOWN", "never run"
    hits = [cid for cid, r in obs if r["s"] <= FLOOR_AT and r["m"] <= FLOOR_AT]
    if len(hits) == len(obs):
        return "HIGH", "both conditions <= %.2f in campaigns %s" % (FLOOR_AT, hits)
    if hits:
        return "MEDIUM", "both conditions at floor in campaigns %s" % hits
    return "LOW", "at least one condition above %.2f in every campaign" % FLOOR_AT


def evaluator_defect(obs):
    """A scorer that contradicts itself is broken regardless of the scores.

    The signature that exposed T06: completeness says the answer was right while
    correctness says it was wrong, in every cell. No model produces that; only a
    checker can."""
    for cid, r in obs:
        sc, mc = r.get("s_completeness"), r.get("m_completeness")
        if sc is None or mc is None:
            continue
        if sc >= CEILING_AT and r["s"] <= FLOOR_AT and mc >= CEILING_AT and r["m"] <= FLOOR_AT:
            return "HIGH", ("campaign %d: completeness %.2f/%.2f but correctness %.2f/%.2f "
                            "— the checker contradicts itself" % (cid, sc, mc, r["s"], r["m"]))
    return "LOW", "no self-contradiction in the recorded evaluations"


def leakage_risk(task, obs):
    """A task that names a tool must not be answerable without one.

    The signature that exposed T05: full marks with zero tool calls."""
    needs_tool = bool(task.get("fixture_via_tool")) or "READ_REPO" in task.get("allowed_tools", [])
    if not needs_tool:
        return "N/A", "task declares no information-bearing tool"
    for cid, r in obs:
        for cond, score, calls in (("single", r["s"], r["s_tc"]), ("multi", r["m"], r["m_tc"])):
            if score >= CEILING_AT and calls == 0:
                return "HIGH", ("campaign %d: %s scored %.2f with zero tool calls — the "
                                "answer was reachable without the tool" % (cid, cond, score))
    return "LOW", "no condition scored full marks without calling a tool"


def stochasticity_risk(obs):
    """Repeats that swing between total success and total failure.

    SYMMETRY MATTERS. If both conditions swing, the task is noise and cannot
    discriminate. If only ONE swings while the other holds, that asymmetry IS
    the measurement — reliability is a real property of an architecture, and a
    task that exposes it is working, not broken. The rule is direction-blind:
    an unstable MULTI against a steady SINGLE reads as evidence for the single
    agent, and is reported exactly the same way."""
    spreads = {"single": 0.0, "multi": 0.0}
    detail = []
    for cid, r in obs:
        for cond, key in (("single", "s_runs"), ("multi", "m_runs")):
            runs = r.get(key) or []
            if len(runs) < 2:
                continue
            spread = max(runs) - min(runs)
            spreads[cond] = max(spreads[cond], spread)
            if spread > 0:
                detail.append("campaign %d %s spans %.2f (%s)" % (
                    cid, cond, spread, ",".join("%.1f" % x for x in runs)))
    hi = {c for c, v in spreads.items() if v >= SPREAD_AT}
    why = "; ".join(detail) if detail else "every repeat scored identically"
    if len(hi) == 2:
        return "HIGH", "both conditions unstable — this is noise, not a signal: " + why
    if len(hi) == 1:
        steady = "multi" if "single" in hi else "single"
        return "ASYMMETRIC", ("%s is unstable while %s holds — the task is measuring "
                              "RELIABILITY: %s" % (hi.pop(), steady, why))
    if any(v > 0 for v in spreads.values()):
        return "MEDIUM", why
    return "LOW", "every repeat scored identically in every campaign"


def discriminative_power(obs):
    """Did a real, repeated difference appear — in EITHER direction?"""
    if not obs:
        return "UNKNOWN", "never run", None
    deltas = [(cid, r["m"] - r["s"]) for cid, r in obs]
    dirs = [_direction(r["s"], r["m"]) for _, r in obs]
    replicated = len(set(dirs)) == 1 and dirs[0] != "TIE" and len(dirs) >= REPLICATION_MIN
    biggest = max(abs(d) for _, d in deltas)
    if replicated and biggest >= MEANINGFUL_DELTA:
        return "DEMONSTRATED", "%s in all %d campaigns, max |delta| %.2f" % (
            dirs[0], len(dirs), biggest), dirs[0]
    if replicated:
        return "WEAK", "%s in all campaigns but max |delta| only %.2f" % (dirs[0], biggest), dirs[0]
    if all(d == "TIE" for d in dirs):
        return "NONE", "tied in every campaign", None
    return "UNSTABLE", "direction changed between campaigns: %s" % dirs, None


def reliability(obs):
    """Catastrophic-failure rate: how often a condition scored zero outright.

    Mean correctness hides this. A condition that is perfect four times and
    absent once reads as 0.80, which looks like a quality gap and is not."""
    tally = {"single": [0, 0], "multi": [0, 0]}
    for _, r in obs:
        for cond, key in (("single", "s_runs"), ("multi", "m_runs")):
            for x in r.get(key) or []:
                tally[cond][1] += 1
                if x <= FLOOR_AT:
                    tally[cond][0] += 1
    return tally


def diagnose(task, campaigns):
    obs = _observations(campaigns, task["id"])
    ceil_l, ceil_w = ceiling_risk(obs)
    floor_l, floor_w = floor_risk(obs)
    ev_l, ev_w = evaluator_defect(obs)
    leak_l, leak_w = leakage_risk(task, obs)
    stoch_l, stoch_w = stochasticity_risk(obs)
    disc_l, disc_w, disc_dir = discriminative_power(obs)

    faults, verdict = [], VALID
    if ev_l == "HIGH":
        faults.append("evaluator is self-contradicting: " + ev_w)
        verdict = INVALID
    if leak_l == "HIGH":
        faults.append("information leakage: " + leak_w)
        verdict = INVALID
    if floor_l == "HIGH" and ev_l != "HIGH":
        faults.append("floor effect: " + floor_w)
        verdict = INVALID
    if ceil_l == "HIGH" and verdict == VALID:
        if task.get("purpose") == "baseline_competence":
            faults.append("at ceiling, which is this task's declared job: " + ceil_w)
        else:
            faults.append("ceiling effect: " + ceil_w)
            verdict = NEEDS_REVISION
    if stoch_l == "HIGH" and verdict == VALID:
        faults.append("unstable in BOTH conditions: " + stoch_w)
        verdict = NEEDS_REVISION

    return {
        "task_id": task["id"],
        "purpose": task.get("purpose", "discrimination"),
        "verdict": verdict,
        "faults": faults,
        "risks": {
            "ceiling": [ceil_l, ceil_w], "floor": [floor_l, floor_w],
            "evaluator": [ev_l, ev_w], "leakage": [leak_l, leak_w],
            "stochasticity": [stoch_l, stoch_w],
        },
        "discriminative_power": [disc_l, disc_w],
        "observed_direction": disc_dir,
        "reliability": reliability(obs),
        "campaigns_observed": [cid for cid, _ in obs],
    }


def diagnose_all(tasks, campaigns=None):
    campaigns = campaigns if campaigns is not None else load_history()
    return [diagnose(t, campaigns) for t in tasks]


# ── statistical power of the design itself, not of any task ───────────
def _binom_two_sided(k, n, p=0.5):
    from math import comb
    if n == 0:
        return 1.0
    probs = [comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(n + 1)]
    obs = probs[k]
    return min(1.0, sum(pr for pr in probs if pr <= obs + 1e-12))


def design_power(n_tasks, alpha=0.05):
    """The smallest number of decided tasks that could ever reach significance.

    This asks what the DESIGN can do, not what the organisation did. If the
    answer exceeds the number of tasks that can realistically decide, the
    benchmark cannot reach a verdict however it is run — a property of the
    instrument, to be fixed before a campaign, never after seeing one."""
    for decided in range(1, n_tasks + 1):
        if _binom_two_sided(decided, decided) <= alpha:
            return {"min_decided_for_significance": decided,
                    "n_tasks": n_tasks,
                    "reachable": decided <= n_tasks,
                    "p_at_clean_sweep": _binom_two_sided(decided, decided)}
    return {"min_decided_for_significance": None, "n_tasks": n_tasks,
            "reachable": False,
            "p_at_clean_sweep": _binom_two_sided(n_tasks, n_tasks)}
