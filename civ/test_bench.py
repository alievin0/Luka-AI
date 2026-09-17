#!/usr/bin/env python3
"""BENCHMARK TESTS.  python3 test_bench.py

Per §15: unit, failure path, authorization, invalid input, reproducibility,
evaluator isolation, security. The __main__ block stays last (R14).
"""
import json
import os
import re
import sqlite3
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from core import bench_tasks as BT     # noqa: E402
from core import benchmark as B        # noqa: E402
from core import provider as P         # noqa: E402
from core import runtime, store        # noqa: E402
import bench_run                       # noqa: E402
import slice as vslice                 # noqa: E402


def world():
    con = store.connect(os.path.join(tempfile.mkdtemp(), "b.db"))
    store.found(con, mode="simulation")
    vslice.register_crew(con)
    B.register_tasks(con)
    return con


class TaskRegistry(unittest.TestCase):
    def test_all_tasks_register_with_stable_fixture_hashes(self):
        con = world()
        self.assertEqual(con.execute("SELECT COUNT(*) c FROM bench_tasks").fetchone()["c"],
                         len(BT.TASKS))
        first = {r["id"]: r["fixture_sha"] for r in con.execute(
            "SELECT id, fixture_sha FROM bench_tasks")}
        B.register_tasks(con)
        second = {r["id"]: r["fixture_sha"] for r in con.execute(
            "SELECT id, fixture_sha FROM bench_tasks")}
        self.assertEqual(first, second, "fixture hashes must be reproducible")

    def test_the_set_is_not_stacked_toward_multi_agent(self):
        favours = [t["favours"] for t in BT.TASKS]
        self.assertIn("single_plausible", favours,
                      "a benchmark with no task favouring one agent proves nothing")
        self.assertGreaterEqual(favours.count("neutral"), len(BT.TASKS) // 2)

    def test_every_task_has_an_objective_checker(self):
        for t in BT.TASKS:
            self.assertIn(t["checker"], BT.CHECKERS)
            self.assertTrue(t["rationale"], "%s must say why it exists" % t["id"])

    def test_invalid_input_unknown_difficulty_is_refused(self):
        con = world()
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO bench_tasks(id,title,description,domain,difficulty,"
                        "fixture_sha,created_at) VALUES('X','t','d','x','trivial','s',?)",
                        (store.now(),))


class Checkers(unittest.TestCase):
    def test_exact_checker_passes_only_on_exact_output(self):
        self.assertEqual(BT.check_exact("", {"returncode": 0, "stdout": "42\n"}, {})
                         ["correctness"], 1.0)
        for bad in ({"returncode": 0, "stdout": "42.0"}, {"returncode": 1, "stdout": "42"},
                    {"returncode": 0, "stdout": "the answer is 42"}):
            self.assertEqual(BT.check_exact("", bad, {})["correctness"], 0.0)

    def test_conflict_checker_rewards_flagging_not_implementing(self):
        flagged = BT.check_conflict("These two requirements contradict each other.", {}, {})
        silent = BT.check_conflict("def charge(total):\n    return total * 0.9", {}, {})
        self.assertEqual(flagged["correctness"], 1.0)
        self.assertEqual(silent["correctness"], 0.0)
        self.assertTrue(silent["detail"]["implemented_without_flagging"])

    def test_factual_checker_penalises_the_unsourced_brochure(self):
        good = BT.check_factual("Per the note, Kuwait has no VAT in 2026.", {}, {})
        bad = BT.check_factual("All GCC states now levy 5% VAT, including Kuwait.", {}, {})
        self.assertEqual(good["correctness"], 1.0)
        self.assertEqual(bad["correctness"], 0.0)
        self.assertEqual(bad["unsupported_claims"], 1)

    def test_tool_required_checker_cannot_be_satisfied_by_guessing(self):
        self.assertEqual(BT.check_tool_required("about 400", {}, {})["correctness"], 0.0)
        self.assertEqual(BT.check_tool_required("382.0125", {}, {})["correctness"], 1.0)

    def test_the_arithmetic_of_the_long_chain_task_is_right(self):
        """This test caught a WRONG ANSWER KEY in T07 before it ever ran. A
        benchmark that marks the correct answer wrong is worse than none."""
        v = 7 ** 2
        v = (v + 200) * 3 - 60
        v = v / 2 + 15
        self.assertEqual(v, 358.5)
        self.assertEqual(BT.check_chain("", {"returncode": 0, "stdout": "358.5"}, {})
                         ["correctness"], 1.0)


class Fairness(unittest.TestCase):
    """§10 anti-gaming, enforced by the database rather than by intent."""

    def setUp(self):
        self.con = world()
        self.cid = B.open_campaign(self.con, "t", "mock", "m", 1)
        self.t = BT.TASKS[0]

    def _ctx(self, **over):
        c = {"tools_sha": "AAA", "input_sha": "BBB", "budget": 0.05}
        c.update(over)
        return c

    def test_happy_path_equal_surfaces_are_accepted(self):
        B.assert_fairness(self.con, self.cid, self.t, self._ctx(), self._ctx())
        self.assertTrue(self.con.execute("SELECT fair FROM bench_fairness").fetchone()["fair"])

    def test_extra_tools_for_multi_are_refused(self):
        with self.assertRaises(sqlite3.IntegrityError) as e:
            B.assert_fairness(self.con, self.cid, self.t, self._ctx(),
                              self._ctx(tools_sha="MORE"))
        self.assertIn("LAW 11", str(e.exception))

    def test_extra_information_for_multi_is_refused(self):
        with self.assertRaises(sqlite3.IntegrityError):
            B.assert_fairness(self.con, self.cid, self.t, self._ctx(),
                              self._ctx(input_sha="EXTRA"))

    def test_a_bigger_budget_for_multi_is_refused(self):
        with self.assertRaises(sqlite3.IntegrityError):
            B.assert_fairness(self.con, self.cid, self.t, self._ctx(),
                              self._ctx(budget=99.0))

    def test_both_conditions_receive_byte_identical_input(self):
        for t in BT.TASKS:
            self.assertEqual(store.sha(B.task_input(t)), store.sha(B.task_input(t)))


class EvaluatorIsolation(unittest.TestCase):
    def test_a_producer_cannot_evaluate_its_own_run(self):
        con = world()
        cid = B.open_campaign(con, "t", "mock", "m", 1)
        t = BT.TASKS[0]
        brid = B.start_run(con, cid, t, "SINGLE", 0, 0, "sha")
        B.finish_run(con, brid, status="COMPLETE", output="x",
                     agents_used=["AGT-000002"])
        with self.assertRaises(sqlite3.IntegrityError) as e:
            con.execute("INSERT INTO bench_evaluations(bench_run_id,blind_token,method,"
                        "evaluator,evaluated_at) VALUES(?,'tok','OBJECTIVE','AGT-000002',?)",
                        (brid, store.now()))
        self.assertIn("LAW 10", str(e.exception))

    def test_an_independent_evaluator_is_accepted(self):
        con = world()
        cid = B.open_campaign(con, "t", "mock", "m", 1)
        t = BT.TASKS[0]
        brid = B.start_run(con, cid, t, "SINGLE", 0, 0, "sha")
        B.finish_run(con, brid, status="COMPLETE", output="", agents_used=["AGT-000002"])
        B.evaluate(con, brid, t, {"returncode": 0, "stdout": "42"},
                   evaluator="AGT-BENCH-EVAL")
        r = con.execute("SELECT * FROM bench_evaluations WHERE bench_run_id=?",
                        (brid,)).fetchone()
        self.assertEqual(r["correctness"], 1.0)

    def test_the_evaluator_record_carries_a_blind_token_not_a_condition(self):
        con = world()
        cid = B.open_campaign(con, "t", "mock", "m", 1)
        t = BT.TASKS[0]
        brid = B.start_run(con, cid, t, "MULTI", 0, 0, "sha")
        B.finish_run(con, brid, status="COMPLETE", output="", agents_used=[])
        B.evaluate(con, brid, t, {"returncode": 0, "stdout": "42"})
        tok = con.execute("SELECT blind_token FROM bench_evaluations WHERE bench_run_id=?",
                          (brid,)).fetchone()["blind_token"]
        self.assertNotIn("MULTI", tok)
        self.assertNotIn("SINGLE", tok)


class Statistics(unittest.TestCase):
    def test_binomial_is_exact_and_conservative(self):
        self.assertAlmostEqual(B._binom_two_sided(5, 5), 0.0625, places=4)
        self.assertAlmostEqual(B._binom_two_sided(7, 7), 0.015625, places=5)
        self.assertEqual(B._binom_two_sided(3, 5), 1.0)
        self.assertEqual(B._binom_two_sided(0, 0), 1.0)

    def test_a_clean_sweep_of_five_still_fails_the_pre_registered_bar(self):
        """0.0625 > 0.05. Five tasks in one direction is not enough, by design."""
        self.assertGreater(B._binom_two_sided(5, 5), B.SIGN_TEST_ALPHA)

    def test_one_run_per_cell_yields_insufficient_evidence(self):
        con = world()
        cid = B.open_campaign(con, "t", "mock", "m", 1)
        for t in BT.TASKS:
            for cond, c in (("SINGLE", 0.0), ("MULTI", 1.0)):
                brid = B.start_run(con, cid, t, cond, 0, 0, "sha")
                B.finish_run(con, brid, status="COMPLETE", output="", agents_used=[])
                con.execute("INSERT INTO bench_evaluations(bench_run_id,blind_token,method,"
                            "correctness,completeness,evaluator,evaluated_at) "
                            "VALUES(?,?,'OBJECTIVE',?,?,'E',?)",
                            (brid, "t%d" % brid, c, c, store.now()))
        r = B.analyse(con, cid)
        self.assertEqual(r["conclusion"], "INSUFFICIENT_EVIDENCE",
                         "a 7-0 sweep on ONE run per cell must not be a conclusion")
        self.assertTrue(r["warnings"])

    def test_no_overall_winner_score_is_produced(self):
        con = world()
        cid = B.open_campaign(con, "t", "mock", "m", 1)
        r = B.analyse(con, cid)
        flat = json.dumps(r).lower()
        for banned in ('"winner"', '"overall_score"', '"total_score"', '"rank"'):
            self.assertNotIn(banned, flat)
        self.assertIn("no overall winner score", flat)

    def test_dimensions_are_reported_separately(self):
        con = world()
        cid = B.open_campaign(con, "t", "mock", "m", 1)
        r = B.analyse(con, cid)
        cell = r["per_task"][0]["SINGLE"]
        for dim in ("correctness", "completeness", "failure_rate", "usd", "latency_ms",
                    "tokens", "retries", "human_interventions", "tool_calls",
                    "unsupported_claims", "contradictions", "useful_artifacts",
                    "quality_per_usd"):
            self.assertIn(dim, cell)

    def test_conclusion_is_one_of_exactly_four(self):
        con = world()
        cid = B.open_campaign(con, "t", "mock", "m", 1)
        self.assertIn(B.analyse(con, cid)["conclusion"],
                      {"MULTI_AGENT_ADVANTAGE_SUPPORTED", "SINGLE_AGENT_ADVANTAGE_SUPPORTED",
                       "NO_MEANINGFUL_DIFFERENCE_DETECTED", "INSUFFICIENT_EVIDENCE"})

    def test_a_single_agent_advantage_is_reachable(self):
        """The framework must be able to conclude AGAINST the organisation."""
        con = world()
        cid = B.open_campaign(con, "t", "mock", "m", B.MIN_RUNS_PER_CELL)
        for t in BT.TASKS:
            for cond, c in (("SINGLE", 1.0), ("MULTI", 0.0)):
                for rep in range(B.MIN_RUNS_PER_CELL):
                    brid = B.start_run(con, cid, t, cond, rep, 0, "sha")
                    B.finish_run(con, brid, status="COMPLETE", output="", agents_used=[])
                    con.execute("INSERT INTO bench_evaluations(bench_run_id,blind_token,"
                                "method,correctness,completeness,evaluator,evaluated_at) "
                                "VALUES(?,?,'OBJECTIVE',?,?,'E',?)",
                                (brid, "t%d" % brid, c, c, store.now()))
        r = B.analyse(con, cid)
        self.assertEqual(r["conclusion"], "SINGLE_AGENT_ADVANTAGE_SUPPORTED")
        self.assertEqual(r["single_led"], len(BT.TASKS))


class FailureAndRecording(unittest.TestCase):
    def test_every_attempt_is_recorded_before_it_is_judged(self):
        con = world()
        cid = B.open_campaign(con, "t", "mock", "m", 1)
        t = BT.TASKS[0]
        brid = B.start_run(con, cid, t, "SINGLE", 0, 0, "sha")
        row = con.execute("SELECT * FROM bench_runs WHERE id=?", (brid,)).fetchone()
        self.assertEqual(row["status"], "STARTED")
        self.assertTrue(row["started_at"])

    def test_a_failed_run_stays_in_the_record(self):
        con = world()
        cid = B.open_campaign(con, "t", "mock", "m", 1)
        t = BT.TASKS[0]
        brid = B.start_run(con, cid, t, "MULTI", 0, 0, "sha")
        B.finish_run(con, brid, status="FAILED", failure_class="model",
                     failure_note="provider error")
        r = B.analyse(con, cid)
        cell = [p for p in r["per_task"] if p["task_id"] == t["id"]][0]["MULTI"]
        self.assertEqual(cell["attempts"], 1)
        self.assertEqual(cell["completed"], 0)
        self.assertEqual(cell["failure_rate"], 1.0)
        self.assertIn("model", cell["failure_classes"])

    def test_failure_classes_cover_the_required_taxonomy(self):
        for required in ("model", "decomposition", "coordination", "tool", "permission",
                         "reviewer", "evidence", "infrastructure", "evaluator"):
            self.assertIn(required, B.FAILURE_CLASSES)

    def test_invalid_condition_is_refused(self):
        con = world()
        cid = B.open_campaign(con, "t", "mock", "m", 1)
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO bench_runs(campaign_id,task_id,condition,repeat_index,"
                        "order_index,input_sha,started_at) VALUES(?,?,'BOTH',0,0,'s',?)",
                        (cid, BT.TASKS[0]["id"], store.now()))

    def test_a_duplicate_cell_cannot_be_written_twice(self):
        con = world()
        cid = B.open_campaign(con, "t", "mock", "m", 1)
        t = BT.TASKS[0]
        B.start_run(con, cid, t, "SINGLE", 0, 0, "sha")
        with self.assertRaises(sqlite3.IntegrityError):
            B.start_run(con, cid, t, "SINGLE", 0, 1, "sha")


class Reproducibility(unittest.TestCase):
    def test_a_campaign_records_everything_needed_to_reproduce_it(self):
        con = world()
        cid = B.open_campaign(con, "repro", "claude", "claude-sonnet-5", 5)
        r = con.execute("SELECT * FROM bench_campaigns WHERE id=?", (cid,)).fetchone()
        for f in ("git_commit", "provider", "model", "config_sha", "repeats", "started_at"):
            self.assertTrue(r[f], "%s missing" % f)

    def test_config_hash_changes_when_the_bars_change(self):
        con = world()
        a = con.execute("SELECT config_sha FROM bench_campaigns WHERE id=?",
                        (B.open_campaign(con, "a", "p", "m", 1),)).fetchone()["config_sha"]
        b = con.execute("SELECT config_sha FROM bench_campaigns WHERE id=?",
                        (B.open_campaign(con, "b", "p", "m", 9),)).fetchone()["config_sha"]
        self.assertNotEqual(a, b)

    def test_a_run_carries_its_provenance_chain(self):
        con = world()
        cid = B.open_campaign(con, "t", "mock", "m", 1)
        brid = B.start_run(con, cid, BT.TASKS[0], "MULTI", 0, 0, "inputsha")
        B.finish_run(con, brid, status="COMPLETE", output="x", output_sha="osha",
                     model_runs=[1, 2, 3], exec_graph=[{"agent": "A", "step": "build"}],
                     agents_used=["A"])
        r = con.execute("SELECT * FROM bench_runs WHERE id=?", (brid,)).fetchone()
        self.assertEqual(json.loads(r["model_runs"]), [1, 2, 3])
        self.assertEqual(r["input_sha"], "inputsha")
        self.assertTrue(json.loads(r["exec_graph"]))


class SecurityAndAuthorization(unittest.TestCase):
    def test_the_benchmark_uses_the_same_gateway_no_private_path(self):
        src = open(os.path.join(HERE, "bench_run.py"), encoding="utf-8").read()
        self.assertIn("vslice.build_gateway", src)
        self.assertNotIn("subprocess.run(", src,
                         "the benchmark must not execute anything outside the gateway")

    def test_the_solo_agent_gets_exactly_the_tasks_tools(self):
        con = world()
        t = [x for x in BT.TASKS if x["id"] == "T01-exact-output"][0]
        bench_run.bench_crew(con, t)
        p = con.execute("SELECT permissions FROM principals WHERE id=?",
                        (bench_run.SOLO,)).fetchone()
        caps = {g["cap"] for g in json.loads(p["permissions"])}
        self.assertEqual(caps, {"WRITE_ARTIFACT"})
        self.assertNotIn("EXECUTE_SANDBOX", caps,
                         "execution belongs to the evaluator, not to a producing condition")

    def test_a_producing_condition_cannot_execute_code(self):
        con = world()
        t = BT.TASKS[0]
        bench_run.bench_crew(con, t)
        gw = vslice.build_gateway(con)
        with self.assertRaises(runtime.Denied):
            gw.call(bench_run.SOLO, "EXECUTE_SANDBOX", argv=["python3", "x.py"])

    def test_the_evaluator_cannot_write_artifacts(self):
        con = world()
        bench_run.bench_crew(con, BT.TASKS[0])
        gw = vslice.build_gateway(con)
        with self.assertRaises(runtime.Denied):
            gw.call(bench_run.EVALUATOR, "WRITE_ARTIFACT", path="x.py", body="x")

    def test_the_runner_refuses_to_run_without_a_provider(self):
        env = dict(os.environ)
        env.pop("ANTHROPIC_API_KEY", None)
        env["CIV_PROVIDER"] = ""
        import subprocess
        r = subprocess.run([sys.executable, "bench_run.py", "--repeats", "1"], cwd=HERE,
                           env=env, capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 2)
        self.assertIn("NOT_CONFIGURED", r.stdout)
        self.assertIn("INSUFFICIENT_EVIDENCE", r.stdout)


class SuiteHygiene(unittest.TestCase):
    def test_every_test_class_is_collected(self):
        import inspect
        mod = sys.modules[__name__]
        declared = {n for n, o in inspect.getmembers(mod, inspect.isclass)
                    if issubclass(o, unittest.TestCase) and o.__module__ == __name__}
        with open(__file__, encoding="utf-8") as fh:
            src = fh.read()
        self.assertEqual(set(re.findall(r"^class (\w+)\(unittest\.TestCase\)", src, re.M))
                         - declared, set())

    def test_the_main_block_is_last(self):
        with open(__file__, encoding="utf-8") as fh:
            self.assertTrue(fh.read().rstrip().endswith("unittest.main(verbosity=2)"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
