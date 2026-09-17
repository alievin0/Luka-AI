#!/usr/bin/env python3
"""CAMPAIGN #3 PRE-FLIGHT — the six checks that must pass before any budget.

Owner authorisation, 2026-09-17, against sealed commit 83d0020.

Every check here is free and deterministic. Exit 0 means the campaign may run
exactly as pre-registered; any non-zero exit means it must not, and says why.

This is deliberately separate from the runner AND wired into it: `bench_run.py
--task-set v2` refuses to start unless these pass, so the checks cannot be
skipped by forgetting to run them.
"""
import hashlib
import inspect
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import bench_integrity as I          # noqa: E402
from core import bench_metrics as M            # noqa: E402
from core import bench_tasks_v2 as V2          # noqa: E402
from core import benchmark as B                # noqa: E402
from core import provider as P                 # noqa: E402

BAR = "=" * 78
SEALED_COMMIT = "83d00202f0b6dae98d87dc1e14a50bfbba265bb3"
MANIFEST = os.path.join(HERE, "bench_history", "campaign3-sealed-manifest.json")


def task_sha(task):
    """Everything the model sees, plus everything it is graded on."""
    payload = json.dumps({
        "id": task["id"], "description": task["description"],
        "fixture": task["fixture"], "fixture_via_tool": task.get("fixture_via_tool", False),
        "allowed_tools": sorted(task["allowed_tools"]), "max_usd": task["max_usd"],
        "favours": task["favours"], "purpose": task["purpose"],
        "checker": task["checker"],
        "reference_good": task["reference_good"], "reference_bad": task["reference_bad"],
    }, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def evaluator_sha(fn):
    """The checker's source. A scoring change anywhere shows up here."""
    return hashlib.sha256(inspect.getsource(fn).encode("utf-8")).hexdigest()


def build_manifest():
    return {
        "sealed_commit": SEALED_COMMIT,
        "metrics_sha": M.dimensions_sha(),
        "task_set": "v2",
        "tasks": {t["id"]: task_sha(t) for t in V2.TASKS_V2},
        "evaluators": {name: evaluator_sha(fn) for name, fn in sorted(V2.CHECKERS_V2.items())},
        "statistical_rule": dict(I.OPTION_A),
    }


def _git_head():
    import subprocess
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE,
                              capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception:                                       # noqa: BLE001
        return ""


def _git_dirty():
    import subprocess
    try:
        out = subprocess.run(["git", "status", "--porcelain"], cwd=HERE,
                             capture_output=True, text=True, timeout=10).stdout.strip()
        return [ln for ln in out.splitlines() if "/civ/" in ln or ln[3:].startswith("civ/")]
    except Exception:                                       # noqa: BLE001
        return []


def task_input_v2(task, repo_root=None):
    body = task["description"]
    if task.get("fixture_via_tool"):
        body += ("\n\nThe data is NOT reproduced here. Read it with your authorized "
                 "read tool at this exact path:\n"
                 + V2.fixture_path(task, repo_root or "/repo"))
    elif task["fixture"]:
        body += "\n\nFIXTURE:\n" + json.dumps(task["fixture"], ensure_ascii=False, indent=2)
    return body


def preflight(verbose=True, require_provider=True):
    """The six pre-execution checks. Returns (ok, failures)."""
    fails, notes = [], []
    say = (lambda *a: print(*a)) if verbose else (lambda *a: None)

    say(BAR)
    say("CAMPAIGN #3 PRE-FLIGHT — nothing is spent until all six pass")
    say(BAR)

    # ── 1. the exact pre-registered commit ────────────────────────────
    head, dirty = _git_head(), _git_dirty()
    say("\n1. SEALED COMMIT")
    say("   pre-registered : %s" % SEALED_COMMIT)
    say("   working head   : %s" % (head or "(unavailable)"))
    if head and head != SEALED_COMMIT:
        notes.append("head %s is not the sealed commit %s — this is only acceptable if "
                     "later commits do not touch the sealed benchmark, which checks "
                     "3 and 4 verify independently" % (head[:12], SEALED_COMMIT[:12]))
        say("   NOTE           : head differs; hashes below decide, not the commit id")
    else:
        say("   MATCH")
    if dirty:
        fails.append("uncommitted changes under civ/: %s" % ", ".join(dirty[:5]))
        say("   FAIL           : uncommitted changes under civ/")
    else:
        say("   tree           : clean under civ/")

    # ── 2. the free integrity gate ────────────────────────────────────
    say("\n2. INTEGRITY GATE")
    rep = I.run_all(V2.TASKS_V2, V2.CHECKERS_V2, task_input_v2)
    say("   %d passed · %d warnings · %d failures -> %s"
        % (rep["passed"], rep["warnings"], rep["failures"], rep["verdict"]))
    for r in rep["results"]:
        if r["status"] == I.FAIL:
            fails.append("integrity: %s — %s" % (r["check"], r["detail"]))
            say("   FAIL  %s — %s" % (r["check"], r["detail"]))
        elif r["status"] == I.WARN:
            say("   WARN  %s — %s" % (r["check"], r["detail"]))

    # ── 3. the metric fingerprint ─────────────────────────────────────
    say("\n3. METRIC DEFINITIONS")
    got = M.dimensions_sha()
    say("   pre-registered : %s" % I.PREREGISTERED_METRICS_SHA)
    say("   computed       : %s" % got)
    if got != I.PREREGISTERED_METRICS_SHA:
        fails.append("metric definitions changed since pre-registration")
        say("   FAIL           : metrics have drifted")
    else:
        say("   MATCH          : 9 dimensions, unchanged")

    # ── 4. task and evaluator hashes ──────────────────────────────────
    say("\n4. TASK AND EVALUATOR HASHES")
    current = build_manifest()
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as fh:
            sealed = json.load(fh)
        for kind in ("tasks", "evaluators"):
            for key, sha in sealed[kind].items():
                now = current[kind].get(key)
                if now != sha:
                    fails.append("%s %s changed since sealing (%s -> %s)"
                                 % (kind[:-1], key, sha[:12], (now or "MISSING")[:12]))
            extra = set(current[kind]) - set(sealed[kind])
            if extra:
                fails.append("%s added since sealing: %s" % (kind, ", ".join(sorted(extra))))
            missing = set(sealed[kind]) - set(current[kind])
            if missing:
                fails.append("%s removed since sealing: %s" % (kind, ", ".join(sorted(missing))))
        say("   manifest       : %s" % os.path.relpath(MANIFEST, HERE))
        say("   %d tasks · %d evaluators verified against the seal"
            % (len(sealed["tasks"]), len(sealed["evaluators"])))
        if not any("changed since sealing" in f for f in fails):
            say("   MATCH          : no task, reference answer or evaluator has moved")
    else:
        fails.append("no sealed manifest at %s — nothing to verify against" % MANIFEST)
        say("   FAIL           : sealed manifest missing")

    # ── 5. provider and model ─────────────────────────────────────────
    say("\n5. PROVIDER AND MODEL")
    prov = P.from_env()
    if not prov.available() and not os.environ.get("CIV_PROVIDER"):
        prov = P.ClaudeProvider()
    model = getattr(prov, "model", "-")
    say("   provider       : %s" % prov.name)
    say("   model          : %s" % model)
    say("   available      : %s" % prov.available())
    if not prov.available():
        say("   reason         : %s" % prov.why_unavailable())
        if require_provider:
            fails.append("no real provider reachable: %s" % prov.why_unavailable())
    else:
        rin, rout, known = P.rate_for(model)
        say("   published rate : $%.2f in / $%.2f out per MTok%s"
            % (rin, rout, "" if known else "  (UNPRICED — cost will read as 0)"))
        if prov.source != "model":
            fails.append("provider %r does not execute a real model" % prov.name)
        # R21: a key that is SET is not a key that WORKS. One minimal call.
        elif hasattr(prov, "probe"):
            ok_probe, why, res = prov.probe()
            if ok_probe:
                say("   live probe     : OK (%d in / %d out tokens, $%.6f)"
                    % (res.tokens_in, res.tokens_out, res.usd))
            else:
                fails.append("the provider does not answer: %s" % why)
                say("   live probe     : FAILED — %s" % why)

    # ── 6b. R20: the task set must actually REGISTER ──────────────────
    # The first Campaign #3 attempt passed all six checks and then died on the
    # first database write: V2-T01 declares difficulty 'trivial' and the
    # bench_tasks CHECK allowed only easy/medium/hard. Every check above was
    # green while the campaign could not start. Verifying hashes, metrics and
    # a provider is not the same as verifying the thing can run, so the
    # pre-flight now performs a real registration into a throwaway database.
    say("\n6a. TASK REGISTRATION (dry, in a temporary database)")
    try:
        import tempfile
        from core import store
        prev = B.ACTIVE
        with tempfile.TemporaryDirectory() as tmp:
            con = store.connect(os.path.join(tmp, "preflight.db"))
            store.found(con, mode="simulation")
            B.use_task_set("v2")
            n = B.register_tasks(con)
            B.ACTIVE = prev
        if n != len(V2.TASKS_V2):
            fails.append("registration wrote %d of %d tasks" % (n, len(V2.TASKS_V2)))
            say("   FAIL           : wrote %d of %d" % (n, len(V2.TASKS_V2)))
        else:
            say("   OK             : all %d tasks register cleanly" % n)
    except Exception as e:                                  # noqa: BLE001
        fails.append("the task set cannot be registered: %r" % (e,))
        say("   FAIL           : %r" % (e,))

    # ── 6. the planned configuration, printed before any spend ────────
    disc = [t for t in V2.TASKS_V2 if t.get("purpose") != "baseline_competence"]
    runs = len(V2.TASKS_V2) * 5 * 2
    say("\n6. PLANNED CAMPAIGN CONFIGURATION")
    say("   task set       : v2 (%d tasks; %d discriminating)" % (len(V2.TASKS_V2), len(disc)))
    say("   repeats        : 5 per condition per task")
    say("   conditions     : SINGLE, MULTI")
    say("   total runs     : %d" % runs)
    say("   statistical    : %s" % I.OPTION_A["test"])
    say("   alpha          : %.2f" % I.OPTION_A["alpha"])
    say("   decided needed : %d of %d, all one direction"
        % (I.OPTION_A["decided_needed_for_significance"], len(disc)))
    say("   dimensions     : %d reported · %d tested (%s)"
        % (len(M.DIMENSIONS),
           sum(1 for d in M.DIMENSIONS if d["feeds_statistical_rule"]),
           ", ".join(d["key"] for d in M.DIMENSIONS if d["feeds_statistical_rule"])))
    say("   evaluator      : independent, blind token, LAW 10 enforced")
    say("   history        : campaigns #1-2 frozen, LAW 12 enforced")
    for t in V2.TASKS_V2:
        say("     %-32s %-20s %-17s $%.2f"
            % (t["id"], t["purpose"], t["favours"], t["max_usd"]))

    say("\n" + BAR)
    if fails:
        say("PRE-FLIGHT FAILED — %d problem(s). NOTHING IS SPENT." % len(fails))
        for f in fails:
            say("  - %s" % f)
    else:
        say("PRE-FLIGHT PASSED — the campaign may run exactly as pre-registered.")
    for n in notes:
        say("  note: %s" % n)
    say(BAR)
    return (not fails), fails


def main(argv=None):
    args = list(argv if argv is not None else sys.argv[1:])
    if "--seal" in args:
        os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
        with open(MANIFEST, "w", encoding="utf-8") as fh:
            json.dump(build_manifest(), fh, indent=2, sort_keys=True)
        print("sealed manifest written to %s" % MANIFEST)
        return 0
    ok, _ = preflight(require_provider="--no-provider" not in args)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
