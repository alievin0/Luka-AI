#!/usr/bin/env python3
"""OWNER CONTROL PLANE — deterministic code. No model reaches this file.

  python3 owner.py status          what the world is, and what it is not
  python3 owner.py feed            What's New — signals, not raw noise
  python3 owner.py projects        every project and its stage
  python3 owner.py built           What They Built — the artifact gallery
  python3 owner.py did             What They Did — real actions only
  python3 owner.py evidence        every evidence row and its provenance
  python3 owner.py agents          the registry, with tier and autonomy
  python3 owner.py reviews         independent reviews and verdicts
  python3 owner.py runs            every model call, with cost
  python3 owner.py chain           re-verify the tamper-evident history
  python3 owner.py show <kind> <id>   drill into artifact|project|task|run|agent
  python3 owner.py pause / resume  the kill switch
  python3 owner.py budget <usd>    daily ceiling
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import org, store  # noqa: E402

BAR = "─" * 74


def con():
    return store.connect()


def _mode_banner(c):
    mode = store.meta(c, "mode", "(unfounded)")
    srcs = [r["source"] for r in c.execute("SELECT DISTINCT source FROM runs")]
    live = "model" in srcs
    tag = {"simulation": "SIMULATION", "live": "LIVE", "hybrid": "HYBRID"}.get(mode, mode)
    note = ""
    if mode == "simulation":
        note = "  ← nothing here was produced by a model"
    elif mode == "hybrid" and not live:
        note = "  ← declared hybrid, but no model run has happened yet"
    return "MODE: %s%s" % (tag, note)


def cmd_status(c, *_):
    print(BAR)
    print(_mode_banner(c))
    print("PAUSED: %s   |   daily ceiling $%.2f   |   spent today $%.4f"
          % ("YES — no leases, no tools" if store.paused(c) else "no",
             float(store.meta(c, "usd_ceiling_day", 5.0)), store.spent_today(c)))
    print(BAR)
    q = lambda s: c.execute(s).fetchone()[0]  # noqa: E731
    rows = [
        ("registered agents", q("SELECT COUNT(*) FROM principals")),
        ("  of those, ever ran", q("SELECT COUNT(DISTINCT principal_id) FROM runs")),
        ("projects", q("SELECT COUNT(*) FROM projects")),
        ("tasks (queued/done/failed)", "%d / %d / %d" % (
            q("SELECT COUNT(*) FROM tasks WHERE status='QUEUED'"),
            q("SELECT COUNT(*) FROM tasks WHERE status='DONE'"),
            q("SELECT COUNT(*) FROM tasks WHERE status IN ('FAILED','BLOCKED')"))),
        ("model runs", q("SELECT COUNT(*) FROM runs")),
        ("  real model runs", q("SELECT COUNT(*) FROM runs WHERE source='model' AND status='OK'")),
        ("  mock runs", q("SELECT COUNT(*) FROM runs WHERE source='mock'")),
        ("artifacts", q("SELECT COUNT(*) FROM artifacts")),
        ("  with real provenance", q("SELECT COUNT(*) FROM artifacts WHERE source='model'")),
        ("evidence rows", q("SELECT COUNT(*) FROM evidence")),
        ("reviews", q("SELECT COUNT(*) FROM reviews")),
        ("events", q("SELECT COUNT(*) FROM events")),
        ("unread signals", q("SELECT COUNT(*) FROM signals WHERE seen=0")),
        ("decisions awaiting you", q("SELECT COUNT(*) FROM approvals WHERE decision IS NULL")),
    ]
    for k, v in rows:
        print("  %-28s %s" % (k, v))
    ok, bad = store.verify_chain(c)
    print(BAR)
    print("  history chain: %s" % ("intact" if ok else "BROKEN at event %s" % bad))


def cmd_feed(c, *_):
    rows = c.execute("SELECT * FROM signals ORDER BY id DESC LIMIT 30").fetchall()
    if not rows:
        print("nothing new."); return
    print(BAR); print("WHAT'S NEW"); print(BAR)
    for s in rows:
        print("  [%s] %s" % (s["priority"], s["headline"]))
        if s["detail"]:
            print("        %s" % s["detail"])
        link = [k for k in ("project_id", "artifact_id", "event_id") if s[k]]
        if link:
            print("        → %s" % ", ".join("%s %s" % (k.replace("_id", ""), s[k]) for k in link))


def cmd_projects(c, *_):
    print(BAR); print("%-4s %-22s %-12s %-8s %s" % ("ID", "NAME", "STAGE", "SPENT", "HYPOTHESIS"))
    print(BAR)
    for p in c.execute("SELECT * FROM projects ORDER BY id"):
        print("%-4d %-22s %-12s $%-7.4f %s"
              % (p["id"], p["name"][:22], p["stage"], p["usd_spent"], p["hypothesis"][:30]))


def cmd_built(c, *_):
    print(BAR); print("WHAT THEY BUILT"); print(BAR)
    for a in c.execute(
            "SELECT a.*, p.name AS who, r.status AS run_status FROM artifacts a "
            "JOIN principals p ON p.id=a.principal_id JOIN runs r ON r.id=a.run_id ORDER BY a.id"):
        flag = "" if a["source"] == "model" else "   ⚠ %s CONTENT" % a["source"].upper()
        print("  #%d  %s  [%s]%s" % (a["id"], a["name"], a["kind"], flag))
        print("      by %s · run #%d · sha %s" % (a["who"], a["run_id"], a["sha"][:12]))
        print("      %s" % (a["path"] or "(inline)"))
        rv = c.execute("SELECT verdict, reviewer_id FROM reviews WHERE artifact_id=?",
                       (a["id"],)).fetchall()
        print("      reviews: %s" % (", ".join("%s by %s" % (r["verdict"], r["reviewer_id"])
                                               for r in rv) or "none"))


def cmd_did(c, *_):
    print(BAR); print("WHAT THEY DID  (real recorded actions only)"); print(BAR)
    for e in c.execute("SELECT * FROM events ORDER BY id DESC LIMIT 40"):
        pay = json.loads(e["payload"] or "{}")
        extra = " ".join("%s=%s" % (k, v) for k, v in list(pay.items())[:3])
        print("  %-5d %-22s %-14s %-18s %s"
              % (e["id"], e["kind"], e["actor"] or "-", e["subject"] or "-", extra[:34]))


def cmd_evidence(c, *_):
    print(BAR); print("EVIDENCE  (external provenance required)"); print(BAR)
    for e in c.execute("SELECT * FROM evidence ORDER BY id"):
        print("  #%d  %s" % (e["id"], e["kind"]))
        print("      provenance: %s" % e["external_provenance"])
        print("      detail:     %s" % e["detail"][:120])
        print("      sha:        %s  by %s" % (e["content_sha"][:16], e["collected_by"]))
    cl = c.execute("SELECT status, COUNT(*) n FROM claims GROUP BY status").fetchall()
    print(BAR); print("  claims by epistemic status: %s"
                      % (", ".join("%s=%d" % (r["status"], r["n"]) for r in cl) or "none"))


def cmd_agents(c, *_):
    print(BAR)
    print("%-12s %-10s %-8s %-4s %-10s %s" % ("ID", "NAME", "TIER", "AUT", "STATUS", "PERMISSIONS"))
    print(BAR)
    for p in c.execute("SELECT * FROM principals ORDER BY id"):
        runs = c.execute("SELECT COUNT(*) n FROM runs WHERE principal_id=?",
                         (p["id"],)).fetchone()["n"]
        tools = c.execute("SELECT COUNT(*) n FROM tool_calls WHERE principal_id=? "
                          "AND decision='ALLOW'", (p["id"],)).fetchone()["n"]
        acted = "" if (runs or tools) else "   (no recorded work)"
        detail = "  [%d runs, %d tool calls]" % (runs, tools) if (runs or tools) else ""
        print("%-12s %-10s %-8s %-4d %-10s %s%s"
              % (p["id"], p["name"][:10], p["tier"], p["autonomy_level"], p["status"],
                 ",".join(json.loads(p["permissions"]))[:26], detail + acted))


def cmd_reviews(c, *_):
    print(BAR)
    for r in c.execute("SELECT * FROM reviews ORDER BY id"):
        print("  artifact #%d — %s by %s (%s)"
              % (r["artifact_id"], r["verdict"], r["reviewer_id"], r["domain"]))
        print("      %s" % r["rationale"])


def cmd_runs(c, *_):
    print(BAR)
    print("%-4s %-12s %-8s %-16s %-8s %-9s %s"
          % ("ID", "AGENT", "SOURCE", "STATUS", "TOK-IN", "TOK-OUT", "USD"))
    print(BAR)
    for r in c.execute("SELECT * FROM runs ORDER BY id"):
        print("%-4d %-12s %-8s %-16s %-8d %-9d $%.5f"
              % (r["id"], r["principal_id"], r["source"], r["status"],
                 r["tokens_in"], r["tokens_out"], r["usd"]))
    t = c.execute("SELECT COALESCE(SUM(usd),0) s FROM runs").fetchone()["s"]
    print(BAR); print("  total spent: $%.5f" % t)


def cmd_chain(c, *_):
    ok, bad = store.verify_chain(c)
    n = c.execute("SELECT COUNT(*) n FROM events").fetchone()["n"]
    print("  %d events — chain %s" % (n, "INTACT" if ok else "BROKEN at id %s" % bad))
    try:
        c.execute("DELETE FROM events WHERE id=(SELECT MIN(id) FROM events)")
        print("  >>> DELETE SUCCEEDED — the law is not enforced!")
    except Exception as e:
        print("  delete refused by the database: %s" % e)


def cmd_show(c, kind=None, ident=None, *_):
    if not kind or not ident:
        sys.exit("usage: owner.py show artifact|project|task|run|agent <id>")
    t = {"artifact": "artifacts", "project": "projects", "task": "tasks",
         "run": "runs", "agent": "principals"}.get(kind)
    if not t:
        sys.exit("unknown kind %r" % kind)
    row = c.execute("SELECT * FROM %s WHERE id=?" % t, (ident,)).fetchone()
    if not row:
        sys.exit("not found")
    print(BAR)
    for k in row.keys():
        v = row[k]
        if k == "body" and v and len(str(v)) > 300:
            v = str(v)[:300] + " …(truncated)"
        print("  %-16s %s" % (k, v))
    print(BAR)
    for e in c.execute("SELECT * FROM events WHERE subject=? ORDER BY id",
                       ("%s:%s" % (kind, ident),)):
        print("  event %-5d %-24s %s" % (e["id"], e["kind"], e["actor"] or ""))


def cmd_decisions(c, *_):
    rows = c.execute("SELECT * FROM approvals WHERE decision IS NULL ORDER BY id").fetchall()
    if not rows:
        print("nothing is waiting on you."); return
    print(BAR); print("DECISIONS THAT NEED YOU"); print(BAR)
    for a in rows:
        print("  #%d  %s" % (a["id"], a["question"]))
        print("      why: %s" % a["why"])
        print("      options: %s" % ", ".join(json.loads(a["options"])))
        if a["evidence_id"]:
            e = c.execute("SELECT * FROM evidence WHERE id=?", (a["evidence_id"],)).fetchone()
            print("      evidence #%d: %s" % (e["id"], e["external_provenance"]))
        print("      answer: python3 owner.py decide %d APPROVE|REJECT|NEED_EVIDENCE" % a["id"])


def cmd_decide(c, ident=None, verdict=None, *_):
    if not ident or not verdict:
        sys.exit("usage: owner.py decide <id> APPROVE|REJECT|NEED_EVIDENCE|PAUSE|REDIRECT")
    verdict = verdict.upper()
    a = c.execute("SELECT * FROM approvals WHERE id=?", (ident,)).fetchone()
    if not a:
        sys.exit("no such decision")
    c.execute("UPDATE approvals SET decision=?, decided_at=? WHERE id=?",
              (verdict, store.now(), ident))
    store.event(c, "OWNER_DECIDED", actor="OWNER", subject="approval:%s" % ident,
                payload={"decision": verdict})
    if verdict == "REJECT" and a["project_id"]:
        c.execute("UPDATE projects SET stage='RESEARCH' WHERE id=?", (a["project_id"],))
        print("rejected; project %d returned to RESEARCH." % a["project_id"])
    else:
        print("recorded: %s" % verdict)


# ── ORGANISATIONAL VIEWS ─────────────────────────────────────────────
def _empty(kind):
    print("  (none yet)"); print("  %s" % kind)


def cmd_away(c, *_):
    """WHILE YOU WERE AWAY — only meaningful changes since you last looked."""
    since = c.execute("SELECT value FROM owner_state WHERE key='last_seen'").fetchone()
    since = since["value"] if since else "0000"
    print(BAR); print("WHILE YOU WERE AWAY   (since %s)" % (since if since != "0000"
                                                            else "the beginning"))
    print(BAR)
    rows = [
        ("discoveries", "SELECT COUNT(*) c FROM discoveries WHERE created_at > ?",
         "owner.py discoveries"),
        ("new ideas", "SELECT COUNT(*) c FROM ideas WHERE created_at > ?", "owner.py ideas"),
        ("opportunities", "SELECT COUNT(*) c FROM opportunities WHERE created_at > ?",
         "owner.py opportunities"),
        ("artifacts built", "SELECT COUNT(*) c FROM artifacts WHERE created_at > ?",
         "owner.py built"),
        ("experiments completed",
         "SELECT COUNT(*) c FROM experiments WHERE completed_at > ?", "owner.py experiments"),
        ("projects created", "SELECT COUNT(*) c FROM projects WHERE created_at > ?",
         "owner.py projects"),
        ("failures recorded", "SELECT COUNT(*) c FROM failures WHERE created_at > ?",
         "owner.py failures"),
        ("reviews", "SELECT COUNT(*) c FROM reviews WHERE created_at > ?", "owner.py reviews"),
        ("agents proposed by the factory",
         "SELECT COUNT(*) c FROM agent_lineage WHERE created_at > ?", "owner.py factory"),
        ("cross-project connections",
         "SELECT COUNT(*) c FROM cross_project_signals WHERE created_at > ?",
         "owner.py cross"),
    ]
    anything = False
    for label, q, drill in rows:
        n = c.execute(q, (since,)).fetchone()["c"]
        if n:
            anything = True
            print("  %-34s %-4d → %s" % (label, n, drill))
    pend = c.execute("SELECT COUNT(*) c FROM approvals WHERE decision IS NULL").fetchone()["c"]
    if pend:
        anything = True
        print("  %-34s %-4d → owner.py decisions" % ("DECISIONS THAT NEED YOU", pend))
    if not anything:
        print("  nothing meaningful changed.")
    print(BAR)
    hi = c.execute("SELECT * FROM signals WHERE at > ? AND priority='HIGH' "
                   "ORDER BY id DESC LIMIT 6", (since,)).fetchall()
    if hi:
        print("  highest priority:")
        for sg in hi:
            print("    · %s" % sg["headline"])
    c.execute("INSERT INTO owner_state(key,value) VALUES('last_seen',?) "
              "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (store.now(),))
    print("  (marked as seen)")


def cmd_discoveries(c, *_):
    print(BAR); print("DISCOVERIES   observation ≠ interpretation ≠ validated fact"); print(BAR)
    for d in c.execute("SELECT * FROM discoveries ORDER BY id DESC LIMIT 25"):
        print("  #%d  [%s]  confidence %.2f" % (d["id"], d["source"], d["confidence"]))
        print("      OBSERVED:    %s" % d["observation"][:100])
        print("      INTERPRETED: %s" % (d["interpretation"][:100] or "— none offered"))
        print("      evidence: %s" % (d["evidence_id"] or "NONE — this is not a fact"))


def cmd_ideas(c, *_):
    print(BAR); print("%-5s %-13s %-9s %s" % ("ID", "STATUS", "SOURCE", "PROBLEM")); print(BAR)
    for i in c.execute("SELECT * FROM ideas ORDER BY id DESC LIMIT 30"):
        print("%-5d %-13s %-9s %s" % (i["id"], i["status"], i["source"], i["problem"][:44]))


def cmd_opportunities(c, *_):
    print(BAR); print("%-5s %-12s %-10s %s" % ("ID", "STATUS", "SOURCE", "PROBLEM")); print(BAR)
    for o in c.execute("SELECT * FROM opportunities ORDER BY id DESC LIMIT 30"):
        flag = "" if o["evidence_id"] else "   ⚠ no evidence"
        print("%-5d %-12s %-10s %s%s" % (o["id"], o["status"], o["source"],
                                         o["problem"][:40], flag))


def cmd_experiments(c, *_):
    print(BAR); print("EXPERIMENTS"); print(BAR)
    for e in c.execute("SELECT * FROM experiments ORDER BY id DESC"):
        print("  #%d  %-12s %s" % (e["id"], e["status"], e["hypothesis"][:52]))
        print("      success: %s | failure: %s" % (e["success_criteria"][:34],
                                                   e["failure_criteria"][:34]))
        if e["result"]:
            print("      RESULT: %s — %s" % (e["result"], (e["conclusion"] or "")[:60]))
            print("      next:   %s" % (e["next_action"] or "—"))


def cmd_failures(c, *_):
    print(BAR); print("FAILURE LIBRARY   never deleted"); print(BAR)
    for f in c.execute("SELECT * FROM failures ORDER BY id DESC"):
        print("  #%d  %s %s" % (f["id"], f["subject_kind"], f["subject_id"]))
        print("      what:   %s" % f["what_happened"][:90])
        print("      why:    %s" % f["why"][:90])
        print("      LESSON: %s" % f["lesson"][:90])


def cmd_disagreements(c, *_):
    print(BAR); print("DISAGREEMENTS   preserved, never averaged"); print(BAR)
    for d in c.execute("SELECT * FROM disagreements ORDER BY id DESC"):
        v = org.disagreement_view(c, d["id"])
        print("  #%d on %s %s — %s" % (d["id"], d["subject_kind"], d["subject_id"],
                                       "UNRESOLVED" if v["unresolved"] else "aligned"))
        for pos in v["positions"]:
            print("      %-12s %-11s conf %.2f  %s" % (pos["principal_id"], pos["stance"],
                                                       pos["confidence"], pos["claim"][:44]))
            if pos["missing_evidence"]:
                print("          missing: %s" % pos["missing_evidence"])


def cmd_cross(c, *_):
    print(BAR); print("CROSS-PROJECT SIGNALS"); print(BAR)
    for x in c.execute("SELECT * FROM cross_project_signals ORDER BY strength DESC"):
        print("  #%d  %-24s %.0f%%" % (x["id"], x["kind"], x["strength"] * 100))
        print("      %s" % x["detail"])


def cmd_factory(c, *_):
    print(BAR); print("FACTORY JOBS   why each decision was made"); print(BAR)
    for j in c.execute("SELECT * FROM factory_jobs ORDER BY id DESC"):
        print("  #%d  %-8s %-10s %s" % (j["id"], j["kind"], j["decision"] or "-",
                                        j["gap"][:44]))
        print("      %s" % j["rationale"][:100])
        if j["produced_id"]:
            print("      produced: %s" % j["produced_id"])


def cmd_agent(c, aid=None, *_):
    if not aid:
        sys.exit("usage: owner.py agent AGT-000001")
    p = c.execute("SELECT * FROM principals WHERE id=?", (aid,)).fetchone()
    if not p:
        sys.exit("no such agent")
    print(BAR); print("%s — %s (%s)" % (p["id"], p["name"], p["role"]))
    print("  %s / %s · tier %s · autonomy %d" % (p["division"], p["department"],
                                                 p["tier"], p["autonomy_level"]))
    print("  lifecycle %s · runtime %s" % (p["lifecycle_state"], p["status"]))
    print("  mission: %s" % p["mission"])
    print(BAR)
    lin = c.execute("SELECT * FROM agent_lineage WHERE principal_id=?", (aid,)).fetchone()
    print("  WHY IT EXISTS: %s" % (lin["why_created"] if lin else
                                   "founding crew — not factory-created"))
    if lin:
        print("      gap:      %s" % lin["capability_gap"])
        print("      creator:  %s   job #%s" % (lin["creator"], lin["factory_job_id"]))
        print("      expected: %s" % (lin["expected_value"] or "—"))
    print("  PERMISSIONS: %s" % p["permissions"][:100])
    caps = [r["capability_id"] for r in c.execute(
        "SELECT capability_id FROM agent_capabilities WHERE principal_id=?", (aid,))]
    print("  CAPABILITIES: %s" % (", ".join(caps) or "none"))
    sk = c.execute("SELECT skill_id, proficiency, eval_score FROM agent_skills "
                   "WHERE principal_id=?", (aid,)).fetchall()
    print("  SKILLS: %s" % (", ".join("%s(%.2f%s)" % (s["skill_id"], s["proficiency"],
                            "" if s["eval_score"] is not None else " UNTESTED")
                            for s in sk) or "none"))
    print(BAR)
    print("  WHAT IT DID:")
    print("      model runs: %d | tool calls: %d | artifacts: %d | reviews: %d"
          % (c.execute("SELECT COUNT(*) n FROM runs WHERE principal_id=?", (aid,)).fetchone()["n"],
             c.execute("SELECT COUNT(*) n FROM tool_calls WHERE principal_id=? AND "
                       "decision='ALLOW'", (aid,)).fetchone()["n"],
             c.execute("SELECT COUNT(*) n FROM artifacts WHERE principal_id=?",
                       (aid,)).fetchone()["n"],
             c.execute("SELECT COUNT(*) n FROM reviews WHERE reviewer_id=?",
                       (aid,)).fetchone()["n"]))


def cmd_passport(c, pid=None, *_):
    if not pid:
        sys.exit("usage: owner.py passport <project id>")
    p = c.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
    if not p:
        sys.exit("no such project")
    print(BAR); print("PROJECT PASSPORT #%s — %s" % (pid, p["name"])); print(BAR)
    print("  WHY IT EXISTS:  origin %s" % p["origin"])
    print("  MISSION:        %s" % p["mission"])
    print("  HYPOTHESIS:     %s" % (p["hypothesis"] or "—"))
    print("  STAGE:          %s" % p["stage"])
    print("  SPENT:          $%.4f" % p["usd_spent"])
    for label, q in (
            ("TEAM", "SELECT tm.principal_id AS a, tm.seat AS b FROM team_members tm "
                     "JOIN teams t ON t.id=tm.team_id WHERE t.project_id=?"),
            ("TASKS", "SELECT id AS a, objective AS b FROM tasks WHERE project_id=?"),
            ("ARTIFACTS", "SELECT id AS a, name || ' [' || source || ']' AS b "
                          "FROM artifacts WHERE project_id=?"),
            ("EXPERIMENTS", "SELECT id AS a, COALESCE(result,status) || ' — ' || hypothesis "
                            "AS b FROM experiments WHERE project_id=?")):
        rows = c.execute(q, (pid,)).fetchall()
        print(BAR); print("  %s (%d)" % (label, len(rows)))
        for r in rows:
            print("      %-14s %s" % (r["a"], str(r["b"])[:70]))
    ds = c.execute("SELECT id FROM disagreements WHERE subject_kind='project' "
                   "AND subject_id=?", (str(pid),)).fetchall()
    if ds:
        print(BAR); print("  DISAGREEMENTS")
        for d in ds:
            v = org.disagreement_view(c, d["id"])
            print("      #%d %s" % (d["id"], ", ".join(v["stances"])))


def cmd_businesses(c, *_):
    print(BAR)
    print("  BUSINESSES — NOT IMPLEMENTED")
    print("  No venture has been created, so there is nothing to show. This view")
    print("  exists as a named gap rather than an empty placeholder.")
    print(BAR)


def cmd_recall(c, *text):
    if not text:
        sys.exit('usage: owner.py recall "some text"')
    hits = org.recall(c, " ".join(text), threshold=0.15, limit=10)
    print(BAR); print("ORGANISATIONAL MEMORY  (lexical search, not semantic)"); print(BAR)
    for h in hits or []:
        print("  %-11s #%-4s %3.0f%%  %s" % (h["kind"], h["id"], h["similarity"] * 100,
                                             h["text"][:60]))
    if not hits:
        print("  no prior work resembles that.")


def cmd_bench(c, *_):
    """BENCHMARK CENTER — one strong agent vs the organisation."""
    camps = c.execute("SELECT * FROM bench_campaigns ORDER BY id DESC").fetchall()
    print(BAR); print("BENCHMARK CENTER"); print(BAR)
    if not camps:
        print("  No campaign has been run.")
        print("  CONCLUSION: INSUFFICIENT_EVIDENCE — the framework exists; nothing is")
        print("  inferred from it until a real run happens.")
        print("  Run:  export ANTHROPIC_API_KEY=...  &&  python3 bench_run.py --repeats 5")
        print(BAR)
        from core import bench_tasks as BT
        print("  %d task(s) in the registry:" % len(BT.TASKS))
        for t in BT.TASKS:
            print("    %-24s %-9s %-7s favours: %-17s cap $%.2f"
                  % (t["id"], t["domain"], t["difficulty"], t["favours"], t["max_usd"]))
        print("  (1 favours a single agent by design — a set that never does proves nothing)")
        return
    for cm in camps:
        print("  campaign #%d  %s" % (cm["id"], cm["name"]))
        print("      %s/%s · commit %s · repeats %d" % (cm["provider"], cm["model"],
                                                        (cm["git_commit"] or "?")[:12],
                                                        cm["repeats"]))
        print("      CONCLUSION: %s" % (cm["conclusion"] or "(still running)"))
        if cm["conclusion_why"]:
            print("      %s" % cm["conclusion_why"])
        print("      %-24s %-22s %-22s" % ("task", "SINGLE", "MULTI"))
        for t in c.execute("SELECT DISTINCT task_id FROM bench_runs WHERE campaign_id=?",
                           (cm["id"],)):
            cells = {}
            for cond in ("SINGLE", "MULTI"):
                r = c.execute(
                    "SELECT COUNT(*) n, COALESCE(AVG(e.correctness),0) q, "
                    "COALESCE(SUM(r.usd),0) u FROM bench_runs r LEFT JOIN bench_evaluations e "
                    "ON e.bench_run_id=r.id WHERE r.campaign_id=? AND r.task_id=? "
                    "AND r.condition=?", (cm["id"], t["task_id"], cond)).fetchone()
                cells[cond] = "n=%d q=%.2f $%.4f" % (r["n"], r["q"], r["u"])
            print("      %-24s %-22s %-22s" % (t["task_id"], cells["SINGLE"], cells["MULTI"]))
        fair = c.execute("SELECT COUNT(*) n FROM bench_fairness WHERE campaign_id=? AND fair=1",
                         (cm["id"],)).fetchone()["n"]
        print("      fairness rows verified: %d (unequal pairings are refused by the database)"
              % fair)
        print(BAR)


def cmd_benchrun(c, brid=None, *_):
    """Drill into one benchmark attempt, down to its provenance."""
    if not brid:
        sys.exit("usage: owner.py benchrun <bench_run id>")
    r = c.execute("SELECT * FROM bench_runs WHERE id=?", (brid,)).fetchone()
    if not r:
        sys.exit("no such run")
    print(BAR)
    print("BENCH RUN #%s — %s / %s / repeat %d" % (brid, r["task_id"], r["condition"],
                                                   r["repeat_index"]))
    print(BAR)
    for f in ("status", "input_sha", "output_sha", "tokens_in", "tokens_out", "usd",
              "latency_ms", "retries", "human_interventions", "tool_calls", "tool_denials",
              "failure_class", "failure_note"):
        if r[f] not in (None, ""):
            print("  %-20s %s" % (f, r[f]))
    print("  %-20s %s" % ("agents", r["agents_used"]))
    print("  %-20s %s" % ("model runs", r["model_runs"]))
    print(BAR); print("  EXECUTION GRAPH")
    for step in json.loads(r["exec_graph"] or "[]"):
        print("      %s" % json.dumps(step, ensure_ascii=False))
    e = c.execute("SELECT * FROM bench_evaluations WHERE bench_run_id=?", (brid,)).fetchone()
    if e:
        print(BAR); print("  EVALUATION (%s, by %s, blind token %s)"
                          % (e["method"], e["evaluator"], e["blind_token"]))
        for f in ("correctness", "completeness", "unsupported_claims", "contradictions",
                  "useful_artifacts"):
            print("      %-20s %s" % (f, e[f]))
        print("      detail: %s" % (e["detail"] or "")[:200])


def cmd_pause(c, *_):
    store.set_meta(c, "paused", True)
    store.event(c, "EMERGENCY_STOP", actor="OWNER")
    print("PAUSED. No lease will be granted and no tool call will execute.")


def cmd_resume(c, *_):
    store.set_meta(c, "paused", False)
    store.event(c, "RESUMED", actor="OWNER")
    print("resumed.")


def cmd_budget(c, usd=None, *_):
    if usd is None:
        print("daily ceiling: $%.2f" % float(store.meta(c, "usd_ceiling_day", 5.0))); return
    store.set_meta(c, "usd_ceiling_day", float(usd))
    store.event(c, "BUDGET_SET", actor="OWNER", payload={"usd_day": float(usd)})
    print("daily ceiling set to $%.2f" % float(usd))


CMDS = {k[4:]: v for k, v in list(globals().items()) if k.startswith("cmd_")}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in CMDS:
        print(__doc__); sys.exit(0 if len(sys.argv) < 2 else 2)
    try:
        CMDS[sys.argv[1]](con(), *sys.argv[2:])
    except BrokenPipeError:
        os._exit(0)
