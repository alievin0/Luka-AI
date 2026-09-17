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
from core import store  # noqa: E402

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
