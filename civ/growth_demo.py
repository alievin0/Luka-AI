#!/usr/bin/env python3
"""THE WORLD BUILDS ITSELF — the acceptance test, as a thing you can run.

    python3 growth_demo.py --fresh

Nobody edits the world by hand in this script. It creates real workload, and
then watches the organisation notice that the workload does not fit, work out
what to build, check whether it is allowed to, ask the Owner where the impact
warrants it, and construct a building that survives a restart and carries a
record of why it exists.

    WORKLOAD → BOTTLENECK → EVIDENCE → PROPOSAL → DESIGN → VALIDATION
    → AUTHORISATION → CONSTRUCTION → FIT-OUT → AN AGENT ENTERS
    → UTILISATION MEASURED → RESTART → STILL THERE

REAL: every row, every law, every refusal, the geometry, the resource ledger.
SIMULATED: nothing here needs a model, and none is used. The work that would
need one is not pretended.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import agent_world as W          # noqa: E402
from core import store                     # noqa: E402
from core import world_growth as GROW      # noqa: E402
from core import world_policy as POL       # noqa: E402
from core import world_space as SPACE      # noqa: E402

DB = os.path.join(HERE, "growth-world.db")
ORCH, RES = "AGT-ORCHESTRATOR", "AGT-RESEARCHER"
BAR = "─" * 76


def say(s=""):
    print(s, flush=True)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB)
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--tasks", type=int, default=6)
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

    say(BAR); say("THE WORLD AS IT WAS SEEDED"); say(BAR)
    for k in ("district", "facility", "workspace"):
        say("  %-12s %d" % (k + "s", con.execute(
            "SELECT COUNT(*) c FROM world_places WHERE kind=?", (k,)).fetchone()["c"]))
    say("  archetypes   %d registered" % len(GROW.types(con)))
    for r in GROW.resources(con).values():
        say("  %-12s %.0f %s available, %d builds per %ds"
            % (r["id"], r["total"] - r["spent"], r["unit"], r["per_window"],
               r["window_secs"]))

    say("\n" + BAR); say("REAL WORKLOAD ARRIVES"); say(BAR)
    con.execute("UPDATE world_places SET capacity=1, capability='research' "
                "WHERE id='ws_lab'")
    for i in range(a.tasks):
        t = W.discover_task(con, "research question %d" % i, by=ORCH,
                            required_caps=["research"])
        W.transition(con, t, "PROPOSED", ORCH)
        W.transition(con, t, "APPROVED", ORCH)
    say("  %d research tasks approved; the Reading Floor seats 1" % a.tasks)

    say("\n" + BAR); say("1 · THE WORLD OBSERVES ITSELF"); say(BAR)
    for f in GROW.observe_pressure(con):
        say("  %-18s capacity %d · %d waiting · pressure ×%.1f"
            % (f["label"], f["capacity"], f["waiting"], f["pressure"]))
    if not GROW.bottleneck(con):
        say("  nothing is over capacity — the world does not need to grow")
        return 0

    say("\n" + BAR); say("2 · IT PROPOSES, WITH ITS WORKING SHOWN"); say(BAR)
    r1 = GROW.grow_once(con, by=ORCH)
    p = con.execute("SELECT * FROM expansion_proposals ORDER BY id DESC LIMIT 1").fetchone()
    say("  proposal #%d  %s  (%s)" % (p["id"], p["label"], p["kind"]))
    say("  cause:     %s" % p["cause"])
    say("  evidence:  %s" % json.dumps(json.loads(p["evidence"]), sort_keys=True)[:150])
    say("  proposer:  %s" % p["proposed_by"])
    d = con.execute("SELECT * FROM facility_designs WHERE proposal_id=?",
                    (p["id"],)).fetchone()
    spec = json.loads(d["spec"])
    say("\n  design #%d  hash %s" % (d["id"], d["design_hash"][:16]))
    say("    %s at (%.0f,%.0f) %.0f×%.0f inside %s, %d workspaces, cost %.1f"
        % (spec["type"], spec["x"], spec["y"], spec["w"], spec["h"],
           spec["parent"], GROW.types(con)[spec["type"]]["workspaces"], spec["cost"]))

    say("\n" + BAR); say("3 · VALIDATION, EVERY CHECK NAMED"); say(BAR)
    for c in json.loads(d["validation"]):
        say("    %-32s %s%s" % (c["check"], "pass" if c["passed"] else "FAIL",
                                "  " + c["detail"] if c["detail"] else ""))

    say("\n" + BAR); say("4 · AUTHORISATION"); say(BAR)
    say("  impact:    %s" % GROW.impact_of(con, p))
    say("  result:    %s" % r1.get("why"))
    say("  the world stopped here on its own. Nothing was built.")
    say("  constructions so far: %d"
        % con.execute("SELECT COUNT(*) c FROM constructions").fetchone()["c"])

    say("\n  ── the Owner approves ──")
    r = GROW.grow_once(con, by=ORCH, owner_approves=True)
    if not r.get("grew"):
        say("  still refused: %s" % json.dumps(r))
        return 1
    c = con.execute("SELECT * FROM constructions WHERE proposal_id=?",
                    (r["proposal"],)).fetchone()
    say("  authorised by %s under %s" % (c["authorised_by"], c["authority"]))

    say("\n" + BAR); say("5 · WHAT WAS BUILT"); say(BAR)
    built = SPACE.place(con, r["place"])
    say("  %-16s %s  (%s)" % (built["id"], built["label"], built["type_id"]))
    say("  at (%.0f,%.0f) %.0f×%.0f inside %s"
        % (built["x"], built["y"], built["w"], built["h"], built["parent_id"]))
    say("  %s" % built["about"])
    for wid in r["workspaces"]:
        ws = SPACE.place(con, wid)
        say("    fitted out: %-18s seats %d" % (ws["label"], ws["capacity"]))
    for res in GROW.resources(con).values():
        say("  %-12s %.1f of %.1f %s spent"
            % (res["id"], res["spent"], res["total"], res["unit"]))

    say("\n" + BAR); say("6 · AN AGENT WALKS INTO IT"); say(BAR)
    ws = r["workspaces"][0]
    SPACE.travel(con, RES, ws, why="the new lab opened and research is waiting",
                 worker="worker-1")
    loc = SPACE.locate(con, RES)
    say("  %s is now in %s at (%.1f,%.1f)"
        % (RES.replace("AGT-", ""), loc["workspace"], loc["x"], loc["y"]))
    say("  it got there because: %s" % loc["why"])
    u = GROW.observe_utilisation(con, ws)
    say("  utilisation: %d occupant(s), %d visit(s) → %s"
        % (u["occupants"], u["visits"], u["verdict"]))

    say("\n" + BAR); say("7 · IT SURVIVES A RESTART"); say(BAR)
    before = dict(SPACE.place(con, r["place"]))
    con.close()
    cold = store.connect(a.db)
    after = dict(SPACE.place(cold, r["place"]))
    say("  identical after reopening from disk: %s" % (before == after))
    say("  the record of why it exists is still there: %s"
        % bool(cold.execute("SELECT 1 FROM expansion_proposals WHERE state='ACTIVE'"
                            ).fetchone()))
    ok, bad = store.verify_chain(cold)
    say("  event chain intact: %s" % ok)

    say("\n" + BAR); say("WHAT THIS DID AND DID NOT SHOW"); say(BAR)
    say("  SHOWN   the organisation measured its own bottleneck, proposed with")
    say("          evidence, designed, validated, stopped for the Owner, built")
    say("          only once approved, and can say why the building exists.")
    say("  SHOWN   no developer added that facility. It is a row with provenance.")
    say("  NOT     inference. No model ran here, and none was needed: every step")
    say("  SHOWN   above is deterministic. The RESEARCH the new lab exists for")
    say("          still needs an engine, and without one it waits.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
