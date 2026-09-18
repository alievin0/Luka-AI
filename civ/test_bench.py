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
        """R20 made 'trivial' a legitimate label, so this probes with a value
        that is genuinely not one. The property under test is unchanged: the
        schema refuses a difficulty it does not define."""
        con = world()
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO bench_tasks(id,title,description,domain,difficulty,"
                        "fixture_sha,created_at) VALUES('X','t','d','x','impossible','s',?)",
                        (store.now(),))

    def test_trivial_is_now_a_defined_difficulty(self):
        """R20: a baseline-competence task could not be registered at all."""
        con = world()
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


# ── the tool-use loop (civ/HARNESS_VALIDITY_DESIGN.md) ───────────────
MARK = "LOOP-SENTINEL-7719"


class ScriptedProvider(P.Provider):
    """Says exactly what the test tells it to, in order, and keeps every prompt.

    MockProvider cannot exercise the loop: it emits a blob with no `tool` and no
    `final`, which is read as an implicit answer on the first call — a one-step
    run, which is precisely the shape this change exists to move past. An entry
    may be a dict (the model's JSON), a string (raw text), a Result (a transport
    failure), or a callable taking the prompt, which is how a test checks that
    what a role was SHOWN reached it."""

    name, source = "scripted", "mock"

    def __init__(self, script, usd=0.0):
        self.script, self.usd = list(script), usd
        self.calls, self.prompts, self.systems = 0, [], []

    def available(self):
        return True

    def why_unavailable(self):
        return ""

    def complete(self, system, prompt, model=None, max_tokens=800):
        self.prompts.append(prompt)
        self.systems.append(system)
        step = self.script[min(self.calls, len(self.script) - 1)]
        self.calls += 1
        if callable(step):
            step = step(prompt)
        if isinstance(step, P.Result):
            return step
        text = step if isinstance(step, str) else json.dumps(step, ensure_ascii=False)
        return P.Result("OK", "mock", self.name, model or "scripted-1", text=text,
                        tokens_in=len(prompt) // 4, tokens_out=len(text) // 4,
                        usd=self.usd, latency_ms=1)


def loop_world(tools=("READ_REPO", "WRITE_ARTIFACT")):
    con = world()
    bench_run.bench_crew(con, {"allowed_tools": list(tools)})
    return con, vslice.build_gateway(con)


def readable_file(body=MARK):
    path = os.path.join(vslice.ARTIFACT_DIR, "loop_probe.txt")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(body)
    return path


class ToolUseLoop(unittest.TestCase):
    """The loop the harness did not have. Campaign #3 granted READ_REPO on four
    tasks and no run could reach it, because the only tool call happened after
    the answer was already fixed."""

    def test_a_read_result_reaches_the_next_model_call(self):
        con, gw = loop_world()
        path = readable_file()
        prov = ScriptedProvider([
            {"tool": "READ_REPO", "args": {"path": path}},
            lambda p: {"final": {"answer": "saw:%s" % (MARK if MARK in p else "NOTHING")}},
        ])
        graph = []
        t = bench_run.agent_turn(con, gw, prov, bench_run.SOLO, "sys", "read it", graph)
        self.assertIn(bench_run.OBS, prov.prompts[1])
        self.assertIn(MARK, prov.prompts[1])
        self.assertEqual(t.deliverable, "saw:%s" % MARK)
        self.assertEqual(t.steps, 1)
        self.assertTrue(t.submitted)

    def test_the_loop_stops_at_the_step_cap_and_records_the_exhaustion(self):
        con, gw = loop_world()
        path = readable_file()
        prov = ScriptedProvider([{"tool": "READ_REPO", "args": {"path": path}}])
        graph = []
        t = bench_run.agent_turn(con, gw, prov, bench_run.SOLO, "sys", "loop", graph)
        self.assertTrue(t.exhausted)
        self.assertFalse(t.submitted)
        self.assertEqual(t.steps, bench_run.MAX_TOOL_STEPS)
        self.assertEqual(prov.calls, bench_run.MAX_TOOL_STEPS + 1)
        self.assertTrue(any(g.get("step") == "exhausted" for g in graph))

    def test_the_deliverable_is_the_artifact_the_role_nominated(self):
        con, gw = loop_world()
        prov = ScriptedProvider([
            {"tool": "WRITE_ARTIFACT", "args": {"path": "loop_sol.py", "body": "print(42)\n"}},
            {"final": {"artifact": "loop_sol.py"}},
        ])
        t = bench_run.agent_turn(con, gw, prov, bench_run.SOLO, "sys", "write it", [])
        self.assertEqual(t.deliverable, "print(42)\n")
        self.assertTrue(t.artifact_path.endswith("loop_sol.py"))
        self.assertTrue(os.path.exists(t.artifact_path))

    def test_naming_an_artifact_that_was_never_written_submits_nothing(self):
        """The nomination is resolved against what the GATEWAY wrote, never
        against what the model said it wrote."""
        con, gw = loop_world()
        prov = ScriptedProvider([{"final": {"artifact": "never_written.py"}}])
        graph = []
        t = bench_run.agent_turn(con, gw, prov, bench_run.SOLO, "sys", "p", graph)
        self.assertFalse(t.submitted)
        self.assertIsNone(t.artifact_path)
        self.assertEqual(t.deliverable, "")
        self.assertTrue(any(g.get("step") == "submit_unresolved" for g in graph))

    def test_a_denial_is_an_observation_not_a_free_retry(self):
        con, gw = loop_world(tools=("WRITE_ARTIFACT",))     # READ_REPO not granted
        prov = ScriptedProvider([{"tool": "READ_REPO", "args": {"path": "/etc/passwd"}}])
        graph = []
        t = bench_run.agent_turn(con, gw, prov, bench_run.SOLO, "sys", "read", graph)
        self.assertEqual(t.denials, bench_run.MAX_CONSECUTIVE_DENIALS)
        self.assertEqual(prov.calls, bench_run.MAX_CONSECUTIVE_DENIALS)
        self.assertTrue(any(g.get("decision") == "DENY" for g in graph))
        self.assertTrue(any(g.get("step") == "denial_cap" for g in graph))

    def test_a_truncated_observation_is_recorded_with_its_counts(self):
        con, gw = loop_world()
        path = readable_file("y" * (bench_run.CLIP_BUDGET + 900))
        prov = ScriptedProvider([
            {"tool": "READ_REPO", "args": {"path": path}},
            {"final": {"answer": "read it"}},
        ])
        graph = []
        bench_run.agent_turn(con, gw, prov, bench_run.SOLO, "sys", "read", graph)
        clips = [g for g in graph if g.get("step") == "clip"]
        self.assertEqual(len(clips), 1)
        self.assertEqual(clips[0]["where"], "observation:READ_REPO")
        self.assertEqual(clips[0]["kept_chars"], bench_run.CLIP_BUDGET)
        self.assertEqual(clips[0]["dropped_chars"], 900)
        self.assertIn("(truncated)", prov.prompts[1])

    def test_every_loop_step_links_to_its_tool_call_row(self):
        con, gw = loop_world()
        path = readable_file()
        prov = ScriptedProvider([
            {"tool": "READ_REPO", "args": {"path": path}},
            {"tool": "WRITE_ARTIFACT", "args": {"path": "chain.py", "body": "print(42)\n"}},
            {"final": {"artifact": "chain.py"}},
        ])
        graph = []
        bench_run.agent_turn(con, gw, prov, bench_run.SOLO, "sys", "chain", graph)
        steps = [g for g in graph if g.get("tool")]
        self.assertEqual(len(steps), 2)
        for g in steps:
            self.assertIsNotNone(g["tool_call_id"])
            row = con.execute("SELECT * FROM tool_calls WHERE id=?",
                              (g["tool_call_id"],)).fetchone()
            self.assertIsNotNone(row, "exec_graph points at a tool_call that is not there")
            self.assertEqual(row["cap"], g["tool"])
            self.assertEqual(row["principal_id"], g["agent"])
            self.assertEqual(row["decision"], g["decision"])


class TransportRetriesOnly(unittest.TestCase):
    def test_a_transport_failure_is_retried_and_a_wrong_answer_is_not(self):
        def res(status, error):
            return P.Result(status, "mock", "scripted", "m", text="", error=error)
        for err in ("HTTP 503: overloaded_error", "HTTP 529: overloaded_error",
                    "URLError(TimeoutError('timed out'))",
                    "ConnectionResetError(104, 'Connection reset by peer')",
                    "HTTP 429: rate_limit_error"):
            self.assertTrue(bench_run.is_transport_failure(res("FAILED", err)), err)
        for status, err in (("OK", None), ("FAILED", "empty completion"),
                            ("NOT_CONFIGURED", "no key"), ("REFUSED", "owner PAUSE_ALL")):
            self.assertFalse(bench_run.is_transport_failure(res(status, err)),
                             "%s/%s" % (status, err))

    def test_every_retry_attempt_is_a_real_run_row(self):
        con, gw = loop_world()
        flaky = P.Result("FAILED", "mock", "scripted", "m", text="",
                         error="HTTP 503: overloaded_error")
        prov = ScriptedProvider([flaky, flaky, {"final": {"answer": "ok"}}])
        graph = []
        t = bench_run.agent_turn(con, gw, prov, bench_run.SOLO, "sys", "p", graph)
        self.assertEqual(t.deliverable, "ok")
        self.assertEqual(prov.calls, 3)
        self.assertEqual(len(t.run_ids), 3)
        self.assertEqual(len([g for g in graph if g.get("step") == "retry"]), 2)

    def test_a_wrong_answer_burns_no_retry(self):
        con, gw = loop_world()
        prov = ScriptedProvider([{"final": {"answer": "completely wrong"}}])
        graph = []
        bench_run.agent_turn(con, gw, prov, bench_run.SOLO, "sys", "p", graph)
        self.assertEqual(prov.calls, 1)
        self.assertEqual([g for g in graph if g.get("step") == "retry"], [])


class IdenticalSurface(unittest.TestCase):
    """LAW 11 compares sha(allowed_tools). What it could not see was that MULTI's
    roles were slice crew members carrying slice grants."""

    def _perms(self, con, aid):
        return con.execute("SELECT permissions FROM principals WHERE id=?",
                           (aid,)).fetchone()["permissions"]

    def test_both_conditions_hold_exactly_the_same_grants(self):
        con = world()
        task = [t for t in B.active_tasks() if t["id"] == "T05-tool-required"][0]
        bench_run.bench_crew(con, task)
        perms = {aid: self._perms(con, aid) for aid in
                 (bench_run.SOLO, bench_run.BUILDER, bench_run.CRITIC)}
        self.assertEqual(len(set(perms.values())), 1, perms)

    def test_no_role_borrows_a_capability_the_task_did_not_grant(self):
        con = world()
        task = [t for t in B.active_tasks() if t["id"] == "T01-exact-output"][0]
        self.assertEqual(task["allowed_tools"], ["WRITE_ARTIFACT"])
        bench_run.bench_crew(con, task)
        for aid in (bench_run.SOLO, bench_run.BUILDER, bench_run.CRITIC):
            caps = {g["cap"] for g in json.loads(self._perms(con, aid))}
            self.assertEqual(caps, {"WRITE_ARTIFACT"}, aid)

    def test_the_reviser_is_the_builder_so_it_cannot_escalate(self):
        self.assertEqual(bench_run.REVISER, bench_run.BUILDER)

    def test_one_step_budget_and_one_clip_policy_serve_both_conditions(self):
        with open(os.path.join(HERE, "bench_run.py"), encoding="utf-8") as fh:
            src = fh.read()
        for name in ("MAX_TOOL_STEPS", "CLIP_BUDGET", "MAX_TRANSPORT_RETRIES",
                     "MAX_CONSECUTIVE_DENIALS"):
            self.assertEqual(len(re.findall(r"^%s\s*=" % name, src, re.M)), 1, name)
        self.assertEqual(len(re.findall(r"^def clip\(", src, re.M)), 1)
        for gone in ("[:4000]", "[:3000]", "[:2000]", "[:600]"):
            self.assertNotIn(gone, src, "an ad-hoc truncation is back: %s" % gone)

    def test_the_trailing_act_and_its_critique_appendix_are_gone(self):
        self.assertFalse(hasattr(bench_run, "act"))
        self.assertFalse(hasattr(bench_run, "parse_out"))

    def test_every_role_prompt_documents_the_schema_and_the_tools(self):
        for name in ("SYS_SOLO", "SYS_BUILD", "SYS_CRITIC", "SYS_REVISE"):
            sysmsg = getattr(bench_run, name)
            self.assertIn("READ_REPO", sysmsg, name)
            self.assertIn("WRITE_ARTIFACT", sysmsg, name)
            self.assertIn('"final"', sysmsg, name)

    def test_no_change_required_is_a_legitimate_outcome_for_both_reviewers(self):
        self.assertIn("no defect is a valid and complete critique", bench_run.SYS_CRITIC)
        self.assertIn("resubmit it unchanged", bench_run.SYS_REVISE)


class GradingBoundary(unittest.TestCase):
    def setUp(self):
        self.con = world()
        B.ACTIVE.materialise_fixtures(vslice.REPO_ROOT)
        self.task = [t for t in B.active_tasks() if t["id"] == "T05-tool-required"][0]
        bench_run.bench_crew(self.con, self.task)
        self.cid = B.open_campaign(self.con, "loop", "mock", "m", 1)
        self.gw = vslice.build_gateway(self.con)

    def _row(self, brid):
        return self.con.execute("SELECT * FROM bench_runs WHERE id=?", (brid,)).fetchone()

    def test_the_graded_string_carries_no_critique_role_or_step_count(self):
        sentinel = "CRITIQUE-SENTINEL-4242"

        def script(prompt):
            if "CRITIQUE:" in prompt:                    # the reviser
                return {"final": {"answer": "print(42)"}}
            if "SUBMITTED WORK:" in prompt:              # the critic
                return {"final": {"answer": sentinel + " looks fine"}}
            return {"final": {"answer": "print(42)"}}    # the builder

        prov = ScriptedProvider([script])
        brid, _ = bench_run.run_condition(self.con, self.gw, prov, self.task,
                                          "MULTI", self.cid, 0, 0)
        r = self._row(brid)
        self.assertEqual(r["status"], "COMPLETE")
        self.assertEqual(r["output"], "print(42)")
        for token in (sentinel, "CRITIQUE", "critique", bench_run.CRITIC,
                      bench_run.BUILDER, "steps_used"):
            self.assertNotIn(token, r["output"])
        # recorded as evidence, just never graded
        self.assertIn(sentinel, r["exec_graph"])

    def test_a_reviser_that_changes_nothing_still_produces_the_deliverable(self):
        prov = ScriptedProvider([{"final": {"answer": "print(42)"}}])
        brid, _ = bench_run.run_condition(self.con, self.gw, prov, self.task,
                                          "MULTI", self.cid, 0, 0)
        r = self._row(brid)
        self.assertEqual(r["status"], "COMPLETE")
        self.assertEqual(r["output"], "print(42)")
        self.assertEqual(sorted(json.loads(r["agents_used"])),
                         sorted({bench_run.BUILDER, bench_run.CRITIC}))

    def test_a_run_that_never_submits_is_incomplete_and_is_never_graded(self):
        prov = ScriptedProvider([{"tool": "READ_REPO",
                                  "args": {"path": readable_file()}}])
        brid, path = bench_run.run_condition(self.con, self.gw, prov, self.task,
                                             "SINGLE", self.cid, 0, 0)
        r = self._row(brid)
        self.assertEqual(r["status"], "INCOMPLETE")
        self.assertEqual(r["output"], "")
        self.assertIsNone(path)
        m = B.evaluate(self.con, brid, self.task, {}, evaluator=bench_run.EVALUATOR)
        self.assertEqual(m["method"], "NONE")
        e = self.con.execute("SELECT * FROM bench_evaluations WHERE bench_run_id=?",
                             (brid,)).fetchone()
        self.assertEqual(e["method"], "NONE")
        self.assertIsNone(e["correctness"])

    def test_an_incomplete_run_is_an_attempt_without_a_score(self):
        prov = ScriptedProvider([{"tool": "READ_REPO",
                                  "args": {"path": readable_file()}}])
        bench_run.run_condition(self.con, self.gw, prov, self.task, "SINGLE",
                                self.cid, 0, 0)
        cell = [p for p in B.analyse(self.con, self.cid)["per_task"]
                if p["task_id"] == self.task["id"]][0]["SINGLE"]
        self.assertEqual(cell["attempts"], 1)
        self.assertEqual(cell["completed"], 0)
        self.assertIsNone(cell["correctness"])
        self.assertEqual(cell["failure_rate"], 1.0)

    def test_every_truncation_is_recorded_with_its_counts(self):
        big = "x" * (bench_run.CLIP_BUDGET + 1500)

        def script(prompt):
            if "CRITIQUE:" in prompt:
                return {"final": {"answer": big}}
            if "SUBMITTED WORK:" in prompt:
                return {"final": {"answer": "looks fine"}}
            return {"final": {"answer": big}}

        prov = ScriptedProvider([script])
        brid, _ = bench_run.run_condition(self.con, self.gw, prov, self.task,
                                          "MULTI", self.cid, 0, 0)
        graph = json.loads(self._row(brid)["exec_graph"])
        clips = [g for g in graph if g.get("step") == "clip"]
        self.assertTrue(clips, "a truncated handoff must say so")
        self.assertEqual(clips[0]["kept_chars"], bench_run.CLIP_BUDGET)
        self.assertEqual(clips[0]["dropped_chars"], 1500)
        self.assertTrue(clips[0]["truncated"])
        shown = big[:bench_run.CLIP_BUDGET]
        critic_prompt = [p for p in prov.prompts if "SUBMITTED WORK:" in p][0]
        reviser_prompt = [p for p in prov.prompts if "CRITIQUE:" in p][0]
        self.assertTrue(critic_prompt.endswith(shown))
        self.assertIn(shown, reviser_prompt)
        self.assertNotIn(big, reviser_prompt)
        # the grader still gets the whole thing: the clip is a handoff, not a cut
        self.assertEqual(len(self._row(brid)["output"]), len(big))

    def test_an_untruncated_run_says_so_by_recording_nothing(self):
        prov = ScriptedProvider([{"final": {"answer": "print(42)"}}])
        brid, _ = bench_run.run_condition(self.con, self.gw, prov, self.task,
                                          "MULTI", self.cid, 0, 0)
        graph = json.loads(self._row(brid)["exec_graph"])
        self.assertEqual([g for g in graph if g.get("step") == "clip"], [])

    def test_cost_and_latency_accumulate_over_every_role_turn(self):
        prov = ScriptedProvider([{"final": {"answer": "print(42)"}}], usd=0.001)
        sid, _ = bench_run.run_condition(self.con, self.gw, prov, self.task,
                                         "SINGLE", self.cid, 0, 0)
        mid, _ = bench_run.run_condition(self.con, self.gw, prov, self.task,
                                         "MULTI", self.cid, 0, 1)
        s, m = self._row(sid), self._row(mid)
        self.assertAlmostEqual(s["usd"], 0.001, places=6)
        self.assertAlmostEqual(m["usd"], 0.003, places=6)
        self.assertEqual(len(json.loads(s["model_runs"])), 1)
        self.assertEqual(len(json.loads(m["model_runs"])), 3)
        self.assertGreater(m["tokens_in"], s["tokens_in"])

        def call_latency(row):
            ids = json.loads(row["model_runs"])
            return self.con.execute(
                "SELECT COALESCE(SUM(latency_ms),0) s FROM runs WHERE id IN (%s)"
                % ",".join("?" * len(ids)), ids).fetchone()["s"]
        self.assertEqual(call_latency(s), 1)
        self.assertEqual(call_latency(m), 3)

    def test_a_failed_run_still_reports_what_it_spent(self):
        dead = P.Result("FAILED", "mock", "scripted", "m", text="",
                        error="empty completion", usd=0.002)

        def script(prompt):
            return dead if "SUBMITTED WORK:" in prompt else {"final": {"answer": "print(42)"}}

        prov = ScriptedProvider([script], usd=0.001)
        brid, _ = bench_run.run_condition(self.con, self.gw, prov, self.task,
                                          "MULTI", self.cid, 0, 0)
        r = self._row(brid)
        self.assertEqual(r["status"], "FAILED")
        # the builder's call AND the critic's failed call, not just the one that
        # happened to return
        self.assertAlmostEqual(r["usd"], 0.003, places=6)
        self.assertEqual(len(json.loads(r["model_runs"])), 2)


class IncompleteIsARecordedStatus(unittest.TestCase):
    def test_the_schema_accepts_it(self):
        con = world()
        cid = B.open_campaign(con, "t", "mock", "m", 1)
        brid = B.start_run(con, cid, BT.TASKS[0], "SINGLE", 0, 0, "sha")
        B.finish_run(con, brid, status="INCOMPLETE", output="")
        self.assertEqual(con.execute("SELECT status FROM bench_runs WHERE id=?",
                                     (brid,)).fetchone()["status"], "INCOMPLETE")

    def test_an_old_world_is_migrated_without_losing_a_single_row(self):
        """The CHECK can only be widened by rebuilding the table, and on the
        owner's machine that table holds the raw runs of campaigns #1-#3."""
        path = os.path.join(tempfile.mkdtemp(), "old.db")
        con = store.connect(path)
        store.found(con, mode="simulation")
        B.register_tasks(con)
        cid = B.open_campaign(con, "historic", "mock", "m", 1)
        for i, cond in enumerate(("SINGLE", "MULTI")):
            brid = B.start_run(con, cid, BT.TASKS[0], cond, 0, i, "sha")
            B.finish_run(con, brid, status="COMPLETE", output="print(42)")
        B.close_campaign(con, cid, {"conclusion": "INSUFFICIENT_EVIDENCE", "why": "x"})
        before = [tuple(r) for r in con.execute("SELECT * FROM bench_runs ORDER BY id")]
        con.close()

        # rewind the file to the pre-INCOMPLETE schema
        raw = sqlite3.connect(path)
        ddl = raw.execute("SELECT sql FROM sqlite_master WHERE name='bench_runs'"
                          ).fetchone()[0]
        narrow = ddl.replace("'INCOMPLETE',", "").replace("bench_runs", "bench_runs_old", 1)
        self.assertNotIn("'INCOMPLETE'", narrow)
        raw.executescript(
            "PRAGMA foreign_keys=OFF;\nPRAGMA legacy_alter_table=ON;\nBEGIN;\n%s;\n"
            "INSERT INTO bench_runs_old SELECT * FROM bench_runs;\n"
            "DROP TABLE bench_runs;\n"
            "ALTER TABLE bench_runs_old RENAME TO bench_runs;\nCOMMIT;" % narrow)
        raw.close()

        con = store.connect(path)                      # migrates on open
        after = [tuple(r) for r in con.execute("SELECT * FROM bench_runs ORDER BY id")]
        self.assertEqual(before, after, "the migration changed a historic run")
        self.assertIn("'INCOMPLETE'", con.execute(
            "SELECT sql FROM sqlite_master WHERE name='bench_runs'").fetchone()["sql"])
        # and LAW 12 came back with the rebuilt table
        with self.assertRaises(sqlite3.IntegrityError) as e:
            con.execute("UPDATE bench_runs SET output='rewritten' WHERE id=1")
        self.assertIn("LAW 12", str(e.exception))


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
