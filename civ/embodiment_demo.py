#!/usr/bin/env python3
"""THE EMBODIMENT TEST — five agents with bodies, and one chain you can follow.

    python3 embodiment_demo.py --fresh

The mission asks for one demonstration in which every link is real:

    REAL TASK → REAL AGENT → REAL STATE TRANSITION → REAL EMBODIMENT UPDATE
    → REAL MOVEMENT → REAL WORKSTATION ACTIVITY → REAL TOOL EVENT
    → REAL ARTIFACT → REAL REVIEW → REAL FINAL STATE

This is that chain, printed with the row behind each link. Nothing in this file
poses an agent, invents an activity or nudges a body. It reads `agent_bodies`,
`workstations`, `agent_locations`, `movements`, `leases`, `tool_calls`,
`artifacts` and `reviews` and prints what they say — and when they say nothing,
it prints that the agent is idle, which is the honest answer and the one the
renderer is required to show.

REAL: the bodies, the seats, the derived activity, the movement, the laws.
SIMULATED: the prose inside the artifacts. `ScriptedWorker` is not a model.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import agent_world as W          # noqa: E402
from core import always_on as A            # noqa: E402
from core import embodiment as EMB         # noqa: E402
from core import store                     # noqa: E402
from core import world_policy as POL       # noqa: E402
from core import world_space as SPACE      # noqa: E402
from core import world_supervisor as SUP   # noqa: E402

import always_on_demo as D                 # noqa: E402

DB = os.path.join(HERE, "embodied-world.db")
BAR = "─" * 78


def say(s=""):
    print(s, flush=True)


def show_bodies(con):
    say("\n" + BAR)
    say("THE BODIES — written once, at founding, and never redesigned")
    say(BAR)
    for b in con.execute("SELECT * FROM agent_bodies ORDER BY principal_id"):
        say("  %-14s %s" % (b["principal_id"].replace("AGT-", ""), b["body_id"]))
        say("      %-8s %-6s %-6s %-6s   %s %.2fm"
            % (b["body_variant"], b["head_variant"], b["chest_variant"],
               b["sensor_variant"], b["build"], b["height"]))
        say("      %-16s %s %s %s  %s"
            % (b["palette"], b["primary_color"], b["secondary_color"],
               b["accent_color"], b["material"]))
        say("      marking %-6s  carries: %s" % (b["marking"], b["equipment"]))


def show_embodiment(con, title):
    """Where every agent is, what it is standing on, and what it is doing —
    each with the row that says so."""
    say("\n  %s" % title)
    for aid in sorted(EMB.all_embodiments(con)):
        e = EMB.embodiment(con, aid)
        p = SPACE.place(con, e["workspace"])
        seat = e["station"] or "—"
        say("    %-13s %-10s %-9s %-22s seat %-12s"
            % (aid.replace("AGT-", ""), e["activity_state"], e["animation_state"],
               p["label"] if p else "?", seat))
        say("        because: %s" % e["because"])


def show_chain(con):
    """The end-to-end chain, link by link, each printed from its own table."""
    say("\n" + BAR)
    say("THE CHAIN — every link is a row, and the row is named")
    say(BAR)
    # The chain the mission asks for needs every link present, so pick the
    # lowest-numbered task that actually HAS them all. That is a selection, not
    # an embellishment: the task is printed by number and anyone can check it.
    t = con.execute(
        "SELECT t.* FROM tasks t WHERE t.status IN ('ACCEPTED','ARCHIVED') "
        "  AND EXISTS (SELECT 1 FROM leases l WHERE l.task_id=t.id) "
        "  AND EXISTS (SELECT 1 FROM artifacts a WHERE a.task_id=t.id) "
        "  AND EXISTS (SELECT 1 FROM movements m WHERE m.task_id=t.id "
        "              AND m.phase='ARRIVED' AND m.from_workspace IS NOT NULL) "
        "ORDER BY t.id LIMIT 1").fetchone()
    if t is None:
        say("  no task ran the whole way through — there is no chain to show, and")
        say("  inventing one is exactly what this file exists not to do.")
        return
    tid = t["id"]
    say("  REAL TASK          #%d  %s" % (tid, t["objective"]))
    say("                     status %s, caps %s" % (t["status"], t["required_caps"]))

    le = con.execute("SELECT * FROM leases WHERE task_id=? ORDER BY id", (tid,)).fetchall()
    if le:
        say("  REAL AGENT         %s  (lease #%d, granted %s)"
            % (le[0]["principal_id"].replace("AGT-", ""), le[0]["id"],
               le[0]["granted_at"]))
    agent = le[0]["principal_id"] if le else None

    say("  REAL TRANSITIONS   " + " → ".join(
        r["to_state"] for r in con.execute(
            "SELECT to_state FROM task_transitions WHERE task_id=? ORDER BY id", (tid,))))

    mv = [dict(r) for r in con.execute(
        "SELECT * FROM movements WHERE task_id=? AND phase='ARRIVED' "
        "AND from_workspace IS NOT NULL ORDER BY id", (tid,))]
    if mv:
        for m in mv:
            a = SPACE.place(con, m["from_workspace"])
            b = SPACE.place(con, m["to_workspace"])
            say("  REAL MOVEMENT      %s: %s → %s, %.1f units"
                % (m["principal_id"].replace("AGT-", ""),
                   a["label"] if a else "?", b["label"] if b else "?", m["distance"]))
            say("                     why: %s" % m["why"])
    else:
        say("  REAL MOVEMENT      none — the agent was already where this task belongs")

    if agent:
        st = EMB.station_of(con, agent)
        if st:
            say("  REAL WORKSTATION   %s at (%.1f,%.1f) facing %.2f rad, kind %s"
                % (st["id"], st["x"], st["y"], st["facing"], st["kind"]))
        else:
            say("  REAL WORKSTATION   none held")

    tc = con.execute(
        "SELECT tc.* FROM tool_calls tc JOIN leases l ON l.id=tc.lease_id "
        "WHERE l.task_id=? ORDER BY tc.id", (tid,)).fetchall()
    for c in tc:
        say("  REAL TOOL EVENT    %s → %s (call #%d, cap %s)"
            % (c["tool"], c["decision"], c["id"], c["cap"]))

    ar = con.execute("SELECT * FROM artifacts WHERE task_id=? ORDER BY id", (tid,)).fetchall()
    for x in ar:
        say("  REAL ARTIFACT      #%d %s \"%s\", %d bytes, sha %s"
            % (x["id"], x["kind"], x["name"], len(x["body"] or ""), (x["sha"] or "")[:12]))

    rv = con.execute(
        "SELECT r.* FROM reviews r JOIN artifacts a ON a.id=r.artifact_id "
        "WHERE a.task_id=? ORDER BY r.id", (tid,)).fetchall()
    for r in rv:
        say("  REAL REVIEW        #%d %s by %s (%s) — %s"
            % (r["id"], r["verdict"], r["reviewer_id"].replace("AGT-", ""),
               r["domain"], (r["rationale"] or "")[:48]))

    say("  REAL FINAL STATE   task #%d is %s" % (tid, t["status"]))
    if agent:
        e = EMB.embodiment(con, agent)
        say("                     %s is %s / %s — %s"
            % (agent.replace("AGT-", ""), e["activity_state"],
               e["animation_state"], e["because"]))


def show_quiet(con):
    """The test that matters most: when nothing is happening, does the world
    say so? An idle agent must animate as idle, not as busy."""
    say("\n" + BAR)
    say("WHEN THERE IS NO WORK — the world is required to be boring")
    say(BAR)
    live = con.execute("SELECT COUNT(*) c FROM leases WHERE status='ACTIVE'"
                       ).fetchone()["c"]
    say("  live leases        %d" % live)
    say("  lit workstations   %d  (a desk is lit by a lease, never by a clock)"
        % len(EMB.active_stations(con)))
    idle = [a for a in EMB.all_embodiments(con)
            if EMB.embodiment(con, a)["animation_state"] == EMB.ANIMATION[EMB.IDLE]]
    say("  agents animating idle  %d of %d" % (len(idle), len(EMB.all_embodiments(con))))


def show_encounters(con):
    say("\n  agents standing together, from real messages (never scripted):")
    enc = EMB.encounters(con)
    if not enc:
        say("    nobody is meeting anybody — no message says they are")
    for e in enc:
        say("    %-13s → %-13s %-16s task #%-4s msg #%s"
            % (e["from"].replace("AGT-", ""), e["to"].replace("AGT-", ""),
               e["kind"], e["task_id"], e["id"]))


def show_restart(con, db):
    """A body that changed across a restart would not be an identity."""
    before = {b["principal_id"]: dict(b) for b in
              con.execute("SELECT * FROM agent_bodies")}
    seats = {r["occupied_by"]: r["id"] for r in
             con.execute("SELECT * FROM workstations WHERE occupied_by IS NOT NULL")}
    con.close()

    say("\n" + BAR)
    say("RESTART — the same bodies come back, in the same seats")
    say(BAR)
    con = store.connect(db)
    W.found_agents(con)                     # founding again must change nothing
    after = {b["principal_id"]: dict(b) for b in
             con.execute("SELECT * FROM agent_bodies")}
    same = all(before[k] == after.get(k) for k in before)
    say("  bodies identical after reopen + re-founding   %s" % same)
    seats2 = {r["occupied_by"]: r["id"] for r in
              con.execute("SELECT * FROM workstations WHERE occupied_by IS NOT NULL")}
    say("  seats identical                               %s" % (seats == seats2))
    try:
        con.execute("UPDATE agent_bodies SET primary_color='#ff0000' "
                    "WHERE principal_id='AGT-RESEARCHER'")
        say("  LAW 43 allowed a redesign                     NO — THIS IS A BUG")
    except Exception as ex:
        say("  LAW 43 refuses a redesign                     %s" % str(ex)[:54])
    return con


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB)
    ap.add_argument("--fresh", action="store_true")
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

    show_bodies(con)
    say("\n  %d workstations fitted across the campus"
        % con.execute("SELECT COUNT(*) c FROM workstations").fetchone()["c"])
    show_embodiment(con, "before any task exists, everyone is idle:")
    show_quiet(con)

    fixture = D.write_fixture()
    w = D.build_world(con, fixture, worker="worker-1")
    D.start(con, fixture)
    A.go_away(con, "running the embodiment test")
    say("\n" + BAR)
    say("ONE OBJECTIVE, THEN THE OWNER LEAVES")
    say(BAR)
    say("  %s" % D.OBJECTIVE)
    SUP.run(w, max_ticks=a.max_ticks)

    show_chain(con)
    show_embodiment(con, "where everyone ended up, and what each body is doing:")
    show_encounters(con)
    show_quiet(con)
    con = show_restart(con, a.db)

    say("\n" + BAR)
    say("WHAT IS REAL HERE")
    say(BAR)
    say("  %d bodies, each a row in agent_bodies, written once at founding."
        % con.execute("SELECT COUNT(*) c FROM agent_bodies").fetchone()["c"])
    say("  %d workstations, each a row; a seat is held by a guarded UPDATE."
        % con.execute("SELECT COUNT(*) c FROM workstations").fetchone()["c"])
    say("  %d journeys, each naming the task that caused it."
        % con.execute("SELECT COUNT(*) c FROM movements WHERE phase='ARRIVED' "
                      "AND from_workspace IS NOT NULL").fetchone()["c"])
    say("  %d database triggers enforce all of it."
        % con.execute("SELECT COUNT(*) c FROM sqlite_master WHERE type='trigger'"
                      ).fetchone()["c"])
    say("  The animation is DERIVED from those rows. No animation exists that")
    say("  does not correspond to one, which is why an idle world looks idle.")
    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
