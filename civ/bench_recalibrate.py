#!/usr/bin/env python3
"""Recalibration report: diagnose v1 from frozen evidence, gate the v2 proposal.

Deterministic. Calls no model, spends nothing, runs no campaign.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import bench_diagnosis as D          # noqa: E402
from core import bench_integrity as I          # noqa: E402
from core import bench_tasks as V1             # noqa: E402
from core import bench_tasks_v2 as V2          # noqa: E402

BAR = "=" * 76


def task_input_v2(task, repo_root=None):
    body = task["description"]
    if task.get("fixture_via_tool"):
        body += ("\n\nThe data is NOT reproduced here. Read it with your authorized "
                 "read tool at this exact path:\n"
                 + V2.fixture_path(task, repo_root or "/repo"))
    elif task["fixture"]:
        body += "\n\nFIXTURE:\n" + json.dumps(task["fixture"], ensure_ascii=False, indent=2)
    return body


def main():
    camps = D.load_history()
    print(BAR)
    print("RECALIBRATION — v1 diagnosed, v2 proposed. No campaign is run.")
    print(BAR)
    print("evidence: campaigns %s, %d runs, frozen"
          % ([c["campaign_id"] for c in camps], sum(c["runs"] for c in camps)))
    print()

    print("── v1 TASK VALIDITY (independent of who won) " + "─" * 31)
    diags = D.diagnose_all(V1.TASKS, camps)
    for d in diags:
        print("  %-26s %s" % (d["task_id"], d["verdict"]))
        for f in d["faults"]:
            print("      - %s" % f)
    tally = {}
    for d in diags:
        tally[d["verdict"]] = tally.get(d["verdict"], 0) + 1
    print("  => " + " · ".join("%d %s" % (v, k) for k, v in sorted(tally.items())))
    print()

    print("── v2 INTEGRITY GATE " + "─" * 55)
    rep = I.run_all(V2.TASKS_V2, V2.CHECKERS_V2, task_input_v2)
    for r in rep["results"]:
        if r["status"] != I.PASS:
            print("  %-5s %-34s %s" % (r["status"], r["check"], r["detail"]))
    print("  %d passed · %d warnings · %d failures" %
          (rep["passed"], rep["warnings"], rep["failures"]))
    print()
    print("  VERDICT: %s" % rep["verdict"])
    print("  %s" % rep["claim_permitted"])
    print()

    print("── PROPOSED CAMPAIGN #3 SET " + "─" * 48)
    for t in V2.TASKS_V2:
        print("  %-30s %-20s %-18s %s"
              % (t["id"], t["purpose"], t["favours"], t["difficulty"]))
    print("  balance across discriminating tasks: %s" % V2.favours_balance())
    print()
    print(BAR)
    print("STOP. Campaign #3 is NOT run and is NOT authorised.")
    print(BAR)
    return 0 if rep["verdict"] != I.FAIL else 1


if __name__ == "__main__":
    raise SystemExit(main())
