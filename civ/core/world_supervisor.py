"""THE WORLD SUPERVISOR — what keeps going when the Owner stops typing.

    WORLD EVENT → eligible work → wake an agent → bounded work → persist
    → emit event → reevaluate → continue

The supervisor is deterministic Python. It never asks a model whether the system
may run, which agent may act, whether an opportunity is worth pursuing, or
whether work is done. A model writes the CONTENT of an artifact and nothing
else; every fork in this file is decided against rows.

That is not a stylistic preference. In an always-on world the model's output
arrives while nobody is reading it, so any decision a model can make is a
decision that gets made unsupervised. The set of those is empty here.

Nothing runs forever. Every handler is one bounded step, every chain has
ceilings, every budget is checked before it is spent, and the loop stops when
the queue is empty and says so.
"""
import json
import sqlite3
import time

from . import agent_runtime as RT, agent_world as W, always_on as A
from . import agent_context as CTX
from . import store, world_bus as BUS, world_policy as POL
from . import embodiment as EMB
from . import world_space as SPACE
from .store import now

OWNER = POL.OWNER
ORCH, RES, BUILD, REV, OPER = (
    "AGT-ORCHESTRATOR", "AGT-RESEARCHER", "AGT-BUILDER", "AGT-REVIEWER", "AGT-OPERATOR")

MAX_CORRECTIONS = 2          # a task may be corrected twice, then it escalates
LEASE_SECONDS = 600


class World:
    """Everything a tick needs, assembled once.

    `provider_for` is injected rather than imported so the world can be driven
    by a scripted double, a mock, or a deliberately compromised provider without
    the supervisor knowing the difference — which is the only way to test that
    it does not trust one."""

    def __init__(self, con, gw, provider_for, requirements_for=None,
                 worker="worker-1", max_in_flight=3, instruction_for=None,
                 review_for=None):
        self.con, self.gw = con, gw
        self.provider_for = provider_for
        self.requirements_for = requirements_for or (lambda task: [])
        self.instruction_for = instruction_for or (lambda task: task["objective"])
        # How the Reviewer reaches a verdict. Injected like everything else the
        # supervisor does not want to decide for itself.
        #
        # The default is `deterministic_review` and stays the default: this
        # file's rule is that a model writes CONTENT and never a fork, because
        # in an always-on world a model's decision is one nobody is reading.
        # A caller that wants a judging model must say so explicitly, take the
        # consequence, and — as `h_review_requested` enforces — get no verdict
        # at all rather than a default one when the model does not give one.
        self.review_for = review_for or deterministic_review
        self.worker, self.max_in_flight = worker, max_in_flight
        self.ticks = 0
        # A worker announces itself so the world can tell a live process from
        # one that died holding work. The agent is unaffected either way.
        BUS.register_worker(con, worker)

    # ── charging ─────────────────────────────────────────────────────
    def scopes(self, project_id=None, agent_id=None, task_id=None, chain_id=None):
        s = [("world", "WORLD"), ("day", "TODAY")]
        for scope, sid in (("project", project_id), ("agent", agent_id),
                           ("task", task_id), ("chain", chain_id)):
            if sid is not None and self.con.execute(
                    "SELECT 1 FROM budgets WHERE scope=? AND scope_id=?",
                    (scope, str(sid))).fetchone():
                s.append((scope, str(sid)))
        return s

    def spend_of(self, turn):
        return sum((self.con.execute("SELECT usd FROM runs WHERE id=?", (r,))
                    .fetchone() or {"usd": 0})["usd"] or 0 for r in turn.run_ids)


# ═════════════════════════════════════════════════════════════════════
# HANDLERS — one bounded step each. Every one of them returns a dict and
# emits the events its outcome implies. None of them decides policy.
# ═════════════════════════════════════════════════════════════════════
def _emit(w, item, kind, subject, payload=None, priority=5):
    """Emit a consequence, naming the entry that caused it.

    `caused_by` is what makes "why did this agent wake?" answerable from a row
    rather than from a process that is no longer running."""
    return BUS.emit(w.con, kind, subject, payload or {}, by=OWNER,
                    chain_id=item["chain_id"], depth=item["depth"] + 1,
                    priority=priority, caused_by=item["id"])


def h_owner_objective(w, item):
    """The Owner said what they want. Exactly once, and then they may leave.

    The Researcher takes a bounded turn against a real fixture through the real
    gateway, so the discovery that follows has evidence under it rather than a
    confidence number standing in for one."""
    con, p = w.con, item["payload"]
    objective = p.get("objective", "")
    fixture = p.get("fixture")
    # An objective with nothing to read cannot produce evidence, and this
    # handler's whole job is to turn an objective into an EVIDENCE-BACKED
    # opportunity. Refuse it as a decision rather than discovering halfway
    # through that `path=None` is not a path.
    if not fixture:
        raise RT.Denied(
            "an objective needs a source to scan: no `fixture` was given, so "
            "there is nothing for the gateway to attest to. The world will not "
            "open an opportunity on no evidence.")

    scan = W.discover_task(
        con, "Scan for opportunities relating to: " + objective, by=ORCH,
        required_caps=["research"], evidence_required=1,
        conditions=[{"description": "evidence was collected from the source",
                     "kind": "evidence"}])
    W.transition(con, scan, "PROPOSED", ORCH, "the Owner set an objective")
    W.transition(con, scan, "APPROVED", ORCH, "scanning is internal research")
    W.assign(con, scan, RES, by=ORCH)
    lease = W.claim_task(con, RES, task_id=scan, lease_seconds=LEASE_SECONDS)

    ok, why = POL.affordable(w.con, w.scopes(agent_id=RES, chain_id=item["chain_id"]), 0.0)
    if not ok:
        W.release_lease(con, lease["lease_id"])
        return {"deferred": why}

    call = w.gw.call(RES, "READ_REPO", lease_id=lease["lease_id"], path=fixture)
    ev = A.record_tool_evidence(
        con, con.execute("SELECT MAX(id) m FROM tool_calls").fetchone()["m"], RES)
    if ev is None:
        W.transition(con, scan, "FAILED", ORCH, "the gateway returned nothing to attest")
        raise RT.Denied("the scan produced no evidence")
    A.satisfy_kind(con, scan, "evidence", by=OWNER, row_id=ev)
    W.release_lease(con, lease["lease_id"])

    did = A.record_discovery(con, "scanned %s for: %s" % (fixture, objective), by=RES,
                             interpretation=p.get("interpretation", ""),
                             confidence=0.5, evidence_id=ev, source="mock")
    oid = A.propose_opportunity(
        con, objective, by=RES, discovery_id=did,
        required_caps=p.get("required_caps") or ["research", "build"],
        rationale="the scan returned %d bytes the gateway attests to" % len(call or ""),
        confidence=0.5, evidence_id=ev,
        validation_plan="produce an evidence-backed recommendation",
        chain_id=item["chain_id"])
    for state, why in (("COMPLETED", "evidence collected from the source"),
                       ("REVIEW", "handed to the control plane"),
                       ("ACCEPTED", "the only declared condition is met"),
                       ("ARCHIVED", "scan complete; opportunity #%d" % oid)):
        W.transition(con, scan, state, OWNER, why)
    _emit(w, item, "OPPORTUNITY_PROPOSED", "opportunity:%d" % oid,
          {"opportunity_id": oid, "objective": objective, "fixture": fixture})
    return {"discovery": did, "opportunity": oid, "evidence": ev}


def h_opportunity_proposed(w, item):
    """Deterministic evaluation. The proposer does not get a vote."""
    oid = item["payload"]["opportunity_id"]
    status, failed = A.evaluate_opportunity(w.con, oid, by=OWNER,
                                            chain_id=item["chain_id"])
    if status == "APPROVED":
        _emit(w, item, "OPPORTUNITY_APPROVED", "opportunity:%d" % oid,
              dict(item["payload"], opportunity_id=oid))
    return {"status": status, "failed": failed}


def h_opportunity_approved(w, item):
    oid = item["payload"]["opportunity_id"]
    r = A.open_project_from(w.con, oid, by=ORCH, chain_id=item["chain_id"])
    _emit(w, item, "PROJECT_OPENED", "project:%d" % r["project_id"],
          dict(item["payload"], project_id=r["project_id"], tasks=r["tasks"]))
    return r


def h_project_opened(w, item):
    """Fan out only the tasks whose dependencies are already satisfied.

    A task whose dependency is unfinished is not queued and not 'pending' — it
    simply is not work yet, and it becomes work when TASK_ACCEPTED says so."""
    pid = item["payload"]["project_id"]
    ready = []
    for r in w.con.execute("SELECT id FROM tasks WHERE project_id=? AND status='APPROVED'",
                           (pid,)):
        if A.runnable(w.con, r["id"]):
            _emit(w, item, "TASK_READY", "task:%d" % r["id"],
                  dict(item["payload"], task_id=r["id"]))
            ready.append(r["id"])
    return {"ready": ready, "held": [r["id"] for r in w.con.execute(
        "SELECT id FROM tasks WHERE project_id=? AND status='APPROVED'", (pid,))
        if r["id"] not in ready]}


def _worker_for(con, task):
    """Who may do this task. Capability, then the team, then a stable order."""
    need = set(json.loads(task["required_caps"] or "[]"))
    # Every agent the world HAS, with the capabilities it actually holds — not
    # the five in the founding map. An agent the factory commissioned is
    # employable here or it is not employable anywhere.
    able = [a["id"] for a in W.inhabitants(con)
            if need <= W.capabilities_of(con, a["id"])]
    if not able:
        return None
    seated = {r["principal_id"] for r in con.execute(
        "SELECT principal_id FROM team_members m JOIN teams t ON t.id=m.team_id "
        "WHERE t.project_id=?", (task["project_id"],))}
    return next((a for a in able if a in seated), able[0])


def h_task_ready(w, item):
    """Assign, lease, wake the agent for one bounded turn, record what it made.

    This is the only handler that runs a model turn, and everything around the
    turn is control plane: who may hold it, what it may reach, what it costs and
    whether what came back is acceptable."""
    con, tid = w.con, item["payload"]["task_id"]
    task = con.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    if task is None or task["status"] in ("ACCEPTED", "ARCHIVED"):
        return {"skipped": "task is %s" % (task["status"] if task else "gone")}
    unmet = A.unmet_deps(con, tid)
    if unmet:
        return {"deferred": "waiting on tasks %s" % unmet}

    agent = _worker_for(con, task)
    if agent is None:
        gap = A.detect_skill_gap(con, json.loads(task["required_caps"] or "[]"))
        r = A.request_skill(con, gap, by=ORCH, chain_id=item["chain_id"])
        _emit(w, item, "SKILL_GAP_FOUND", "task:%d" % tid, {"gap": gap, **r})
        return {"skill_gap": gap, **r}

    if W.assignee(con, tid) != agent:
        W.assign(con, tid, agent, by=ORCH)
    POL.open_budget(con, "task", str(tid), 0.10)
    POL.open_budget(con, "agent", agent, 0.50)
    scopes = w.scopes(task["project_id"], agent, tid, item["chain_id"])
    ok, why = POL.affordable(con, scopes, 0.0)
    if not ok:
        store.signal(con, "HIGH", "Autonomous work paused: budget", why)
        return {"deferred": why}

    # Is there anything to run this at all? Asked of the provider that would
    # actually be used, and asked BEFORE a lease is taken — a lease held by an
    # agent that cannot run is a lock on work nobody is doing.
    prov = w.provider_for(agent, task, task["attempts"] + 1)
    if not prov.available():
        return {"waiting_for_model": prov.why_unavailable() or "no inference engine"}

    # The agent goes to where the work is. This is the ONLY reason anything in
    # this world moves: a task was assigned to an identity that was somewhere
    # else. The journey is persisted leg by leg before the lease is taken,
    # because an agent cannot hold a lease on work it has not reached.
    moved = _go_to_work(w, item, agent, task)

    lease = W.claim_task(con, agent, task_id=tid, lease_seconds=LEASE_SECONDS)
    if lease is None:
        return {"deferred": "task %d could not be leased" % tid}
    SPACE.begin_work(con, agent, tid, lease_id=lease["lease_id"],
                     activity="working on task #%d" % tid)
    # It takes a desk in the room it walked to, and keeps it. "At its
    # workstation" has to name one station, or it names a rectangle.
    EMB.take_station(con, agent, SPACE.locate(con, agent)["workspace"])

    # What this identity already knows, retrieved because it is waking, not
    # because someone passed it along in a prompt from the last run — and then
    # actually GIVEN to it. This used to be fetched into a local variable,
    # counted in the return value as `memory_recalled`, and dropped: the record
    # said memory had been recalled while nothing had recalled it to anybody.
    brief, ctx = CTX.briefing(
        con, agent, tid, project_id=task["project_id"],
        extra={"the owner's instruction": w.instruction_for(task)})
    mem = ctx["memory"]
    art, undeclared = None, None
    try:
        turn = RT.run_agent_turn(
            con, w.gw, prov, agent, tid, instruction=brief,
            lease_id=lease["lease_id"], project_id=task["project_id"])
        RT.record_turn(con, turn, task["project_id"])
        usd = w.spend_of(turn)
        if usd:
            POL.charge(con, scopes, usd, why="task %d turn" % tid)
            POL.note_chain(con, item["chain_id"], usd=usd)
        try:
            art = RT.persist_artifact(con, turn, task["project_id"])
        except RT.Denied as e:
            # The agent ended its turn WITHOUT declaring an artifact — the
            # runtime offers `{"type":"complete","result":…}` as well, and a
            # real model uses it: asked to report, it reports.
            #
            # That is a failed attempt, and it must be handled as one. It used
            # to escape this handler as an exception, which nacked the queue
            # item while the task stayed RUNNING and its lease stayed spent —
            # so the retry could not re-lease it, deferred, and the whole
            # project stopped with no failure recorded anywhere and nothing in
            # the record saying why. A double always declared an artifact, so
            # nothing ever took this path.
            #
            # Now it goes where every other unacceptable result goes: a
            # correction, with the reason in front of the next attempt.
            undeclared = str(e)
    finally:
        W.release_lease(con, lease["lease_id"])
        # It stops working when the lease ends, wherever it happens to be. It
        # does NOT walk home: an agent standing where it last worked is the
        # truth, and sending it somewhere for tidiness is invented movement.
        SPACE.finish_work(con, agent, why="lease on task #%d released" % tid)

    if art is None:
        answered = (turn.answer or "").strip()
        reason = ("the agent ended its turn without declaring an artifact"
                  + (": it answered %r instead" % answered[:160] if answered
                     else " and said nothing the runtime could act on"))
        _emit(w, item, "CORRECTION_NEEDED", "task:%d" % tid,
              dict(item["payload"], task_id=tid, agent=agent, reason=reason))
        return {"agent": agent, "no_artifact": reason, "answered": bool(answered),
                "tool_calls": turn.tool_calls, "denials": turn.denials,
                "why": undeclared}

    _emit(w, item, "ARTIFACT_CREATED", "artifact:%d" % art,
          dict(item["payload"], task_id=tid, artifact_id=art, agent=agent))
    return {"agent": agent, "artifact": art, "memory_recalled": len(mem),
            "tool_calls": turn.tool_calls, "denials": turn.denials,
            "travelled": moved}


def _go_to_work(w, item, agent, task):  # noqa: C901
    """Send an agent to the workspace its task belongs in, and say why.

    Returns what the journey cost, or None when the agent was already there —
    which is the common case and must not be dressed up as travel."""
    from . import open_world as OW
    dest = OW.workspace_of(task)
    why = "assigned task #%d (%s)" % (task["id"], task["status"])
    try:
        r = SPACE.travel(w.con, agent, dest, why=why, task_id=task["id"],
                         worker=w.worker, queue_id=item["id"])
    except (SPACE.SpaceError, sqlite3.IntegrityError) as e:
        # A refused move is a fact about the world, not a crash, and the work is
        # still valid work: whether the destination room is full is a question
        # about occupancy, not about whether this task should be done. So it is
        # recorded and signalled, the agent stays where it is, and the task
        # proceeds — rather than a full workspace failing real work.
        store.signal(w.con, "MEDIUM", "An agent could not reach its work", str(e))
        return {"refused": str(e)}
    if r.get("arrived"):
        EMB.take_station(w.con, agent, dest)
    if r.get("abandoned"):
        # `travel` now declines a journey it cannot finish instead of raising —
        # which is better behaviour and was quietly worse reporting, because the
        # exception was the only thing telling the Owner anything.
        store.signal(w.con, "MEDIUM", "An agent could not reach its work",
                     "%s: %s" % (agent, r.get("why", "the destination refused it")))
        return {"refused": r.get("why"), "stopped_at": r.get("workspace")}
    return None if not r.get("moved") else {
        "to": dest, "distance": r.get("distance"), "arrived": r.get("arrived")}


def h_artifact_created(w, item):
    """Deterministic verification, run outside the producer. Always."""
    con = w.con
    tid, art = item["payload"]["task_id"], item["payload"]["artifact_id"]
    task = con.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    ver = RT.verify_artifact(con, art, w.requirements_for(task), by=OWNER)
    _emit(w, item, "VERIFICATION_DONE", "artifact:%d" % art,
          dict(item["payload"], passed=bool(ver["passed"]),
               evidence_id=ver.get("evidence_id")))
    return {"passed": bool(ver["passed"]),
            "unmet": [c["requirement"] for c in ver["checks"] if not c["passed"]]}


def h_verification_done(w, item):
    """Passed → an independent reviewer. Failed → a correction, not a retry."""
    p = item["payload"]
    if p.get("passed"):
        A.satisfy_kind(w.con, p["task_id"], "evidence", by=OWNER,
                       row_id=p.get("evidence_id"))
        _emit(w, item, "REVIEW_REQUESTED", "artifact:%d" % p["artifact_id"], p)
        return {"next": "review"}
    _emit(w, item, "CORRECTION_NEEDED", "task:%d" % p["task_id"],
          dict(p, reason="deterministic verification failed"))
    return {"next": "correction"}


def deterministic_review(w, art, task, ver, unmet):
    """The world's own verdict: the verification row, read back.

    Returns (verdict, rationale, run_id). No model is consulted and none is
    needed — every input to this decision is already a row."""
    verdict = "APPROVE" if not unmet else "REJECT"
    rationale = ("every declared requirement is met and the artifact matches the "
                 "bytes the gateway returned" if verdict == "APPROVE"
                 else "requirement(s) not met: " + "; ".join(unmet))
    return verdict, rationale, None


def h_review_requested(w, item):
    """The Reviewer sees the artifact and the evidence. Never the reasoning."""
    con, p = w.con, item["payload"]
    art = p["artifact_id"]
    a = con.execute("SELECT * FROM artifacts WHERE id=?", (art,)).fetchone()
    if a["principal_id"] == REV:
        # LAW 5 would refuse this at the database; refusing it here means the
        # world escalates instead of crashing a worker on a law it should never
        # have reached.
        store.signal(con, "HIGH", "Review impossible: the Reviewer produced it",
                     "artifact #%d" % art)
        return {"escalated": "self-review"}
    task = con.execute("SELECT * FROM tasks WHERE id=?", (p["task_id"],)).fetchone()
    # Independent judgement happens in the Review district, so the Reviewer goes
    # there. Caused by this artifact needing a verdict, and by nothing else.
    _go_to_review(w, item, art, task)
    ver = con.execute("SELECT * FROM evidence WHERE external_provenance LIKE ? "
                      "ORDER BY id DESC LIMIT 1", ("artifact:%d@%%" % art,)).fetchone()
    unmet = [c["requirement"] for c in
             json.loads((ver["detail"] if ver else "{}")).get("checks", [])
             if not c["passed"]] if ver else []
    verdict, rationale, run_id = w.review_for(w, art, task, ver, unmet)
    # An unreadable verdict is NOT an approval and not a rejection. Defaulting
    # either way would be the supervisor deciding while reporting that the
    # reviewer had — so the artifact keeps its REVIEW status and a person is
    # told, which is what "could not be reviewed" actually means.
    if verdict not in ("APPROVE", "REJECT"):
        store.signal(con, "HIGH", "The reviewer returned no usable verdict",
                     "artifact #%d: %s" % (art, str(rationale)[:160]))
        return {"escalated": "no verdict", "why": str(rationale)[:160]}
    rid = RT.persist_review(con, art, REV, verdict, rationale,
                            evidence_id=ver["id"] if ver else None, run_id=run_id)
    _emit(w, item, "REVIEW_DONE", "review:%d" % rid,
          dict(p, review_id=rid, verdict=verdict))
    return {"verdict": verdict, "review": rid, "run": run_id}


def _go_to_review(w, item, art, task):
    """The Reviewer to the Inspection Bench, because an artifact needs a verdict."""
    try:
        SPACE.travel(w.con, REV, "ws_inspection",
                     why="artifact #%d needs an independent verdict" % art,
                     task_id=task["id"] if task else None,
                     worker=w.worker, queue_id=item["id"])
        # A seat at the bench it just walked to. An agent holding a desk in the
        # room it left is an agent the world cannot place.
        EMB.take_station(w.con, REV, "ws_inspection")
    except (SPACE.SpaceError, sqlite3.IntegrityError) as e:
        store.signal(w.con, "MEDIUM", "The Reviewer could not reach the bench", str(e))


def h_review_done(w, item):
    """A verdict moves the task, or produces a correction. Nothing else."""
    con, p = w.con, item["payload"]
    tid = p["task_id"]
    if p["verdict"] != "APPROVE":
        _emit(w, item, "CORRECTION_NEEDED", "task:%d" % tid,
              dict(p, reason="the reviewer rejected artifact #%d" % p["artifact_id"]))
        return {"verdict": "REJECT"}
    A.satisfy_kind(con, tid, "artifact", by=OWNER, row_id=p["artifact_id"])
    A.satisfy_kind(con, tid, "review", by=OWNER, row_id=p["review_id"])
    for state, why in (("RUNNING", "conditions being closed"),
                       ("COMPLETED", "all declared conditions met"),
                       ("REVIEW", "handed to the control plane"),
                       ("ACCEPTED", "reviewer approved and verification passed")):
        cur = con.execute("SELECT status FROM tasks WHERE id=?", (tid,)).fetchone()
        if cur["status"] != state:
            W.transition(con, tid, state, OWNER, why)
    _emit(w, item, "TASK_ACCEPTED", "task:%d" % tid, p)
    return {"verdict": "APPROVE", "task": tid}


def h_correction_needed(w, item):
    """A rejection produces a NEW task, with the dependents moved onto it.

    Not an edit, not a retry of the same row: the failed attempt stays FAILED in
    the record, and the correction is a separate piece of work with its own
    artifact and its own sha."""
    con, p = w.con, item["payload"]
    tid = p["task_id"]
    task = con.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    tries = con.execute("SELECT COUNT(*) c FROM tasks WHERE project_id=? AND "
                        "objective LIKE ?", (task["project_id"], "Correct:%")).fetchone()["c"]
    if tries >= MAX_CORRECTIONS:
        POL.halt_chain(con, item["chain_id"],
                     "correction limit (%d) reached on project %s"
                     % (MAX_CORRECTIONS, task["project_id"]), state="ESCALATED")
        POL.propose(con, "opportunity.approve", ORCH,
                  "Project #%s cannot pass review after %d corrections — continue?"
                  % (task["project_id"], tries),
                  p.get("reason", ""), project_id=task["project_id"],
                  chain_id=item["chain_id"])
        return {"escalated": True, "corrections": tries}

    if task["status"] not in ("FAILED", "ARCHIVED"):
        cur = con.execute("SELECT status FROM tasks WHERE id=?", (tid,)).fetchone()
        if cur["status"] != "RUNNING":
            W.transition(con, tid, "RUNNING", OWNER, "closing out a rejected attempt")
        W.transition(con, tid, "FAILED", OWNER, p.get("reason", "rejected"))

    A.record_failure(con, "task %d did not pass" % tid, p.get("reason", ""),
                     by=OWNER, project_id=task["project_id"], task_id=tid,
                     lesson="an artifact that omits a declared section is rejected "
                            "by verification before a reviewer reads it",
                     evidence_id=p.get("evidence_id"))

    conds = [c["description"] for c in con.execute(
        "SELECT description FROM task_conditions WHERE task_id=?", (tid,))]
    # The correction NAMES the attempt it exists to answer. Without this link a
    # correction task is a fresh row with no history, and the agent picking it
    # up cannot see the rejection it is supposed to be fixing — so it is being
    # asked to guess what was wrong.
    new = W.discover_task(
        con, "Correct: " + task["objective"], by=ORCH, project_id=task["project_id"],
        required_caps=json.loads(task["required_caps"] or "[]"),
        evidence_required=task["evidence_required"], parent_id=tid,
        conditions=[{"description": c, "kind": A._cond_kind(c)} for c in conds])
    W.transition(con, new, "PROPOSED", ORCH, "correction for task #%d" % tid)
    W.transition(con, new, "APPROVED", ORCH, "the bar is unchanged")
    A.repoint_deps(con, tid, new)
    POL.note_chain(con, item["chain_id"], tasks=1)
    _emit(w, item, "TASK_READY", "task:%d" % new, dict(p, task_id=new, correction_of=tid))
    return {"correction": new, "of": tid}


def h_task_accepted(w, item):
    """Unblock what was waiting, and close the project if nothing is left."""
    con, p = w.con, item["payload"]
    tid = p["task_id"]
    freed = A.dependents_unblocked(con, tid)
    for dep in freed:
        _emit(w, item, "TASK_READY", "task:%d" % dep, dict(p, task_id=dep))
    pid = con.execute("SELECT project_id FROM tasks WHERE id=?", (tid,)).fetchone()["project_id"]
    if pid is not None:
        left = con.execute(
            "SELECT COUNT(*) c FROM tasks WHERE project_id=? AND status NOT IN "
            "('ACCEPTED','ARCHIVED','FAILED')", (pid,)).fetchone()["c"]
        if not left:
            con.execute("UPDATE projects SET stage='COMPLETED' WHERE id=?", (pid,))
            store.event(con, "PROJECT_COMPLETED", actor=OWNER, subject="project:%d" % pid,
                        payload={"tasks_accepted": con.execute(
                            "SELECT COUNT(*) c FROM tasks WHERE project_id=? AND "
                            "status='ACCEPTED'", (pid,)).fetchone()["c"]})
            store.signal(con, "MEDIUM", "Project #%d completed" % pid,
                         "every task reached ACCEPTED")
            POL.halt_chain(con, item["chain_id"], "project %d completed" % pid,
                         state="QUIET")
    return {"unblocked": freed}


def h_lease_expired(w, item):
    """A worker died holding a task. The task is not lost and is not re-billed."""
    tid = item["payload"].get("task_id")
    W.reap(w.con)
    if tid and A.runnable(w.con, tid):
        _emit(w, item, "TASK_READY", "task:%d" % tid, item["payload"])
    return {"reaped": True, "task": tid}


def h_skill_gap(w, item):
    """Noticed, asked, and stopped. Nothing is installed by an agent."""
    return {"awaiting_owner": True, "gap": item["payload"].get("gap")}


def h_noop(w, item):
    return {"noop": item["kind"]}


HANDLERS = {
    "OWNER_OBJECTIVE": h_owner_objective,
    "OPPORTUNITY_PROPOSED": h_opportunity_proposed,
    "OPPORTUNITY_APPROVED": h_opportunity_approved,
    "PROJECT_OPENED": h_project_opened,
    "TASK_READY": h_task_ready,
    "ARTIFACT_CREATED": h_artifact_created,
    "VERIFICATION_DONE": h_verification_done,
    "REVIEW_REQUESTED": h_review_requested,
    "REVIEW_DONE": h_review_done,
    "CORRECTION_NEEDED": h_correction_needed,
    "TASK_ACCEPTED": h_task_accepted,
    "LEASE_EXPIRED": h_lease_expired,
    "SKILL_GAP_FOUND": h_skill_gap,
    "DISCOVERY_MADE": h_noop,
    "MESSAGE_SENT": h_noop,
    "EVIDENCE_ADDED": h_noop,
    "TASK_ASSIGNED": h_noop,
    "TASK_FAILED": h_noop,
    "HEARTBEAT": None,          # handled by reconcile()
}


# ═════════════════════════════════════════════════════════════════════
def tick(w):
    """One claim, one bounded step, one outcome. Returns None when idle."""
    item = BUS.claim(w.con, w.worker, max_in_flight=w.max_in_flight)
    if item is None:
        return None
    w.ticks += 1
    BUS.beat(w.con, w.worker)
    if item["kind"] == "HEARTBEAT":
        out = reconcile(w, reason="heartbeat")
        BUS.ack(w.con, item["id"], out, worker=w.worker)
        return {"kind": "HEARTBEAT", "result": out}
    fn = HANDLERS.get(item["kind"])
    if fn is None:
        BUS.drop(w.con, item["id"], "no handler for %s" % item["kind"])
        return {"kind": item["kind"], "result": {"dropped": True}}
    try:
        out = fn(w, item)
    except POL.PolicyError as e:
        BUS.defer(w.con, item["id"], "policy: %s" % e)
        store.signal(w.con, "HIGH", "Autonomous work stopped at a policy gate", str(e))
        return {"kind": item["kind"], "result": {"policy_stop": str(e)}}
    except POL.BudgetError as e:
        BUS.defer(w.con, item["id"], "budget: %s" % e)
        store.signal(w.con, "HIGH", "Autonomous work stopped: budget exhausted", str(e))
        return {"kind": item["kind"], "result": {"budget_stop": str(e)}}
    except Exception as e:                                   # noqa: BLE001
        BUS.nack(w.con, item["id"], "%s: %s" % (type(e).__name__, e))
        return {"kind": item["kind"], "result": {"error": repr(e)}}
    if out.get("waiting_for_model"):
        BUS.wait_for_model(w.con, item["id"], out["waiting_for_model"])
        store.signal(w.con, "MEDIUM", "Work is waiting for an inference engine",
                     out["waiting_for_model"])
    elif out.get("deferred"):
        BUS.defer(w.con, item["id"], out["deferred"])
    else:
        BUS.ack(w.con, item["id"], out, worker=w.worker)
    return {"kind": item["kind"], "result": out}


def _resume_if_an_engine_exists(w):
    """Un-park WAITING_FOR_MODEL work, but only once something can actually run it.

    The question is asked of THIS world's own provider factory — the same one
    `h_task_ready` will use — and not of the global model gate. Those two can
    disagree: a world injected with a provider of its own is not made runnable
    by some unrelated engine answering on this machine, and resuming on that
    basis just parks the work again a tick later.

    The probe uses a task that is actually parked, so what is asked is exactly
    what will be asked when the work is picked up."""
    con = w.con
    if not BUS.waiting_for_model(con):
        return []
    row = con.execute(
        "SELECT payload FROM world_queue WHERE state='WAITING_FOR_MODEL' "
        "AND kind='TASK_READY' ORDER BY id LIMIT 1").fetchone()
    if row is None:
        return []
    tid = (json.loads(row["payload"] or "{}") or {}).get("task_id")
    task = con.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone() \
        if tid else None
    if task is None:
        return []
    agent = _worker_for(con, task)
    if agent is None:
        return []
    if not w.provider_for(agent, task, task["attempts"] + 1).available():
        return []
    return BUS.resume_waiting(con)


def reconcile(w, reason="periodic"):
    """Periodic repair. Event-driven wakeups plus this, never a busy loop.

    Everything here is something events alone can miss: a worker that died with
    work claimed, a lease that outlived its holder, a task whose dependencies
    quietly became satisfied, a decision the Owner has not answered."""
    con = w.con
    freed = BUS.recover_stuck(con, older_than_seconds=0, worker=None) \
        if reason == "recovery" else BUS.recover_stuck(con, older_than_seconds=300)
    reaped = W.reap(con)
    dead = BUS.stale_workers(con, older_than_seconds=0 if reason == "recovery" else 120)
    unblocked = []
    for r in con.execute("SELECT id FROM tasks WHERE status IN ('APPROVED','ASSIGNED')"):
        if A.runnable(con, r["id"]) and not con.execute(
                "SELECT 1 FROM world_queue WHERE kind='TASK_READY' AND subject=? "
                "AND state IN ('READY','CLAIMED')", ("task:%d" % r["id"],)).fetchone():
            BUS.emit(con, "TASK_READY", "task:%d" % r["id"], {"task_id": r["id"]},
                     by=OWNER)
            unblocked.append(r["id"])
    resumed = _resume_if_an_engine_exists(w)
    EMB.reconcile_stations(con)
    pending = con.execute("SELECT COUNT(*) c FROM approvals WHERE decision IS NULL"
                          ).fetchone()["c"]
    d = BUS.depth(con)
    con.execute("INSERT INTO heartbeats(at,reason,queued,in_flight,reaped,unblocked,"
                "escalated,note) VALUES(?,?,?,?,?,?,?,?)",
                (now(), reason, d["READY"], d["CLAIMED"], len(reaped or []),
                 len(unblocked), pending, json.dumps({"freed": freed})[:400]))
    return {"freed": freed, "reaped": len(reaped or []), "unblocked": unblocked,
            "queued": d["READY"], "in_flight": d["CLAIMED"], "awaiting_owner": pending,
            "stale_workers": dead, "waiting_for_model": BUS.waiting_for_model(con),
            "resumed": resumed}


def run(w, max_ticks=200, until_quiet=True, deadline_seconds=None):
    """Turn the handle until the world is quiet or a ceiling says stop.

    `max_ticks` is not a nicety. It is the outermost of the loop limits, and it
    exists so that a supervisor with a bug in it stops rather than runs."""
    started, log = time.time(), []
    for _ in range(max_ticks):
        if deadline_seconds and time.time() - started > deadline_seconds:
            log.append({"kind": "STOP", "result": {"why": "deadline"}})
            break
        step = tick(w)
        if step is None:
            if until_quiet:
                break
            continue
        log.append(step)
    return {"ticks": w.ticks, "steps": log, "quiet": BUS.quiet(w.con),
            "seconds": round(time.time() - started, 3)}
