"""THE BENCHMARK ENGINE.

It is built to be able to return SINGLE_AGENT_ADVANTAGE_SUPPORTED, and to
return INSUFFICIENT_EVIDENCE far more often than either advantage claim.

Structural guarantees, not promises:
  · both conditions run through the SAME Tool Gateway (no benchmark-only path)
  · a fairness row is written per pairing and a trigger REFUSES an unequal one
  · the evaluator sees a blind token, never the condition label
  · a trigger refuses an evaluation authored by anyone who produced the run
  · every attempt is recorded BEFORE it is judged, so none can be dropped later
  · no overall "winner score" is computed anywhere in this file
"""
import json
import os
import random
import statistics
import subprocess
import time

from . import bench_tasks as BT
from . import runtime, store
from .store import now, sha

FAILURE_CLASSES = ("model", "decomposition", "coordination", "tool", "permission",
                   "reviewer", "evidence", "infrastructure", "evaluator")

# Pre-registered bars. Set BEFORE any run, so they cannot be moved afterwards.
MIN_RUNS_PER_CELL = 5          # per task, per condition
MIN_TASKS_WITH_SIGNAL = 3      # tasks that must agree in direction
SIGN_TEST_ALPHA = 0.05


def git_commit():
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True,
                              cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                              timeout=10).stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def _fixture_sha(task):
    import hashlib
    return hashlib.sha256(
        json.dumps(task["fixture"], sort_keys=True).encode()).hexdigest()


ACTIVE = BT          # the task-set module in force; v1 by default


def use_task_set(name):
    """Select the task set. v1 is the default so campaigns #1-2 stay reproducible.

    Campaign #3's set is v2 and must be asked for by name — nothing silently
    upgrades a run to a task set the owner has not authorised."""
    global ACTIVE
    if name in (None, "", "v1"):
        ACTIVE = BT
    elif name == "v2":
        from core import bench_tasks_v2 as V2
        ACTIVE = V2
    else:
        raise ValueError("unknown task set %r (expected 'v1' or 'v2')" % name)
    return ACTIVE


def active_tasks():
    return getattr(ACTIVE, "TASKS", None) or ACTIVE.TASKS_V2


def register_tasks(con):
    for t in active_tasks():
        con.execute(
            "INSERT OR REPLACE INTO bench_tasks(id,title,description,domain,difficulty,"
            "fixture,fixture_sha,expected,allowed_tools,max_usd,max_seconds,seed,favours,"
            "rationale,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (t["id"], t["title"], t["description"], t["domain"], t["difficulty"],
             json.dumps(t["fixture"], ensure_ascii=False), _fixture_sha(t),
             json.dumps(t.get("expected", {})), json.dumps(t["allowed_tools"]),
             t["max_usd"], t.get("max_seconds", 180), t.get("seed"), t["favours"],
             t.get("rationale") or t.get("relevance", ""), now()))
    return len(active_tasks())


def open_campaign(con, name, provider, model, repeats):
    config = {"repeats": repeats, "min_runs_per_cell": MIN_RUNS_PER_CELL,
              "min_tasks_with_signal": MIN_TASKS_WITH_SIGNAL, "alpha": SIGN_TEST_ALPHA,
              "tasks": [t["id"] for t in BT.TASKS]}
    cid = con.execute(
        "INSERT INTO bench_campaigns(name,git_commit,provider,model,config_sha,repeats,"
        "started_at) VALUES(?,?,?,?,?,?,?)",
        (name, git_commit(), provider, model, sha(config), repeats, now())).lastrowid
    store.event(con, "BENCH_CAMPAIGN_OPENED", actor="OWNER_PLANE", subject="campaign:%d" % cid,
                payload={"provider": provider, "model": model, "repeats": repeats})
    return cid


def task_input(task, repo_root=None):
    """The EXACT text both conditions receive. Built once, hashed, reused.

    R17. A task that declares fixture_via_tool gets the PATH, never the contents.
    Inlining the fixture made T05 ("the answer is only in the file") answerable
    with zero tool calls — and the single agent duly scored 1.0 having made none.
    A tool-use task whose data is in the prompt measures arithmetic, not tool use.
    """
    body = task["description"]
    if task.get("fixture_via_tool"):
        path = BT.fixture_path(task, repo_root) if repo_root else "<fixture path>"
        body += ("\n\nThe data is NOT reproduced here. Read it with your authorized "
                 "read tool at this exact path:\n" + path)
    elif task["fixture"]:
        body += "\n\nFIXTURE:\n" + json.dumps(task["fixture"], ensure_ascii=False, indent=2)
    return body


def assert_fairness(con, campaign_id, task, single_ctx, multi_ctx):
    """Write the pairing. The trigger refuses it if the surfaces differ."""
    con.execute(
        "INSERT OR REPLACE INTO bench_fairness(campaign_id,task_id,single_tools_sha,"
        "multi_tools_sha,single_input_sha,multi_input_sha,single_budget,multi_budget,fair,note)"
        " VALUES(?,?,?,?,?,?,?,?,1,?)",
        (campaign_id, task["id"], single_ctx["tools_sha"], multi_ctx["tools_sha"],
         single_ctx["input_sha"], multi_ctx["input_sha"],
         single_ctx["budget"], multi_ctx["budget"],
         "identical tools, input and budget; multi may use more MODEL CALLS, which is "
         "its cost, not an information advantage"))


def start_run(con, campaign_id, task, condition, repeat_index, order_index, input_sha):
    return con.execute(
        "INSERT INTO bench_runs(campaign_id,task_id,condition,repeat_index,order_index,"
        "input_sha,started_at) VALUES(?,?,?,?,?,?,?)",
        (campaign_id, task["id"], condition, repeat_index, order_index, input_sha,
         now())).lastrowid


def finish_run(con, brid, **kw):
    cols = ("status", "prompt_sha", "output", "output_sha", "artifact_id", "model_runs",
            "tool_calls", "tool_denials", "agents_used", "exec_graph", "tokens_in",
            "tokens_out", "usd", "latency_ms", "retries", "human_interventions",
            "failure_class", "failure_note")
    sets, vals = [], []
    for c in cols:
        if c in kw:
            v = kw[c]
            sets.append("%s=?" % c)
            vals.append(json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v)
    sets.append("finished_at=?")
    vals.append(now())
    vals.append(brid)
    con.execute("UPDATE bench_runs SET %s WHERE id=?" % ", ".join(sets), vals)


# ── blind, objective evaluation ──────────────────────────────────────
def evaluate(con, brid, task, ran, evaluator="EVAL-OBJECTIVE"):
    """Objective where possible. The evaluator is given a token, not a label."""
    r = con.execute("SELECT * FROM bench_runs WHERE id=?", (brid,)).fetchone()
    blind = sha("%d:%s" % (brid, task["id"]))[:16]
    checker = (getattr(ACTIVE, "CHECKERS", None)
               or ACTIVE.CHECKERS_V2)[task["checker"]]
    m = checker(r["output"] or "", ran or {}, task["fixture"])
    con.execute(
        "INSERT OR REPLACE INTO bench_evaluations(bench_run_id,blind_token,method,correctness,"
        "completeness,evidence_quality,unsupported_claims,contradictions,useful_artifacts,"
        "detail,evaluator,evaluated_at) VALUES(?,?,'OBJECTIVE',?,?,?,?,?,?,?,?,?)",
        (brid, blind, m.get("correctness"), m.get("completeness"),
         m.get("evidence_quality"), m.get("unsupported_claims", 0),
         m.get("contradictions", 0),
         1 if (r["artifact_id"] and m.get("correctness", 0) > 0) else 0,
         json.dumps(m.get("detail", {}), ensure_ascii=False), evaluator, now()))
    return m


# ── statistics that can say "not enough" ─────────────────────────────
def _binom_two_sided(k, n, p=0.5):
    """Exact two-sided binomial p-value. No third-party dependency."""
    from math import comb
    if n == 0:
        return 1.0
    probs = [comb(n, i) * (p ** i) * ((1 - p) ** (n - i)) for i in range(n + 1)]
    obs = probs[k]
    return min(1.0, sum(pr for pr in probs if pr <= obs + 1e-12))


def analyse(con, campaign_id):
    """Per-dimension comparison. No single winner score is produced."""
    tasks = {t["id"]: t for t in BT.TASKS}
    per_task, warnings = [], []
    wins_multi = wins_single = ties = 0

    for tid in tasks:
        cell = {}
        for cond in ("SINGLE", "MULTI"):
            rows = con.execute(
                "SELECT r.*, e.correctness, e.completeness, e.unsupported_claims, "
                "e.contradictions, e.useful_artifacts FROM bench_runs r "
                "LEFT JOIN bench_evaluations e ON e.bench_run_id=r.id "
                "WHERE r.campaign_id=? AND r.task_id=? AND r.condition=?",
                (campaign_id, tid, cond)).fetchall()
            done = [r for r in rows if r["status"] == "COMPLETE"]
            cell[cond] = {
                "attempts": len(rows),
                "completed": len(done),
                "failure_rate": round(1 - len(done) / len(rows), 4) if rows else None,
                "correctness": round(statistics.fmean(
                    [r["correctness"] or 0 for r in done]), 4) if done else None,
                "completeness": round(statistics.fmean(
                    [r["completeness"] or 0 for r in done]), 4) if done else None,
                "unsupported_claims": sum(r["unsupported_claims"] or 0 for r in done),
                "contradictions": sum(r["contradictions"] or 0 for r in done),
                "useful_artifacts": sum(r["useful_artifacts"] or 0 for r in done),
                "usd": round(sum(r["usd"] or 0 for r in rows), 6),
                "latency_ms": round(statistics.fmean(
                    [r["latency_ms"] or 0 for r in rows]), 1) if rows else None,
                "tokens": sum((r["tokens_in"] or 0) + (r["tokens_out"] or 0) for r in rows),
                "retries": sum(r["retries"] or 0 for r in rows),
                "human_interventions": sum(r["human_interventions"] or 0 for r in rows),
                "tool_calls": sum(r["tool_calls"] or 0 for r in rows),
                "tool_denials": sum(r["tool_denials"] or 0 for r in rows),
                "failure_classes": [r["failure_class"] for r in rows if r["failure_class"]],
            }
            for k in ("usd", "correctness"):
                pass
            cell[cond]["quality_per_usd"] = (
                round(cell[cond]["correctness"] / cell[cond]["usd"], 2)
                if cell[cond]["correctness"] is not None and cell[cond]["usd"] > 0 else None)

        under = [c for c in ("SINGLE", "MULTI")
                 if cell[c]["attempts"] < MIN_RUNS_PER_CELL]
        if under:
            warnings.append("%s: %s under %d runs" % (tid, ",".join(under),
                                                      MIN_RUNS_PER_CELL))
        s, m = cell["SINGLE"]["correctness"], cell["MULTI"]["correctness"]
        direction = None
        if s is not None and m is not None:
            if m > s:
                direction, wins_multi = "MULTI", wins_multi + 1
            elif s > m:
                direction, wins_single = "SINGLE", wins_single + 1
            else:
                direction, ties = "TIE", ties + 1
        per_task.append({"task_id": tid, "favours_by_design": tasks[tid]["favours"],
                         "difficulty": tasks[tid]["difficulty"],
                         "direction": direction, "SINGLE": cell["SINGLE"],
                         "MULTI": cell["MULTI"]})

    decided = wins_multi + wins_single
    p = _binom_two_sided(max(wins_multi, wins_single), decided) if decided else 1.0
    enough = (not warnings) and decided >= MIN_TASKS_WITH_SIGNAL

    if not enough:
        conclusion = "INSUFFICIENT_EVIDENCE"
        why = ("%d task(s) decided, %d needed; %s"
               % (decided, MIN_TASKS_WITH_SIGNAL,
                  "; ".join(warnings) if warnings else "no per-cell shortfall"))
    elif p > SIGN_TEST_ALPHA:
        conclusion = "NO_MEANINGFUL_DIFFERENCE_DETECTED"
        why = ("multi led on %d task(s), single on %d; two-sided sign test p=%.3f, "
               "above the pre-registered %.2f" % (wins_multi, wins_single, p, SIGN_TEST_ALPHA))
    elif wins_multi > wins_single:
        conclusion = "MULTI_AGENT_ADVANTAGE_SUPPORTED"
        why = "multi led on %d of %d decided tasks, p=%.3f" % (wins_multi, decided, p)
    else:
        conclusion = "SINGLE_AGENT_ADVANTAGE_SUPPORTED"
        why = "single led on %d of %d decided tasks, p=%.3f" % (wins_single, decided, p)

    return {"campaign_id": campaign_id, "conclusion": conclusion, "why": why,
            "tasks_decided": decided, "multi_led": wins_multi, "single_led": wins_single,
            "ties": ties, "sign_test_p": round(p, 4), "warnings": warnings,
            "pre_registered": {"min_runs_per_cell": MIN_RUNS_PER_CELL,
                               "min_tasks_with_signal": MIN_TASKS_WITH_SIGNAL,
                               "alpha": SIGN_TEST_ALPHA},
            "per_task": per_task,
            "note": "dimensions are reported separately; no overall winner score exists"}


def close_campaign(con, campaign_id, result):
    # A campaign run on a mock provider proves the HARNESS, never the question.
    # This is structural: it cannot be overridden by a caller.
    row = con.execute("SELECT provider FROM bench_campaigns WHERE id=?",
                      (campaign_id,)).fetchone()
    if row and row["provider"] in ("mock", "none", "compromised"):
        result = dict(result)
        result["conclusion"] = "INSUFFICIENT_EVIDENCE"
        result["why"] = ("provider was %r: this run exercises the harness and proves "
                         "nothing about single vs multi agent" % row["provider"])
        result["harness_only"] = True
    con.execute("UPDATE bench_campaigns SET finished_at=?, conclusion=?, conclusion_why=? "
                "WHERE id=?", (now(), result["conclusion"], result["why"], campaign_id))
    store.event(con, "BENCH_CAMPAIGN_CLOSED", actor="OWNER_PLANE",
                subject="campaign:%d" % campaign_id,
                payload={"conclusion": result["conclusion"]})
    store.signal(con, "HIGH", "Benchmark campaign #%d: %s"
                 % (campaign_id, result["conclusion"]), result["why"])
