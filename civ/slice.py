#!/usr/bin/env python3
"""The vertical slice, end to end and for real:

  OWNER → WORLD → AGENT → TASK → TEAM → PROJECT → ARTIFACT → REVIEW → EVIDENCE → SIGNAL

Honesty rules this file obeys:
  · the artifact's CONTENT is only as real as the provider (mock stays labelled MOCK)
  · the artifact's VERIFICATION is always real — a subprocess, a real exit code,
    a real output hash, recorded as evidence with external provenance
  · no step reports success it did not earn
"""
import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core import provider as P            # noqa: E402
from core import runtime, store           # noqa: E402
from core.store import now, sha           # noqa: E402

ARTIFACT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "artifacts")
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Five agents. Every one differs in tools, permissions, memory scope, success
# metrics AND escalation rules — the distinctness index refuses anything less.
CREW = [
    dict(id="AGT-000001", name="Scout", role="Repository Scout", tier="reader",
         division="Discovery & Intelligence", department="Opportunity Discovery",
         mission="Observe the repository and report one measurable, checkable fact.",
         tools=["fs.read"], permissions=["READ_REPO"], memory_scope=["self"],
         success_metrics=[{"metric": "observations", "target": 1}],
         escalation_rules=[{"when": "no_observation", "action": "ESCALATE"}],
         autonomy_level=1),
    dict(id="AGT-000002", name="Builder", role="Software Builder", tier="actor",
         division="Engineering", department="Software Engineering",
         mission="Turn a task objective into a real file on disk.",
         tools=["fs.read", "fs.write"], permissions=["READ_REPO", "WRITE_ARTIFACT"],
         memory_scope=["self", "project"],
         success_metrics=[{"metric": "artifacts_verified", "target": 1}],
         escalation_rules=[{"when": "verify_failed_twice", "action": "ESCALATE"}],
         autonomy_level=2),
    dict(id="AGT-000003", name="Verifier", role="Independent Verifier", tier="actor",
         division="Assurance", department="Reliability",
         mission="Execute the artifact and record what actually happened.",
         tools=["proc.run"], permissions=["EXECUTE_SANDBOX"],
         memory_scope=["self", "project", "org"],
         success_metrics=[{"metric": "evidence_rows", "target": 1}],
         escalation_rules=[{"when": "execution_error", "action": "REPORT"}],
         autonomy_level=2),
    dict(id="AGT-000004", name="Critic", role="Independent Critic", tier="judge",
         division="Assurance", department="Audit",
         mission="Judge the artifact from evidence only, and be able to reject it.",
         tools=[], permissions=["READ_ARTIFACT", "WRITE_REVIEW"],
         memory_scope=["project", "org"],
         success_metrics=[{"metric": "rejections_upheld", "target": 1}],
         escalation_rules=[{"when": "no_evidence", "action": "NEED_EVIDENCE"}],
         autonomy_level=1),
    dict(id="AGT-000005", name="Historian", role="Owner Signal Writer", tier="judge",
         division="Knowledge & Simulation", department="Knowledge & Documentation",
         mission="Turn raw events into signals the owner can act on.",
         tools=[], permissions=["READ_EVENTS", "WRITE_SIGNAL"],
         memory_scope=["org"],
         success_metrics=[{"metric": "signals_linked_to_source", "target": 1.0}],
         escalation_rules=[{"when": "owner_decision_needed", "action": "OWNER_APPROVAL"}],
         autonomy_level=1),
]

SYSTEM = ("You are a builder inside an audited organization. Produce a single, small, "
          "self-contained Python module. Output ONLY the code, no prose, no fences.")


def register_crew(con):
    for a in CREW:
        con.execute(
            "INSERT OR IGNORE INTO principals(id,name,role,division,department,tier,mission,"
            "autonomy_level,tools,permissions,memory_scope,success_metrics,escalation_rules,"
            "created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (a["id"], a["name"], a["role"], a["division"], a["department"], a["tier"],
             a["mission"], a["autonomy_level"],
             json.dumps(a["tools"]), json.dumps(a["permissions"]),
             json.dumps(a["memory_scope"]), json.dumps(a["success_metrics"]),
             json.dumps(a["escalation_rules"]), now()))
        store.event(con, "AGENT_REGISTERED", actor="OWNER", subject=a["id"],
                    payload={"role": a["role"], "tier": a["tier"]})
    return len(CREW)


def build_gateway(con):
    gw = runtime.Gateway(con)

    def fs_read(path):
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read()[:20000]

    def fs_write(path, body):
        # artifacts may only be written inside the artifact directory
        full = os.path.abspath(os.path.join(ARTIFACT_DIR, path))
        if not full.startswith(os.path.abspath(ARTIFACT_DIR) + os.sep):
            raise runtime.Denied("write outside the artifact directory")
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(body)
        return full

    def proc_run(argv, timeout=20, cwd=None):
        # cwd is allowlisted: the repo root (read-only walk) or a temp dir. Never $HOME.
        allowed = {os.path.abspath(REPO_ROOT), os.path.abspath(tempfile.gettempdir())}
        cwd = os.path.abspath(cwd or tempfile.gettempdir())
        if cwd not in allowed:
            raise runtime.Denied("cwd not allowlisted: %s" % cwd)
        r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, cwd=cwd)
        return {"argv": argv, "returncode": r.returncode,
                "stdout": r.stdout[-4000:], "stderr": r.stderr[-4000:]}

    gw.register("READ_REPO", fs_read)
    gw.register("WRITE_ARTIFACT", fs_write)
    gw.register("EXECUTE_SANDBOX", proc_run)
    return gw


def run_slice(con, prov, verbose=True):
    """One complete pass. Returns a dict of what really happened."""
    def say(*a):
        if verbose:
            print(*a)

    out = {"mode": store.meta(con, "mode"), "provider": prov.name,
           "provider_available": prov.available()}

    # ── PROJECT + TEAM ───────────────────────────────────────────────
    pid = con.execute(
        "INSERT INTO projects(name,mission,stage,hypothesis,origin,created_at) "
        "VALUES(?,?,?,?,?,?)",
        ("Repo Metrics", "Produce a verifiable measurement of this repository.",
         "PROTOTYPE", "A small module can compute and prove a repo statistic.",
         "owner request", now())).lastrowid
    store.event(con, "PROJECT_CREATED", actor="OWNER", subject="project:%d" % pid)
    tid_team = con.execute("INSERT INTO teams(project_id,name,purpose,created_at) VALUES(?,?,?,?)",
                           (pid, "Slice Team", "build → verify → review", now())).lastrowid
    for a, seat in (("AGT-000002", "builds"), ("AGT-000003", "verifies"), ("AGT-000004", "judges")):
        con.execute("INSERT OR IGNORE INTO team_members(team_id,principal_id,seat) VALUES(?,?,?)",
                    (tid_team, a, seat))
    store.event(con, "TEAM_CREATED", actor="OWNER", subject="team:%d" % tid_team)
    out["project_id"], out["team_id"] = pid, tid_team
    say("  PROJECT #%d + TEAM #%d formed" % (pid, tid_team))

    # ── TASK ─────────────────────────────────────────────────────────
    task = runtime.enqueue(
        con, "Write civ/artifacts/repo_stat.py: a module exposing count_py(root) -> int "
             "that counts .py files, and prints the count for '.' when run.",
        kind="build", created_by="AGT-000001", project_id=pid,
        required_caps=["READ_REPO", "WRITE_ARTIFACT"], priority=9)
    out["task_id"] = task
    say("  TASK #%d queued" % task)

    # ── BUILDER takes a lease ────────────────────────────────────────
    lease = runtime.claim(con, "AGT-000002", lease_seconds=180)
    if lease is None:
        out["status"] = "NO_LEASE"
        return out
    say("  LEASE #%d granted to Builder, expires %s" % (lease["lease_id"], lease["expires_at"]))

    rid, res = runtime.invoke(con, prov, "AGT-000002", SYSTEM, lease["task"]["objective"],
                              lease_id=lease["lease_id"], task_id=task, max_tokens=700)
    out["run_id"], out["run_status"] = rid, res.status
    say("  RUN #%d -> %s (source=%s, %d in / %d out tokens, $%.5f)"
        % (rid, res.status, res.source, res.tokens_in, res.tokens_out, res.usd))

    if res.status == "NOT_CONFIGURED":
        store.signal(con, "HIGH", "Build blocked: no model provider configured",
                     "Task #%d could not run. Set CIV_PROVIDER/ANTHROPIC_API_KEY." % task,
                     project_id=pid)
        runtime.release(con, lease["lease_id"], "BLOCKED", "NOT_CONFIGURED")
        out["status"] = "BLOCKED — REQUIRED CAPABILITY NOT CONFIGURED"
        say("  >>> " + out["status"])
        return out
    if not res.ok:
        store.signal(con, "HIGH", "Build failed", res.error or "", project_id=pid)
        runtime.release(con, lease["lease_id"], "FAILED", res.error)
        out["status"] = "FAILED"
        return out

    # The artifact body. In mock mode this is NOT code the model wrote, and the
    # banner says so in the file itself — not only in the UI.
    if res.source == "mock":
        body = ('"""MOCK ARTIFACT — generated by MockProvider, not by a model.\n'
                'Its content proves the runtime works; it proves nothing about intelligence.\n'
                'Provider payload: %s\n"""\n'
                'import os\n\n\n'
                'def count_py(root="."):\n'
                '    return sum(len([f for f in fs if f.endswith(".py")])\n'
                '               for _, _, fs in os.walk(root))\n\n\n'
                'if __name__ == "__main__":\n'
                '    print(count_py("."))\n' % res.text)
    else:
        body = res.text

    gw = build_gateway(con)
    path = gw.call("AGT-000002", "WRITE_ARTIFACT", lease_id=lease["lease_id"],
                   path="repo_stat.py", body=body)
    aid = con.execute(
        "INSERT INTO artifacts(project_id,task_id,run_id,principal_id,kind,name,path,body,"
        "sha,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (pid, task, rid, "AGT-000002", "code", "repo_stat.py", path, body,
         sha(body), res.source, now())).lastrowid
    store.event(con, "ARTIFACT_CREATED", actor="AGT-000002", subject="artifact:%d" % aid,
                payload={"source": res.source, "sha": sha(body)[:12]})
    runtime.release(con, lease["lease_id"], "DONE", "artifact:%d" % aid)
    out["artifact_id"], out["artifact_path"], out["artifact_source"] = aid, path, res.source
    say("  ARTIFACT #%d written -> %s  [source=%s]" % (aid, path, res.source))

    # ── VERIFIER: real execution, real exit code, real evidence ──────
    vlease = runtime.claim(con, "AGT-000003", lease_seconds=120)
    ev_id, verdict_ok = None, False
    if vlease is None:
        # no verify task queued; the verifier acts on the artifact directly
        pass
    gw2 = build_gateway(con)
    try:
        r = gw2.call("AGT-000003", "EXECUTE_SANDBOX",
                     lease_id=vlease["lease_id"] if vlease else None,
                     argv=[sys.executable, path], cwd=REPO_ROOT)
        verdict_ok = (r["returncode"] == 0 and r["stdout"].strip().isdigit())
        ev_id = con.execute(
            "INSERT INTO evidence(kind,external_provenance,detail,content_sha,collected_by,"
            "collected_at) VALUES(?,?,?,?,?,?)",
            ("process_exec", " ".join([os.path.basename(sys.executable), path]),
             json.dumps({"returncode": r["returncode"], "stdout": r["stdout"].strip()[:200],
                         "stderr": r["stderr"].strip()[:200]}, ensure_ascii=False),
             sha(r["stdout"] + r["stderr"]), "AGT-000003", now())).lastrowid
        store.event(con, "EVIDENCE_COLLECTED", actor="AGT-000003", subject="evidence:%d" % ev_id,
                    payload={"returncode": r["returncode"]})
        say("  EVIDENCE #%d — ran the artifact for real: exit=%d stdout=%r"
            % (ev_id, r["returncode"], r["stdout"].strip()[:40]))
    except (runtime.Denied, subprocess.SubprocessError, OSError) as e:
        say("  EVIDENCE — execution failed: %r" % (e,))
    finally:
        if vlease:
            runtime.release(con, vlease["lease_id"], "DONE")
    out["evidence_id"], out["verified"] = ev_id, verdict_ok

    # A RESULT claim is only insertable because evidence exists (Law 4).
    if ev_id is not None:
        con.execute("INSERT INTO claims(project_id,task_id,principal_id,text,status,evidence_id,"
                    "created_at) VALUES(?,?,?,?,?,?,?)",
                    (pid, task, "AGT-000003",
                     "The artifact executes and prints an integer." if verdict_ok
                     else "The artifact does not execute cleanly.",
                     "RESULT", ev_id, now()))

    # ── CRITIC: independent, evidence-only, may reject ───────────────
    verdict = "APPROVE" if verdict_ok else "REJECT"
    rationale = ("Executed by an independent verifier; exit code 0 and integer output."
                 if verdict_ok else
                 "No passing execution evidence; the artifact is not accepted.")
    if out.get("artifact_source") == "mock":
        rationale += (" NOTE: the artifact content is MOCK — this review certifies the "
                      "pipeline, not the intelligence.")
    con.execute("INSERT INTO reviews(artifact_id,reviewer_id,domain,verdict,rationale,"
                "evidence_id,created_at) VALUES(?,?,?,?,?,?,?)",
                (aid, "AGT-000004", "engineering", verdict, rationale, ev_id, now()))
    store.event(con, "REVIEW_COMPLETED", actor="AGT-000004", subject="artifact:%d" % aid,
                payload={"verdict": verdict})
    out["review"] = verdict
    say("  REVIEW by Critic: %s" % verdict)

    # ── PROJECT UPDATE + OWNER SIGNAL ────────────────────────────────
    stage = "TESTING" if verdict_ok else "RESEARCH"
    con.execute("UPDATE projects SET stage=? WHERE id=?", (stage, pid))
    eid = store.event(con, "PROJECT_STAGE_CHANGED", actor="AGT-000005",
                      subject="project:%d" % pid, payload={"stage": stage})
    label = "" if out.get("artifact_source") == "model" else " [MOCK CONTENT]"
    store.signal(con, "MEDIUM" if verdict_ok else "HIGH",
                 "Artifact #%d %s and project moved to %s%s"
                 % (aid, "verified" if verdict_ok else "rejected", stage, label),
                 "Built by Builder, executed by an independent Verifier "
                 "(evidence #%s), judged by Critic." % ev_id,
                 event_id=eid, project_id=pid, artifact_id=aid)
    out["status"] = "COMPLETE"
    say("  SIGNAL written for the owner")
    return out


def main():
    mode = os.environ.get("CIV_MODE") or "simulation"
    con = store.connect()
    if not store.meta(con, "founded"):
        store.found(con, mode=mode)
    prov = P.from_env()
    if not prov.available() and os.environ.get("CIV_PROVIDER") is None:
        prov = P.MockProvider()     # explicit: the slice is exercising the runtime
    print("=" * 72)
    print("WORLD mode=%s | provider=%s (%s)"
          % (store.meta(con, "mode"), prov.name,
             "available" if prov.available() else prov.why_unavailable()))
    print("=" * 72)
    n = register_crew(con)
    print("  %d principals registered" % n)
    out = run_slice(con, prov)
    print("=" * 72)
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
