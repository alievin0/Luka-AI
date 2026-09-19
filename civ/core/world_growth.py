"""THE WORLD BUILDS ITSELF — through a pipeline it is not allowed to skip.

The ten districts were a seed. When the work stops fitting in the space, the
organisation is meant to notice and build more — and *that* is the dangerous
sentence, because an agent that can create geometry can create a thousand
buildings from one bad loop, and a model that can authorise its own construction
has left the control plane entirely.

So growth is a pipeline, and every stage is a row somebody else can check:

    OBSERVE   capacity pressure measured from rows, not felt
      ↓
    PROPOSE   a cause, and the numbers behind it
      ↓
    DESIGN    an artifact with coordinates, capacity, cost and a hash
      ↓
    VALIDATE  geometry, resources, policy, security — each recorded separately
      ↓
    AUTHORISE by policy where the impact is small, by the Owner where it is not.
              ABSENCE OF POLICY IS NOT PERMISSION.
      ↓
    CONSTRUCT the World Kernel commits the rows; nothing else may
      ↓
    ACTIVATE  it opens, agents may enter, tasks may be assigned there
      ↓
    OBSERVE   was it used? measured afterwards, from rows

**No model output reaches any of this.** Every function here takes structured
arguments from the control plane. The agent runtime has no verb that proposes,
designs, authorises or constructs, and a test asserts it cannot reach this
module at all. An agent *causes* growth the way it causes anything else: by
doing work that leaves evidence somebody else measures.
"""
import json
import math

from . import store, world_policy as POL, world_space as SPACE
from .store import now, sha

OWNER = "OWNER_PLANE"

# What impact means, and therefore who may say yes. Configurable, and the
# default for anything not named here is the strictest reading there is.
IMPACT = {"workspace": "LOW", "facility": "MEDIUM", "district": "HIGH",
          "type": "HIGH"}
AUTONOMOUS_BELOW = 1.0        # resource units a policy may approve unattended


class GrowthError(RuntimeError):
    """A growth step the world refuses. A decision, never a crash."""


# ── the world's means ────────────────────────────────────────────────
def seed_resources(con, **overrides):
    """Bounded from the start. A world with unlimited resources cannot tell
    growth from a runaway loop, because both look like more buildings."""
    base = {"space": ("Buildable ground", 400.0, "units", 3, 3600),
            "construction": ("Construction capacity", 24.0, "builds", 3, 3600),
            "budget": ("Construction budget", 50.0, "resource units", 3, 3600)}
    base.update(overrides)
    for rid, (label, total, unit, per_window, window) in base.items():
        if not con.execute("SELECT 1 FROM world_resources WHERE id=?", (rid,)).fetchone():
            con.execute("INSERT INTO world_resources(id,label,total,unit,per_window,"
                        "window_secs,updated_at) VALUES(?,?,?,?,?,?,?)",
                        (rid, label, total, unit, per_window, window, now()))
    return resources(con)


def resources(con):
    return {r["id"]: dict(r) for r in con.execute("SELECT * FROM world_resources")}


def _spend(con, rid, amount, why):
    r = con.execute("SELECT * FROM world_resources WHERE id=?", (rid,)).fetchone()
    if r is None:
        raise GrowthError("no such world resource: %r" % rid)
    if r["spent"] + amount > r["total"]:
        raise GrowthError("%s exhausted: %.2f of %.2f spent, %.2f more requested"
                          % (rid, r["spent"], r["total"], amount))
    con.execute("UPDATE world_resources SET spent=spent+?, updated_at=? WHERE id=?",
                (amount, now(), rid))
    store.event(con, "WORLD_RESOURCE_SPENT", actor=OWNER, subject="resource:%s" % rid,
                payload={"amount": amount, "why": why})


def rate_ok(con, rid="construction"):
    """Has the world built too much, too fast? A cap on total is not enough: a
    loop that spends the whole budget in one tick has still escaped."""
    r = con.execute("SELECT * FROM world_resources WHERE id=?", (rid,)).fetchone()
    if r is None:
        return True, ""
    # The cutoff must be in the SAME format `built_at` is written in. Comparing
    # an ISO-8601 timestamp against sqlite's `datetime()` output compares 'T'
    # with ' ', so every row sorted as "recent" whatever its age — conservative
    # here, but wrong, and wrong in a way that would flip once the date rolled.
    import datetime as _dt
    cut = (_dt.datetime.now(_dt.timezone.utc)
           - _dt.timedelta(seconds=r["window_secs"])).isoformat(timespec="microseconds")
    n = con.execute("SELECT COUNT(*) c FROM constructions WHERE built_at > ?",
                    (cut,)).fetchone()["c"]
    if n >= r["per_window"]:
        return False, ("%d constructions in the last %ds; the limit is %d"
                       % (n, r["window_secs"], r["per_window"]))
    return True, ""


# ── what kinds of place may exist ────────────────────────────────────
def register_type(con, tid, label, kind, by, capability="", archetype="block",
                  w=8.0, h=8.0, z=3.0, workspaces=1, equipment=(), cost=1.0,
                  access="OPEN", approved_by=None, notes=""):
    """Register an archetype. The renderer draws from these, so a type invented
    later draws without anybody touching the renderer.

    A NEW type is a new kind of thing the world can contain, which is an
    owner-plane decision — `approved_by` is checked by the caller's policy gate,
    not assumed here."""
    if con.execute("SELECT 1 FROM facility_types WHERE id=?", (tid,)).fetchone():
        return tid
    con.execute(
        "INSERT INTO facility_types(id,label,kind,capability,archetype,default_w,"
        "default_h,default_z,workspaces,equipment,cost,access,registered_by,"
        "registered_at,approved_by,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (tid, label, kind, capability, archetype, float(w), float(h), float(z),
         int(workspaces), json.dumps(list(equipment)), float(cost), access,
         by, now(), approved_by, notes))
    store.event(con, "FACILITY_TYPE_REGISTERED", actor=by, subject="type:%s" % tid,
                payload={"label": label, "kind": kind, "capability": capability})
    return tid


def seed_types(con, by=OWNER):
    """The archetypes the seed world already contains, written down so the
    renderer and the builder read the same list."""
    for t in (
        ("research_lab", "Research Lab", "facility", "research", "lab",
         12, 12, 3.4, 2, ["reading bench", "evidence shelf", "wall screen"], 3.0),
        ("build_lab", "Build Lab", "facility", "build", "factory",
         12, 14, 4.0, 4, ["assembly cell", "parts rack", "gantry"], 4.0),
        ("review_center", "Review Center", "facility", "review", "chamber",
         12, 10, 3.2, 2, ["inspection bench", "verdict board"], 3.0),
        ("operations_center", "Operations Center", "facility", "execute", "pad",
         12, 10, 2.6, 2, ["console ring", "containment frame"], 3.0),
        ("archive", "Archive", "facility", "archive", "stacks",
         14, 6, 2.0, 1, ["stack", "index desk"], 2.0),
        ("workspace", "Workspace", "workspace", "", "room",
         5, 5, 0.6, 0, ["desk", "screen"], 0.5),
        ("district", "District", "district", "", "ground",
         24, 22, 0.2, 0, [], 6.0),
        ("hub_block", "Coordination Block", "facility", "coordinate", "hub",
         8, 16, 3.0, 1, ["dispatch table", "wall board", "queue display"], 3.0),
        ("vault", "Vault", "facility", "evidence", "vault",
         9, 5, 2.4, 1, ["shelf", "index desk"], 2.0),
    ):
        register_type(con, t[0], t[1], t[2], by, capability=t[3], archetype=t[4],
                      w=t[5], h=t[6], z=t[7], workspaces=t[8], equipment=t[9],
                      cost=t[10], approved_by=by, notes="seed archetype")
    return [r["id"] for r in con.execute("SELECT id FROM facility_types ORDER BY id")]


def types(con):
    return {r["id"]: dict(r, equipment=json.loads(r["equipment"] or "[]"))
            for r in con.execute("SELECT * FROM facility_types")}


# ── 1. OBSERVE: where the work does not fit ──────────────────────────
def observe_pressure(con):
    """Measure capacity pressure from rows. Returns a list of findings.

    Every number here is a COUNT or a ratio over persisted state. Nothing is
    inferred from how busy the world feels, because a world cannot feel."""
    out = []
    for ws in con.execute("SELECT * FROM world_places WHERE kind='workspace' "
                          "AND status='ACTIVE'"):
        cap = ws["capacity"] or 1
        here = con.execute("SELECT COUNT(*) c FROM agent_locations WHERE workspace=?",
                           (ws["id"],)).fetchone()["c"]
        # Work that WANTS this workspace: tasks whose capability this room serves
        # and which are not finished. A queue is only a bottleneck if the work in
        # it is actually waiting on this room.
        waiting = 0
        if ws["capability"]:
            waiting = con.execute(
                "SELECT COUNT(*) c FROM tasks WHERE status IN "
                "('APPROVED','ASSIGNED','BLOCKED') AND required_caps LIKE ?",
                ('%"' + ws["capability"] + '"%',)).fetchone()["c"]
        refused = con.execute(
            "SELECT COUNT(*) c FROM movements WHERE phase='REFUSED' "
            "AND to_workspace=? AND why LIKE '%full%'", (ws["id"],)).fetchone()["c"]
        if waiting > cap or refused:
            out.append({
                "workspace": ws["id"], "label": ws["label"],
                "capability": ws["capability"], "capacity": cap,
                "occupants": here, "waiting": waiting, "turned_away": refused,
                "pressure": round((waiting + refused) / float(cap), 2),
                "parent": ws["parent_id"],
            })
    out.sort(key=lambda r: -r["pressure"])
    return out


def bottleneck(con, min_pressure=1.5):
    """The worst place, if any place is bad enough to be worth building for."""
    found = [f for f in observe_pressure(con) if f["pressure"] >= min_pressure]
    return found[0] if found else None


# ── 2. PROPOSE: a cause, and the numbers behind it ───────────────────
def propose(con, kind, label, cause, evidence, by, type_id=None, parent_id=None,
            project_id=None, chain_id=None):
    """An agent says the world is too small, and shows its working.

    Refuses a proposal with no evidence. 'The research queue feels long' is not
    a reason to spend the world's ground on a building."""
    if kind not in ("workspace", "facility", "district", "type"):
        raise GrowthError("no such expansion kind: %r" % kind)
    if not cause.strip():
        raise GrowthError("an expansion needs a stated cause")
    if not isinstance(evidence, dict) or not evidence:
        raise GrowthError("an expansion needs measured evidence, not an opinion")
    cur = con.execute(
        "INSERT INTO expansion_proposals(kind,type_id,parent_id,label,cause,evidence,"
        "proposed_by,project_id,chain_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        (kind, type_id, parent_id, label, cause,
         json.dumps(evidence, sort_keys=True), by, project_id, chain_id, now()))
    pid = cur.lastrowid
    store.event(con, "WORLD_EXPANSION_PROPOSED", actor=by,
                subject="expansion:%d" % pid,
                payload={"kind": kind, "label": label, "cause": cause,
                         "evidence": evidence})
    return pid


def fits_in(con, parent_id, w, h, kind):
    """Is there ground inside that parent for something this size?"""
    try:
        _free_ground(con, SPACE.place(con, parent_id) if parent_id else None,
                     w, h, kind)
        return True
    except GrowthError:
        return False


def scope_for(con, workspace_id):
    """How big the expansion has to be, decided by where ground actually exists.

    This is the multi-stage rule, and it is not a preference: a new seat goes in
    the room if the room has floor, a new room goes in the building if the
    building has floor, and a new building goes in the district. Proposing a
    workspace inside a facility that is physically full produces a design that
    validation would reject — so the scope is chosen by measuring, first."""
    room = SPACE.place(con, workspace_id)
    if room is None:
        raise GrowthError("no such workspace: %r" % workspace_id)
    fac = SPACE.place(con, room["parent_id"]) if room["parent_id"] else None
    dis = SPACE.place(con, fac["parent_id"]) if fac and fac["parent_id"] else None
    t_ws = con.execute("SELECT * FROM facility_types WHERE id='workspace'").fetchone()
    if fac is not None and t_ws and fits_in(con, fac["id"], t_ws["default_w"],
                                           t_ws["default_h"], "workspace"):
        return "workspace", "workspace", fac["id"]

    # The room is full. A new room needs a building — which one depends on what
    # the crowded room is FOR, so the archetype is chosen by capability.
    t_fac = con.execute(
        "SELECT * FROM facility_types WHERE kind='facility' AND capability=? LIMIT 1",
        (room["capability"] or "",)).fetchone()
    t_fac = t_fac or con.execute(
        "SELECT * FROM facility_types WHERE id='research_lab'").fetchone()
    if dis is not None and fits_in(con, dis["id"], t_fac["default_w"],
                                   t_fac["default_h"], "facility"):
        return "facility", t_fac["id"], dis["id"]

    # The home district is full. Reserved ground exists for exactly this: a
    # district the world laid out and deliberately left empty. Building there
    # before claiming new ground is the difference between a campus that was
    # planned and one that sprawls.
    for r in con.execute("SELECT * FROM world_places WHERE kind='district' "
                         "AND status='RESERVED' ORDER BY id"):
        if fits_in(con, r["id"], t_fac["default_w"], t_fac["default_h"], "facility"):
            return "facility", t_fac["id"], r["id"]

    # Nothing standing has room, and no ground was held back. A new district.
    return "district", "district", None


def propose_from_pressure(con, by, finding=None, min_pressure=1.5):
    """Turn a measured bottleneck into a proposal at the scope that can hold it.

    Returns None when the world is big enough, which is the common and correct
    answer — a world that always finds a reason to build is a world with a
    broken bottleneck detector, not an ambitious one."""
    f = finding or bottleneck(con, min_pressure)
    if f is None:
        return None
    kind, type_id, parent = scope_for(con, f["workspace"])
    t = con.execute("SELECT * FROM facility_types WHERE id=?", (type_id,)).fetchone()
    n = 1 + con.execute(
        "SELECT COUNT(*) c FROM world_places WHERE kind=? AND parent_id IS ?",
        (kind, parent)).fetchone()["c"]
    base = (t["label"] if kind != "workspace"
            else (SPACE.place(con, parent)["label"] if parent else "Workspace"))
    return propose(
        con, kind, "%s %02d" % (base, n),
        cause="%s is over capacity: %d waiting against %d seats%s"
              % (f["label"], f["waiting"], f["capacity"],
                 ", %d turned away" % f["turned_away"] if f["turned_away"] else ""),
        evidence=dict(f, scope=kind, chosen_because=(
            "the room has floor for another seat" if kind == "workspace"
            else "the room is full and the district has ground"
            if kind == "facility" else "nothing standing has room left")),
        by=by, type_id=type_id, parent_id=parent)


# ── 3. DESIGN: an artifact before it is a building ───────────────────
def design(con, proposal_id, by, x=None, y=None, w=None, h=None, capacity=None,
           equipment=None, place_id=None):
    """Produce the design. It is a row, a spec and a hash — checkable before
    anything is built, and frozen once it passes (LAW 40)."""
    p = con.execute("SELECT * FROM expansion_proposals WHERE id=?",
                    (proposal_id,)).fetchone()
    if p is None:
        raise GrowthError("no such proposal: %r" % proposal_id)
    if p["state"] != "PROPOSED":
        raise GrowthError("proposal %d is %s, not PROPOSED" % (proposal_id, p["state"]))
    t = con.execute("SELECT * FROM facility_types WHERE id=?",
                    (p["type_id"],)).fetchone()
    if t is None:
        raise GrowthError("proposal %d names no registered type" % proposal_id)

    w = float(w if w is not None else t["default_w"])
    h = float(h if h is not None else t["default_h"])
    parent = SPACE.place(con, p["parent_id"]) if p["parent_id"] else None
    if x is None or y is None:
        x, y = _free_ground(con, parent, w, h, t["kind"])
    pid = place_id or _next_place_id(con, p["type_id"], p["kind"])
    cap = int(capacity if capacity is not None
              else max(1, int(w * h / 8.0)) if t["kind"] == "workspace" else 0)
    equip = list(equipment if equipment is not None
                 else json.loads(t["equipment"] or "[]"))
    spec = {
        "place_id": pid, "kind": t["kind"], "type": t["id"], "label": p["label"],
        "parent": p["parent_id"], "x": round(x, 3), "y": round(y, 3),
        "w": w, "h": h, "z": t["default_z"], "capacity": cap,
        "capability": t["capability"], "archetype": t["archetype"],
        "access": t["access"], "equipment": equip, "cost": t["cost"],
        "proposal": proposal_id, "designed_by": by, "version": 1,
    }
    h_ = sha(spec)
    con.execute(
        "INSERT INTO facility_designs(proposal_id,place_id,spec,design_hash,x,y,w,h,z,"
        "capacity,cost,designed_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (proposal_id, pid, json.dumps(spec, sort_keys=True), h_, x, y, w, h,
         t["default_z"], cap, t["cost"], by, now()))
    did = con.execute("SELECT last_insert_rowid() r").fetchone()["r"]
    con.execute("UPDATE expansion_proposals SET state='DESIGNED' WHERE id=?",
                (proposal_id,))
    store.event(con, "WORLD_DESIGN_CREATED", actor=by, subject="design:%d" % did,
                payload={"proposal": proposal_id, "place": pid, "hash": h_[:16]})
    return did


def _next_place_id(con, type_id, kind):
    base = "ws" if kind == "workspace" else (type_id or kind)
    n = 1
    while con.execute("SELECT 1 FROM world_places WHERE id=?",
                      ("%s_%02d" % (base, n),)).fetchone():
        n += 1
    return "%s_%02d" % (base, n)


def _free_ground(con, parent, w, h, kind):
    """Find ground inside the parent that nothing else is standing on.

    Deterministic: scans on a fixed grid from the parent's origin and takes the
    first fit. LAW 37 refuses an overlap at the database, so this is the thing
    that stops a design being rejected rather than the thing that guarantees it."""
    if parent is None:
        # A new district goes on open ground east of everything built so far.
        far = con.execute("SELECT COALESCE(MAX(x + w), 0) m FROM world_places "
                          "WHERE kind='district'").fetchone()["m"]
        return far + 6.0, 6.0
    step = 1.0
    siblings = [dict(r) for r in con.execute(
        "SELECT * FROM world_places WHERE kind=? AND parent_id IS ? AND status<>'CLOSED'",
        (kind, parent["id"]))]
    gy = parent["y"] + 1.0
    while gy + h <= parent["y"] + parent["h"] - 0.5:
        gx = parent["x"] + 1.0
        while gx + w <= parent["x"] + parent["w"] - 0.5:
            if not any(gx < s["x"] + s["w"] and s["x"] < gx + w
                       and gy < s["y"] + s["h"] and s["y"] < gy + h
                       for s in siblings):
                return gx, gy
            gx += step
        gy += step
    raise GrowthError("no free ground inside %s for %.1f×%.1f" % (parent["id"], w, h))


# ── 4. VALIDATE: geometry, resources, policy, security ───────────────
def validate(con, design_id):
    """Every check, recorded separately, so a refusal names which one failed."""
    d = con.execute("SELECT * FROM facility_designs WHERE id=?", (design_id,)).fetchone()
    if d is None:
        raise GrowthError("no such design: %r" % design_id)
    spec = json.loads(d["spec"])
    p = con.execute("SELECT * FROM expansion_proposals WHERE id=?",
                    (d["proposal_id"],)).fetchone()
    checks = []

    def check(name, ok, detail=""):
        checks.append({"check": name, "passed": bool(ok), "detail": detail})
        return ok

    check("design_hash_matches_spec", sha(spec) == d["design_hash"],
          "the spec is the one that was hashed")
    check("type_is_registered",
          bool(con.execute("SELECT 1 FROM facility_types WHERE id=?",
                           (spec["type"],)).fetchone()), spec["type"])
    check("place_id_is_free",
          not con.execute("SELECT 1 FROM world_places WHERE id=?",
                          (spec["place_id"],)).fetchone(), spec["place_id"])
    parent = SPACE.place(con, spec["parent"]) if spec["parent"] else None
    if spec["kind"] != "district":
        check("parent_exists", parent is not None, str(spec["parent"]))
        if parent is not None:
            inside = (spec["x"] >= parent["x"] - 1e-6
                      and spec["y"] >= parent["y"] - 1e-6
                      and spec["x"] + spec["w"] <= parent["x"] + parent["w"] + 1e-6
                      and spec["y"] + spec["h"] <= parent["y"] + parent["h"] + 1e-6)
            check("inside_its_parent", inside,
                  "%s must contain the new %s" % (parent["id"], spec["kind"]))
    overlap = [r["id"] for r in con.execute(
        "SELECT id FROM world_places WHERE kind=? AND parent_id IS ? AND status<>'CLOSED' "
        "AND ? < x + w AND x < ? AND ? < y + h AND y < ?",
        (spec["kind"], spec["parent"], spec["x"], spec["x"] + spec["w"],
         spec["y"], spec["y"] + spec["h"]))]
    check("no_overlap", not overlap, ", ".join(overlap))
    check("positive_dimensions", spec["w"] > 0 and spec["h"] > 0,
          "%.2f×%.2f" % (spec["w"], spec["h"]))

    res = resources(con)
    budget = res.get("budget")
    check("budget_available",
          budget is not None and budget["spent"] + d["cost"] <= budget["total"],
          "%.2f of %.2f spent" % (budget["spent"], budget["total"]) if budget else "none")
    space = res.get("space")
    area = spec["w"] * spec["h"]
    check("ground_available",
          space is not None and space["spent"] + area <= space["total"],
          "%.1f units of ground" % area)
    ok_rate, why_rate = rate_ok(con)
    check("expansion_rate", ok_rate, why_rate)

    check("proposal_has_evidence", bool(json.loads(p["evidence"] or "{}")),
          "measured, not asserted")
    check("proposer_is_a_principal",
          bool(con.execute("SELECT 1 FROM principals WHERE id=?",
                           (p["proposed_by"],)).fetchone()), p["proposed_by"])
    # SECURITY: a design may not quietly widen what the world permits.
    check("grants_no_permissions", "permissions" not in spec and "grants" not in spec,
          "a building is not a permission")
    check("capability_is_registered_or_blank",
          not spec["capability"] or bool(con.execute(
              "SELECT 1 FROM facility_types WHERE capability=?",
              (spec["capability"],)).fetchone()), spec["capability"])

    passed = all(c["passed"] for c in checks)
    con.execute("UPDATE facility_designs SET validated=?, validation=? WHERE id=?",
                (1 if passed else 0, json.dumps(checks), design_id))
    con.execute("UPDATE expansion_proposals SET state=? WHERE id=?",
                ("VALIDATED" if passed else "REJECTED", d["proposal_id"]))
    store.event(con, "WORLD_DESIGN_VALIDATED" if passed else "WORLD_DESIGN_REJECTED",
                actor=OWNER, subject="design:%d" % design_id,
                payload={"passed": passed,
                         "failed": [c["check"] for c in checks if not c["passed"]]})
    return {"passed": passed, "checks": checks,
            "failed": [c for c in checks if not c["passed"]]}


# ── 5. AUTHORISE: policy where small, the Owner where not ────────────
def impact_of(con, proposal):
    return IMPACT.get(proposal["kind"], "HIGH")


def authorise(con, proposal_id, by=OWNER):
    """Decide who may say yes, and record that they did.

    ABSENCE OF POLICY IS NOT PERMISSION. A kind nobody wrote a rule for is
    HIGH impact and needs the Owner, because the alternative is a world that
    grants itself whatever nobody thought to forbid."""
    p = con.execute("SELECT * FROM expansion_proposals WHERE id=?",
                    (proposal_id,)).fetchone()
    if p is None:
        raise GrowthError("no such proposal: %r" % proposal_id)
    if p["state"] != "VALIDATED":
        raise GrowthError("proposal %d is %s, not VALIDATED" % (proposal_id, p["state"]))
    d = con.execute("SELECT * FROM facility_designs WHERE proposal_id=?",
                    (proposal_id,)).fetchone()
    impact = impact_of(con, p)
    small = impact == "LOW" and d and d["cost"] < AUTONOMOUS_BELOW

    if small:
        authority, who = "policy:autonomous_low_impact", OWNER
    else:
        if by != OWNER:
            raise GrowthError(
                "%s impact expansion needs the owner plane; %r is not it"
                % (impact, by))
        authority, who = "owner", OWNER
    con.execute("UPDATE expansion_proposals SET state='AUTHORISED', decided_by=?, "
                "decided_at=?, decision_why=? WHERE id=?",
                (who, now(), "%s impact, authorised by %s" % (impact, authority),
                 proposal_id))
    store.event(con, "WORLD_EXPANSION_AUTHORISED", actor=who,
                subject="expansion:%d" % proposal_id,
                payload={"impact": impact, "authority": authority})
    return {"authorised": True, "impact": impact, "authority": authority, "by": who}


def needs_owner(con, proposal_id):
    p = con.execute("SELECT * FROM expansion_proposals WHERE id=?",
                    (proposal_id,)).fetchone()
    d = con.execute("SELECT * FROM facility_designs WHERE proposal_id=?",
                    (proposal_id,)).fetchone()
    return not (impact_of(con, p) == "LOW" and d and d["cost"] < AUTONOMOUS_BELOW)


# ── 6. CONSTRUCT: the kernel commits, and nothing else may ───────────
def construct(con, proposal_id, by):
    """Commit the world objects. The ONLY function that writes new geometry.

    Everything it needs was decided upstream and is re-read from rows here, so a
    caller cannot pass in a cheaper cost or a different rectangle than the one
    that was validated."""
    p = con.execute("SELECT * FROM expansion_proposals WHERE id=?",
                    (proposal_id,)).fetchone()
    if p is None or p["state"] != "AUTHORISED":
        raise GrowthError("proposal %r is not authorised" % proposal_id)
    d = con.execute("SELECT * FROM facility_designs WHERE proposal_id=?",
                    (proposal_id,)).fetchone()
    if d is None or not d["validated"]:
        raise GrowthError("proposal %d has no validated design" % proposal_id)
    spec = json.loads(d["spec"])
    ok, why = rate_ok(con)
    if not ok:
        raise GrowthError("expansion rate: %s" % why)

    con.execute("UPDATE expansion_proposals SET state='UNDER_CONSTRUCTION' WHERE id=?",
                (proposal_id,))
    # One savepoint around the whole commit. Geometry without provenance is
    # worse than no geometry: a building nobody can explain is exactly what this
    # pipeline exists to make impossible, so either both rows land or neither.
    con.execute("SAVEPOINT world_construct")
    try:
        # The geometry first — `constructions.place_id` points at it, and LAW 37
        # refuses an overlap here even if validation somehow passed one, which is
        # the point of having both.
        con.execute(
            "INSERT INTO world_places(id,kind,parent_id,label,x,y,w,h,z,capacity,"
            "capability,access,station,status,about,type_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL,'ACTIVE',?,?)",
            (spec["place_id"], spec["kind"], spec["parent"], spec["label"],
             spec["x"], spec["y"], spec["w"], spec["h"], spec["z"], spec["capacity"],
             spec["capability"], spec["access"],
             "built because: " + (p["cause"] or "")[:200], spec["type"]))
        cur = con.execute(
            "INSERT INTO constructions(design_id,proposal_id,place_id,built_by,"
            "authorised_by,authority,cost,state,built_at) "
            "VALUES(?,?,?,?,?,?,?,'UNDER_CONSTRUCTION',?)",
            (d["id"], proposal_id, spec["place_id"], by, p["decided_by"] or OWNER,
             p["decision_why"] or "authorised", d["cost"], now()))
        cid = cur.lastrowid
        # A facility with no benches cannot be entered, so it is not a facility
        # yet — it is a shell. The type says how many workspaces belong in it,
        # and they are built with it rather than needing a second proposal to
        # make the first one usable.
        made = _fit_out(con, spec)
        _spend(con, "budget", d["cost"], "construction %d" % cid)
        _spend(con, "space", spec["w"] * spec["h"], "construction %d" % cid)
        _spend(con, "construction", 1.0, "construction %d" % cid)
    except Exception:
        con.execute("ROLLBACK TO world_construct")
        con.execute("RELEASE world_construct")
        con.execute("UPDATE expansion_proposals SET state='AUTHORISED' WHERE id=?",
                    (proposal_id,))
        raise
    con.execute("RELEASE world_construct")

    ev = store.event(con, "WORLD_CONSTRUCTED", actor=by,
                     subject="place:%s" % spec["place_id"],
                     payload={"proposal": proposal_id, "design": d["id"],
                              "kind": spec["kind"], "label": spec["label"],
                              "cost": d["cost"], "cause": p["cause"],
                              "workspaces": made})
    con.execute("UPDATE constructions SET state='READY', event_id=? WHERE id=?",
                (ev, cid))
    con.execute("UPDATE expansion_proposals SET state='CONSTRUCTED' WHERE id=?",
                (proposal_id,))
    return {"construction": cid, "place": spec["place_id"], "cost": d["cost"],
            "workspaces": made}


def _fit_out(con, spec):
    """Put the type's workspaces inside a newly built facility.

    Laid out on a grid inside the shell, each one inside its parent and clear of
    its siblings — the same two rules LAW 37 and validation enforce, applied at
    the moment of building rather than discovered afterwards."""
    if spec["kind"] != "facility":
        return []
    t = con.execute("SELECT * FROM facility_types WHERE id=?",
                    (spec["type"],)).fetchone()
    n = int(t["workspaces"]) if t else 0
    if n <= 0:
        return []
    cols = max(1, min(n, 2))
    rows = int(math.ceil(n / float(cols)))
    mw = (spec["w"] - 1.6) / cols
    mh = (spec["h"] - 1.6) / rows
    made = []
    for i in range(n):
        c, r = i % cols, i // cols
        wid = _next_place_id(con, "ws", "workspace")
        x = spec["x"] + 0.8 + c * mw
        y = spec["y"] + 0.8 + r * mh
        w, h = mw - 0.4, mh - 0.4
        con.execute(
            "INSERT INTO world_places(id,kind,parent_id,label,x,y,w,h,z,capacity,"
            "capability,access,station,status,about,type_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL,'ACTIVE',?,?)",
            (wid, "workspace", spec["place_id"],
             "%s %02d" % (t["label"].replace(" Lab", " Bench").replace(
                 " Center", " Desk") if t else "Bench", i + 1),
             x, y, w, h, 0.6, max(1, int(w * h / 8.0)), spec["capability"],
             spec["access"], "fitted out with %s" % spec["place_id"], "workspace"))
        made.append(wid)
    return made


def activate(con, construction_id, by=OWNER):
    """It opens. Agents may enter; tasks may be assigned here."""
    c = con.execute("SELECT * FROM constructions WHERE id=?",
                    (construction_id,)).fetchone()
    if c is None or c["state"] != "READY":
        raise GrowthError("construction %r is not READY" % construction_id)
    con.execute("UPDATE constructions SET state='ACTIVE', activated_at=? WHERE id=?",
                (now(), construction_id))
    con.execute("UPDATE expansion_proposals SET state='ACTIVE' WHERE id=?",
                (c["proposal_id"],))
    store.event(con, "WORLD_SPACE_OPENED", actor=by, subject="place:%s" % c["place_id"],
                payload={"construction": construction_id})
    return {"active": True, "place": c["place_id"]}


def retire(con, construction_id, why, by=OWNER):
    """A space stops being used. It is retired, never edited into something
    else — LAW 41 keeps the record of what was built true."""
    c = con.execute("SELECT * FROM constructions WHERE id=?",
                    (construction_id,)).fetchone()
    if c is None:
        raise GrowthError("no such construction: %r" % construction_id)
    if con.execute("SELECT COUNT(*) c FROM agent_locations WHERE workspace=?",
                   (c["place_id"],)).fetchone()["c"]:
        raise GrowthError("%s still has somebody standing in it" % c["place_id"])
    con.execute("UPDATE constructions SET state='RETIRED', retired_at=?, retired_why=? "
                "WHERE id=?", (now(), why, construction_id))
    con.execute("UPDATE world_places SET status='CLOSED' WHERE id=?", (c["place_id"],))
    store.event(con, "WORLD_SPACE_RETIRED", actor=by, subject="place:%s" % c["place_id"],
                payload={"why": why})
    return {"retired": True, "place": c["place_id"]}


# ── 8. OBSERVE: was it any use? ──────────────────────────────────────
def observe_utilisation(con, place_id):
    """Measured after the fact. Not 'the agent thinks it helped'."""
    c = con.execute("SELECT * FROM constructions WHERE place_id=? ORDER BY id DESC "
                    "LIMIT 1", (place_id,)).fetchone()
    p = SPACE.place(con, place_id)
    if p is None:
        raise GrowthError("no such place: %r" % place_id)
    occ = con.execute("SELECT COUNT(*) c FROM agent_locations WHERE workspace=?",
                      (place_id,)).fetchone()["c"]
    visits = con.execute("SELECT COUNT(*) c FROM movements WHERE to_workspace=? "
                         "AND phase='ARRIVED'", (place_id,)).fetchone()["c"]
    done = con.execute(
        "SELECT COUNT(*) c FROM movements m JOIN tasks t ON t.id=m.task_id "
        "WHERE m.to_workspace=? AND t.status IN ('ACCEPTED','ARCHIVED')",
        (place_id,)).fetchone()["c"]
    cap = max(1, p["capacity"] or 1)
    u = min(1.0, occ / float(cap))
    verdict = ("UNUSED" if visits == 0 else "UNDERUSED" if u < 0.34 else "USED")
    con.execute(
        "INSERT INTO space_utilization(place_id,construction_id,observed_at,occupants,"
        "tasks_done,visits,utilisation,verdict) VALUES(?,?,?,?,?,?,?,?)",
        (place_id, c["id"] if c else None, now(), occ, done, visits, round(u, 3),
         verdict))
    return {"place": place_id, "occupants": occ, "visits": visits,
            "tasks_done": done, "utilisation": round(u, 3), "verdict": verdict}


# ── the whole chain, for a caller that has the authority to run it ───
def grow_once(con, by, owner_approves=False, min_pressure=1.5):
    """OBSERVE → PROPOSE → DESIGN → VALIDATE → AUTHORISE → CONSTRUCT → ACTIVATE.

    Returns what happened at the point it stopped. It stops at AUTHORISE when
    the Owner has not approved and the impact is not low — which is the
    behaviour, not a limitation of it."""
    # A proposal already through validation and waiting on the Owner is the one
    # to continue. Proposing the same building again every time the Owner has
    # not yet answered is how a queue of identical requests appears.
    waiting = con.execute(
        "SELECT * FROM expansion_proposals WHERE state='VALIDATED' ORDER BY id LIMIT 1"
    ).fetchone()
    if waiting is not None:
        pid = waiting["id"]
        did = con.execute("SELECT id FROM facility_designs WHERE proposal_id=?",
                          (pid,)).fetchone()["id"]
    else:
        pid = propose_from_pressure(con, by, min_pressure=min_pressure)
        if pid is None:
            return {"grew": False, "why": "no workspace is over capacity"}
        did = design(con, pid, by=by)
        v = validate(con, did)
        if not v["passed"]:
            return {"grew": False, "proposal": pid, "design": did,
                    "why": "validation failed", "failed": v["failed"]}
    if needs_owner(con, pid) and not owner_approves:
        return {"grew": False, "proposal": pid, "design": did,
                "why": "awaiting owner approval", "impact": impact_of(
                    con, con.execute("SELECT * FROM expansion_proposals WHERE id=?",
                                     (pid,)).fetchone())}
    a = authorise(con, pid, by=OWNER if owner_approves else by)
    c = construct(con, pid, by=by)
    activate(con, c["construction"])
    return {"grew": True, "proposal": pid, "design": did, "authority": a["authority"],
            "construction": c["construction"], "place": c["place"], "cost": c["cost"],
            "workspaces": c.get("workspaces", [])}


def growth_report(con):
    """What the Owner sees in the World Growth view. Every row traceable."""
    props = []
    for p in con.execute("SELECT * FROM expansion_proposals ORDER BY id DESC"):
        d = con.execute("SELECT * FROM facility_designs WHERE proposal_id=?",
                        (p["id"],)).fetchone()
        c = con.execute("SELECT * FROM constructions WHERE proposal_id=?",
                        (p["id"],)).fetchone()
        u = con.execute("SELECT * FROM space_utilization WHERE place_id=? "
                        "ORDER BY id DESC LIMIT 1",
                        (c["place_id"],)).fetchone() if c else None
        props.append({
            "id": p["id"], "kind": p["kind"], "label": p["label"],
            "state": p["state"], "cause": p["cause"],
            "evidence": json.loads(p["evidence"] or "{}"),
            "proposed_by": p["proposed_by"], "created_at": p["created_at"],
            "decided_by": p["decided_by"], "decision_why": p["decision_why"],
            "design": dict(d, spec=json.loads(d["spec"]),
                           validation=json.loads(d["validation"] or "[]")) if d else None,
            "construction": dict(c) if c else None,
            "utilisation": dict(u) if u else None,
            "needs_owner": needs_owner(con, p["id"]) if d else True,
        })
    return {
        "proposals": props,
        "resources": resources(con),
        "types": types(con),
        "built": [dict(r) for r in con.execute(
            "SELECT c.*, w.label, w.kind FROM constructions c "
            "JOIN world_places w ON w.id=c.place_id ORDER BY c.id DESC")],
        "pressure": observe_pressure(con),
    }
