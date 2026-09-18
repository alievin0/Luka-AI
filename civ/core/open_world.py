"""THE OPEN WORLD — a spatial projection of persisted state.

Not a dashboard, not a floor plan, and not six cards in a row. The world is a
tree of DISTRICTS → FACILITIES → WORKSPACES with real coordinates, and every
entity in it is placed by a row.

Three rules the whole module exists to keep:

  1. **Position is derived, never chosen.** `place_agent` returns a workspace and
     a `reason` naming the row that put it there. Nothing wanders.
  2. **The layout is declarative and expandable.** Districts are data. Adding a
     district, a facility or a project plot is adding a row to a list — the world
     is not hardcoded to six stations, and a hundred projects do not need a
     hundred special cases.
  3. **Detail is a function of zoom.** At ORBIT the world draws lit districts and
     no agents at all; a thousand agents is a city where some blocks are bright,
     not a thousand sprites.

This does NOT duplicate `world_server.task_station`. That function is the tested
status→station mapping and stays authoritative; `workspace_of` maps the same
status onto the richer workspace tree, and a test asserts the two agree.
"""
import json

from . import agent_world as W
from . import always_on as A

OWNER = "OWNER_PLANE"

# ── the world, as data ───────────────────────────────────────────────
# x grows right-down, y grows left-down, both in world units. A district owns a
# rectangle; its facilities sit inside it; workspaces sit inside those.
DISTRICTS = [
    dict(id="observatory", label="Owner Observatory", kind="owner",
         x=-26, y=34, w=16, h=16, off_plate=True,
         about="outside the world, looking in",
         facilities=[dict(id="console", label="Instrument Rail", x=-24, y=36, w=12, h=6,
                          workspaces=[dict(id="owner_deck", label="Deck", x=-23, y=37,
                                           w=10, h=4)])]),
    dict(id="hub", label="Central Hub", kind="coordination",
         x=2, y=22, w=20, h=20, about="where work is noticed and dispatched",
         facilities=[
             dict(id="intake", label="Intake", x=4, y=24, w=8, h=16,
                  workspaces=[dict(id="ws_intake", label="Intake Yard", x=5, y=25,
                                   w=6, h=14, station="discovery")]),
             dict(id="dispatch", label="Dispatch", x=13, y=24, w=8, h=16,
                  workspaces=[dict(id="ws_dispatch", label="Dispatch Floor", x=14, y=25,
                                   w=6, h=14)]),
         ]),
    dict(id="research", label="Research District", kind="research",
         x=24, y=6, w=24, h=22, about="investigation, and where evidence is kept",
         facilities=[
             dict(id="lab", label="Research Hall", x=26, y=14, w=12, h=12,
                  workspaces=[dict(id="ws_lab", label="Reading Floor", x=27, y=15,
                                   w=10, h=10, station="research")]),
             dict(id="vault", label="Evidence Vault", x=26, y=8, w=9, h=5,
                  workspaces=[dict(id="ws_vault", label="Evidence Shelf", x=27, y=9,
                                   w=7, h=3)]),
             dict(id="knowledge", label="Knowledge Archive", x=38, y=8, w=8, h=5,
                  workspaces=[dict(id="ws_knowledge", label="Organisational Memory",
                                   x=39, y=9, w=6, h=3)]),
         ]),
    dict(id="creation", label="Creation District", kind="build",
         x=50, y=6, w=30, h=26, about="specification becomes an artifact, and is tested",
         facilities=[
             dict(id="design", label="Design Floor", x=52, y=16, w=8, h=14,
                  workspaces=[dict(id="ws_design", label="Bench", x=53, y=17,
                                   w=6, h=12)]),
             dict(id="factory", label="Build Factory", x=61, y=14, w=12, h=16,
                  cells=4,
                  workspaces=[dict(id="ws_cell_%d" % i, label="Cell %02d" % (i + 1),
                                   x=62 + i * 2.8, y=15, w=2.4, h=14,
                                   station="build" if i == 0 else None)
                              for i in range(4)]),
             dict(id="test", label="Test Bench", x=74, y=16, w=5, h=12,
                  workspaces=[dict(id="ws_test", label="Verification Frame", x=75, y=17,
                                   w=3, h=10, station="verify")]),
         ]),
    dict(id="review", label="Review District", kind="review",
         x=50, y=34, w=18, h=14, about="independent judgement; no door to the cells",
         facilities=[
             dict(id="inspection", label="Inspection", x=52, y=36, w=14, h=10,
                  workspaces=[dict(id="ws_inspection", label="Inspection Bench",
                                   x=53, y=37, w=12, h=8, station="review")]),
         ]),
    dict(id="operations", label="Operations District", kind="operations",
         x=70, y=34, w=16, h=14, about="execution, inside a marked boundary",
         facilities=[
             dict(id="pad", label="Containment Pad", x=72, y=36, w=12, h=10,
                  open_frame=True,
                  workspaces=[dict(id="ws_pad", label="Pad", x=73, y=37, w=10, h=8)]),
         ]),
    dict(id="output", label="Output", kind="output",
         x=26, y=34, w=18, h=12, about="accepted work leaves here",
         facilities=[
             dict(id="dock", label="Output Dock", x=28, y=36, w=14, h=8,
                  workspaces=[dict(id="ws_dock", label="Dock", x=29, y=37, w=12, h=6,
                                   station="output")]),
         ]),
    dict(id="archive", label="Archive", kind="archive",
         x=26, y=50, w=30, h=8, sunken=True,
         about="sunken, dim, never deleted",
         facilities=[
             dict(id="stacks", label="Stacks", x=28, y=51, w=26, h=6,
                  workspaces=[dict(id="ws_stacks", label="Stacks", x=29, y=52,
                                   w=24, h=4)]),
         ]),
    dict(id="projects", label="Project Districts", kind="projects",
         x=2, y=48, w=22, h=22, about="a project is a place; plots are allocated",
         facilities=[], expandable=True),
    dict(id="expansion", label="Future Expansion", kind="expansion",
         x=60, y=52, w=24, h=14, about="ground reserved; nothing built here yet",
         facilities=[], expandable=True),
]

# Where an entity stands when it holds nothing. Its district, not its task.
HOME_WORKSPACE = {
    "AGT-ORCHESTRATOR": "ws_dispatch",
    "AGT-RESEARCHER": "ws_lab",
    "AGT-BUILDER": "ws_cell_0",
    "AGT-REVIEWER": "ws_inspection",
    "AGT-OPERATOR": "ws_pad",
}

# Zoom levels. The contract is what is DRAWN and what is AGGREGATED, because a
# world that renders everything at every zoom stops being readable at 100 agents
# and stops rendering at 1,000.
ZOOM = [
    dict(id="orbit", label="ORBIT", scale_below=0.45,
         draws=["districts"], aggregates=["facilities", "workspaces", "agents",
                                          "tasks", "artifacts"]),
    dict(id="district", label="DISTRICT", scale_below=0.85,
         draws=["districts", "facilities"],
         aggregates=["workspaces", "agents", "tasks", "artifacts"]),
    dict(id="facility", label="FACILITY", scale_below=1.6,
         draws=["districts", "facilities", "workspaces", "agents"],
         aggregates=["artifacts"]),
    dict(id="workspace", label="WORKSPACE", scale_below=99.0,
         draws=["districts", "facilities", "workspaces", "agents", "tasks",
                "artifacts", "evidence"],
         aggregates=[]),
]


def lod(scale):
    """Which level of detail a given camera scale is entitled to draw."""
    for z in ZOOM:
        if scale < z["scale_below"]:
            return z
    return ZOOM[-1]


def _index():
    ws, fac = {}, {}
    for d in DISTRICTS:
        for f in d["facilities"]:
            fac[f["id"]] = dict(f, district=d["id"])
            for w in f.get("workspaces", []):
                ws[w["id"]] = dict(w, facility=f["id"], district=d["id"])
    return ws, fac


WORKSPACES, FACILITIES = _index()
STATION_WORKSPACE = {w["station"]: wid for wid, w in WORKSPACES.items()
                     if w.get("station")}


def workspace_of(task):
    """Which workspace a task occupies. One row in, one workspace out.

    Built on the same status reading `task_station` uses, mapped onto the richer
    tree. A test asserts the two never disagree."""
    s = task["status"]
    if s in ("DISCOVERED", "PROPOSED"):
        return "ws_intake"
    if s == "ACCEPTED":
        return "ws_dock"
    if s == "ARCHIVED":
        return "ws_stacks"
    if s == "COMPLETED":
        return "ws_test"
    if s in ("REVIEW", "REJECTED", "FAILED"):
        return "ws_inspection"
    caps = set(json.loads(task["required_caps"] or "[]"))
    if "build" in caps:
        return "ws_cell_0"
    if "review" in caps:
        return "ws_inspection"
    if "execute" in caps or "operate" in caps:
        return "ws_pad"
    return "ws_lab"


def place_agent(con, agent_id):
    """Where an entity stands, and the row that put it there."""
    live = con.execute(
        "SELECT t.* FROM tasks t JOIN leases l ON l.task_id=t.id "
        "WHERE l.principal_id=? AND l.status='ACTIVE' AND t.status='RUNNING' "
        "ORDER BY t.id LIMIT 1", (agent_id,)).fetchone()
    if live:
        return {"workspace": workspace_of(live), "state": "RUNNING",
                "task_id": live["id"],
                "reason": "holds an active lease on task #%d" % live["id"]}
    for t in con.execute("SELECT * FROM tasks WHERE status IN "
                         "('ASSIGNED','BLOCKED','REVIEW','COMPLETED') ORDER BY id"):
        if W.assignee(con, t["id"]) == agent_id:
            state = ("BLOCKED" if t["status"] == "BLOCKED" else
                     "REVIEW" if t["status"] == "REVIEW" else "ASSIGNED")
            return {"workspace": workspace_of(t), "state": state, "task_id": t["id"],
                    "reason": "assigned task #%d (%s)" % (t["id"], t["status"])}
    return {"workspace": HOME_WORKSPACE.get(agent_id, "ws_dispatch"), "state": "IDLE",
            "task_id": None, "reason": "holds no lease"}


def project_plots(con):
    """A plot per project, allocated in the Projects district. Expandable by
    construction: the Nth project gets the Nth plot, and the district grows."""
    d = next(x for x in DISTRICTS if x["id"] == "projects")
    out, per_row, pw, ph = [], 2, 9.0, 6.0
    for i, p in enumerate(con.execute("SELECT * FROM projects ORDER BY id")):
        col, row = i % per_row, i // per_row
        tasks = [dict(r) for r in con.execute(
            "SELECT id, status FROM tasks WHERE project_id=?", (p["id"],))]
        bad = [t for t in tasks if t["status"] in ("FAILED", "REJECTED")]
        done = [t for t in tasks if t["status"] == "ACCEPTED"]
        running = [t for t in tasks if t["status"] == "RUNNING"]
        state = ("COMPLETED" if p["stage"] == "COMPLETED" else
                 "RUNNING" if running else
                 "UNDER_REVIEW" if any(t["status"] == "REVIEW" for t in tasks) else
                 "FAILED" if bad and not done else
                 "BLOCKED" if any(t["status"] == "BLOCKED" for t in tasks) else "IDLE")
        out.append({
            "id": p["id"], "name": p["name"], "mission": p["mission"],
            "stage": p["stage"], "state": state, "origin": p["origin"],
            "x": d["x"] + 1.5 + col * (pw + 1.5), "y": d["y"] + 1.5 + row * (ph + 1.5),
            "w": pw, "h": ph,
            "tasks": len(tasks), "accepted": len(done), "failed": len(bad),
            "usd_spent": p["usd_spent"],
            "team": [r["principal_id"] for r in con.execute(
                "SELECT principal_id FROM team_members m JOIN teams t ON t.id=m.team_id "
                "WHERE t.project_id=?", (p["id"],))],
        })
    return out


def occupancy(con):
    """What is standing in each workspace, from rows."""
    out = {wid: {"tasks": [], "artifacts": [], "evidence": 0} for wid in WORKSPACES}
    for t in con.execute("SELECT * FROM tasks ORDER BY id"):
        wid = workspace_of(t)
        out[wid]["tasks"].append({"id": t["id"], "status": t["status"],
                                  "objective": t["objective"],
                                  "project_id": t["project_id"]})
    for a in con.execute("SELECT * FROM artifacts ORDER BY id"):
        t = con.execute("SELECT * FROM tasks WHERE id=?", (a["task_id"],)).fetchone()
        wid = workspace_of(t) if t else "ws_stacks"
        verdict = con.execute("SELECT verdict FROM reviews WHERE artifact_id=? "
                              "ORDER BY id DESC LIMIT 1", (a["id"],)).fetchone()
        out[wid]["artifacts"].append({
            "id": a["id"], "name": a["name"], "sha": a["sha"],
            "by": a["principal_id"], "verdict": verdict["verdict"] if verdict else None})
    out["ws_vault"]["evidence"] = con.execute(
        "SELECT COUNT(*) c FROM evidence").fetchone()["c"]
    out["ws_knowledge"]["evidence"] = con.execute(
        "SELECT COUNT(*) c FROM memories WHERE scope='org'").fetchone()["c"]
    return out


def open_world(con, scale=1.0):
    """The whole world as a scene graph, at the detail this scale earns."""
    level = lod(scale)
    occ = occupancy(con)
    agents = {}
    for a in W.CREW:
        if not con.execute("SELECT 1 FROM principals WHERE id=?", (a["id"],)).fetchone():
            continue
        p = place_agent(con, a["id"])
        ws = WORKSPACES[p["workspace"]]
        agents[a["id"]] = dict(
            p, id=a["id"], name=a["name"], role=a["role"],
            tools=len(a["permissions"]),
            x=ws["x"] + ws["w"] / 2.0, y=ws["y"] + ws["h"] / 2.0,
            district=ws["district"], facility=ws["facility"])

    districts = []
    for d in DISTRICTS:
        fids = [f["id"] for f in d["facilities"]]
        wids = [w["id"] for f in d["facilities"] for w in f.get("workspaces", [])]
        here = [a for a in agents.values() if a["district"] == d["id"]]
        districts.append(dict(
            {k: v for k, v in d.items() if k != "facilities"},
            facilities=[dict(f, occupancy={w["id"]: occ.get(w["id"], {})
                                           for w in f.get("workspaces", [])})
                        for f in d["facilities"]],
            agents=[a["id"] for a in here],
            active=sum(1 for a in here if a["state"] == "RUNNING"),
            tasks=sum(len(occ.get(w, {}).get("tasks", [])) for w in wids),
            artifacts=sum(len(occ.get(w, {}).get("artifacts", [])) for w in wids),
        ))

    return {
        "lod": level,
        "zooms": ZOOM,
        "districts": districts,
        "agents": agents,
        "projects": project_plots(con),
        "bounds": {"x0": min(d["x"] for d in DISTRICTS),
                   "y0": min(d["y"] for d in DISTRICTS),
                   "x1": max(d["x"] + d["w"] for d in DISTRICTS),
                   "y1": max(d["y"] + d["h"] for d in DISTRICTS)},
        "quiet": not any(a["state"] == "RUNNING" for a in agents.values()),
    }
