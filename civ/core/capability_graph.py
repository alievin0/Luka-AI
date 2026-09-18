"""THE CAPABILITY GRAPH — what an agent can actually do, and what makes it possible.

The world view says where an agent is. This says what it is *for*: the chain
from identity down to the executable edge and back up to the artifact.

    AGENT → ROLE → CAPABILITY → TOOL → PERMISSION → EXECUTION
          → OBSERVATION → ARTIFACT → NEXT TASK

Every edge here is a row. A capability is usable only when the tools it needs
are registered AND the agent holds the permission AND the tool is enabled — and
when any of those is missing the graph says so rather than drawing the line
anyway. A decorative graph that shows what an agent could do in principle is
worse than no graph: it is a promise the runtime will not keep.

**The registry is not the authority.** `runtime.Gateway` decides every call, and
it decided before this module existed. What a tool row adds is a *description*
of the door — its schema, its risk, whether it is enabled — so the world can
show the shape of its own nervous system and notice a gap.
"""
import json

from . import store
from .store import now

OWNER = "OWNER_PLANE"


def register_tool(con, tid, name, capability, by, description="", inputs=None,
                  outputs=None, needs_perm=None, risk="LOW", enabled=1, version=1,
                  scope="*"):
    """Describe a door. Registering it does NOT open it — the gateway does that,
    and only for a principal holding the grant."""
    if risk not in ("LOW", "MEDIUM", "HIGH"):
        raise ValueError("risk must be LOW, MEDIUM or HIGH")
    row = con.execute("SELECT 1 FROM tools WHERE id=?", (tid,)).fetchone()
    if row:
        con.execute("UPDATE tools SET name=?, capability=?, description=?, inputs=?, "
                    "outputs=?, needs_perm=?, risk=?, enabled=?, version=?, scope=? "
                    "WHERE id=?",
                    (name, capability, description, json.dumps(inputs or {}),
                     json.dumps(outputs or {}), needs_perm or capability, risk,
                     int(enabled), version, scope, tid))
        return tid
    con.execute(
        "INSERT INTO tools(id,name,capability,description,inputs,outputs,needs_perm,"
        "risk,enabled,version,scope,registered_by,registered_at) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (tid, name, capability, description, json.dumps(inputs or {}),
         json.dumps(outputs or {}), needs_perm or capability, risk, int(enabled),
         version, scope, by, now()))
    store.event(con, "TOOL_REGISTERED", actor=by, subject="tool:%s" % tid,
                payload={"capability": capability, "risk": risk})
    return tid


def seed_tools(con, by=OWNER):
    """The three doors the gateway actually has, written down.

    Deliberately only three. A registry listing tools the gateway cannot serve
    would be a catalogue of promises, and the first agent to believe it would
    produce a capability gap that is really a documentation bug."""
    for t in (
        ("READ_REPO", "Read repository", "read", "Read a file the scope allows.",
         {"path": "string"}, {"text": "string"}, "LOW"),
        ("WRITE_ARTIFACT", "Write artifact", "write",
         "Write a file inside the artifact directory, and nowhere else.",
         {"path": "string", "body": "string"}, {"path": "string"}, "MEDIUM"),
        ("EXECUTE_SANDBOX", "Execute in sandbox", "execute",
         "Run a process. Same user, no OS-level isolation — see the gates table.",
         {"argv": "string[]"}, {"returncode": "int", "stdout": "string"}, "HIGH"),
    ):
        register_tool(con, t[0], t[1], t[2], by, description=t[3], inputs=t[4],
                      outputs=t[5], risk=t[6])
    return [r["id"] for r in con.execute("SELECT id FROM tools ORDER BY id")]


# Capability → the tools it requires. Queryable World state, not a mapping
# buried in a renderer: the UI reads these rows, and so does gap detection.
CAPABILITY_TOOLS = {
    "research": ["READ_REPO", "WRITE_ARTIFACT"],
    "evidence": ["READ_REPO"],
    "read": ["READ_REPO"],
    "build": ["READ_REPO", "WRITE_ARTIFACT"],
    "write": ["WRITE_ARTIFACT"],
    "review": ["READ_REPO"],
    "execute": ["READ_REPO", "EXECUTE_SANDBOX"],
    "operate": ["READ_REPO", "EXECUTE_SANDBOX"],
    # The Orchestrator coordinates and holds no tool at all. An empty list here
    # is a real answer — "this needs no door" — and not a missing mapping.
    "decompose": [], "assign": [], "coordinate": [],
}


def seed_capabilities(con, by=OWNER):
    """Write the capability→tool edges, and give each agent the ones its role
    actually carries. Both halves are rows, so the graph is queried, not
    reconstructed by whoever happens to be drawing it."""
    from . import agent_world as W
    for name, need in CAPABILITY_TOOLS.items():
        cid = "CAP-" + name
        if not con.execute("SELECT 1 FROM capabilities WHERE id=?", (cid,)).fetchone():
            con.execute(
                "INSERT INTO capabilities(id,name,description,needs_skills,needs_tools,"
                "needs_perms,created_at) VALUES(?,?,?,?,?,?,?)",
                (cid, name, "%s work, through %s" % (
                    name, ", ".join(need) if need else "no tool"),
                 "[]", json.dumps(need), json.dumps(need), now()))
    for a in W.CREW:
        if not con.execute("SELECT 1 FROM principals WHERE id=?", (a["id"],)).fetchone():
            continue
        for name in sorted(W.ROLE_CAPABILITY.get(a["id"], set())):
            con.execute("INSERT OR IGNORE INTO agent_capabilities(principal_id,"
                        "capability_id) VALUES(?,?)", (a["id"], "CAP-" + name))
    return [r["id"] for r in con.execute("SELECT id FROM capabilities ORDER BY id")]


def tools(con, enabled_only=False):
    q = "SELECT * FROM tools" + (" WHERE enabled=1" if enabled_only else "")
    return {r["id"]: dict(r, inputs=json.loads(r["inputs"] or "{}"),
                          outputs=json.loads(r["outputs"] or "{}"))
            for r in con.execute(q + " ORDER BY id")}


def set_enabled(con, tid, enabled, by=OWNER, why=""):
    """Turn a door off. The gateway still decides; this makes the world SAY the
    door is shut, so an agent's capability shows as unusable instead of failing
    at the moment of use."""
    con.execute("UPDATE tools SET enabled=? WHERE id=?", (1 if enabled else 0, tid))
    store.event(con, "TOOL_ENABLED" if enabled else "TOOL_DISABLED", actor=by,
                subject="tool:%s" % tid, payload={"why": why})
    return bool(enabled)


def _granted(con, agent_id):
    """What the gateway would actually accept from this principal, read from the
    same column the gateway reads."""
    p = con.execute("SELECT permissions FROM principals WHERE id=?",
                    (agent_id,)).fetchone()
    if p is None:
        return {}
    out = {}
    for g in json.loads(p["permissions"] or "[]"):
        if isinstance(g, dict) and g.get("cap"):
            out[g["cap"]] = g
    return out


def graph(con, agent_id):
    """The whole nervous system of one agent, and which parts of it are live."""
    a = con.execute("SELECT * FROM principals WHERE id=?", (agent_id,)).fetchone()
    if a is None:
        return None
    reg = tools(con)
    grants = _granted(con, agent_id)
    live_lease = con.execute(
        "SELECT id FROM leases WHERE principal_id=? AND status='ACTIVE' "
        "ORDER BY id DESC LIMIT 1", (agent_id,)).fetchone()
    active_caps = set()
    if live_lease:
        active_caps = {r["cap"] for r in con.execute(
            "SELECT DISTINCT cap FROM tool_calls WHERE lease_id=? AND decision='ALLOW'",
            (live_lease["id"],))}

    # Capability rows the organisation declared for this agent, plus the ones its
    # role implies. Both are state; neither is invented here.
    declared = [dict(r) for r in con.execute(
        "SELECT c.* FROM capabilities c JOIN agent_capabilities ac "
        "ON ac.capability_id=c.id WHERE ac.principal_id=? ORDER BY c.id", (agent_id,))]
    from . import agent_world as W
    implied = sorted(W.ROLE_CAPABILITY.get(agent_id, set()))

    # Declared capability rows are the authority. The role set is a fallback for
    # an agent the organisation never wrote capabilities for — and saying which
    # of the two answered matters, because one is data and one is a default.
    source = "declared" if declared else "role"
    wanted = ([(d["name"], json.loads(d["needs_tools"] or "[]")) for d in declared]
              if declared else [(n, CAPABILITY_TOOLS.get(n, [])) for n in implied])
    caps = []
    for name, need in wanted:
        rows = []
        for t in need:
            reg_t = reg.get(t, {})
            rows.append({
                "id": t, "name": reg_t.get("name", t), "risk": reg_t.get("risk", "?"),
                "registered": bool(reg_t),
                "granted": t in grants, "enabled": bool(reg_t.get("enabled", 0)),
                "active": t in active_caps,
                "calls": con.execute(
                    "SELECT COUNT(*) c FROM tool_calls WHERE principal_id=? AND cap=? "
                    "AND decision='ALLOW'", (agent_id, t)).fetchone()["c"]})
        caps.append({
            "name": name, "tools": rows, "needs_tools": need, "source": source,
            # A capability needing no tool is usable; one whose tool is missing,
            # disabled or ungranted is NOT, and the graph says which.
            "usable": all(r["registered"] and r["granted"] and r["enabled"]
                          for r in rows),
            "blocked_by": [r["id"] for r in rows
                           if not (r["registered"] and r["granted"] and r["enabled"])],
        })

    execs = [{"id": r["id"], "cap": r["cap"], "decision": r["decision"],
              "at": r["at"], "reason": r["reason"],
              "artifact": _artifact_of(con, r["id"])}
             for r in con.execute(
                 "SELECT * FROM tool_calls WHERE principal_id=? ORDER BY id DESC LIMIT 8",
                 (agent_id,))]
    return {
        "agent": agent_id, "name": a["name"], "role": a["role"],
        "capabilities": caps,
        "permissions": sorted(grants),
        "tools": [dict(t) for t in reg.values()],
        "executing": bool(active_caps),
        "gaps": [c["name"] for c in caps if not c["usable"]],
        "executions": execs,
        "skills": [dict(r) for r in con.execute(
            "SELECT s.id, s.name, a.proficiency FROM skills s JOIN agent_skills a "
            "ON a.skill_id=s.id WHERE a.principal_id=?", (agent_id,))],
    }


def _artifact_of(con, tool_call_id):
    """The artifact this call contributed to, via the lease it ran under.

    There is no direct tool_call → artifact column, and inventing one here would
    be a guess: a turn can make several calls and one artifact. The lease is the
    real link — the call and the artifact belong to the same leased task."""
    r = con.execute(
        "SELECT a.id FROM artifacts a JOIN leases l ON l.task_id=a.task_id "
        "JOIN tool_calls tc ON tc.lease_id=l.id WHERE tc.id=? "
        "ORDER BY a.id DESC LIMIT 1", (tool_call_id,)).fetchone()
    return r["id"] if r else None


def handoffs(con, limit=40):
    """Cross-agent handoffs, from the message rows that actually carried them."""
    return [{"from": r["sender"], "to": r["recipient"], "kind": r["kind"],
             "task_id": r["task_id"], "artifact_id": r["artifact_id"],
             "at": r["at"], "why": (json.loads(r["payload"] or "{}") or {}).get("why", "")}
            for r in con.execute(
                "SELECT * FROM agent_messages WHERE kind IN "
                "('HANDOFF','REVIEW_REQUEST','REVIEW_RESULT','ASSIGN') "
                "ORDER BY id DESC LIMIT ?", (limit,))]


def gaps(con, required_caps):
    """Which required capabilities nobody can currently serve, and why not.

    Reads the SAME capability→tool edges the graph draws. An earlier version
    matched a tool's own `capability` field instead, so disabling READ_REPO made
    three of the Researcher's capabilities unusable in the graph while this
    function reported no gap at all — two answers to one question."""
    from . import agent_world as W
    reg = tools(con)
    edges = {}
    for r in con.execute("SELECT name, needs_tools FROM capabilities"):
        edges[r["name"]] = json.loads(r["needs_tools"] or "[]")
    out = []
    for cap in required_caps:
        # Who can actually do this, from the `agent_capabilities` table — the
        # one the Agent Factory writes into. Reading the founding ROLE map alone
        # would report a gap the organisation had already filled, and then
        # commission a second agent to fill it again.
        who = sorted({r["principal_id"] for r in con.execute(
            "SELECT ac.principal_id FROM agent_capabilities ac "
            "JOIN principals p ON p.id=ac.principal_id "
            "WHERE p.lifecycle_state='ACTIVE' AND (ac.capability_id=? "
            "OR ac.capability_id=?)", (cap, "CAP-" + cap))}
            | {a["id"] for a in W.inhabitants(con)
               if cap in W.ROLE_CAPABILITY.get(a["id"], set())})
        need = edges.get(cap, CAPABILITY_TOOLS.get(cap, []))
        missing = [t for t in need if t not in reg]
        off = [t for t in need if t in reg and not reg[t]["enabled"]]
        if not who:
            out.append({"capability": cap, "why": "no agent holds it",
                        "blocked_tools": [], "kind": "NO_AGENT"})
        elif missing:
            out.append({"capability": cap,
                        "why": "needs a tool nobody has registered: %s"
                               % ", ".join(missing),
                        "blocked_tools": missing, "kind": "NO_TOOL"})
        elif off:
            out.append({"capability": cap,
                        "why": "the tool it needs is disabled: %s" % ", ".join(off),
                        "blocked_tools": off, "kind": "TOOL_DISABLED"})
    return out


def execution_chain(con, task_id):
    """One task, end to end: who ran, through which door, producing what."""
    steps = []
    for r in con.execute(
            "SELECT tc.* FROM tool_calls tc JOIN leases l ON l.id=tc.lease_id "
            "WHERE l.task_id=? ORDER BY tc.id", (task_id,)):
        steps.append({"agent": r["principal_id"], "tool": r["cap"],
                      "decision": r["decision"], "at": r["at"],
                      "artifact": _artifact_of(con, r["id"]), "why": r["reason"]})
    return {
        "task_id": task_id, "steps": steps,
        "artifacts": [dict(r) for r in con.execute(
            "SELECT id, name, principal_id, sha FROM artifacts WHERE task_id=?",
            (task_id,))],
        "reviews": [dict(r) for r in con.execute(
            "SELECT r.id, r.verdict, r.reviewer_id FROM reviews r JOIN artifacts a "
            "ON a.id=r.artifact_id WHERE a.task_id=?", (task_id,))],
    }
