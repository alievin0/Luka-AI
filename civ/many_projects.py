#!/usr/bin/env python3
"""MULTI-PROJECT AUTONOMY — three projects, three approvals, then silence.

    CIV_PROVIDER=gemini CIV_ASSUME_FREE=1 CIV_MODEL=gemini-3.1-flash-lite \
        CIV_MAX_CALLS=8 python3 many_projects.py

`first_project.py` carried ONE opportunity from a repository signal to an
outcome without being told the steps. The question here is whether that was a
workflow or a path: three opportunities, from three different files, with three
different capability requirements, running in one world at the same time.

Three things make it a harder question than doing the same thing three times.

**The graph has to come from the requirements.** `always_on.PLAN` is a fixed
two-step template. Three projects handed the same two tasks would prove only
that a script ran three times, so the plan is built here from each
opportunity's own `required_caps`: one task, two chained tasks, one task — and
three differently-shaped teams, because `plan_team` covers what the work
declares it needs.

**The allowance has to be per project.** `CIV_MAX_CALLS` is what ONE project
may spend here, not what all of them share. A shared cap would mean the first
project to run drains the third, and the third's honest report would be about a
neighbour it never touched.

**Stopping has to be per project.** `completion_state` is asked of each project
separately. A project that ran out of allowance is QUOTA_EXHAUSTED; one that
did not is COMPLETE; and neither answer is allowed to explain away the other.

The Owner states three problems and answers three questions. Every other
transition — evaluation, proposal, team, graph, assignment, execution,
verification, review, correction, lesson, completion — is the runtime's. §10
counts what the Owner did afterwards and the number has to be zero.
"""
import argparse
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import agent_world as W              # noqa: E402
from core import always_on as A                # noqa: E402
from core import provider as P                 # noqa: E402
from core import spend as SPEND                # noqa: E402
from core import store                         # noqa: E402
from core import world_bus as BUS              # noqa: E402
from core import world_policy as POL           # noqa: E402
from core import world_supervisor as SUP       # noqa: E402
from real_world_demo import (                  # noqa: E402
    COMPLETE, QUOTA, Recorder, _quota_failure, completion_state, head, say)
import first_project as FP                     # noqa: E402

REV = SUP.REV

# ── PHASE 1 · three signals, three opportunities ─────────────────────
# Real files in this repository, each making a claim about itself that the code
# can have outrun since it was written. None of these is a market, an invented
# customer or a hypothetical: each is a document that is read by people
# deciding whether to trust this work, and whether it is still true is a
# question with a checkable answer that nobody has checked.
#
# `caps` is what the work requires, and it is the ONLY thing that decides the
# shape of the team and of the task graph. The three differ on purpose.
SIGNALS = (
    dict(
        n=1, file="README.md", caps=["research"],
        objective="Establish whether the status table in civ/README.md still "
                  "matches this directory, and name what has changed since it "
                  "was written.",
        framing={
            "origin": "INTERNALLY DERIVED from a repository signal: README.md "
                      "is the first file anyone opens here and it states, in a "
                      "table, what is implemented and tested. No external "
                      "market evidence exists for this and none is claimed.",
            "value": "A front page that overstates what works costs more than "
                     "no front page, because it is believed.",
            "uncertainty": "Whether the table and the test counts still agree "
                           "with the directory is unknown until the file is "
                           "read. It may be entirely correct.",
            "resource_estimate": "a single-digit number of model calls on a "
                                 "free tier, bounded by this project's own cap",
        }),
    dict(
        n=2, file="EMBODIED_WORLD.md", caps=["research", "build"],
        objective="Establish which claims EMBODIED_WORLD.md makes about the "
                  "one-directional chain from rows to renderer still hold, and "
                  "recommend what should change.",
        framing={
            "origin": "INTERNALLY DERIVED from a repository signal: "
                      "EMBODIED_WORLD.md asserts that every arrow from the "
                      "runtime to the 3D world points one way and that no path "
                      "runs back. That is an architectural guarantee stated in "
                      "prose, which is where such guarantees quietly lapse.",
            "value": "An invariant nobody rechecks is an invariant only until "
                     "someone writes the first edge back.",
            "uncertainty": "Whether the document still describes the code is "
                           "unknown until both are read. The claim may hold "
                           "exactly as written.",
            "resource_estimate": "a single-digit number of model calls on a "
                                 "free tier, bounded by this project's own cap",
        }),
    dict(
        n=3, file="OWNERSHIP_AND_INDEPENDENCE.md", caps=["build"],
        objective="Produce a written statement of the dependencies "
                  "OWNERSHIP_AND_INDEPENDENCE.md says this system has, and of "
                  "what it claims happens when each of them disappears.",
        framing={
            "origin": "INTERNALLY DERIVED from a repository signal: "
                      "OWNERSHIP_AND_INDEPENDENCE.md answers what the Owner "
                      "would still have if every company involved vanished. "
                      "Nothing in the repository states that answer in one "
                      "place at a length anyone will read.",
            "value": "The dependency list is the thing the Owner is actually "
                     "buying, and it is currently spread through a long "
                     "document nobody quotes.",
            "uncertainty": "Whether the document names dependencies it no "
                           "longer has, or has ones it does not name, is "
                           "unknown until it is read against the code.",
            "resource_estimate": "a single-digit number of model calls on a "
                                 "free tier, bounded by this project's own cap",
        }),
)


def signal_path(sig):
    return os.path.join(HERE, sig["file"])


def chain_for(con, sig):
    """This objective's own bounded cascade — reused, never re-opened.

    A chain per objective is what keeps three projects from spending each
    other's ceilings, and reusing an existing one by origin is what keeps a
    restart from starting a fourth. The chain id is part of every queue row's
    dedupe key, so a second chain for the same objective would make every
    already-queued event look new and the whole project would run twice."""
    origin = "objective:%d" % sig["n"]
    row = con.execute("SELECT id FROM chains WHERE origin=? ORDER BY id LIMIT 1",
                      (origin,)).fetchone()
    if row is not None:
        return row["id"], False
    return POL.open_chain(con, origin, sig["objective"],
                          max_tasks=8, max_events=120, max_depth=40), True


def owner_states_the_problem(con, sig, chain_id):
    """One of the Owner's three instructions. One row on the queue.

    Returns (queue_id, created). `created` is False when this exact objective
    is already queued, which is what makes re-running this file against an
    existing world a resume rather than a second world's worth of work."""
    return BUS.emit(con, "OWNER_OBJECTIVE", "objective:%d" % sig["n"],
                    {"objective": sig["objective"], "fixture": signal_path(sig),
                     "required_caps": list(sig["caps"]),
                     "interpretation": json.dumps(sig["framing"])},
                    by="OWNER", chain_id=chain_id)


# ── PHASE 4 · the task graph, built from what the project requires ───
# The vocabulary of steps is fixed and small; which of them a project gets, in
# what order, and how many, is read off that project's own `required_caps`.
# That is the difference between decomposing and replaying: a project that
# declares one capability gets one task, and no project gets a step for work it
# never said it needed.
STEP_FOR = {
    "research": dict(
        key="research", caps=["research"], evidence=1,
        objective="Investigate this and record evidence for each finding — "
                  "%(problem)s",
        conditions=["a findings artifact exists",
                    "it passes deterministic verification",
                    "an independent reviewer approved it"]),
    "build": dict(
        key="build", caps=["build"], evidence=0,
        objective="Produce an evidence-backed written answer — %(problem)s",
        conditions=["a written artifact exists",
                    "it passes deterministic verification",
                    "an independent reviewer approved it"]),
}

# The order work happens in when a project requires more than one capability.
STEP_ORDER = ("research", "build")


def plan_for(o):
    """The task graph this opportunity requires — one step per capability.

    Raises rather than silently dropping a capability it has no step for: a
    project that asked for work the planner cannot express should stop, not
    quietly become a smaller project that nobody agreed to."""
    caps = json.loads(o["required_caps"] or "[]")
    unknown = [c for c in caps if c not in STEP_FOR]
    if unknown:
        raise A.WorldError("no task step is defined for capability %s"
                           % ", ".join(sorted(unknown)))
    steps = [dict(STEP_FOR[c]) for c in STEP_ORDER if c in caps]
    if not steps:
        raise A.WorldError("an opportunity that requires no capability is not work")
    for earlier, later in zip(steps, steps[1:]):
        later["after"] = earlier["key"]
    return steps


# ── the source each project works from, read back out of the record ──
def source_of(con, project_id):
    """The file this project's objective named, from its own queue row.

    The fixture travels in the payload from OWNER_OBJECTIVE all the way to
    PROJECT_OPENED, so it is persisted, per project, and there is nothing to
    look up in this file. Three projects cannot share one hard-coded SIGNAL,
    and inferring the source from the objective's wording would be reading
    prose where there is a row."""
    row = con.execute("SELECT payload FROM world_queue WHERE kind='PROJECT_OPENED' "
                      "AND subject=? ORDER BY id LIMIT 1",
                      ("project:%d" % project_id,)).fetchone()
    return (json.loads(row["payload"] or "{}") or {}).get("fixture") if row else None


def source_for_task(con, task):
    src = source_of(con, task["project_id"]) if task["project_id"] else None
    if not src:
        raise A.WorldError(
            "task #%s names no source: nothing in the record says which file "
            "project %s was opened to read" % (task["id"], task["project_id"]))
    return src


def requirements_for(con, task):
    """The acceptance bar, as (label, predicate) pairs over the artifact body.

    Derived per project from the file that project was opened to read. The
    single-project version tested for the literal string `MULTI_AGENT`, which
    is the correct bar for exactly one of the three projects here and a bar
    two of them could never pass."""
    name = os.path.basename(source_for_task(con, task)).split(".")[0]
    return [("names the source file it read (%s)" % name, lambda b: name in b),
            ("is not a stub: at least 200 characters",
             lambda b: len((b or "").strip()) > 200)]


def instruction_for(con, task):
    """The objective, this project's source, and this project's bar."""
    bar = ", ".join(label for label, _ in requirements_for(con, task))
    return ("%s\n\nThe source file is at: %s\n\n"
            "Your artifact is checked by code you cannot reach, which tests for "
            "exactly this and nothing else: %s.\n\n"
            "Your briefing lists the tools you hold and what you have already "
            "done. Decide what to do next.\n\n"
            "Writing a file is NOT submitting it: the artifact counts only once "
            "you declare it by name, and your turn ends when you do."
            % (task["objective"], source_for_task(con, task), bar))


# ── the allowance, one per project ───────────────────────────────────
class Lanes:
    """One `SPEND.Cap` per project, so one project cannot spend another's.

    A lane is named by the OPPORTUNITY, not the project, because the first call
    charged to a project happens before the project exists: judging whether the
    opportunity is worth doing is that project's work and its cost. The name
    survives the transition — `projects.origin` is `opportunity:N` — so the
    evaluation and everything after it are charged to the same allowance.

    Calls that belong to no project at all fall to the `world` lane, which is
    given its own cap rather than being allowed to draw on somebody's."""

    WORLD = "world"

    def __init__(self, make_cap=None):
        self.make_cap = make_cap or SPEND.Cap.from_env
        self.caps = {}
        self.current = None

    def cap(self, key):
        return self.caps.setdefault(key or self.WORLD, self.make_cap())

    def key_for_task(self, con, task):
        if task is None or task["project_id"] is None:
            return self.current
        row = con.execute("SELECT origin FROM projects WHERE id=?",
                          (task["project_id"],)).fetchone()
        return row["origin"] if row and row["origin"] else self.current

    def charging(self, opp_id):
        return _Charging(self, "opportunity:%d" % opp_id)

    def report(self):
        return {k: {"calls": c.calls, "max_calls": c.max_calls,
                    "refusals": list(c.refusals)}
                for k, c in sorted(self.caps.items())}


class _Charging:
    """Names the lane for work that has no task to name it — the evaluation."""

    def __init__(self, lanes, key):
        self.lanes, self.key, self.was = lanes, key, None

    def __enter__(self):
        self.was, self.lanes.current = self.lanes.current, self.key
        self.lanes.cap(self.key)            # the lane exists even if nothing runs
        return self.lanes

    def __exit__(self, *exc):
        self.lanes.current = self.was
        return False


# ── the census, for proving a restart repeated nothing ───────────────
CENSUS = ("projects", "tasks", "task_deps", "teams", "team_members", "artifacts",
          "reviews", "runs", "evidence", "opportunities", "discoveries",
          "approvals", "lessons", "chains", "world_queue")

# What a second run would duplicate if it were starting over instead of
# resuming. Tasks, artifacts, runs and queue rows are deliberately NOT in this
# set: work that was still pending when the first pass stopped gets finished by
# the second, and finishing pending work is the opposite of repeating it. What
# must never appear twice is the identity of the work — a second project for
# the same objective, a second opportunity, a second chain, a second team, a
# second question put to the Owner.
NEVER_TWICE = ("projects", "opportunities", "discoveries", "chains", "teams",
               "team_members", "approvals")


def census(con):
    return {t: con.execute("SELECT COUNT(*) c FROM %s" % t).fetchone()["c"]
            for t in CENSUS}


# ── the run ──────────────────────────────────────────────────────────
def main(argv=None, provider=None):                             # noqa: C901
    """The whole run. `provider` is injected only by the tests.

    A run driven by a scripted double is founded in `simulation`, because that
    double's runs are tagged `source='mock'` and LAW 2 refuses those in a live
    world. Such a run exercises every branch of this file and proves nothing
    about a model, and the verdict at the bottom says exactly that rather than
    borrowing the word DEMONSTRATED from a run that did not happen."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=None)
    ap.add_argument("--max-ticks", type=int, default=120)
    ap.add_argument("--owner-says", default="APPROVE",
                    help="the one word the Owner answers each question with")
    a = ap.parse_args(argv)

    head("1. WHAT IS ANSWERING")
    live = provider or P.from_env()
    say("  CIV_PROVIDER      %s" % (os.environ.get("CIV_PROVIDER") or "(unset)"))
    say("  provider          %s" % live.name)
    say("  model             %s" % getattr(live, "model", "-"))
    say("  source            %s" % live.source)
    say("  available         %s" % live.available())
    real = live.available() and live.source == "model"
    if provider is None and not real:
        say("\n  MULTI-PROJECT AUTONOMY NOT DEMONSTRATED")
        say("    no provider whose source is 'model' answered: %s"
            % (live.why_unavailable() or "-"))
        return 1

    lanes = Lanes()
    probe = SPEND.Cap.from_env()
    say("  cap per project   %d model calls (CIV_MAX_CALLS), not shared"
        % probe.max_calls)

    con = store.connect(a.db or os.path.join(tempfile.mkdtemp(), "projects.db"))
    resumed = bool(store.meta(con, "founded"))
    if not resumed:
        store.found(con, mode="live" if real else "simulation")
    gw = W.build_gateway(con)
    W.found_agents(con)
    POL.seed(con)
    say("  world mode        %s  (LAW 2 refuses a mock run in it)"
        % store.meta(con, "mode"))
    say("  world             %s" % ("resumed from an existing database"
                                    if resumed else "founded now"))

    rec = Recorder(live)

    def provider_for(agent, task, attempt):
        return SPEND.Budgeted(rec.acting(agent),
                              cap=lanes.cap(lanes.key_for_task(con, task)))

    def evaluate_for(w, opp_id, chain_id=None):
        # The evaluation is the first thing this project spends, and it is
        # charged to the project's own lane rather than to a shared pool.
        with lanes.charging(opp_id):
            return FP.gemini_evaluate(w, opp_id, chain_id=chain_id)

    w = SUP.World(con, gw, provider_for=provider_for,
                  requirements_for=lambda t: requirements_for(con, t),
                  instruction_for=lambda t: instruction_for(con, t),
                  evaluate_for=evaluate_for, gate_for=FP.owner_gate,
                  review_for=FP._review_for, plan_for=plan_for,
                  worker="many-projects")

    # ── PHASE 1 ──────────────────────────────────────────────────────
    head("2. THREE OPPORTUNITIES, FROM THREE REPOSITORY SIGNALS")
    for sig in SIGNALS:
        path = signal_path(sig)
        chain_id, opened = chain_for(con, sig)
        qid, created = owner_states_the_problem(con, sig, chain_id)
        sig["chain_id"], sig["queue_id"] = chain_id, qid
        say("  objective:%d       %s" % (sig["n"], sig["objective"][:58]))
        say("    signal          %s (%d bytes on disk)"
            % (sig["file"], os.path.getsize(path)))
        say("    requires        %s" % ", ".join(sig["caps"]))
        say("    origin          %s" % sig["framing"]["origin"][:58])
        say("    chain #%-4s     %s · queue #%s %s"
            % (chain_id, "opened" if opened else "reused", qid,
               "queued" if created else "already queued — not repeated"))
    say("\n  …the Owner has said the only thing it is going to say before the "
        "three questions.")

    # ── PHASES 2–3 ───────────────────────────────────────────────────
    head("3. THE WORLD EVALUATES EACH ONE, ON THE MODEL")
    first = SUP.run(w, max_ticks=a.max_ticks)
    _steps(first)
    for e in FP.EVAL_LOG:
        say("")
        say("  opportunity #%s — the evaluator answered (run #%s):"
            % (e["opportunity"], e["run"]))
        for ln in (e["answer"] or "").strip()[:420].splitlines():
            say("    | %s" % ln)
        say("    the world's own rules said %s%s"
            % (e["rules"],
               (" — " + "; ".join(e["rules_failed"])) if e["rules_failed"] else ""))
    opps = [dict(o) for o in con.execute("SELECT * FROM opportunities ORDER BY id")]
    say("")
    for o in opps:
        say("  opportunity #%-3d %-10s %s"
            % (o["id"], o["status"], (o["decision_why"] or "")[:52]))
    if not opps:
        say("\n  MULTI-PROJECT AUTONOMY NOT DEMONSTRATED")
        say("    no opportunity was ever proposed")
        return 1

    # ── PHASE 3 ──────────────────────────────────────────────────────
    head("4. THE OWNER'S DECISIONS — ONE PER ACCEPTED OPPORTUNITY")
    pending = [dict(r) for r in con.execute(
        "SELECT * FROM approvals WHERE decision IS NULL ORDER BY id")]
    for q in pending:
        say("  approval #%-3d    %s" % (q["id"], q["question"]))
    if not pending:
        say("  none: the world asked nothing, so there is nothing to answer.")
    for q in pending:
        FP.owner_answers(con, q["id"], a.owner_says.upper())
    say("  the Owner said    %s, once per question" % a.owner_says.upper())
    mark_q = con.execute("SELECT COALESCE(MAX(id),0) m FROM world_queue").fetchone()["m"]
    mark_e = con.execute("SELECT COALESCE(MAX(id),0) m FROM events").fetchone()["m"]
    A.go_away(con, "the projects run unattended from here")
    say("  and then left. Nothing below this line is the Owner's.")

    # ── PHASES 4–8 ───────────────────────────────────────────────────
    head("5. THE RUNTIME CARRIES THEM FROM THERE")
    carried = SUP.resume_if_the_owner_decided(w)
    say("  housekeeping carried %d decision(s) forward: %s"
        % (len(carried), carried or "nothing"))
    second = SUP.run(w, max_ticks=a.max_ticks)
    _steps(second)
    # `run` returns the WORLD's running total, not this pass's, so the second
    # number is a difference. Printing both totals read as a pass that did four
    # times the work it did.
    say("\n  %d ticks before the decisions, %d after, quiet=%s"
        % (first["ticks"], second["ticks"] - first["ticks"], second["quiet"]))
    for key, r in sorted(lanes.report().items()):
        say("  lane %-16s %d of %d call(s)%s"
            % (key, r["calls"], r["max_calls"],
               ("  · refused: " + r["refusals"][0][:44]) if r["refusals"] else ""))

    # ── PHASE 10 ─────────────────────────────────────────────────────
    head("6. THE SAME INPUTS, A SECOND TIME")
    say("  A restart re-states the same objectives against the same world. It")
    say("  must resume, not repeat: nothing below may create a row.")
    before = census(con)
    again = [owner_states_the_problem(con, s, s["chain_id"])[1] for s in SIGNALS]
    recarried = SUP.resume_if_the_owner_decided(w)
    third = SUP.run(w, max_ticks=20)
    after = census(con)
    moved = {t: (before[t], after[t]) for t in CENSUS if after[t] != before[t]}
    grew = {t: v for t, v in moved.items() if t in NEVER_TWICE}
    say("  objectives queued again          %s" % again)
    say("  decisions carried forward again  %s" % (recarried or "none"))
    say("  extra ticks                      %d"
        % (third["ticks"] - second["ticks"]))
    say("  any row count that moved         %s" % (moved or "none"))
    say("  work duplicated                  %s" % (grew or "none"))

    return report(con, lanes, mark_q, mark_e, again, grew, real)


def _steps(res):
    for step in res["steps"]:
        r = step.get("result") or {}
        extra = ""
        for k in ("agent", "artifact", "verdict", "passed", "status", "awaiting_owner",
                  "escalated", "skill_gap", "next", "ready", "held", "corrections",
                  "correction", "error", "no_artifact", "budget_stop", "deferred",
                  "waiting_for_model"):
            if k in r and r[k] not in (None, [], "", {}):
                extra += " %s=%s" % (k, str(r[k])[:40])
        say("  %-20s %s" % (step["kind"], extra.strip()))


# ── what the record says afterwards ──────────────────────────────────
def report(con, lanes, mark_q, mark_e, again, grew, real=True):  # noqa: C901
    ok = {}
    books = {}
    projects = [dict(p) for p in con.execute("SELECT * FROM projects ORDER BY id")]
    opp_of = {o["project_id"]: o["id"] for o in con.execute(
        "SELECT id, project_id FROM opportunities WHERE project_id IS NOT NULL")}

    head("7. EACH PROJECT'S PASSPORT, BUILT FROM ITS OWN ROWS")
    if not projects:
        say("  none: no approval became a project.")
    for p in projects:
        pid = p["id"]
        book = books[pid] = FP.passport(con, pid, opp_of[pid])
        src = source_of(con, pid)
        say("")
        say("  ── project #%d · %s" % (pid, p["name"][:56]))
        say("     source         %s" % (os.path.basename(src or "-")))
        say("     opportunity    #%s · %s" % (book["opportunity"]["id"],
                                              book["opportunity"]["status"]))
        say("     requires       %s" % ", ".join(book["opportunity"]["required_caps"]))
        say("     team           %s" % ", ".join(
            "%s(%s)" % (m["agent"], m["seat"]) for m in book["team"]))
        for t in book["tasks"]:
            deps = [e["depends_on"] for e in book["task_graph"] if e["task"] == t["id"]]
            say("     task #%-4d     %-9s %-30s after %s"
                % (t["id"], t["status"], t["objective"][:30], deps or "-"))
        for x in book["artifacts"]:
            say("     artifact #%-2d   %-16s by %-16s sha %s source=%s"
                % (x["id"], x["name"][:16], x["by"], x["sha"][:12], x["source"]))
        for v in book["verifications"]:
            say("     verification   %s passed=%s" % (v["provenance"], v["passed"]))
        for r in book["reviews"]:
            say("     review #%-4d   artifact #%d %s by %s"
                % (r["id"], r["artifact_id"], r["verdict"], r["reviewer"]))
        say("     corrections    %s" % ([c["id"] for c in book["corrections"]] or "none"))
        for l in book["lessons"]:
            say("     lesson #%-4d   %s" % (l["id"], l["text"][:56]))
        say("     approval       %s" % [(x["id"], x["decision"])
                                        for x in book["approval"]])
        say("     completion     %s — %s" % (book["completion"]["state"],
                                             book["completion"]["why"][:70]))
        seen, missing = A.causality_covers(con, project_id=pid)
        book["_links"] = (seen, missing)
        say("     causal links   %s" % ", ".join(seen))
        say("     links missing  %s" % (", ".join(missing) or "none"))

    ok["three projects were opened"] = len(projects) == 3
    ok["each project came from its own opportunity"] = (
        len(set(opp_of.values())) == len(projects) and len(opp_of) == len(projects))
    ok["each project reads its own source"] = len(
        {source_of(con, p["id"]) for p in projects}) == len(projects)
    ok["every project has a passport built from its rows"] = bool(books) and all(
        b.get(k) is not None for b in books.values() for k in
        ("opportunity", "opportunity_evidence", "approval", "team", "tasks",
         "task_graph", "artifacts", "verifications", "reviews", "corrections",
         "lessons", "status", "completion", "unresolved"))

    head("8. TEAMS AND GRAPHS CAME FROM REQUIREMENTS, NOT FROM A SCRIPT")
    shapes = {}
    for pid, b in books.items():
        caps = tuple(sorted(b["opportunity"]["required_caps"]))
        shape = (len(b["tasks"]), len(b["task_graph"]),
                 tuple(sorted(m["agent"] for m in b["team"])))
        shapes[pid] = (caps, shape)
        say("  project #%-3d requires %-22s → %d task(s), %d edge(s), %d seat(s)"
            % (pid, ",".join(caps), shape[0], shape[1], len(shape[2])))
    distinct_caps = {c for c, _ in shapes.values()}
    distinct_shapes = {s for _, s in shapes.values()}
    say("  distinct requirement sets   %d" % len(distinct_caps))
    say("  distinct graph/team shapes  %d" % len(distinct_shapes))
    # The graph is a FUNCTION of the requirements: different requirements must
    # give different shapes, and identical requirements must give identical
    # ones. A world that produced three identical graphs from three different
    # requirement sets would be replaying a script.
    ok["the graph follows the requirements"] = (
        bool(shapes) and len(distinct_shapes) == len(distinct_caps)
        and all(len(b["tasks"]) == len(b["opportunity"]["required_caps"])
                for b in books.values()))
    ok["every task is staffed by a seat on its own team"] = all(
        t["assignee"] in ([m["agent"] for m in b["team"]] + [None])
        for b in books.values() for t in b["tasks"])

    head("9. ISOLATION — NOTHING CROSSED BETWEEN PROJECTS")
    owned = {}
    for pid in books:
        owned[pid] = {
            "tasks": {t["id"] for t in books[pid]["tasks"]},
            "artifacts": {x["id"] for x in books[pid]["artifacts"]},
            "reviews": {r["id"] for r in books[pid]["reviews"]},
            "lessons": {l["id"] for l in books[pid]["lessons"]},
            "approvals": {x["id"] for x in books[pid]["approval"]},
            "runs": {r["id"] for r in con.execute(
                "SELECT id FROM runs WHERE task_id IN (SELECT id FROM tasks "
                "WHERE project_id=?)", (pid,))},
            "chain": {A.chain_of_project(con, pid)},
        }
    overlaps = []
    for kind in ("tasks", "artifacts", "reviews", "lessons", "approvals", "runs",
                 "chain"):
        for i, x in enumerate(sorted(owned)):
            for y in sorted(owned)[i + 1:]:
                shared = owned[x][kind] & owned[y][kind]
                if shared:
                    overlaps.append("%s #%d/#%d share %s" % (kind, x, y, sorted(shared)))
    for pid in sorted(owned):
        say("  project #%-3d owns %s" % (pid, ", ".join(
            "%d %s" % (len(v), k) for k, v in sorted(owned[pid].items())
            if k != "chain")))
        say("              chain %s, lane %s" % (
            A.chain_of_project(con, pid),
            con.execute("SELECT origin FROM projects WHERE id=?",
                        (pid,)).fetchone()["origin"]))
    say("  crossings         %s" % (overlaps or "none"))
    ok["no row belongs to two projects"] = not overlaps
    ok["each project ran on its own chain"] = len(
        {A.chain_of_project(con, pid) for pid in owned}) == len(owned)
    # What matters is that the allowances ARE separate, which is a fact about
    # rows: each project's lane is its own `projects.origin`. Counting the lanes
    # this process happened to open asks a different question and gets it wrong
    # on a resumed run, where nothing is spent because nothing is left to do.
    ok["each project has an allowance of its own"] = len(
        {con.execute("SELECT origin FROM projects WHERE id=?",
                     (pid,)).fetchone()["origin"] for pid in books}) == len(books)
    ok["no lane spent past its cap"] = all(
        c.calls <= c.max_calls for c in lanes.caps.values())
    # A project that stopped because ITS allowance ran out says so in its own
    # completion state, and says it about itself: the failure is scoped to the
    # runs of its own tasks, so a neighbour cannot inherit it and cannot be
    # excused by it.
    states = {pid: b["completion"]["state"] for pid, b in books.items()}
    starved = {pid: _quota_failure(con, pid) for pid in books}
    say("  completion states %s" % states)
    say("  allowance deaths  %s" % ({pid: v[0] for pid, v in starved.items() if v}
                                    or "none"))
    ok["every project accounts for itself"] = all(
        b["completion"]["state"] == COMPLETE or b["completion"]["accounted"]
        for b in books.values())
    # The real invariant, read off rows rather than off the sentence the state
    # came with: a project one of whose own runs died for want of allowance
    # either finished anyway, or is marked QUOTA_EXHAUSTED. It is never FAILED,
    # and it is never an unexplained INCOMPLETE.
    ok["a project stopped by its allowance says so"] = all(
        b["completion"]["state"] in (COMPLETE, QUOTA)
        for pid, b in books.items() if starved[pid])

    head("10. WHAT THE OWNER DID AFTER APPROVING")
    after_q = [dict(r) for r in con.execute(
        "SELECT * FROM world_queue WHERE emitted_by='OWNER' AND id>?", (mark_q,))]
    after_e = [dict(r) for r in con.execute(
        "SELECT * FROM events WHERE actor='OWNER' AND id>?", (mark_e,))]
    say("  owner commands    %d" % len(after_q))
    for e in after_e:
        say("  owner event       %s (%s)" % (e["kind"], e["subject"]))
    decided = [dict(r) for r in con.execute(
        "SELECT * FROM approvals WHERE decision IS NOT NULL ORDER BY id")]
    say("  approvals decided %s" % [(x["id"], x["decision"]) for x in decided])
    ok["zero owner commands after approval"] = not after_q
    ok["no owner-authored work after approval"] = all(
        e["kind"] in ("OWNER_DECIDED", "OWNER_AWAY") for e in after_e)
    ok["exactly one owner approval per project"] = bool(books) and all(
        len([x for x in b["approval"] if x["decision"]]) == 1 for b in books.values())
    ok["no agent answered for the owner"] = all(
        e["actor"] == "OWNER" for e in con.execute(
            "SELECT actor FROM events WHERE kind='OWNER_DECIDED'"))

    head("11. WHAT THE AGENTS ACTUALLY DID")
    runs = [dict(r) for r in con.execute("SELECT * FROM runs ORDER BY id")]
    by_agent = {}
    for r in runs:
        by_agent.setdefault(r["principal_id"], []).append(r)
    for ag, rs in sorted(by_agent.items()):
        say("  %-20s %d call(s) on %s" % (ag, len(rs), rs[0]["model"]))
    calls = [dict(c) for c in con.execute("SELECT * FROM tool_calls ORDER BY id")]
    for c in calls:
        say("  TOOL %-18s %-16s %-6s" % (c["principal_id"], c["cap"], c["decision"]))
    # LAW 2 is what actually enforces this — a live world refuses a mock run
    # and a simulation world refuses a model one — so the check is that every
    # run is tagged for what really answered it, whichever that was. The second
    # line is the one that cannot be satisfied by relabelling: a run may never
    # say a model produced it unless one did.
    want = "model" if real else "mock"
    ok["every run is tagged source=%s" % want] = bool(runs) and all(
        r["source"] == want for r in runs)
    ok["no run claims a model that did not answer"] = real or not any(
        r["source"] == "model" for r in runs)
    ok["real tool use occurred"] = any(c["decision"] == "ALLOW" for c in calls)
    produced = {x["by"] for b in books.values() for x in b["artifacts"]}
    ok["the reviewer never produced the work"] = REV not in produced
    ok["verification ran on the artifact's own sha"] = bool(books) and all(
        v["provenance"].split("@")[1][:12] == art["sha"][:12]
        for b in books.values() for art in b["artifacts"]
        for v in b["verifications"]
        if v["provenance"].startswith("artifact:%d@" % art["id"]))
    ok["every lesson names a real failure"] = all(
        l["failure"] for b in books.values() for l in b["lessons"])

    head("12. THE RESTART REPEATED NOTHING")
    say("  objectives re-queued as new     %s" % again)
    say("  work duplicated                 %s" % (grew or "none"))
    ok["a restart queues no duplicate objective"] = not any(again)
    ok["a restart duplicates no work"] = not grew

    head("13. NOTHING ELSE WAS TOUCHED")
    ok["benchmark history is untouched"] = not con.execute(
        "SELECT 1 FROM bench_runs LIMIT 1").fetchone()
    ok["no evidence stands on nothing"] = all(
        (e["external_provenance"] or "").startswith(
            ("READ_REPO@", "artifact:", "WRITE_ARTIFACT@", "SEND_MESSAGE@"))
        for e in con.execute("SELECT external_provenance FROM evidence"))
    world = completion_state(con)
    ok["the world-wide answer accounts for itself too"] = (
        world[0] in (COMPLETE, QUOTA) or world[2])
    say("  world-wide state  %s — %s" % world[:2])
    say("  (the per-project answers in §7 are the authoritative ones: asked of")
    say("   the whole world, a project that produced nothing is invisible behind")
    say("   neighbours that produced everything.)")

    head("VERDICT")
    for k, v in ok.items():
        say("  [%s] %s" % ("PASS" if v else "FAIL", k))
    done = [pid for pid, s in states.items() if s == COMPLETE]
    say("")
    say("  projects COMPLETE %d of %d %s" % (len(done), len(books), done))
    for pid, b in sorted(books.items()):
        if b["completion"]["state"] != COMPLETE:
            say("    project #%d stopped %s: %s"
                % (pid, b["completion"]["state"], b["completion"]["why"][:90]))
    if not all(ok.values()):
        say("\n  MULTI-PROJECT AUTONOMY NOT DEMONSTRATED")
        for k, v in ok.items():
            if not v:
                say("    failed: %s" % k)
        return 1
    if not real:
        say("\n  SHAPE EXERCISED, NOT DEMONSTRATED")
        say("    Every check above holds, and every run behind them is tagged")
        say("    source='mock' in a simulation world. This says what the")
        say("    workflow does; it says nothing about what a model did.")
        return 0 if len(done) == len(books) else 2
    if len(done) == len(books) == 3:
        say("\n  MULTI-PROJECT AUTONOMY DEMONSTRATED")
        say("    Three opportunities, three approvals, three isolated projects,")
        say("    and the Owner issued no command after the last answer.")
        return 0
    say("\n  MULTI-PROJECT AUTONOMY PARTIALLY DEMONSTRATED")
    say("    Every check above holds and the record accounts for every project,")
    say("    but %d of %d finished. A project that stopped is reported as having"
        % (len(done), len(books)))
    say("    stopped; nothing was manufactured to get past it.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
