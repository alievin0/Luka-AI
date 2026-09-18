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
# MULTI's roles are benchmark principals, not the slice crew.
#
# They used to be AGT-000002 (Builder) and AGT-000004 (Critic), whose grants come
# from slice.CREW and have nothing to do with the task: the Builder held READ_REPO
# over the whole repo on EVERY task, and the Critic held no task capability at all.
# `bench_fairness` never saw it, because LAW 11 compares sha(allowed_tools) and
# those are equal by construction. The grants behind them were not. Once the loop
# makes tools reachable, that stops being a dormant defect and becomes the
# experiment's main confound, so the roles now carry exactly the same permission
# list as SOLO — built from the task, refreshed per task, identical by identity.
BUILDER = "AGT-BENCH-BUILD"
CRITIC = "AGT-BENCH-CRITIC"
# The reviser IS the builder: same principal, same row, same grants. Security
# test 8 ("the reviser cannot escalate") is then true by construction rather than
# by assertion.
REVISER = BUILDER

# ── the response contract, identical for every role in both conditions ──
# Documented in the prompt because a capability the model is never told about is
# a capability it does not have — which is how V2-T05 became impossible while
# READ_REPO sat granted and unreachable.
SCHEMA = (
    "Reply with EXACTLY ONE json object and nothing else. No prose, no fences.\n"
    "  To read a file you are authorised for:\n"
    '    {"tool":"READ_REPO","args":{"path":"<absolute path>"}}\n'
    "  To write your deliverable:\n"
    '    {"tool":"WRITE_ARTIFACT","args":{"path":"<name>.py","body":"<content>"}}\n'
    "  To submit and finish:\n"
    '    {"final":{"artifact":"<name>.py"}}   or   {"final":{"answer":"<text>"}}\n'
    "After a tool call you will be shown its result and may act again. "
    "Submit as soon as you are done."
)

SYS_SOLO = ("You are one strong engineer working alone. Produce the complete, correct "
            "answer. You may call tools and see their results before you submit.\n"
            + SCHEMA)
SYS_BUILD = ("You are a Builder in an audited organisation. Produce a first attempt. "
             "You may call tools and see their results before you submit.\n"
             + SCHEMA)
SYS_CRITIC = ("You are an independent Critic. You did not write this. Check the "
              "submitted work against the stated requirements and say what is wrong "
              "or missing. If the requirements contradict each other, say so "
              "explicitly. If the work is already correct, say that plainly — "
              "reporting no defect is a valid and complete critique. You may call "
              "tools to check it before answering.\n" + SCHEMA)
SYS_REVISE = ("You are the Builder. You have received a critique of your work. "
              "Judge it: apply what is correct, and if the critique is wrong or the "
              "work is already right, resubmit it unchanged. Changing correct work "
              "is a defect, not diligence.\n" + SCHEMA)


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
            (BUILDER, "Builder", "Organisation Builder", "actor", perms),
            (CRITIC, "Critic", "Organisation Critic", "actor", perms),
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
        c["tools"] = ["proc.run"] if aid == EVALUATOR else tools
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


# ── loop constants: identical for every role in BOTH conditions ────────
# MULTI gets three role turns and therefore up to 3x the steps. That is the
# architecture, and it is already paid for in the COST and LATENCY dimensions.
MAX_TOOL_STEPS = 4              # tool calls per role turn
CLIP_BUDGET = 6000              # chars of a handoff, recorded when it bites
MAX_TRANSPORT_RETRIES = 2       # per model call, transport-class failures only
MAX_CONSECUTIVE_DENIALS = 2     # a denial is an observation, not a free retry

OBS = "TOOL RESULT"             # only the gateway's own return is rendered as this


def clip(text, budget=CLIP_BUDGET):
    """One truncation policy, used everywhere, and it reports itself.

    The old harness silently cut the critic's view at 4000 chars and the
    reviser's at 3000 — tighter than what the critic saw — while SINGLE
    truncated nothing. That was an uncontrolled variable between the two
    conditions. Truncation is now measured rather than hidden."""
    text = text or ""
    if len(text) <= budget:
        return text, {"truncated": False, "kept_chars": len(text), "dropped_chars": 0}
    return text[:budget], {"truncated": True, "kept_chars": budget,
                           "dropped_chars": len(text) - budget}


def is_transport_failure(res):
    """A transport failure is the network, not the answer.

    MULTI makes 3x the model calls, so at any per-call failure rate its per-run
    failure probability is roughly 3x — a penalty for infrastructure noise
    rather than for anything architectural. Retrying at the CALL level equalises
    that. A wrong answer is never retried, and neither is an empty completion:
    those are outcomes."""
    if res.status == "OK":
        return False
    e = str(res.error or "").lower()
    if "empty completion" in e or res.status == "NOT_CONFIGURED":
        return False
    # Matched against Result.error, which ClaudeProvider fills with either
    # "HTTP <code>: <body>" or repr(exception) — so both spellings are listed.
    return any(m in e for m in ("429", "500", "502", "503", "504", "529", "408",
                                "timeout", "timed out", "urlerror", "urlopen error",
                                "connection", "remote end", "reset by peer",
                                "broken pipe", "eof occurred", "overloaded",
                                "bad gateway", "service unavailable",
                                "gateway timeout", "temporarily unavailable"))


def invoke_with_retry(con, prov, principal, system, prompt, max_tokens, graph):
    """runtime.invoke with a bounded, recorded retry on transport failures only.

    Every attempt is a real row in `runs` — a retry is never hidden."""
    rids, res = [], None
    for attempt in range(MAX_TRANSPORT_RETRIES + 1):
        rid, res = runtime.invoke(con, prov, principal, system, prompt,
                                  max_tokens=max_tokens)
        rids.append(rid)
        if not is_transport_failure(res):
            return rids, res, attempt
        graph.append({"agent": principal, "step": "retry",
                      "attempt": attempt + 1, "why": str(res.error)[:80]})
    return rids, res, MAX_TRANSPORT_RETRIES


def render_observation(cap, out):
    """Gateway output -> prompt text.

    Only a value returned by Gateway.call reaches this function. Text the model
    produced is parsed for a request and never rendered as a result, so a model
    cannot forge an observation by imitating the format."""
    body = out if isinstance(out, str) else json.dumps(out, ensure_ascii=False)
    kept, rec = clip(body)
    return "\n\n%s [%s]:\n%s%s" % (
        OBS, cap, kept, "\n(truncated)" if rec["truncated"] else ""), rec


class Turn:
    """What one role produced: the deliverable, and how it got there."""

    __slots__ = ("deliverable", "artifact_path", "steps", "submitted",
                 "run_ids", "denials", "exhausted")

    def __init__(self):
        self.deliverable, self.artifact_path = "", None
        self.steps, self.denials = 0, 0
        self.submitted, self.exhausted = False, False
        self.run_ids = []


def agent_turn(con, gw, prov, principal, system, prompt, graph, max_tokens=900,
               runs=None):
    """model -> tool -> observation -> model, bounded, through the SAME gateway.

    This is the loop the harness never had. Every tool call goes through
    Gateway.call exactly as before: deny-by-default, scoped, rate-limited, and
    logged to tool_calls. Nothing here weakens an authorisation check; it only
    lets the model SEE what it asked for.

    `runs` is the caller's list of model-run ids and is extended AS EACH CALL IS
    MADE, not when the turn returns. A turn that raises has still spent what it
    spent, and a bill collected only on the way out would report a failed role
    turn as free."""
    t = Turn()
    writes = {}                       # artifact name -> full path on disk
    bodies = {}                       # artifact name -> the body as submitted
    consecutive_denials = 0

    for step in range(MAX_TOOL_STEPS + 1):
        rids, res, _ = invoke_with_retry(con, prov, principal, system, prompt,
                                         max_tokens, graph)
        t.run_ids.extend(rids)
        if runs is not None:
            runs.extend(rids)
        if res.status != "OK":
            raise RuntimeError("provider(%s): %s %s" % (principal, res.status, res.error))

        req = parse(res.text)

        # ── submission ────────────────────────────────────────────────
        fin = req.get("final")
        if isinstance(fin, dict):
            name = fin.get("artifact")
            if name:
                t.artifact_path = writes.get(name) or writes.get(os.path.basename(name))
                t.deliverable = bodies.get(name) or bodies.get(
                    os.path.basename(name)) or ""
            if not t.deliverable:
                t.deliverable = fin.get("answer") or ""
            t.submitted = bool(t.deliverable or t.artifact_path)
            graph.append({"agent": principal, "step": "submit",
                          "artifact": name, "steps_used": t.steps,
                          "resolved": t.submitted})
            if t.submitted:
                return t
            # A submission naming an artifact that was never written THROUGH THE
            # GATEWAY resolves to nothing, and nothing is what it is worth. It
            # must not fall through and be graded on the raw text of the request:
            # that is how a model could name a file it never produced and still
            # be scored on something. Say so and let it use another step.
            graph.append({"agent": principal, "step": "submit_unresolved",
                          "artifact": name})
            prompt += ("\n\nHARNESS: no artifact named %r was written in this turn. "
                       "Write it first, or submit an answer." % (name,))
            continue

        # ── a tool request ────────────────────────────────────────────
        cap = req.get("tool")
        if cap and step < MAX_TOOL_STEPS:
            args = req.get("args") or {}
            try:
                out = gw.call(principal, cap, **args)
                consecutive_denials = 0
                t.steps += 1
                if cap == "WRITE_ARTIFACT" and args.get("path"):
                    nm = os.path.basename(args["path"])
                    writes[args["path"]] = out
                    writes[nm] = out
                    bodies[args["path"]] = args.get("body", "")
                    bodies[nm] = args.get("body", "")
                tc = con.execute(
                    "SELECT id FROM tool_calls ORDER BY id DESC LIMIT 1").fetchone()
                graph.append({"agent": principal, "tool": cap, "decision": "ALLOW",
                              "tool_call_id": tc["id"] if tc else None, "step": step})
                rendered, rec = render_observation(cap, out)
                if rec["truncated"]:
                    graph.append(dict(rec, agent=principal, step="clip",
                                      where="observation:%s" % cap))
                prompt += rendered
                continue
            except (runtime.Denied, TypeError, OSError) as e:
                t.denials += 1
                consecutive_denials += 1
                tc = con.execute(
                    "SELECT id FROM tool_calls ORDER BY id DESC LIMIT 1").fetchone()
                graph.append({"agent": principal, "tool": cap, "decision": "DENY",
                              "tool_call_id": tc["id"] if tc else None,
                              "why": str(e)[:80], "step": step})
                if consecutive_denials >= MAX_CONSECUTIVE_DENIALS:
                    graph.append({"agent": principal, "step": "denial_cap"})
                    break
                prompt += "\n\n%s [%s]: DENIED — %s" % (OBS, cap, str(e)[:160])
                continue

        # ── a bare answer is an implicit submission ───────────────────
        ans = req.get("answer")
        if ans or (not cap and res.text.strip()):
            t.deliverable = ans or res.text.strip()
            t.submitted = True
            graph.append({"agent": principal, "step": "answer",
                          "steps_used": t.steps})
            return t

        if cap and step >= MAX_TOOL_STEPS:
            break

    t.exhausted = True
    graph.append({"agent": principal, "step": "exhausted", "steps_used": t.steps})
    return t


def run_condition(con, gw, prov, task, condition, campaign, repeat, order):
    """One attempt at one task under one condition.

    SINGLE  = one agent_turn.
    MULTI   = builder -> critic -> reviser, three agent_turns, one per role.

    What the two share is fixed here and nowhere else: the same task text, the
    same per-turn step budget, the same clip policy, the same retry budget, the
    same grading boundary. What differs is the number of role turns — which is
    the architecture under test, and which COST and LATENCY already charge for.
    """
    text = B.task_input(task, vslice.REPO_ROOT)
    input_sha = sha(text)
    brid = B.start_run(con, campaign, task, condition, repeat, order, input_sha)
    t0 = time.time()
    runs, graph = [], []
    path, output, submitted = None, "", False
    budget = task["max_usd"]

    def spend():
        if not runs:
            return 0.0
        return con.execute("SELECT COALESCE(SUM(usd),0) s FROM runs WHERE id IN (%s)"
                           % ",".join("?" * len(runs)), runs).fetchone()["s"]

    # Nothing about a role turn is tallied after the fact: model calls land in
    # `runs` as they are made, and steps, denials and truncations land in `graph`
    # as they happen. A turn that raises has already written both, so a failed
    # run reports what it really did and what it really cost.
    def tally(kind):
        return len([g for g in graph if g.get("decision") == kind])

    try:
        if condition == "SINGLE":
            solo = agent_turn(con, gw, prov, SOLO, SYS_SOLO, text, graph, runs=runs)
            output, path, submitted = solo.deliverable, solo.artifact_path, solo.submitted
        else:
            build = agent_turn(con, gw, prov, BUILDER, SYS_BUILD, text, graph,
                               runs=runs)
            output, path, submitted = (build.deliverable, build.artifact_path,
                                       build.submitted)

            # ONE clip, computed once, handed to BOTH downstream roles. The old
            # harness cut the critic at 4000 chars and the reviser at 3000, so the
            # reviser was asked to act on a critique of text it had never been
            # shown. Now the reviser sees exactly what the critic saw, and if
            # anything was dropped the run says so instead of hiding it.
            shown, rec = clip(build.deliverable)
            if rec["truncated"]:
                graph.append(dict(rec, step="clip",
                                  where="handoff:builder->critic,reviser"))

            crit = ""
            if spend() < budget:
                cr = agent_turn(con, gw, prov, CRITIC, SYS_CRITIC,
                                "REQUIREMENTS:\n%s\n\nSUBMITTED WORK:\n%s" % (text, shown),
                                graph, max_tokens=500, runs=runs)
                crit = cr.deliverable
            else:
                graph.append({"step": "critique_skipped", "why": "budget"})

            # The critique is EVIDENCE, not part of the deliverable. It is recorded
            # here, in the execution graph, and it never reaches the grader — the
            # old harness appended it to the artifact, where a keyword-scored
            # rubric could pay MULTI for words no reviser had to earn.
            crit_shown, crec = clip(crit)
            if crec["truncated"]:
                graph.append(dict(crec, step="clip", where="handoff:critic->reviser"))
            graph.append({"agent": CRITIC, "step": "critique_recorded",
                          "chars": len(crit or ""), "sha": sha(crit) if crit else "",
                          "text": crit_shown})

            if crit and spend() < budget:
                rv = agent_turn(con, gw, prov, REVISER, SYS_REVISE,
                                "REQUIREMENTS:\n%s\n\nYOUR DRAFT:\n%s\n\nCRITIQUE:\n%s"
                                % (text, shown, crit_shown), graph, runs=runs)
                # A reviser that resubmits correct work unchanged has done its job.
                # Only an actual submission replaces the draft; a turn that never
                # submitted must not silently erase what the builder produced.
                if rv.submitted:
                    output, path, submitted = rv.deliverable, rv.artifact_path, True
                else:
                    graph.append({"agent": REVISER, "step": "revision_not_submitted"})
            elif crit:
                graph.append({"step": "revision_skipped", "why": "budget"})

        agg = con.execute("SELECT COALESCE(SUM(tokens_in),0) i, COALESCE(SUM(tokens_out),0) o,"
                          " COALESCE(SUM(usd),0) u FROM runs WHERE id IN (%s)"
                          % ",".join("?" * len(runs)), runs).fetchone()
        # No submission is not a zero — it is a run that produced no deliverable to
        # grade. Recorded as INCOMPLETE, counted as an attempt, never scored on
        # whatever string happened to be lying around.
        status = "COMPLETE" if submitted else "INCOMPLETE"
        if not submitted:
            output, path = "", None
            graph.append({"step": "no_submission", "condition": condition})
        B.finish_run(con, brid, status=status, output=output, output_sha=sha(output),
                     model_runs=runs, exec_graph=graph, tool_calls=tally("ALLOW"),
                     tool_denials=tally("DENY"), agents_used=sorted(
                         {g["agent"] for g in graph if g.get("agent")}),
                     tokens_in=agg["i"], tokens_out=agg["o"], usd=agg["u"],
                     retries=len([g for g in graph if g.get("step") == "retry"]),
                     latency_ms=int((time.time() - t0) * 1000))
        return brid, path
    except Exception as e:                                    # noqa: BLE001
        agg = con.execute("SELECT COALESCE(SUM(tokens_in),0) i, COALESCE(SUM(tokens_out),0) o,"
                          " COALESCE(SUM(usd),0) u FROM runs WHERE id IN (%s)"
                          % ",".join("?" * len(runs)), runs).fetchone() if runs else None
        # A failed run still spent what it spent. Reporting $0 for it understates
        # the cost of the condition that failed, which is the one dimension where
        # a failure must not look free.
        B.finish_run(con, brid, status="FAILED", model_runs=runs, exec_graph=graph,
                     agents_used=sorted({g["agent"] for g in graph if g.get("agent")}),
                     tool_calls=tally("ALLOW"), tool_denials=tally("DENY"),
                     tokens_in=agg["i"] if agg else 0, tokens_out=agg["o"] if agg else 0,
                     usd=agg["u"] if agg else 0,
                     retries=len([g for g in graph if g.get("step") == "retry"]),
                     latency_ms=int((time.time() - t0) * 1000),
                     failure_class=classify(e), failure_note=repr(e)[:200])
        return brid, None


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
        # R20. --fresh used to DELETE the world file, which on the owner's
        # machine holds campaign #2's raw runs. LAW 12 cannot protect rows in a
        # file that is unlinked, and the directive is to preserve raw evidence,
        # so a fresh start now ARCHIVES the old world beside itself.
        stamp = now()[:19].replace(":", "").replace("-", "")
        for ext in ("", "-wal", "-shm"):
            if os.path.exists(DB + ext):
                os.rename(DB + ext, "%s.archived-%s%s" % (DB, stamp, ext))
        if os.path.exists("%s.archived-%s" % (DB, stamp)):
            print("previous world archived -> %s.archived-%s"
                  % (os.path.basename(DB), stamp))
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

    # R21. A dead provider used to burn all 90 runs in silence: every line read
    # "FAILED  correctness=0.0  $0.00000" with no reason, and the campaign ran to
    # the end before anyone could see why. A systematic infrastructure failure is
    # not a result and must not be ground out to completion. This is NOT stopping
    # early because a condition looks like it is winning — no run has produced a
    # score at all.
    consecutive_failures, ABORT_AFTER = 0, 6
    for order, (t, rep, cond) in enumerate(plan):
        bench_crew(con, t)
        gw = vslice.build_gateway(con)
        brid, path = run_condition(con, gw, prov, t, cond, cid, rep, order)
        ran = verify(con, gw, path)
        m = B.evaluate(con, brid, t, ran, evaluator=EVALUATOR)
        row = con.execute("SELECT status, usd, failure_class, failure_note "
                          "FROM bench_runs WHERE id=?",
                          (brid,)).fetchone()
        why = ""
        if row["status"] != "COMPLETE":
            why = "  <- %s: %s" % (row["failure_class"] or "?",
                                   (row["failure_note"] or "no note")[:100])
        print("  %-24s %-6s r%-2d %-9s correctness=%-5s $%.5f%s"
              % (t["id"], cond, rep, row["status"], m.get("correctness"),
                 row["usd"] or 0, why))
        sys.stdout.flush()

        consecutive_failures = 0 if row["status"] == "COMPLETE" else consecutive_failures + 1
        if consecutive_failures >= ABORT_AFTER:
            print(BAR)
            print("ABORTED — %d consecutive runs failed before producing any score."
                  % consecutive_failures)
            print("This is an INFRASTRUCTURE FAILURE, not a benchmark result.")
            print("The %d runs attempted are preserved in %s; nothing is discarded."
                  % (order + 1, os.path.basename(db)))
            print("Last failure: %s — %s"
                  % (row["failure_class"] or "?", row["failure_note"] or "(none)"))
            print("The campaign is left OPEN and unscored. Fix the cause and start a")
            print("new campaign — do not analyse a run that never produced a score.")
            print(BAR)
            return 4

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
