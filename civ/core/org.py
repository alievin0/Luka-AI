"""THE ORGANISATION: discovery → idea → opportunity → project, plus the
entities that keep it honest — experiments, failures, disagreement, memory
and cross-project signals.

Two rules run through everything here:
  · OBSERVATION, INTERPRETATION and VALIDATED FACT are different columns.
  · Nothing is created before the organisation has searched its own past for it.
"""
import json
import re

from . import store
from .store import now

STOP = {"the", "and", "for", "with", "that", "this", "から", "من", "في"}


def tokens(text):
    return {w for w in re.split(r"[^a-z0-9؀-ۿ]+", str(text).lower())
            if len(w) > 2 and w not in STOP}


def _jaccard(a, b):
    return len(a & b) / len(a | b) if (a or b) else 0.0


def _overlap(a, b):
    """Overlap coefficient: intersection over the SMALLER set.

    Jaccard is the wrong measure for cross-project detection. Two projects
    attacking one problem in different verticals ("workshops" vs "clinics")
    are diluted by exactly the words that make them different verticals, which
    is the case this detector exists to catch.
    """
    return len(a & b) / min(len(a), len(b)) if (a and b) else 0.0


# ── ORGANISATIONAL MEMORY (§31) ──────────────────────────────────────
MEMORY_SOURCES = {
    "discovery": ("discoveries", "observation || ' ' || interpretation"),
    "idea": ("ideas", "problem || ' ' || solution || ' ' || target_user"),
    "opportunity": ("opportunities", "problem || ' ' || market"),
    "project": ("projects", "name || ' ' || mission || ' ' || hypothesis"),
    "failure": ("failures", "what_happened || ' ' || why || ' ' || lesson"),
    "experiment": ("experiments", "hypothesis || ' ' || method"),
}


def recall(con, text, kinds=None, threshold=0.25, limit=5):
    """Search the organisation's own past before creating anything new.

    Lexical, not semantic — and labelled as such. It catches the same idea under
    a new name, which is the failure mode this exists for.
    """
    want = tokens(text)
    hits = []
    for kind, (table, expr) in MEMORY_SOURCES.items():
        if kinds and kind not in kinds:
            continue
        for r in con.execute("SELECT id, %s AS body FROM %s" % (expr, table)):
            s = _jaccard(want, tokens(r["body"]))
            if s >= threshold:
                hits.append({"kind": kind, "id": r["id"], "similarity": round(s, 3),
                             "text": (r["body"] or "")[:160]})
    hits.sort(key=lambda h: -h["similarity"])
    return hits[:limit]


def _dedup_guard(con, text, kind, created_by):
    prior = recall(con, text)
    if prior:
        store.event(con, "DUPLICATE_SUSPECTED", actor=created_by,
                    payload={"kind": kind, "matches": prior[:3]})
    return prior


# ── DISCOVERY (§21) ──────────────────────────────────────────────────
def discover(con, observation, source, by_agent, interpretation="", confidence=0.0,
             evidence_id=None, run_id=None, projects=()):
    """OBSERVATION is what was seen. INTERPRETATION is what an agent thinks it
    means. Neither is a validated fact; that needs a claim with evidence."""
    prior = _dedup_guard(con, observation, "discovery", by_agent)
    did = con.execute(
        "INSERT INTO discoveries(observation,interpretation,confidence,source_agents,"
        "source_projects,evidence_id,run_id,source,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        (observation, interpretation, float(confidence), json.dumps([by_agent]),
         json.dumps(list(projects)), evidence_id, run_id, source, now())).lastrowid
    store.event(con, "DISCOVERY_RECORDED", actor=by_agent, subject="discovery:%d" % did,
                payload={"source": source, "duplicates": len(prior)})
    return did, prior


# ── IDEA (§22) ───────────────────────────────────────────────────────
def propose_idea(con, problem, by_agent, source, solution="", target_user="",
                 origin_type="AGENT", origin_id=None, run_id=None, **kw):
    prior = _dedup_guard(con, problem + " " + solution, "idea", by_agent)
    iid = con.execute(
        "INSERT INTO ideas(problem,target_user,solution,origin_type,origin_id,"
        "creator_agents,assumptions,market,competition,differentiation,required_skills,"
        "validation_plan,run_id,source,created_at,updated_at) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (problem, target_user, solution, origin_type,
         str(origin_id) if origin_id is not None else None, json.dumps([by_agent]),
         json.dumps(kw.get("assumptions", [])), kw.get("market", ""),
         kw.get("competition", ""), kw.get("differentiation", ""),
         json.dumps(kw.get("required_skills", [])), kw.get("validation_plan", ""),
         run_id, source, now(), now())).lastrowid
    store.event(con, "IDEA_CREATED", actor=by_agent, subject="idea:%d" % iid,
                payload={"duplicates": len(prior)})
    return iid, prior


def set_idea_status(con, idea_id, status, by="OWNER_PLANE"):
    con.execute("UPDATE ideas SET status=?, updated_at=? WHERE id=?", (status, now(), idea_id))
    store.event(con, "IDEA_STATUS", actor=by, subject="idea:%d" % idea_id,
                payload={"status": status})


# ── OPPORTUNITY (§23) ────────────────────────────────────────────────
def raise_opportunity(con, problem, source, by_agent, idea_id=None, evidence_id=None, **kw):
    prior = _dedup_guard(con, problem, "opportunity", by_agent)
    oid = con.execute(
        "INSERT INTO opportunities(source,problem,market,potential_value,risks,"
        "required_caps,validation_plan,idea_id,evidence_id,created_at) "
        "VALUES(?,?,?,?,?,?,?,?,?,?)",
        (source, problem, kw.get("market", ""), kw.get("potential_value", ""),
         json.dumps(kw.get("risks", [])), json.dumps(kw.get("required_caps", [])),
         kw.get("validation_plan", ""), idea_id, evidence_id, now())).lastrowid
    store.event(con, "OPPORTUNITY_FOUND", actor=by_agent, subject="opportunity:%d" % oid,
                payload={"duplicates": len(prior)})
    return oid, prior


# ── PROJECT FACTORY (§12–§14) ────────────────────────────────────────
class GateError(ValueError):
    pass


def create_project(con, name, mission, origin_type, origin_id, by,
                   hypothesis="", required_caps=(), usd_budget=0.0):
    """A project must come from somewhere. Unsourced projects are refused."""
    if origin_type not in ("DISCOVERY", "IDEA", "OPPORTUNITY", "OWNER"):
        raise GateError("origin_type must be DISCOVERY, IDEA, OPPORTUNITY or OWNER")
    if origin_type != "OWNER" and origin_id is None:
        raise GateError("a %s-originated project must name its origin id" % origin_type)
    if origin_type == "OPPORTUNITY":
        row = con.execute("SELECT status FROM opportunities WHERE id=?",
                          (origin_id,)).fetchone()
        if row is None:
            raise GateError("opportunity %s does not exist" % origin_id)
        if row["status"] not in ("VALIDATED", "VALIDATING"):
            raise GateError("opportunity %s is %s — an idea may not become a project "
                            "without validation" % (origin_id, row["status"]))
    prior = recall(con, name + " " + mission + " " + hypothesis, kinds=("project", "failure"))
    pid = con.execute(
        "INSERT INTO projects(name,mission,stage,hypothesis,origin,created_at) "
        "VALUES(?,?,?,?,?,?)",
        (name, mission, "DISCOVERY", hypothesis,
         "%s:%s" % (origin_type, origin_id), now())).lastrowid
    store.event(con, "PROJECT_CREATED", actor=by, subject="project:%d" % pid,
                payload={"origin": "%s:%s" % (origin_type, origin_id),
                         "similar_prior_work": len(prior)})
    if prior:
        store.signal(con, "MEDIUM", "Project #%d resembles %d earlier item(s)" % (pid, len(prior)),
                     "; ".join("%s #%s (%.0f%%)" % (h["kind"], h["id"], h["similarity"] * 100)
                               for h in prior), project_id=pid)
    return pid, prior


def form_team(con, project_id, required_caps, by="OWNER_PLANE", name="Project Team"):
    """Pick agents by capability, availability and workload — and record WHY."""
    tid = con.execute("INSERT INTO teams(project_id,name,purpose,created_at) VALUES(?,?,?,?)",
                      (project_id, name, "capability-matched team", now())).lastrowid
    chosen, unmet = [], []
    for cap in required_caps:
        cands = []
        for r in con.execute(
                "SELECT p.id, p.name, p.role, p.lifecycle_state, p.task_limit FROM principals p "
                "JOIN agent_capabilities ac ON ac.principal_id=p.id "
                "WHERE ac.capability_id=? AND p.lifecycle_state IN ('ACTIVE','APPROVED')",
                (cap,)):
            load = con.execute("SELECT COUNT(*) n FROM tasks WHERE status='LEASED' AND id IN "
                               "(SELECT task_id FROM leases WHERE principal_id=? "
                               "AND status='ACTIVE')", (r["id"],)).fetchone()["n"]
            prof = con.execute("SELECT COALESCE(MAX(eval_score),0) s FROM agent_skills "
                               "WHERE principal_id=?", (r["id"],)).fetchone()["s"]
            cands.append({"id": r["id"], "name": r["name"], "role": r["role"],
                          "workload": load, "proficiency": round(prof or 0, 3),
                          "capacity": r["task_limit"] - load})
        if not cands:
            unmet.append(cap)
            continue
        cands.sort(key=lambda c: (-c["proficiency"], c["workload"]))
        pick = cands[0]
        why = ("holds %s; proficiency %.2f; %d task(s) in flight; chosen over %d other(s)"
               % (cap, pick["proficiency"], pick["workload"], len(cands) - 1))
        con.execute("INSERT OR IGNORE INTO team_members(team_id,principal_id,seat) "
                    "VALUES(?,?,?)", (tid, pick["id"], why))
        chosen.append({"agent": pick["id"], "capability": cap, "why": why})
    store.event(con, "TEAM_CREATED", actor=by, subject="team:%d" % tid,
                payload={"project": project_id, "seats": len(chosen), "unmet": unmet})
    if unmet:
        store.signal(con, "HIGH", "Capability gap on project #%d" % project_id,
                     "No active agent holds: %s. The Agent Factory can answer this."
                     % ", ".join(unmet), project_id=project_id)
    return tid, chosen, unmet


# ── EXPERIMENTS (§25) ────────────────────────────────────────────────
def design_experiment(con, project_id, hypothesis, method, success, failure, by,
                      agents=(), usd_budget=0.0, why=""):
    eid = con.execute(
        "INSERT INTO experiments(project_id,hypothesis,why_it_matters,method,"
        "success_criteria,failure_criteria,agents,usd_budget,created_at) "
        "VALUES(?,?,?,?,?,?,?,?,?)",
        (project_id, hypothesis, why, method, success, failure,
         json.dumps(list(agents)), float(usd_budget), now())).lastrowid
    store.event(con, "EXPERIMENT_DESIGNED", actor=by, subject="experiment:%d" % eid)
    return eid


def complete_experiment(con, exp_id, result, evidence_id, conclusion, next_action, by):
    """A conclusion without evidence is refused by the database."""
    con.execute("UPDATE experiments SET status='COMPLETE', result=?, evidence_id=?, "
                "conclusion=?, next_action=?, completed_at=? WHERE id=?",
                (result, evidence_id, conclusion, next_action, now(), exp_id))
    store.event(con, "EXPERIMENT_COMPLETED", actor=by, subject="experiment:%d" % exp_id,
                payload={"result": result})
    store.signal(con, "HIGH" if result == "NOT_VALIDATED" else "MEDIUM",
                 "Experiment #%d: %s" % (exp_id, result), conclusion)
    return exp_id


# ── FAILURE MEMORY (§26) ─────────────────────────────────────────────
def record_failure(con, kind, subject_id, what, why, lesson, by, **kw):
    fid = con.execute(
        "INSERT INTO failures(subject_kind,subject_id,what_happened,why,failed_assumption,"
        "agents,usd_cost,evidence_id,lesson,what_would_change,created_at) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (kind, str(subject_id), what, why, kw.get("failed_assumption", ""),
         json.dumps(kw.get("agents", [])), float(kw.get("usd_cost", 0)),
         kw.get("evidence_id"), lesson, kw.get("what_would_change", ""), now())).lastrowid
    store.event(con, "FAILURE_RECORDED", actor=by, subject="failure:%d" % fid,
                payload={"kind": kind, "subject": subject_id})
    store.signal(con, "HIGH", "%s %s failed" % (kind.title(), subject_id), lesson)
    return fid


# ── DISAGREEMENT (§29) ───────────────────────────────────────────────
def open_disagreement(con, kind, subject_id):
    return con.execute("INSERT INTO disagreements(subject_kind,subject_id,created_at) "
                       "VALUES(?,?,?)", (kind, str(subject_id), now())).lastrowid


def take_position(con, dis_id, agent_id, stance, claim, confidence=0.5,
                  evidence_id=None, missing_evidence="", resolving_experiment=None):
    """Positions are preserved. They are never averaged into one number."""
    con.execute(
        "INSERT OR REPLACE INTO positions(disagreement_id,principal_id,stance,claim,"
        "confidence,evidence_id,missing_evidence,resolving_experiment,created_at) "
        "VALUES(?,?,?,?,?,?,?,?,?)",
        (dis_id, agent_id, stance, claim, float(confidence), evidence_id,
         missing_evidence, resolving_experiment, now()))
    store.event(con, "POSITION_TAKEN", actor=agent_id, subject="disagreement:%d" % dis_id,
                payload={"stance": stance})


def disagreement_view(con, dis_id):
    rows = [dict(r) for r in con.execute(
        "SELECT * FROM positions WHERE disagreement_id=? ORDER BY id", (dis_id,))]
    return {"disagreement_id": dis_id, "positions": rows,
            "stances": sorted({r["stance"] for r in rows}),
            "unresolved": len({r["stance"] for r in rows}) > 1,
            "note": "positions are preserved individually; no average is computed"}


# ── CROSS-PROJECT SIGNALS (§30) ──────────────────────────────────────
def detect_cross_project(con, threshold=0.3):
    """Find the same problem, technology or failure showing up in two places."""
    found = []
    items = []
    for r in con.execute("SELECT id, name || ' ' || mission || ' ' || hypothesis AS b "
                         "FROM projects"):
        items.append(("project", r["id"], tokens(r["b"])))
    for r in con.execute("SELECT id, problem || ' ' || solution AS b FROM ideas"):
        items.append(("idea", r["id"], tokens(r["b"])))
    for r in con.execute("SELECT id, what_happened || ' ' || why AS b FROM failures"):
        items.append(("failure", r["id"], tokens(r["b"])))
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            ka, ia, ta = items[i]
            kb, ib, tb = items[j]
            shared = ta & tb
            s = max(_jaccard(ta, tb), _overlap(ta, tb) if len(shared) >= 3 else 0.0)
            # A real connection needs BOTH enough shared substance and enough
            # proportion, so a single common word can never raise a signal.
            related = (len(shared) >= 3 and s >= threshold)
            if related and not (ka == kb and ia == ib):
                kind = ("same_failure_pattern" if "failure" in (ka, kb)
                        else "same_problem")
                refs = ["%s:%s" % (ka, ia), "%s:%s" % (kb, ib)]
                if con.execute("SELECT 1 FROM cross_project_signals WHERE refs=?",
                               (json.dumps(refs),)).fetchone():
                    continue
                sid = con.execute(
                    "INSERT INTO cross_project_signals(kind,detail,refs,strength,created_at) "
                    "VALUES(?,?,?,?,?)",
                    (kind, "%s and %s share %d substantive term(s): %s"
                     % (refs[0], refs[1], len(shared),
                        ", ".join(sorted(shared)[:6])), json.dumps(refs), round(s, 3),
                     now())).lastrowid
                store.event(con, "CROSS_PROJECT_SIGNAL", actor="SIGNAL_ENGINE",
                            subject="xsignal:%d" % sid, payload={"kind": kind, "refs": refs})
                found.append({"id": sid, "kind": kind, "refs": refs,
                              "strength": round(s, 3), "shared": sorted(shared)[:6]})
    return found


# ── SIGNAL ENGINE (§32) ──────────────────────────────────────────────
# A raw event is not a notification. Only these patterns reach the owner.
def run_signal_engine(con):
    """Turn raw events into meaningful signals. Returns the signals created."""
    made = []

    def emit(priority, headline, detail, **kw):
        made.append(store.signal(con, priority, headline, detail, **kw))

    dupes = con.execute("SELECT COUNT(*) n FROM events WHERE kind='DUPLICATE_SUSPECTED' "
                        "AND id > COALESCE((SELECT value FROM owner_state "
                        "WHERE key='signal_cursor'), 0)").fetchone()["n"]
    if dupes:
        emit("MEDIUM", "%d possible duplicate(s) of earlier work" % dupes,
             "The organisation proposed something it may already have done.")

    gaps = con.execute("SELECT COUNT(*) n FROM factory_jobs WHERE decision='NEW_AGENT'"
                       ).fetchone()["n"]
    if gaps:
        emit("MEDIUM", "%d capability gap(s) judged to need a new agent" % gaps,
             "Inspect with `owner.py factory`.")

    fails = con.execute("SELECT COUNT(*) n FROM experiments WHERE result='NOT_VALIDATED'"
                        ).fetchone()["n"]
    if fails:
        emit("HIGH", "%d hypothesis/hypotheses invalidated by experiment" % fails,
             "An assumption the organisation was acting on did not hold.")

    xs = con.execute("SELECT COUNT(*) n FROM cross_project_signals").fetchone()["n"]
    if xs:
        emit("MEDIUM", "%d cross-project connection(s) detected" % xs,
             "The same problem or failure appears in more than one place.")

    unmet = con.execute("SELECT COUNT(*) n FROM events WHERE kind='TEAM_CREATED' "
                        "AND payload LIKE '%\"unmet\": [\"%'").fetchone()["n"]
    if unmet:
        emit("HIGH", "%d team(s) formed with an unfilled capability" % unmet,
             "Work is queued that no active agent can take.")

    last = con.execute("SELECT COALESCE(MAX(id),0) m FROM events").fetchone()["m"]
    con.execute("INSERT INTO owner_state(key,value) VALUES('signal_cursor',?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(last),))
    return made
