"""ALWAYS-ON DOMAIN — opportunities, dependencies, teams, memory, learning.

Deterministic control plane. A model may write the CONTENT of a discovery or an
artifact; it never decides whether an opportunity is approved, who is on a team,
which task is runnable, or what the organisation knows. Those are decided here,
in ordinary Python, against rows.

The distinction matters most in exactly the place it is easiest to lose: an
autonomous world is one where the model's output arrives while nobody is
reading it. If a model statement could become a FACT, or a proposal could
become an approval, the world would be able to talk itself into anything.
"""
import json

from . import agent_world as W, store, world_bus as BUS, world_policy as POL
from .store import now

OWNER = POL.OWNER
ORCH = "AGT-ORCHESTRATOR"


class WorldError(W.WorldError):
    pass


# ── OPPORTUNITY RADAR ────────────────────────────────────────────────
# SIGNAL → DISCOVERY → OPPORTUNITY → EVALUATING → APPROVED/REJECTED → PROJECT
#
# Confidence is not evidence. A discovery may carry a confidence number because
# the agent that made it had one; the evaluation below does not read it as a
# reason to proceed, only as something to record.
def record_discovery(con, observation, by, interpretation="", confidence=0.0,
                     evidence_id=None, source="mock", project_id=None):
    """Something was noticed. Noticing is not proposing and not deciding."""
    did = con.execute(
        "INSERT INTO discoveries(observation,interpretation,confidence,source_agents,"
        "source_projects,evidence_id,source,created_at) VALUES(?,?,?,?,?,?,?,?)",
        (observation, interpretation, max(0.0, min(1.0, confidence)),
         json.dumps([by]), json.dumps([project_id] if project_id else []),
         evidence_id, source, now())).lastrowid
    store.event(con, "DISCOVERY_MADE", actor=by, subject="discovery:%d" % did,
                payload={"observation": observation[:400], "confidence": confidence,
                         "evidence_id": evidence_id})
    return did


def propose_opportunity(con, problem, by, discovery_id=None, required_caps=(),
                        rationale="", confidence=0.0, evidence_id=None,
                        validation_plan="", chain_id=None):
    """An agent proposes. It does not decide, and it cannot.

    `opportunity.propose` is AUTO_ALLOWED precisely because proposing is cheap
    and reversible; `opportunity.approve` is APPROVAL_REQUIRED, and the two are
    different rows in the policy table for a reason."""
    POL.require(con, "opportunity.propose", by, subject=problem[:120], chain_id=chain_id)
    oid = con.execute(
        "INSERT INTO opportunities(source,problem,required_caps,validation_plan,"
        "evidence_id,status,created_at,confidence,discovery_id,discovered_by,rationale) "
        "VALUES(?,?,?,?,?,'NEW',?,?,?,?,?)",
        ("agent:" + by, problem, json.dumps(sorted(required_caps)), validation_plan,
         evidence_id, now(), max(0.0, min(1.0, confidence)), discovery_id, by,
         rationale)).lastrowid
    store.event(con, "OPPORTUNITY_PROPOSED", actor=by, subject="opportunity:%d" % oid,
                payload={"problem": problem[:400], "confidence": confidence,
                         "required_caps": sorted(required_caps),
                         "evidence_id": evidence_id})
    return oid


# The bar an opportunity must clear to become committed work. Written down,
# checkable, and identical at 3am as at noon.
EVAL_RULES = (
    ("has_evidence",  "an opportunity with no evidence under it is a guess"),
    ("has_rationale", "no stated reason to believe it"),
    ("caps_covered",  "no agent in the crew covers what it would need"),
    ("world_has_room", "the world's own budget will not carry it"),
)


def evaluate_opportunity(con, opp_id, by=OWNER, chain_id=None):
    """Deterministic evaluation. No model, no discretion, no judgement call.

    Returns (status, reasons). Every rule that failed is named, so a REJECTED
    opportunity can be argued with rather than just disbelieved."""
    o = con.execute("SELECT * FROM opportunities WHERE id=?", (opp_id,)).fetchone()
    if o is None:
        raise WorldError("no opportunity %s" % opp_id)
    if o["status"] not in ("NEW", "RESEARCHING", "EVALUATING"):
        return o["status"], ["already %s" % o["status"]]
    con.execute("UPDATE opportunities SET status='EVALUATING' WHERE id=?", (opp_id,))

    caps = set(json.loads(o["required_caps"] or "[]"))
    covered = set()
    for have in W.ROLE_CAPABILITY.values():
        covered |= have
    checks = {
        "has_evidence": o["evidence_id"] is not None,
        "has_rationale": bool((o["rationale"] or "").strip()),
        "caps_covered": bool(caps) and caps <= covered,
        "world_has_room": POL.remaining(con, "world", "WORLD") > 0.0
                          and POL.remaining(con, "day", "TODAY") > 0.0,
    }
    failed = [why for name, why in EVAL_RULES if not checks[name]]
    status = "REJECTED" if failed else "APPROVED"
    con.execute("UPDATE opportunities SET status=?, decided_by=?, decided_at=?, "
                "decision_why=? WHERE id=?",
                (status, by, now(), "; ".join(failed) or "all rules met", opp_id))
    store.event(con, "OPPORTUNITY_" + status, actor=by, subject="opportunity:%d" % opp_id,
                payload={"checks": checks, "failed": failed})
    if status == "REJECTED":
        store.signal(con, "LOW", "Opportunity #%d rejected" % opp_id, "; ".join(failed))
    return status, failed


# ── TEAM PLANNING ────────────────────────────────────────────────────
MAX_TEAM = 5


def plan_team(con, required_caps, risk="normal", budget_usd=None, deadline=None,
              produces_artifact=True):
    """The minimum team that covers the work, plus the reviewer the law requires.

    Deterministic: same inputs, same team, in the same order. Greedy set cover
    over a fixed agent ordering, then two adjustments that are not preferences:

    - anything that PRODUCES an artifact gets an independent reviewer, because
      LAW 5 will refuse a self-review later and discovering that at review time
      is discovering it too late;
    - the Orchestrator is added only when the work needs coordinating (more than
      one producer), because a coordinator on a one-person job is a coordinator
      with nothing to do and a seat in the record.

    Workload breaks ties only — never coverage. A busy agent that is the only
    one who can do the job still gets the job."""
    need = set(required_caps)
    if not need:
        raise WorldError("a team with no required capability is not a team")
    load = {r["principal_id"]: r["c"] for r in con.execute(
        "SELECT principal_id, COUNT(*) c FROM leases WHERE status='ACTIVE' "
        "GROUP BY principal_id")}
    order = sorted(W.ROLE_CAPABILITY, key=lambda a: (load.get(a, 0), a))

    chosen, why = [], {}
    remaining = set(need)
    while remaining:
        best, gain = None, set()
        for aid in order:
            g = W.ROLE_CAPABILITY[aid] & remaining
            if len(g) > len(gain):
                best, gain = aid, g
        if best is None:
            raise WorldError("no agent covers %s" % sorted(remaining))
        chosen.append(best)
        why[best] = sorted(gain)
        remaining -= gain

    producers = [a for a in chosen if {"build", "research"} & W.ROLE_CAPABILITY[a]]
    reviewer = "AGT-REVIEWER"
    if produces_artifact and reviewer not in chosen:
        chosen.append(reviewer)
        why[reviewer] = ["review"]
    if len(producers) > 1 and ORCH not in chosen:
        chosen.append(ORCH)
        why[ORCH] = ["coordinate"]
    if risk == "high" and "AGT-OPERATOR" not in chosen and len(chosen) < MAX_TEAM:
        chosen.append("AGT-OPERATOR")
        why["AGT-OPERATOR"] = ["execute"]

    if len(chosen) > MAX_TEAM:
        raise WorldError("planned team of %d exceeds the cap of %d" % (len(chosen), MAX_TEAM))
    return {"members": [(a, why[a]) for a in chosen],
            "covers": sorted(need), "risk": risk,
            "budget_usd": budget_usd, "deadline": deadline}


def seat_team(con, project_id, plan, by=ORCH, name="Task Team"):
    tid = con.execute("INSERT INTO teams(project_id,name,purpose,created_at) "
                      "VALUES(?,?,?,?)",
                      (project_id, name, "covers " + ",".join(plan["covers"]),
                       now())).lastrowid
    for aid, seat in plan["members"]:
        con.execute("INSERT OR IGNORE INTO team_members(team_id,principal_id,seat) "
                    "VALUES(?,?,?)", (tid, aid, ",".join(seat)))
    store.event(con, "TEAM_FORMED", actor=by, subject="team:%d" % tid,
                payload={"members": [a for a, _ in plan["members"]],
                         "covers": plan["covers"], "risk": plan["risk"]})
    return tid


# ── DEPENDENCIES ─────────────────────────────────────────────────────
def add_dep(con, task_id, depends_on):
    """A real edge. LAW 25 refuses RUNNING while any dependency is unaccepted."""
    if task_id == depends_on:
        raise WorldError("a task cannot depend on itself")
    if _would_cycle(con, task_id, depends_on):
        raise WorldError("dependency %d → %d would create a cycle"
                         % (task_id, depends_on))
    con.execute("INSERT OR IGNORE INTO task_deps(task_id,depends_on,at) VALUES(?,?,?)",
                (task_id, depends_on, now()))
    return True


def _would_cycle(con, task_id, depends_on):
    seen, stack = set(), [depends_on]
    while stack:
        cur = stack.pop()
        if cur == task_id:
            return True
        if cur in seen:
            continue
        seen.add(cur)
        stack += [r["depends_on"] for r in con.execute(
            "SELECT depends_on FROM task_deps WHERE task_id=?", (cur,))]
    return False


def satisfy_kind(con, task_id, kind, by, row_id=None):
    """Satisfy the next unsatisfied condition OF A KIND, not of an exact wording.

    `satisfy_condition` matches the description exactly, which is right when a
    human wrote both ends. The supervisor did not: it knows that verification
    passed, not how this particular task phrased its verification condition.
    Matching on kind keeps the caller honest about what it actually proved."""
    r = con.execute("SELECT description FROM task_conditions WHERE task_id=? AND "
                    "kind=? AND satisfied=0 ORDER BY id LIMIT 1",
                    (task_id, kind)).fetchone()
    if r is None:
        return False
    W.satisfy_condition(con, task_id, r["description"], by, row_id)
    return True


def unmet_deps(con, task_id):
    return [r["depends_on"] for r in con.execute(
        "SELECT d.depends_on FROM task_deps d JOIN tasks t ON t.id=d.depends_on "
        "WHERE d.task_id=? AND t.status <> 'ACCEPTED'", (task_id,))]


def runnable(con, task_id):
    t = con.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if t is None or t["status"] not in ("APPROVED", "ASSIGNED"):
        return False
    return not unmet_deps(con, task_id)


def dependents_unblocked(con, task_id):
    """Which tasks just became runnable because this one was accepted."""
    out = []
    for r in con.execute("SELECT task_id FROM task_deps WHERE depends_on=?", (task_id,)):
        if runnable(con, r["task_id"]):
            out.append(r["task_id"])
    return out


# ── PROJECT FROM OPPORTUNITY ─────────────────────────────────────────
# The default graph. Deliberately short: a world that generates twelve tasks per
# objective generates twelve chances to be wrong before anyone looks.
PLAN = [
    dict(key="research", caps=["research"], evidence=1,
         objective="Investigate %(problem)s and record evidence for each finding.",
         conditions=["a findings artifact exists",
                     "it passes deterministic verification",
                     "an independent reviewer approved it"]),
    dict(key="recommend", caps=["build"], evidence=0, after="research",
         objective="Produce an evidence-backed recommendation for %(problem)s.",
         conditions=["a recommendation artifact exists",
                     "it passes deterministic verification",
                     "an independent reviewer approved it"]),
]


def open_project_from(con, opp_id, by=ORCH, chain_id=None, budget_usd=0.25):
    """An APPROVED opportunity becomes a project, a team and a task graph.

    LAW 27 refuses the PROJECT status out of anything but APPROVED, so this
    cannot be reached by an agent that skipped the evaluation."""
    o = con.execute("SELECT * FROM opportunities WHERE id=?", (opp_id,)).fetchone()
    if o is None or o["status"] != "APPROVED":
        raise WorldError("opportunity %s is not APPROVED" % opp_id)
    POL.require(con, "project.create", by, usd=budget_usd,
              subject="opportunity:%d" % opp_id, chain_id=chain_id)

    caps = json.loads(o["required_caps"] or "[]")
    pid = con.execute("INSERT INTO projects(name,mission,stage,origin,created_at) "
                      "VALUES(?,?,'RESEARCH',?,?)",
                      (o["problem"][:60], o["problem"], "opportunity:%d" % opp_id,
                       now())).lastrowid
    con.execute("UPDATE opportunities SET status='PROJECT', project_id=? WHERE id=?",
                (pid, opp_id))
    POL.open_budget(con, "project", str(pid), budget_usd)
    plan = plan_team(con, caps or ["research"], risk="normal", budget_usd=budget_usd)
    team_id = seat_team(con, pid, plan, by=by)

    ok, why = POL.chain_room(con, chain_id, tasks=len(PLAN))
    if not ok:
        POL.halt_chain(con, chain_id, why)
        raise WorldError(why)

    made = {}
    for step in PLAN:
        tid = W.discover_task(
            con, step["objective"] % {"problem": o["problem"]}, by=by, project_id=pid,
            required_caps=step["caps"], evidence_required=step["evidence"],
            conditions=[{"description": c, "kind": _cond_kind(c)}
                        for c in step["conditions"]])
        W.transition(con, tid, "PROPOSED", by, "decomposed from opportunity #%d" % opp_id)
        W.transition(con, tid, "APPROVED", by, "in scope, staffed, bar declared")
        made[step["key"]] = tid
        if step.get("after"):
            add_dep(con, tid, made[step["after"]])
    POL.note_chain(con, chain_id, tasks=len(made))
    store.event(con, "PROJECT_OPENED", actor=by, subject="project:%d" % pid,
                payload={"opportunity": opp_id, "tasks": list(made.values()),
                         "team": [a for a, _ in plan["members"]]})
    return {"project_id": pid, "team_id": team_id, "tasks": made,
            "members": [a for a, _ in plan["members"]]}


def _cond_kind(text):
    t = text.lower()
    if "artifact exists" in t:
        return "artifact"
    if "verification" in t:
        return "evidence"
    return "review"


# ── MEMORY ACROSS RUNS ───────────────────────────────────────────────
# Identity already survives. Execution memory has to as well, or the same agent
# relearns the same lesson every time it wakes.
def remember_candidate(con, agent_id, text, kind="LESSON", scope="agent",
                       owner_id=None, evidence_id=None, project_id=None,
                       chain_id=None):
    """What an execution learned, written where the next wake can find it.

    A model statement is never automatically a FACT: LAW 18 refuses a FACT with
    no evidence under it, and this function does not invent one. A claim with no
    evidence is a HYPOTHESIS and is stored as one."""
    POL.require(con, "memory.write.candidate", agent_id, chain_id=chain_id)
    if kind == "FACT" and evidence_id is None:
        # Not a FACT, and not a new vocabulary either: `memories.kind` already
        # has the word for an assertion nobody has backed yet.
        kind = "CLAIM"
    owner = owner_id or (agent_id if scope == "agent"
                         else str(project_id) if scope == "project" else "org")
    return W.remember(con, scope, owner, kind, text, by=agent_id,
                      evidence_id=evidence_id)


def wake_memory(con, agent_id, project_id=None, limit=12):
    """What this agent should have in mind when it wakes.

    Its own memory, the project's, and what the organisation has promoted —
    in that order, because the specific should outrank the general."""
    out = []
    out += [dict(r, band="agent") for r in W.recall(con, "agent", agent_id, limit)]
    if project_id is not None:
        out += [dict(r, band="project") for r in W.recall(con, "project",
                                                          str(project_id), limit)]
    out += [dict(r, band="org") for r in W.recall(con, "org", "org", limit)]
    return out[:limit * 2]


# ── ORGANISATIONAL LEARNING ──────────────────────────────────────────
def record_failure(con, what_happened, why, by, project_id=None, task_id=None,
                   lesson="", evidence_id=None, usd_cost=0.0):
    """A failure becomes a record and a CANDIDATE lesson — never truth yet."""
    fid = con.execute(
        "INSERT INTO failures(subject_kind,subject_id,what_happened,why,agents,"
        "usd_cost,evidence_id,lesson,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        ("task" if task_id else "project", str(task_id or project_id or ""),
         what_happened, why, json.dumps([by]), usd_cost, evidence_id,
         lesson or why, now())).lastrowid
    lid = con.execute(
        "INSERT INTO lessons(at,text,subject_kind,subject_id,project_id,task_id,"
        "failure_id,evidence_id,proposed_by) VALUES(?,?,?,?,?,?,?,?,?)",
        (now(), lesson or why, "task" if task_id else "project",
         str(task_id or project_id or ""), project_id, task_id, fid, evidence_id,
         by)).lastrowid
    store.event(con, "FAILURE_RECORDED", actor=by, subject="failure:%d" % fid,
                payload={"what": what_happened[:300], "lesson_id": lid})
    return {"failure_id": fid, "lesson_id": lid}


def propose_lesson_promotion(con, lesson_id, by, chain_id=None):
    """An agent asks for a lesson to become organisational truth, and stops.

    `memory.promote` is APPROVAL_REQUIRED, so this records the ask and returns.
    Nothing is promoted until a decision exists."""
    l = con.execute("SELECT * FROM lessons WHERE id=?", (lesson_id,)).fetchone()
    if l is None:
        raise WorldError("no lesson %s" % lesson_id)
    return POL.propose(con, "memory.promote", by,
                     "Promote lesson #%d to organisational memory?" % lesson_id,
                     l["text"], project_id=l["project_id"],
                     evidence_id=l["evidence_id"], chain_id=chain_id)


def promote_lesson(con, lesson_id, by=OWNER):
    """Perform a promotion the Owner has already authorised.

    The policy gate is `propose_lesson_promotion`, which an agent calls; this is
    the control plane acting afterwards, so it does not gate again — it enforces
    the two things LAW 26 also enforces in SQL: the owner plane, and evidence.
    One agent's unsupported conclusion cannot become what the organisation
    knows, however confident it was."""
    if by != OWNER:
        raise WorldError("only the owner plane promotes a lesson")
    l = con.execute("SELECT * FROM lessons WHERE id=?", (lesson_id,)).fetchone()
    if l is None:
        raise WorldError("no lesson %s" % lesson_id)
    if l["evidence_id"] is None:
        raise WorldError("lesson %d has no evidence; it stays a candidate" % lesson_id)
    mid = W.remember(con, "org", "org", "LESSON", l["text"], by=by,
                     evidence_id=l["evidence_id"])
    con.execute("UPDATE lessons SET state='PROMOTED', promoted_by=?, promoted_at=?, "
                "memory_id=? WHERE id=?", (by, now(), mid, lesson_id))
    store.event(con, "LESSON_PROMOTED", actor=by, subject="lesson:%d" % lesson_id,
                payload={"memory_id": mid})
    return mid


def relevant_lessons(con, limit=10):
    return [dict(r) for r in con.execute(
        "SELECT * FROM lessons WHERE state='PROMOTED' ORDER BY id DESC LIMIT ?",
        (limit,))]


# ── SKILL GAP ────────────────────────────────────────────────────────
def detect_skill_gap(con, required_caps):
    """Which required capabilities nobody in the crew covers."""
    covered = set()
    for have in W.ROLE_CAPABILITY.values():
        covered |= have
    return sorted(set(required_caps) - covered)


def request_skill(con, gap, by, chain_id=None):
    """Open a factory job for a missing capability, and STOP.

    An agent may notice it lacks something and ask. It may not answer its own
    request: `skill.activate` is APPROVAL_REQUIRED, so the job is created, the
    Owner is asked, and nothing is installed in the meantime."""
    jid = con.execute(
        "INSERT INTO factory_jobs(kind,requested_by,gap,analysis,created_at) "
        "VALUES('SKILL',?,?,?,?)",
        (by, ",".join(gap), json.dumps({"missing": gap}), now())).lastrowid
    aid = POL.propose(con, "skill.activate", by,
                    "Activate a new capability: %s?" % ", ".join(gap),
                    "no agent in the crew covers it; factory job #%d" % jid,
                    chain_id=chain_id)
    store.event(con, "SKILL_GAP_FOUND", actor=by, subject="factory_job:%d" % jid,
                payload={"gap": gap, "approval_id": aid})
    return {"factory_job": jid, "approval": aid}


# ── OWNER PRESENCE ───────────────────────────────────────────────────
def go_away(con, note="", until=None):
    con.execute("INSERT INTO owner_presence(at,state,note,until) VALUES(?,'AWAY',?,?)",
                (now(), note, until))
    store.event(con, "OWNER_AWAY", actor="OWNER", subject="presence",
                payload={"note": note, "until": until})
    return now()


def come_back(con, note=""):
    con.execute("INSERT INTO owner_presence(at,state,note) VALUES(?,'PRESENT',?)",
                (now(), note))
    store.event(con, "OWNER_PRESENT", actor="OWNER", subject="presence",
                payload={"note": note})
    return now()


def presence(con):
    r = con.execute("SELECT * FROM owner_presence ORDER BY id DESC LIMIT 1").fetchone()
    return {"state": "PRESENT", "since": None} if r is None else \
           {"state": r["state"], "since": r["at"], "note": r["note"]}


def away_since(con):
    r = con.execute("SELECT at FROM owner_presence WHERE state='AWAY' "
                    "ORDER BY id DESC LIMIT 1").fetchone()
    return r["at"] if r else None


def repoint_deps(con, old_task, new_task):
    """Move dependents from a failed task onto its correction.

    Without this the graph deadlocks the moment anything is rejected: a task
    that depends on a FAILED task waits for it to reach ACCEPTED, which it never
    will, and the world looks idle when it is actually stuck. The correction is
    the thing the dependents were really waiting for."""
    moved = []
    for r in con.execute("SELECT task_id FROM task_deps WHERE depends_on=?",
                         (old_task,)).fetchall():
        if r["task_id"] == new_task:
            continue
        con.execute("DELETE FROM task_deps WHERE task_id=? AND depends_on=?",
                    (r["task_id"], old_task))
        add_dep(con, r["task_id"], new_task)
        moved.append(r["task_id"])
    if moved:
        store.event(con, "DEPENDENCIES_REPOINTED", actor=OWNER,
                    subject="task:%d" % new_task,
                    payload={"from": old_task, "to": new_task, "dependents": moved})
    return moved


def record_tool_evidence(con, tool_call_id, by, kind="tool"):
    """Turn a gateway ALLOW into an evidence row.

    Evidence is what the gateway returned, attributed to the call that returned
    it. It is not what an agent says it saw — which is the difference between
    evidence and testimony, and the reason a discovery can be checked later."""
    c = con.execute("SELECT * FROM tool_calls WHERE id=?", (tool_call_id,)).fetchone()
    if c is None or c["decision"] != "ALLOW":
        return None
    # tool_calls stores args_sha, not the args: the gateway records that a call
    # was made and what came back, never the payload. Provenance is therefore
    # the capability and the hash of what it was asked, which is enough to tie
    # the evidence to one call and not enough to leak what was in it.
    prov = "%s@call:%d/%s" % (c["cap"], c["id"], (c["args_sha"] or "")[:16])
    return con.execute(
        "INSERT INTO evidence(kind,external_provenance,detail,content_sha,"
        "collected_by,collected_at) VALUES(?,?,?,?,?,?)",
        (kind, prov, json.dumps({"tool_call_id": c["id"], "cap": c["cap"]}),
         c["result_sha"] or "", by, now())).lastrowid


# ── PERSISTED CAUSALITY ──────────────────────────────────────────────
# The question this answers is not "what happened" — the event log already says
# that — but "can the chain from the Owner's one sentence to the finished work
# be rebuilt from rows alone, with nothing inferred and nothing remembered by a
# running process?" If it can, the world is genuinely persistent. If it cannot,
# the world only looked autonomous while the process that ran it was alive.
CAUSAL_LINKS = (
    "objective", "discovery", "opportunity", "project", "team", "task", "lease",
    "run", "tool_call", "observation", "artifact", "verification", "review",
    "rejection", "correction", "acceptance", "next_task", "completion",
)


def world_causality(con, objective_subject="objective:1"):
    """Rebuild the whole chain from persisted rows. No process state is used."""
    out = []

    def link(kind, rid, at, actor, detail):
        out.append({"link": kind, "id": rid, "at": at, "actor": actor,
                    "detail": detail})

    q = con.execute("SELECT * FROM world_queue WHERE kind='OWNER_OBJECTIVE' "
                    "ORDER BY id LIMIT 1").fetchone()
    if q is None:
        return out
    link("objective", q["id"], q["at"], q["emitted_by"],
         json.loads(q["payload"] or "{}").get("objective", "")[:90])

    for d in con.execute("SELECT * FROM discoveries ORDER BY id"):
        link("discovery", d["id"], d["created_at"],
             (json.loads(d["source_agents"] or "[]") or [None])[0],
             "evidence #%s · confidence %.2f" % (d["evidence_id"], d["confidence"]))

    for o in con.execute("SELECT * FROM opportunities ORDER BY id"):
        link("opportunity", o["id"], o["created_at"], o["discovered_by"],
             "%s · decided by %s · %s" % (o["status"], o["decided_by"],
                                          (o["decision_why"] or "")[:40]))
        if o["project_id"]:
            p = con.execute("SELECT * FROM projects WHERE id=?",
                            (o["project_id"],)).fetchone()
            link("project", p["id"], p["created_at"], OWNER,
                 "%s · from %s" % (p["stage"], p["origin"]))
            for t in con.execute("SELECT * FROM teams WHERE project_id=?", (p["id"],)):
                members = [r["principal_id"] for r in con.execute(
                    "SELECT principal_id FROM team_members WHERE team_id=?", (t["id"],))]
                link("team", t["id"], t["created_at"], ORCH, ", ".join(members))

    for t in con.execute("SELECT * FROM tasks WHERE project_id IS NOT NULL ORDER BY id"):
        deps = [r["depends_on"] for r in con.execute(
            "SELECT depends_on FROM task_deps WHERE task_id=?", (t["id"],))]
        kind = "correction" if t["objective"].startswith("Correct:") else "task"
        link(kind, t["id"], t["created_at"], t["created_by"],
             "%s%s" % (t["status"], " · after %s" % deps if deps else ""))
        for l in con.execute("SELECT * FROM leases WHERE task_id=? ORDER BY id", (t["id"],)):
            link("lease", l["id"], l["granted_at"], l["principal_id"], l["status"])
        for r in con.execute("SELECT * FROM runs WHERE task_id=? ORDER BY id", (t["id"],)):
            link("run", r["id"], r["started_at"], r["principal_id"],
                 "%s · %s" % (r["source"], r["status"]))
        for c in con.execute(
                "SELECT c.* FROM tool_calls c JOIN leases l ON l.id=c.lease_id "
                "WHERE l.task_id=? ORDER BY c.id", (t["id"],)):
            link("tool_call", c["id"], c["at"], c["principal_id"],
                 "%s %s" % (c["cap"], c["decision"]))
            if c["decision"] == "ALLOW" and c["result_sha"]:
                link("observation", c["id"], c["at"], c["principal_id"],
                     "gateway returned sha %s" % c["result_sha"][:12])
        for a in con.execute("SELECT * FROM artifacts WHERE task_id=? ORDER BY id",
                             (t["id"],)):
            link("artifact", a["id"], a["created_at"], a["principal_id"],
                 "%s · sha %s" % (a["name"], a["sha"][:12]))
            for e in con.execute("SELECT * FROM evidence WHERE external_provenance "
                                 "LIKE ? ORDER BY id", ("artifact:%d@%%" % a["id"],)):
                d = json.loads(e["detail"] or "{}")
                link("verification", e["id"], e["collected_at"], e["collected_by"],
                     "passed" if d.get("passed") else "FAILED: " + "; ".join(
                         c["requirement"] for c in d.get("checks", [])
                         if not c["passed"])[:60])
            for r in con.execute("SELECT * FROM reviews WHERE artifact_id=? ORDER BY id",
                                 (a["id"],)):
                link("review", r["id"], r["created_at"], r["reviewer_id"],
                     "%s · %s" % (r["verdict"], (r["rationale"] or "")[:50]))
        for tr in con.execute("SELECT * FROM task_transitions WHERE task_id=? "
                              "AND to_state IN ('FAILED','ACCEPTED') ORDER BY id",
                              (t["id"],)):
            link("rejection" if tr["to_state"] == "FAILED" else "acceptance",
                 tr["id"], tr["at"], tr["actor"], tr["why"][:60])

    for e in con.execute("SELECT * FROM events WHERE kind='PROJECT_COMPLETED' ORDER BY id"):
        link("completion", e["id"], e["at"], e["actor"], e["subject"])
    return out


def causality_covers(con, objective_subject="objective:1"):
    """Which of the declared causal links the record actually contains."""
    seen = {l["link"] for l in world_causality(con, objective_subject)}
    # `next_task` is the second task becoming runnable, which the record shows as
    # a task with a dependency that is now satisfied.
    if any(r for r in con.execute(
            "SELECT d.task_id FROM task_deps d JOIN tasks t ON t.id=d.depends_on "
            "WHERE t.status='ACCEPTED'")):
        seen.add("next_task")
    return sorted(seen), sorted(set(CAUSAL_LINKS) - seen)
