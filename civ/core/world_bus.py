"""THE EVENT BUS — how an agent wakes.

Agents are not processes. There is no loop with five threads in it waiting for
something to do; there are five persistent IDENTITIES and a queue. An event puts
work on the queue, a worker claims one item under a lease, the agent wakes for
exactly that work, and then it stops existing again.

    EVENT → QUEUE → LEASE → AGENT RUNTIME → WORK → EVENT

That shape is what makes 1,000 agents conceivable later and what makes 5 agents
honest now: nothing is "running" that is not doing something.

Delivered twice is done once. `dedupe_key` is a UNIQUE column, not a check —
because a duplicate-suppression rule that lives in Python is a rule that stops
holding the moment two workers race.
"""
import json

from . import store, world_policy as POL
from .store import now, sha

OWNER = POL.OWNER

# What can wake an agent. Nothing else is a valid queue kind — an unknown kind
# is refused at the boundary rather than dispatched to a handler that shrugs.
KINDS = (
    "OWNER_OBJECTIVE",        # the Owner said what they want
    "DISCOVERY_MADE",         # something was noticed
    "OPPORTUNITY_PROPOSED",   # an agent thinks it is worth doing
    "OPPORTUNITY_APPROVED",   # the control plane agreed
    "PROJECT_OPENED",         # a project exists and needs a plan
    "TASK_READY",             # dependencies satisfied; someone can start
    "TASK_ASSIGNED",          # an agent has been given it
    "ARTIFACT_CREATED",       # something was produced and needs checking
    "VERIFICATION_DONE",      # deterministic checks have run
    "REVIEW_REQUESTED",       # an independent reviewer is needed
    "REVIEW_DONE",            # a verdict exists
    "TASK_ACCEPTED",          # work passed; dependents may become ready
    "TASK_FAILED",            # work did not pass
    "CORRECTION_NEEDED",      # a rejection produced a correction task
    "MESSAGE_SENT",           # an agent wrote to another
    "EVIDENCE_ADDED",         # the record grew
    "LEASE_EXPIRED",          # a worker died holding something
    "SKILL_GAP_FOUND",        # nobody can do what the project needs
    "HEARTBEAT",              # periodic reconciliation
)


class BusError(RuntimeError):
    pass


def _key(kind, subject, payload, chain_id):
    """The identity of a piece of work.

    Deliberately NOT the timestamp: two emissions of "review artifact #4" are
    the same work whenever they arrive. Chain id is included so the same event
    inside two different cascades stays two pieces of work."""
    return sha({"k": kind, "s": subject, "p": payload, "c": chain_id})[:40]


def emit(con, kind, subject=None, payload=None, by=OWNER, chain_id=None,
         depth=0, priority=5, max_attempts=3, available_at=None):
    """Put work on the queue. Returns (queue_id, created).

    `created` is False when this exact work was already queued — which is not an
    error and not a warning. It is the normal, expected outcome of a world that
    delivers the same event twice, and the caller carries on."""
    if kind not in KINDS:
        raise BusError("unknown event kind %r" % kind)
    payload = payload or {}
    ok, why = POL.chain_room(con, chain_id, depth=depth)
    if not ok:
        POL.halt_chain(con, chain_id, why)
        return None, False
    key = _key(kind, subject, payload, chain_id)
    row = con.execute("SELECT id FROM world_queue WHERE dedupe_key=?", (key,)).fetchone()
    if row:
        return row["id"], False
    ev = store.event(con, "QUEUED_" + kind, actor=by, subject=subject, payload=payload)
    qid = con.execute(
        "INSERT INTO world_queue(at,kind,subject,payload,dedupe_key,priority,"
        "available_at,max_attempts,chain_id,depth,emitted_by,event_id) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        (now(), kind, subject, json.dumps(payload, ensure_ascii=False), key, priority,
         available_at or now(), max_attempts, chain_id, depth, by,
         ev if isinstance(ev, int) else None)).lastrowid
    POL.note_chain(con, chain_id, depth=depth, events=1)
    return qid, True


def claim(con, worker, kinds=None, max_in_flight=3):
    """Take the next eligible item, or None. Bounded concurrency, enforced here.

    The claim is a single UPDATE guarded on `state='READY'`, so two workers
    racing for the same row produce one winner and one None — the same property
    a lease gives a task, applied to the queue itself."""
    in_flight = con.execute(
        "SELECT COUNT(*) c FROM world_queue WHERE state='CLAIMED'").fetchone()["c"]
    if in_flight >= max_in_flight:
        return None
    q = ("SELECT * FROM world_queue WHERE state='READY' AND available_at<=? "
         + ("AND kind IN (%s) " % ",".join("?" * len(kinds)) if kinds else "")
         + "ORDER BY priority DESC, id LIMIT 1")
    args = [now()] + (list(kinds) if kinds else [])
    row = con.execute(q, args).fetchone()
    if row is None:
        return None
    n = con.execute("UPDATE world_queue SET state='CLAIMED', worker=?, claimed_at=?, "
                    "attempts=attempts+1 WHERE id=? AND state='READY'",
                    (worker, now(), row["id"])).rowcount
    if not n:
        return None                      # someone else took it; that is fine
    got = con.execute("SELECT * FROM world_queue WHERE id=?", (row["id"],)).fetchone()
    return dict(got, payload=json.loads(got["payload"] or "{}"))


def ack(con, qid, result=None):
    con.execute("UPDATE world_queue SET state='DONE', finished_at=?, result=? WHERE id=?",
                (now(), json.dumps(result or {}, ensure_ascii=False)[:4000], qid))


def nack(con, qid, why, retry_in_seconds=0):
    """Hand work back. It retries until max_attempts, then FAILS and escalates.

    'Retry forever' is the failure mode that turns a bad tool call into an
    unbounded loop, so the attempt ceiling is a column on the row and the
    escalation is a signal the Owner will see."""
    row = con.execute("SELECT * FROM world_queue WHERE id=?", (qid,)).fetchone()
    if row is None:
        return
    if row["attempts"] >= row["max_attempts"]:
        con.execute("UPDATE world_queue SET state='FAILED', finished_at=?, result=? "
                    "WHERE id=?", (now(), json.dumps({"why": why})[:4000], qid))
        store.event(con, "WORK_ABANDONED", actor=OWNER, subject="queue:%d" % qid,
                    payload={"kind": row["kind"], "attempts": row["attempts"], "why": why})
        store.signal(con, "HIGH", "Autonomous work gave up after %d attempts"
                     % row["attempts"], "%s: %s" % (row["kind"], why))
        return
    when = now() if not retry_in_seconds else _plus(retry_in_seconds)
    con.execute("UPDATE world_queue SET state='READY', worker=NULL, claimed_at=NULL, "
                "available_at=?, result=? WHERE id=?",
                (when, json.dumps({"why": why})[:4000], qid))


def defer(con, qid, why):
    """Not now, and not an error: a dependency is unmet or a budget is spent."""
    con.execute("UPDATE world_queue SET state='DEFERRED', finished_at=?, result=? "
                "WHERE id=?", (now(), json.dumps({"why": why})[:4000], qid))


def drop(con, qid, why):
    """Nothing to do — the state it refers to already moved on."""
    con.execute("UPDATE world_queue SET state='DROPPED', finished_at=?, result=? "
                "WHERE id=?", (now(), json.dumps({"why": why})[:4000], qid))


def _plus(seconds):
    import datetime
    return (datetime.datetime.now(datetime.timezone.utc)
            + datetime.timedelta(seconds=seconds)).isoformat()


def recover_stuck(con, older_than_seconds=300, worker=None):
    """Return work claimed by a worker that never came back.

    This is the queue's half of crash recovery: a process that dies mid-item
    leaves a CLAIMED row with nobody behind it, and the world must be able to
    pick it up without the Owner noticing anything happened."""
    import datetime
    cutoff = (datetime.datetime.now(datetime.timezone.utc)
              - datetime.timedelta(seconds=older_than_seconds)).isoformat()
    q = "SELECT * FROM world_queue WHERE state='CLAIMED' AND claimed_at < ?"
    args = [cutoff]
    if worker:
        q += " AND worker=?"
        args.append(worker)
    freed = []
    for row in con.execute(q, args).fetchall():
        con.execute("UPDATE world_queue SET state='READY', worker=NULL, claimed_at=NULL "
                    "WHERE id=? AND state='CLAIMED'", (row["id"],))
        freed.append(row["id"])
        store.event(con, "WORK_RECOVERED", actor=OWNER, subject="queue:%d" % row["id"],
                    payload={"kind": row["kind"], "was": row["worker"]})
    return freed


def depth(con):
    """How much work is outstanding, by state. The world's pulse."""
    out = {s: 0 for s in ("READY", "CLAIMED", "DONE", "FAILED", "DEFERRED", "DROPPED")}
    for r in con.execute("SELECT state, COUNT(*) c FROM world_queue GROUP BY state"):
        out[r["state"]] = r["c"]
    return out


def quiet(con):
    """True when nothing is queued and nothing is in flight.

    This is the only definition of 'the world is idle' the UI is allowed to use:
    it is a COUNT over rows, not an impression."""
    d = depth(con)
    return d["READY"] == 0 and d["CLAIMED"] == 0
