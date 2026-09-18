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
                ref = {"type": kind, "id": int(subj.split(":", 1)[1])}
        out.append({"id": e["id"], "at": e["at"], "kind": e["kind"],
                    "actor": e["actor"], "subject": subj, "ref": ref,
                    "payload": json.loads(e["payload"] or "{}")})
    return out


def record(con, kind, rid):
    """The actual underlying row behind anything the UI shows."""
    table = {"task": "tasks", "artifact": "artifacts", "review": "reviews",
             "evidence": "evidence", "tool_call": "tool_calls", "project": "projects",
             "memory": "memories", "message": "agent_messages",
             "event": "events"}.get(kind)
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
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        full = os.path.abspath(os.path.join(UI, rel))
        if not full.startswith(os.path.abspath(UI) + os.sep) or not os.path.isfile(full):
            return self._send("not found", ctype="text/plain", code=404)
        ctype = {"html": "text/html; charset=utf-8", "css": "text/css",
                 "js": "application/javascript",
                 "svg": "image/svg+xml"}.get(full.rsplit(".", 1)[-1], "text/plain")
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
