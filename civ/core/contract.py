"""THE AGENT CONTRACT — machine-readable, versioned, validated.

A contract is persistent organisational state. A live execution is temporary.
Nothing critical here is prose: every property the runtime or the gateway needs
is a typed field, because a property only enforcement can read is decoration.

Three states must never be conflated:
    SIMULATED AGENT  — a row in world/, no contract, no runtime identity
    REGISTERED AGENT — a contract in principals + agent_versions
    LIVE EXECUTION   — a registered agent holding a valid lease
"""
import json
import re

from . import store
from .store import now, sha

LIFECYCLE = ("PROPOSED", "EVALUATING", "APPROVED", "ACTIVE",
             "SUSPENDED", "RETRAINING", "RETIRED")

# Only these transitions are legal. Retirement is terminal but never deletes.
TRANSITIONS = {
    "PROPOSED":   {"EVALUATING", "RETIRED"},
    "EVALUATING": {"APPROVED", "PROPOSED", "RETIRED"},
    "APPROVED":   {"ACTIVE", "SUSPENDED", "RETIRED"},
    "ACTIVE":     {"SUSPENDED", "RETRAINING", "RETIRED"},
    "SUSPENDED":  {"ACTIVE", "RETRAINING", "RETIRED"},
    "RETRAINING": {"EVALUATING", "ACTIVE", "SUSPENDED", "RETIRED"},
    "RETIRED":    set(),
}

TIERS = ("reader", "actor", "judge", "owner_plane")
REQUIRED = ("agent_id", "name", "role", "department", "division", "mission", "tier")

# The five concepts, kept apart (directive §2). Collapsing them is the defect.
CONCEPTS = ("skills", "capabilities", "tools", "permissions")

# What §8 actually names as making two agents "effectively duplicates". Note it
# excludes capabilities and includes the three fields the runtime enforces on.
DUPLICATE_FIELDS = ("tools", "permissions", "skills", "memory_scope",
                    "success_metrics", "escalation_rules")


class ContractError(ValueError):
    pass


def _norm(v):
    return v if isinstance(v, list) else ([] if v is None else [v])


def validate(c):
    """Raise ContractError on anything the runtime could not actually enforce."""
    missing = [k for k in REQUIRED if not c.get(k)]
    if missing:
        raise ContractError("missing required field(s): %s" % missing)
    if not re.fullmatch(r"AGT-[0-9A-Za-z_-]{3,}", c["agent_id"]):
        raise ContractError("agent_id must look like AGT-000001, got %r" % c["agent_id"])
    if c["tier"] not in TIERS:
        raise ContractError("tier must be one of %s" % (TIERS,))
    lvl = int(c.get("autonomy_level", 0))
    if not 0 <= lvl <= 5:
        raise ContractError("autonomy_level must be 0..5")
    if c["tier"] == "reader" and lvl > 2:
        raise ContractError("LAW 3: a reader may never exceed autonomy level 2")
    for k in CONCEPTS:
        if not isinstance(c.get(k, []), list):
            raise ContractError("%s must be a list — the five concepts stay separate" % k)
    if c.get("lifecycle_state", "PROPOSED") not in LIFECYCLE:
        raise ContractError("lifecycle_state must be one of %s" % (LIFECYCLE,))
    for m in c.get("success_metrics", []):
        if not isinstance(m, dict) or "metric" not in m:
            raise ContractError("each success metric needs a 'metric' key: %r" % (m,))
    for e in c.get("escalation_rules", []):
        if not isinstance(e, dict) or "when" not in e or "action" not in e:
            raise ContractError("each escalation rule needs 'when' and 'action': %r" % (e,))
    if float(c.get("cost_limit_usd", 1.0)) <= 0:
        raise ContractError("cost_limit_usd must be positive")
    return True


def blank(agent_id, name, role, division, department, mission, tier="reader"):
    return {
        "agent_id": agent_id, "name": name, "role": role,
        "division": division, "department": department, "mission": mission,
        "responsibilities": [], "tier": tier,
        "skills": [], "capabilities": [], "tools": [], "permissions": [],
        "memory_scope": ["self"], "model_policy": {"tier": "cheap"},
        "autonomy_level": 0, "cost_limit_usd": 1.0, "task_limit": 50,
        "review_policy": {"required_domains": [], "risk": "low"},
        "escalation_rules": [], "success_metrics": [],
        "manager": None, "team": None,
        "lifecycle_state": "PROPOSED", "version": 1,
    }


def distinctness_key(c):
    """What actually makes two agents different. A different NAME is not it."""
    return sha({k: sorted(json.dumps(x, sort_keys=True, ensure_ascii=False)
                          for x in _norm(c.get(k, [])))
                for k in ("tools", "permissions", "memory_scope",
                          "success_metrics", "escalation_rules")})


def similarity(a, b):
    """Jaccard over the four capability concepts. 1.0 means functionally identical."""
    scores = []
    for k in DUPLICATE_FIELDS:
        sa = {json.dumps(x, sort_keys=True, ensure_ascii=False) for x in _norm(a.get(k, []))}
        sb = {json.dumps(x, sort_keys=True, ensure_ascii=False) for x in _norm(b.get(k, []))}
        if not sa and not sb:
            continue
        scores.append(len(sa & sb) / len(sa | sb))
    return round(sum(scores) / len(scores), 4) if scores else 0.0


def register(con, c, reason="initial registration"):
    """Persist a contract. Writes principals + a versioned snapshot."""
    validate(c)
    con.execute(
        "INSERT INTO principals(id,name,role,division,department,tier,mission,"
        "autonomy_level,reports_to,tools,permissions,memory_scope,success_metrics,"
        "escalation_rules,model_tier,created_at,version,lifecycle_state,model_policy,"
        "cost_limit_usd,task_limit,review_policy,updated_at) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (c["agent_id"], c["name"], c["role"], c["division"], c["department"], c["tier"],
         c["mission"], int(c.get("autonomy_level", 0)), c.get("manager"),
         json.dumps(c.get("tools", [])), json.dumps(c.get("permissions", [])),
         json.dumps(c.get("memory_scope", [])), json.dumps(c.get("success_metrics", [])),
         json.dumps(c.get("escalation_rules", [])),
         (c.get("model_policy") or {}).get("tier", "cheap"), now(),
         int(c.get("version", 1)), c.get("lifecycle_state", "PROPOSED"),
         json.dumps(c.get("model_policy", {})), float(c.get("cost_limit_usd", 1.0)),
         int(c.get("task_limit", 50)), json.dumps(c.get("review_policy", {})), now()))
    _snapshot(con, c, reason)
    store.event(con, "AGENT_REGISTERED", actor=c.get("manager") or "OWNER_PLANE",
                subject=c["agent_id"],
                payload={"role": c["role"], "tier": c["tier"],
                         "lifecycle": c.get("lifecycle_state", "PROPOSED")})
    return c["agent_id"]


def _snapshot(con, c, reason):
    body = json.dumps(c, sort_keys=True, ensure_ascii=False)
    con.execute("INSERT OR REPLACE INTO agent_versions(principal_id,version,contract,"
                "contract_sha,reason,created_at) VALUES(?,?,?,?,?,?)",
                (c["agent_id"], int(c.get("version", 1)), body, sha(body), reason, now()))


def load(con, agent_id):
    r = con.execute("SELECT contract FROM agent_versions WHERE principal_id=? "
                    "ORDER BY version DESC LIMIT 1", (agent_id,)).fetchone()
    return json.loads(r["contract"]) if r else None


def transition(con, agent_id, to, why=""):
    """Move an agent's ORGANISATIONAL state. Illegal moves raise."""
    row = con.execute("SELECT lifecycle_state FROM principals WHERE id=?",
                      (agent_id,)).fetchone()
    if row is None:
        raise ContractError("unknown agent %s" % agent_id)
    frm = row["lifecycle_state"]
    if to not in TRANSITIONS.get(frm, set()):
        raise ContractError("illegal lifecycle transition %s -> %s" % (frm, to))
    con.execute("UPDATE principals SET lifecycle_state=?, updated_at=? WHERE id=?",
                (to, now(), agent_id))
    store.event(con, "AGENT_LIFECYCLE", actor="OWNER_PLANE", subject=agent_id,
                payload={"from": frm, "to": to, "why": why})
    return to


def grant(con, subject, capability, resource="*", scope=None, action="use",
          granted_by="OWNER_PLANE", expires_at=None):
    """Permissions are issued by the owner plane only — never by an agent or a model."""
    gid = con.execute(
        "INSERT INTO permission_grants(subject,capability,resource,scope,action,"
        "granted_by,granted_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
        (subject, capability, resource, json.dumps(scope or {}), action,
         granted_by, now(), expires_at)).lastrowid
    store.event(con, "PERMISSION_GRANTED", actor=granted_by, subject=subject,
                payload={"capability": capability, "resource": resource})
    return gid


def revoke(con, grant_id, by="OWNER_PLANE"):
    con.execute("UPDATE permission_grants SET revoked_at=? WHERE id=?", (now(), grant_id))
    store.event(con, "PERMISSION_REVOKED", actor=by, subject="grant:%d" % grant_id)
