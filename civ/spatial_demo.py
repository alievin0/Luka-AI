#!/usr/bin/env python3
"""THE REALITY TEST — one objective, and five agents who actually go somewhere.

    python3 spatial_demo.py --fresh
    python3 spatial_demo.py --fresh --crash-at 2   # killed mid-journey, resumed

The Owner states one objective and leaves. Everything after that happens because
a row demanded it:

    OBJECTIVE → ORCHESTRATOR → TASK → AGENT WOKEN → AGENT MOVES → ARRIVES
    → WORK → ARTIFACT → VERIFICATION → REVIEW → REJECT → CORRECTION
    → AGENT MOVES AGAIN → REVIEW → ACCEPT

Every position in this run is a row in `agent_locations`, every journey is a
sequence of rows in `movements`, and every journey names the task that caused
it. Kill the process halfway and the agent reopens partway along the same route,
because being partway somewhere is a state the world wrote down.

REAL: the coordinates, the routes, the movement state machine, the laws, the
leases, the queue, the causality. SIMULATED: the prose. `ScriptedWorker` is not
a model and is not intelligence. If no inference engine is available the run
stops at the honest state and says so rather than manufacturing an artifact.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import agent_world as W          # noqa: E402
from core import always_on as A            # noqa: E402
from core import model_gate as GATE        # noqa: E402
from core import open_world as OW          # noqa: E402
from core import store                     # noqa: E402
from core import world_bus as BUS          # noqa: E402
from core import world_policy as POL       # noqa: E402
from core import world_space as SPACE      # noqa: E402
from core import world_supervisor as SUP   # noqa: E402

import always_on_demo as D                 # noqa: E402

DB = os.path.join(HERE, "spatial-world.db")
OPERATOR = "AGT-OPERATOR"
BAR = "─" * 76


def say(s=""):
    print(s, flush=True)


def show_positions(con, title):
    say("\n  %s" % title)
    for r in con.execute("SELECT * FROM agent_locations ORDER BY principal_id"):
        p = SPACE.place(con, r["workspace"])
        fac = SPACE.place(con, p["parent_id"])
        dis = SPACE.place(con, fac["parent_id"]) if fac else None
        dest = (" → %s" % SPACE.place(con, r["destination"])["label"]
                if r["destination"] and r["movement"] == SPACE.MOVING else "")
        say("    %-18s %-9s %-22s (%5.1f,%5.1f)%s"
            % (r["principal_id"].replace("AGT-", ""), r["movement"],
               "%s / %s" % (dis["label"] if dis else "?", p["label"]),
               r["x"], r["y"], dest))


def show_journeys(con):
    say("\n  every journey, and the task that caused it:")
    rows = list(con.execute(
        "SELECT * FROM movements WHERE phase='ARRIVED' AND from_workspace IS NOT NULL "
        "ORDER BY id"))
    if not rows:
        say("    nobody moved — no task required anyone to be anywhere else")
    for m in rows:
        a = SPACE.place(con, m["from_workspace"])
        b = SPACE.place(con, m["to_workspace"])
        say("    %-14s %-20s → %-20s %6.1f units   task #%-4s"
            % (m["principal_id"].replace("AGT-", ""), a["label"] if a else "?",
               b["label"] if b else "?", m["distance"], m["task_id"]))
        say("      %s" % m["why"])


def _crash_and_reopen(con, db, fixture):
    """Kill the world mid-journey, reopen it, and check nobody teleported.

    **Constructed, and said so.** The supervisor walks a whole journey inside
    one handler call, so a crash BETWEEN ticks never catches an agent in
    transit — stopping at a tick boundary would show recovery of a world where
    everyone happens to be standing still, which proves nothing about movement.
    So a journey is started and advanced one leg here, deliberately, and THEN
    the connection is closed. What that demonstrates is real: mid-route is a
    persisted state, and it is the state the world comes back to."""
    mover = OPERATOR
    if SPACE.locate(con, mover)["movement"] == SPACE.IDLE:
        SPACE.move_to(con, mover, "ws_pad",
                      why="an operations task is waiting on the pad", worker="worker-1")
        SPACE.advance(con, mover, worker="worker-1", steps=1)
    moving = [dict(r) for r in con.execute(
        "SELECT * FROM agent_locations WHERE movement='MOVING'")]
    for m in moving:
        say("     %s was mid-route to %s at (%.1f,%.1f), %d waypoints left"
            % (m["principal_id"].replace("AGT-", ""), m["destination"],
               m["x"], m["y"], len(json.loads(m["path"]))))
    con.close()

    con = store.connect(db)
    say("  ── reopened from disk, under a different worker ──")
    for m in moving:
        n = SPACE.locate(con, m["principal_id"])
        same = all(n[c] == m[c] for c in
                   ("workspace", "destination", "x", "y", "path", "movement", "why"))
        say("     %s is still mid-route to %s at (%.1f,%.1f)  identical=%s"
            % (n["principal_id"].replace("AGT-", ""), n["destination"],
               n["x"], n["y"], same))
    for m in moving:
        SPACE.advance(con, m["principal_id"], worker="worker-2-after-the-crash",
                      steps=40)
        say("     %s finished the journey it was already on → %s"
            % (m["principal_id"].replace("AGT-", ""),
               SPACE.locate(con, m["principal_id"])["workspace"]))
    return con, D.build_world(con, fixture, worker="worker-2-after-the-crash")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB)
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--crash-at", type=int, default=0,
                    help="close the world after N ticks, reopen it, and carry on")
    ap.add_argument("--max-ticks", type=int, default=160)
    a = ap.parse_args(argv)
    if a.fresh:
        for ext in ("", "-wal", "-shm"):
            if os.path.exists(a.db + ext):
                os.remove(a.db + ext)

    con = store.connect(a.db)
    if not store.meta(con, "founded"):
        store.found(con, mode="simulation")
    W.found_agents(con)
    POL.seed(con)

    say(BAR); say("THE WORLD"); say(BAR)
    say("  districts   %d" % con.execute(
        "SELECT COUNT(*) c FROM world_places WHERE kind='district'").fetchone()["c"])
    say("  facilities  %d" % con.execute(
        "SELECT COUNT(*) c FROM world_places WHERE kind='facility'").fetchone()["c"])
    say("  workspaces  %d, total capacity %d" % tuple(con.execute(
        "SELECT COUNT(*), SUM(capacity) FROM world_places WHERE kind='workspace'"
    ).fetchone()))
    say("  laws        %d database triggers" % con.execute(
        "SELECT COUNT(*) c FROM sqlite_master WHERE type='trigger'").fetchone()["c"])
    show_positions(con, "before the objective, everyone is at the Dispatch Floor:")

    fixture = D.write_fixture()
    w = D.build_world(con, fixture, worker="worker-1")
    D.start(con, fixture)
    A.go_away(con, "running the spatial reality test")
    say("\n" + BAR); say("ONE OBJECTIVE, THEN THE OWNER LEAVES"); say(BAR)
    say("  %s" % D.OBJECTIVE)
    say("  no further command is issued.")

    if a.crash_at:
        for _ in range(a.crash_at):
            if SUP.tick(w) is None:
                break
        say("\n  ── the process is killed after %d ticks ──" % a.crash_at)
        con, w = _crash_and_reopen(con, a.db, fixture)

    SUP.run(w, max_ticks=a.max_ticks)

    say("\n" + BAR); say("WHAT HAPPENED WHILE THE OWNER WAS AWAY"); say(BAR)
    away = W.while_you_were_away(con)
    for k, v in sorted(away["counts"].items()):
        say("    %-22s %s" % (k, v))
    say("\n  the journeys, in the world's own words:")
    for m in reversed(away["movements"]):
        say("    %s moved to %s — %s"
            % (m["agent"].replace("AGT-", ""),
               SPACE.place(con, m["to"])["label"], m["why"]))
    if not away["movements"]:
        say("    nothing moved")

    show_journeys(con)
    show_positions(con, "where everyone ended up:")

    say("\n" + BAR); say("THE HONEST STATE"); say(BAR)
    st = GATE.status(con)
    say("    MODEL: %s   WORK: %s" % (st["model"], st["work"]))
    proj = con.execute("SELECT stage FROM projects ORDER BY id DESC LIMIT 1").fetchone()
    say("    project stage      %s" % (proj["stage"] if proj else "none"))
    say("    tasks accepted     %d" % con.execute(
        "SELECT COUNT(*) c FROM tasks WHERE status IN ('ACCEPTED','ARCHIVED')"
    ).fetchone()["c"])
    say("    tasks failed       %d  (a rejection that produced a correction)"
        % con.execute("SELECT COUNT(*) c FROM tasks WHERE status='FAILED'"
                      ).fetchone()["c"])
    say("    journeys           %d" % con.execute(
        "SELECT COUNT(*) c FROM movements WHERE phase='ARRIVED' "
        "AND from_workspace IS NOT NULL").fetchone()["c"])
    say("    movement rows      %d" % con.execute(
        "SELECT COUNT(*) c FROM movements").fetchone()["c"])
    say("    distance walked    %.1f units" % con.execute(
        "SELECT COALESCE(SUM(distance),0) d FROM movements WHERE phase IN "
        "('DEPARTED','WAYPOINT')").fetchone()["d"])
    ok, bad = store.verify_chain(con)
    say("    event chain        intact=%s%s" % (ok, "" if ok else " broken at %s" % bad))
    say("    queue              %s" % BUS.depth(con))
    say("\n  SIMULATED: the prose. ScriptedWorker is not a model and not "
        "intelligence.\n  REAL: every coordinate, route, law, lease and row above.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
