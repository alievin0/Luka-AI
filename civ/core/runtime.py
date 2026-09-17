"""Execution: leases, recorded runs, and a gateway that holds the credentials.

Law 1 — an agent is a policy, not a process. It runs only inside a lease that
carries a deadline, a token budget and an explicit capability set.
"""
import json
from datetime import datetime, timedelta, timezone

from . import store
from .store import now, sha


class Denied(Exception):
    pass


# ── the queue ────────────────────────────────────────────────────────
def enqueue(con, objective, kind, created_by, project_id=None, required_caps=(),
            priority=5, token_budget=20000, evidence_required=1, parent_id=None):
    tid = con.execute(
        "INSERT INTO tasks(project_id,parent_id,objective,kind,required_caps,priority,"
        "token_budget,evidence_required,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        (project_id, parent_id, objective, kind, json.dumps(list(required_caps)), priority,
         token_budget, evidence_required, created_by, now())).lastrowid
    store.event(con, "TASK_CREATED", actor=created_by, subject="task:%d" % tid,
                payload={"objective": objective, "kind": kind})
    return tid


def _caps(principal_row):
    return set(json.loads(principal_row["permissions"] or "[]"))


def claim(con, principal_id, lease_seconds=120):
    """Grant a lease on the best-matching queued task, or return None.

    Refuses while the owner has paused the world or the daily ceiling is spent.
    """
    if store.paused(con):
        return None
    if store.spent_today(con) >= float(store.meta(con, "usd_ceiling_day", 5.0)):
        store.event(con, "BUDGET_CEILING_REACHED", actor="SCHEDULER")
        return None
    p = con.execute("SELECT * FROM principals WHERE id=?", (principal_id,)).fetchone()
    if p is None or p["status"] in ("SUSPENDED", "RETIRED"):
        return None
    have = _caps(p)
    for t in con.execute("SELECT * FROM tasks WHERE status='QUEUED' "
                         "ORDER BY priority DESC, id ASC LIMIT 50"):
        need = set(json.loads(t["required_caps"] or "[]"))
        if not need.issubset(have):
            continue
        exp = (datetime.now(timezone.utc) + timedelta(seconds=lease_seconds)) \
            .isoformat(timespec="microseconds")
        lid = con.execute(
            "INSERT INTO leases(task_id,principal_id,granted_at,expires_at,token_budget,caps) "
            "VALUES(?,?,?,?,?,?)",
            (t["id"], principal_id, now(), exp, t["token_budget"],
             json.dumps(sorted(need)))).lastrowid
        con.execute("UPDATE tasks SET status='LEASED', attempts=attempts+1 WHERE id=?", (t["id"],))
        con.execute("UPDATE principals SET status='WORKING' WHERE id=?", (principal_id,))
        store.event(con, "TASK_LEASED", actor=principal_id, subject="task:%d" % t["id"],
                    payload={"lease": lid, "expires_at": exp})
        return {"lease_id": lid, "task": dict(t), "expires_at": exp,
                "token_budget": t["token_budget"], "caps": need}
    return None


def release(con, lease_id, status="DONE", result=None):
    l = con.execute("SELECT * FROM leases WHERE id=?", (lease_id,)).fetchone()
    if l is None:
        return
    con.execute("UPDATE leases SET status='RELEASED' WHERE id=?", (lease_id,))
    con.execute("UPDATE tasks SET status=?, result=? WHERE id=?", (status, result, l["task_id"]))
    con.execute("UPDATE principals SET status='AVAILABLE' WHERE id=?", (l["principal_id"],))
    store.event(con, "TASK_" + status, actor=l["principal_id"], subject="task:%d" % l["task_id"])


def reap_expired(con):
    """An expired lease is a redeliverable task. This is the crash-recovery path."""
    n = 0
    for l in con.execute("SELECT * FROM leases WHERE status='ACTIVE' AND expires_at < ?",
                         (now(),)).fetchall():
        con.execute("UPDATE leases SET status='EXPIRED' WHERE id=?", (l["id"],))
        con.execute("UPDATE tasks SET status='QUEUED' WHERE id=? AND status='LEASED'",
                    (l["task_id"],))
        con.execute("UPDATE principals SET status='AVAILABLE' WHERE id=?", (l["principal_id"],))
        store.event(con, "LEASE_EXPIRED", actor="SCHEDULER", subject="task:%d" % l["task_id"])
        n += 1
    return n


def lease_valid(con, lease_id):
    l = con.execute("SELECT * FROM leases WHERE id=?", (lease_id,)).fetchone()
    return bool(l and l["status"] == "ACTIVE" and l["expires_at"] >= now())


# ── recorded model calls ─────────────────────────────────────────────
def invoke(con, provider, principal_id, system, prompt, lease_id=None, task_id=None,
           model=None, max_tokens=800):
    """Every model call is recorded BEFORE it is made and updated after.

    A crash mid-call leaves a STARTED row, which is the truth, not a gap.
    """
    if store.paused(con):
        return provider.__class__ and _refused(con, principal_id, provider, model,
                                               lease_id, task_id, prompt, "owner PAUSE_ALL")
    if lease_id is not None and not lease_valid(con, lease_id):
        return _refused(con, principal_id, provider, model, lease_id, task_id, prompt,
                        "lease expired or invalid")

    if not provider.available():
        res = provider.complete(system, prompt, model=model, max_tokens=max_tokens)
        rid = con.execute(
            "INSERT INTO runs(principal_id,task_id,lease_id,source,provider,model,prompt_sha,"
            "status,started_at,finished_at,error) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (principal_id, task_id, lease_id, provider.source, provider.name,
             model or getattr(provider, "model", "-"), sha(prompt), res.status,
             now(), now(), res.error)).lastrowid
        store.event(con, "RUN_NOT_CONFIGURED", actor=principal_id, subject="run:%d" % rid,
                    payload={"why": res.error})
        return rid, res

    rid = con.execute(
        "INSERT INTO runs(principal_id,task_id,lease_id,source,provider,model,prompt_sha,"
        "status,started_at) VALUES(?,?,?,?,?,?,?,'STARTED',?)",
        (principal_id, task_id, lease_id, provider.source, provider.name,
         model or getattr(provider, "model", "-"), sha(system + "\x00" + prompt), now())).lastrowid

    res = provider.complete(system, prompt, model=model, max_tokens=max_tokens)
    con.execute(
        "UPDATE runs SET status=?,tokens_in=?,tokens_out=?,usd=?,latency_ms=?,error=?,"
        "finished_at=?, model=? WHERE id=?",
        (res.status, res.tokens_in, res.tokens_out, res.usd, res.latency_ms, res.error,
         now(), res.model, rid))
    store.event(con, "MODEL_RUN", actor=principal_id, subject="run:%d" % rid,
                payload={"status": res.status, "source": res.source, "usd": res.usd})
    return rid, res


def _refused(con, principal_id, provider, model, lease_id, task_id, prompt, why):
    rid = con.execute(
        "INSERT INTO runs(principal_id,task_id,lease_id,source,provider,model,prompt_sha,"
        "status,started_at,finished_at,error) VALUES(?,?,?,?,?,?,?,'REFUSED',?,?,?)",
        (principal_id, task_id, lease_id, provider.source, provider.name,
         model or "-", sha(prompt), now(), now(), why)).lastrowid
    store.event(con, "RUN_REFUSED", actor=principal_id, subject="run:%d" % rid,
                payload={"why": why})
    from .provider import Result
    return rid, Result("REFUSED", provider.source, provider.name, model or "-", error=why)


# ── tool gateway: the only holder of credentials ─────────────────────
class Gateway:
    """Agents receive capability handles, never secrets.

    Deny by default. Every call and every denial is recorded. PAUSE_ALL is
    enforced here as well as in the scheduler, so it is a switch and not a
    request an agent can decline.
    """

    def __init__(self, con, tools=None):
        self.con = con
        self._tools = tools or {}          # cap -> callable(**args)

    def register(self, cap, fn):
        self._tools[cap] = fn

    def call(self, principal_id, cap, lease_id=None, **args):
        con = self.con
        args_sha = sha(args)

        def log(decision, reason=None, result_sha=None):
            con.execute(
                "INSERT INTO tool_calls(lease_id,principal_id,tool,cap,args_sha,decision,"
                "reason,result_sha,at) VALUES(?,?,?,?,?,?,?,?,?)",
                (lease_id, principal_id, cap.split(":")[0], cap, args_sha, decision,
                 reason, result_sha, now()))
            if decision != "ALLOW":
                store.event(con, "TOOL_DENIED", actor=principal_id, subject=cap,
                            payload={"reason": reason})

        if store.paused(con):
            log("PAUSED", "owner PAUSE_ALL")
            raise Denied("PAUSE_ALL is active")
        if lease_id is not None and not lease_valid(con, lease_id):
            log("NO_LEASE", "lease expired or invalid")
            raise Denied("no valid lease")
        p = con.execute("SELECT * FROM principals WHERE id=?", (principal_id,)).fetchone()
        if p is None:
            log("DENY", "unknown principal")
            raise Denied("unknown principal")
        if cap not in _caps(p):
            log("DENY", "capability not granted: %s" % cap)
            raise Denied("capability not granted: %s" % cap)
        if cap not in self._tools:
            log("DENY", "no tool bound to capability")
            raise Denied("no tool bound to %s" % cap)

        out = self._tools[cap](**args)
        log("ALLOW", result_sha=sha(str(out)))
        store.event(con, "TOOL_CALL", actor=principal_id, subject=cap)
        return out
