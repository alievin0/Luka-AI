"""OWNER POLICY, BUDGETS AND LOOP LIMITS — the deterministic gate.

Nothing in this module calls a model, and no model output reaches it as an
instruction. That is the whole design: in an autonomous world the question
"is this allowed?" must be answerable by code the Owner can read, at a moment
when the Owner is asleep. A policy that a model can reason its way around is
not a policy.

Three classes and no fourth:

    AUTO_ALLOWED        the world may do this on its own
    APPROVAL_REQUIRED   the world may PROPOSE it and must then stop
    FORBIDDEN           the world may not do it, propose it, or route around it

Absence is not permission. An action with no policy row is APPROVAL_REQUIRED,
because the safe reading of "nobody decided" is "nobody decided".
"""
import json

from . import store
from .store import now

OWNER = "OWNER_PLANE"

AUTO, APPROVE, FORBID = "AUTO_ALLOWED", "APPROVAL_REQUIRED", "FORBIDDEN"


class PolicyError(RuntimeError):
    """The control plane refused. Not an error the agent can handle away."""


class BudgetError(RuntimeError):
    """A bounded resource ran out. STOP / WAIT / ESCALATE — never continue."""


# The Owner's standing decisions. Seeded once; editable only by the owner plane
# (LAW 24). The thresholds are in USD and apply to the action's own cost.
DEFAULT_POLICY = [
    # — the world may get on with its own internal work —
    ("research.internal",        AUTO,    None,  "reading the repo it already may read"),
    ("artifact.draft",           AUTO,    None,  "a draft is not a publication"),
    ("review.internal",          AUTO,    None,  "review is how the world checks itself"),
    ("task.delegate",            AUTO,    None,  "delegation inside the declared team"),
    ("task.create",              AUTO,    None,  "within the chain's task ceiling"),
    ("analysis.internal",        AUTO,    None,  "thinking about what it already holds"),
    ("opportunity.propose",      AUTO,    None,  "proposing is not deciding"),
    ("memory.write.candidate",   AUTO,    None,  "a candidate is not organisational truth"),
    ("project.create",           AUTO,    0.50,  "small internal projects only"),
    ("model.call",               AUTO,    0.05,  "one bounded turn"),
    # — the Owner decides these, every time —
    ("opportunity.approve",      APPROVE, None,  "turning a guess into committed work"),
    ("spend.above_threshold",    APPROVE, None,  "money is the Owner's"),
    ("publish.external",         APPROVE, None,  "the outside world does not un-see things"),
    ("contact.customer",         APPROVE, None,  "a person is on the other end"),
    ("deploy.production",        APPROVE, None,  "production is not a draft"),
    ("account.external",         APPROVE, None,  "external accounts act in the Owner's name"),
    ("skill.activate",           APPROVE, None,  "a new capability is a new way to be wrong"),
    ("memory.promote",           APPROVE, None,  "organisational truth needs a decision"),
    ("agent.create",             APPROVE, None,  "five is the declared crew"),
    # — never, by any route, for any reason —
    ("credential.read",          FORBID,  None,  "the gateway holds credentials; agents hold handles"),
    ("security.bypass",          FORBID,  None,  "there is no legitimate reason to want this"),
    ("access.unauthorized",      FORBID,  None,  "the grant is the boundary"),
    ("operation.destructive",    FORBID,  None,  "no autonomous deletion of anything"),
    ("policy.modify",            FORBID,  None,  "an agent that edits policy has no policy"),
    ("budget.raise",             FORBID,  None,  "a world cannot vote itself more money"),
    ("network.unrestricted",     FORBID,  None,  "not granted, and not grantable from here"),
    ("finance.authority",        FORBID,  None,  "no autonomous financial or legal authority"),
]

DEFAULT_BUDGETS = [
    ("world", "WORLD", 5.00, 2_000_000),
    ("day",   "TODAY", 1.00,   400_000),
]


def seed(con, by=OWNER):
    """Write the Owner's standing decisions, once. Idempotent."""
    for action, klass, thr, why in DEFAULT_POLICY:
        if con.execute("SELECT 1 FROM policies WHERE action=?", (action,)).fetchone():
            continue
        con.execute("INSERT INTO policies(action,klass,threshold_usd,why,set_by,at) "
                    "VALUES(?,?,?,?,?,?)", (action, klass, thr, why, by, now()))
    for scope, sid, usd, tok in DEFAULT_BUDGETS:
        if con.execute("SELECT 1 FROM budgets WHERE scope=? AND scope_id=?",
                       (scope, sid)).fetchone():
            continue
        con.execute("INSERT INTO budgets(scope,scope_id,limit_usd,limit_tokens,at) "
                    "VALUES(?,?,?,?,?)", (scope, sid, usd, tok, now()))
    store.event(con, "POLICY_SEEDED", actor=by, subject="policies",
                payload={"actions": len(DEFAULT_POLICY)})
    return True


def classify(con, action, usd=0.0):
    """What class does this action fall into, at this cost?

    An AUTO_ALLOWED action with a threshold is auto-allowed only BELOW it; above
    it the Owner decides. That is the whole of "spending above threshold
    requires approval" — expressed once, not sprinkled through call sites."""
    row = con.execute("SELECT * FROM policies WHERE action=?", (action,)).fetchone()
    if row is None:
        # Absence is not permission.
        return APPROVE, "no policy declared for %r" % action
    if row["klass"] == FORBID:
        return FORBID, row["why"]
    if row["klass"] == AUTO and row["threshold_usd"] is not None \
            and usd > row["threshold_usd"] + 1e-9:
        return APPROVE, ("$%.4f exceeds the $%.2f auto threshold"
                         % (usd, row["threshold_usd"]))
    return row["klass"], row["why"]


def decide(con, action, actor, usd=0.0, subject=None, chain_id=None):
    """Classify, RECORD, and return. Every gate decision leaves a row.

    The record is the point. An autonomous world that cannot show why it did
    something is indistinguishable from one that did it for no reason."""
    klass, why = classify(con, action, usd)
    allowed = 1 if klass == AUTO else 0
    con.execute("INSERT INTO policy_decisions(at,action,actor,klass,usd,allowed,why,"
                "subject,chain_id) VALUES(?,?,?,?,?,?,?,?,?)",
                (now(), action, actor, klass, usd, allowed, why, subject, chain_id))
    return {"action": action, "klass": klass, "allowed": bool(allowed), "why": why}


def require(con, action, actor, usd=0.0, subject=None, chain_id=None):
    """decide(), but raise unless it came back AUTO_ALLOWED.

    Call sites that must not proceed use this. A FORBIDDEN action raises the
    same way an APPROVAL_REQUIRED one does, because from the agent's side there
    is no difference: it is not happening."""
    d = decide(con, action, actor, usd, subject, chain_id)
    if not d["allowed"]:
        raise PolicyError("%s: %s (%s)" % (action, d["klass"], d["why"]))
    return d


def propose(con, action, actor, question, why, project_id=None, usd=0.0,
            evidence_id=None, chain_id=None):
    """The APPROVAL_REQUIRED path: record the ask and STOP.

    This is what "the world may propose but not decide" looks like in code. It
    returns an approval id and does nothing else — deliberately. Nothing
    downstream of this runs until a human writes a decision into that row."""
    d = decide(con, action, actor, usd, subject=question, chain_id=chain_id)
    if d["klass"] == FORBID:
        raise PolicyError("%s is FORBIDDEN: %s" % (action, d["why"]))
    aid = con.execute(
        "INSERT INTO approvals(at,question,why,options,evidence_id,project_id) "
        "VALUES(?,?,?,?,?,?)",
        (now(), question, why, json.dumps(["APPROVE", "REJECT", "NEED_EVIDENCE"]),
         evidence_id, project_id)).lastrowid
    store.signal(con, "HIGH", question, why, project_id=project_id)
    store.event(con, "APPROVAL_REQUESTED", actor=actor, subject="approval:%d" % aid,
                payload={"action": action, "usd": usd, "why": why})
    return aid


# ── budgets ──────────────────────────────────────────────────────────
def open_budget(con, scope, scope_id, limit_usd, limit_tokens=0):
    con.execute("INSERT OR IGNORE INTO budgets(scope,scope_id,limit_usd,limit_tokens,at) "
                "VALUES(?,?,?,?,?)", (scope, scope_id, limit_usd, limit_tokens, now()))
    return con.execute("SELECT * FROM budgets WHERE scope=? AND scope_id=?",
                       (scope, scope_id)).fetchone()


def remaining(con, scope, scope_id):
    r = con.execute("SELECT * FROM budgets WHERE scope=? AND scope_id=?",
                    (scope, scope_id)).fetchone()
    if r is None:
        return 0.0          # no budget row means no budget, not infinite budget
    return max(0.0, r["limit_usd"] - r["spent_usd"])


def affordable(con, scopes, usd):
    """Could every one of these scopes carry this cost? Checked BEFORE spending.

    All of them, not any of them: a task inside a project inside a world is
    bounded three times over, and the tightest bound wins."""
    for scope, sid in scopes:
        r = con.execute("SELECT * FROM budgets WHERE scope=? AND scope_id=?",
                        (scope, sid)).fetchone()
        if r is None:
            return False, "%s:%s has no budget" % (scope, sid)
        if r["state"] != "OPEN":
            return False, "%s:%s is %s" % (scope, sid, r["state"])
        if r["spent_usd"] + usd > r["limit_usd"] + 1e-9:
            return False, ("%s:%s would reach $%.5f of $%.2f"
                           % (scope, sid, r["spent_usd"] + usd, r["limit_usd"]))
    return True, ""


def charge(con, scopes, usd, tokens=0, why=""):
    """Spend against every scope at once, or spend against none of them.

    Partial charging is how a ledger stops adding up. LAW 23 backstops this in
    SQL: even a caller that skips `affordable` cannot push a scope past its
    limit, because the UPDATE itself is refused."""
    ok, reason = affordable(con, scopes, usd)
    if not ok:
        raise BudgetError(reason)
    for scope, sid in scopes:
        con.execute("UPDATE budgets SET spent_usd=spent_usd+?, spent_tokens=spent_tokens+? "
                    "WHERE scope=? AND scope_id=?", (usd, tokens, scope, sid))
        r = con.execute("SELECT * FROM budgets WHERE scope=? AND scope_id=?",
                        (scope, sid)).fetchone()
        if r["spent_usd"] >= r["limit_usd"] - 1e-9:
            con.execute("UPDATE budgets SET state='EXHAUSTED' WHERE scope=? AND scope_id=?",
                        (scope, sid))
            store.event(con, "BUDGET_EXHAUSTED", actor=OWNER,
                        subject="%s:%s" % (scope, sid),
                        payload={"limit_usd": r["limit_usd"], "spent_usd": r["spent_usd"]})
    if usd or tokens:
        store.event(con, "BUDGET_CHARGED", actor=OWNER,
                    subject=",".join("%s:%s" % s for s in scopes),
                    payload={"usd": usd, "tokens": tokens, "why": why})
    return True


# ── autonomous chains ────────────────────────────────────────────────
def open_chain(con, origin, objective="", **ceilings):
    """Start a bounded cascade. Ceilings are declared here and nowhere else."""
    # `depth` is CHAIN LENGTH IN HOPS, not recursion depth: a linear pipeline of
    # research → verify → review → accept → build → verify → review → accept is
    # already a dozen hops with no fan-out at all. The ceiling that actually
    # catches runaway self-replication is max_tasks and max_events; depth is the
    # backstop for a cycle that emits forever without creating anything.
    c = dict(max_depth=40, max_events=200, max_tasks=24, max_usd=1.0, max_seconds=900)
    c.update({k: v for k, v in ceilings.items() if k in c})
    cid = con.execute(
        "INSERT INTO chains(at,origin,objective,max_depth,max_events,max_tasks,"
        "max_usd,max_seconds) VALUES(?,?,?,?,?,?,?,?)",
        (now(), origin, objective, c["max_depth"], c["max_events"], c["max_tasks"],
         c["max_usd"], c["max_seconds"])).lastrowid
    open_budget(con, "chain", str(cid), c["max_usd"])
    store.event(con, "CHAIN_OPENED", actor=OWNER, subject="chain:%d" % cid,
                payload=dict(objective=objective, **c))
    return cid


def chain_room(con, chain_id, depth=0, tasks=0, usd=0.0):
    """Is there room in this chain for one more step? Checked before, not after.

    Every ceiling answers the same way — the chain HALTS and says which ceiling
    it hit. A world that hits a limit and keeps going has no limit."""
    if chain_id is None:
        return True, ""
    c = con.execute("SELECT * FROM chains WHERE id=?", (chain_id,)).fetchone()
    if c is None:
        return False, "no such chain"
    if c["state"] != "RUNNING":
        return False, "chain is %s: %s" % (c["state"], c["stop_reason"])
    for got, cap, name in ((max(depth, c["depth_reached"]), c["max_depth"], "depth"),
                           (c["events_emitted"] + 1, c["max_events"], "events"),
                           (c["tasks_created"] + tasks, c["max_tasks"], "tasks"),
                           (c["usd_spent"] + usd, c["max_usd"], "usd")):
        if got > cap + 1e-9:
            return False, "chain ceiling reached: %s %s > %s" % (name, got, cap)
    return True, ""


def halt_chain(con, chain_id, reason, state="HALTED"):
    if chain_id is None:
        return
    con.execute("UPDATE chains SET state=?, stop_reason=?, finished_at=? WHERE id=?",
                (state, reason, now(), chain_id))
    store.event(con, "CHAIN_HALTED", actor=OWNER, subject="chain:%d" % chain_id,
                payload={"state": state, "reason": reason})
    store.signal(con, "HIGH", "Further autonomous work requires Owner approval",
                 "chain #%d stopped: %s" % (chain_id, reason))


def note_chain(con, chain_id, depth=None, events=0, tasks=0, usd=0.0):
    """Record what a chain consumed. Refused by LAW 22 if it would pass a cap."""
    if chain_id is None:
        return
    c = con.execute("SELECT * FROM chains WHERE id=?", (chain_id,)).fetchone()
    if c is None or c["state"] != "RUNNING":
        return
    con.execute("UPDATE chains SET depth_reached=?, events_emitted=events_emitted+?, "
                "tasks_created=tasks_created+?, usd_spent=usd_spent+? WHERE id=?",
                (max(c["depth_reached"], depth or 0), events, tasks, usd, chain_id))
