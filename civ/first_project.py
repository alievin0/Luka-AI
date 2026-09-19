#!/usr/bin/env python3
"""FIRST AUTONOMOUS PROJECT — one opportunity, one approval, then silence.

    CIV_PROVIDER=gemini CIV_ASSUME_FREE=1 CIV_MODEL=gemini-3.1-flash-lite \
        CIV_MAX_CALLS=14 python3 first_project.py

`real_world_demo.py` showed that three agents
can run on one model. This is the next question and a different one: whether the
WORLD can take something it noticed, decide it is worth doing, ask once, and
then carry a project from opportunity to outcome without being told the steps.

The Owner does exactly two things, both before the work starts:

    1. states the problem  — one OWNER_OBJECTIVE, and nothing else is said
    2. answers one question — APPROVE or REJECT, written into one row

After that the Owner leaves. Every transition below is the runtime's:
evaluation, the proposal, the team, the task graph, assignment, execution,
verification, review, correction, the lesson, completion. §12 counts what the
Owner did afterwards and the number has to be zero.

What this file supplies is a specification — the problem, the source, the bar,
and who the work is for. It does not supply a decision. No tool is named for an
agent, no team is written down, no task is authored here, no message text is
composed, and no verdict is pre-selected.
"""
import argparse
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import agent_context as CTX        # noqa: E402
from core import agent_runtime as RT         # noqa: E402
from core import agent_world as W            # noqa: E402
from core import always_on as A              # noqa: E402
from core import provider as P               # noqa: E402
from core import spend as SPEND              # noqa: E402
from core import store                       # noqa: E402
from core import world_bus as BUS            # noqa: E402
from core import world_policy as POL         # noqa: E402
from core import world_supervisor as SUP     # noqa: E402
from real_world_demo import (                # noqa: E402
    BAR, COMPLETE, Recorder, VERDICT_RULE, _verdict_in, completion_state, head, say)

ORCH, RES, BUILD, REV = (SUP.ORCH, SUP.RES, SUP.BUILD, SUP.REV)
TURN_TOKENS = 1600

# ── PHASE 1 · the opportunity ────────────────────────────────────────
# A real signal from this repository, not a market. MULTI_AGENT.md states, in
# its own words, what has and has not been demonstrated — claims written at a
# particular hour that the code can outrun. Whether they still hold is a
# question with a checkable answer, and nobody has checked it.
SIGNAL = os.path.join(HERE, "MULTI_AGENT.md")

OBJECTIVE = ("Establish which of the claims MULTI_AGENT.md makes about what has "
             "been demonstrated still hold, and recommend what should change.")

# Everything an opportunity has to carry beyond its problem. This is persisted —
# it becomes `discoveries.interpretation` — so it is a row and not a slide.
FRAMING = {
    "origin": "INTERNALLY DERIVED from repository signals. No external market "
              "evidence exists for this and none is claimed or invented.",
    "value": "A document that states what is proven is read by the agents "
             "themselves and quoted by anyone deciding whether to trust this "
             "work. A stale claim in it is worse than no claim.",
    "uncertainty": "Whether the document still agrees with the code is unknown "
                   "until the file is read. It may be entirely correct, in "
                   "which case the right outcome is to say so and stop.",
    "resource_estimate": "a single-digit number of model calls on a free tier, "
                         "bounded by CIV_MAX_CALLS; no paid service",
}


def owner_states_the_problem(con):
    """The Owner's first and only instruction. One row on the queue."""
    qid, _ = BUS.emit(con, "OWNER_OBJECTIVE", "objective:1",
                      {"objective": OBJECTIVE, "fixture": SIGNAL,
                       "required_caps": ["research", "build"],
                       "interpretation": json.dumps(FRAMING)}, by="OWNER")
    return qid


# ── PHASE 2 · the evaluation, on a real model ────────────────────────
EVAL_LOG = []


def gemini_evaluate(w, opp_id, chain_id=None):
    """A real bounded turn that judges the opportunity. It may refuse it.

    The Orchestrator judges, and the Orchestrator holds no tools — so the agent
    deciding whether the work is worth doing is structurally incapable of doing
    it. It is shown the opportunity, the evidence row under it, and what the
    world's own deterministic rules concluded, and it is told it may disagree in
    either direction. Nothing here supplies a verdict."""
    con = w.con
    o = con.execute("SELECT * FROM opportunities WHERE id=?", (opp_id,)).fetchone()
    ev = con.execute("SELECT * FROM evidence WHERE id=?",
                     (o["evidence_id"],)).fetchone() if o["evidence_id"] else None
    rules, failed = A.evaluate_opportunity(con, opp_id, by=SUP.OWNER, chain_id=chain_id)
    prov = w.provider_for(ORCH, None, 1)
    if not prov.available():
        return None, "no model was available to evaluate: %s" % prov.why_unavailable(), None

    framing = {}
    d = con.execute("SELECT interpretation FROM discoveries WHERE id=?",
                    (o["discovery_id"],)).fetchone() if o["discovery_id"] else None
    try:
        framing = json.loads(d["interpretation"]) if d and d["interpretation"] else {}
    except ValueError:
        framing = {}

    instruction = (
        "An opportunity has been proposed in this world and you are deciding "
        "whether it becomes committed work.\n\n"
        "PROBLEM\n  %s\n\n"
        "WHY IT MIGHT BE WORTH DOING\n  %s\n\n"
        "WHAT IS UNCERTAIN\n  %s\n\n"
        "WHERE IT CAME FROM\n  %s\n\n"
        "WHAT IT WOULD COST\n  %s\n\n"
        "CAPABILITIES IT WOULD NEED\n  %s\n\n"
        "EVIDENCE UNDER IT\n  %s\n\n"
        "The world's own deterministic rules already ran and concluded %s%s.\n\n"
        "You may disagree with them in either direction. Rules can see whether "
        "an evidence row exists; they cannot see whether the problem is worth "
        "anyone's time, whether the stated value is real, or whether the "
        "uncertainty is worth resolving. Judge that.\n\n"
        "Refusing is a real answer here. An opportunity that is not worth doing "
        "should be rejected, and rejecting it costs this world nothing.\n\n"
        "Two things about HOW to answer, because a real run got both wrong.\n"
        "You need no tool for this and none would help: everything the decision "
        "rests on is written above. Your contract lists CAPABILITIES YOU MAY BE "
        "ASSIGNED — those are roles you can be given, not a menu of tools you can "
        "call, and calling one will be refused. If you do try a tool and it is "
        "refused, that refusal is about your own permissions and says NOTHING "
        "about whether this opportunity is worth doing. Judge the opportunity, "
        "not your own grants.\n\n%s"
        % (o["problem"], framing.get("value", "-"), framing.get("uncertainty", "-"),
           framing.get("origin", "-"), framing.get("resource_estimate", "-"),
           ", ".join(json.loads(o["required_caps"] or "[]")) or "-",
           ("evidence #%d, %s" % (ev["id"], ev["external_provenance"]))
           if ev else "none recorded",
           rules, (" (" + "; ".join(failed) + ")") if failed else "",
           VERDICT_RULE))

    try:
        turn = RT.run_agent_turn(con, w.gw, prov, ORCH, None, instruction=instruction,
                                 lease_id=None, max_tokens=TURN_TOKENS)
    except Exception as e:                      # noqa: BLE001
        return None, "the evaluator's turn failed: %s" % str(e)[:200], None

    answer = turn.answer or ""
    verdict = _verdict_in(answer)
    run_id = turn.run_ids[-1] if turn.run_ids else None
    EVAL_LOG.append({"opportunity": opp_id, "verdict": verdict, "answer": answer,
                     "rules": rules, "rules_failed": failed, "run": run_id})
    if verdict is None:
        return None, "the evaluator answered without a verdict: %r" % answer[:160], run_id
    # The world's rules are a floor, not a veto to be overruled: an opportunity
    # its own rules refused does not become work because a model liked it.
    if verdict == "APPROVE" and rules != "APPROVED":
        return ("REJECTED", "the world's rules refused it (%s) and a model cannot "
                "overrule them" % "; ".join(failed), run_id)
    return ("APPROVED" if verdict == "APPROVE" else "REJECTED",
            answer.strip(), run_id)


# ── PHASE 3 · the Owner's one decision ───────────────────────────────
def owner_gate(w, oid, item):
    """The world proposes and stops. It cannot answer its own question."""
    o = w.con.execute("SELECT * FROM opportunities WHERE id=?", (oid,)).fetchone()
    return POL.propose(w.con, "project.create", ORCH,
                       "Open a project for opportunity #%d?" % oid,
                       (o["rationale"] or "")[:300], evidence_id=o["evidence_id"],
                       chain_id=item["chain_id"])


def owner_answers(con, approval_id, verdict="APPROVE"):
    """One word, written into one row, by the Owner and by nobody else.

    This is exactly what `owner.py decide` does, and it is the whole of the
    Owner's authority here: no task, no team, no assignment, no message."""
    con.execute("UPDATE approvals SET decision=?, decided_at=? WHERE id=?",
                (verdict, store.now(), approval_id))
    store.event(con, "OWNER_DECIDED", actor="OWNER",
                subject="approval:%d" % approval_id, payload={"decision": verdict})
    return store.now()


# ── PHASE 9 · the passport ───────────────────────────────────────────
def passport(con, project_id, opp_id):
    """The project's whole history, assembled from rows and nothing else.

    Every query below names the project. In a world running one project that is
    a distinction without a difference, and in a world running three it is the
    whole difference: an unscoped passport hands each project the others'
    approvals, corrections, lessons and verifications, and three of them then
    agree on a history none of them had."""
    p = W.project_passport(con, project_id)
    tids = [t["id"] for t in con.execute(
        "SELECT id FROM tasks WHERE project_id=? ORDER BY id", (project_id,))] or [-1]
    qmarks = ",".join("?" * len(tids))
    arts = [a["id"] for a in con.execute(
        "SELECT id FROM artifacts WHERE project_id=? ORDER BY id", (project_id,))]
    o = dict(con.execute("SELECT * FROM opportunities WHERE id=?", (opp_id,)).fetchone())
    ev = con.execute("SELECT * FROM evidence WHERE id=?",
                     (o["evidence_id"],)).fetchone() if o["evidence_id"] else None
    d = con.execute("SELECT * FROM discoveries WHERE id=?",
                    (o["discovery_id"],)).fetchone() if o["discovery_id"] else None
    try:
        framing = json.loads(d["interpretation"]) if d and d["interpretation"] else {}
    except ValueError:
        framing = {}
    p["opportunity"] = {
        "id": o["id"], "problem": o["problem"], "status": o["status"],
        "proposed_by": o["discovered_by"], "confidence": o["confidence"],
        "required_caps": json.loads(o["required_caps"] or "[]"),
        "rationale": o["rationale"], "validation_plan": o["validation_plan"],
        "decided_by": o["decided_by"], "decision_why": o["decision_why"],
        "framing": framing,
    }
    p["opportunity_evidence"] = ({"id": ev["id"], "kind": ev["kind"],
                                  "provenance": ev["external_provenance"],
                                  "sha": ev["content_sha"]} if ev else None)
    # The gate approval is raised BEFORE the project exists, so its own
    # `project_id` is null and always will be: there was nothing to point at.
    # What ties it to this project is the question the world asked — the
    # DECISION_REQUIRED row naming both the approval and the opportunity this
    # project came from. That is a row, not an inference from the wording.
    gated = {json.loads(r["payload"] or "{}").get("approval_id")
             for r in con.execute("SELECT payload FROM world_queue "
                                  "WHERE kind='DECISION_REQUIRED'")
             if json.loads(r["payload"] or "{}").get("opportunity_id") == opp_id}
    p["approval"] = [dict(r) for r in con.execute("SELECT * FROM approvals ORDER BY id")
                     if r["project_id"] == project_id or r["id"] in gated]
    p["task_graph"] = [{"task": r["task_id"], "depends_on": r["depends_on"]}
                       for r in con.execute(
        "SELECT * FROM task_deps WHERE task_id IN (%s) ORDER BY task_id" % qmarks, tids)]
    p["corrections"] = [{"id": t["id"], "corrects": t["parent_id"],
                         "status": t["status"], "objective": t["objective"][:70]}
                        for t in con.execute(
        "SELECT * FROM tasks WHERE parent_id IS NOT NULL AND project_id=? ORDER BY id",
        (project_id,))]
    p["lessons"] = [{"id": l["id"], "text": l["text"], "task": l["task_id"],
                     "project": l["project_id"], "failure": l["failure_id"],
                     "evidence": l["evidence_id"], "by": l["proposed_by"]}
                    for l in con.execute("SELECT * FROM lessons WHERE project_id=? "
                                         "ORDER BY id", (project_id,))]
    p["verifications"] = [{"id": e["id"], "provenance": e["external_provenance"],
                           "passed": all(c["passed"] for c in
                                         json.loads(e["detail"] or "{}").get("checks", []))}
                          for e in con.execute(
        "SELECT * FROM evidence WHERE external_provenance LIKE 'artifact:%' ORDER BY id")
        if _artifact_in(e["external_provenance"]) in arts]
    state, why, accounted = completion_state(con, project_id)
    p["completion"] = {"state": state, "why": why, "accounted": accounted}
    p["unresolved"] = ([t["objective"][:70] for t in con.execute(
        "SELECT * FROM tasks WHERE project_id=? AND status NOT IN "
        "('ACCEPTED','ARCHIVED') ORDER BY id", (project_id,))]
        + ([framing.get("uncertainty", "")] if state != COMPLETE else []))
    return p


def _artifact_in(provenance):
    """The artifact id an `artifact:<id>@<sha>` provenance names, or None."""
    try:
        return int((provenance or "").split("@")[0].split(":")[1])
    except (IndexError, ValueError):
        return None


# ── the run ──────────────────────────────────────────────────────────
def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=None)
    ap.add_argument("--max-ticks", type=int, default=60)
    ap.add_argument("--owner-says", default="APPROVE",
                    help="the one word the Owner answers with")
    a = ap.parse_args(argv)

    head("1. WHAT IS ANSWERING")
    live = P.from_env()
    say("  CIV_PROVIDER      %s" % (os.environ.get("CIV_PROVIDER") or "(unset)"))
    say("  provider          %s" % live.name)
    say("  model             %s" % getattr(live, "model", "-"))
    say("  source            %s" % live.source)
    say("  available         %s" % live.available())
    if not (live.available() and live.source == "model"):
        say("\n  FIRST AUTONOMOUS PROJECT NOT DEMONSTRATED")
        say("    no provider whose source is 'model' answered: %s"
            % (live.why_unavailable() or "-"))
        return 1

    cap = SPEND.Cap.from_env()
    say("  hard cap          %d model calls for the whole project" % cap.max_calls)

    con = store.connect(a.db or os.path.join(tempfile.mkdtemp(), "project.db"))
    store.found(con, mode="live")
    gw = W.build_gateway(con)
    W.found_agents(con)
    POL.seed(con)
    say("  world mode        live  (LAW 2 refuses a mock run in it)")

    rec = Recorder(live)

    def provider_for(agent, task, attempt):
        return SPEND.Budgeted(rec.acting(agent), cap=cap)

    w = SUP.World(con, gw, provider_for=provider_for,
                  requirements_for=_requirements_for,
                  instruction_for=_instruction_for,
                  evaluate_for=gemini_evaluate, gate_for=owner_gate,
                  review_for=_review_for, worker="first-project")

    # ── PHASE 1 ──────────────────────────────────────────────────────
    head("2. THE OPPORTUNITY")
    say("  problem           %s" % OBJECTIVE)
    say("  signal            %s" % os.path.relpath(SIGNAL, HERE))
    for k in ("origin", "value", "uncertainty", "resource_estimate"):
        say("  %-17s %s" % (k, FRAMING[k]))
    owner_states_the_problem(con)
    say("\n  …the Owner has said the only thing it is going to say before the "
        "one question.")

    # ── PHASES 2–3 ───────────────────────────────────────────────────
    head("3. THE WORLD EVALUATES IT, ON THE MODEL")
    first = SUP.run(w, max_ticks=a.max_ticks)
    _steps(first)
    for e in EVAL_LOG:
        say("")
        say("  the evaluator answered (run #%s):" % e["run"])
        for ln in (e["answer"] or "").strip()[:600].splitlines():
            say("    | %s" % ln)
        say("  the world's own rules said %s%s"
            % (e["rules"], (" — " + "; ".join(e["rules_failed"])) if e["rules_failed"] else ""))
    o = con.execute("SELECT * FROM opportunities ORDER BY id LIMIT 1").fetchone()
    if o is None:
        say("\n  FIRST AUTONOMOUS PROJECT NOT DEMONSTRATED")
        say("    no opportunity was ever proposed")
        return 1
    if o["status"] == "REJECTED":
        head("VERDICT")
        say("  the evaluator refused the opportunity, and the world stopped.")
        say("  why: %s" % (o["decision_why"] or "-"))
        say("")
        say("  FIRST AUTONOMOUS PROJECT NOT DEMONSTRATED")
        say("    A refusal is a real outcome and it is recorded as one. Nothing")
        say("    was manufactured to get past it.")
        return 1

    pending = con.execute("SELECT * FROM approvals WHERE decision IS NULL "
                          "ORDER BY id LIMIT 1").fetchone()
    if pending is None:
        say("\n  FIRST AUTONOMOUS PROJECT NOT DEMONSTRATED")
        say("    the world never stopped to ask; there is no approval to answer")
        return 1

    head("4. THE OWNER'S ONE DECISION")
    say("  approval #%d      %s" % (pending["id"], pending["question"]))
    say("  why               %s" % (pending["why"] or "-")[:150])
    mark_q = con.execute("SELECT COALESCE(MAX(id),0) m FROM world_queue").fetchone()["m"]
    mark_e = con.execute("SELECT COALESCE(MAX(id),0) m FROM events").fetchone()["m"]
    owner_answers(con, pending["id"], a.owner_says.upper())
    say("  the Owner said    %s" % a.owner_says.upper())
    A.go_away(con, "the project runs unattended from here")
    say("  and then left. Nothing below this line is the Owner's.")

    # ── PHASES 4–8 ───────────────────────────────────────────────────
    head("5. THE RUNTIME CARRIES IT FROM THERE")
    carried = SUP.resume_if_the_owner_decided(w)
    say("  housekeeping carried the decision forward: %s" % (carried or "nothing"))
    second = SUP.run(w, max_ticks=a.max_ticks)
    _steps(second)
    say("\n  %d + %d ticks, quiet=%s" % (first["ticks"], second["ticks"],
                                         second["quiet"]))
    say("  model calls used  %d of %d" % (cap.calls, cap.max_calls))
    if cap.refusals:
        say("  cap refusals      %s" % cap.refusals[0][:70])
    return report(con, cap, rec, o["id"], mark_q, mark_e, second)


def _steps(res):
    for step in res["steps"]:
        r = step.get("result") or {}
        extra = ""
        for k in ("agent", "artifact", "verdict", "passed", "status", "awaiting_owner",
                  "escalated", "skill_gap", "next", "ready", "held", "corrections",
                  "correction", "error", "no_artifact", "budget_stop", "deferred"):
            if k in r and r[k] not in (None, [], "", {}):
                extra += " %s=%s" % (k, str(r[k])[:44])
        say("  %-20s %s" % (step["kind"], extra.strip()))


# ── what the Owner specifies: the bar, and how the work is briefed ───
def _requirements_for(task):
    """The acceptance bar: a list of (label, predicate over the artifact body).

    That shape is not a style choice — it is the contract `verify_artifact`
    reads, and the third run died on getting it wrong. This returned dicts of
    `{requirement, kind, value}`, a shape nothing in this repository consumes;
    the briefing rendered it happily and `for label, pred in requirements`
    raised `ValueError: too many values to unpack (expected 2)` the moment an
    artifact arrived. The artifact was fine and would have passed. The code that
    checks it could not run, so nothing downstream existed: no verification, no
    review, no acceptance.

    The second label says exactly what its predicate tests. A label that
    promises more than the code checks is the same defect in a quieter form."""
    return [("names the source file it read", lambda b: "MULTI_AGENT" in b),
            ("is not a stub: at least 200 characters",
             lambda b: len((b or "").strip()) > 200)]


def _instruction_for(task):
    """The objective, the source, and the bar — and nothing beyond them.

    The source path is here because the Owner supplies the source to work from;
    that is part of the specification, not a decision taken away from the agent.
    Leaving it out is not restraint, it is an unperformable task: the first real
    run spent six model calls and two corrections on `READ_REPO MULTI_AGENT.md`,
    which resolved against the repository root — in scope, allowed, and the
    wrong file — while the runtime had the full path in its own queue payload
    the whole time. The agent still chooses every tool, every path it reads
    beyond this one, and every word it writes."""
    bar = ", ".join(label for label, _ in _requirements_for(task))
    return ("%s\n\nThe source file is at: %s\n\n"
            "Your artifact is checked by code you cannot reach, which tests for "
            "exactly this and nothing else: %s.\n\n"
            "Your briefing lists the tools you hold and what you have already "
            "done. Decide what to do next.\n\n"
            "Writing a file is NOT submitting it: the artifact counts only once "
            "you declare it by name, and your turn ends when you do."
            % (task["objective"], SIGNAL, bar))


def _review_for(w, art, task, ver, unmet):
    """The Reviewer, on the model, through the shared verdict rule."""
    from real_world_demo import gemini_review
    return gemini_review(w, art, task, ver, unmet)


def report(con, cap, rec, opp_id, mark_q, mark_e, res):   # noqa: C901
    ok = {}
    p = con.execute("SELECT * FROM projects ORDER BY id LIMIT 1").fetchone()
    if p is None:
        head("VERDICT")
        say("  FIRST AUTONOMOUS PROJECT NOT DEMONSTRATED")
        say("    the approval was answered and no project was opened")
        return 1
    pid = p["id"]
    book = passport(con, pid, opp_id)

    head("6. THE TEAM, AND WHY EACH SEAT EXISTS")
    caps_needed = book["opportunity"]["required_caps"]
    say("  required          %s" % ", ".join(caps_needed))
    for m in book["team"]:
        say("    %-18s covers %-22s" % (m["agent"], m["seat"]))
    gap = A.detect_skill_gap(con, caps_needed)
    say("  capability gap    %s" % (", ".join(gap) if gap else "none"))
    ok["team formation came from requirements"] = bool(book["team"]) and not gap

    head("7. THE TASK GRAPH THE WORLD WROTE")
    for t in book["tasks"]:
        deps = [e["depends_on"] for e in book["task_graph"] if e["task"] == t["id"]]
        row = con.execute("SELECT required_caps, token_budget FROM tasks WHERE id=?",
                          (t["id"],)).fetchone()
        say("  task #%-3d %-9s %-28s" % (t["id"], t["status"], t["objective"][:28]))
        say("            needs %-14s owner %-16s after %s"
            % (",".join(json.loads(row["required_caps"] or "[]")) or "-",
               t["assignee"] or "-", deps or "-"))
    ok["a dependency-aware task graph was created"] = bool(book["task_graph"])

    head("8. WHAT THE AGENTS ACTUALLY DID")
    runs = [dict(r) for r in con.execute("SELECT * FROM runs ORDER BY id")]
    by_agent = {}
    for r in runs:
        by_agent.setdefault(r["principal_id"], []).append(r)
    ok["every run is a model run"] = bool(runs) and all(r["source"] == "model" for r in runs)
    ok["no MockProvider"] = not any(r["source"] == "mock" for r in runs)
    ok["no ReactiveWorker"] = all(r["provider"] for r in runs)
    say("  runs              %d, all source='model': %s"
        % (len(runs), ok["every run is a model run"]))
    for ag, rs in sorted(by_agent.items()):
        say("    %-18s %d call(s) on %s" % (ag, len(rs), rs[0]["model"]))
    calls = [dict(c) for c in con.execute("SELECT * FROM tool_calls ORDER BY id")]
    for c in calls:
        say("    TOOL %-18s %-16s %-6s" % (c["principal_id"], c["cap"], c["decision"]))
    ok["real tool use occurred"] = any(c["decision"] == "ALLOW" for c in calls)
    msgs = [dict(m) for m in con.execute(
        "SELECT * FROM agent_messages WHERE authority='agent' AND kind<>'ASSIGN' "
        "ORDER BY id")]
    for m in msgs:
        say("    MSG  %s → %s (%s)" % (m["sender"], m["recipient"], m["kind"]))
    ok["agents executed the tasks"] = len({r["principal_id"] for r in runs}) >= 2
    ok["artifacts persisted"] = bool(book["artifacts"])
    for art in book["artifacts"]:
        say("    ART  #%d %-18s by %-18s sha %s source=%s"
            % (art["id"], art["name"], art["by"], art["sha"][:12], art["source"]))

    head("9. VERIFICATION, REVIEW, CORRECTION")
    for v in book["verifications"]:
        say("  verification      %s passed=%s" % (v["provenance"], v["passed"]))
    ok["independent verification occurred"] = bool(book["verifications"])
    for r in book["reviews"]:
        say("  review #%-3d       artifact #%d %s by %s"
            % (r["id"], r["artifact_id"], r["verdict"], r["reviewer"]))
    ok["independent review occurred"] = bool(book["reviews"])
    produced = {x["by"] for x in book["artifacts"]}
    ok["the reviewer never produced the work"] = REV not in produced
    say("  corrections       %s" % (book["corrections"] or "none — nothing was rejected"))

    head("10. WHAT THE PROJECT LEARNED")
    for l in book["lessons"]:
        say("  lesson #%-3d       %s" % (l["id"], l["text"][:66]))
        say("                    task=%s project=%s failure=%s evidence=%s"
            % (l["task"], l["project"], l["failure"], l["evidence"]))
    if not book["lessons"]:
        say("  none. Nothing failed, so there is nothing to have learned, and a")
        say("  lesson written anyway would be decoration.")
    ok["memory is real or honestly absent"] = all(
        l["failure"] for l in book["lessons"])

    head("11. THE PROJECT PASSPORT")
    say("  opportunity #%-3d  %s" % (book["opportunity"]["id"],
                                     book["opportunity"]["problem"][:62]))
    say("  origin            %s" % book["opportunity"]["framing"].get("origin", "-")[:66])
    say("  evidence          %s" % (book["opportunity_evidence"] or "none"))
    say("  approval          %s" % [(x["id"], x["decision"]) for x in book["approval"]])
    say("  team              %s" % ", ".join(m["agent"] for m in book["team"]))
    say("  tasks             %s" % [(t["id"], t["status"]) for t in book["tasks"]])
    say("  graph             %s" % (book["task_graph"] or "none"))
    say("  artifacts         %s" % [x["id"] for x in book["artifacts"]])
    say("  verifications     %s" % [(v["id"], v["passed"]) for v in book["verifications"]])
    say("  reviews           %s" % [(r["id"], r["verdict"]) for r in book["reviews"]])
    say("  corrections       %s" % [c["id"] for c in book["corrections"]])
    say("  lessons           %s" % [l["id"] for l in book["lessons"]])
    say("  final state       %s" % book["status"])
    say("  unresolved        %s" % (book["unresolved"] or "nothing outstanding"))
    ok["the passport carries the whole history"] = all(
        book.get(k) is not None for k in
        ("opportunity", "opportunity_evidence", "approval", "team", "tasks",
         "task_graph", "artifacts", "verifications", "reviews", "corrections",
         "lessons", "status", "unresolved"))

    head("12. WHAT THE OWNER DID AFTER APPROVING")
    after_q = [dict(r) for r in con.execute(
        "SELECT * FROM world_queue WHERE emitted_by='OWNER' AND id>?", (mark_q,))]
    after_e = [dict(r) for r in con.execute(
        "SELECT * FROM events WHERE actor='OWNER' AND id>?", (mark_e,))]
    say("  owner commands    %d" % len(after_q))
    for e in after_e:
        say("  owner event       %s (%s)" % (e["kind"], e["subject"]))
    say("  (the two events above are the decision itself and the Owner leaving;")
    say("   neither creates a task, a team, an assignment or a message.)")
    ok["zero owner commands after approval"] = not after_q
    ok["no owner-authored work after approval"] = all(
        e["kind"] in ("OWNER_DECIDED", "OWNER_AWAY") for e in after_e)
    ok["the owner approved exactly once"] = len(
        [x for x in book["approval"] if x["decision"]]) == 1
    ok["no agent answered for the owner"] = all(
        e["actor"] == "OWNER" for e in con.execute(
            "SELECT actor FROM events WHERE kind='OWNER_DECIDED'"))

    head("13. COMPLETION INTEGRITY")
    state, why, accounted = book["completion"]["state"], book["completion"]["why"], \
        book["completion"]["accounted"]
    say("  workflow state    %s" % state)
    say("  because           %s" % why)
    ok["nothing is left unfinished without the record saying why"] = (
        state == COMPLETE or accounted)

    head("14. PROVENANCE, REBUILT FROM ROWS")
    chain = A.world_causality(con)
    for l in chain[:18]:
        say("  %-12s #%-4s %-16s %s" % (l["link"], l["id"], l["actor"] or "-",
                                        str(l["detail"])[:54]))
    seen, missing = A.causality_covers(con)
    say("  links present     %s" % ", ".join(seen))
    say("  links missing     %s" % (", ".join(missing) or "none"))
    ok["provenance reconstructs the chain"] = bool(chain) and "project" in seen

    ok["the opportunity exists"] = True
    ok["the opportunity says where it came from"] = str(
        book["opportunity"]["framing"].get("origin", "")).startswith("INTERNALLY DERIVED")
    # No evidence row without a gateway call or an artifact under it. "Evidence"
    # that names nothing is the failure mode this world exists to refuse.
    ok["no evidence stands on nothing"] = all(
        (e["external_provenance"] or "").startswith(("READ_REPO@", "artifact:",
                                                     "WRITE_ARTIFACT@", "SEND_MESSAGE@"))
        for e in con.execute("SELECT external_provenance FROM evidence"))
    ok["its evidence is recorded"] = book["opportunity_evidence"] is not None
    ok["the evaluation used a real model"] = bool(EVAL_LOG) and all(
        e["run"] for e in EVAL_LOG)
    ok["a proposal was put to the owner"] = bool(book["approval"])
    ok["the cap was never exceeded"] = cap.calls <= cap.max_calls
    ok["benchmark history is untouched"] = not con.execute(
        "SELECT 1 FROM bench_runs LIMIT 1").fetchone()

    head("VERDICT")
    for k, v in ok.items():
        say("  [%s] %s" % ("PASS" if v else "FAIL", k))
    passed = all(ok.values())
    say("")
    if passed:
        say("  FIRST AUTONOMOUS PROJECT DEMONSTRATED · workflow %s" % state)
        say("    One objective, one approval, %d model calls, and the runtime did"
            % cap.calls)
        say("    the rest. This is one project, not an organisation.")
        if state != COMPLETE:
            say("    The project did not finish: %s." % why)
        return 0 if state == COMPLETE else 2
    say("  FIRST AUTONOMOUS PROJECT NOT DEMONSTRATED · workflow %s" % state)
    for k, v in ok.items():
        if not v:
            say("    failed: %s" % k)
    return 1


if __name__ == "__main__":
    sys.exit(main())
