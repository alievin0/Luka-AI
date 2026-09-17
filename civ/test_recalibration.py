"""Recalibration: the freeze, the diagnosis, and the integrity gate.

Every test here is deterministic. No model is called and no campaign is run.
"""
import json
import os
import sqlite3
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import bench_diagnosis as D          # noqa: E402
from core import bench_integrity as I          # noqa: E402
from core import bench_tasks as V1             # noqa: E402
from core import bench_tasks_v2 as V2          # noqa: E402
from core import store                         # noqa: E402
from bench_recalibrate import task_input_v2     # noqa: E402


class FrozenHistory(unittest.TestCase):
    """Campaigns #1 and #2 are evidence. They are never re-scored."""

    def test_both_campaigns_are_on_disk_with_their_conclusions(self):
        camps = D.load_history()
        self.assertEqual([c["campaign_id"] for c in camps], [1, 2])
        for c in camps:
            self.assertEqual(c["conclusion"], "INSUFFICIENT_EVIDENCE")
            self.assertEqual(c["tasks_decided"], 2)
            self.assertEqual(len(c["per_task"]), 7)

    def test_the_defects_are_preserved_not_corrected(self):
        """T06 still reads 0.0 in the frozen record. Applying R16 backwards
        would invent numbers no model ever earned."""
        for c in D.load_history():
            t6 = c["per_task"]["T06-factual-verification"]
            self.assertEqual(t6["s"], 0.0)
            self.assertEqual(t6["m"], 0.0)
            self.assertEqual(t6["s_completeness"], 1.0)

    def test_a_closed_campaign_cannot_be_rewritten_or_deleted(self):
        with tempfile.TemporaryDirectory() as d:
            con = store.connect(os.path.join(d, "t.db"))
            store.found(con, mode="simulation")
            cid = con.execute(
                "INSERT INTO bench_campaigns(name,git_commit,provider,model,config_sha,"
                "repeats,started_at,finished_at,conclusion) "
                "VALUES('c','g','claude','m','s',5,'t0','t1','INSUFFICIENT_EVIDENCE')"
            ).lastrowid
            con.commit()
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("UPDATE bench_campaigns SET conclusion='MULTI_WINS' WHERE id=?",
                            (cid,))
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute("DELETE FROM bench_campaigns WHERE id=?", (cid,))

    def test_an_open_campaign_is_still_writable(self):
        """The law freezes history, not work in progress."""
        with tempfile.TemporaryDirectory() as d:
            con = store.connect(os.path.join(d, "t.db"))
            store.found(con, mode="simulation")
            cid = con.execute(
                "INSERT INTO bench_campaigns(name,git_commit,provider,model,config_sha,"
                "repeats,started_at) VALUES('c','g','claude','m','s',5,'t0')").lastrowid
            con.execute("UPDATE bench_campaigns SET finished_at='t1' WHERE id=?", (cid,))
            con.commit()


class DiagnosisIsEvidenceDriven(unittest.TestCase):
    """The verdicts must fall out of the frozen data, not out of my opinion."""

    def setUp(self):
        self.camps = D.load_history()
        self.by_id = {d["task_id"]: d for d in D.diagnose_all(V1.TASKS, self.camps)}

    def test_t06_is_invalid_for_a_self_contradicting_evaluator(self):
        d = self.by_id["T06-factual-verification"]
        self.assertEqual(d["verdict"], D.INVALID)
        self.assertEqual(d["risks"]["evaluator"][0], "HIGH")

    def test_t05_is_invalid_for_leakage(self):
        d = self.by_id["T05-tool-required"]
        self.assertEqual(d["verdict"], D.INVALID)
        self.assertEqual(d["risks"]["leakage"][0], "HIGH")

    def test_the_ceiling_tasks_are_flagged(self):
        for tid in ("T01-exact-output", "T03-edge-cases", "T07-long-chain"):
            self.assertEqual(self.by_id[tid]["risks"]["ceiling"][0], "HIGH", tid)

    def test_t04_is_valid_and_measures_reliability_not_quality(self):
        d = self.by_id["T04-conflicting-spec"]
        self.assertEqual(d["verdict"], D.VALID)
        self.assertEqual(d["risks"]["stochasticity"][0], "ASYMMETRIC")
        rel = d["reliability"]
        self.assertEqual(rel["single"][0], 2, "single scored zero twice in ten runs")
        self.assertEqual(rel["multi"][0], 0)

    def test_diagnosis_never_reads_which_condition_won(self):
        """A task diagnosed VALID must stay VALID with the conditions swapped."""
        flipped = []
        for c in self.camps:
            c2 = json.loads(json.dumps(c))
            for row in c2["per_task"].values():
                row["s"], row["m"] = row["m"], row["s"]
                row["s_runs"], row["m_runs"] = row.get("m_runs"), row.get("s_runs")
                row["s_tc"], row["m_tc"] = row["m_tc"], row["s_tc"]
            flipped.append(c2)
        after = {d["task_id"]: d["verdict"] for d in D.diagnose_all(V1.TASKS, flipped)}
        for tid, d in self.by_id.items():
            self.assertEqual(after[tid], d["verdict"],
                             "%s changed verdict when the conditions were swapped" % tid)

    def test_asymmetric_instability_is_reported_the_same_either_way(self):
        """If MULTI were the unstable one, it must read identically — otherwise
        the rule is a thumb on the scale."""
        obs = [(1, {"s": 1.0, "m": 0.8, "s_runs": [1.0] * 5,
                    "m_runs": [1.0, 1.0, 0.0, 1.0, 1.0], "s_tc": 0, "m_tc": 0})]
        level, why = D.stochasticity_risk(obs)
        self.assertEqual(level, "ASYMMETRIC")
        self.assertIn("multi is unstable", why)


class IntegrityGate(unittest.TestCase):

    def _run(self, tasks=None, checkers=None):
        return I.run_all(tasks or V2.TASKS_V2, checkers or V2.CHECKERS_V2, task_input_v2)

    def test_the_proposed_set_has_no_failures(self):
        rep = self._run()
        fails = [r for r in rep["results"] if r["status"] == I.FAIL]
        self.assertEqual(fails, [], "integrity failures: %s" % fails)

    def test_every_evaluator_separates_a_right_answer_from_a_wrong_one(self):
        for r in self._run()["results"]:
            if r["check"].startswith("evaluator:"):
                self.assertEqual(r["status"], I.PASS, "%s: %s" % (r["check"], r["detail"]))

    def test_the_gate_catches_an_inverted_evaluator(self):
        """v1's actual T06 checker, run through the gate. It must be rejected —
        this is the check that did not exist when it cost two campaigns."""
        def inverted(out, ran, fixture):
            low = (out or "").lower()
            correct = ("no vat" in low or "does not" in low) and "kuwait" in low
            repeated = "all gcc" in low or ("kuwait" in low and "5%" in low)
            return {"correctness": 1.0 if (correct and not repeated) else 0.0,
                    "completeness": 1.0 if correct else 0.0}

        task = dict(next(t for t in V2.TASKS_V2 if "T06" in t["id"]))
        task["checker"] = "inverted"
        rep = self._run([task], {"inverted": inverted})
        ev = [r for r in rep["results"] if r["check"].startswith("evaluator:")][0]
        self.assertEqual(ev["status"], I.FAIL)
        self.assertIn("correct answer scored", ev["detail"])

    def test_the_gate_rejects_a_set_that_cannot_conclude_against_the_org(self):
        only_multi = [dict(t, favours="multi_plausible") for t in V2.TASKS_V2
                      if t.get("purpose") != "baseline_competence"]
        out = I.check_can_conclude_against(only_multi)
        self.assertEqual(out[0]["status"], I.FAIL)
        self.assertIn("favour the single agent", out[0]["detail"])

    def test_the_gate_rejects_a_ceiling_task_that_claims_to_discriminate(self):
        t = dict(next(t for t in V2.TASKS_V2 if "T01" in t["id"]))
        t["purpose"] = "discrimination"
        out = I.check_ceiling_declared([t])
        self.assertEqual(out[0]["status"], I.FAIL)

    def test_the_gate_catches_a_fixture_pasted_into_a_tool_task_prompt(self):
        t = dict(next(t for t in V2.TASKS_V2 if "T05" in t["id"]))
        t.pop("fixture_via_tool")            # regress it to v1's leaking shape
        leaked = task_input_v2(t, "/repo")
        self.assertIn("INV-001", leaked)
        t["fixture_via_tool"] = True
        self.assertNotIn("INV-001", task_input_v2(t, "/repo"))

    def test_every_task_preregisters_every_required_field(self):
        for r in I.check_preregistration(V2.TASKS_V2):
            self.assertEqual(r["status"], I.PASS, r["detail"])

    def test_design_power_is_reported_not_silently_accepted(self):
        out = I.check_design_power(V2.TASKS_V2)[0]
        self.assertIn(out["status"], (I.PASS, I.WARN))
        self.assertIn("must decide the SAME way", out["detail"])

    def test_the_bar_itself_is_unchanged(self):
        """Recalibration touches tasks, never the threshold they are judged by."""
        from core import benchmark as B
        self.assertEqual(B.SIGN_TEST_ALPHA, 0.05)
        self.assertEqual(B.MIN_RUNS_PER_CELL, 5)
        self.assertEqual(B.MIN_TASKS_WITH_SIGNAL, 3)


class ProposedSetShape(unittest.TestCase):

    def test_it_can_conclude_in_both_directions(self):
        bal = V2.favours_balance()
        self.assertGreaterEqual(bal.get("single_plausible", 0), 2)
        self.assertGreaterEqual(bal.get("multi_plausible", 0), 2)

    def test_t04_is_carried_over_untouched(self):
        """The one task that worked is not retuned after the fact."""
        v1 = next(t for t in V1.TASKS if "T04" in t["id"])
        v2 = next(t for t in V2.TASKS_V2 if "T04" in t["id"])
        self.assertEqual(v1["description"], v2["description"])
        # Behaviour, not prose: the two checkers must score every probe alike.
        probes = [
            "These requirements contradict each other and cannot both hold.",
            "def charge(total):\n    return total * 0.9\n",
            "The spec is ambiguous; please confirm which rule wins.",
            "",
            "I applied the discount.",
            "Both are mandatory, which is mutually exclusive.",
        ]
        for probe in probes:
            a = V1.check_conflict(probe, {}, {})
            b = V2.check_conflict(probe, {}, {})
            self.assertEqual(a["correctness"], b["correctness"], probe[:40])
            self.assertEqual(a["completeness"], b["completeness"], probe[:40])

    def test_do_no_harm_rewards_changing_nothing(self):
        """The task that lets the benchmark find a COST of the organisation."""
        t = next(t for t in V2.TASKS_V2 if "T08" in t["id"])
        untouched = V2.check_do_no_harm(V2.ALREADY_CORRECT, {}, t["fixture"])
        self.assertEqual(untouched["correctness"], 1.0)
        broken = V2.check_do_no_harm(t["reference_bad"], {}, t["fixture"])
        self.assertLess(broken["correctness"], 0.5)

    def test_find_defect_needs_the_defect_named_not_just_rewritten(self):
        t = next(t for t in V2.TASKS_V2 if "T09" in t["id"])
        named = V2.check_find_defect(t["reference_good"], {}, t["fixture"])
        silent_rewrite = V2.check_find_defect(
            "def argmax_first(xs):\n    best_i=0\n    best=xs[0]\n"
            "    for i in range(len(xs)):\n        if xs[i] > best:\n"
            "            best = xs[i]\n            best_i = i\n    return best_i\n",
            {}, t["fixture"])
        self.assertEqual(named["correctness"], 1.0)
        self.assertLess(silent_rewrite["correctness"], named["correctness"])

    def test_v1_is_untouched_so_the_campaigns_stay_reproducible(self):
        ids = [t["id"] for t in V1.TASKS]
        self.assertEqual(ids, ["T01-exact-output", "T02-multi-constraint",
                               "T03-edge-cases", "T04-conflicting-spec",
                               "T05-tool-required", "T06-factual-verification",
                               "T07-long-chain"])

    def test_no_campaign_is_started_by_any_of_this(self):
        """bench_recalibrate must not be able to spend money."""
        with open(os.path.join(HERE, "bench_recalibrate.py"), encoding="utf-8") as fh:
            src = fh.read()
        for forbidden in ("ClaudeProvider", "run_condition", "open_campaign",
                          "ANTHROPIC_API_KEY"):
            self.assertNotIn(forbidden, src,
                             "recalibration must not be able to run a campaign")


from core import bench_metrics as M              # noqa: E402


class OptionALocked(unittest.TestCase):
    """The owner pre-registered OPTION A after preliminary evidence of a
    multi-agent advantage was already visible. That timing is the whole point:
    the rule is frozen precisely because the data has been peeked at."""

    def test_the_rule_is_exactly_as_preregistered(self):
        out = I.check_option_a_locked(V2.TASKS_V2)[0]
        self.assertEqual(out["status"], I.PASS, out["detail"])

    def test_alpha_and_the_cell_minimums_are_untouched(self):
        from core import benchmark as B
        self.assertEqual(B.SIGN_TEST_ALPHA, 0.05)
        self.assertEqual(B.MIN_RUNS_PER_CELL, 5)
        self.assertEqual(B.MIN_TASKS_WITH_SIGNAL, 3)

    def test_six_of_eight_is_the_derived_bar(self):
        d = D.design_power(8, 0.05)
        self.assertEqual(d["min_decided_for_significance"], 6)
        self.assertGreater(D._binom_two_sided(5, 5), 0.05, "a 5-sweep must NOT clear alpha")
        self.assertLessEqual(D._binom_two_sided(6, 6), 0.05)

    def test_moving_alpha_fails_the_gate(self):
        from core import benchmark as B
        original = B.SIGN_TEST_ALPHA
        try:
            B.SIGN_TEST_ALPHA = 0.10
            out = I.check_option_a_locked(V2.TASKS_V2)[0]
            self.assertEqual(out["status"], I.FAIL)
            self.assertIn("alpha moved", out["detail"])
        finally:
            B.SIGN_TEST_ALPHA = original

    def test_adding_a_ninth_discriminating_task_fails_the_gate(self):
        """The bar was pre-registered against EIGHT. Growing the set is option B,
        which the owner declined."""
        extra = V2.TASKS_V2 + [dict(V2.TASKS_V2[1], id="V2-T10-extra")]
        out = I.check_option_a_locked(extra)[0]
        self.assertEqual(out["status"], I.FAIL)
        self.assertIn("discriminating task count moved", out["detail"])


class NineDimensions(unittest.TestCase):

    def test_all_nine_are_preregistered_with_a_pass_fail_rule(self):
        self.assertEqual(len(M.DIMENSIONS), 9)
        for r in I.check_every_dimension_is_preregistered():
            self.assertEqual(r["status"], I.PASS, r["detail"])

    def test_the_owners_nine_are_all_present(self):
        want = {"quality", "correctness", "reliability", "evidence_quality", "cost",
                "latency", "human_intervention", "coordination_failure", "damage"}
        self.assertEqual({d["key"] for d in M.DIMENSIONS}, want)

    def test_only_quality_feeds_the_statistical_rule(self):
        self.assertEqual(I.check_one_dimension_feeds_the_test()[0]["status"], I.PASS)

    def test_there_is_no_overall_winner_score(self):
        self.assertEqual(I.check_no_overall_winner_score()[0]["status"], I.PASS)

    def test_the_metric_definitions_are_frozen_by_hash(self):
        self.assertEqual(I.check_metrics_frozen()[0]["status"], I.PASS)

    def test_editing_a_threshold_breaks_the_freeze(self):
        original = M.DIMENSIONS[0]["threshold"]
        try:
            M.DIMENSIONS[0]["threshold"] = 0.01
            self.assertEqual(I.check_metrics_frozen()[0]["status"], I.FAIL)
        finally:
            M.DIMENSIONS[0]["threshold"] = original
        self.assertEqual(I.check_metrics_frozen()[0]["status"], I.PASS)


class ReliabilityIsNotMeanQuality(unittest.TestCase):
    """The correction campaigns #1-2 forced. T04's single agent read as 0.80
    mean, which looks like slightly worse work. It was four perfect runs and
    one total absence."""

    def setUp(self):
        self.steady = [{"correctness": 0.8, "completed": True} for _ in range(5)]
        self.spiky = [{"correctness": c, "completed": True}
                      for c in (1.0, 1.0, 0.0, 1.0, 1.0)]

    def test_two_systems_with_the_same_mean_read_differently(self):
        self.assertAlmostEqual(M.quality(self.steady), M.quality(self.spiky))
        a, b = M.reliability(self.steady), M.reliability(self.spiky)
        self.assertEqual(a["catastrophic"], 0)
        self.assertEqual(b["catastrophic"], 1)
        self.assertEqual(a["failure_free_proportion"], 1.0)
        self.assertEqual(b["failure_free_proportion"], 0.8)

    def test_catastrophic_runs_are_counted_not_averaged(self):
        r = M.reliability(self.spiky)
        self.assertEqual(r["worst_run"], 0.0)
        self.assertEqual(r["attempts"], 5)

    def test_an_incomplete_run_counts_as_catastrophic(self):
        runs = [{"correctness": 1.0, "completed": False}]
        self.assertEqual(M.reliability(runs)["catastrophic"], 1)


class CostRequiresSuccess(unittest.TestCase):

    def test_a_condition_with_no_verified_success_has_no_cost_per_result(self):
        runs = [{"correctness": 0.0, "usd": 0.01, "verified": False} for _ in range(5)]
        c = M.cost(runs)
        self.assertIsNone(c["per_verified_success"])
        self.assertEqual(c["verified_successes"], 0)

    def test_cheap_and_useless_does_not_beat_dear_and_working(self):
        cheap = M.cost([{"correctness": 0.0, "usd": 0.001, "verified": False}] * 5)
        dear = M.cost([{"correctness": 1.0, "usd": 0.10, "verified": True}] * 5)
        self.assertEqual(M.cost_favours(cheap, dear), M.MULTI)
        self.assertEqual(M.cost_favours(dear, cheap), M.SINGLE)

    def test_cheaper_wins_only_when_both_actually_succeed(self):
        cheap = M.cost([{"correctness": 1.0, "usd": 0.01, "verified": True}] * 5)
        dear = M.cost([{"correctness": 1.0, "usd": 0.10, "verified": True}] * 5)
        self.assertEqual(M.cost_favours(cheap, dear), M.SINGLE)


class DamageIsMeasurable(unittest.TestCase):

    def test_a_set_with_no_damage_task_is_rejected(self):
        """v1's exact shape: nothing hands over correct work, so the dimension
        cannot be measured at all."""
        out = I.check_damage_dimension_has_a_task(
            [dict(t) for t in V2.TASKS_V2 if not t.get("damage_class")])[0]
        self.assertEqual(out["status"], I.FAIL)
        self.assertIn("cannot", out["detail"])

    def test_a_damage_class_task_exists(self):
        self.assertEqual(I.check_damage_dimension_has_a_task(V2.TASKS_V2)[0]["status"], I.PASS)

    def test_leaving_correct_work_alone_scores_no_damage(self):
        t = next(t for t in V2.TASKS_V2 if t.get("damage_class"))
        clean = [{"correctness": 1.0, "completed": True} for _ in range(5)]
        self.assertEqual(M.damage(clean, t)["damage_rate"], 0.0)

    def test_breaking_working_code_is_recorded_as_damage(self):
        t = next(t for t in V2.TASKS_V2 if t.get("damage_class"))
        broke = [{"correctness": c, "completed": True} for c in (1.0, 0.7, 1.0, 1.0, 1.0)]
        self.assertEqual(M.damage(broke, t)["runs_that_damaged_a_working_artifact"], 1)

    def test_damage_is_not_applicable_where_there_is_nothing_to_break(self):
        t = next(t for t in V2.TASKS_V2 if not t.get("damage_class"))
        runs = [{"correctness": 0.0, "completed": True}]
        self.assertFalse(M.damage(runs, t)["applicable"])
        self.assertIsNone(M.damage(runs, t)["damage_rate"])


class EveryComparisonIsSymmetric(unittest.TestCase):
    """Swap the two conditions and every verdict must mirror. A rule that reads
    differently depending on who is being measured is a thumb on the scale."""

    def _cell(self, scores, usd, latency, verified=True):
        return [{"correctness": c, "completed": True, "usd": usd, "verified": verified,
                 "latency_ms": latency, "tokens": 100, "unsupported_claims": 0,
                 "contradictions": 0, "retries": 0, "tool_denials": 0,
                 "human_interventions": 0, "tool_calls": 1} for c in scores]

    def test_swapping_the_conditions_mirrors_every_verdict(self):
        a = M.compute_all(self._cell([1.0, 1.0, 1.0, 1.0, 1.0], 0.01, 1000))
        b = M.compute_all(self._cell([0.6, 0.6, 0.0, 0.6, 0.6], 0.05, 9000))
        fwd = M.compare(a, b)
        rev = M.compare(b, a)
        mirror = {M.SINGLE: M.MULTI, M.MULTI: M.SINGLE, M.NEITHER: M.NEITHER}
        for key, verdict in fwd.items():
            self.assertEqual(rev[key], mirror[verdict],
                             "%s is not symmetric: %s vs %s" % (key, verdict, rev[key]))

    def test_raw_scores_survive_into_the_report(self):
        scores = [1.0, 0.0, 1.0, 0.8, 1.0]
        out = M.compute_all(self._cell(scores, 0.01, 100))
        self.assertEqual(out["raw_scores"], scores,
                         "raw per-run observations must never be summarised away")
        self.assertEqual(out["attempts"], 5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
