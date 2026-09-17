#!/usr/bin/env python3
"""RUN THE BENCHMARK.  One strong agent vs the organisation, same task.

    export ANTHROPIC_API_KEY=sk-ant-...
    python3 bench_run.py --repeats 1          # smoke: is the harness fair?
    python3 bench_run.py --repeats 5          # the pre-registered bar

Fairness by construction:
  · production tools = the task's allowed_tools, IDENTICAL for both conditions
  · VERIFICATION happens outside both conditions, by the same evaluator, so no
    condition gets execution as a hidden extra capability
  · both go through the same Tool Gateway — there is no benchmark-only path
  · order is randomised; every attempt is recorded before it is judged
"""
import argparse
import json
import os
import random
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import bench_tasks as BT      # noqa: E402
from core import benchmark as B         # noqa: E402
from core import contract as K          # noqa: E402
from core import provider as P          # noqa: E402
from core import runtime, store         # noqa: E402
from core.store import now, sha         # noqa: E402
import slice as vslice                  # noqa: E402

DB = os.path.join(HERE, "civ-bench.db")
BAR = "=" * 76

SOLO = "AGT-BENCH-SOLO"
EVALUATOR = "AGT-BENCH-EVAL"

SYS_SOLO = ("You are one strong engineer working alone. Produce the complete, correct "
            "answer in a single pass. When the task needs a file, reply ONLY with "
            '{"tool":"WRITE_ARTIFACT","args":{"path":"<name>.py","body":"<content>"}}. '
            'Otherwise reply ONLY with {"answer":"<text>"}. No prose, no fences.')
SYS_BUILD = ("You are a Builder in an audited organisation. Produce a first attempt. "
             'Reply ONLY with {"tool":"WRITE_ARTIFACT","args":{"path":"<name>.py",'
             '"body":"<content>"}} or {"answer":"<text>"}. No prose, no fences.')
SYS_CRITIC = ("You are an independent Critic. You did not write this. Find what is wrong "
              "or missing against the stated requirements. If the requirements contradict "
              "each other, say so explicitly. "
              'Reply ONLY with {"answer":"<your critique>"}.')
SYS_REVISE = ("You are the Builder. Apply the critique. "
              'Reply ONLY with {"tool":"WRITE_ARTIFACT","args":{"path":"<name>.py",'
              '"body":"<content>"}} or {"answer":"<text>"}. No prose, no fences.')


def bench_crew(con, task):
    """Register the two benchmark principals. The SOLO agent gets exactly the
    task's tools — no more than the organisation, no less."""
    tools = list(task["allowed_tools"])
    perms = []
    for cap in tools:
        if cap == "WRITE_ARTIFACT":
            perms.append({"cap": cap, "scope": {"path_prefix": vslice.ARTIFACT_DIR,
                                                "max_bytes": 200000},
                          "rate": {"per_lease": 8}})
        elif cap == "READ_REPO":
            perms.append({"cap": cap, "scope": {"path_prefix": vslice.REPO_ROOT},
                          "rate": {"per_lease": 20}})
    for aid, name, role, tier, extra in (
            (SOLO, "Solo", "Single Strong Engineer", "actor", perms),
            (EVALUATOR, "Evaluator", "Benchmark Evaluator", "judge",
             [{"cap": "EXECUTE_SANDBOX",
               "scope": {"argv0_allow": ["python3", "python", "python3.11"],
                         "argv_script_root": vslice.ARTIFACT_DIR,
                         "argv_deny_substrings": ["curl", "wget", "sh -c", ";"]},
               "rate": {"per_hour": 500}}])):
        if con.execute("SELECT 1 FROM principals WHERE id=?", (aid,)).fetchone():
            con.execute("UPDATE principals SET permissions=? WHERE id=?",
                        (json.dumps(extra), aid))
            continue
        c = K.blank(aid, name, role, "Assurance", "Benchmark", "Benchmark condition.",
                    tier=tier)
        c["tools"] = tools if aid == SOLO else ["proc.run"]
        c["permissions"] = extra
        c["memory_scope"] = ["self", "bench:%s" % aid]
        c["success_metrics"] = [{"metric": "bench_correctness", "target": 1, "for": aid}]
        c["escalation_rules"] = [{"when": "budget", "action": "STOP", "for": aid}]
        c["autonomy_level"] = 2 if tier == "actor" else 1
        K.register(con, c, reason="benchmark condition")
        K.transition(con, aid, "EVALUATING")
        K.transition(con, aid, "APPROVED")
        K.transition(con, aid, "ACTIVE")


def parse(text):
    try:
        s, e = text.find("{"), text.rfind("}")
        return json.loads(text[s:e + 1]) if s >= 0 and e > s else {}
    except (ValueError, TypeError):
        return {}


def act(con, gw, agent, req, graph):
    """Route whatever the model asked for through the gateway. Returns (path, denied)."""
    if not req.get("tool"):
        return None, 0
    try:
        out = gw.call(agent, req["tool"], **(req.get("args") or {}))
        graph.append({"agent": agent, "tool": req["tool"], "decision": "ALLOW"})
        return out, 0
    except (runtime.Denied, TypeError, OSError) as e:
        graph.append({"agent": agent, "tool": req.get("tool"), "decision": "DENY",
                      "why": str(e)[:80]})
        return None, 1


def run_condition(con, gw, prov, task, condition, campaign, repeat, order):
    text = B.task_input(task, vslice.REPO_ROOT)
    input_sha = sha(text)
    brid = B.start_run(con, campaign, task, condition, repeat, order, input_sha)
    t0 = time.time()
    runs, graph, denials, path, output = [], [], 0, None, ""
    budget = task["max_usd"]

    def spend():
        if not runs:
            return 0.0
        return con.execute("SELECT COALESCE(SUM(usd),0) s FROM runs WHERE id IN (%s)"
                           % ",".join("?" * len(runs)), runs).fetchone()["s"]

    try:
        if condition == "SINGLE":
            rid, res = runtime.invoke(con, prov, SOLO, SYS_SOLO, text, max_tokens=900)
            runs.append(rid)
            if res.status != "OK":
                raise RuntimeError("provider: %s %s" % (res.status, res.error))
            req = parse(res.text)
            output = req.get("answer") or (req.get("args", {}) or {}).get("body") or res.text
            path, d = act(con, gw, SOLO, req, graph)
            denials += d
        else:
            rid, res = runtime.invoke(con, prov, "AGT-000002", SYS_BUILD, text, max_tokens=900)
            runs.append(rid)
            if res.status != "OK":
                raise RuntimeError("provider(build): %s %s" % (res.status, res.error))
            req = parse(res.text)
            draft = req.get("answer") or (req.get("args", {}) or {}).get("body") or res.text
            graph.append({"agent": "AGT-000002", "step": "build"})

            if spend() < budget:
                rid2, res2 = runtime.invoke(
                    con, prov, "AGT-000004", SYS_CRITIC,
                    "REQUIREMENTS:\n%s\n\nSUBMITTED WORK:\n%s" % (text, draft[:4000]),
                    max_tokens=500)
                runs.append(rid2)
                crit = parse(res2.text).get("answer", res2.text) if res2.status == "OK" else ""
                graph.append({"agent": "AGT-000004", "step": "critique"})
            else:
                crit = ""
                graph.append({"step": "critique_skipped", "why": "budget"})

            if crit and spend() < budget:
                rid3, res3 = runtime.invoke(
                    con, prov, "AGT-000002", SYS_REVISE,
                    "REQUIREMENTS:\n%s\n\nYOUR DRAFT:\n%s\n\nCRITIQUE:\n%s"
                    % (text, draft[:3000], crit[:2000]), max_tokens=900)
                runs.append(rid3)
                if res3.status == "OK":
                    req = parse(res3.text)
                    graph.append({"agent": "AGT-000002", "step": "revise"})
            output = parse_out(req, crit, draft)
            path, d = act(con, gw, "AGT-000002", req, graph)
            denials += d

        agg = con.execute("SELECT COALESCE(SUM(tokens_in),0) i, COALESCE(SUM(tokens_out),0) o,"
                          " COALESCE(SUM(usd),0) u FROM runs WHERE id IN (%s)"
                          % ",".join("?" * len(runs)), runs).fetchone()
        B.finish_run(con, brid, status="COMPLETE", output=output, output_sha=sha(output),
                     model_runs=runs, exec_graph=graph, tool_calls=len(
                         [g for g in graph if g.get("decision") == "ALLOW"]),
                     tool_denials=denials, agents_used=sorted(
                         {g["agent"] for g in graph if g.get("agent")}),
                     tokens_in=agg["i"], tokens_out=agg["o"], usd=agg["u"],
                     latency_ms=int((time.time() - t0) * 1000))
        return brid, path
    except Exception as e:                                    # noqa: BLE001
        B.finish_run(con, brid, status="FAILED", model_runs=runs, exec_graph=graph,
                     agents_used=[], usd=0, latency_ms=int((time.time() - t0) * 1000),
                     failure_class=classify(e), failure_note=repr(e)[:200])
        return brid, None


def parse_out(req, crit, draft):
    body = (req.get("args", {}) or {}).get("body") or req.get("answer") or draft
    return body if not crit else body + "\n\n# CRITIQUE CONSIDERED:\n# " + crit[:600].replace(
        "\n", "\n# ")


def classify(e):
    s = repr(e).lower()
    if "provider" in s or "not_configured" in s:
        return "model"
    if "denied" in s or "capability" in s:
        return "permission"
    if "lease" in s:
        return "coordination"
    if "timeout" in s:
        return "infrastructure"
    return "model"


def verify(con, gw, path):
    """Execution happens OUTSIDE both conditions, by the same evaluator, so neither
    gets running-the-code as a hidden extra capability."""
    if not path:
        return {}
    try:
        return gw.call(EVALUATOR, "EXECUTE_SANDBOX", argv=[sys.executable, path],
                       cwd=vslice.REPO_ROOT)
    except (runtime.Denied, OSError) as e:
        return {"returncode": -1, "stdout": "", "stderr": repr(e)[:200]}


def dry_run_into(con, repeats=1, tasks=None):
    """Exercise the whole benchmark pipeline on an existing connection with
    MockProvider. Used by the regression suite so that no bench table is
    declared-but-unused. Produces no conclusion."""
    prov = P.MockProvider()
    vslice.register_crew(con)
    con.execute("UPDATE principals SET lifecycle_state='ACTIVE'")
    B.register_tasks(con)
    B.ACTIVE.materialise_fixtures(vslice.REPO_ROOT)   # R17: the tool must have data to read
    picked = [t for t in B.active_tasks()
              if not tasks or t["id"] in set(tasks)][:2]
    cid = B.open_campaign(con, "dry", "mock", "mock-1", repeats)
    for t in picked:
        bench_crew(con, t)
        ctx = {"tools_sha": sha(sorted(t["allowed_tools"])),
               "input_sha": sha(B.task_input(t, vslice.REPO_ROOT)), "budget": t["max_usd"]}
        B.assert_fairness(con, cid, t, ctx, ctx)
    order = 0
    for t in picked:
        for rep in range(repeats):
            for cond in ("SINGLE", "MULTI"):
                gw = vslice.build_gateway(con)
                brid, path = run_condition(con, gw, prov, t, cond, cid, rep, order)
                order += 1
                B.evaluate(con, brid, t, verify(con, gw, path), evaluator=EVALUATOR)
    result = B.analyse(con, cid)
    B.close_campaign(con, cid, result)
    return cid, result


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeats", type=int, default=1)
    ap.add_argument("--tasks", help="comma-separated task ids; default all")
    ap.add_argument("--seed", type=int, default=20260917)
    ap.add_argument("--task-set", default="v1", choices=["v1", "v2"],
                    help="v1 = the set campaigns #1-2 ran (default, reproducible). "
                         "v2 = the recalibrated Campaign #3 set. Never implicit.")
    ap.add_argument("--fresh", action="store_true", help="start a new world file")
    ap.add_argument("--dry-run", action="store_true",
                    help="exercise the whole pipeline on MockProvider in a simulation "
                         "world. Proves the harness is fair and auditable; proves "
                         "NOTHING about single vs multi, and is barred from saying so.")
    a = ap.parse_args(argv)

    active = B.use_task_set(getattr(a, "task_set", "v1"))
    dry = getattr(a, "dry_run", False)

    # Campaign #3 runs a SEALED task set. The six pre-execution checks are not
    # optional and are not a separate script the operator might forget: a v2
    # campaign that would spend real budget refuses to start unless they pass.
    if getattr(a, "task_set", "v1") == "v2" and not dry:
        from campaign3_preflight import preflight
        ok, problems = preflight(verbose=True, require_provider=True)
        if not ok:
            print()
            print("Campaign #3 NOT started. %d pre-flight problem(s) above. "
                  "Nothing was spent." % len(problems))
            return 3
    prov = P.MockProvider() if dry else P.from_env()
    if not dry and not prov.available():
        prov = P.ClaudeProvider()
    print(BAR); print("BENCHMARK — one strong agent vs the organisation"); print(BAR)
    if dry:
        print("DRY RUN — MockProvider, simulation world.")
        print("Exercises every stage and every table. Produces NO conclusion.")
        print(BAR)
    if not prov.available():
        print("STATUS: NOT_CONFIGURED — %s" % prov.why_unavailable())
        print()
        print("  No run was made. The framework is NOT a result: without a real provider")
        print("  the conclusion is INSUFFICIENT_EVIDENCE and nothing is inferred.")
        print("  export ANTHROPIC_API_KEY=sk-ant-...   then run this again.")
        return 2

    if a.fresh:
        for ext in ("", "-wal", "-shm"):
            if os.path.exists(DB + ext):
                os.remove(DB + ext)
    db = os.path.join(HERE, "civ-bench-dry.db") if dry else DB
    if dry:
        for ext in ("", "-wal", "-shm"):
            if os.path.exists(db + ext):
                os.remove(db + ext)
    con = store.connect(db)
    if not store.meta(con, "founded"):
        store.found(con, mode="simulation" if dry else "live")
    vslice.register_crew(con)
    con.execute("UPDATE principals SET lifecycle_state='ACTIVE'")
    B.register_tasks(con)
    active.materialise_fixtures(vslice.REPO_ROOT)   # R17: the tool must have data to read

    tasks = [t for t in B.active_tasks()
             if not a.tasks or t["id"] in set(a.tasks.split(","))]
    cid = B.open_campaign(con, "bench-%s" % now()[:19], prov.name,
                          getattr(prov, "model", "-"), a.repeats)
    print("campaign #%d | commit %s | %s/%s | repeats %d | %d task(s)"
          % (cid, B.git_commit()[:12], prov.name, getattr(prov, "model", "-"),
             a.repeats, len(tasks)))
    print(BAR)

    rng = random.Random(a.seed)
    plan = [(t, r, c) for t in tasks for r in range(a.repeats) for c in ("SINGLE", "MULTI")]
    rng.shuffle(plan)                      # blunt ordering effects

    for t in tasks:
        bench_crew(con, t)
        ctx = {"tools_sha": sha(sorted(t["allowed_tools"])),
               "input_sha": sha(B.task_input(t, vslice.REPO_ROOT)), "budget": t["max_usd"]}
        B.assert_fairness(con, cid, t, ctx, ctx)     # the trigger refuses inequality

    for order, (t, rep, cond) in enumerate(plan):
        bench_crew(con, t)
        gw = vslice.build_gateway(con)
        brid, path = run_condition(con, gw, prov, t, cond, cid, rep, order)
        ran = verify(con, gw, path)
        m = B.evaluate(con, brid, t, ran, evaluator=EVALUATOR)
        row = con.execute("SELECT status, usd FROM bench_runs WHERE id=?", (brid,)).fetchone()
        print("  %-24s %-6s r%-2d %-9s correctness=%-5s $%.5f"
              % (t["id"], cond, rep, row["status"], m.get("correctness"), row["usd"] or 0))
        sys.stdout.flush()

    print(BAR)
    result = B.analyse(con, cid)
    B.close_campaign(con, cid, result)
    for pt in result["per_task"]:
        s, mm = pt["SINGLE"], pt["MULTI"]
        print("  %-24s single c=%-5s $%-8.5f | multi c=%-5s $%-8.5f | %s  (by design: %s)"
              % (pt["task_id"], s["correctness"], s["usd"], mm["correctness"], mm["usd"],
                 pt["direction"], pt["favours_by_design"]))
    print(BAR)
    print("CONCLUSION: %s" % result["conclusion"])
    print("  %s" % result["why"])
    if result["warnings"]:
        print("  warnings: %s" % "; ".join(result["warnings"]))
    out = os.path.join(HERE, "bench_report.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)
    print()
    print("written to civ/bench_report.json — paste it back to record the result.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
