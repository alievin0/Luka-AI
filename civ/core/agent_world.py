"""AGENT WORLD V0 — the control plane. Deterministic code, no model.

Nothing in this module calls a model, and nothing a model says reaches it as an
instruction. A model may write the CONTENT of an artifact; it may never decide a
permission, a lifecycle transition, a team, a budget or an acceptance. Those are
the control plane's, and the control plane is ordinary Python with the laws
underneath it in SQL.

The five agents are persistent IDENTITIES, not processes. Nothing runs between
runs. Identity survives because it lives in `principals` with its contract,
grants, memory and history — which is the only kind of persistence that means
anything when the machine is off.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from . import contract as K
from . import runtime, store
from .store import now, sha

# ── THE FIVE ────────────────────────────────────────────────────────
# Role, not personality. Each carries the narrowest capability set that lets it
# do its job, because an agent that can do its neighbour's job is an agent whose
# mistakes are indistinguishable from its neighbour's.
ARTIFACT_DIR = os.path.join(HERE, "artifacts")
REPO_ROOT = os.path.dirname(HERE)

READ_SCOPE = {"cap": "READ_REPO", "scope": {"path_prefix": REPO_ROOT},
              "rate": {"per_lease": 20, "per_hour": 400}}
WRITE_SCOPE = {"cap": "WRITE_ARTIFACT",
               "scope": {"path_prefix": ARTIFACT_DIR, "max_bytes": 200000},
               "rate": {"per_lease": 8, "per_hour": 200}}
EXEC_SCOPE = {"cap": "EXECUTE_SANDBOX",
              "scope": {"argv0_allow": ["python3", "python", "python3.11"],
                        "argv_script_root": ARTIFACT_DIR,
                        "argv_deny_substrings": ["curl", "wget", "nc ", "sh -c",
                                                 "bash -c", "|", ">", "&&", ";"]},
              "rate": {"per_lease": 3, "per_hour": 60}}

CREW = [
    dict(id="AGT-ORCHESTRATOR", name="Orchestrator", role="Objective Decomposer",
         tier="actor", division="Operations", department="Coordination",
         mission="Turn an owner objective into a minimum set of assigned tasks, "
                 "track their dependencies, and never route around a permission.",
         tools=[], permissions=[],
         memory_scope=["self", "project", "org"],
         success_metrics=[{"metric": "tasks_accepted_first_pass", "target": 0.8}],
         escalation_rules=[{"when": "no_capable_agent", "action": "OWNER_APPROVAL"}],
         autonomy_level=2,
         # It coordinates. It cannot read the repository, write an artifact or
         # execute anything — so it can never quietly do the work it delegates,
         # and a task it reports as done was done by someone it can name.
         can=["decompose", "assign", "form_team", "record"]),
    dict(id="AGT-RESEARCHER", name="Researcher", role="Evidence Gatherer",
         tier="actor", division="Knowledge", department="Research",
         mission="Investigate a question and come back with evidence, keeping "
                 "what was observed separate from what it means.",
         tools=["fs.read"], permissions=[READ_SCOPE],
         memory_scope=["self", "project"],
         success_metrics=[{"metric": "claims_backed_by_evidence", "target": 1.0}],
         escalation_rules=[{"when": "no_evidence_available", "action": "NEED_EVIDENCE"}],
         autonomy_level=2,
         can=["read", "claim", "evidence"]),
    dict(id="AGT-BUILDER", name="Builder", role="Artifact Producer",
         tier="actor", division="Engineering", department="Delivery",
         mission="Turn an approved task into a real artifact on disk and report "
                 "what was actually produced, not what was intended.",
         tools=["fs.read", "fs.write"], permissions=[READ_SCOPE, WRITE_SCOPE],
         memory_scope=["self", "project"],
         success_metrics=[{"metric": "artifacts_accepted", "target": 0.8}],
         escalation_rules=[{"when": "spec_contradicts_itself", "action": "ESCALATE"}],
         autonomy_level=2,
         can=["read", "write_artifact"]),
    dict(id="AGT-REVIEWER", name="Reviewer", role="Independent Reviewer",
         tier="judge", division="Assurance", department="Review",
         mission="Judge someone else's work from evidence, challenge what is "
                 "asserted without it, and be able to reject.",
         # Read, never write: a reviewer that can edit the artifact is a
         # co-author, and LAW 5 would have nothing left to protect.
         tools=["fs.read"], permissions=[READ_SCOPE],
         memory_scope=["project", "org"],
         success_metrics=[{"metric": "rejections_upheld", "target": 0.9}],
         escalation_rules=[{"when": "no_evidence", "action": "NEED_EVIDENCE"}],
         autonomy_level=1,
         can=["read", "review"]),
    dict(id="AGT-OPERATOR", name="Operator", role="Workflow Executor",
         tier="actor", division="Operations", department="Execution",
         mission="Execute approved workflows through authorised tools and record "
                 "every action, without ever widening what it is allowed to do.",
         tools=["proc.run", "fs.read"], permissions=[READ_SCOPE, EXEC_SCOPE],
         memory_scope=["self", "org"],
         success_metrics=[{"metric": "actions_recorded", "target": 1.0}],
         escalation_rules=[{"when": "tool_denied", "action": "REPORT"}],
         autonomy_level=2,
         can=["read", "execute"]),
]

ROLE_CAPABILITY = {
    "AGT-ORCHESTRATOR": {"decompose", "assign", "coordinate"},
    "AGT-RESEARCHER": {"research", "evidence", "read"},
    "AGT-BUILDER": {"build", "write", "read"},
    "AGT-REVIEWER": {"review", "read"},
    "AGT-OPERATOR": {"execute", "operate", "read"},
}

OWNER = "OWNER_PLANE"

# ── THE LIFECYCLE ───────────────────────────────────────────────────
# A state machine in ordinary code. An LLM cannot move a task; only a call to
# `transition` can, and only along an edge that exists.
LIFECYCLE = {
    "DISCOVERED": {"PROPOSED", "ARCHIVED"},
    "PROPOSED":   {"APPROVED", "REJECTED", "ARCHIVED"},
    "APPROVED":   {"ASSIGNED", "ARCHIVED"},
    "ASSIGNED":   {"RUNNING", "BLOCKED", "ARCHIVED"},
    "RUNNING":    {"COMPLETED", "FAILED", "BLOCKED"},
    "BLOCKED":    {"RUNNING", "FAILED", "ARCHIVED"},
    "FAILED":     {"PROPOSED", "ARCHIVED"},
    "COMPLETED":  {"REVIEW"},
    "REVIEW":     {"ACCEPTED", "REJECTED"},
    "ACCEPTED":   {"ARCHIVED"},
    "REJECTED":   {"PROPOSED", "ARCHIVED"},
    "ARCHIVED":   set(),
}
TERMINAL = {"ARCHIVED"}


class WorldError(RuntimeError):
    """The control plane refused. Never raised because a model asked it to."""


# ── FOUNDING ────────────────────────────────────────────────────────
def found_agents(con):
    """Register the five, idempotently. Returns their ids.

    Calling this twice is not calling it twice: an agent that already exists
    keeps its id, its history and its memory. That is what persistent means
    here — the identity outlives the process that created it."""
    ids = []
    for a in CREW:
        ids.append(a["id"])
        if con.execute("SELECT 1 FROM principals WHERE id=?", (a["id"],)).fetchone():
            continue
        c = K.blank(a["id"], a["name"], a["role"], a["division"], a["department"],
                    a["mission"], tier=a["tier"])
        c["tools"] = list(a["tools"])
        c["permissions"] = [dict(p) for p in a["permissions"]]
        c["memory_scope"] = list(a["memory_scope"])
        c["success_metrics"] = list(a["success_metrics"])
        c["escalation_rules"] = list(a["escalation_rules"])
        c["autonomy_level"] = a["autonomy_level"]
        K.register(con, c, reason="agent world V0")
        for state in ("EVALUATING", "APPROVED", "ACTIVE"):
            K.transition(con, a["id"], state, why="V0 founding")
        store.event(con, "AGENT_ACTIVATED", actor=OWNER, subject=a["id"],
                    payload={"role": a["role"], "tier": a["tier"]})
    return ids


def build_gateway(con):
    """The SAME gateway, with the same three tools. V0 registers no new
    capability: an agent world that needed a new privileged door would be an
    agent world with a new way to be wrong."""
    gw = runtime.Gateway(con)

    def fs_read(path):
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read()[:20000]

    def fs_write(path, body):
        full = os.path.abspath(os.path.join(ARTIFACT_DIR, path))
        if not full.startswith(os.path.abspath(ARTIFACT_DIR) + os.sep):
            raise runtime.Denied("write outside the artifact directory")
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(body)
        return full

    def proc_run(argv, cwd=None, timeout=20):
        import subprocess
        r = subprocess.run(argv, cwd=cwd or ARTIFACT_DIR, capture_output=True,
                           text=True, timeout=timeout)
        return {"returncode": r.returncode, "stdout": r.stdout[:8000],
                "stderr": r.stderr[:4000]}

    gw.register("READ_REPO", fs_read)
    gw.register("WRITE_ARTIFACT", fs_write)
    gw.register("EXECUTE_SANDBOX", proc_run)
    return gw


# ── TASKS ───────────────────────────────────────────────────────────
def discover_task(con, objective, by, project_id=None, kind="work",
                  required_caps=(), conditions=(), evidence_required=0, priority=5):
    """A task starts as DISCOVERED — noticed, not agreed to.

    `conditions` is what "done" will mean, declared NOW, before anyone knows
    whether it will be met. That ordering is the whole point: a completion bar
    written after the work is a bar the work was always going to clear."""
    tid = con.execute(
        "INSERT INTO tasks(project_id,objective,kind,required_caps,priority,status,"
        "evidence_required,created_by,created_at) VALUES(?,?,?,?,?,'DISCOVERED',?,?,?)",
        (project_id, objective, kind, json.dumps(sorted(required_caps)), priority,
         evidence_required, by, now())).lastrowid
    for cond in conditions:
        c = cond if isinstance(cond, dict) else {"description": cond, "kind": "artifact"}
        con.execute("INSERT INTO task_conditions(task_id,description,kind,created_at) "
                    "VALUES(?,?,?,?)", (tid, c["description"], c["kind"], now()))
    eid = store.event(con, "TASK_DISCOVERED", actor=by, subject="task:%d" % tid,
                      payload={"objective": objective, "conditions": len(conditions)})
    con.execute("INSERT INTO task_transitions(task_id,from_state,to_state,actor,why,"
                "event_id,at) VALUES(?,NULL,'DISCOVERED',?,?,?,?)",
                (tid, by, "noticed", eid, now()))
    return tid


def transition(con, task_id, to, actor, why=""):
    """Move a task along the lifecycle, or refuse.

    Refusals are structural: an edge that is not in LIFECYCLE does not exist, no
    matter who asks. `actor` is recorded because "the task moved" is not a fact
    anyone can act on — "X moved it, for this reason" is."""
    row = con.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if row is None:
        raise WorldError("no task %r" % task_id)
    frm = row["status"]
    if frm not in LIFECYCLE:
        raise WorldError("task %d is in runtime state %r, not a world state"
                         % (task_id, frm))
    if to not in LIFECYCLE[frm]:
        raise WorldError("illegal transition %s -> %s (task %d); legal: %s"
                         % (frm, to, task_id, sorted(LIFECYCLE[frm]) or "none"))
    if to in ("APPROVED",) and actor != OWNER and not _may_approve(con, actor):
        raise WorldError("%s may not approve work" % actor)
    con.execute("UPDATE tasks SET status=? WHERE id=?", (to, task_id))
    eid = store.event(con, "TASK_" + to, actor=actor, subject="task:%d" % task_id,
                      payload={"from": frm, "why": why})
    con.execute("INSERT INTO task_transitions(task_id,from_state,to_state,actor,why,"
                "event_id,at) VALUES(?,?,?,?,?,?,?)", (task_id, frm, to, actor, why,
                                                       eid, now()))
    return to


def _may_approve(con, actor):
    """Approval is an owner-plane act. The orchestrator may approve work it did
    not do; nobody approves their own."""
    return actor == "AGT-ORCHESTRATOR"


def satisfy_condition(con, task_id, description, by, row_id=None):
    """Mark a declared condition met, and say what met it."""
    cur = con.execute("UPDATE task_conditions SET satisfied=1, satisfied_by=?, "
                      "satisfied_at=? WHERE task_id=? AND description=? AND satisfied=0",
                      (row_id, now(), task_id, description))
    if not cur.rowcount:
        raise WorldError("no unsatisfied condition %r on task %d" % (description, task_id))
    store.event(con, "CONDITION_MET", actor=by, subject="task:%d" % task_id,
                payload={"condition": description, "by_row": row_id})
    return True


def open_conditions(con, task_id):
    return [dict(r) for r in con.execute(
        "SELECT * FROM task_conditions WHERE task_id=? AND satisfied=0", (task_id,))]


def assign(con, task_id, to_agent, by, why=""):
    """Assign, then say so in a message. An assignment nobody was told about is
    not an assignment."""
    caps = set(json.loads(con.execute("SELECT required_caps FROM tasks WHERE id=?",
                                      (task_id,)).fetchone()["required_caps"] or "[]"))
    have = ROLE_CAPABILITY.get(to_agent, set())
    if caps and not caps.issubset(have):
        raise WorldError("%s cannot do task %d: needs %s, has %s"
                         % (to_agent, task_id, sorted(caps), sorted(have)))
    transition(con, task_id, "ASSIGNED", by, why or "assigned to %s" % to_agent)
    con.execute("UPDATE tasks SET result=? WHERE id=?",
                (json.dumps({"assignee": to_agent}), task_id))
    send(con, sender=by, recipient=to_agent, kind="ASSIGN", task_id=task_id,
         payload={"objective": con.execute("SELECT objective FROM tasks WHERE id=?",
                                           (task_id,)).fetchone()["objective"]},
         authority="orchestrator:assign")
    return to_agent


def assignee(con, task_id):
    r = con.execute("SELECT result FROM tasks WHERE id=?", (task_id,)).fetchone()
    try:
        return json.loads(r["result"] or "{}").get("assignee")
    except (ValueError, TypeError):
        return None


def claim_task(con, agent_id, task_id=None, lease_seconds=300):
    """Take a lease on an ASSIGNED task and start RUNNING.

    Bounded concurrency without a running process: the lease is the bound. A
    second claim on a leased task returns None rather than racing, and an
    expired lease returns the task to ASSIGNED rather than stranding it."""
    reap(con)
    q = ("SELECT * FROM tasks WHERE status='ASSIGNED'"
         + (" AND id=?" if task_id else "")
         + " ORDER BY priority DESC, id ASC")
    rows = con.execute(q, (task_id,) if task_id else ()).fetchall()
    for t in rows:
        if assignee(con, t["id"]) not in (None, agent_id):
            continue
        if con.execute("SELECT 1 FROM leases WHERE task_id=? AND status='ACTIVE'",
                       (t["id"],)).fetchone():
            continue
        caps = sorted(set(json.loads(t["required_caps"] or "[]")))
        from datetime import datetime, timedelta, timezone
        exp = (datetime.now(timezone.utc)
               + timedelta(seconds=lease_seconds)).isoformat(timespec="microseconds")
        lid = con.execute(
            "INSERT INTO leases(task_id,principal_id,granted_at,expires_at,"
            "token_budget,caps) VALUES(?,?,?,?,?,?)",
            (t["id"], agent_id, now(), exp, t["token_budget"],
             json.dumps(caps))).lastrowid
        transition(con, t["id"], "RUNNING", agent_id, "lease %d" % lid)
        return {"lease_id": lid, "task_id": t["id"], "objective": t["objective"],
                "expires_at": exp}
    return None


def release_lease(con, lease_id, why="work finished"):
    """Close a lease WITHOUT touching the task's world state.

    `runtime.release` sets tasks.status='DONE' — correct for the runtime's own
    claim-and-release cycle, wrong here: in the agent world a task is not done
    because a lease ended, it is done when its declared conditions are met and a
    reviewer says so. The lifecycle owns tasks.status; the lease owns nothing but
    itself."""
    l = con.execute("SELECT * FROM leases WHERE id=?", (lease_id,)).fetchone()
    if l is None:
        raise WorldError("no lease %r" % lease_id)
    con.execute("UPDATE leases SET status='RELEASED' WHERE id=?", (lease_id,))
    con.execute("UPDATE principals SET status='AVAILABLE' WHERE id=?",
                (l["principal_id"],))
    store.event(con, "LEASE_RELEASED", actor=l["principal_id"],
                subject="task:%d" % l["task_id"], payload={"lease": lease_id, "why": why})
    return True


def reap(con):
    """An expired lease is a task to be redelivered, not a task in progress."""
    n = 0
    for l in con.execute("SELECT * FROM leases WHERE status='ACTIVE' AND expires_at < ?",
                         (now(),)).fetchall():
        con.execute("UPDATE leases SET status='EXPIRED' WHERE id=?", (l["id"],))
        t = con.execute("SELECT status FROM tasks WHERE id=?", (l["task_id"],)).fetchone()
        if t and t["status"] == "RUNNING":
            transition(con, l["task_id"], "BLOCKED", OWNER, "lease %d expired" % l["id"])
            transition(con, l["task_id"], "RUNNING", OWNER, "redelivered")
            con.execute("UPDATE tasks SET status='ASSIGNED' WHERE id=?", (l["task_id"],))
        n += 1
    return n


# ── COMMUNICATION ───────────────────────────────────────────────────
def send(con, sender, recipient, kind, payload=None, task_id=None, project_id=None,
         evidence_id=None, artifact_id=None, authority="role", lease_id=None,
         idempotency_key=None):
    """One recorded message. Redelivery is not a second message.

    `idempotency_key` makes a retried send a no-op that returns the ORIGINAL
    message id, so a queue that delivers twice cannot make the history say
    something happened twice."""
    if idempotency_key:
        prior = con.execute("SELECT id FROM agent_messages WHERE idempotency_key=?",
                            (idempotency_key,)).fetchone()
        if prior:
            return prior["id"]
    eid = store.event(con, "MESSAGE_" + kind, actor=sender, subject=recipient,
                      payload={"task": task_id, "kind": kind})
    return con.execute(
        "INSERT INTO agent_messages(sender,recipient,kind,task_id,project_id,payload,"
        "evidence_id,artifact_id,authority,lease_id,event_id,idempotency_key,at) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (sender, recipient, kind, task_id, project_id,
         json.dumps(payload or {}, ensure_ascii=False), evidence_id, artifact_id,
         authority, lease_id, eid, idempotency_key, now())).lastrowid


def inbox(con, agent_id, limit=50):
    return [dict(r) for r in con.execute(
        "SELECT * FROM agent_messages WHERE recipient=? ORDER BY id DESC LIMIT ?",
        (agent_id, limit))]


def thread(con, task_id):
    """Everything said under one task, in order. This is the reconstruction the
    world is supposed to make possible."""
    return [dict(r) for r in con.execute(
        "SELECT * FROM agent_messages WHERE task_id=? ORDER BY id", (task_id,))]


# ── MEMORY ──────────────────────────────────────────────────────────
def remember(con, scope, owner_id, kind, text, by, claim_id=None, evidence_id=None,
             task_id=None):
    """Write to memory at an explicit scope. FACT needs evidence (LAW 18)."""
    if scope not in ("agent", "project", "org"):
        raise WorldError("scope must be agent, project or org")
    return con.execute(
        "INSERT INTO memories(scope,owner_id,kind,text,claim_id,evidence_id,task_id,"
        "created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        (scope, owner_id, kind, text, claim_id, evidence_id, task_id, by,
         now())).lastrowid


def recall(con, scope, owner_id, limit=50):
    """An agent reads its own scope. There is no query here that returns another
    agent's private memory, because there is no such read in the model."""
    return [dict(r) for r in con.execute(
        "SELECT * FROM memories WHERE scope=? AND owner_id=? ORDER BY id DESC LIMIT ?",
        (scope, owner_id, limit))]


def readable_scopes(con, agent_id):
    """What this agent's contract says it may remember across."""
    row = con.execute("SELECT memory_scope FROM principals WHERE id=?",
                      (agent_id,)).fetchone()
    return json.loads(row["memory_scope"]) if row else []


# ── TEAM FORMATION ──────────────────────────────────────────────────
def form_team_for(con, required, project_id=None, by="AGT-ORCHESTRATOR",
                  name="Task Team"):
    """The minimum team that covers the requirement, and no one else.

    Staffing every project with every agent is how an organisation stops being
    able to say who was responsible."""
    need, chosen = set(required), []
    for aid, have in ROLE_CAPABILITY.items():
        if not need:
            break
        gain = have & need
        if gain:
            chosen.append((aid, sorted(gain)))
            need -= gain
    if need:
        raise WorldError("no agent covers %s" % sorted(need))
    if project_id is None:
        return {"members": chosen, "uncovered": []}
    tid = con.execute("INSERT INTO teams(project_id,name,purpose,created_at) "
                      "VALUES(?,?,?,?)",
                      (project_id, name, "covers " + ",".join(sorted(required)),
                       now())).lastrowid
    for aid, gain in chosen:
        con.execute("INSERT OR IGNORE INTO team_members(team_id,principal_id,seat) "
                    "VALUES(?,?,?)", (tid, aid, ",".join(gain)))
    store.event(con, "TEAM_FORMED", actor=by, subject="team:%d" % tid,
                payload={"members": [a for a, _ in chosen], "covers": sorted(required)})
    return {"team_id": tid, "members": chosen, "uncovered": []}


# ── PROJECT PASSPORT ────────────────────────────────────────────────
def project_passport(con, project_id):
    """Everything about a project in one place, computed from what happened.

    No field here is stored separately from the events that produced it, so the
    passport cannot drift from the record — there is nothing to drift from."""
    p = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if p is None:
        raise WorldError("no project %r" % project_id)
    tasks = [dict(r) for r in con.execute(
        "SELECT * FROM tasks WHERE project_id=? ORDER BY id", (project_id,))]
    tids = [t["id"] for t in tasks] or [-1]
    q = ",".join("?" * len(tids))
    arts = [dict(r) for r in con.execute(
        "SELECT * FROM artifacts WHERE project_id=? ORDER BY id", (project_id,))]
    revs = [dict(r) for r in con.execute(
        "SELECT r.* FROM reviews r JOIN artifacts a ON a.id=r.artifact_id "
        "WHERE a.project_id=? ORDER BY r.id", (project_id,))]
    claims = [dict(r) for r in con.execute(
        "SELECT * FROM claims WHERE project_id=? ORDER BY id", (project_id,))]
    team = [dict(r) for r in con.execute(
        "SELECT tm.* FROM team_members tm JOIN teams t ON t.id=tm.team_id "
        "WHERE t.project_id=?", (project_id,))]
    blocked = [t for t in tasks if t["status"] in ("BLOCKED", "FAILED")]
    waiting = [t for t in tasks if t["status"] in ("PROPOSED", "REVIEW")]
    timeline = [dict(r) for r in con.execute(
        "SELECT * FROM events WHERE subject IN (%s) OR subject=? ORDER BY id"
        % ",".join("'task:%d'" % i for i in tids), ("project:%d" % project_id,))]
    return {
        "project_id": project_id, "objective": p["mission"], "name": p["name"],
        "owner": OWNER, "status": p["stage"],
        "team": [{"agent": m["principal_id"], "seat": m["seat"]} for m in team],
        "tasks": [{"id": t["id"], "objective": t["objective"], "status": t["status"],
                   "assignee": assignee(con, t["id"]),
                   "open_conditions": [c["description"] for c in open_conditions(con, t["id"])]}
                  for t in tasks],
        "artifacts": [{"id": a["id"], "name": a["name"], "by": a["principal_id"],
                       "sha": a["sha"], "source": a["source"]} for a in arts],
        "evidence": [dict(r) for r in con.execute(
            "SELECT e.* FROM evidence e JOIN claims c ON c.evidence_id=e.id "
            "WHERE c.project_id=? GROUP BY e.id", (project_id,))],
        "claims": [{"id": c["id"], "text": c["text"], "status": c["status"],
                    "evidence_id": c["evidence_id"]} for c in claims],
        "reviews": [{"id": r["id"], "artifact_id": r["artifact_id"],
                     "reviewer": r["reviewer_id"], "verdict": r["verdict"],
                     "rationale": r["rationale"]} for r in revs],
        "decisions": [{"id": r["id"], "question": r["question"],
                       "decision": r["decision"], "at": r["at"]}
                      for r in con.execute(
            "SELECT * FROM approvals WHERE project_id=? ORDER BY id", (project_id,))],
        "failures": [{"id": t["id"], "objective": t["objective"]} for t in tasks
                     if t["status"] == "FAILED"],
        "costs": {"usd_spent": p["usd_spent"],
                  "model_runs": con.execute(
                      "SELECT COUNT(*) c, COALESCE(SUM(usd),0) u FROM runs "
                      "WHERE task_id IN (%s)" % q, tids).fetchone()["c"]},
        "activity": [{"at": e["at"], "kind": e["kind"], "actor": e["actor"],
                      "subject": e["subject"]} for e in timeline],
        "blockers": [{"id": t["id"], "objective": t["objective"],
                      "status": t["status"]} for t in blocked],
        "next_required_action": _next_action(tasks, waiting, blocked),
    }


def _next_action(tasks, waiting, blocked):
    if blocked:
        return "unblock task %d (%s)" % (blocked[0]["id"], blocked[0]["status"])
    for t in waiting:
        if t["status"] == "REVIEW":
            return "reviewer must judge task %d" % t["id"]
        return "owner or orchestrator must approve task %d" % t["id"]
    live = [t for t in tasks if t["status"] not in ("ACCEPTED", "ARCHIVED", "REJECTED")]
    if live:
        return "task %d is %s" % (live[0]["id"], live[0]["status"])
    return "nothing outstanding"


# ── OWNER INTELLIGENCE ──────────────────────────────────────────────
def while_you_were_away(con, mark_seen=False):
    """Meaningful change since the owner last looked, counted from real rows.

    Every number here is a COUNT over persisted state. There is no field in this
    function that could be set to something other than what happened, which is
    the only way a summary like this is worth reading."""
    row = con.execute("SELECT value FROM owner_state WHERE key='world_last_seen'"
                      ).fetchone()
    since = row["value"] if row else "0000"
    counts = {
        "tasks_discovered": _count(con, "tasks", "created_at", since,
                                   "status='DISCOVERED'"),
        "tasks_completed": _count_transitions(con, "COMPLETED", since),
        "tasks_accepted": _count_transitions(con, "ACCEPTED", since),
        "tasks_rejected": _count_transitions(con, "REJECTED", since),
        "tasks_failed": _count_transitions(con, "FAILED", since),
        "artifacts_created": _count(con, "artifacts", "created_at", since),
        "reviews_written": _count(con, "reviews", "created_at", since),
        "reviews_rejected": _count(con, "reviews", "created_at", since,
                                   "verdict IN ('REJECT','REQUEST_CHANGES')"),
        "messages_sent": _count(con, "agent_messages", "at", since),
        "evidence_collected": _count(con, "evidence", "collected_at", since),
        "facts_established": _count(con, "claims", "created_at", since,
                                    "status='FACT'"),
        "memories_written": _count(con, "memories", "created_at", since),
    }
    pending = con.execute(
        "SELECT COUNT(*) c FROM tasks WHERE status IN ('PROPOSED','REVIEW')"
    ).fetchone()["c"]
    blockers = [dict(r) for r in con.execute(
        "SELECT id, objective, status FROM tasks WHERE status IN ('BLOCKED','FAILED')")]
    out = {
        "since": since if since != "0000" else None,
        "counts": {k: v for k, v in counts.items() if v},
        "decisions_waiting": pending,
        "blockers": blockers,
        "quiet": not any(counts.values()) and not pending and not blockers,
    }
    if mark_seen:
        con.execute("INSERT INTO owner_state(key,value) VALUES('world_last_seen',?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (now(),))
    return out


def _count(con, table, col, since, extra=None):
    q = "SELECT COUNT(*) c FROM %s WHERE %s > ?" % (table, col)
    if extra:
        q += " AND " + extra
    return con.execute(q, (since,)).fetchone()["c"]


def _count_transitions(con, to_state, since):
    return con.execute("SELECT COUNT(*) c FROM task_transitions WHERE to_state=? "
                       "AND at > ?", (to_state, since)).fetchone()["c"]


def agent_view(con, agent_id):
    """One agent, as the owner would see it: identity, authority, history."""
    p = con.execute("SELECT * FROM principals WHERE id=?", (agent_id,)).fetchone()
    if p is None:
        raise WorldError("no agent %r" % agent_id)
    return {
        "agent_id": p["id"], "name": p["name"], "role": p["role"],
        "division": p["division"], "department": p["department"],
        "tier": p["tier"], "status": p["status"],
        "lifecycle_state": p["lifecycle_state"],
        "autonomy_level": p["autonomy_level"],
        "contract": {"mission": p["mission"],
                     "success_metrics": json.loads(p["success_metrics"] or "[]"),
                     "escalation_rules": json.loads(p["escalation_rules"] or "[]")},
        "capabilities": sorted(ROLE_CAPABILITY.get(agent_id, [])),
        "allowed_tools": json.loads(p["tools"] or "[]"),
        "permission_scope": [g.get("cap") if isinstance(g, dict) else g
                             for g in json.loads(p["permissions"] or "[]")],
        "memory_scope": json.loads(p["memory_scope"] or "[]"),
        "created_at": p["created_at"], "updated_at": p["updated_at"],
        "memories": con.execute("SELECT COUNT(*) c FROM memories WHERE created_by=?",
                                (agent_id,)).fetchone()["c"],
        "tool_calls": con.execute("SELECT COUNT(*) c FROM tool_calls WHERE principal_id=?",
                                  (agent_id,)).fetchone()["c"],
        "tool_denials": con.execute("SELECT COUNT(*) c FROM tool_calls WHERE "
                                    "principal_id=? AND decision<>'ALLOW'",
                                    (agent_id,)).fetchone()["c"],
        "messages_sent": con.execute("SELECT COUNT(*) c FROM agent_messages WHERE sender=?",
                                     (agent_id,)).fetchone()["c"],
        "transitions_caused": con.execute("SELECT COUNT(*) c FROM task_transitions "
                                          "WHERE actor=?", (agent_id,)).fetchone()["c"],
    }


def world_state(con):
    """What is actually happening, for anything that wants to draw it.

    A UI may render exactly this and nothing else. `running` is the list of
    tasks with a live lease — so an agent drawn as working is an agent holding
    one, and when nothing is running the world is allowed to be quiet."""
    running = [dict(r) for r in con.execute(
        "SELECT t.id, t.objective, l.principal_id AS agent, l.expires_at "
        "FROM tasks t JOIN leases l ON l.task_id=t.id "
        "WHERE t.status='RUNNING' AND l.status='ACTIVE'")]
    return {
        "agents": [agent_view(con, a["id"]) for a in CREW
                   if con.execute("SELECT 1 FROM principals WHERE id=?",
                                  (a["id"],)).fetchone()],
        "running": running,
        "idle": [a["id"] for a in CREW
                 if a["id"] not in {r["agent"] for r in running}],
        "tasks_by_state": {r["status"]: r["n"] for r in con.execute(
            "SELECT status, COUNT(*) n FROM tasks GROUP BY status")},
        "projects": [dict(r) for r in con.execute(
            "SELECT id, name, stage FROM projects ORDER BY id")],
        "quiet": not running,
    }
