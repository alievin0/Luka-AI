#!/usr/bin/env python3
"""PHASE 2 — THE LIVE MODEL PROOF.  Run this on your machine, not in CI.

    export ANTHROPIC_API_KEY=sk-ant-...
    python3 live_proof.py

It runs the SAME vertical slice against a real provider in a world founded
`live`, then prints a record you can paste back. It records provider, model,
tokens, cost, latency, run/task/agent ids, tool calls, artifact, verification,
evidence and review — and it fails loudly rather than degrading to mock.

It will not run in a world founded `simulation`: the law forbids it, which is
the point. This creates its own world file, `civ-live.db`.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import provider as P          # noqa: E402
from core import store                  # noqa: E402
import slice as vslice                  # noqa: E402

DB = os.path.join(HERE, "civ-live.db")
BAR = "=" * 74


def main():
    prov = P.ClaudeProvider()
    print(BAR)
    print("PHASE 2 — LIVE MODEL PROOF")
    print(BAR)
    if not prov.available():
        print("STATUS: NOT_CONFIGURED — %s" % prov.why_unavailable())
        print()
        print("  export ANTHROPIC_API_KEY=sk-ant-...   then run this again.")
        print("  Until this executes, the live path stays UNVERIFIED. It is not a failure;")
        print("  it is simply not yet proven, and the system will not say otherwise.")
        return 2

    fresh = not os.path.exists(DB)
    con = store.connect(DB)
    if fresh or not store.meta(con, "founded"):
        store.found(con, mode="live")
    if store.meta(con, "mode") != "live":
        print("STATUS: WRONG_WORLD — %s is mode=%s. Delete it and re-run."
              % (DB, store.meta(con, "mode")))
        return 3

    print("world:    %s   mode=%s" % (DB, store.meta(con, "mode")))
    print("provider: %s / %s" % (prov.name, prov.model))
    print(BAR)
    vslice.register_crew(con)
    out = vslice.run_slice(con, prov)
    print(BAR)

    run = con.execute("SELECT * FROM runs WHERE id=?", (out.get("run_id"),)).fetchone()
    art = con.execute("SELECT * FROM artifacts WHERE id=?", (out.get("artifact_id"),)).fetchone()
    ev = con.execute("SELECT * FROM evidence WHERE id=?", (out.get("evidence_id"),)).fetchone()
    rev = con.execute("SELECT * FROM reviews WHERE artifact_id=?",
                      (out.get("artifact_id"),)).fetchone()
    tools = con.execute("SELECT tool,cap,decision FROM tool_calls ORDER BY id").fetchall()

    ok = bool(run and run["status"] == "OK" and run["source"] == "model"
              and art and art["source"] == "model" and ev and out.get("verified"))

    record = {
        "gate": "G1 LIVE MODEL EXECUTION",
        "verdict": "PASS" if ok else "FAIL",
        "world_mode": store.meta(con, "mode"),
        "provider": run["provider"] if run else None,
        "model": run["model"] if run else None,
        "run_id": out.get("run_id"),
        "task_id": out.get("task_id"),
        "agent_id": "AGT-000002",
        "tokens_in": run["tokens_in"] if run else None,
        "tokens_out": run["tokens_out"] if run else None,
        "usd": round(run["usd"], 6) if run else None,
        "latency_ms": run["latency_ms"] if run else None,
        "tool_calls": [dict(t) for t in tools],
        "artifact_id": out.get("artifact_id"),
        "artifact_source": art["source"] if art else None,
        "artifact_sha": art["sha"][:16] if art else None,
        "verification": json.loads(ev["detail"]) if ev else None,
        "evidence_provenance": ev["external_provenance"] if ev else None,
        "review": rev["verdict"] if rev else None,
        "chain_intact": store.verify_chain(con)[0],
        "total_usd_this_world": round(
            con.execute("SELECT COALESCE(SUM(usd),0) s FROM runs").fetchone()["s"], 6),
    }
    print(json.dumps(record, ensure_ascii=False, indent=2))
    print(BAR)
    if ok:
        print("G1 PASS — a real model produced a real artifact, an independent verifier")
        print("executed it for real, and the evidence is recorded with provenance.")
        print("Paste the JSON above back and I will record G1 as PASS in BASELINE.md.")
    else:
        print("G1 FAIL — see the record above. Nothing was fabricated to cover it.")
    print("Inspect it:  CIV_DB=%s python3 owner.py status" % DB)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
