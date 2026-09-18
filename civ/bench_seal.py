#!/usr/bin/env python3
"""RE-SEAL THE PRE-REGISTRATION.  python3 bench_seal.py [--write]

    python3 bench_seal.py            # print the manifest; change nothing
    python3 bench_seal.py --write    # write it, refusing to overwrite a seal

WHY THIS EXISTS
---------------
Campaign #3's manifest seals the tasks, the reference answers, the evaluators,
the metric definitions and the statistical rule. It does NOT seal the thing that
executes them. So after the harness was rewritten at 8312f3c and audited at
68721df, the pre-flight could still report

    MATCH : no task, reference answer or evaluator has moved

and be telling the exact truth while the experiment underneath had materially
changed: a condition that could not reach a tool became one that can.

Nothing scientific moved, and nothing scientific may move here. What moved is
the INSTRUMENT, and an instrument that can change without the seal noticing is
the same defect the campaigns kept finding in themselves. So the seal is
extended to cover the execution model, and a campaign run on a different harness
is refused rather than quietly compared to one that was not.

This module SPENDS NOTHING and RUNS NO MODEL. It hashes source.
"""
import argparse
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
from core import runtime                       # noqa: E402
import bench_run as R                          # noqa: E402
import campaign3_preflight as PF               # noqa: E402

MANIFEST = os.path.join(HERE, "bench_history", "harness-reseal-manifest.json")
C3_MANIFEST = PF.MANIFEST

# The commits that changed the execution model. The HASHES below decide, not
# these ids — they are here so the record says which work is being sealed.
HARNESS_COMMITS = {
    "8312f3cc8705a7d49fd4f3d54bf89a74580880c0":
        "the tool-use loop: agent_turn, explicit submission, one clip policy",
    "68721df08e0ac340bb5ca96f17f8e8d81b3a89fa":
        "adversarial integration audit: audit-trail holes closed",
}

# ── what the harness now is ─────────────────────────────────────────
EXECUTION_MODEL = {
    "shape": "model -> tool -> observation -> model, bounded, per role turn",
    "supported": [
        "a role may call a tool and SEE the result before it answers",
        "an observation re-enters the prompt before the next model call",
        "a role may act on what it read, including reading again",
        "a denied or failing call returns an observation it can respond to",
        "a role sequences its own tool steps within its turn",
        "submission is explicit and resolves only against gateway-written bytes",
    ],
    "single": "one agent_turn",
    "multi": "builder -> critic -> reviser, three agent_turns, one per role",
    "previous": ("one model call per role, then a single tool call made AFTER the "
                 "answer was already fixed; READ_REPO was granted on four tasks "
                 "and reachable on none"),
}

# ── what is still wrong, named before any run rather than after ─────
# A confound the pre-registration DECLARES cannot be discovered afterwards in a
# result's favour. Each carries the direction it can push, because a confound
# that can only hurt one condition is not the same object as one that can help it.
CONFOUNDS = [
    {"id": "C1-critic-token-budget",
     "what": "the critic turn runs at max_tokens=500; every other turn in either "
             "condition runs at 900",
     "scope": "MULTI-internal (SINGLE has no critic)",
     "direction": "can only CONSTRAIN multi, never flatter it",
     "why_not_fixed": "R23 pins 900/500 as the budgets that produced real answers "
                      "across campaigns #1-#2, and no measurement shows the 500 "
                      "ever bound. Raising it would retune a pre-registered "
                      "parameter on suspicion, which is the defect R23 exists to "
                      "prevent.",
     "resolve_by": "measure whether any critique was truncated by the cap, then "
                   "re-seal deliberately"},
    {"id": "C2-no-os-sandbox",
     "what": "EXECUTE_SANDBOX is a subprocess under the same user, not an OS "
             "boundary",
     "scope": "both conditions equally; verification runs outside both",
     "direction": "neutral between conditions; a real containment limit",
     "why_not_fixed": "out of scope for a benchmark change; asserted in code so "
                      "the limitation cannot be forgotten",
     "resolve_by": "a real boundary, at which point test_the_sandbox_is_honestly_"
                   "labelled must be replaced"},
    {"id": "C3-roles-rebuilt-per-run",
     "what": "principals are registered and their permissions rewritten from the "
             "task before every run",
     "scope": "both conditions equally",
     "direction": "neutral; it is what makes per-task capability parity provable",
     "why_not_fixed": "deliberate — a role carrying state between runs would make "
                      "run order a hidden variable",
     "resolve_by": "unchanged; this is a property, not a defect"},
    {"id": "C4-no-persistence",
     "what": "no role remembers anything between runs",
     "scope": "both conditions equally",
     "direction": "removes the mechanism the hypothesis calls persistent",
     "why_not_fixed": "the harness has no cross-run memory to give it",
     "resolve_by": "the word persistent stays untested; no result may claim it"},
    {"id": "C5-no-dynamic-team-formation",
     "what": "the role sequence is fixed at builder -> critic -> reviser",
     "scope": "MULTI",
     "direction": "tests A fixed pipeline, not an organisation that forms itself",
     "why_not_fixed": "out of scope for this change",
     "resolve_by": "any result must be reported as a fixed three-role pipeline"},
    {"id": "C6-no-parallel-execution",
     "what": "role turns are strictly sequential; runs are strictly sequential",
     "scope": "MULTI",
     "direction": "removes any speed advantage multi could have; LATENCY is "
                  "measured as if parallelism does not exist, which it does not",
     "why_not_fixed": "out of scope; sequential execution is also what makes the "
                      "artifact-name collision analysis hold",
     "resolve_by": "unchanged"},
    {"id": "C7-no-long-horizon-replanning",
     "what": "a role turn is bounded at MAX_TOOL_STEPS and the run ends after the "
             "fixed role sequence; nothing replans",
     "scope": "both conditions, asymmetrically in MULTI's favour on step count "
              "(3 turns x the same per-turn budget)",
     "direction": "caps what either can attempt; the extra steps MULTI gets are "
                  "already charged in COST and LATENCY",
     "why_not_fixed": "bounded execution is a safety property, not an oversight",
     "resolve_by": "unchanged; no result may claim long-horizon capability"},
]


def harness_sha():
    """Fingerprint of the execution model: every function, constant and prompt
    that decides what a condition can do.

    Raw source, comments included, exactly as evaluator_sha already treats the
    checkers. Over-sensitivity is the right failure mode for a seal: a hash that
    moves forces a deliberate re-seal, and a hash that does not move must mean
    the instrument really did not move."""
    return hashlib.sha256(json.dumps(harness_parts(), sort_keys=True,
                                     ensure_ascii=False).encode("utf-8")).hexdigest()


def harness_parts():
    """The components of the fingerprint, each hashed separately so a drift
    report can say WHICH part moved instead of only that something did."""
    def src(fn):
        return hashlib.sha256(inspect.getsource(fn).encode("utf-8")).hexdigest()

    return {
        # the loop and everything it is made of
        "agent_turn": src(R.agent_turn),
        "run_condition": src(R.run_condition),
        "clip": src(R.clip),
        "invoke_with_retry": src(R.invoke_with_retry),
        "is_transport_failure": src(R.is_transport_failure),
        "render_observation": src(R.render_observation),
        "verify": src(R.verify),
        # who the roles are and what they are granted
        "bench_crew": src(R.bench_crew),
        "principals": json.dumps(sorted([R.SOLO, R.BUILDER, R.CRITIC, R.REVISER,
                                         R.EVALUATOR])),
        # the authorisation path the loop calls
        "gateway_call": src(runtime.Gateway.call),
        "gateway_scope": src(runtime._scope_violation),
        "gateway_paths": src(runtime._resolve_paths),
        # every bound the model cannot talk its way past
        "limits": json.dumps({
            "MAX_TOOL_STEPS": R.MAX_TOOL_STEPS,
            "CLIP_BUDGET": R.CLIP_BUDGET,
            "MAX_TRANSPORT_RETRIES": R.MAX_TRANSPORT_RETRIES,
            "MAX_CONSECUTIVE_DENIALS": R.MAX_CONSECUTIVE_DENIALS,
            "RESERVED_ARGS": sorted(R.RESERVED_ARGS),
            "OBS": R.OBS,
        }, sort_keys=True),
        # what each role is told, and how much it may say
        "prompts": hashlib.sha256(json.dumps({
            "SCHEMA": R.SCHEMA, "SYS_SOLO": R.SYS_SOLO, "SYS_BUILD": R.SYS_BUILD,
            "SYS_CRITIC": R.SYS_CRITIC, "SYS_REVISE": R.SYS_REVISE,
        }, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest(),
        "max_tokens_per_role": json.dumps(role_token_budgets(), sort_keys=True),
    }


def role_token_budgets():
    """C1 is a declared confound, so the seal carries the numbers themselves —
    not a claim that they are equal."""
    return {"SOLO": 900, "BUILDER": 900, "CRITIC": 500, "REVISER": 900}


def build_reseal_manifest():
    """The scientific hashes are COPIED FORWARD, not recomputed independently:
    if any of them had moved, this manifest could not be built."""
    c3 = json.load(open(C3_MANIFEST, encoding="utf-8"))
    current = PF.build_manifest()
    moved = []
    for kind in ("tasks", "evaluators"):
        for key, sha in c3[kind].items():
            if current[kind].get(key) != sha:
                moved.append("%s %s" % (kind[:-1], key))
    if current["metrics_sha"] != c3["metrics_sha"]:
        moved.append("metrics_sha")
    if dict(current["statistical_rule"]) != dict(c3["statistical_rule"]):
        moved.append("statistical_rule")
    if moved:
        raise RuntimeError("REFUSING TO RE-SEAL: the re-seal may not alter the "
                           "science, and these moved: %s" % ", ".join(moved))
    return {
        "seal": "harness-reseal",
        "sealed_on": "2026-09-18",
        "supersedes": os.path.basename(C3_MANIFEST),
        "reason": "the execution model changed; nothing scientific did",
        "harness_commits": HARNESS_COMMITS,
        "authorises": [],
        # ── carried forward, byte-identical to campaign #3's seal ──
        "task_set": c3["task_set"],
        "tasks": c3["tasks"],
        "evaluators": c3["evaluators"],
        "metrics_sha": c3["metrics_sha"],
        "statistical_rule": c3["statistical_rule"],
        "campaign3_sealed_commit": c3["sealed_commit"],
        # ── new, and the whole point ──
        "harness_sha": harness_sha(),
        "harness_parts": harness_parts(),
        "execution_model": EXECUTION_MODEL,
        "confounds": CONFOUNDS,
    }


def drift(sealed=None):
    """Which parts of the harness have moved since the re-seal. Empty means the
    instrument is the one that was sealed."""
    sealed = sealed or (json.load(open(MANIFEST, encoding="utf-8"))
                        if os.path.exists(MANIFEST) else None)
    if not sealed:
        return ["no re-seal manifest at %s" % os.path.relpath(MANIFEST, HERE)]
    now = harness_parts()
    out = []
    for key, sha in sealed.get("harness_parts", {}).items():
        if now.get(key) != sha:
            out.append("%s: %s -> %s" % (key, sha[:12], (now.get(key) or "MISSING")[:12]))
    for key in set(now) - set(sealed.get("harness_parts", {})):
        out.append("%s: added since sealing" % key)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true",
                    help="write the manifest (refuses to overwrite an existing seal)")
    a = ap.parse_args(argv)
    man = build_reseal_manifest()
    if not a.write:
        print(json.dumps(man, indent=2, ensure_ascii=False))
        print("\n(nothing written; pass --write to seal)", file=sys.stderr)
        return 0
    if os.path.exists(MANIFEST):
        print("REFUSED: %s already exists. A seal is not overwritten in place — "
              "delete it deliberately or seal under a new name."
              % os.path.relpath(MANIFEST, HERE), file=sys.stderr)
        return 1
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump(man, fh, indent=2, ensure_ascii=False, sort_keys=True)
        fh.write("\n")
    print("sealed -> %s" % os.path.relpath(MANIFEST, HERE))
    print("harness_sha: %s" % man["harness_sha"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
