"""COMMISSIONING — the step between "an agent exists" and "an agent is here".

`factory.py` already did the hard part: it decides whether a capability gap
actually warrants a new agent, refuses to create a duplicate, runs a security
review and an evaluation, and writes a real contract with lineage. What it did
NOT do is put the resulting agent anywhere. A factory-made agent had an id, a
role and a set of permissions, and no body, no address and no seat — so it could
not appear in the world, could not be routed work that depends on being
somewhere, and was invisible to every client.

This module is that missing wiring, and nothing else. It does not re-decide
anything `factory.py` decided, and it does not lower any bar:

    commission()  →  the existing pipeline, from an API-shaped request
    deploy()      →  Owner approval, then EMBODY and PLACE the agent

The split is deliberate. Commissioning produces a PROPOSED agent — the factory
is allowed to propose, never to staff the organisation on its own authority.
Deployment is an Owner act, and only deployment gives an agent a body, a
location and a seat. Absence of an Owner decision is not approval.
"""
import json
import re

from . import contract as K
from . import embodiment as EMB
from . import factory as F
from . import store
from . import world_space as SPACE
from .store import now

OWNER = "OWNER"
# Where a newly deployed agent starts: the floor where work is handed out. It
# walks from here to wherever its first task belongs, which is a real journey
# with a real cause rather than an agent materialising at its desk.
ARRIVALS = "ws_dispatch"


class FactoryError(ValueError):
    """A commission the world refuses. Never a crash — a decision."""


def next_agent_id(con):
    """AGT-000006 after AGT-000005. Sequential, gap-tolerant, never reused.

    Reuse would be the worst possible outcome: a retired agent's history would
    silently become a new agent's history."""
    # The founding crew carry names rather than numbers (AGT-RESEARCHER and so
    # on). They are still agents, so the counter starts above them: the first
    # commissioned agent in a founded world is AGT-000006, not AGT-000001.
    top = con.execute("SELECT COUNT(*) c FROM principals WHERE id LIKE 'AGT-%' "
                      "AND id NOT GLOB 'AGT-[0-9][0-9][0-9][0-9][0-9][0-9]'"
                      ).fetchone()["c"]
    for r in con.execute("SELECT id FROM principals WHERE id LIKE 'AGT-%'"):
        m = re.fullmatch(r"AGT-(\d{6})", r["id"])
        if m:
            top = max(top, int(m.group(1)))
    for r in con.execute("SELECT produced_id FROM factory_jobs "
                         "WHERE produced_id LIKE 'AGT-%'"):
        m = re.fullmatch(r"AGT-(\d{6})", r["produced_id"] or "")
        if m:
            top = max(top, int(m.group(1)))
    return "AGT-%06d" % (top + 1)


def spec_for(con, role, name=None, mission="", capabilities=(), skills=(),
             tools=(), permissions=(), agent_id=None):
    """A contract the runtime could actually enforce, from a short request.

    Every field here is one the gateway or the supervisor reads. Nothing is
    decorative, and nothing is invented that the requester did not ask for
    except the defaults a contract cannot be valid without."""
    aid = agent_id or next_agent_id(con)
    return {
        "agent_id": aid,
        "name": name or role,
        "role": role,
        "division": "Operations",
        "department": "Commissioned",
        "tier": "actor",
        "mission": mission or ("Deliver %s work under the same review and "
                               "evidence rules as every other agent." % role.lower()),
        "autonomy_level": 0,
        "tools": sorted(set(tools)),
        "permissions": sorted(set(permissions)),
        "capabilities": sorted(set(capabilities)),
        "skills": sorted(set(skills)),
        "memory_scope": ["self", "project", "org"],
        # These three are what the duplicate detector compares, and it is right
        # to: an agent whose metrics and escalations are boilerplate is
        # indistinguishable from one that already exists, whatever its job
        # title says. So they are derived from the capabilities the agent is
        # actually being commissioned for. If that still collides with an
        # existing agent, the collision is real and the factory should refuse.
        "success_metrics": (
            [{"metric": "tasks_accepted_first_pass", "target": 0.8}]
            + [{"metric": "%s_evidence_attached" % c, "target": 1.0}
               for c in sorted(set(capabilities))]),
        "escalation_rules": (
            [{"when": "no_capable_agent", "action": "OWNER_APPROVAL"}]
            + [{"when": "%s_out_of_scope" % c, "action": "OWNER_APPROVAL"}
               for c in sorted(set(capabilities))]),
        "model_policy": {"tier": "cheap"},
        "cost_limit_usd": 1.0,
        "task_limit": 50,
        "lifecycle_state": "PROPOSED",
        "version": 1,
    }


def commission(con, requested_by, gap, role, name=None, mission="",
               required_caps=(), required_skills=(), required_tools=(),
               permissions=(), force=False):
    """Ask the factory for an agent. The factory decides whether to make one.

    The return value distinguishes the outcomes honestly: REUSE and SKILL are
    successes, not failures — they mean the organisation already had an answer
    and did not need another head."""
    if not gap:
        raise FactoryError("a capability gap is required; "
                           "the factory does not create agents on request alone")
    spec = spec_for(con, role, name=name, mission=mission,
                    capabilities=required_caps, skills=required_skills,
                    tools=required_tools, permissions=permissions)
    aid, jid, report = F.create_agent(
        con, requested_by=requested_by, gap=gap, spec=spec,
        required_caps=tuple(required_caps), required_skills=tuple(required_skills),
        required_tools=tuple(required_tools), force=force)
    # A refusal has to say WHY in the same field a success does, or a caller
    # reading `rationale` sees None and concludes nothing was decided.
    why = report.get("rationale")
    if not why and report.get("decision") == "REJECT":
        why = "; ".join(
            list(report.get("security") or [])
            + list((report.get("evaluation") or {}).get("findings") or [])
        ) or "the factory refused and gave no finding"
    out = {"agent_id": aid, "job": jid, "decision": report.get("decision"),
           "rationale": why, "analysis": report.get("analysis"),
           "security": report.get("security"), "evaluation": report.get("evaluation"),
           "lifecycle": None, "embodied": False, "placed": False}
    if aid:
        out["lifecycle"] = con.execute(
            "SELECT lifecycle_state FROM principals WHERE id=?", (aid,)
        ).fetchone()["lifecycle_state"]
        out["next"] = ("PROPOSED. It has no body and no location until the Owner "
                       "deploys it: POST /api/owner/approve-agent")
    return out


def deploy(con, agent_id, by=OWNER, arrivals=ARRIVALS):
    """The Owner accepts a proposed agent. THIS is what makes it an inhabitant.

    Order matters and is not cosmetic. The lifecycle moves first, because an
    agent that is not ACTIVE has no business holding a seat; then the body,
    because identity precedes appearance nowhere else in this system either;
    then the position, because a body has to be somewhere. Each step is a row,
    and the whole thing is one savepoint — a half-deployed agent standing
    nowhere would be worse than no agent."""
    row = con.execute("SELECT * FROM principals WHERE id=?", (agent_id,)).fetchone()
    if row is None:
        raise FactoryError("no such agent: %s" % agent_id)
    state = row["lifecycle_state"]
    if state == "ACTIVE":
        return _deployed(con, agent_id, note="already active")
    if state == "RETIRED":
        raise FactoryError("%s is retired; retirement keeps its history and does "
                           "not hand the identity back" % agent_id)

    con.execute("SAVEPOINT deploy_agent")
    try:
        # PROPOSED → EVALUATING → APPROVED → ACTIVE. The intermediate states are
        # not ceremony: each one is a place the Owner can stop.
        for step in ("EVALUATING", "APPROVED", "ACTIVE"):
            if con.execute("SELECT lifecycle_state FROM principals WHERE id=?",
                           (agent_id,)).fetchone()["lifecycle_state"] != step:
                K.transition(con, agent_id, step, why="deployed by %s" % by)
        caps = [r["capability_id"] for r in con.execute(
            "SELECT capability_id FROM agent_capabilities WHERE principal_id=?",
            (agent_id,))]
        EMB.embody(con, agent_id, caps)
        if SPACE.locate(con, agent_id) is None:
            SPACE.stand(con, agent_id, arrivals,
                        why="deployed by %s; arrives on the dispatch floor" % by)
        EMB.take_station(con, agent_id, SPACE.locate(con, agent_id)["workspace"])
        store.event(con, "FACTORY_AGENT_DEPLOYED", actor=by, subject=agent_id,
                    payload={"workspace": SPACE.locate(con, agent_id)["workspace"]})
        con.execute("RELEASE deploy_agent")
    except Exception:
        con.execute("ROLLBACK TO deploy_agent")
        con.execute("RELEASE deploy_agent")
        raise
    return _deployed(con, agent_id, note="deployed")


def _deployed(con, agent_id, note=""):
    loc = SPACE.locate(con, agent_id)
    body = EMB.body_of(con, agent_id)
    st = EMB.station_of(con, agent_id)
    return {
        "agent_id": agent_id,
        "lifecycle": con.execute("SELECT lifecycle_state FROM principals WHERE id=?",
                                 (agent_id,)).fetchone()["lifecycle_state"],
        "body_id": body["body_id"] if body else None,
        "embodied": body is not None,
        "placed": loc is not None,
        "workspace": loc["workspace"] if loc else None,
        "x": loc["x"] if loc else None, "y": loc["y"] if loc else None,
        "station": st["id"] if st else None,
        "note": note, "at": now(),
    }


def retire(con, agent_id, by=OWNER, why=""):
    """Retirement keeps everything. The agent stops working; its history, its
    body and its lineage stay exactly where they are, because deleting them
    would make every artifact it produced unattributable."""
    K.transition(con, agent_id, "RETIRED", why=why or "retired by %s" % by)
    EMB.release_station(con, agent_id)
    store.event(con, "AGENT_RETIRED", actor=by, subject=agent_id, payload={"why": why})
    return {"agent_id": agent_id, "lifecycle": "RETIRED",
            "history_kept": True, "body_kept": EMB.body_of(con, agent_id) is not None}


def report(con):
    """What the factory has actually done. Every row, no summary prose."""
    jobs = [dict(r) for r in con.execute(
        "SELECT * FROM factory_jobs ORDER BY id DESC LIMIT 50")]
    for j in jobs:
        for k in ("analysis", "required_skills", "required_tools"):
            if isinstance(j.get(k), str) and j[k]:
                try:
                    j[k] = json.loads(j[k])
                except ValueError:
                    pass
    made = [dict(r) for r in con.execute(
        "SELECT l.*, p.name, p.role, p.lifecycle_state, b.body_id, "
        "       loc.workspace, loc.x, loc.y "
        "FROM agent_lineage l JOIN principals p ON p.id=l.principal_id "
        "LEFT JOIN agent_bodies b ON b.principal_id=l.principal_id "
        "LEFT JOIN agent_locations loc ON loc.principal_id=l.principal_id "
        "ORDER BY l.factory_job_id DESC")]
    counts = {}
    for r in con.execute("SELECT decision, COUNT(*) c FROM factory_jobs "
                         "GROUP BY decision"):
        counts[r["decision"]] = r["c"]
    return {
        "jobs": jobs, "created": made, "decisions": counts,
        "agents": con.execute(
            "SELECT COUNT(*) c FROM principals WHERE tier<>'owner_plane'"
        ).fetchone()["c"],
        "active": con.execute(
            "SELECT COUNT(*) c FROM principals WHERE tier<>'owner_plane' "
            "AND lifecycle_state='ACTIVE'").fetchone()["c"],
        "awaiting_owner": [r["id"] for r in con.execute(
            "SELECT id FROM principals WHERE lifecycle_state IN "
            "('PROPOSED','EVALUATING','APPROVED') ORDER BY id")],
    }
