"""WHAT AN AGENT KNOWS WHEN IT WAKES.

An agent was being woken, its memory retrieved, and then handed a prompt that
was the objective and a file path. The retrieved memory went into a local
variable and was never passed anywhere — the handler even reported
`memory_recalled: N` back to the supervisor, so the record said memory had been
recalled when nothing had recalled it to anybody. An agent that cannot see what
it learned last time is not remembering; it is being told a number about
remembering.

This module assembles the briefing. Everything in it is a row:

    the task           what was asked, and the conditions declared up front
    prior attempts     what this task already tried, and why it was rejected
    memory             `wake_memory` — its own, the project's, the organisation's
    inbox              messages actually addressed to this agent
    its own work       artifacts it produced before, by name and sha
    where it is        the room it is standing in and the seat it holds
    what it may reach  the tools its permissions actually grant

It contains NO instructions about what to do. That is the point of the mission
this was written for: the sequence is supposed to come from the task, the world
and the agent's own decisions, not from a role script. A Researcher and a
Builder woken on the same task get the same shape of briefing and differ only
by what they hold and what they remember.

Nothing here decides, calls a model, or moves anybody.
"""
import json

from . import agent_world as W
from . import always_on as A

# How much of each kind of context is worth carrying. A briefing longer than
# the work is its own failure mode: it costs tokens, and it buries the task.
MEMORIES = 8
INBOX = 6
ATTEMPTS = 3
ARTIFACTS = 4
BODY_CLIP = 600


# What each capability takes. This is an interface, not an instruction: it says
# how to CALL a tool, never when to. An agent that has to guess argument names
# spends its turns on denials that teach it nothing about the task.
TOOL_ARGS = {
    "READ_REPO": '  args: {"path": "<file to read>"}',
    "WRITE_ARTIFACT": '  args: {"path": "<name>", "body": "<full text>"}',
    "EXECUTE_SANDBOX": '  args: {"argv": ["python3", "<script under the artifact dir>"]}',
    "SEND_MESSAGE": ('  args: {"to": "<AGT-…>", "text": "<what you want to say>", '
                     '"kind": "REPORT|REQUEST|ANSWER|HANDOFF|REVIEW_REQUEST|'
                     'REVIEW_RESULT|ESCALATE|BLOCKED|NOTIFY|ASSIGN"}'),
}


def _clip(s, n=BODY_CLIP):
    s = str(s or "")
    return s if len(s) <= n else s[:n] + " …[clipped]"


def task_brief(con, task_id):
    """The task as it was declared, including the conditions set when it was
    created — before anyone knew whether they would be met."""
    t = con.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if t is None:
        return None
    conds = [dict(r) for r in con.execute(
        "SELECT * FROM task_conditions WHERE task_id=? ORDER BY id", (task_id,))]
    return {
        "id": t["id"], "objective": t["objective"], "status": t["status"],
        "kind": t["kind"], "required_caps": json.loads(t["required_caps"] or "[]"),
        "evidence_required": t["evidence_required"], "attempts": t["attempts"],
        "project_id": t["project_id"], "parent_id": t["parent_id"],
        "conditions": [{"description": c["description"], "kind": c["kind"],
                        "satisfied": bool(c["satisfied"])} for c in conds],
    }


def _lineage(con, task_id, depth=4):
    """This task and the ones it corrects, newest first.

    A correction is a NEW task — deliberately, so the failed attempt stays
    FAILED in the record rather than being edited away. That means its own
    artifact list is empty, and the rejection it exists to answer belongs to its
    parent. Walking the link is what lets the agent read it."""
    ids, seen = [], set()
    cur = task_id
    while cur is not None and cur not in seen and len(ids) < depth:
        ids.append(cur)
        seen.add(cur)
        row = con.execute("SELECT parent_id FROM tasks WHERE id=?", (cur,)).fetchone()
        cur = row["parent_id"] if row else None
    return ids


def prior_attempts(con, task_id, limit=ATTEMPTS):
    """What has already been tried on this task and what came back.

    A correction task that cannot see the rejection it exists to answer is
    being asked to guess."""
    out = []
    ids = _lineage(con, task_id)
    marks = ",".join("?" * len(ids))
    for r in con.execute(
            "SELECT a.id, a.name, a.sha, a.principal_id, a.created_at, a.task_id "
            "FROM artifacts a WHERE a.task_id IN (%s) ORDER BY a.id DESC LIMIT ?"
            % marks, ids + [limit]):
        rv = [dict(x) for x in con.execute(
            "SELECT verdict, rationale, reviewer_id FROM reviews "
            "WHERE artifact_id=? ORDER BY id", (r["id"],))]
        # A verification is an `evidence` row of kind 'verification' whose
        # provenance names the artifact AND the sha it ran against, so an
        # artifact edited afterwards cannot inherit an older pass.
        ver = con.execute(
            "SELECT detail FROM evidence WHERE kind='verification' "
            "AND external_provenance LIKE ? ORDER BY id DESC LIMIT 1",
            ("artifact:%d@%%" % r["id"],)).fetchone()
        passed, detail = None, None
        if ver is not None:
            try:
                d = json.loads(ver["detail"] or "{}")
                passed = bool(d.get("passed"))
                detail = "; ".join(
                    "%s=%s" % (c.get("requirement"), "ok" if c.get("passed") else "FAILED")
                    for c in (d.get("checks") or []))
            except ValueError:
                detail = _clip(ver["detail"], 300)
        out.append({
            "artifact_id": r["id"], "name": r["name"], "sha": (r["sha"] or "")[:12],
            "by": r["principal_id"],
            "verified": passed,
            "verification_detail": _clip(detail, 300),
            "reviews": [{"verdict": v["verdict"], "by": v["reviewer_id"],
                         "why": _clip(v["rationale"], 300)} for v in rv],
        })
    return out


def lessons_from_failure(con, task_id, limit=ATTEMPTS):
    """What this line of work has already been found to get wrong.

    A recorded failure carries a `lesson`, and that lesson only reaches
    `memories` when the owner plane PROMOTES it — which is a law, and which
    nothing does unattended. So an agent working a correction would never see
    the lesson its own predecessor produced. This reads the failure record
    directly, scoped to this task's lineage, which needs no promotion and
    invents nothing: it is the row that was written when the attempt failed."""
    ids = _lineage(con, task_id)
    marks = ",".join("?" * len(ids))
    return [{"what": r["what_happened"], "why": r["why"], "lesson": r["lesson"],
             "task_id": r["subject_id"]}
            for r in con.execute(
                "SELECT * FROM failures WHERE subject_kind='task' AND "
                "subject_id IN (%s) ORDER BY id DESC LIMIT ?" % marks,
                [str(i) for i in ids] + [limit])]


def unread(con, agent_id, task_id=None, limit=INBOX):
    """Messages addressed to this agent. Real rows in `agent_messages`, which
    is also the only thing the 3D world is allowed to draw a conversation from."""
    rows = W.inbox(con, agent_id, limit=limit)
    out = []
    for m in rows:
        try:
            payload = json.loads(m["payload"] or "{}")
        except ValueError:
            payload = {}
        out.append({"id": m["id"], "from": m["sender"], "kind": m["kind"],
                    "task_id": m["task_id"], "at": m["at"],
                    "says": _clip(payload.get("text") or payload.get("summary")
                                  or json.dumps(payload, ensure_ascii=False), 400)})
    if task_id is not None:
        out.sort(key=lambda m: (m["task_id"] != task_id, -m["id"]))
    return out


def own_work(con, agent_id, project_id=None, limit=ARTIFACTS):
    q = ("SELECT id, name, sha, task_id, created_at FROM artifacts "
         "WHERE principal_id=?")
    args = [agent_id]
    if project_id is not None:
        q += " AND project_id=?"
        args.append(project_id)
    return [{"artifact_id": r["id"], "name": r["name"], "sha": (r["sha"] or "")[:12],
             "task_id": r["task_id"]}
            for r in con.execute(q + " ORDER BY id DESC LIMIT ?", args + [limit])]


def granted_tools(con, agent_id):
    """What this identity may actually call. Read from the contract, not from
    anything the agent or a model said about itself."""
    p = con.execute("SELECT permissions FROM principals WHERE id=?",
                    (agent_id,)).fetchone()
    if p is None:
        return []
    return sorted({g.get("cap") if isinstance(g, dict) else g
                   for g in json.loads(p["permissions"] or "[]") if g})


def gather(con, agent_id, task_id, project_id=None, extra=None):
    """The whole waking context, as data. Render it with `render`."""
    t = task_brief(con, task_id)
    pid = project_id if project_id is not None else (t or {}).get("project_id")
    loc = None
    try:
        from . import world_space as SPACE
        loc = SPACE.locate(con, agent_id)
    except Exception:                                  # pragma: no cover
        loc = None
    return {
        "agent_id": agent_id,
        "capabilities": sorted(W.capabilities_of(con, agent_id)),
        "tools": granted_tools(con, agent_id),
        "task": t,
        "attempts": prior_attempts(con, task_id),
        "memory": A.wake_memory(con, agent_id, pid, limit=MEMORIES),
        "failures": lessons_from_failure(con, task_id),
        "inbox": unread(con, agent_id, task_id),
        "own_work": own_work(con, agent_id, pid),
        "where": ({"workspace": loc["workspace"], "x": loc["x"], "y": loc["y"]}
                  if loc else None),
        "extra": extra or {},
    }


def render(ctx):
    """The briefing an agent receives, as text.

    Written as a situation report, not as a plan. There is no "first do X, then
    do Y" anywhere in it — what to do next is the agent's decision, and a
    briefing that contained the answer would make the decision meaningless."""
    t = ctx.get("task") or {}
    L = []
    L.append("TASK #%s — %s" % (t.get("id"), t.get("objective")))
    if t.get("status"):
        L.append("Status %s. Attempt %s." % (t["status"], (t.get("attempts") or 0) + 1))
    if t.get("required_caps"):
        L.append("This task was declared to need: %s" % ", ".join(t["required_caps"]))
    conds = t.get("conditions") or []
    if conds:
        L.append("")
        L.append("CONDITIONS declared when this task was created. It cannot be "
                 "completed while any of them is unmet:")
        for c in conds:
            L.append("  [%s] %s (%s)" % ("met" if c["satisfied"] else " ",
                                         c["description"], c["kind"]))
    if t.get("evidence_required"):
        L.append("  Evidence required: %d item(s)." % t["evidence_required"])

    if ctx.get("attempts"):
        L.append("")
        L.append("WHAT THIS TASK ALREADY TRIED:")
        for a in ctx["attempts"]:
            L.append("  artifact #%s %r (sha %s) by %s" % (
                a["artifact_id"], a["name"], a["sha"], a["by"]))
            if a["verified"] is not None:
                L.append("    verification: %s — %s"
                         % ("PASSED" if a["verified"] else "FAILED",
                            a["verification_detail"]))
            for r in a["reviews"]:
                L.append("    review %s by %s: %s" % (r["verdict"], r["by"], r["why"]))

    if ctx.get("inbox"):
        L.append("")
        L.append("MESSAGES ADDRESSED TO YOU:")
        for m in ctx["inbox"]:
            L.append("  #%s from %s (%s%s): %s" % (
                m["id"], m["from"], m["kind"],
                ", task #%s" % m["task_id"] if m["task_id"] else "", m["says"]))

    if ctx.get("failures"):
        L.append("")
        L.append("WHAT THIS LINE OF WORK HAS ALREADY BEEN FOUND TO GET WRONG:")
        for f in ctx["failures"]:
            L.append("  task #%s: %s — %s" % (f["task_id"], f["why"], f["lesson"]))

    if ctx.get("memory"):
        L.append("")
        L.append("WHAT YOU REMEMBER (your own, then this project's, then the "
                 "organisation's):")
        for m in ctx["memory"]:
            L.append("  [%s/%s] %s" % (m.get("band", "?"), m.get("kind", "?"),
                                       _clip(m.get("text"), 300)))

    if ctx.get("own_work"):
        L.append("")
        L.append("ARTIFACTS YOU HAVE PRODUCED BEFORE:")
        for a in ctx["own_work"]:
            L.append("  #%s %r (sha %s, task #%s)"
                     % (a["artifact_id"], a["name"], a["sha"], a["task_id"]))

    if ctx.get("where"):
        L.append("")
        L.append("You are in %s." % ctx["where"]["workspace"])

    L.append("")
    tools = ctx.get("tools") or []
    L.append("TOOLS YOU HOLD:")
    if not tools:
        L.append("  none")
    for cap in tools:
        L.append("  %s%s" % (cap, TOOL_ARGS.get(cap, "")))
    L.append("Asking for a tool you do not hold is not an error — the gateway "
             "will refuse it and tell you why, and you may then do something "
             "else. Nothing you write can give you one.")
    for k, v in (ctx.get("extra") or {}).items():
        L.append("")
        L.append("%s: %s" % (k.upper(), v))
    L.append("")
    L.append("Decide what to do next.")
    return "\n".join(L)


def briefing(con, agent_id, task_id, project_id=None, extra=None):
    ctx = gather(con, agent_id, task_id, project_id=project_id, extra=extra)
    return render(ctx), ctx
