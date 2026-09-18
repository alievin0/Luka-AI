"""THE SPATIAL WORLD — where agents actually are, as persisted state.

Before this module, an agent's position was arithmetic performed during a draw
call: `open_world` read its task row, decided which workspace that implied, and
returned the centre of the rectangle. Nothing was anywhere. There was no
position to recover after a crash, nothing for two workers to race over, and no
such thing as being *between* two places.

Here, position is a row. The consequences are the point:

  * It survives a restart, because it was written down.
  * Two workers moving the same agent is a real race, settled the same way the
    queue settles a claim — a guarded UPDATE on `version`, one winner.
  * An agent can be MOVING: partway along a route, with waypoints left. Kill the
    process there and it reopens there.
  * Every transition is a `movements` row naming who moved, from where, to
    where, why, under which task and lease, caused by which queue entry, and by
    which worker.

**Movement is caused by work, never by wanting the world to look alive.**
`move_to` demands a reason and a cause. It refuses to send anyone towards a task
that is already finished (LAW 34 refuses it again in the database, because a
rule that only lives in Python holds only until the next caller).

**No model can reach any of this.** There is no movement verb in the agent
runtime's vocabulary, this module is never imported by `agent_runtime`, and the
gateway exposes no capability that writes here. A model may produce text asking
to be moved; nothing parses it.
"""
import json
import math

from . import store
from .store import now

OWNER = "OWNER_PLANE"

# Movement states. An agent is in exactly one of these, always.
IDLE, MOVING, ARRIVED, WORKING = "IDLE", "MOVING", "ARRIVED", "WORKING"
LEAVING, WAITING, BLOCKED = "LEAVING", "WAITING", "BLOCKED"

# How far an agent covers in one advance. Distance is in world units, and a
# route is walked one leg at a time so that "partway there" is a real state.
STEP = 6.0


class SpaceError(RuntimeError):
    """A spatial move that the world refuses. Never a crash — a decision."""


# ── the places, written down ─────────────────────────────────────────
def seed_places(con, districts=None):
    """Write the layout into the world. Idempotent, and safe to re-run.

    The layout is authored in `open_world.DISTRICTS` because a Python list is a
    better place to read a map than a migration is. But the WORLD's copy is
    these rows: that is what gets exported, what foreign keys point at, and what
    the laws check against."""
    from . import open_world as OW
    districts = districts if districts is not None else OW.DISTRICTS
    n = 0
    for d in districts:
        n += _place(con, d["id"], "district", None, d["label"], d,
                    about=d.get("about", ""),
                    status="RESERVED" if d.get("expandable") else "ACTIVE")
        for f in d.get("facilities", []):
            n += _place(con, f["id"], "facility", d["id"], f["label"], f)
            for w in f.get("workspaces", []):
                n += _place(con, w["id"], "workspace", f["id"], w["label"], w,
                            capacity=int(w.get("capacity") or _room_for(w)),
                            capability=w.get("capability", ""),
                            access=w.get("access", "OPEN"),
                            station=w.get("station"))
    return n


def _room_for(w):
    """How many agents a room holds, from the size of the room.

    Derived rather than declared: capacity is a fact about a rectangle, and a
    hand-written number per workspace is a second copy of the floor plan that
    drifts away from the first one."""
    return max(1, int(float(w["w"]) * float(w["h"]) / 8.0))


def _place(con, pid, kind, parent, label, src, **kw):
    row = con.execute("SELECT 1 FROM world_places WHERE id=?", (pid,)).fetchone()
    if row:
        return 0
    con.execute(
        "INSERT INTO world_places(id,kind,parent_id,label,x,y,w,h,z,capacity,"
        "capability,access,station,status,about) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (pid, kind, parent, label, float(src["x"]), float(src["y"]),
         float(src["w"]), float(src["h"]), float(src.get("z", 0)),
         kw.get("capacity", 0), kw.get("capability", ""), kw.get("access", "OPEN"),
         kw.get("station"), kw.get("status", "ACTIVE"), kw.get("about", "")))
    return 1


def place(con, pid):
    return con.execute("SELECT * FROM world_places WHERE id=?", (pid,)).fetchone()


def centre(con, pid):
    p = place(con, pid)
    if p is None:
        raise SpaceError("no such place: %r" % pid)
    return (p["x"] + p["w"] / 2.0, p["y"] + p["h"] / 2.0)


def workspaces(con):
    return [dict(r) for r in con.execute(
        "SELECT * FROM world_places WHERE kind='workspace' ORDER BY id")]


def slot(con, workspace, principal_id):
    """Where inside a workspace an agent stands.

    Deterministic, derived from who else is already there, and spread along the
    room's longer axis so occupants are actually distinguishable rather than
    stacked on one tile. Not decoration: an occupant's coordinates are what the
    capacity law protects, and two agents rendered on top of each other is a
    world that cannot be read."""
    p = place(con, workspace)
    if p is None:
        raise SpaceError("no such workspace: %r" % workspace)
    here = [r["principal_id"] for r in con.execute(
        "SELECT principal_id FROM agent_locations WHERE workspace=? "
        "AND principal_id<>? ORDER BY principal_id", (workspace, principal_id))]
    i, cap = len(here), max(1, int(p["capacity"] or 1))
    cx, cy = p["x"] + p["w"] / 2.0, p["y"] + p["h"] / 2.0
    if i == 0:
        return (cx, cy)
    # Lay them out down the long side of the room; wrap across the short one.
    long_h = p["h"] >= p["w"]
    per = max(1, int((p["h"] if long_h else p["w"]) // 1.5))
    step = (p["h"] if long_h else p["w"]) / float(min(cap, per) + 1)
    lane = (i // per) - 0.5 if cap > per else 0.0
    down = (i % per + 1) * step
    if long_h:
        return (_clamp(cx + lane * 1.6, p["x"] + 0.3, p["x"] + p["w"] - 0.3),
                _clamp(p["y"] + down, p["y"] + 0.3, p["y"] + p["h"] - 0.3))
    return (_clamp(p["x"] + down, p["x"] + 0.3, p["x"] + p["w"] - 0.3),
            _clamp(cy + lane * 1.6, p["y"] + 0.3, p["y"] + p["h"] - 0.3))


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ── the route ────────────────────────────────────────────────────────
def route(con, frm, to):
    """The waypoints between two workspaces. Deterministic, and structural.

    An agent does not cross a wall to save time: it leaves its workspace through
    its facility, crosses at district level, and enters the destination the same
    way. The path is the place tree, walked upwards and back down — which is
    both the obvious route and the one that stays correct when districts move."""
    if frm == to:
        return []
    a, b = place(con, frm), place(con, to)
    if a is None or b is None:
        raise SpaceError("cannot route %r → %r: a place does not exist" % (frm, to))
    if b["kind"] != "workspace":
        raise SpaceError("%r is not somewhere an agent can go" % to)
    af, bf = a["parent_id"], b["parent_id"]
    up = [] if af == bf else [af]
    down = [] if af == bf else [bf]
    if af != bf:
        ad = place(con, af)["parent_id"] if af else None
        bd = place(con, bf)["parent_id"] if bf else None
        if ad != bd:
            # Different districts: out to each district, and through the hub,
            # which is what the Central Hub is for.
            mid = ["hub"] if con.execute(
                "SELECT 1 FROM world_places WHERE id='hub'").fetchone() else []
            up = [af, ad] if ad else [af]
            down = ([bd] if bd else []) + [bf]
            return _dedupe([w for w in (up + mid + down + [to]) if w])
    return _dedupe([w for w in (up + down + [to]) if w])


def _dedupe(seq):
    out = []
    for x in seq:
        if not out or out[-1] != x:
            out.append(x)
    return out


def _strip_zero_legs(con, x, y, waypoints, dest_xy=None):
    """Remove waypoints that are not actually anywhere else.

    A district with one facility holding one workspace has all three centres at
    the same point, so a route through them contains legs of zero length.
    Recording those as travel is movement invented by the geometry, which is
    still movement invented — and it is why this takes the journey's real end
    point rather than assuming the last waypoint is somewhere new."""
    if not waypoints:
        return []
    ends = dest_xy or centre(con, waypoints[-1])
    out, px, py = [], x, y
    for i, wp in enumerate(waypoints):
        cx, cy = ends if i == len(waypoints) - 1 else centre(con, wp)
        if math.hypot(cx - px, cy - py) > 0.001:
            out.append(wp)
            px, py = cx, cy
    # An agent already standing on the destination point still has to be told it
    # is there: keep the destination itself so `arrive` has somewhere to land.
    return out or waypoints[-1:]


def _legs(con, x, y, waypoints):
    """Straight-line distance through a list of places, from a starting point."""
    total, px, py = 0.0, x, y
    for wp in waypoints:
        cx, cy = centre(con, wp)
        total += math.hypot(cx - px, cy - py)
        px, py = cx, cy
    return total


# ── the agent's own spatial row ──────────────────────────────────────
def locate(con, agent_id):
    return con.execute("SELECT * FROM agent_locations WHERE principal_id=?",
                       (agent_id,)).fetchone()


def stand(con, agent_id, workspace, why="founded"):
    """First placement. An agent that has never moved is still somewhere."""
    if locate(con, agent_id):
        return locate(con, agent_id)
    x, y = slot(con, workspace, agent_id)
    con.execute(
        "INSERT INTO agent_locations(principal_id,workspace,x,y,movement,why,"
        "moved_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,0)",
        (agent_id, workspace, x, y, IDLE, why, now(), now()))
    _record(con, agent_id, None, None, None, workspace, x, y, 0.0,
            "ARRIVED", why)
    return locate(con, agent_id)


def _record(con, agent_id, fw, fx, fy, tw, tx, ty, dist, phase, why,
            task_id=None, lease_id=None, worker=None, queue_id=None, event_id=None):
    con.execute(
        "INSERT INTO movements(principal_id,from_workspace,from_x,from_y,"
        "to_workspace,to_x,to_y,distance,phase,why,task_id,lease_id,worker,"
        "queue_id,event_id,at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (agent_id, fw, fx, fy, tw, tx, ty, dist, phase, why, task_id, lease_id,
         worker, queue_id, event_id, now()))
    return con.execute("SELECT last_insert_rowid() r").fetchone()["r"]


def _write(con, agent_id, version, **cols):
    """The only way this module changes a location: a guarded UPDATE.

    `version` is the value the caller read. If another worker has written since,
    zero rows match and this returns False — the caller lost, and must not
    proceed as though it had won. This is the same mechanism the queue uses to
    hand one item to exactly one worker."""
    cols["version"] = version + 1
    cols["updated_at"] = now()
    sets = ", ".join("%s=?" % k for k in cols)
    args = list(cols.values()) + [agent_id, version]
    cur = con.execute(
        "UPDATE agent_locations SET %s WHERE principal_id=? AND version=?" % sets,
        args)
    return cur.rowcount == 1


# ── movement, caused by work ─────────────────────────────────────────
def move_to(con, agent_id, workspace, why, task_id=None, worker=None,
            queue_id=None, lease_id=None, redirect=False):
    """Send an agent somewhere, because something real requires it there.

    Returns a dict describing what happened. `moved` is False when the agent was
    already there — which is not a failure, and must not be recorded as travel.
    Raises `SpaceError` when the move itself is illegitimate: no such place, or
    a task that is already finished.

    A reason is mandatory. There is no overload of this function that moves
    somebody for no stated cause.

    **One agent, one journey.** An agent already travelling is NOT silently
    re-aimed at somewhere else: the second request is refused and recorded.
    Without this, two workers acting on two different tasks each start a
    journey, the last write wins, and the world ends up with one agent that
    departed for two places — which is the "conflicting destinations" a
    multi-worker world has to make impossible rather than unlikely. Re-aiming
    is still possible, by asking for it: `redirect=True` is a decision somebody
    made, and it leaves a row saying so."""
    if not why:
        raise SpaceError("a movement needs a reason; nothing moves on its own")
    here = locate(con, agent_id)
    if here is None:
        raise SpaceError("%s has no location to move from" % agent_id)
    dest = place(con, workspace)
    if dest is None or dest["kind"] != "workspace":
        raise SpaceError("%r is not a workspace" % workspace)
    if dest["status"] == "CLOSED":
        raise SpaceError("%r is closed" % workspace)
    if task_id is not None:
        t = con.execute("SELECT status FROM tasks WHERE id=?", (task_id,)).fetchone()
        if t is None:
            raise SpaceError("task %r does not exist" % task_id)
        if t["status"] in ("ACCEPTED", "ARCHIVED"):
            _record(con, agent_id, here["workspace"], here["x"], here["y"],
                    workspace, None, None, 0.0, "REFUSED",
                    "task %d is %s" % (task_id, t["status"]), task_id=task_id,
                    worker=worker, queue_id=queue_id)
            raise SpaceError("task %d is %s; finished work causes no movement"
                             % (task_id, t["status"]))

    if here["workspace"] == workspace and here["movement"] in (IDLE, ARRIVED, WORKING):
        return {"moved": False, "workspace": workspace, "why": "already there",
                "distance": 0.0, "version": here["version"]}

    if here["movement"] == MOVING and here["destination"] != workspace:
        if not redirect:
            _record(con, agent_id, here["workspace"], here["x"], here["y"],
                    workspace, None, None, 0.0, "REFUSED",
                    "already travelling to %s: %s" % (here["destination"], why),
                    task_id=task_id, worker=worker, queue_id=queue_id)
            return {"moved": False, "refused": True,
                    "workspace": here["workspace"],
                    "destination": here["destination"],
                    "why": "already travelling to %s" % here["destination"],
                    "distance": 0.0, "version": here["version"]}
        _record(con, agent_id, here["workspace"], here["x"], here["y"],
                workspace, None, None, 0.0, "REFUSED",
                "redirected off %s: %s" % (here["destination"], why),
                task_id=task_id, worker=worker, queue_id=queue_id)
    if here["movement"] == MOVING and here["destination"] == workspace:
        return {"moved": False, "workspace": here["workspace"],
                "destination": workspace, "why": "already on the way",
                "distance": 0.0, "version": here["version"]}

    dx, dy = slot(con, workspace, agent_id)
    waypoints = _strip_zero_legs(con, here["x"], here["y"],
                                 route(con, here["workspace"], workspace), (dx, dy))
    dist = _legs(con, here["x"], here["y"], waypoints[:-1] + [workspace])
    ev = store.event(con, "AGENT_MOVE_REQUESTED", actor=OWNER,
                     subject="agent:%s" % agent_id,
                     payload={"from": here["workspace"], "to": workspace,
                              "why": why, "task_id": task_id, "worker": worker,
                              "distance": round(dist, 3)})
    ok = _write(con, agent_id, here["version"], movement=MOVING,
                destination=workspace, dest_x=dx, dest_y=dy,
                path=json.dumps(waypoints), why=why, task_id=task_id,
                lease_id=lease_id, activity="travelling to " + dest["label"])
    if not ok:
        return {"moved": False, "lost_race": True, "workspace": here["workspace"],
                "why": "another worker moved this agent first", "distance": 0.0,
                "version": here["version"]}
    _record(con, agent_id, here["workspace"], here["x"], here["y"], workspace,
            dx, dy, dist, "REQUESTED", why, task_id=task_id, lease_id=lease_id,
            worker=worker, queue_id=queue_id, event_id=ev)
    return {"moved": True, "workspace": here["workspace"], "destination": workspace,
            "waypoints": waypoints, "distance": round(dist, 3), "why": why,
            "version": here["version"] + 1}


def advance(con, agent_id, worker=None, steps=1):
    """Walk the route. The agent is genuinely partway there between calls.

    Two different things are persisted here, and keeping them apart is what
    stops the record turning into noise:

      * `agent_locations.x/y` is the LIVE position, rewritten every step. This
        is what "partway along the route" means, and what a crash preserves.
      * a `movements` row is written when the agent crosses from one PLACE into
        another — not once per stride. A journey is a handful of transitions,
        and a stride-by-stride trace would bury the causality it exists to
        carry under its own volume.
    """
    out = []
    for _ in range(steps):
        here = locate(con, agent_id)
        if here is None or here["movement"] != MOVING:
            break
        left = json.loads(here["path"] or "[]")
        if not left:
            out.append(arrive(con, agent_id, worker=worker))
            break
        nxt = left[0]
        p = place(con, nxt)
        tx, ty = ((here["dest_x"], here["dest_y"]) if nxt == here["destination"]
                  else (p["x"] + p["w"] / 2.0, p["y"] + p["h"] / 2.0))
        d = math.hypot(tx - here["x"], ty - here["y"])

        if d > STEP:                     # too far to reach it in this step
            f = STEP / d
            nx, ny = here["x"] + (tx - here["x"]) * f, here["y"] + (ty - here["y"]) * f
            if not _write(con, agent_id, here["version"], x=nx, y=ny, moved_at=now()):
                out.append({"lost_race": True})
                break
            out.append({"toward": nxt, "covered": STEP, "remaining_legs": len(left)})
            continue

        rest = left[1:]
        cols = dict(x=tx, y=ty, path=json.dumps(rest), moved_at=now())
        if p["kind"] == "workspace":
            ok, denied = can_enter(con, agent_id, nxt)
            if not ok:
                out.append(abandon(con, agent_id, denied, worker=worker))
                break
            cols["workspace"] = nxt
        if not _write(con, agent_id, here["version"], **cols):
            out.append({"lost_race": True})
            break
        # The distance of this LEG, measured from where the leg began — not the
        # residual fragment left when the last stride happened to land. A long
        # leg is covered by several strides, and only the last one reaches this
        # branch; reporting `d` here said an agent crossed the world in 4 units.
        lx, ly = _leg_start(con, agent_id, here)
        _record(con, agent_id, _last_place(con, agent_id, here["workspace"]),
                lx, ly, nxt, tx, ty, math.hypot(tx - lx, ty - ly),
                "DEPARTED" if _leg_number(con, agent_id) == 0 else "WAYPOINT",
                here["why"], task_id=here["task_id"], worker=worker)
        out.append({"reached": nxt, "covered": round(d, 2),
                    "remaining_legs": len(rest)})
        if not rest:
            out.append(arrive(con, agent_id, worker=worker))
            break
    return out


def _since_request(con, agent_id):
    """Movement rows belonging to the journey currently under way."""
    return [dict(r) for r in con.execute(
        "SELECT * FROM movements WHERE principal_id=? AND id > "
        "COALESCE((SELECT MAX(id) FROM movements WHERE principal_id=? "
        "AND phase='REQUESTED'),0) ORDER BY id", (agent_id, agent_id))]


def _leg_number(con, agent_id):
    return len([m for m in _since_request(con, agent_id)
                if m["phase"] in ("DEPARTED", "WAYPOINT")])


def _leg_start(con, agent_id, here):
    """Where the leg now ending began: the last place reached on this journey,
    or the point the journey itself started from."""
    legs = [m for m in _since_request(con, agent_id)
            if m["phase"] in ("DEPARTED", "WAYPOINT")]
    if legs and legs[-1]["to_x"] is not None:
        return legs[-1]["to_x"], legs[-1]["to_y"]
    req = con.execute(
        "SELECT from_x, from_y FROM movements WHERE principal_id=? AND phase='REQUESTED' "
        "ORDER BY id DESC LIMIT 1", (agent_id,)).fetchone()
    if req and req["from_x"] is not None:
        return req["from_x"], req["from_y"]
    return here["x"], here["y"]


def _last_place(con, agent_id, fallback):
    """The place the agent actually came from on this leg.

    Not `agent_locations.workspace`: an agent crossing a district has not been
    in a workspace for several legs, and reporting the one it set out from as
    the origin of every leg is a record that says it teleported repeatedly."""
    legs = [m for m in _since_request(con, agent_id)
            if m["phase"] in ("DEPARTED", "WAYPOINT")]
    return legs[-1]["to_workspace"] if legs else fallback


def journey_origin(con, agent_id):
    """Where the journey under way began, from its own REQUESTED row.

    Deliberately not a column: the immutable record already says it, and a
    second copy is a second thing that can disagree with the first."""
    r = con.execute(
        "SELECT from_workspace FROM movements WHERE principal_id=? "
        "AND phase='REQUESTED' ORDER BY id DESC LIMIT 1", (agent_id,)).fetchone()
    return r["from_workspace"] if r else None


def arrive(con, agent_id, worker=None):
    """Finish the journey. ARRIVED is a destination reached, never assumed."""
    here = locate(con, agent_id)
    if here is None or here["movement"] != MOVING:
        return {"arrived": False, "why": "not moving"}
    dest = here["destination"]
    if not dest:
        raise SpaceError("%s is MOVING with no destination" % agent_id)
    # Can it actually be let in? A destination that filled up while this agent
    # was walking would otherwise abort the write from inside a trigger and
    # leave the agent MOVING forever, towards somewhere it can never arrive.
    # A journey that cannot end is worse than one that never began.
    ok, denied = can_enter(con, agent_id, dest)
    if not ok:
        return abandon(con, agent_id, denied, worker=worker)
    dx, dy = here["dest_x"], here["dest_y"]
    origin = journey_origin(con, agent_id)
    covered = round(sum(m["distance"] for m in _since_request(con, agent_id)), 3)
    if not _write(con, agent_id, here["version"], workspace=dest, x=dx, y=dy,
                  movement=ARRIVED, path="[]", moved_at=now(),
                  activity="arrived at " + place(con, dest)["label"]):
        return {"arrived": False, "lost_race": True}
    ev = store.event(con, "AGENT_ARRIVED", actor=OWNER,
                     subject="agent:%s" % agent_id,
                     payload={"from": origin, "workspace": dest, "why": here["why"],
                              "task_id": here["task_id"], "worker": worker,
                              "distance": covered})
    # The ARRIVED row closes the journey: it names where it began, not the leg
    # it happened to finish on, and carries the whole distance covered.
    _record(con, agent_id, origin, None, None, dest, dx, dy, covered,
            "ARRIVED", here["why"], task_id=here["task_id"],
            lease_id=here["lease_id"], worker=worker, event_id=ev)
    return {"arrived": True, "from": origin, "workspace": dest,
            "distance": covered, "why": here["why"]}


def can_enter(con, agent_id, workspace):
    """(ok, why) — whether this agent could enter that room right now.

    Asked wherever an agent is about to cross into a workspace, which is both in
    `advance` (the last leg) and in `arrive`. Checking in only one of them left
    the agent MOVING forever when the other one was the branch that aborted."""
    room = place(con, workspace)
    if room is None:
        return False, "%s does not exist" % workspace
    if room["kind"] != "workspace":
        return False, "%s is not somewhere an agent can stand" % workspace
    if room["status"] == "CLOSED":
        return False, "%s is closed" % workspace
    taken = con.execute(
        "SELECT COUNT(*) c FROM agent_locations WHERE workspace=? AND principal_id<>?",
        (workspace, agent_id)).fetchone()["c"]
    if taken >= room["capacity"]:
        return False, "%s is full (%d of %d)" % (workspace, taken, room["capacity"])
    return True, ""


def abandon(con, agent_id, why, worker=None):
    """End a journey that cannot be completed, leaving a coherent state.

    The agent stops where it actually is, with no destination and no waypoints,
    and the reason is recorded. Anything else leaves it MOVING towards a place
    it will never reach — which reads on screen as an agent walking forever and
    is, in the database, an impossible state nobody cleans up."""
    here = locate(con, agent_id)
    if here is None:
        return {"arrived": False, "abandoned": False}
    dest = here["destination"]
    ok = _write(con, agent_id, here["version"], movement=IDLE, destination=None,
                dest_x=None, dest_y=None, path="[]", why=why,
                activity="stopped short: " + why)
    if not ok:
        return {"arrived": False, "abandoned": False, "lost_race": True}
    ev = store.event(con, "AGENT_JOURNEY_ABANDONED", actor=OWNER,
                     subject="agent:%s" % agent_id,
                     payload={"destination": dest, "why": why, "worker": worker,
                              "stopped_at": here["workspace"]})
    _record(con, agent_id, here["workspace"], here["x"], here["y"],
            dest or here["workspace"], here["x"], here["y"], 0.0, "REFUSED", why,
            task_id=here["task_id"], worker=worker, event_id=ev)
    return {"arrived": False, "abandoned": True, "why": why,
            "workspace": here["workspace"]}


def travel(con, agent_id, workspace, why, task_id=None, worker=None,
           queue_id=None, lease_id=None, max_legs=24):
    """Request a move and walk it to the end. Every leg is still persisted.

    The convenience of one call, with none of the honesty given up: a caller
    that wants the agent there now still leaves behind the whole route it took."""
    r = move_to(con, agent_id, workspace, why, task_id=task_id, worker=worker,
                queue_id=queue_id, lease_id=lease_id)
    if r.get("moved"):
        steps = advance(con, agent_id, worker=worker, steps=max_legs)
        here = locate(con, agent_id)
        r["arrived"] = here["workspace"] == workspace and here["movement"] == ARRIVED
        # `advance` can give up on a journey it cannot finish — a destination
        # that filled while the agent was walking. The caller has to be told, or
        # a declined journey reads exactly like a completed one.
        gave_up = next((x for x in steps if x.get("abandoned")), None)
        if gave_up:
            r.update(gave_up)
        elif here["movement"] == MOVING:
            # Out of legs rather than out of road. Still not left mid-route with
            # nobody coming back for it.
            r.update(abandon(con, agent_id,
                             "journey to %s exceeded %d legs" % (workspace, max_legs),
                             worker=worker))
    return r


# ── what the agent is doing once it is there ─────────────────────────
def begin_work(con, agent_id, task_id, lease_id=None, activity="working"):
    """WORKING requires having got there, and a task. Both are checked."""
    here = locate(con, agent_id)
    if here is None:
        raise SpaceError("%s has no location" % agent_id)
    if here["movement"] == MOVING:
        raise SpaceError("%s is still travelling; it cannot work yet" % agent_id)
    if not _write(con, agent_id, here["version"], movement=WORKING,
                  task_id=task_id, lease_id=lease_id, activity=activity,
                  destination=None, dest_x=None, dest_y=None, path="[]"):
        return False
    store.event(con, "AGENT_WORK_STARTED", actor=OWNER, subject="agent:%s" % agent_id,
                payload={"workspace": here["workspace"], "task_id": task_id,
                         "lease_id": lease_id})
    return True


def finish_work(con, agent_id, why="work finished", state=IDLE):
    """Stop working. An agent going idle stops having a destination.

    Leaving the finished journey's destination in the row made an idle agent
    report that it was on its way somewhere it was already standing."""
    here = locate(con, agent_id)
    if here is None:
        return False
    cols = dict(movement=state, activity="", lease_id=None, why=why,
                task_id=None if state == IDLE else here["task_id"])
    if state == IDLE:
        cols.update(destination=None, dest_x=None, dest_y=None, path="[]")
    return _write(con, agent_id, here["version"], **cols)


def set_state(con, agent_id, state, why="", activity=""):
    """WAITING / BLOCKED / IDLE. Never MOVING — that needs a destination."""
    if state == MOVING:
        raise SpaceError("use move_to; MOVING without a destination is LAW 30")
    here = locate(con, agent_id)
    if here is None:
        return False
    cols = dict(movement=state, why=why or here["why"], activity=activity)
    if state == IDLE:
        cols.update(destination=None, dest_x=None, dest_y=None, path="[]")
    return _write(con, agent_id, here["version"], **cols)


# ── reading the world ────────────────────────────────────────────────
def occupants(con, workspace):
    return [dict(r) for r in con.execute(
        "SELECT * FROM agent_locations WHERE workspace=? ORDER BY principal_id",
        (workspace,))]


def history(con, agent_id, limit=40):
    return [dict(r) for r in con.execute(
        "SELECT * FROM movements WHERE principal_id=? ORDER BY id DESC LIMIT ?",
        (agent_id, limit))]


def last_move(con, agent_id):
    r = con.execute(
        "SELECT * FROM movements WHERE principal_id=? AND phase IN "
        "('ARRIVED','DEPARTED') ORDER BY id DESC LIMIT 1", (agent_id,)).fetchone()
    return dict(r) if r else None


def aggregate(con):
    """Occupancy counts at every level of the tree, from rows.

    This is what a world of 10,000 agents shows at ORBIT: a district with a
    number on it. The number is a COUNT, so it is right at five agents and right
    at ten thousand, and no sprite is drawn to produce it."""
    ws = {r["id"]: dict(r) for r in con.execute(
        "SELECT * FROM world_places WHERE kind='workspace'")}
    fac = {r["id"]: dict(r) for r in con.execute(
        "SELECT * FROM world_places WHERE kind='facility'")}
    out = {"workspace": {}, "facility": {}, "district": {}, "total": 0}
    for r in con.execute("SELECT workspace, COUNT(*) c FROM agent_locations "
                         "GROUP BY workspace"):
        wid, c = r["workspace"], r["c"]
        out["workspace"][wid] = out["workspace"].get(wid, 0) + c
        out["total"] += c
        f = ws.get(wid, {}).get("parent_id")
        if f:
            out["facility"][f] = out["facility"].get(f, 0) + c
            d = fac.get(f, {}).get("parent_id")
            if d:
                out["district"][d] = out["district"].get(d, 0) + c
    return out


def spatial_report(con, agent_id):
    """Everything the Owner is entitled to ask about where an agent is.

    Every field is a column or a row id. There is nothing here that could be set
    to something other than what happened."""
    here = locate(con, agent_id)
    if here is None:
        return None
    r = dict(here)
    p = place(con, r["workspace"])
    fac = place(con, p["parent_id"]) if p and p["parent_id"] else None
    dis = place(con, fac["parent_id"]) if fac and fac["parent_id"] else None
    r["path"] = json.loads(r["path"] or "[]")
    r["place"] = {"workspace": p["label"] if p else None,
                  "facility": fac["label"] if fac else None,
                  "district": dis["label"] if dis else None,
                  "district_id": dis["id"] if dis else None,
                  "facility_id": fac["id"] if fac else None}
    r["destination_label"] = (place(con, r["destination"])["label"]
                              if r["destination"] else None)
    r["last_move"] = last_move(con, agent_id)
    r["moves"] = con.execute(
        "SELECT COUNT(*) c FROM movements WHERE principal_id=?",
        (agent_id,)).fetchone()["c"]
    r["distance_travelled"] = round(con.execute(
        "SELECT COALESCE(SUM(distance),0) d FROM movements WHERE principal_id=? "
        "AND phase IN ('DEPARTED','WAYPOINT')", (agent_id,)).fetchone()["d"], 2)
    r["evidence"] = {
        "task": r["task_id"], "lease": r["lease_id"],
        "movement": (r["last_move"] or {}).get("id"),
        "events": [x["id"] for x in con.execute(
            "SELECT id FROM events WHERE subject=? ORDER BY id DESC LIMIT 6",
            ("agent:%s" % agent_id,))],
    }
    return r
