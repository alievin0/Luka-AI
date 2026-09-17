#!/usr/bin/env python3
"""THE ORGANISATIONAL CHAIN, end to end:

  DISCOVERY → IDEA → OPPORTUNITY → PROJECT → TEAM → TASK → BUILD → ARTIFACT
  → VERIFICATION → REVIEW → EVIDENCE → OWNER SIGNAL

Runs in SIMULATION mode with MockProvider. Content is mock and labelled; the
structure, the gates and the evidence are real. Running it live is gated on G1.

    python3 org_demo.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import contract as K       # noqa: E402
from core import factory as F        # noqa: E402
from core import org                 # noqa: E402
from core import provider as P       # noqa: E402
from core import store               # noqa: E402
from core.store import now           # noqa: E402
import slice as vslice               # noqa: E402

BAR = "─" * 74


def run(con, verbose=True):
    def say(*a):
        if verbose:
            print(*a)

    out = {}
    say(BAR); say("DISCOVERY → IDEA → OPPORTUNITY → PROJECT"); say(BAR)

    # 1. DISCOVERY — observation and interpretation kept apart
    did, _ = org.discover(
        con, "Three separate workshops described re-entering the same invoice in three systems",
        source="mock", by_agent="AGT-000001",
        interpretation="the cost may be re-entry labour rather than the software licence",
        confidence=0.35)
    out["discovery_id"] = did
    say("  DISCOVERY #%d recorded (observation ≠ interpretation, confidence 0.35)" % did)

    # 2. IDEA — memory searched first
    iid, prior = org.propose_idea(
        con, problem="workshops re-enter each invoice into three systems",
        by_agent="AGT-000001", source="mock",
        solution="one entry point that writes to all three",
        target_user="independent vehicle workshops",
        origin_type="DISCOVERY", origin_id=did,
        assumptions=["they would change tools", "the three systems have APIs"],
        validation_plan="find one workshop that already pays someone to do this")
    out["idea_id"] = iid
    say("  IDEA #%d proposed (%d similar prior item(s) found)" % (iid, len(prior)))

    # 3. OPPORTUNITY — must be validated before it may become a project
    oid, _ = org.raise_opportunity(
        con, problem="workshops pay a bookkeeper for manual re-entry", source="market",
        by_agent="AGT-000001", idea_id=iid,
        required_caps=["CAP-research", "CAP-build", "CAP-verify"],
        validation_plan="one paying workshop, named, with a date")
    out["opportunity_id"] = oid
    say("  OPPORTUNITY #%d raised — status NEW" % oid)

    try:
        org.create_project(con, "Premature", "m", "OPPORTUNITY", oid, "AGT-000001")
        say("  !! the validation gate did not hold")
    except org.GateError as e:
        say("  GATE held: %s" % e)

    ev_val = con.execute(
        "INSERT INTO evidence(kind,external_provenance,detail,content_sha,collected_by,"
        "collected_at) VALUES('interview','recorded call 2026-09-17 with named workshop',"
        "'pays KD 90/month to a bookkeeper for re-entry','sha-demo','AGT-000001',?)",
        (now(),)).lastrowid
    con.execute("UPDATE opportunities SET status='VALIDATED', evidence_id=? WHERE id=?",
                (ev_val, oid))
    say("  OPPORTUNITY #%d VALIDATED against evidence #%d" % (oid, ev_val))

    # 4. PROJECT + capabilities + team
    pid, prior = org.create_project(
        con, "One Entry", "Remove triple invoice entry for workshops",
        "OPPORTUNITY", oid, "AGT-000001",
        hypothesis="a single entry point removes 2 of 3 re-entries")
    out["project_id"] = pid
    say("  PROJECT #%d created from OPPORTUNITY:%d" % (pid, oid))

    for cid, holder in (("CAP-research", "AGT-000001"), ("CAP-build", "AGT-000002"),
                        ("CAP-verify", "AGT-000003"), ("CAP-judge", "AGT-000004")):
        con.execute("INSERT OR IGNORE INTO capabilities(id,name,description,created_at) "
                    "VALUES(?,?,?,?)", (cid, cid, "demo capability", now()))
        con.execute("INSERT OR IGNORE INTO agent_capabilities VALUES(?,?)", (holder, cid))
    con.execute("UPDATE principals SET lifecycle_state='ACTIVE'")

    tid, chosen, unmet = org.form_team(
        con, pid, ["CAP-research", "CAP-build", "CAP-verify", "CAP-judge", "CAP-nobody"])
    out["team_id"] = tid
    say("  TEAM #%d formed: %d seat(s) filled, unmet: %s" % (tid, len(chosen), unmet or "none"))
    for c in chosen:
        say("      %s ← %s" % (c["agent"], c["why"]))

    # 5. skills: acquired, then actually evaluated
    F.create_skill(con, "SKL-invoice-mapping", "Invoice field mapping",
                   "Map fields between accounting systems", "AGT-000001",
                   tests=["bench-map-01"])
    F.acquire_skill(con, "AGT-000002", "SKL-invoice-mapping")
    F.evaluate_skill(con, "AGT-000002", "SKL-invoice-mapping", 0.72)
    say("  SKILL acquired then EVALUATED at 0.72 (holding ≠ competent)")

    # 6. the factory answers a real gap — and usually not with a new agent
    aid, jid, rep = F.create_agent(
        con, "AGT-000001", "analyse recorded Arabic workshop interviews for pricing signals",
        K.blank("AGT-000910", "Rania", "Arabic Interview Analyst",
                "Discovery & Intelligence", "Research",
                "Turn recorded Arabic interviews into evidence rows.") | {
            "tools": ["transcriber"], "permissions": ["READ_ARTIFACT"],
            "memory_scope": ["self", "project"],
            "success_metrics": [{"metric": "evidence_rows", "target": 3}],
            "escalation_rules": [{"when": "no_payer_named", "action": "ESCALATE"}]},
        expected_value="unblocks GCC validation", required_caps=["CAP-arabic-interview"])
    out["factory_job"], out["new_agent"] = jid, aid
    say("  FACTORY job #%d → %s%s" % (jid, rep["decision"],
                                      (" (%s)" % aid) if aid else ""))
    say("      %s" % rep.get("rationale", ""))

    # 7. permissions: only the owner plane may issue them
    if aid:
        K.transition(con, aid, "EVALUATING")
        K.grant(con, aid, "READ_ARTIFACT", resource="project:%d" % pid,
                granted_by="OWNER_PLANE")
        say("  PERMISSION granted to %s by the owner plane (never self-issued)" % aid)

    # 8. the runtime slice: task → lease → run → artifact → verification → review
    say(); say(BAR); say("BUILD → ARTIFACT → VERIFICATION → REVIEW → EVIDENCE"); say(BAR)
    slice_out = vslice.run_slice(con, P.MockProvider(), verbose=verbose)
    out.update({k: slice_out.get(k) for k in
                ("run_id", "artifact_id", "evidence_id", "review", "owner_signal_id",
                 "approval_id")})

    # 9. an experiment that does NOT validate — and is recorded that way
    say(); say(BAR); say("EXPERIMENT → DISAGREEMENT → FAILURE → SIGNALS"); say(BAR)
    xid = org.design_experiment(
        con, pid, "workshops will pay KD 20/month for one entry point",
        "ask 20 qualified workshops for a paid pilot",
        "4 or more of 20 commit", "fewer than 4 commit", "AGT-000001",
        agents=["AGT-000001"], usd_budget=0.0, why="the whole project rests on it")
    ev_x = con.execute(
        "INSERT INTO evidence(kind,external_provenance,detail,content_sha,collected_by,"
        "collected_at) VALUES('survey','tally sheet 2026-09-17','3 of 20 committed',"
        "'sha-x','AGT-000001',?)", (now(),)).lastrowid
    org.complete_experiment(con, xid, "NOT_VALIDATED", ev_x,
                            "3 of 20 — below the pre-registered bar of 4",
                            "do not scale; re-test price or re-test channel", "AGT-000001")
    out["experiment_id"] = xid
    say("  EXPERIMENT #%d → NOT_VALIDATED (3/20 against a pre-registered bar of 4)" % xid)

    # 10. disagreement is preserved, not averaged
    dis = org.open_disagreement(con, "project", pid)
    org.take_position(con, dis, "AGT-000002", "PROMISING",
                      "the build is two weeks", 0.7)
    org.take_position(con, dis, "AGT-000004", "HIGH_RISK",
                      "no payer has been named at the asked price", 0.85,
                      evidence_id=ev_x, missing_evidence="one workshop paying KD 20",
                      resolving_experiment=xid)
    org.take_position(con, dis, "AGT-000003", "UNCERTAIN",
                      "the three systems may not expose APIs", 0.5)
    out["disagreement_id"] = dis
    v = org.disagreement_view(con, dis)
    say("  DISAGREEMENT #%d: %s — preserved, not averaged" % (dis, ", ".join(v["stances"])))

    # 11. failure memory
    fid = org.record_failure(
        con, "experiment", xid, "only 3 of 20 workshops committed",
        "the price was tested before the channel was proven", 
        "test the channel before the price; a no at the wrong door is not a no",
        "AGT-000004", failed_assumption="workshops would answer a cold approach",
        agents=["AGT-000001"], evidence_id=ev_x)
    out["failure_id"] = fid
    say("  FAILURE #%d recorded as searchable knowledge" % fid)

    # 12. cross-project + signal engine
    org.create_project(con, "Clinic Entry", "Remove triple invoice entry for clinics",
                       "OWNER", None, "OWNER",
                       hypothesis="the same re-entry problem exists in clinics")
    xs = org.detect_cross_project(con)
    out["cross_signals"] = len(xs)
    for x in xs:
        say("  CROSS-PROJECT: %s %s (%.0f%%)" % (x["kind"], x["refs"], x["strength"] * 100))
    made = org.run_signal_engine(con)
    out["signals_made"] = len(made)
    say("  SIGNAL ENGINE raised %d owner signal(s) from raw events" % len(made))
    return out


def main():
    con = store.connect()
    if not store.meta(con, "founded"):
        store.found(con, mode="simulation")
    vslice.register_crew(con)
    print("=" * 74)
    print("ORGANISATIONAL CHAIN — mode=%s, provider=mock" % store.meta(con, "mode"))
    print("Content is MOCK and labelled. Structure, gates and evidence are real.")
    print("=" * 74)
    out = run(con)
    print()
    print("=" * 74)
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
