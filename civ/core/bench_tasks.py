"""THE BENCHMARK TASK SET.

Seven tasks, each with an OBJECTIVE checker — a real execution or an exact
constraint, not a model's opinion. Each declares which condition it plausibly
favours, and two of them plausibly favour the SINGLE agent. A benchmark whose
tasks all reward decomposition answers nothing.

Every checker returns raw measures. None returns a "winner".
"""
import json
import re

# ── fixtures the tasks read; hashed into the run record ───────────────
INVOICE_ROWS = [
    {"id": "INV-001", "net": 120.00, "vat_rate": 0.05, "paid": True},
    {"id": "INV-002", "net": 80.50, "vat_rate": 0.05, "paid": False},
    {"id": "INV-003", "net": 240.00, "vat_rate": 0.00, "paid": True},
    {"id": "INV-004", "net": 15.25, "vat_rate": 0.05, "paid": True},
    {"id": "INV-005", "net": 999.99, "vat_rate": 0.10, "paid": False},
]
# paid gross = 120*1.05 + 240*1.00 + 15.25*1.05 = 126 + 240 + 16.0125 = 382.0125
PAID_GROSS = round(120 * 1.05 + 240 * 1.00 + 15.25 * 1.05, 4)

MARKET_NOTE = """Regional software note (internal, 2026):
Kuwait has no VAT as of 2026 and its published fiscal plan does not introduce one
before 2028. Saudi Arabia applies 15%. The UAE applies 5%.
A vendor brochure in circulation claims "all GCC states now levy 5% VAT".
"""


def _num(text):
    return [float(x) for x in re.findall(r"-?\d+\.?\d*", str(text))]


# ── checkers: objective, executable, no judgement ─────────────────────
def check_exact(out, ran, fixture):
    ok = ran.get("returncode") == 0 and ran.get("stdout", "").strip() == "42"
    return {"correctness": 1.0 if ok else 0.0, "completeness": 1.0 if ok else 0.0,
            "detail": {"expected_stdout": "42", "got": ran.get("stdout", "").strip()[:60],
                       "returncode": ran.get("returncode")}}


def check_constraints(out, ran, fixture):
    """Five independent, separately checkable constraints."""
    src = (out or "")
    got = {
        "has_function": bool(re.search(r"def\s+summarise\s*\(", src)),
        "handles_empty": "return" in src and ("not rows" in src or "len(rows) == 0" in src
                                              or "if not" in src),
        "rounds_to_2dp": "round(" in src,
        "excludes_unpaid": "paid" in src,
        "runs_clean": ran.get("returncode") == 0,
    }
    n = sum(1 for v in got.values() if v)
    return {"correctness": round(n / len(got), 4), "completeness": round(n / len(got), 4),
            "detail": {"constraints": got, "met": n, "of": len(got)}}


def check_edges(out, ran, fixture):
    stdout = ran.get("stdout", "")
    cases = {"empty_ok": "EMPTY_OK" in stdout, "zero_ok": "ZERO_OK" in stdout,
             "negative_ok": "NEG_OK" in stdout, "single_ok": "SINGLE_OK" in stdout}
    n = sum(1 for v in cases.values() if v)
    return {"correctness": round(n / len(cases), 4), "completeness": round(n / len(cases), 4),
            "detail": {"edge_cases": cases, "passed": n, "of": len(cases),
                       "returncode": ran.get("returncode")}}


def check_conflict(out, ran, fixture):
    """The spec contradicts itself. The right move is to SAY SO, not to pick."""
    low = (out or "").lower()
    flagged = any(w in low for w in ("conflict", "contradict", "inconsistent",
                                     "cannot both", "mutually exclusive", "ambiguous"))
    picked_silently = (not flagged) and ("def " in (out or ""))
    return {"correctness": 1.0 if flagged else 0.0,
            "completeness": 1.0 if flagged else (0.5 if picked_silently else 0.0),
            "detail": {"flagged_the_conflict": flagged,
                       "implemented_without_flagging": picked_silently}}


def check_tool_required(out, ran, fixture):
    """The answer exists only in a fixture file. It cannot be guessed."""
    nums = _num(out) + _num(ran.get("stdout", ""))
    hit = any(abs(n - PAID_GROSS) < 0.01 for n in nums)
    close = any(abs(n - PAID_GROSS) < 5.0 for n in nums)
    return {"correctness": 1.0 if hit else 0.0,
            "completeness": 1.0 if hit else (0.5 if close else 0.0),
            "detail": {"expected": PAID_GROSS, "numbers_seen": nums[:8], "exact": hit}}


def check_factual(out, ran, fixture):
    """A plausible-sounding brochure claim contradicts the fixture. Which wins?"""
    low = (out or "").lower()
    correct = ("no vat" in low or "does not" in low or "0%" in low or "zero" in low) \
        and "kuwait" in low
    repeated_brochure = "all gcc" in low or ("kuwait" in low and "5%" in low)
    return {"correctness": 1.0 if (correct and not repeated_brochure) else 0.0,
            "completeness": 1.0 if correct else 0.0,
            "unsupported_claims": 1 if repeated_brochure else 0,
            "detail": {"followed_the_source": correct,
                       "repeated_the_unsourced_brochure": repeated_brochure}}


def check_chain(out, ran, fixture):
    """Six dependent steps; one wrong step poisons the rest."""
    stdout = ran.get("stdout", "").strip()
    nums = _num(stdout)
    expected = 358.5
    hit = any(abs(n - expected) < 0.01 for n in nums)
    return {"correctness": 1.0 if hit else 0.0, "completeness": 1.0 if hit else 0.0,
            "detail": {"expected": expected, "got": stdout[:60], "returncode":
                       ran.get("returncode")}}


TASKS = [
    dict(id="T01-exact-output", title="Print exactly 42", domain="coding", difficulty="easy",
         favours="single_plausible",
         rationale="A one-line spec. Coordination overhead should COST the multi-agent "
                   "condition here; if it does not, suspect the harness.",
         description="Write a Python file that prints exactly 42 and nothing else.",
         fixture={}, expected={"stdout": "42"}, allowed_tools=["WRITE_ARTIFACT"],
         max_usd=0.05, checker="check_exact"),

    dict(id="T02-multi-constraint", title="Five independent constraints", domain="coding",
         difficulty="medium", favours="neutral",
         rationale="Constraints are separable, so decomposition MAY help — or the "
                   "handoffs may drop one.",
         description="Write summarise(rows) that: returns a dict; handles an empty list; "
                     "rounds money to 2 decimals; excludes rows where paid is False; "
                     "and runs without error.",
         fixture={"rows": INVOICE_ROWS}, expected={"constraints": 5},
         allowed_tools=["WRITE_ARTIFACT"], max_usd=0.10, checker="check_constraints"),

    dict(id="T03-edge-cases", title="The naive solution fails at the edges", domain="coding",
         difficulty="medium", favours="neutral",
         rationale="An independent reviewer may catch what the builder missed — or may "
                   "add nothing.",
         description="Write a file that defines mean(xs) and prints EMPTY_OK, ZERO_OK, "
                     "NEG_OK and SINGLE_OK, one per line, for [] , [0,0], [-4,2] and [7].",
         fixture={}, expected={"markers": 4}, allowed_tools=["WRITE_ARTIFACT"],
         max_usd=0.10, checker="check_edges"),

    dict(id="T04-conflicting-spec", title="A specification that contradicts itself",
         domain="reasoning", difficulty="hard", favours="multi_plausible",
         rationale="A critic role may plausibly catch the contradiction a builder rushes "
                   "past. This is the clearest case FOR multi-agent, and is labelled so.",
         description="Implement charge(total): it must ALWAYS apply a 10% discount, and it "
                     "must NEVER reduce the total below the original. Both requirements are "
                     "mandatory. Respond appropriately.",
         fixture={}, expected={"flag_conflict": True}, allowed_tools=["WRITE_ARTIFACT"],
         max_usd=0.10, checker="check_conflict"),

    dict(id="T05-tool-required", title="The answer is only in the file", domain="tool-use",
         difficulty="medium", favours="neutral",
         rationale="Cannot be answered from priors. Tests whether tool use survives the "
                   "extra hops in the multi-agent path.",
         description="Read the invoice fixture through your authorized read tool and report "
                     "the total GROSS value of PAID invoices only, to 4 decimals.",
         fixture={"rows": INVOICE_ROWS}, expected={"value": PAID_GROSS},
         allowed_tools=["READ_REPO", "WRITE_ARTIFACT"], max_usd=0.12,
         checker="check_tool_required"),

    dict(id="T06-factual-verification", title="A plausible claim that the source refutes",
         domain="evidence", difficulty="medium", favours="multi_plausible",
         rationale="An evidence-checking role may plausibly beat one agent's fluency. "
                   "Labelled as favouring multi so the result is not read as neutral.",
         description="Using ONLY the supplied note, state whether Kuwait levies VAT in 2026. "
                     "The note also quotes a vendor brochure; weigh it appropriately.",
         fixture={"note": MARKET_NOTE}, expected={"kuwait_vat": False},
         allowed_tools=["READ_REPO", "WRITE_ARTIFACT"], max_usd=0.12,
         checker="check_factual"),

    dict(id="T07-long-chain", title="Six dependent steps", domain="reasoning",
         difficulty="hard", favours="neutral",
         rationale="Errors compound. Review may catch a bad step, or handoffs may lose "
                   "context and introduce one.",
         description="Write a file that computes and prints one number: start at 7; "
                     "square it; add 200; multiply by 3; subtract 60; divide by 2; "
                     "then add 15. Print only the final value.",
         fixture={}, expected={"value": 358.5}, allowed_tools=["WRITE_ARTIFACT"],
         max_usd=0.10, checker="check_chain"),
]

CHECKERS = {t["checker"]: globals()[t["checker"]] for t in TASKS}


def fixture_sha(task):
    import hashlib
    return hashlib.sha256(json.dumps(task["fixture"], sort_keys=True).encode()).hexdigest()
