"""PROPOSED CAMPAIGN #3 TASK SET — pre-registered, not yet run.

This is a PROPOSAL. No campaign has used it. Nothing here may be described as
better than v1 until it passes `bench_integrity.py`, and not as *working* until
a campaign actually runs it.

v1 (`bench_tasks.py`) is untouched, so campaigns #1 and #2 remain reproducible.

Every task declares, BEFORE any result exists:
  objective · difficulty_target · expected_failure_modes · checker ·
  meaningful_improvement · allowed_tools · allowed_evidence · max_usd ·
  relevance · purpose · favours · risk metadata · reference answers.

The reference answers are the important addition. Each task ships an answer that
SHOULD score high and one that SHOULD score low, and the integrity suite runs
every checker against them. T06 shipped an evaluator that scored the correct
answer 0.0 and the lazy answer 1.0; it survived two paid campaigns because no
such check existed. It cannot survive one now.

Three standing rules:
  - Difficulty is raised by making failure SILENT or by making constraints
    INTERACT — never by inventing puzzles designed to break one architecture.
  - Both conditions receive byte-identical input and identical tools. Any
    difference must come from the organisational architecture.
  - The set must be able to conclude AGAINST the organisation. V2-T08 exists
    specifically so an over-eager critic can measurably make things worse.
"""
import json
import re

# ── fixtures ──────────────────────────────────────────────────────────
INVOICE_ROWS = [
    {"id": "INV-001", "net": 120.00, "vat_rate": 0.05, "paid": True},
    {"id": "INV-002", "net": 80.50, "vat_rate": 0.05, "paid": False},
    {"id": "INV-003", "net": 240.00, "vat_rate": 0.00, "paid": True},
    {"id": "INV-004", "net": 15.25, "vat_rate": 0.05, "paid": True},
    {"id": "INV-005", "net": 999.99, "vat_rate": 0.10, "paid": False},
]
PAID_GROSS = round(120 * 1.05 + 240 * 1.00 + 15.25 * 1.05, 4)   # 382.0125

MARKET_NOTE = """Regional software note (internal, 2026):
Kuwait has no VAT as of 2026 and its published fiscal plan does not introduce one
before 2028. Saudi Arabia applies 15%. The UAE applies 5%.
A vendor brochure in circulation claims "all GCC states now levy 5% VAT".
"""

# V2-T08: a CORRECT implementation handed to the agent for review.
# Every test it must still pass is listed with it. Breaking it is the failure.
ALREADY_CORRECT = '''def median(xs):
    if not xs:
        return None
    s = sorted(xs)
    n = len(s)
    mid = n // 2
    if n % 2:
        return float(s[mid])
    return (s[mid - 1] + s[mid]) / 2.0
'''
MEDIAN_CASES = [([], None), ([5], 5.0), ([1, 3], 2.0), ([3, 1, 2], 2.0),
                ([1, 2, 3, 4], 2.5), ([-4, 2], -1.0), ([2, 2, 2], 2.0)]

# V2-T09: code with ONE subtle defect. It runs, and looks right.
# The bug: `>` should be `>=`, so the LAST maximum is not reported on ties,
# and the documented tie-break ("report the earliest index") is violated only
# for inputs where the maximum repeats. Obvious tests pass.
SUBTLE_DEFECT = '''def argmax_first(xs):
    """Return the index of the largest value.
    On ties, return the EARLIEST index at which the maximum occurs."""
    best_i = 0
    best = xs[0]
    for i in range(len(xs)):
        if xs[i] >= best:
            best = xs[i]
            best_i = i
    return best_i
'''


def _num(text):
    return [float(x) for x in re.findall(r"-?\d+\.?\d*", str(text))]


def _run_python(src, harness):
    """Execute a candidate in-process against a harness. Deterministic, no model.

    Used only by the integrity suite to validate CHECKERS against reference
    answers. Campaign runs execute through the Tool Gateway sandbox as before —
    this never becomes a second execution path for agents."""
    ns = {}
    try:
        exec(compile(src, "<candidate>", "exec"), ns)      # noqa: S102 - fixtures only
    except Exception as e:                                  # noqa: BLE001
        return None, "did not compile/run: %r" % (e,)
    try:
        return harness(ns), None
    except Exception as e:                                  # noqa: BLE001
        return None, "raised during harness: %r" % (e,)


# ── checkers: objective, executable, no judgement ─────────────────────
def check_exact(out, ran, fixture):
    ok = ran.get("returncode") == 0 and ran.get("stdout", "").strip() == "42"
    return {"correctness": 1.0 if ok else 0.0, "completeness": 1.0 if ok else 0.0,
            "detail": {"expected_stdout": "42", "got": ran.get("stdout", "").strip()[:60]}}


def check_interacting(out, ran, fixture):
    """v2. Constraints that INTERACT, scored by EXECUTION.

    v1 scored this by grepping the source for `round(` and the word `paid`,
    which a comment could satisfy. Nothing here reads the source text."""
    def harness(ns):
        f = ns.get("summarise")
        if not callable(f):
            raise ValueError("no summarise()")
        return {
            "empty": f([]),
            "paid_only": f(INVOICE_ROWS),
            "all_unpaid": f([r for r in INVOICE_ROWS if not r["paid"]]),
        }

    got, err = _run_python(out or "", harness)
    checks = {"runs_clean": err is None, "handles_empty": False,
              "excludes_unpaid": False, "rounds_to_2dp": False,
              "no_divide_by_zero": False}
    detail = {"error": err}
    if got:
        empty, paid, unpaid = got["empty"], got["paid_only"], got["all_unpaid"]
        checks["handles_empty"] = isinstance(empty, dict)
        try:
            checks["no_divide_by_zero"] = isinstance(unpaid, dict) and (
                unpaid.get("count") in (0, None))
        except Exception:                                   # noqa: BLE001
            pass
        try:
            total = float(paid.get("total"))
            checks["excludes_unpaid"] = abs(total - PAID_GROSS) < 0.02
            checks["rounds_to_2dp"] = abs(total - round(total, 2)) < 1e-9
        except Exception:                                   # noqa: BLE001
            pass
        detail["returned"] = {k: str(v)[:80] for k, v in got.items()}
    n = sum(1 for v in checks.values() if v)
    return {"correctness": round(n / len(checks), 4),
            "completeness": round(n / len(checks), 4),
            "detail": dict(detail, constraints=checks, met=n, of=len(checks))}


def check_silent_wrong(out, ran, fixture):
    """v2. The naive implementation returns a plausible WRONG number, no crash.

    SCORING SHAPE, corrected by the integrity gate before this task ever ran:
    the two ordinary cases are a GATE, not credit. Scoring them gave the naive
    answer 0.60 for free and squeezed the whole measurement into 0.60-1.00 — a
    ceiling wearing a different hat. Fail an ordinary case and the answer is
    broken: 0.0. Pass them and the score comes only from the cases that
    actually separate. The rule is symmetric and has no view on who is answering.
    """
    def harness(ns):
        f = ns.get("pct_change")
        if not callable(f):
            raise ValueError("no pct_change()")
        return [f(100, 110), f(100, 90), f(0, 5), f(0, 0), f(-50, -25)]

    got, err = _run_python(out or "", harness)
    detail = {"error": err}
    if not got:
        return {"correctness": 0.0, "completeness": 0.0,
                "detail": dict(detail, gate="did not run")}
    a, b, c, d, e = got
    try:
        gate = abs(float(a) - 10.0) < 0.01 and abs(float(b) - (-10.0)) < 0.01
    except Exception:                                       # noqa: BLE001
        gate = False
    if not gate:
        return {"correctness": 0.0, "completeness": 0.0,
                "detail": dict(detail, gate="failed the ordinary cases",
                               returned=[str(x)[:40] for x in got])}
    # Only the discriminating cases carry score.
    cases = {
        # an undefined percentage must be SIGNALLED, not silently numbered
        "zero_baseline_signalled": c is None or isinstance(c, str) or (
            isinstance(c, float) and c != c),
        "zero_to_zero_defined": d is None or isinstance(d, str) or (
            isinstance(d, (int, float)) and float(d) == 0.0),
        "negative_baseline_sign": False,
    }
    try:
        cases["negative_baseline_sign"] = abs(float(e) - 50.0) < 0.01
    except Exception:                                       # noqa: BLE001
        pass
    n = sum(1 for v in cases.values() if v)
    return {"correctness": round(n / len(cases), 4),
            "completeness": round(n / len(cases), 4),
            "detail": dict(detail, gate="passed", scoring_cases=cases,
                           passed=n, of=len(cases),
                           returned=[str(x)[:40] for x in got])}


def check_conflict(out, ran, fixture):
    """UNCHANGED from v1. This task replicated across both campaigns and is the
    organisation's one demonstrated advantage. Editing a task that works, after
    seeing that it works, would be fitting the instrument to the result."""
    low = (out or "").lower()
    flagged = any(w in low for w in ("conflict", "contradict", "inconsistent",
                                     "cannot both", "mutually exclusive", "ambiguous"))
    picked_silently = (not flagged) and ("def " in (out or ""))
    return {"correctness": 1.0 if flagged else 0.0,
            "completeness": 1.0 if flagged else (0.5 if picked_silently else 0.0),
            "detail": {"flagged_the_conflict": flagged,
                       "implemented_without_flagging": picked_silently}}


def check_tool_required(out, ran, fixture):
    nums = _num(out) + _num(ran.get("stdout", ""))
    hit = any(abs(n - PAID_GROSS) < 0.01 for n in nums)
    close = any(abs(n - PAID_GROSS) < 5.0 for n in nums)
    return {"correctness": 1.0 if hit else 0.0,
            "completeness": 1.0 if hit else (0.5 if close else 0.0),
            "detail": {"expected": PAID_GROSS, "numbers_seen": nums[:8]}}


def check_factual(out, ran, fixture):
    """R16's corrected evaluator, carried into v2 unchanged.

    Correctness turns on the only thing that can be wrong: asserting Kuwait
    levies VAT. Whether the brochure was explicitly rejected is a SEPARATE
    dimension. Judged per sentence and in either word order, because a sentence
    that ATTRIBUTES the claim in order to reject it is the correct answer."""
    low = (out or "").lower()
    says_no_vat = "kuwait" in low and any(
        p in low for p in ("no vat", "does not levy", "doesn't levy", "not levy",
                           "no value added", "0%", "zero vat", "vat-free", "vat free"))
    attribution = ("brochure", "claim", "alleg", "unsourced", "contradict", "refut",
                   "disregard", "not supported", "unsupported", "incorrect",
                   "outdated", "unreliable", "false", "wrong")
    asserted = False
    for sentence in re.split(r"[.\n;]", low):
        if "5" not in sentence or "%" not in sentence:
            continue
        if not any(w in sentence for w in ("kuwait", "all gcc", "every gcc")):
            continue
        if not re.search(r"\b(levy|levies|levied|apply|applies|charge|charges|"
                         r"impose|imposes|has|have|introduc\w*)\b", sentence):
            continue
        if any(w in sentence for w in attribution):
            continue
        asserted = True
        break
    rejected = any(w in low for w in ("brochure", "unsourced", "contradict", "refut",
                                      "disregard", "not supported", "unsupported",
                                      "incorrect", "outdated", "unreliable"))
    correct = says_no_vat and not asserted
    return {"correctness": 1.0 if correct else 0.0,
            "completeness": 1.0 if (correct and rejected) else (0.5 if correct else 0.0),
            "evidence_quality": 1.0 if (correct and rejected) else 0.0,
            "unsupported_claims": 1 if asserted else 0,
            "detail": {"followed_the_source": says_no_vat,
                       "asserted_kuwait_has_vat": asserted,
                       "weighed_the_brochure": rejected}}


def check_long_chain(out, ran, fixture):
    """v2. Longer, with a precision step that rewards exactness.

    Chain: start 7 -> square -> +200 -> *3 -> -60 -> /2 -> +15 -> /7 -> round 4dp.
    358.5 / 7 = 51.214285714... -> 51.2143. A model that rounds early lands
    elsewhere; the error is silent and the output still looks like a number."""
    stdout = ran.get("stdout", "").strip()
    nums = _num(stdout)
    expected = round(((7 ** 2 + 200) * 3 - 60) / 2 + 15, 10) / 7
    exact = any(abs(n - round(expected, 4)) < 0.00005 for n in nums)
    near = any(abs(n - expected) < 0.01 for n in nums)
    return {"correctness": 1.0 if exact else 0.0,
            "completeness": 1.0 if exact else (0.5 if near else 0.0),
            "detail": {"expected": round(expected, 4), "got": stdout[:60]}}


def check_do_no_harm(out, ran, fixture):
    """v2, NEW. A CORRECT implementation was handed over for review.

    Scored purely on whether every original behaviour still holds. Leaving it
    untouched scores 1.00. This is the task that lets the benchmark conclude
    AGAINST the organisation: an over-eager critic that 'improves' working code
    into broken code is measured here, and nowhere else."""
    src = out or ""
    def harness(ns):
        f = ns.get("median")
        if not callable(f):
            raise ValueError("no median()")
        return [f(list(xs)) for xs, _ in MEDIAN_CASES]

    got, err = _run_python(src, harness)
    if err:
        return {"correctness": 0.0, "completeness": 0.0,
                "detail": {"error": err, "note": "the reviewed code no longer runs"}}
    kept = []
    for (xs, want), have in zip(MEDIAN_CASES, got):
        ok = (have is None and want is None) or (
            have is not None and want is not None and abs(float(have) - want) < 1e-9)
        kept.append(ok)
    n = sum(1 for k in kept if k)
    return {"correctness": round(n / len(kept), 4),
            "completeness": round(n / len(kept), 4),
            "detail": {"behaviours_preserved": n, "of": len(kept),
                       "per_case": [{"input": xs, "want": w, "got": g, "ok": k}
                                    for (xs, w), g, k in zip(MEDIAN_CASES, got, kept)]}}


def check_find_defect(out, ran, fixture):
    """v2, NEW. One subtle defect, in code that runs and looks right.

    Credit requires NAMING the tie-break failure, not merely rewriting the
    function. A rewrite that happens to be correct without identifying the bug
    scores partially — the task is detection."""
    low = (out or "").lower()
    named = any(p in low for p in ("tie", "ties", "equal", "duplicate", ">=", "earliest",
                                   "first occurrence", "last occurrence"))
    located = ">=" in (out or "") or "greater than or equal" in low
    def harness(ns):
        f = ns.get("argmax_first")
        return None if not callable(f) else [f([1, 3, 3, 2]), f([5, 1, 5]), f([2, 2])]
    got, _ = _run_python(out or "", harness)
    fixed = bool(got) and got == [1, 0, 0]
    score = 0.0
    if named and located:
        score = 1.0
    elif named:
        score = 0.7
    elif fixed:
        score = 0.5
    return {"correctness": score, "completeness": 1.0 if (named or fixed) else 0.0,
            "detail": {"named_the_tie_break": named, "located_the_operator": located,
                       "rewrote_it_correctly": fixed}}


# ── the proposed set ──────────────────────────────────────────────────
TASKS_V2 = [
    dict(
        id="V2-T01-baseline", title="Print exactly 42", domain="coding",
        difficulty="trivial", purpose="baseline_competence", favours="single_plausible",
        objective="Establish that both conditions can complete a task with no room for "
                  "interpretation, and price the coordination overhead of doing so.",
        difficulty_target="Both conditions at 1.00. A ceiling here is CORRECT — this "
                          "task measures cost and overhead, not quality.",
        expected_failure_modes=["none expected; any failure indicates a harness fault"],
        meaningful_improvement="None on correctness. The measurement is the cost ratio: "
                               "campaigns 1-2 showed multi paying 6.6x for a "
                               "byte-identical answer.",
        allowed_tools=["WRITE_ARTIFACT"], allowed_evidence=["the task text"],
        max_usd=0.05,
        relevance="Without a trivial task the benchmark cannot price coordination "
                  "overhead in isolation from quality.",
        description="Write a Python file that prints exactly 42 and nothing else.",
        fixture={}, checker="check_exact",
        risk=dict(ceiling="HIGH_BY_DESIGN", floor="LOW", leakage="N/A",
                  stochasticity="LOW", expected_discriminative_power="NONE_BY_DESIGN"),
        reference_good='print(42)',
        reference_bad='print("the answer is 42")',
    ),
    dict(
        id="V2-T02-interacting-constraints", title="Constraints that interact",
        domain="coding", difficulty="medium", purpose="discrimination", favours="neutral",
        objective="Five requirements that cannot be satisfied independently: excluding "
                  "unpaid rows changes the total, which changes the rounding, and the "
                  "empty case must not divide by zero.",
        difficulty_target="0.4-0.9 in both conditions. Interaction, not quantity, is "
                          "what keeps it off the ceiling.",
        expected_failure_modes=["drops one constraint while satisfying the rest",
                                "divides by zero on the all-unpaid input",
                                "rounds each row instead of the total"],
        meaningful_improvement="+0.15 correctness, replicated, or a lower rate of "
                               "dropped constraints.",
        allowed_tools=["WRITE_ARTIFACT"], allowed_evidence=["the task text", "the fixture"],
        max_usd=0.12,
        relevance="Decomposition should help here if it helps anywhere; handoffs may "
                  "equally drop a constraint. v1's version scored this by grepping the "
                  "source, which a comment could satisfy — v2 executes it.",
        description="Write summarise(rows) returning a dict with keys total, count and "
                    "average for PAID rows only. Gross is net * (1 + vat_rate). Round "
                    "money to 2 decimals. An empty list, and a list with no paid rows, "
                    "must both return a dict rather than raising.",
        fixture={"rows": INVOICE_ROWS}, checker="check_interacting",
        risk=dict(ceiling="LOW", floor="LOW", leakage="N/A", stochasticity="MEDIUM",
                  expected_discriminative_power="MEDIUM"),
        reference_good='''def summarise(rows):
    paid = [r for r in rows if r.get("paid")]
    if not paid:
        return {"total": 0.0, "count": 0, "average": 0.0}
    total = round(sum(r["net"] * (1 + r["vat_rate"]) for r in paid), 2)
    return {"total": total, "count": len(paid),
            "average": round(total / len(paid), 2)}
''',
        reference_bad='''def summarise(rows):
    total = sum(r["net"] for r in rows)
    return {"total": total, "count": len(rows), "average": total / len(rows)}
''',
    ),
    dict(
        id="V2-T03-silent-wrong", title="The wrong answer looks like a number",
        domain="coding", difficulty="medium", purpose="discrimination", favours="neutral",
        objective="A percentage change with a zero baseline has no meaningful value. The "
                  "naive implementation returns one anyway, and nothing announces it.",
        difficulty_target="0.0-1.0 across the full range. The two ordinary cases GATE "
                          "rather than score, so the naive answer cannot bank 0.60 for "
                          "free. Corrected by the integrity gate before first run.",
        expected_failure_modes=["returns 0.0 for a zero baseline instead of signalling",
                                "raises ZeroDivisionError and calls that handling it",
                                "gets the sign wrong on a negative baseline"],
        meaningful_improvement="+0.15 correctness, replicated. An independent reviewer "
                               "plausibly catches the undefined case the builder passed over.",
        allowed_tools=["WRITE_ARTIFACT"], allowed_evidence=["the task text"],
        max_usd=0.12,
        relevance="Silent wrongness is the realistic failure that review exists to catch. "
                  "A benchmark of only loud failures tests the wrong thing.",
        description="Write pct_change(old, new) returning the percentage change from old "
                    "to new. Handle the case where old is 0 in a way that cannot be "
                    "mistaken for a real percentage. Do not raise.",
        fixture={}, checker="check_silent_wrong",
        risk=dict(ceiling="LOW", floor="LOW", leakage="N/A", stochasticity="MEDIUM",
                  expected_discriminative_power="MEDIUM"),
        reference_good='''def pct_change(old, new):
    if old == 0:
        return None if new != 0 else 0.0
    return (new - old) / abs(old) * 100.0
''',
        reference_bad='''def pct_change(old, new):
    if old == 0:
        return 0.0
    return (new - old) / old * 100.0
''',
    ),
    dict(
        id="V2-T04-conflicting-spec", title="A specification that contradicts itself",
        domain="reasoning", difficulty="hard", purpose="discrimination",
        favours="multi_plausible",
        objective="The spec demands two things that cannot both hold. The correct move "
                  "is to say so rather than silently pick one.",
        difficulty_target="UNCHANGED from v1. Observed 0.80 single / 1.00 multi in both "
                          "campaigns. Not to be edited — a task that works must not be "
                          "retuned after the fact.",
        expected_failure_modes=["implements one requirement and never mentions the clash",
                                "intermittent total miss: single scored 0.00 on 2 of 10 runs"],
        meaningful_improvement="Campaigns 1-2 already showed this. What matters now is "
                               "whether the RELIABILITY gap holds: single failed outright "
                               "2/10, multi 0/10. That is the claim to re-test.",
        allowed_tools=["WRITE_ARTIFACT"], allowed_evidence=["the task text"],
        max_usd=0.12,
        relevance="An independent critic reading with fresh eyes is the organisation's "
                  "clearest mechanism. This is where it should show, and it did.",
        description="Implement charge(total): it must ALWAYS apply a 10% discount, and it "
                    "must NEVER reduce the total below the original. Both requirements "
                    "are mandatory. Respond appropriately.",
        fixture={}, checker="check_conflict",
        risk=dict(ceiling="LOW", floor="LOW", leakage="N/A", stochasticity="ASYMMETRIC",
                  expected_discriminative_power="DEMONSTRATED"),
        reference_good="These two requirements contradict each other: a mandatory 10% "
                       "discount always reduces the total, which the second requirement "
                       "forbids. They cannot both hold. Please confirm which takes "
                       "precedence.",
        reference_bad="def charge(total):\n    return total * 0.9\n",
    ),
    dict(
        id="V2-T05-tool-required", title="The answer is only in the file",
        domain="tool-use", difficulty="medium", purpose="discrimination", favours="neutral",
        objective="Report a figure that exists only in a file reachable through the "
                  "authorised read tool.",
        difficulty_target="0.5-1.0. Carries R17's fix: the fixture is on disk and the "
                          "prompt holds only its path.",
        expected_failure_modes=["never calls the tool and guesses",
                                "calls the tool but loses the figure across handoffs",
                                "sums all rows instead of paid rows"],
        meaningful_improvement="+0.15 correctness, or a lower rate of tool-call loss "
                               "in the multi path, replicated.",
        allowed_tools=["READ_REPO", "WRITE_ARTIFACT"],
        allowed_evidence=["the task text", "the fixture file via READ_REPO"],
        max_usd=0.12,
        relevance="Tests whether tool use survives the extra hops of the multi path. In "
                  "v1 this measured arithmetic instead, because the fixture was pasted "
                  "into the prompt.",
        description="Report the total GROSS value of PAID invoices only, to 4 decimals.",
        fixture={"rows": INVOICE_ROWS}, fixture_via_tool=True, checker="check_tool_required",
        risk=dict(ceiling="MEDIUM", floor="LOW", leakage="FIXED_R17",
                  stochasticity="LOW", expected_discriminative_power="UNKNOWN"),
        reference_good="The total gross value of paid invoices is 382.0125",
        reference_bad="The total is approximately 400",
    ),
    dict(
        id="V2-T06-factual-verification", title="A plausible claim the source refutes",
        domain="evidence", difficulty="medium", purpose="discrimination",
        favours="multi_plausible",
        objective="A fluent, unsourced claim contradicts the supplied note. The note wins.",
        difficulty_target="0.3-0.9. Carries R16's corrected evaluator. v1's version "
                          "scored the correct answer 0.00 and the lazy answer 1.00.",
        expected_failure_modes=["repeats the brochure's figure as fact",
                                "answers correctly but never weighs the brochure "
                                "(scored on completeness, not correctness)"],
        meaningful_improvement="+0.15 correctness, replicated, or fewer unsupported "
                               "claims at equal correctness.",
        allowed_tools=["READ_REPO", "WRITE_ARTIFACT"],
        allowed_evidence=["the task text", "the supplied note"],
        max_usd=0.12,
        relevance="An evidence-checking role should beat one agent's fluency. Whether it "
                  "does is unknown: v1 never measured it.",
        description="Using ONLY the supplied note, state whether Kuwait levies VAT in "
                    "2026. The note also quotes a vendor brochure; weigh it appropriately.",
        fixture={"note": MARKET_NOTE}, checker="check_factual",
        risk=dict(ceiling="UNKNOWN", floor="FIXED_R16", leakage="N/A",
                  stochasticity="UNKNOWN", expected_discriminative_power="UNKNOWN"),
        reference_good="Based only on the note, Kuwait does not levy VAT in 2026. The "
                       "vendor brochure claiming all GCC states now levy 5% VAT is "
                       "unsourced and is contradicted by the note, so it should be "
                       "disregarded.",
        reference_bad="All GCC states now levy 5% VAT, including Kuwait.",
    ),
    dict(
        id="V2-T07-long-chain", title="Dependent steps, and a precision trap",
        domain="reasoning", difficulty="hard", purpose="discrimination",
        favours="single_plausible",
        objective="Eight dependent steps ending in a division that does not terminate. "
                  "Rounding early is silently wrong.",
        difficulty_target="0.3-0.9. v1's six-step version sat at 1.00/1.00; the trailing "
                          "division and 4-decimal requirement are what move it.",
        expected_failure_modes=["rounds an intermediate step and lands near but not on",
                                "reports 51.21 instead of 51.2143",
                                "handoffs drop a step in the multi path"],
        meaningful_improvement="+0.15 correctness, replicated. A single agent holding one "
                               "coherent chain plausibly beats a team passing it along.",
        allowed_tools=["WRITE_ARTIFACT"], allowed_evidence=["the task text"],
        max_usd=0.12,
        relevance="Declared as favouring the SINGLE agent. A set that never rewards "
                  "working alone cannot answer the benchmark question.",
        description="Write a file that computes and prints one number: start at 7; square "
                    "it; add 200; multiply by 3; subtract 60; divide by 2; add 15; then "
                    "divide by 7. Print the final value rounded to exactly 4 decimals, "
                    "and nothing else. Do not round any intermediate step.",
        fixture={}, checker="check_long_chain",
        risk=dict(ceiling="MEDIUM", floor="LOW", leakage="N/A", stochasticity="UNKNOWN",
                  expected_discriminative_power="UNKNOWN"),
        reference_good='print(round(((((7**2) + 200) * 3 - 60) / 2 + 15) / 7, 4))',
        reference_bad='print(51.21)',
    ),
    dict(
        id="V2-T08-do-no-harm", title="The code handed to you is already correct",
        domain="review", difficulty="medium", purpose="discrimination",
        favours="single_plausible",
        objective="Correct code is submitted for review. Every original behaviour must "
                  "still hold afterwards. Changing nothing scores 1.00.",
        difficulty_target="Both conditions high, but this is the task where a critic can "
                          "measurably LOSE. If multi scores below single here, that is a "
                          "real cost of the architecture and must be reported as one.",
        expected_failure_modes=["a critic 'simplifies' the even-length branch and breaks "
                                "the 2-element case",
                                "rewrites with statistics.median and changes the empty-list "
                                "contract from None to an exception",
                                "returns an int where the original returned a float"],
        meaningful_improvement="For this task, improvement means NOT regressing. A "
                               "sustained gap in either direction of 0.15 is meaningful.",
        allowed_tools=["WRITE_ARTIFACT"], allowed_evidence=["the task text", "the code"],
        max_usd=0.12,
        relevance="Without this the benchmark cannot detect the most likely real cost of "
                  "multi-agent work: churn on things that were already fine. v1 had no "
                  "such task, so two campaigns could not have found this harm.",
        description=("Review the following function. Return the final version of the code "
                     "you would ship, and nothing else. It must keep every existing "
                     "behaviour, including returning None for an empty list and a float "
                     "for every non-empty list.\n\n" + ALREADY_CORRECT),
        fixture={"source": ALREADY_CORRECT}, checker="check_do_no_harm",
        risk=dict(ceiling="MEDIUM", floor="LOW", leakage="N/A", stochasticity="UNKNOWN",
                  expected_discriminative_power="UNKNOWN"),
        reference_good=ALREADY_CORRECT,
        reference_bad='''def median(xs):
    s = sorted(xs)
    return s[len(s) // 2]
''',
    ),
    dict(
        id="V2-T09-find-defect", title="One subtle defect in code that runs",
        domain="review", difficulty="hard", purpose="discrimination",
        favours="multi_plausible",
        objective="Find and name a documented-contract violation in code that compiles, "
                  "runs, and passes the obvious tests.",
        difficulty_target="0.3-0.8. The bug only shows on inputs where the maximum repeats.",
        expected_failure_modes=["declares the code correct because it runs",
                                "rewrites it without identifying what was wrong",
                                "invents a different, non-existent bug"],
        meaningful_improvement="+0.15 correctness, replicated. Detection, not rewriting, "
                               "is what is scored.",
        allowed_tools=["WRITE_ARTIFACT"], allowed_evidence=["the task text", "the code"],
        max_usd=0.12,
        relevance="The complement of V2-T08: there, review must not act; here, it must. "
                  "Together they measure whether a critic's judgement is discriminating "
                  "or merely active.",
        description=("The following function documents its tie-breaking behaviour. Does "
                     "the implementation honour that contract? If not, say precisely what "
                     "is wrong and why.\n\n" + SUBTLE_DEFECT),
        fixture={"source": SUBTLE_DEFECT}, checker="check_find_defect",
        risk=dict(ceiling="LOW", floor="MEDIUM", leakage="N/A", stochasticity="UNKNOWN",
                  expected_discriminative_power="UNKNOWN"),
        reference_good="The implementation violates its contract. The comparison uses >= "
                       "instead of >, so on ties the LAST occurrence of the maximum is "
                       "returned, not the earliest as documented.",
        reference_bad="The function looks correct and returns the index of the maximum.",
    ),
]

CHECKERS_V2 = {t["checker"]: globals()[t["checker"]] for t in TASKS_V2}

FIXTURE_DIRNAME = "bench_fixtures"


def fixture_path(task, repo_root):
    import os
    return os.path.join(repo_root, FIXTURE_DIRNAME, "%s.json" % task["id"])


def materialise_fixtures(repo_root):
    import os
    written = []
    for t in TASKS_V2:
        if not t.get("fixture_via_tool"):
            continue
        path = fixture_path(t, repo_root)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(t["fixture"], fh, ensure_ascii=False, indent=2)
        written.append(path)
    return written


def discriminating_tasks():
    """Tasks that are supposed to separate the conditions. A baseline-competence
    task is deliberately excluded from that count."""
    return [t for t in TASKS_V2 if t.get("purpose") != "baseline_competence"]


def favours_balance():
    out = {}
    for t in discriminating_tasks():
        out[t["favours"]] = out.get(t["favours"], 0) + 1
    return out
