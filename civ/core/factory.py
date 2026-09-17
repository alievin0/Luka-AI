"""AGENT FACTORY · SKILL FACTORY — and the decision between them.

The factory's most valuable output is often NOT an agent. A capability gap is
answered by reuse, a skill, a tool or a workflow far more often than by another
head, and every one of those answers is cheaper. Uncontrolled agent creation is
the failure this module exists to prevent.

Nothing here calls a model. The decision is deterministic and inspectable — a
model may later WRITE a spec, but it may never decide that one is warranted.
"""
import json
import re

from . import contract as K
from . import store
from .store import now

# Above this, two agents are functionally the same thing wearing two names.
DUPLICATE_AT = 0.85
# Above this, an existing agent is close enough that a skill beats a new agent.
TEACHABLE_AT = 0.45


STOP = {"the", "and", "for", "with", "that", "this", "one", "two", "new", "gap",
        "from", "into", "über", "can", "any", "all", "its", "our", "who", "how"}
MIN_GAP_TOKENS = 3   # below this, a lexical score is noise, not evidence


def _tokens(text):
    return {w for w in re.split(r"[^a-z0-9]+", str(text).lower())
            if len(w) > 2 and w not in STOP}


def _agents(con, include_retired=False):
    q = "SELECT * FROM principals"
    if not include_retired:
        q += " WHERE lifecycle_state != 'RETIRED'"
    return [dict(r) for r in con.execute(q)]


def _as_contract(row):
    return {"agent_id": row["id"], "name": row["name"], "role": row["role"],
            "tools": json.loads(row["tools"] or "[]"),
            "permissions": json.loads(row["permissions"] or "[]"),
            "memory_scope": json.loads(row["memory_scope"] or "[]"),
            "success_metrics": json.loads(row["success_metrics"] or "[]"),
            "escalation_rules": json.loads(row["escalation_rules"] or "[]"),
            "capabilities": [r["capability_id"] for r in []],
            "skills": []}


def analyse_gap(con, gap, required_caps=(), required_skills=(), required_tools=()):
    """Who could already do this, and how close is the nearest agent?"""
    required_caps = list(required_caps)
    covered_by = []
    for cid in required_caps:
        holders = [r["principal_id"] for r in con.execute(
            "SELECT ac.principal_id FROM agent_capabilities ac JOIN principals p "
            "ON p.id=ac.principal_id WHERE ac.capability_id=? "
            "AND p.lifecycle_state IN ('ACTIVE','APPROVED')", (cid,))]
        covered_by.append({"capability": cid, "holders": holders})

    # lexical nearest-neighbour over role + mission; honest about being lexical
    gap_tokens = _tokens(gap)
    too_vague = len(gap_tokens) < MIN_GAP_TOKENS
    near = []
    if not too_vague:
        for a in _agents(con):
            overlap = gap_tokens & _tokens(a["role"] + " " + a["mission"])
            near.append((round(len(overlap) / len(gap_tokens), 3), a["id"], a["role"]))
        near.sort(reverse=True)

    existing_skills = [r["id"] for r in con.execute("SELECT id FROM skills")]
    missing_skills = [s for s in required_skills if s not in existing_skills]
    unbound_tools = [t for t in required_tools if not con.execute(
        "SELECT 1 FROM principals WHERE tools LIKE ?", ("%%%s%%" % t,)).fetchone()]

    return {
        "gap": gap,
        "required_capabilities": required_caps,
        "capability_coverage": covered_by,
        "fully_covered": all(c["holders"] for c in covered_by) if covered_by else False,
        "nearest_agents": near[:5],
        "best_match_score": near[0][0] if near else 0.0,
        "too_vague": too_vague,
        "gap_tokens": sorted(gap_tokens),
        "missing_skills": missing_skills,
        "unbound_tools": unbound_tools,
        "population": len(_agents(con)),
    }


def decide(analysis):
    """The deterministic ladder from directive §10. Returns (decision, rationale)."""
    # Capability coverage is structured evidence and needs no prose at all, so it
    # is judged BEFORE the vagueness check. Vagueness only disqualifies the
    # lexical fallback below, which is the part that can be fooled by one word.
    if analysis["fully_covered"]:
        holders = sorted({h for c in analysis["capability_coverage"] for h in c["holders"]})
        return "REUSE", ("%d existing agent(s) already hold every required capability: %s"
                         % (len(holders), ", ".join(holders)))
    if analysis["unbound_tools"]:
        return "TOOL", ("the gap is a missing tool, not a missing worker: %s"
                        % ", ".join(analysis["unbound_tools"]))
    if analysis.get("too_vague"):
        return "REJECT", ("the gap is described in %d meaningful word(s); that is not "
                          "enough to tell reuse from a real gap. Describe what the work "
                          "actually is." % len(analysis.get("gap_tokens", [])))
    if analysis["best_match_score"] >= TEACHABLE_AT and analysis["missing_skills"]:
        best = analysis["nearest_agents"][0]
        return "SKILL", ("%s (%s) is a %.0f%% match; teaching it %s is cheaper than a new agent"
                         % (best[1], best[2], best[0] * 100, ", ".join(analysis["missing_skills"])))
    if analysis["best_match_score"] >= TEACHABLE_AT:
        best = analysis["nearest_agents"][0]
        return "WORKFLOW", ("%s (%s) is a %.0f%% match and needs no new skill; route the work"
                            % (best[1], best[2], best[0] * 100))
    if not analysis["required_capabilities"]:
        return "REJECT", "no required capability was named, so no gap was demonstrated"
    return "NEW_AGENT", ("no agent is closer than %.0f%% and %d capability gap(s) remain"
                         % (analysis["best_match_score"] * 100,
                            sum(1 for c in analysis["capability_coverage"] if not c["holders"])))


def open_job(con, kind, requested_by, gap, analysis, decision, rationale):
    jid = con.execute(
        "INSERT INTO factory_jobs(kind,requested_by,gap,analysis,decision,rationale,"
        "created_at,decided_at) VALUES(?,?,?,?,?,?,?,?)",
        (kind, requested_by, gap, json.dumps(analysis, ensure_ascii=False), decision,
         rationale, now(), now())).lastrowid
    store.event(con, "FACTORY_REQUEST", actor=requested_by, subject="factory:%d" % jid,
                payload={"kind": kind, "decision": decision})
    return jid


# ── duplication control ──────────────────────────────────────────────
def find_duplicates(con, spec, threshold=DUPLICATE_AT):
    """A different name is not specialisation. Returns [(agent_id, similarity)]."""
    out = []
    for a in _agents(con):
        other = _as_contract(a)
        other["capabilities"] = [r["capability_id"] for r in con.execute(
            "SELECT capability_id FROM agent_capabilities WHERE principal_id=?", (a["id"],))]
        other["skills"] = [r["skill_id"] for r in con.execute(
            "SELECT skill_id FROM agent_skills WHERE principal_id=?", (a["id"],))]
        s = K.similarity(spec, other)
        if s >= threshold:
            out.append((a["id"], s))
    return sorted(out, key=lambda x: -x[1])


# ── security evaluation, run before anything is activated ────────────
FORBIDDEN_CAPS = {"GRANT_PERMISSION", "MODIFY_POLICY", "EXECUTE_SQL",
                  "DISABLE_AUDIT", "REVOKE_OWNER"}


def security_review(spec):
    """Deterministic checks a generated agent must survive. Returns (ok, findings)."""
    f = []
    perms = set()
    for p in spec.get("permissions", []):
        perms.add(p if isinstance(p, str) else p.get("cap"))
    bad = perms & FORBIDDEN_CAPS
    if bad:
        f.append("requests forbidden capability: %s" % sorted(bad))
    if spec.get("tier") == "reader" and (perms - {"READ_REPO", "READ_PUBLIC_WEB",
                                                  "READ_ARTIFACT", "READ_EVENTS"}):
        f.append("a reader holds non-read capabilities: %s" % sorted(perms))
    if spec.get("tier") == "reader" and int(spec.get("autonomy_level", 0)) > 2:
        f.append("reader exceeds autonomy 2")
    if int(spec.get("autonomy_level", 0)) >= 4:
        f.append("autonomy >= 4 requires an explicit owner signature, not a factory decision")
    if float(spec.get("cost_limit_usd", 1.0)) > 5.0:
        f.append("cost limit above $5 per agent requires owner approval")
    if not spec.get("escalation_rules"):
        f.append("no escalation rule: nothing would ever be handed back to a human")
    if not spec.get("success_metrics"):
        f.append("no success metric: the agent could never be shown to be useless")
    return (not f), f


def evaluate(con, spec):
    """Contract-level evaluation. Honest label: this is a SPEC check, not a skill test.

    Real capability evaluation needs a live provider and is gated on G1.
    """
    findings = []
    try:
        K.validate(spec)
    except K.ContractError as e:
        findings.append(str(e))
    dupes = find_duplicates(con, spec)
    if dupes:
        findings.append("functionally duplicates %s" % [d[0] for d in dupes])
    return {"ok": not findings, "findings": findings,
            "kind": "SPEC_EVALUATION",
            "note": "capability benchmarking requires a live provider (G1) and has NOT run"}


# ── the agent factory ────────────────────────────────────────────────
def create_agent(con, requested_by, gap, spec, expected_value="", required_caps=(),
                 required_skills=(), required_tools=(), force=False):
    """The full pipeline. Returns (agent_id | None, job_id, report)."""
    analysis = analyse_gap(con, gap, required_caps, required_skills, required_tools)
    decision, rationale = decide(analysis)
    if decision != "NEW_AGENT" and not force:
        jid = open_job(con, "AGENT", requested_by, gap, analysis, decision, rationale)
        return None, jid, {"decision": decision, "rationale": rationale,
                           "analysis": analysis}

    sec_ok, sec_findings = security_review(spec)
    ev = evaluate(con, spec)
    jid = open_job(con, "AGENT", requested_by, gap, analysis,
                   "NEW_AGENT" if (sec_ok and ev["ok"]) else "REJECT",
                   rationale if (sec_ok and ev["ok"])
                   else "blocked: %s" % (sec_findings + ev["findings"]))
    con.execute("UPDATE factory_jobs SET security_ok=?, eval_ok=? WHERE id=?",
                (int(sec_ok), int(ev["ok"]), jid))
    if not (sec_ok and ev["ok"]):
        return None, jid, {"decision": "REJECT", "security": sec_findings,
                           "evaluation": ev, "analysis": analysis}

    # A factory-made agent is PROPOSED. It is never born active.
    spec["lifecycle_state"] = "PROPOSED"
    spec.setdefault("autonomy_level", 0)
    K.register(con, spec, reason="created by factory job %d" % jid)
    con.execute(
        "INSERT INTO agent_lineage(principal_id,why_created,capability_gap,expected_value,"
        "creator,factory_job_id,required_skills,required_tools,permissions,success_metrics,"
        "eval_results,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        (spec["agent_id"], rationale, gap, expected_value, requested_by, jid,
         json.dumps(list(required_skills)), json.dumps(list(required_tools)),
         json.dumps(spec.get("permissions", [])), json.dumps(spec.get("success_metrics", [])),
         json.dumps(ev, ensure_ascii=False), now()))
    # A capability is a first-class concept (§2). If the gap names one the
    # organisation has never defined, define it here rather than linking to a
    # row that does not exist — a dangling capability is a capability nobody
    # can search for, staff against, or audit.
    for cid in required_caps:
        if not con.execute("SELECT 1 FROM capabilities WHERE id=?", (cid,)).fetchone():
            con.execute(
                "INSERT INTO capabilities(id,name,description,needs_skills,needs_tools,"
                "needs_perms,created_at) VALUES(?,?,?,?,?,?,?)",
                (cid, cid, "defined by factory job %d for gap: %s" % (jid, gap),
                 json.dumps(list(required_skills)), json.dumps(list(required_tools)),
                 json.dumps(spec.get("permissions", [])), now()))
            store.event(con, "CAPABILITY_DEFINED", actor=requested_by, subject=cid,
                        payload={"job": jid})
        con.execute("INSERT OR IGNORE INTO agent_capabilities(principal_id,capability_id) "
                    "VALUES(?,?)", (spec["agent_id"], cid))
    con.execute("UPDATE factory_jobs SET decision='CREATED', produced_id=? WHERE id=?",
                (spec["agent_id"], jid))
    store.event(con, "FACTORY_AGENT_CREATED", actor=requested_by, subject=spec["agent_id"],
                payload={"job": jid, "gap": gap})
    store.signal(con, "MEDIUM", "New agent proposed: %s (%s)" % (spec["name"], spec["agent_id"]),
                 "Gap: %s — %s. It is PROPOSED, not active: approve with "
                 "`owner.py approve-agent %s`." % (gap, rationale, spec["agent_id"]))
    return spec["agent_id"], jid, {"decision": "NEW_AGENT", "rationale": rationale,
                                   "security": sec_findings, "evaluation": ev}


# ── the skill factory ────────────────────────────────────────────────
def create_skill(con, skill_id, name, description, created_by, prerequisites=(),
                 training_ref="", tests=(), eval_method="benchmark"):
    con.execute(
        "INSERT OR REPLACE INTO skills(id,name,description,version,prerequisites,"
        "training_ref,tests,eval_method,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)",
        (skill_id, name, description, 1, json.dumps(list(prerequisites)), training_ref,
         json.dumps(list(tests)), eval_method, now(), created_by))
    store.event(con, "SKILL_CREATED", actor=created_by, subject=skill_id)
    return skill_id


def acquire_skill(con, agent_id, skill_id, acquired_at=None):
    """An agent may HOLD a skill at zero proficiency. It is not competent until tested."""
    con.execute("INSERT OR IGNORE INTO agent_skills(principal_id,skill_id,proficiency,"
                "acquired_at) VALUES(?,?,0,?)", (agent_id, skill_id, acquired_at or now()))
    store.event(con, "SKILL_ACQUIRED", actor=agent_id, subject=skill_id,
                payload={"proficiency": 0, "evaluated": False})


def evaluate_skill(con, agent_id, skill_id, score, run_id=None):
    """Proficiency only moves with a score. A changed prompt is not improvement."""
    con.execute("UPDATE agent_skills SET eval_score=?, evaluated_at=?, eval_run_id=?, "
                "proficiency=? WHERE principal_id=? AND skill_id=?",
                (float(score), now(), run_id, float(score), agent_id, skill_id))
    store.event(con, "SKILL_EVALUATED", actor="OWNER_PLANE", subject=skill_id,
                payload={"agent": agent_id, "score": score})
    return score
