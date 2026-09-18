#!/usr/bin/env python3
"""AGENT WORLD — the Owner-facing server.  python3 world_server.py [--port 8790]

A window into the world, not a second copy of it. Every endpoint is a read of
the same SQLite file the agents write to; there is no cache, no projection and
no seeded demo data. If the UI shows an agent RUNNING, this server found a task
in RUNNING with a live lease. If it shows nothing, nothing is happening.

Python standard library only, to match the rest of the runtime.
"""
import argparse
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import agent_runtime as RT     # noqa: E402
from core import always_on as AO        # noqa: E402
from core import open_world as OW       # noqa: E402
from core import world_space as SPACE   # noqa: E402
from core import world_growth as GROW    # noqa: E402
from core import capability_graph as CAP # noqa: E402
from core import embodiment as EMB       # noqa: E402
from core import model_gate as GATE     # noqa: E402
from core import world_bus as BUS        # noqa: E402
from core import agent_world as W        # noqa: E402
from core import store                   # noqa: E402

UI = os.path.join(HERE, "world_ui")
DB = os.path.join(HERE, "agent-world.db")

# The functional shape of the organisation. The ORCHESTRATOR sits above the
# workflow because it coordinates it and holds no tool of its own.
STRUCTURE = [
    {"id": "coordination", "label": "Coordination", "tier": "above",
     "agents": ["AGT-ORCHESTRATOR"]},
    {"id": "research", "label": "Research", "tier": "work",
     "agents": ["AGT-RESEARCHER"]},
    {"id": "build", "label": "Build", "tier": "work", "agents": ["AGT-BUILDER"]},
    {"id": "review", "label": "Review", "tier": "work", "agents": ["AGT-REVIEWER"]},
    {"id": "operations", "label": "Operations", "tier": "work",
     "agents": ["AGT-OPERATOR"]},
]


# ── the spatial projection ───────────────────────────────────────────
# The World screen is a PROJECTION of database state onto a floor plan. The
# mapping lives here, in Python, deterministic and tested — not in JavaScript,
# where "where is this agent standing" could quietly become a decision rather
# than a lookup. A station is occupied because a row says so or it is empty.
STATIONS = [
    {"id": "discovery", "label": "Discovery", "order": 0,
     "about": "noticed, not yet agreed to"},
    {"id": "research", "label": "Research", "order": 1,
     "about": "investigating; evidence is gathered here"},
    {"id": "build", "label": "Build", "order": 2,
     "about": "an approved task becomes an artifact"},
    {"id": "verify", "label": "Verification", "order": 3,
     "about": "deterministic checks, run outside the producer"},
    {"id": "review", "label": "Review", "order": 4,
     "about": "independent judgement; may reject"},
    {"id": "output", "label": "Output", "order": 5,
     "about": "accepted work"},
]

# Where an agent stands when it holds nothing. Its district, not a task.
HOME = {"AGT-ORCHESTRATOR": "discovery", "AGT-RESEARCHER": "research",
        "AGT-BUILDER": "build", "AGT-REVIEWER": "review",
        "AGT-OPERATOR": "verify"}


def task_station(task):
    """Which station a task occupies. One row in, one station out."""
    s = task["status"]
    if s in ("DISCOVERED", "PROPOSED"):
        return "discovery"
    if s == "ACCEPTED":
        return "output"
    if s == "COMPLETED":
        return "verify"
    if s in ("REVIEW", "REJECTED", "FAILED"):
        # A rejected or failed task stalled at judgement. It stays visible there
        # rather than disappearing: work that did not pass is still work that
        # happened, and the world should not tidy it away.
        return "review"
    caps = set(json.loads(task["required_caps"] or "[]"))
    if "build" in caps:
        return "build"
    if "review" in caps:
        return "review"
    return "research"


def autonomy(con):
    """What the always-on world is doing, as counts over rows.

    Every figure here is a COUNT or a stored value. The UI has no way to show
    activity that is not in this dict, and nothing in this dict is an estimate —
    which is what makes "the world is idle" a fact the screen can state rather
    than an impression it gives."""
    q = BUS.depth(con)
    chains = [dict(r) for r in con.execute(
        "SELECT * FROM chains ORDER BY id DESC LIMIT 10")]
    return {
        "queue": q,
        "quiet": BUS.quiet(con),
        "owner": AO.presence(con),
        "chains": chains,
        "chains_running": sum(1 for c in chains if c["state"] == "RUNNING"),
        "opportunities": con.execute(
            "SELECT COUNT(*) c FROM opportunities").fetchone()["c"],
        "opportunity_states": {r["status"]: r["c"] for r in con.execute(
            "SELECT status, COUNT(*) c FROM opportunities GROUP BY status")},
        "discoveries": con.execute("SELECT COUNT(*) c FROM discoveries").fetchone()["c"],
        "opportunity_list": _rows(
            con, "SELECT id, problem, status, confidence, evidence_id, discovered_by, "
                 "rationale, project_id, decided_by, decision_why, created_at "
                 "FROM opportunities ORDER BY id DESC LIMIT 8"),
        "lessons": con.execute("SELECT COUNT(*) c FROM lessons").fetchone()["c"],
        "lessons_promoted": con.execute(
            "SELECT COUNT(*) c FROM lessons WHERE state='PROMOTED'").fetchone()["c"],
        "failures": con.execute("SELECT COUNT(*) c FROM failures").fetchone()["c"],
        "awaiting_owner": con.execute(
            "SELECT COUNT(*) c FROM approvals WHERE decision IS NULL").fetchone()["c"],
        "budgets": [dict(r) for r in con.execute(
            "SELECT scope, scope_id, limit_usd, spent_usd, state FROM budgets "
            "ORDER BY scope, scope_id")],
        "blocked_by_dependency": [
            r["id"] for r in con.execute(
                "SELECT id FROM tasks WHERE status IN ('APPROVED','ASSIGNED')")
            if AO.unmet_deps(con, r["id"])],
        "model": GATE.status(con),
        "last_heartbeat": (lambda r: dict(r) if r else None)(con.execute(
            "SELECT * FROM heartbeats ORDER BY id DESC LIMIT 1").fetchone()),
    }


def world_stage(con):
    """Stations, who is standing where, and why — all of it from rows.

    `reason` on every placement names the row that put the agent there, so a
    viewer can always ask the world to justify what it is showing."""
    tasks = _rows(con, "SELECT * FROM tasks ORDER BY id")
    live = {r["task_id"]: r for r in _rows(
        con, "SELECT task_id, principal_id, expires_at FROM leases "
             "WHERE status='ACTIVE'")}
    occupancy = {s["id"]: [] for s in STATIONS}
    for t in tasks:
        if t["status"] == "ARCHIVED":
            continue
        st = task_station(t)
        occupancy[st].append({
            "task_id": t["id"], "status": t["status"], "objective": t["objective"],
            "assignee": W.assignee(con, t["id"]),
            "project_id": t["project_id"],
            "leased_by": (live.get(t["id"]) or {}).get("principal_id"),
            "open_conditions": [c["description"] for c in W.open_conditions(con, t["id"])],
        })

    placement = {}
    for a in W.CREW:
        aid = a["id"]
        if not con.execute("SELECT 1 FROM principals WHERE id=?", (aid,)).fetchone():
            continue
        held = [t for t in tasks if live.get(t["id"], {}).get("principal_id") == aid
                and t["status"] == "RUNNING"]
        if held:
            placement[aid] = {"station": task_station(held[0]), "state": "RUNNING",
                              "task_id": held[0]["id"],
                              "reason": "holds lease on task #%d" % held[0]["id"]}
            continue
        mine = [t for t in tasks if W.assignee(con, t["id"]) == aid
                and t["status"] in ("ASSIGNED", "BLOCKED", "REVIEW", "COMPLETED")]
        if mine:
            t = mine[0]
            placement[aid] = {
                "station": task_station(t),
                "state": "BLOCKED" if t["status"] == "BLOCKED" else
                         ("REVIEW" if t["status"] == "REVIEW" else "ASSIGNED"),
                "task_id": t["id"],
                "reason": "assigned task #%d (%s)" % (t["id"], t["status"])}
            continue
        placement[aid] = {"station": HOME.get(aid, "discovery"), "state": "IDLE",
                          "task_id": None, "reason": "holds no lease"}
    return {"stations": STATIONS, "occupancy": occupancy, "placement": placement,
            "artifacts": _rows(con, "SELECT a.id, a.name, a.task_id, a.principal_id, "
                                    "a.project_id, a.sha, a.created_at FROM artifacts a "
                                    "ORDER BY a.id"),
            "verdicts": _rows(con, "SELECT id, artifact_id, reviewer_id, verdict, "
                                   "rationale, created_at FROM reviews ORDER BY id")}


def connect(path):
    return store.connect(path)


def _rows(con, sql, args=()):
    return [dict(r) for r in con.execute(sql, args)]


def agent_activity(con, agent_id, limit=40):
    """What this agent actually did, newest first, each row linked to its record."""
    out = []
    for t in con.execute("SELECT * FROM task_transitions WHERE actor=? "
                         "ORDER BY id DESC LIMIT ?", (agent_id, limit)):
        out.append({"at": t["at"], "kind": "transition",
                    "text": "task #%d %s → %s" % (t["task_id"], t["from_state"] or "—",
                                                  t["to_state"]),
                    "why": t["why"], "ref": {"type": "task", "id": t["task_id"]}})
    for c in con.execute("SELECT * FROM tool_calls WHERE principal_id=? "
                         "ORDER BY id DESC LIMIT ?", (agent_id, limit)):
        out.append({"at": c["at"], "kind": "tool",
                    "text": "%s %s" % (c["cap"], c["decision"]),
                    "why": c["reason"] or "",
                    "ref": {"type": "tool_call", "id": c["id"]},
                    "decision": c["decision"]})
    for a in con.execute("SELECT * FROM artifacts WHERE principal_id=? "
                         "ORDER BY id DESC LIMIT ?", (agent_id, limit)):
        out.append({"at": a["created_at"], "kind": "artifact",
                    "text": "created artifact #%d %s" % (a["id"], a["name"]),
                    "ref": {"type": "artifact", "id": a["id"]}})
    for r in con.execute("SELECT * FROM reviews WHERE reviewer_id=? "
                         "ORDER BY id DESC LIMIT ?", (agent_id, limit)):
        out.append({"at": r["created_at"], "kind": "review",
                    "text": "%s artifact #%d" % (r["verdict"], r["artifact_id"]),
                    "why": r["rationale"], "ref": {"type": "review", "id": r["id"]}})
    out.sort(key=lambda x: x["at"], reverse=True)
    return out[:limit]


def agent_detail(con, agent_id):
    v = W.agent_view(con, agent_id)
    live = con.execute(
        "SELECT t.id, t.objective, t.status, l.expires_at FROM tasks t "
        "JOIN leases l ON l.task_id=t.id WHERE l.principal_id=? AND l.status='ACTIVE' "
        "AND t.status='RUNNING'", (agent_id,)).fetchone()
    assigned = [t for t in _rows(con, "SELECT id, objective, status FROM tasks "
                                      "WHERE status NOT IN ('ARCHIVED') ORDER BY id")
                if W.assignee(con, t["id"]) == agent_id]
    v["state"] = ("RUNNING" if live else
                  "ASSIGNED" if any(t["status"] == "ASSIGNED" for t in assigned) else
                  "BLOCKED" if any(t["status"] == "BLOCKED" for t in assigned) else
                  "IDLE")
    v["current_task"] = dict(live) if live else None
    v["assigned_tasks"] = assigned
    v["artifacts"] = _rows(con, "SELECT id, name, sha, source, task_id, created_at "
                                "FROM artifacts WHERE principal_id=? ORDER BY id DESC",
                           (agent_id,))
    v["reviews"] = _rows(con, "SELECT id, artifact_id, verdict, rationale, created_at "
                              "FROM reviews WHERE reviewer_id=? ORDER BY id DESC",
                         (agent_id,))
    v["memory"] = _rows(con, "SELECT id, scope, owner_id, kind, text, evidence_id, "
                             "created_at FROM memories WHERE created_by=? "
                             "ORDER BY id DESC", (agent_id,))
    v["evidence"] = _rows(con, "SELECT id, kind, external_provenance, collected_at "
                               "FROM evidence WHERE collected_by=? ORDER BY id DESC",
                          (agent_id,))
    # Where it is, where it is going, and why — every field a column or a row
    # id, so each claim on the Owner's screen points at the record behind it.
    v["spatial"] = SPACE.spatial_report(con, agent_id)
    v["movements"] = SPACE.history(con, agent_id, limit=20)
    v["timeline"] = agent_activity(con, agent_id)
    v["team_of"] = _rows(con, "SELECT t.project_id, t.name, tm.seat FROM team_members tm "
                              "JOIN teams t ON t.id=tm.team_id WHERE tm.principal_id=?",
                         (agent_id,))
    return v


def relationships(con):
    """Edges that EXIST. Every one is a foreign key or an event, never a guess."""
    edges = []
    for t in con.execute("SELECT * FROM tasks ORDER BY id"):
        who = W.assignee(con, t["id"])
        if who:
            edges.append({"from": t["created_by"], "to": who, "kind": "delegates",
                          "label": "task #%d" % t["id"],
                          "ref": {"type": "task", "id": t["id"]}})
    for a in con.execute("SELECT * FROM artifacts ORDER BY id"):
        edges.append({"from": a["principal_id"], "to": "artifact:%d" % a["id"],
                      "kind": "produces", "label": a["name"],
                      "ref": {"type": "artifact", "id": a["id"]}})
        for r in con.execute("SELECT * FROM reviews WHERE artifact_id=?", (a["id"],)):
            edges.append({"from": "artifact:%d" % a["id"], "to": r["reviewer_id"],
                          "kind": "reviewed_by", "label": r["verdict"],
                          "ref": {"type": "review", "id": r["id"]}})
    return edges


def world_payload(con):
    st = W.world_state(con)
    agents = {a["agent_id"]: a for a in st["agents"]}
    for aid in list(agents):
        d = agent_detail(con, aid)
        agents[aid].update({"state": d["state"], "current_task": d["current_task"],
                            "artifacts": len(d["artifacts"]),
                            "reviews": len(d["reviews"]),
                            "memories": len(d["memory"]),
                            "last_action": d["timeline"][0] if d["timeline"] else None,
                            "team_of": d["team_of"]})
    return {
        "world": {"mode": store.meta(con, "mode"),
                  "founded": store.meta(con, "founded"),
                  "paused": store.meta(con, "paused", False),
                  "quiet": st["quiet"]},
        "structure": STRUCTURE,
        "agents": agents,
        "owner": {"id": W.OWNER},
        "projects": _rows(con, "SELECT id, name, mission, stage, usd_spent "
                               "FROM projects ORDER BY id DESC"),
        "tasks": [dict(t, assignee=W.assignee(con, t["id"]),
                       open_conditions=[c["description"]
                                        for c in W.open_conditions(con, t["id"])])
                  for t in _rows(con, "SELECT id, objective, status, project_id, "
                                      "created_by, created_at FROM tasks ORDER BY id DESC")],
        "tasks_by_state": st["tasks_by_state"],
        "running": st["running"],
        "relationships": relationships(con),
        "stage": world_stage(con), "autonomy": autonomy(con),
        "away": W.while_you_were_away(con),
        "activity": activity(con, 60),
    }


def activity(con, limit=60):
    """The real event store, newest first, each entry pointing at its record."""
    out = []
    for e in con.execute("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,)):
        ref = None
        subj = e["subject"] or ""
        for kind in ("task", "artifact", "project"):
            if subj.startswith(kind + ":"):
                # A subject is conventionally `kind:id`, and an id is conventionally
                # an integer — conventionally. One event whose subject did not
                # parse took down the whole Owner view: a bad trade for a link.
                try:
                    ref = {"type": kind, "id": int(subj.split(":", 1)[1])}
                except (ValueError, IndexError):
                    ref = None
                break
        out.append({"id": e["id"], "at": e["at"], "kind": e["kind"],
                    "actor": e["actor"], "subject": subj, "ref": ref,
                    "payload": json.loads(e["payload"] or "{}")})
    return out


def world3d(con):
    """Everything the 3D world needs, and nothing it could invent.

    The renderer is told WHAT EXISTS and WHAT KIND OF THING each one is. It is
    never told how to draw a research lab specifically — it looks up the
    archetype. A facility type registered next year therefore renders without
    anybody touching the renderer, which is the only way a world that builds
    itself can also be seen."""
    places = [dict(r) for r in con.execute(
        "SELECT * FROM world_places ORDER BY kind, id")]
    types = GROW.types(con)
    # Which archetype each place is, from its own `type_id` column. Resolving it
    # by matching the id against the type registry made the Archive DISTRICT
    # render as an archive FACILITY, because both happened to be called
    # "archive" — a guess that looked like knowledge until it was wrong.
    for p in places:
        t = types.get(p["type_id"]) if p["type_id"] else None
        p["type"] = t["id"] if t else None
        p["archetype"] = t["archetype"] if t else {
            "district": "ground", "facility": "block", "workspace": "room"}[p["kind"]]
        p["equipment"] = t["equipment"] if t else []
    agents = {}
    for a in W.CREW:
        if not con.execute("SELECT 1 FROM principals WHERE id=?", (a["id"],)).fetchone():
            continue
        sp = SPACE.spatial_report(con, a["id"])
        if sp is None:
            continue
        placed = OW.place_agent(con, a["id"])
        agents[a["id"]] = {
            "id": a["id"], "name": a["name"], "role": a["role"],
            "x": sp["x"], "y": sp["y"], "workspace": sp["workspace"],
            "destination": sp["destination"], "dest_x": sp["dest_x"],
            "dest_y": sp["dest_y"], "movement": sp["movement"],
            "state": placed["state"], "because": placed["because"],
            "why": sp["why"], "activity": sp["activity"],
            "task_id": sp["task_id"], "lease_id": sp["lease_id"],
            "path": sp["path"], "district": sp["place"]["district_id"],
            "facility": sp["place"]["facility_id"],
        }
    built = {r["place_id"]: dict(r) for r in con.execute(
        "SELECT * FROM constructions ORDER BY id")}
    # The embodiment layer: a persistent body per identity, where it is standing,
    # what it is doing and the row that says so. Derived, never invented.
    bodies = EMB.all_embodiments(con)
    for aid, e in bodies.items():
        if aid in agents:
            agents[aid].update({k: e[k] for k in (
                "body_id", "appearance", "station", "station_x", "station_y",
                "at_station", "facing", "activity_state", "animation_state",
                "because", "tool", "tool_call_id", "waypoints")})
    return {
        "places": places,
        "types": types,
        "agents": agents,
        "occupancy": SPACE.aggregate(con),
        "constructions": built,
        "resources": GROW.resources(con),
        "autonomy": autonomy(con),
        "away": W.while_you_were_away(con),
        "activity": activity(con, 24),
        "quiet": BUS.quiet(con),
        "projects": OW.project_plots(con),
        "bodies": bodies,
        "stations": [dict(r) for r in con.execute(
            "SELECT * FROM workstations ORDER BY workspace, seat")],
        "active_stations": EMB.active_stations(con),
        "encounters": EMB.encounters(con),
        "navmesh": EMB.navmesh(con),
    }


def movements(con, limit=80):
    """The movement record, newest first. What actually happened, in order."""
    return [dict(r) for r in con.execute(
        "SELECT * FROM movements ORDER BY id DESC LIMIT ?", (limit,))]


def record(con, kind, rid):
    """The actual underlying row behind anything the UI shows."""
    table = {"task": "tasks", "artifact": "artifacts", "review": "reviews",
             "evidence": "evidence", "tool_call": "tool_calls", "project": "projects",
             "memory": "memories", "message": "agent_messages",
             "event": "events", "opportunity": "opportunities",
             "discovery": "discoveries", "lesson": "lessons",
             "chain": "chains", "queue": "world_queue",
             "movement": "movements", "place": "world_places"}.get(kind)
    if not table:
        return {"error": "unknown record kind %r" % kind}
    row = con.execute("SELECT * FROM %s WHERE id=?" % table, (rid,)).fetchone()
    if row is None:
        return {"error": "no %s #%s" % (kind, rid)}
    out = {"kind": kind, "id": rid, "row": dict(row)}
    if kind == "task":
        out["provenance"] = RT.provenance_chain(con, rid)
        out["conditions"] = _rows(con, "SELECT * FROM task_conditions WHERE task_id=?",
                                  (rid,))
        out["messages"] = W.thread(con, rid)
    if kind == "artifact":
        out["reviews"] = _rows(con, "SELECT * FROM reviews WHERE artifact_id=?", (rid,))
        out["verification"] = _rows(
            con, "SELECT * FROM evidence WHERE external_provenance LIKE ?",
            ("artifact:%d@%%" % rid,))
    return out


class Handler(BaseHTTPRequestHandler):
    db_path = DB

    def log_message(self, *a):            # quiet; the world has its own log
        pass

    def _send(self, body, ctype="application/json", code=200):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):                     # noqa: N802
        u = urlparse(self.path)
        parts = [p for p in u.path.split("/") if p]
        try:
            if parts and parts[0] == "api":
                return self._api(parts[1:], parse_qs(u.query))
            return self._static(u.path)
        except Exception as e:            # noqa: BLE001
            self._send(json.dumps({"error": repr(e)}), code=500)

    def _api(self, parts, q):
        con = connect(self.db_path)
        try:
            if not parts or parts[0] == "world":
                return self._send(json.dumps(world_payload(con), ensure_ascii=False))
            if parts[0] == "agent" and len(parts) > 1:
                return self._send(json.dumps(agent_detail(con, parts[1]),
                                             ensure_ascii=False))
            if parts[0] == "project" and len(parts) > 1:
                return self._send(json.dumps(W.project_passport(con, int(parts[1])),
                                             ensure_ascii=False))
            if parts[0] == "open":
                scale = float(q.get("scale", ["1.0"])[0])
                payload = OW.open_world(con, scale)
                payload["autonomy"] = autonomy(con)
                payload["away"] = W.while_you_were_away(con)
                return self._send(json.dumps(payload, ensure_ascii=False))
            if parts[0] == "capability" and len(parts) > 1:
                return self._send(json.dumps(CAP.graph(con, parts[1]),
                                             ensure_ascii=False))
            if parts[0] == "tools":
                return self._send(json.dumps(
                    {"tools": CAP.tools(con), "handoffs": CAP.handoffs(con)},
                    ensure_ascii=False))
            if parts[0] == "chain" and len(parts) > 1:
                return self._send(json.dumps(
                    CAP.execution_chain(con, int(parts[1])), ensure_ascii=False))
            if parts[0] == "embodiment" and len(parts) > 1:
                return self._send(json.dumps(EMB.embodiment(con, parts[1]),
                                             ensure_ascii=False))
            if parts[0] == "world3d":
                return self._send(json.dumps(world3d(con), ensure_ascii=False))
            if parts[0] == "growth":
                return self._send(json.dumps(GROW.growth_report(con),
                                             ensure_ascii=False))
            if parts[0] == "space" and len(parts) > 1:
                return self._send(json.dumps(
                    SPACE.spatial_report(con, parts[1]), ensure_ascii=False))
            if parts[0] == "movements":
                n = int(q.get("limit", ["80"])[0])
                return self._send(json.dumps(movements(con, n), ensure_ascii=False))
            if parts[0] == "activity":
                n = int(q.get("limit", ["60"])[0])
                return self._send(json.dumps(activity(con, n), ensure_ascii=False))
            if parts[0] == "away":
                return self._send(json.dumps(W.while_you_were_away(con),
                                             ensure_ascii=False))
            if parts[0] == "record" and len(parts) > 2:
                return self._send(json.dumps(record(con, parts[1], int(parts[2])),
                                             ensure_ascii=False))
            self._send(json.dumps({"error": "no such endpoint"}), code=404)
        finally:
            con.close()

    def _static(self, path):
        if path in ("/", ""):
            rel = "open.html"
        elif path == "/flat":
            rel = "index.html"          # the transitional floor plan, kept working
        elif path in ("/3d", "/3d/"):
            rel = "three/world3d.html"
        elif path in ("/bodies", "/bodies/", "/registry", "/registry/"):
            rel = "three/registry.html"
        else:
            rel = path.lstrip("/")
        full = os.path.abspath(os.path.join(UI, rel))
        if not full.startswith(os.path.abspath(UI) + os.sep) or not os.path.isfile(full):
            return self._send("not found", ctype="text/plain", code=404)
        ctype = {"html": "text/html; charset=utf-8", "css": "text/css",
                 "js": "application/javascript", "mjs": "application/javascript",
                 "png": "image/png", "svg": "image/svg+xml"}.get(
                     full.rsplit(".", 1)[-1], "text/plain")
        with open(full, "rb") as fh:
            self._send(fh.read(), ctype=ctype)


def serve(db=DB, port=8790, host="127.0.0.1"):
    Handler.db_path = db
    httpd = ThreadingHTTPServer((host, port), Handler)
    return httpd


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB)
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args(argv)
    if not os.path.exists(a.db):
        print("no world at %s — run agent_world_v01_demo.py first" % a.db,
              file=sys.stderr)
        return 2
    httpd = serve(a.db, a.port, a.host)
    print("Agent World on http://%s:%d  (world: %s)"
          % (a.host, a.port, os.path.relpath(a.db, HERE)))
    sys.stdout.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
