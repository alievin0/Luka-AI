#!/usr/bin/env python3
"""AGENT WORLD V0 — one deterministic end-to-end run.  python3 agent_world_demo.py

    Owner objective
      -> Orchestrator decomposes it into the minimum set of tasks
      -> Researcher investigates and comes back with EVIDENCE
      -> Builder turns approved findings into a real artifact on disk
      -> Reviewer independently judges it and may reject
      -> Orchestrator records the final state
      -> Owner Intelligence Center shows the whole history

Everything below is REAL persisted state: real principals, real leases, real
tool calls through the gateway, real artifacts on disk, real evidence rows, real
hash-chained events. The only simulated part is the TEXT a model would have
written, which comes from MockProvider and is labelled `source='mock'` in every
row it touches. No model is called and nothing is spent.

Run it twice and you get two projects, not one project twice: the agents
persist, the work does not pretend to.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import agent_world as W        # noqa: E402
from core import provider as P           # noqa: E402
from core import runtime, store          # noqa: E402

DB = os.path.join(HERE, "agent-world.db")
BAR = "=" * 74

OBJECTIVE = ("Investigate a real product opportunity in this repository and "
             "produce a documented opportunity brief.")

# The question the Researcher is actually sent to answer, and the file it is
# authorised to answer it from. A research task whose evidence is not on disk is
# a research task that will come back with an opinion.
SOURCE_FILE = os.path.join(W.REPO_ROOT, "civ", "README.md")


def say(*a):
    print(*a)
    sys.stdout.flush()


def run(con, prov, verbose=True):
    """The whole flow. Returns the project passport."""
    out = (lambda *a: say(*a)) if verbose else (lambda *a: None)
    gw = W.build_gateway(con)
    W.found_agents(con)

    ORCH, RES = "AGT-ORCHESTRATOR", "AGT-RESEARCHER"
    BUILD, REV = "AGT-BUILDER", "AGT-REVIEWER"

    out(BAR)
    out("OWNER OBJECTIVE")
    out(BAR)
    out("  " + OBJECTIVE)

    # ── 1. the owner hands the objective to the Orchestrator ─────────
    W.send(con, sender=ORCH, recipient=ORCH, kind="NOTIFY",
           payload={"from_owner": OBJECTIVE}, authority="owner:objective")

    pid = con.execute(
        "INSERT INTO projects(name,mission,stage,origin,created_at) "
        "VALUES(?,?,'RESEARCH',?,?)",
        ("Opportunity brief", OBJECTIVE, "owner_objective", store.now())).lastrowid
    store.event(con, "PROJECT_CREATED", actor=W.OWNER, subject="project:%d" % pid,
                payload={"objective": OBJECTIVE})

    # ── 2. the Orchestrator decomposes, and staffs the MINIMUM team ──
    team = W.form_team_for(con, ["research", "build", "review"], project_id=pid)
    out("\nORCHESTRATOR — decomposition")
    out("  team: %s" % ", ".join("%s(%s)" % (a, ",".join(c)) for a, c in team["members"]))
    out("  (the Operator is not staffed: nothing here needs execution)")

    research = W.discover_task(
        con, "Investigate the opportunity and return evidence, not opinion.",
        by=ORCH, project_id=pid, required_caps=["research"], evidence_required=1,
        conditions=[{"description": "an external source was actually read",
                     "kind": "evidence"},
                    {"description": "findings are recorded as claims", "kind": "claim"}])
    brief = W.discover_task(
        con, "Turn the approved findings into an opportunity brief artifact.",
        by=ORCH, project_id=pid, required_caps=["build"],
        conditions=[{"description": "a brief exists on disk", "kind": "artifact"}])
    review = W.discover_task(
        con, "Independently review the brief and accept or reject it.",
        by=ORCH, project_id=pid, required_caps=["review"],
        conditions=[{"description": "a review verdict is recorded", "kind": "review"}])
    out("  tasks: #%d research -> #%d build -> #%d review (build depends on research)"
        % (research, brief, review))

    # ── 3. RESEARCH ──────────────────────────────────────────────────
    out("\nRESEARCHER — investigating")
    for t in (research, brief, review):
        W.transition(con, t, "PROPOSED", ORCH, "decomposed from the owner objective")
    W.transition(con, research, "APPROVED", ORCH, "in scope and staffed")
    W.assign(con, research, RES, by=ORCH)
    lease = W.claim_task(con, RES)

    # A real tool call, through the real gateway, under a real lease.
    text = gw.call(RES, "READ_REPO", lease_id=lease["lease_id"], path=SOURCE_FILE)
    tc = con.execute("SELECT id FROM tool_calls ORDER BY id DESC LIMIT 1").fetchone()["id"]
    out("  READ_REPO %s -> %d chars (tool_call #%d)"
        % (os.path.relpath(SOURCE_FILE, W.REPO_ROOT), len(text), tc))

    ev = con.execute(
        "INSERT INTO evidence(kind,external_provenance,detail,content_sha,collected_by,"
        "collected_at) VALUES('tool',?,?,?,?,?)",
        (SOURCE_FILE, json.dumps({"tool_call": tc, "bytes": len(text)}),
         store.sha(text), RES, store.now())).lastrowid
    out("  evidence #%d recorded — provenance is the file, not the model" % ev)

    # The model writes the INTERPRETATION. It is stored as a CLAIM, and the
    # separation is the point: what was read is evidence, what it means is not.
    rid, res = runtime.invoke(con, prov, RES, "You are the Researcher.",
                              "Summarise the opportunity in: " + text[:2000],
                              lease_id=lease["lease_id"])
    interpretation = ("The repository already carries a working runtime, a tool "
                      "gateway and a benchmark harness; the gap is an owner-facing "
                      "view of what the organisation is actually doing.")
    claim_interp = con.execute(
        "INSERT INTO claims(project_id,task_id,principal_id,text,status,created_at) "
        "VALUES(?,?,?,?,'HYPOTHESIS',?)",
        (pid, research, RES, interpretation, store.now())).lastrowid
    claim_fact = con.execute(
        "INSERT INTO claims(project_id,task_id,principal_id,text,status,evidence_id,"
        "created_at) VALUES(?,?,?,?,'FACT',?,?)",
        (pid, research, RES, "civ/README.md exists and is %d bytes as read." % len(text),
         ev, store.now())).lastrowid
    out("  claim #%d HYPOTHESIS (what it means)  — no evidence required" % claim_interp)
    out("  claim #%d FACT       (what was read)  — evidence #%d required and given"
        % (claim_fact, ev))

    W.remember(con, "agent", RES, "OBSERVATION", "civ/README.md is the orientation "
               "document for the runtime.", by=RES, task_id=research)
    W.remember(con, "project", "project:%d" % pid, "CLAIM", interpretation, by=RES,
               claim_id=claim_interp, task_id=research)
    W.remember(con, "org", "ORG", "FACT", "The runtime, gateway and benchmark exist "
               "and are documented.", by=RES, evidence_id=ev, task_id=research)

    W.satisfy_condition(con, research, "an external source was actually read", RES, ev)
    W.satisfy_condition(con, research, "findings are recorded as claims", RES, claim_fact)
    W.transition(con, research, "COMPLETED", RES, "evidence and claims recorded")
    W.transition(con, research, "REVIEW", RES, "handing to the orchestrator")
    W.transition(con, research, "ACCEPTED", ORCH, "evidence is real and separated")
    W.send(con, sender=RES, recipient=ORCH, kind="REPORT", task_id=research,
           project_id=pid, evidence_id=ev, authority="researcher:report",
           lease_id=lease["lease_id"],
           payload={"evidence": ev, "fact": claim_fact, "hypothesis": claim_interp})
    W.release_lease(con, lease["lease_id"])
    out("  task #%d ACCEPTED" % research)

    # ── 4. BUILD ─────────────────────────────────────────────────────
    out("\nBUILDER — producing the artifact")
    W.transition(con, brief, "APPROVED", ORCH, "research accepted, findings are usable")
    W.assign(con, brief, BUILD, by=ORCH)
    lease2 = W.claim_task(con, BUILD)
    brid, bres = runtime.invoke(con, prov, BUILD, "You are the Builder.",
                                "Write an opportunity brief.", lease_id=lease2["lease_id"])
    body = OPPORTUNITY_BRIEF % {
        "objective": OBJECTIVE, "evidence_id": ev, "fact_id": claim_fact,
        "hypothesis_id": claim_interp, "source": os.path.relpath(SOURCE_FILE, W.REPO_ROOT),
        "interpretation": interpretation, "provider": prov.name,
    }
    path = gw.call(BUILD, "WRITE_ARTIFACT", lease_id=lease2["lease_id"],
                   path="opportunity_brief_p%d.md" % pid, body=body)
    art = con.execute(
        "INSERT INTO artifacts(project_id,task_id,run_id,principal_id,kind,name,path,"
        "body,sha,source,created_at) VALUES(?,?,?,?,'document',?,?,?,?,?,?)",
        (pid, brief, brid, BUILD, os.path.basename(path), path, body,
         store.sha(body), bres.source, store.now())).lastrowid
    out("  artifact #%d %s (%d bytes, source=%s)"
        % (art, os.path.basename(path), len(body), bres.source))
    W.satisfy_condition(con, brief, "a brief exists on disk", BUILD, art)
    W.transition(con, brief, "COMPLETED", BUILD, "artifact written")
    W.send(con, sender=BUILD, recipient=REV, kind="REVIEW_REQUEST", task_id=brief,
           project_id=pid, artifact_id=art, authority="builder:handoff",
           lease_id=lease2["lease_id"], payload={"artifact": art})
    W.release_lease(con, lease2["lease_id"])

    # ── 5. REVIEW — independent, and able to reject ──────────────────
    out("\nREVIEWER — independent judgement")
    W.transition(con, brief, "REVIEW", BUILD, "handed to the reviewer")
    W.transition(con, review, "APPROVED", ORCH, "there is something to review")
    W.assign(con, review, REV, by=ORCH)
    lease3 = W.claim_task(con, REV)
    seen = gw.call(REV, "READ_REPO", lease_id=lease3["lease_id"], path=path)
    # The reviewer checks ASSERTIONS about the world, which live in the two
    # findings sections. Bullets under "What would turn the hypothesis into a
    # fact" are proposals, not assertions, and demanding evidence for a proposal
    # is how a reviewer turns into a rubber stamp for whoever writes the most
    # citations.
    unbacked = [ln for ln in assertions(seen)
                if "evidence #" not in ln and "claim #" not in ln]
    verdict = "APPROVE" if not unbacked else "REQUEST_CHANGES"
    rationale = ("Every assertion is tied to evidence #%d or to a numbered claim; "
                 "the hypothesis is labelled as one." % ev) if verdict == "APPROVE" else \
                ("%d assertion(s) carry no evidence or claim reference." % len(unbacked))
    rev_id = con.execute(
        "INSERT INTO reviews(artifact_id,reviewer_id,domain,verdict,rationale,"
        "evidence_id,created_at) VALUES(?,?,'evidence',?,?,?,?)",
        (art, REV, verdict, rationale, ev, store.now())).lastrowid
    out("  review #%d by %s: %s" % (rev_id, REV, verdict))
    out("  rationale: %s" % rationale)
    W.satisfy_condition(con, review, "a review verdict is recorded", REV, rev_id)
    W.transition(con, review, "COMPLETED", REV, "verdict recorded")
    W.transition(con, review, "REVIEW", REV, "to the orchestrator")
    W.transition(con, review, "ACCEPTED", ORCH, "review is independent and reasoned")
    W.send(con, sender=REV, recipient=ORCH, kind="REVIEW_RESULT", task_id=brief,
           project_id=pid, artifact_id=art, authority="reviewer:verdict",
           lease_id=lease3["lease_id"], payload={"verdict": verdict, "review": rev_id})
    W.release_lease(con, lease3["lease_id"])

    # ── 6. the Orchestrator records the outcome ──────────────────────
    W.transition(con, brief, "ACCEPTED" if verdict == "APPROVE" else "REJECTED",
                 "AGT-ORCHESTRATOR", "reviewer said %s" % verdict)
    con.execute("UPDATE projects SET stage='VALIDATION' WHERE id=?", (pid,))
    W.remember(con, "org", "ORG", "DECISION",
               "Opportunity brief for project %d was %s by the reviewer."
               % (pid, verdict), by=ORCH, task_id=brief)
    out("\nORCHESTRATOR — recorded: brief %s"
        % ("ACCEPTED" if verdict == "APPROVE" else "REJECTED"))
    return W.project_passport(con, pid)


def assertions(doc):
    """The lines of a brief that assert something about the world."""
    out, live = [], False
    for ln in doc.splitlines():
        if ln.startswith("## "):
            live = ln.strip() in ("## What was actually read",
                                  "## What that is taken to mean")
            continue
        if live and ln.startswith("- "):
            out.append(ln)
    return out


OPPORTUNITY_BRIEF = """# Opportunity brief

> Produced by AGT-BUILDER inside the agent world. The prose in this document was
> generated by provider `%(provider)s` and is SIMULATED content; every reference
> below points at a real row in the world database.

## Objective
%(objective)s

## What was actually read
- source: `%(source)s` — recorded as evidence #%(evidence_id)d
- fact: claim #%(fact_id)d, backed by evidence #%(evidence_id)d

## What that is taken to mean
- hypothesis: claim #%(hypothesis_id)d — %(interpretation)s

This is a HYPOTHESIS, not a fact. It has no evidence row and is not entitled to
one: nothing was measured, surveyed or executed to support it.

## What would turn the hypothesis into a fact
- an owner using the view and reporting whether it answered their question
- a measured reduction in "what happened while I was away" being unanswerable

## Next required action
Owner decision on whether to fund the view.
"""


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB)
    ap.add_argument("--fresh", action="store_true", help="start a new world file")
    a = ap.parse_args(argv)
    if a.fresh:
        for ext in ("", "-wal", "-shm"):
            if os.path.exists(a.db + ext):
                os.remove(a.db + ext)
    con = store.connect(a.db)
    if not store.meta(con, "founded"):
        store.found(con, mode="simulation")
    passport = run(con, P.MockProvider())

    say("\n" + BAR)
    say("PROJECT PASSPORT")
    say(BAR)
    say("  objective : %s" % passport["objective"])
    say("  status    : %s" % passport["status"])
    say("  team      : %s" % ", ".join(m["agent"] for m in passport["team"]))
    for t in passport["tasks"]:
        say("  task #%-3d %-10s %-18s %s"
            % (t["id"], t["status"], t["assignee"] or "-", t["objective"][:40]))
    say("  artifacts : %s" % ", ".join(x["name"] for x in passport["artifacts"]))
    say("  evidence  : %d row(s)" % len(passport["evidence"]))
    say("  claims    : %s" % ", ".join("#%d %s" % (c["id"], c["status"])
                                       for c in passport["claims"]))
    say("  reviews   : %s" % ", ".join("#%d %s" % (r["id"], r["verdict"])
                                       for r in passport["reviews"]))
    say("  blockers  : %s" % (passport["blockers"] or "none"))
    say("  next      : %s" % passport["next_required_action"])

    say("\n" + BAR)
    say("WHILE YOU WERE AWAY")
    say(BAR)
    away = W.while_you_were_away(con)
    if away["quiet"]:
        say("  nothing happened. The world is allowed to be quiet.")
    for k, v in sorted(away["counts"].items()):
        say("  %-22s %d" % (k.replace("_", " "), v))
    say("  %-22s %d" % ("decisions waiting", away["decisions_waiting"]))

    say("\n" + BAR)
    say("WORLD STATE  (what a UI may draw, and nothing else)")
    say(BAR)
    st = W.world_state(con)
    say("  agents running : %s" % (st["running"] or "none"))
    say("  agents idle    : %s" % ", ".join(st["idle"]))
    say("  tasks by state : %s" % st["tasks_by_state"])
    say("  quiet          : %s  <- no animation may imply otherwise" % st["quiet"])
    ok, bad = store.verify_chain(con)
    say("\n  event chain intact: %s%s" % (ok, "" if ok else " (broken at %s)" % bad))
    say("  world file: %s" % os.path.relpath(a.db, HERE))
    return 0


if __name__ == "__main__":
    sys.exit(main())
