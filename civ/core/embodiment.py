"""THE EMBODIMENT LAYER — a body for an identity, and a state for the body.

    Agent Runtime  →  Agent State  →  Embodiment State  →  3D World

The arrow only points one way. Nothing in this module can start a task, take a
lease, call a tool or change a policy; it reads what the organisation did and
says what that *looks* like. The body is not the intelligence.

Two halves:

**The appearance** is persistent and frozen. It is derived once from a
deterministic seed, written to `agent_bodies`, and then never recomputed — LAW
43 refuses to change it. An identity you can re-derive is an identity you can
accidentally change: adjust the derivation next year and every agent in the
organisation silently becomes somebody else. R-01 in Verification has to be the
same R-01 that was in the Research Hall, including after a restart.

**The state** is derived every read, from rows that already exist. Where an
agent is comes from `agent_locations`. What it is DOING comes from its lease,
its task's required capability, and its recent tool calls. Which animation the
body plays is a pure function of that.

**Nothing here may invent activity.** There is no branch in this file that can
report an agent working without a live lease row behind it, using a tool without
a `tool_calls` row, or talking to somebody without an `agent_messages` row. An
agent with no work is IDLE, and an idle agent is the correct picture.
"""
import hashlib
import json
import math

from . import store
from .store import now

OWNER = "OWNER_PLANE"

# ── the design family ────────────────────────────────────────────────
# One technological civilisation. These say which member of it an agent is —
# never which ROLE it has, because role is equipment, and colour is identity.

BODY_VARIANTS = {
    # shoulder, chest depth, waist, limb thickness, leg style, height factor
    "A1": dict(shoulder=0.46, chest=0.25, waist=0.30, limb=0.085, legs="straight", h=1.00),
    "A2": dict(shoulder=0.52, chest=0.29, waist=0.33, limb=0.098, legs="straight", h=1.04),
    "A3": dict(shoulder=0.42, chest=0.22, waist=0.27, limb=0.074, legs="digitigrade", h=0.97),
    "A4": dict(shoulder=0.56, chest=0.32, waist=0.36, limb=0.112, legs="braced", h=1.08),
    "A5": dict(shoulder=0.44, chest=0.24, waist=0.28, limb=0.080, legs="digitigrade", h=1.02),
    "A6": dict(shoulder=0.49, chest=0.27, waist=0.31, limb=0.090, legs="braced", h=0.99),
}
HEAD_VARIANTS = {
    "H1": "visor",       # one continuous optical band
    "H2": "twin",        # two recessed optical sensors
    "H3": "array",       # segmented sensor array
    "H4": "dome",        # dome with a status strip
    "H5": "faceted",     # faceted plate, narrow aperture
}
CHEST_VARIANTS = {"C1": "panel", "C2": "grille", "C3": "badge", "C4": "layered"}
SENSOR_VARIANTS = {"S1": "boom", "S2": "collar", "S3": "temple", "S4": "none"}

# Premium industrial combinations. Primary carries the body, secondary the
# shoulders and forearms, accent the strip and markings. Deliberately not one
# hue per role — two researchers do not share a palette.
PALETTES = [
    ("graphite/cyan",    "#3b444d", "#2fb8c8", "#e8eef4", "matte"),
    ("obsidian/cobalt",  "#22262b", "#3b63c9", "#b6bec7", "satin"),
    ("violet/magenta",   "#42385c", "#b849a6", "#6e737b", "ceramic"),
    ("charcoal/orange",  "#33383d", "#d97b35", "#9aa3ab", "brushed"),
    ("midnight/amber",   "#252f42", "#d9a441", "#aeb6bf", "satin"),
    ("ceramic/emerald",  "#dfe3e6", "#2f9e6e", "#3c444c", "ceramic"),
    ("graphite/crimson", "#3a3f45", "#c2455a", "#98a1a9", "brushed"),
    ("slate/teal",       "#465058", "#2f8f8a", "#d5d9dc", "matte"),
    ("gunmetal/lime",    "#2e3338", "#9dbf3f", "#7e868e", "satin"),
    ("ink/copper",       "#222831", "#b5734a", "#c3c9cf", "brushed"),
    ("pewter/indigo",    "#5a626a", "#4c4fa8", "#eceff2", "ceramic"),
    ("basalt/sand",      "#34383c", "#c2ad82", "#8b949c", "matte"),
    ("carbon/ice",       "#282c31", "#8fd3e8", "#5c646c", "carbon"),
    ("olive/bronze",     "#3f4438", "#a9803f", "#cdd3d8", "brushed"),
    ("plum/rose",        "#3c2f3d", "#c4687f", "#9a9098", "ceramic"),
    ("steel/signal",     "#4a545c", "#e0574a", "#dfe4e8", "satin"),
]

# Role decides EQUIPMENT, never colour.
ROLE_EQUIPMENT = {
    "research": "sensor boom and data slate",
    "evidence": "sensor boom and data slate",
    "build": "forearm tool and back rack",
    "write": "forearm tool and back rack",
    "review": "inspection lamp and diagnostic slate",
    "execute": "comms module and shoulder beacon",
    "operate": "comms module and shoulder beacon",
    "coordinate": "coordination ring",
    "decompose": "coordination ring",
    "assign": "coordination ring",
}

# ── activity, as the world actually knows it ─────────────────────────
IDLE, WALKING, WORKING = "IDLE", "WALKING", "WORKING"
RESEARCHING, BUILDING, REVIEWING = "RESEARCHING", "BUILDING", "REVIEWING"
OPERATING, COORDINATING = "OPERATING", "COORDINATING"
WAITING, BLOCKED, REWORK = "WAITING", "BLOCKED", "REWORK"
USING_TOOL, MESSAGING = "USING_TOOL", "MESSAGING"

# Which animation a body plays for an activity. A pure lookup: no branch here
# can choose an animation the activity does not imply.
ANIMATION = {
    IDLE: "idle", WALKING: "walk", WORKING: "work",
    RESEARCHING: "read", BUILDING: "assemble", REVIEWING: "inspect",
    OPERATING: "operate", COORDINATING: "direct",
    WAITING: "wait", BLOCKED: "blocked", REWORK: "rework",
    USING_TOOL: "type", MESSAGING: "confer",
}
CAPABILITY_ACTIVITY = {
    "research": RESEARCHING, "evidence": RESEARCHING,
    "build": BUILDING, "write": BUILDING,
    "review": REVIEWING,
    "execute": OPERATING, "operate": OPERATING,
    "coordinate": COORDINATING, "decompose": COORDINATING, "assign": COORDINATING,
}


class EmbodimentError(RuntimeError):
    pass


# ── 1. the appearance, derived once and then frozen ──────────────────
def _seed(agent_id):
    return int(hashlib.sha256(agent_id.encode("utf-8")).hexdigest()[:12], 16)


def _pick(seed, salt, options):
    h = int(hashlib.sha256(("%d/%s" % (seed, salt)).encode()).hexdigest()[:8], 16)
    return options[h % len(options)]


def palette_order(agent_id):
    """This agent's palettes, most preferred first. Deterministic and pure.

    A single derived choice collides: sixteen palettes and a handful of agents
    make a shared colour likely rather than exceptional, and colour is the axis
    a person reads first. So the identity derives an ORDER rather than a
    winner, and `embody` takes the first one still free. Which palette that
    turns out to be depends on who was embodied before — exactly as a registry
    assigning a unique mark works — and it is written down and frozen."""
    s = _seed(agent_id)
    return sorted(PALETTES,
                  key=lambda p: hashlib.sha256(
                      ("%d/palette/%s" % (s, p[0])).encode()).hexdigest())


def design(agent_id, role_caps=(), palette=None):
    """What this agent WOULD look like. Deterministic, and pure.

    Kept separate from `embody` so the derivation can be tested without writing,
    and so the stored row — not this function — remains the authority once an
    agent exists. `palette` overrides the first preference when the registry has
    already given that colour to somebody else."""
    s = _seed(agent_id)
    pal = palette or palette_order(agent_id)[0]
    body = _pick(s, "body", sorted(BODY_VARIANTS))
    caps = [c for c in role_caps if c in ROLE_EQUIPMENT]
    equipment = ROLE_EQUIPMENT.get(caps[0], "") if caps else ""
    # A marking a person can read off the chest and match to the label overhead.
    letters = "".join(ch for ch in agent_id.upper() if ch.isalpha())
    mark = (letters[3:5] if len(letters) > 4 else letters[:2]) or "AG"
    num = 1 + (s % 99)
    return {
        "seed": s,
        "body_variant": body,
        "head_variant": _pick(s, "head", sorted(HEAD_VARIANTS)),
        "chest_variant": _pick(s, "chest", sorted(CHEST_VARIANTS)),
        "sensor_variant": _pick(s, "sensor", sorted(SENSOR_VARIANTS)),
        "equipment": equipment,
        "build": _pick(s, "build", ["slim", "standard", "standard", "heavy"]),
        "height": round(1.66 + (s % 23) * 0.011, 3),
        "palette": pal[0],
        "primary_color": pal[1],
        "secondary_color": pal[2],
        "accent_color": pal[3],
        "material": pal[4],
        "marking": "%s-%02d" % (mark, num),
    }


def embody(con, agent_id, role_caps=None):
    """Give an agent a body, once. Returns the stored row every time after.

    The stored row is the authority. If this module's derivation changes, agents
    that already exist keep the bodies they have — which is the whole point of
    writing it down."""
    row = body_of(con, agent_id)
    if row:
        return row
    if not con.execute("SELECT 1 FROM principals WHERE id=?", (agent_id,)).fetchone():
        raise EmbodimentError("no such agent: %r" % agent_id)
    if role_caps is None:
        from . import agent_world as W
        role_caps = sorted(W.ROLE_CAPABILITY.get(agent_id, set()))
    # Two agents sharing a palette are two agents a person cannot tell apart at
    # a glance, whatever else differs. Take this identity's most-preferred
    # palette that nobody already holds; fall back to its first preference only
    # when every palette is spoken for, which is honest — at that point the
    # world has more agents than the grammar has colours and the other axes
    # (frame, head, chest, sensor, build, height, marking) carry the identity.
    taken = {r["palette"] for r in con.execute("SELECT palette FROM agent_bodies")}
    order = palette_order(agent_id)
    pal = next((p for p in order if p[0] not in taken), order[0])
    d = design(agent_id, role_caps, palette=pal)
    n = con.execute("SELECT COUNT(*) c FROM agent_bodies").fetchone()["c"] + 1
    con.execute(
        "INSERT INTO agent_bodies(principal_id,body_id,seed,body_variant,head_variant,"
        "chest_variant,sensor_variant,equipment,build,height,palette,primary_color,"
        "secondary_color,accent_color,material,marking,created_at) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (agent_id, "BODY-%04d" % n, d["seed"], d["body_variant"], d["head_variant"],
         d["chest_variant"], d["sensor_variant"], d["equipment"], d["build"],
         d["height"], d["palette"], d["primary_color"], d["secondary_color"],
         d["accent_color"], d["material"], d["marking"], now()))
    store.event(con, "AGENT_EMBODIED", actor=OWNER, subject="agent:%s" % agent_id,
                payload={"body": "BODY-%04d" % n, "variant": d["body_variant"],
                         "palette": d["palette"]})
    return body_of(con, agent_id)


def body_of(con, agent_id):
    r = con.execute("SELECT * FROM agent_bodies WHERE principal_id=?",
                    (agent_id,)).fetchone()
    return dict(r) if r else None


def embody_all(con):
    from . import agent_world as W
    return [embody(con, a["id"]) for a in W.CREW
            if con.execute("SELECT 1 FROM principals WHERE id=?",
                           (a["id"],)).fetchone()]


# ── 2. workstations: a desk, not a room ──────────────────────────────
def fit_stations(con, workspace):
    """Lay numbered stations out inside a room. Idempotent, deterministic.

    A room's capacity already says how many people fit; this says WHERE each of
    them stands, so "at its workstation" names one desk rather than a rectangle."""
    p = con.execute("SELECT * FROM world_places WHERE id=?", (workspace,)).fetchone()
    if p is None or p["kind"] != "workspace":
        return []
    from . import open_world as OW
    cap = p["capability"] or OW.WORKSPACE_CAPABILITY.get(workspace, "")
    seats = max(1, int(p["capacity"] or 1))
    cols = max(1, min(3, seats))
    rows = int(math.ceil(seats / float(cols)))
    made = []
    for i in range(seats):
        sid = "%s#%d" % (workspace, i)
        if con.execute("SELECT 1 FROM workstations WHERE id=?", (sid,)).fetchone():
            made.append(sid)
            continue
        c, r = i % cols, i // cols
        x = p["x"] + p["w"] * (c + 0.5) / cols
        y = p["y"] + p["h"] * (r + 0.5) / rows
        con.execute(
            "INSERT INTO workstations(id,workspace,seat,x,y,facing,kind,capability) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (sid, workspace, i, round(x, 3), round(y, 3),
             round(math.atan2(0, 1) + (r * math.pi), 3),
             _station_kind(cap), cap))
        made.append(sid)
    return made


STATION_KIND = {"research": "desk", "build": "bench", "review": "console",
                "execute": "frame", "operate": "frame", "coordinate": "console",
                "store": "shelf", "observe": "console"}


def _station_kind(capability):
    """What a room is for decides what is bolted to its floor. The capability
    comes from `open_world.WORKSPACE_CAPABILITY`, which is the SAME table that
    decides where a task goes — so a bench is where building happens, not where
    a renderer guessed that building looks good."""
    return STATION_KIND.get(capability or "", "desk")


def fit_all_stations(con):
    n = 0
    for r in con.execute("SELECT id FROM world_places WHERE kind='workspace' "
                         "AND status<>'CLOSED'"):
        n += len(fit_stations(con, r["id"]))
    return n


def take_station(con, agent_id, workspace):
    """Claim a desk in this room and keep it. Releases any other seat first.

    Returns the station row, or None when the room has no free seat — which is a
    real answer: the agent is in the room, standing, and the picture should show
    that rather than seating it on top of somebody."""
    fit_stations(con, workspace)
    cur = con.execute("SELECT * FROM workstations WHERE occupied_by=?",
                      (agent_id,)).fetchone()
    if cur and cur["workspace"] == workspace:
        return dict(cur)
    if cur:
        con.execute("UPDATE workstations SET occupied_by=NULL WHERE id=?", (cur["id"],))
    free = con.execute("SELECT * FROM workstations WHERE workspace=? "
                       "AND occupied_by IS NULL ORDER BY seat LIMIT 1",
                       (workspace,)).fetchone()
    if free is None:
        return None
    con.execute("UPDATE workstations SET occupied_by=? WHERE id=?",
                (agent_id, free["id"]))
    _stand_at_station(con, agent_id, workspace)
    return dict(con.execute("SELECT * FROM workstations WHERE id=?",
                            (free["id"],)).fetchone())


def _stand_at_station(con, agent_id, workspace):
    """Having taken a seat, be at it.

    `world_space.slot` already knows that a held station outranks a spread-out
    slot, so this asks it again and writes the answer through the same guarded
    UPDATE every other position change uses. It does nothing to an agent that is
    mid-journey: arriving is the movement system's job, and sitting down is not
    a journey."""
    from . import world_space as SPACE
    loc = con.execute("SELECT * FROM agent_locations WHERE principal_id=?",
                      (agent_id,)).fetchone()
    if loc is None or loc["workspace"] != workspace:
        return
    if loc["movement"] in (SPACE.MOVING, SPACE.LEAVING):
        return
    x, y = SPACE.slot(con, workspace, agent_id)
    if abs(x - loc["x"]) < 1e-6 and abs(y - loc["y"]) < 1e-6:
        return
    con.execute(
        "UPDATE agent_locations SET x=?, y=?, updated_at=?, version=version+1 "
        "WHERE principal_id=? AND version=?",
        (x, y, store.now(), agent_id, loc["version"]))


def release_station(con, agent_id):
    con.execute("UPDATE workstations SET occupied_by=NULL WHERE occupied_by=?",
                (agent_id,))


def reconcile_stations(con):
    """Repair a seat held in a room the agent is no longer standing in.

    Movement and seating are written by different callers, so a path that moves
    an agent without claiming a desk leaves the old desk held. That renders as
    an agent at a workstation two districts from where it is — so the periodic
    reconcile fixes it, the same way it fixes a lease held by a dead worker."""
    fixed = []
    for r in con.execute(
            "SELECT w.id, w.workspace, w.occupied_by, l.workspace AS actually "
            "FROM workstations w JOIN agent_locations l ON l.principal_id=w.occupied_by "
            "WHERE w.occupied_by IS NOT NULL AND w.workspace <> l.workspace"):
        take_station(con, r["occupied_by"], r["actually"])
        fixed.append(r["occupied_by"])
    return fixed


def station_of(con, agent_id):
    r = con.execute("SELECT * FROM workstations WHERE occupied_by=?",
                    (agent_id,)).fetchone()
    return dict(r) if r else None


# ── 3. the state, derived from rows that already exist ───────────────
def _live_lease(con, agent_id):
    return con.execute(
        "SELECT l.id, l.task_id, t.status, t.required_caps FROM leases l "
        "JOIN tasks t ON t.id=l.task_id WHERE l.principal_id=? AND l.status='ACTIVE' "
        "ORDER BY l.id DESC LIMIT 1", (agent_id,)).fetchone()


def _recent_tool(con, agent_id, lease_id, within=6):
    """A tool call this agent really made under the lease it really holds."""
    if lease_id is None:
        return None
    r = con.execute(
        "SELECT * FROM tool_calls WHERE principal_id=? AND lease_id=? "
        "ORDER BY id DESC LIMIT 1", (agent_id, lease_id)).fetchone()
    return dict(r) if r else None


def _recent_message(con, agent_id, since_id=0):
    r = con.execute(
        "SELECT * FROM agent_messages WHERE (sender=? OR recipient=?) "
        "ORDER BY id DESC LIMIT 1", (agent_id, agent_id)).fetchone()
    return dict(r) if r else None


def activity_of(con, agent_id, loc=None):
    """What this agent is DOING, and the row that says so.

    Every branch below names a row. There is no path through this function that
    reports work without a lease, a tool without a `tool_calls` row, or an
    activity the task's own capability does not imply."""
    from . import world_space as SPACE
    loc = loc or SPACE.locate(con, agent_id)
    if loc is None:
        return {"activity": IDLE, "animation": "idle", "because": "not placed",
                "task_id": None, "lease_id": None, "tool": None}

    if loc["movement"] == SPACE.MOVING:
        return {"activity": WALKING, "animation": "walk",
                "because": loc["why"] or "travelling",
                "task_id": loc["task_id"], "lease_id": loc["lease_id"], "tool": None}

    lease = _live_lease(con, agent_id)
    if lease is not None and lease["status"] == "RUNNING":
        caps = json.loads(lease["required_caps"] or "[]")
        act = next((CAPABILITY_ACTIVITY[c] for c in caps
                    if c in CAPABILITY_ACTIVITY), WORKING)
        tool = _recent_tool(con, agent_id, lease["id"])
        if tool and tool["decision"] == "ALLOW":
            # A real, authorised tool call under this lease. The workstation
            # lights up because the gateway let something through, not because
            # an agent is standing near it.
            return {"activity": USING_TOOL, "animation": "type",
                    "because": "tool call %s on task #%d" % (tool["cap"],
                                                             lease["task_id"]),
                    "task_id": lease["task_id"], "lease_id": lease["id"],
                    "tool": tool["cap"], "tool_call_id": tool["id"]}
        return {"activity": act, "animation": ANIMATION[act],
                "because": "holds a lease on task #%d" % lease["task_id"],
                "task_id": lease["task_id"], "lease_id": lease["id"], "tool": None}

    # No lease. Is something assigned and stuck?
    from . import agent_world as W
    for t in con.execute("SELECT * FROM tasks WHERE status IN "
                         "('ASSIGNED','BLOCKED','FAILED','REVIEW') ORDER BY id"):
        if W.assignee(con, t["id"]) != agent_id:
            continue
        if t["status"] == "BLOCKED":
            return {"activity": BLOCKED, "animation": "blocked",
                    "because": "task #%d is BLOCKED" % t["id"],
                    "task_id": t["id"], "lease_id": None, "tool": None}
        if t["status"] == "FAILED":
            return {"activity": REWORK, "animation": "rework",
                    "because": "task #%d FAILED and is being corrected" % t["id"],
                    "task_id": t["id"], "lease_id": None, "tool": None}
        return {"activity": WAITING, "animation": "wait",
                "because": "assigned task #%d (%s)" % (t["id"], t["status"]),
                "task_id": t["id"], "lease_id": None, "tool": None}

    return {"activity": IDLE, "animation": "idle", "because": "holds no lease",
            "task_id": None, "lease_id": None, "tool": None}


def embodiment(con, agent_id):
    """The whole embodiment state for one agent: body, place, activity, target.

    This is what the 3D world reads. Everything in it is a column or a derivation
    over columns, and the `because` on every state names the row behind it."""
    from . import world_space as SPACE
    body = body_of(con, agent_id)
    loc = SPACE.locate(con, agent_id)
    if body is None or loc is None:
        return None
    act = activity_of(con, agent_id, loc)
    st = station_of(con, agent_id)
    place = SPACE.place(con, loc["workspace"])
    fac = SPACE.place(con, place["parent_id"]) if place and place["parent_id"] else None
    dis = SPACE.place(con, fac["parent_id"]) if fac and fac["parent_id"] else None
    # Where the body should stand: its own desk when it has one, otherwise the
    # coordinate the world recorded for it.
    at_station = bool(st and act["activity"] not in (WALKING,))
    return {
        "agent_id": agent_id,
        "body_id": body["body_id"],
        "appearance": {k: body[k] for k in (
            "body_id",
            "body_variant", "head_variant", "chest_variant", "sensor_variant",
            "equipment", "build", "height", "palette", "primary_color",
            "secondary_color", "accent_color", "material", "marking", "seed")},
        "x": loc["x"], "y": loc["y"],
        "station": st["id"] if st else None,
        "station_x": st["x"] if st else None,
        "station_y": st["y"] if st else None,
        "at_station": at_station,
        "facing": st["facing"] if st else 0.0,
        "workspace": loc["workspace"],
        "facility": fac["id"] if fac else None,
        "district": dis["id"] if dis else None,
        "movement_state": loc["movement"],
        "destination": loc["destination"],
        "target_x": loc["dest_x"], "target_y": loc["dest_y"],
        "path": json.loads(loc["path"] or "[]"),
        "waypoints": waypoints(con, agent_id),
        "activity_state": act["activity"],
        "animation_state": act["animation"],
        "because": act["because"],
        "task_id": act["task_id"], "lease_id": act["lease_id"],
        "tool": act["tool"], "tool_call_id": act.get("tool_call_id"),
        "why_here": loc["why"],
        "moved_at": loc["moved_at"], "version": loc["version"],
    }


def all_embodiments(con):
    return {r["principal_id"]: embodiment(con, r["principal_id"])
            for r in con.execute("SELECT principal_id FROM agent_bodies ORDER BY "
                                 "principal_id")
            if embodiment(con, r["principal_id"])}


def active_stations(con):
    """Which workstations are lit, and why. A station is active ONLY where the
    agent sitting at it is genuinely mid-tool-call."""
    out = {}
    for r in con.execute("SELECT * FROM workstations WHERE occupied_by IS NOT NULL"):
        act = activity_of(con, r["occupied_by"])
        if act["activity"] in (USING_TOOL, RESEARCHING, BUILDING, REVIEWING,
                               OPERATING, WORKING):
            out[r["id"]] = {"agent": r["occupied_by"], "activity": act["activity"],
                            "tool": act["tool"], "because": act["because"]}
    return out


# ── 4. navigation: doors, corridors and not walking through walls ────
def doorway(con, place_id):
    """Where a room is entered. Its own south edge, which is where the entrance
    frame is drawn — so an agent arrives through the door rather than the wall."""
    p = con.execute("SELECT * FROM world_places WHERE id=?", (place_id,)).fetchone()
    if p is None:
        return None
    return {"place": place_id, "x": round(p["x"] + p["w"] / 2.0, 3),
            "y": round(p["y"] - 0.35, 3), "w": 1.5}


def navmesh(con):
    """What the 3D world needs to walk somebody across the campus.

    Rooms are the walkable islands, facilities are the buildings holding them,
    doorways are the only way in, and everything outside a building is open
    ground. The renderer does the steering; this says what the ground is."""
    rooms, doors, blocks = [], [], []
    for p in con.execute("SELECT * FROM world_places WHERE status<>'CLOSED'"):
        if p["kind"] == "workspace":
            rooms.append({"id": p["id"], "x": p["x"], "y": p["y"],
                          "w": p["w"], "h": p["h"], "parent": p["parent_id"]})
            doors.append(doorway(con, p["id"]))
        elif p["kind"] == "facility":
            # A building is an obstacle to anyone not going into it.
            blocks.append({"id": p["id"], "x": p["x"], "y": p["y"],
                           "w": p["w"], "h": p["h"], "z": p["z"]})
            doors.append(doorway(con, p["id"]))
    return {"rooms": rooms, "doors": [d for d in doors if d], "blocks": blocks}


def waypoints(con, agent_id):
    """The route this agent is on, as coordinates rather than place names.

    `agent_locations.path` holds the places still to reach; this turns them into
    points the renderer can steer between, entering each building through its
    doorway instead of through a wall. It adds no leg the world did not plan —
    it only says where the planned legs are."""
    from . import world_space as SPACE
    loc = SPACE.locate(con, agent_id)
    if loc is None or loc["movement"] != SPACE.MOVING:
        return []
    out = []
    # Leaving: a body standing inside a building goes out through its own door
    # before crossing open ground. The route already plans the crossing; this
    # only says where the crossing starts.
    for d in _threshold(con, loc["workspace"], loc["destination"], leaving=True,
                        at=(loc["x"], loc["y"])):
        out.append(d)
    for wp in json.loads(loc["path"] or "[]"):
        p = con.execute("SELECT * FROM world_places WHERE id=?", (wp,)).fetchone()
        if p is None:
            continue
        if p["kind"] in ("facility", "workspace"):
            d = doorway(con, wp)
            out.append({"x": d["x"], "y": d["y"], "door": wp})
        out.append({"x": round(p["x"] + p["w"] / 2.0, 3),
                    "y": round(p["y"] + p["h"] / 2.0, 3), "place": wp})
    # Arriving: the route plans district to district, so the last leg — the one
    # that actually goes INSIDE — is the one most likely to cross a wall. Enter
    # through the destination's own doorways.
    for d in _threshold(con, loc["destination"], loc["workspace"], leaving=False):
        out.append(d)
    if loc["dest_x"] is not None:
        out.append({"x": loc["dest_x"], "y": loc["dest_y"], "arrive": loc["destination"]})
    return out


def _threshold(con, workspace, other, leaving, at=None):
    """The doors between a workspace and the open ground outside its building.

    Returns nothing when both ends are inside the same facility: two rooms of
    one building are reached along its own corridor, not by going outdoors. And
    nothing on the way OUT once the agent's recorded position is already past
    the building — this list is the route that REMAINS, and a door behind you is
    not part of it."""
    p = con.execute("SELECT * FROM world_places WHERE id=?", (workspace,)).fetchone()
    if p is None or p["kind"] != "workspace" or not p["parent_id"]:
        return []
    q = con.execute("SELECT * FROM world_places WHERE id=?", (other,)).fetchone()
    if q is not None and q["parent_id"] == p["parent_id"]:
        return []
    fac = con.execute("SELECT * FROM world_places WHERE id=?",
                      (p["parent_id"],)).fetchone()
    if leaving and at is not None and fac is not None:
        x, y = at
        inside = (fac["x"] - 0.5 <= x <= fac["x"] + fac["w"] + 0.5
                  and fac["y"] - 0.5 <= y <= fac["y"] + fac["h"] + 0.5)
        if not inside:
            return []
    doors = [doorway(con, workspace), doorway(con, p["parent_id"])]
    if not leaving:
        doors = list(reversed(doors))
    return [{"x": d["x"], "y": d["y"], "door": d["place"]} for d in doors if d]


def encounters(con, limit=12):
    """Real handoffs between two agents, from the messages that carried them.

    Two agents shown conferring is this table and nothing else — there is no
    proximity rule in the renderer that invents a conversation from two bodies
    happening to be near each other."""
    rows = con.execute(
        "SELECT m.*, a.workspace AS from_ws, b.workspace AS to_ws "
        "FROM agent_messages m "
        "LEFT JOIN agent_locations a ON a.principal_id=m.sender "
        "LEFT JOIN agent_locations b ON b.principal_id=m.recipient "
        "WHERE m.recipient LIKE 'AGT-%' AND m.sender <> m.recipient "
        "ORDER BY m.id DESC LIMIT ?", (limit,))
    return [{"from": r["sender"], "to": r["recipient"], "kind": r["kind"],
             "task_id": r["task_id"], "artifact_id": r["artifact_id"], "at": r["at"],
             "id": r["id"], "from_ws": r["from_ws"], "to_ws": r["to_ws"],
             # Co-location is a fact about two rows in `agent_locations`, and it
             # is the renderer's only licence to turn two bodies toward each
             # other. A message alone is a message; it is not a meeting.
             "same_room": bool(r["from_ws"]) and r["from_ws"] == r["to_ws"]}
            for r in rows]
