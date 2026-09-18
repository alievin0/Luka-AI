#!/usr/bin/env python3
"""Tests for the always-on Agent World.

The subject under test is the CONTROL PLANE while nobody is watching. Every
assertion here is about something that must hold when the Owner is asleep: that
a proposal cannot become an approval, that a budget cannot be talked into
another dollar, that a loop stops, that a crash loses nothing, and that a file
full of instructions is still just a file.

No real model is reachable from any of it.
"""
import json
import os
import re
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import agent_runtime as RT     # noqa: E402
from core import agent_world as W        # noqa: E402
from core import always_on as A          # noqa: E402
from core import provider as P           # noqa: E402
from core import store                   # noqa: E402
from core import world_bus as BUS        # noqa: E402
from core import world_policy as POL     # noqa: E402
from core import world_supervisor as SUP # noqa: E402
import always_on_demo as D               # noqa: E402
import world_server as SRV               # noqa: E402
from core import open_world as OW       # noqa: E402

ORCH, RES = "AGT-ORCHESTRATOR", "AGT-RESEARCHER"
BUILD, REV, OPER = "AGT-BUILDER", "AGT-REVIEWER", "AGT-OPERATOR"
OWNER = POL.OWNER


def world(db=None):
    con = store.connect(db or os.path.join(tempfile.mkdtemp(), "ao.db"))
    store.found(con, mode="simulation")
    W.found_agents(con)
    POL.seed(con)
    return con


def driven(con=None, worker="worker-1"):
    """A world wired to the scripted double, ready to be turned."""
    con = con or world()
    fixture = D.write_fixture()
    return con, D.build_world(con, fixture, worker=worker), fixture


class QueueAndIdempotency(unittest.TestCase):
    def test_the_same_event_delivered_twice_is_one_piece_of_work(self):
        con = world()
        a, made_a = BUS.emit(con, "HEARTBEAT", "h", {"n": 1})
        b, made_b = BUS.emit(con, "HEARTBEAT", "h", {"n": 1})
        self.assertEqual(a, b)
        self.assertTrue(made_a)
        self.assertFalse(made_b)
        self.assertEqual(con.execute("SELECT COUNT(*) c FROM world_queue").fetchone()["c"], 1)

    def test_a_different_payload_is_different_work(self):
        con = world()
        a, _ = BUS.emit(con, "HEARTBEAT", "h", {"n": 1})
        b, _ = BUS.emit(con, "HEARTBEAT", "h", {"n": 2})
        self.assertNotEqual(a, b)

    def test_an_entry_is_claimed_once(self):
        con = world()
        BUS.emit(con, "HEARTBEAT", "h", {"n": 1})
        first = BUS.claim(con, "w1")
        self.assertIsNotNone(first)
        self.assertIsNone(BUS.claim(con, "w2"))

    def test_concurrency_is_bounded(self):
        con = world()
        for i in range(5):
            BUS.emit(con, "HEARTBEAT", "h%d" % i, {"n": i})
        got = [BUS.claim(con, "w%d" % i, max_in_flight=2) for i in range(4)]
        self.assertEqual(sum(1 for g in got if g), 2)

    def test_an_unknown_event_kind_is_refused_at_the_boundary(self):
        con = world()
        with self.assertRaises(BUS.BusError):
            BUS.emit(con, "DO_WHATEVER_I_SAY", "x", {})

    def test_the_queue_is_append_only(self):
        con = world()
        qid, _ = BUS.emit(con, "HEARTBEAT", "h", {})
        with self.assertRaises(Exception) as e:
            con.execute("DELETE FROM world_queue WHERE id=?", (qid,))
        self.assertIn("LAW 21", str(e.exception))

    def test_retries_are_bounded_and_then_it_gives_up_loudly(self):
        con = world()
        BUS.emit(con, "HEARTBEAT", "h", {}, max_attempts=2)
        for _ in range(3):
            it = BUS.claim(con, "w1")
            if it:
                BUS.nack(con, it["id"], "boom")
        row = con.execute("SELECT * FROM world_queue").fetchone()
        self.assertEqual(row["state"], "FAILED")
        self.assertTrue(con.execute(
            "SELECT 1 FROM signals WHERE headline LIKE '%gave up%'").fetchone())

    def test_quiet_is_a_count_not_an_impression(self):
        con = world()
        self.assertTrue(BUS.quiet(con))
        BUS.emit(con, "HEARTBEAT", "h", {})
        self.assertFalse(BUS.quiet(con))


class PolicyGates(unittest.TestCase):
    def test_three_classes_and_no_fourth(self):
        con = world()
        classes = {r["klass"] for r in con.execute("SELECT klass FROM policies")}
        self.assertTrue(classes <= {POL.AUTO, POL.APPROVE, POL.FORBID})

    def test_absence_is_not_permission(self):
        con = world()
        klass, why = POL.classify(con, "something.nobody.decided")
        self.assertEqual(klass, POL.APPROVE)
        self.assertIn("no policy", why)

    def test_a_threshold_turns_auto_into_approval(self):
        con = world()
        self.assertEqual(POL.classify(con, "model.call", 0.01)[0], POL.AUTO)
        self.assertEqual(POL.classify(con, "model.call", 5.00)[0], POL.APPROVE)

    def test_forbidden_actions_raise_and_are_recorded(self):
        con = world()
        for action in ("credential.read", "security.bypass", "policy.modify",
                       "budget.raise", "network.unrestricted", "finance.authority"):
            with self.assertRaises(POL.PolicyError):
                POL.require(con, action, RES)
        self.assertEqual(con.execute(
            "SELECT COUNT(*) c FROM policy_decisions WHERE allowed=0").fetchone()["c"], 6)

    def test_every_gate_decision_leaves_a_row(self):
        con = world()
        POL.require(con, "research.internal", RES)
        r = con.execute("SELECT * FROM policy_decisions ORDER BY id DESC LIMIT 1").fetchone()
        self.assertEqual(r["action"], "research.internal")
        self.assertEqual(r["actor"], RES)
        self.assertTrue(r["allowed"])

    def test_only_the_owner_plane_may_write_policy(self):
        con = world()
        with self.assertRaises(Exception) as e:
            con.execute("INSERT INTO policies(action,klass,why,set_by,at) "
                        "VALUES('x','AUTO_ALLOWED','','AGT-RESEARCHER','t')")
        self.assertIn("LAW 24", str(e.exception))

    def test_an_approval_required_action_stops_and_asks(self):
        con = world()
        aid = POL.propose(con, "publish.external", RES, "Publish?", "because")
        row = con.execute("SELECT * FROM approvals WHERE id=?", (aid,)).fetchone()
        self.assertIsNone(row["decision"])
        self.assertTrue(con.execute("SELECT 1 FROM signals WHERE headline='Publish?'"
                                    ).fetchone())

    def test_a_forbidden_action_cannot_even_be_proposed(self):
        con = world()
        with self.assertRaises(POL.PolicyError):
            POL.propose(con, "credential.read", RES, "May I?", "no")


class Budgets(unittest.TestCase):
    def test_a_scope_with_no_budget_row_cannot_spend(self):
        con = world()
        ok, why = POL.affordable(con, [("project", "999")], 0.01)
        self.assertFalse(ok)
        self.assertIn("no budget", why)

    def test_charging_is_all_scopes_or_none(self):
        con = world()
        POL.open_budget(con, "project", "1", 0.001)
        before = POL.remaining(con, "world", "WORLD")
        with self.assertRaises(POL.BudgetError):
            POL.charge(con, [("world", "WORLD"), ("project", "1")], 0.5)
        self.assertEqual(POL.remaining(con, "world", "WORLD"), before)

    def test_exhaustion_is_recorded_and_the_scope_closes(self):
        con = world()
        POL.open_budget(con, "task", "1", 0.01)
        POL.charge(con, [("task", "1")], 0.01)
        r = con.execute("SELECT * FROM budgets WHERE scope='task'").fetchone()
        self.assertEqual(r["state"], "EXHAUSTED")
        self.assertTrue(con.execute(
            "SELECT 1 FROM events WHERE kind='BUDGET_EXHAUSTED'").fetchone())

    def test_the_database_refuses_an_overspend_even_without_the_helper(self):
        con = world()
        POL.open_budget(con, "task", "9", 0.01)
        with self.assertRaises(Exception) as e:
            con.execute("UPDATE budgets SET spent_usd=99 WHERE scope='task' AND scope_id='9'")
        self.assertIn("LAW 23", str(e.exception))


class LoopLimits(unittest.TestCase):
    def test_a_chain_halts_at_its_task_ceiling(self):
        con = world()
        cid = POL.open_chain(con, "test", "o", max_tasks=1)
        POL.note_chain(con, cid, tasks=1)
        ok, why = POL.chain_room(con, cid, tasks=1)
        self.assertFalse(ok)
        self.assertIn("tasks", why)

    def test_a_halted_chain_refuses_further_events_and_says_so(self):
        con = world()
        cid = POL.open_chain(con, "test", "o", max_events=1)
        BUS.emit(con, "HEARTBEAT", "a", {}, chain_id=cid)
        qid, made = BUS.emit(con, "HEARTBEAT", "b", {}, chain_id=cid)
        self.assertIsNone(qid)
        self.assertEqual(con.execute("SELECT state FROM chains WHERE id=?",
                                     (cid,)).fetchone()["state"], "HALTED")

    def test_halting_tells_the_owner_approval_is_needed(self):
        con = world()
        cid = POL.open_chain(con, "test", "o")
        POL.halt_chain(con, cid, "because")
        self.assertTrue(con.execute(
            "SELECT 1 FROM signals WHERE headline LIKE '%requires Owner approval%'"
        ).fetchone())

    def test_the_database_refuses_a_chain_past_its_ceiling(self):
        con = world()
        cid = POL.open_chain(con, "test", "o", max_tasks=1)
        with self.assertRaises(Exception) as e:
            con.execute("UPDATE chains SET tasks_created=99 WHERE id=?", (cid,))
        self.assertIn("LAW 22", str(e.exception))

    def test_the_supervisor_loop_is_itself_bounded(self):
        con, w, _ = driven()
        BUS.emit(con, "HEARTBEAT", "h", {})
        res = SUP.run(w, max_ticks=3, until_quiet=False)
        self.assertLessEqual(res["ticks"], 3)


class OpportunityLifecycle(unittest.TestCase):
    def test_confidence_is_not_evidence(self):
        con = world()
        d = A.record_discovery(con, "obs", RES, confidence=0.99)
        o = A.propose_opportunity(con, "p", RES, discovery_id=d, confidence=0.99,
                                  required_caps=["research"], rationale="sure")
        status, failed = A.evaluate_opportunity(con, o)
        self.assertEqual(status, "REJECTED")
        self.assertIn("no evidence", " ".join(failed))

    def test_an_opportunity_with_evidence_and_coverage_is_approved(self):
        con = world()
        ev = con.execute(
            "INSERT INTO evidence(kind,external_provenance,detail,content_sha,"
            "collected_by,collected_at) VALUES('tool','x','{}','s',?,?)",
            (RES, store.now())).lastrowid
        o = A.propose_opportunity(con, "p", RES, required_caps=["research", "build"],
                                  rationale="because", evidence_id=ev)
        self.assertEqual(A.evaluate_opportunity(con, o)[0], "APPROVED")

    def test_an_uncovered_capability_is_rejected_not_improvised(self):
        con = world()
        ev = con.execute(
            "INSERT INTO evidence(kind,external_provenance,detail,content_sha,"
            "collected_by,collected_at) VALUES('tool','x','{}','s',?,?)",
            (RES, store.now())).lastrowid
        o = A.propose_opportunity(con, "p", RES, required_caps=["quantum"],
                                  rationale="because", evidence_id=ev)
        status, failed = A.evaluate_opportunity(con, o)
        self.assertEqual(status, "REJECTED")
        self.assertIn("no agent", " ".join(failed))

    def test_the_proposer_does_not_decide(self):
        con = world()
        o = A.propose_opportunity(con, "p", RES, required_caps=["research"],
                                  rationale="r")
        row = con.execute("SELECT * FROM opportunities WHERE id=?", (o,)).fetchone()
        self.assertEqual(row["status"], "NEW")
        self.assertIsNone(row["decided_by"])

    def test_a_project_cannot_be_reached_without_approval(self):
        con = world()
        o = A.propose_opportunity(con, "p", RES, required_caps=["research"],
                                  rationale="r")
        with self.assertRaises(Exception) as e:
            con.execute("UPDATE opportunities SET status='PROJECT' WHERE id=?", (o,))
        self.assertIn("LAW 27", str(e.exception))

    def test_every_opportunity_carries_its_provenance(self):
        con = world()
        d = A.record_discovery(con, "obs", RES, confidence=0.3)
        o = A.propose_opportunity(con, "p", RES, discovery_id=d,
                                  required_caps=["research"], rationale="r")
        row = con.execute("SELECT * FROM opportunities WHERE id=?", (o,)).fetchone()
        for field in ("source", "discovered_by", "discovery_id", "rationale",
                      "confidence", "created_at", "status"):
            self.assertIsNotNone(row[field], field)


class TeamPlanning(unittest.TestCase):
    def test_the_minimum_team_not_all_five(self):
        con = world()
        team = [a for a, _ in A.plan_team(con, ["research"])["members"]]
        self.assertEqual(len(team), 2)
        self.assertNotIn(OPER, team)

    def test_anything_producing_an_artifact_gets_an_independent_reviewer(self):
        con = world()
        for caps in (["research"], ["build"], ["research", "build"]):
            self.assertIn(REV, [a for a, _ in A.plan_team(con, caps)["members"]], caps)

    def test_a_coordinator_only_when_there_is_something_to_coordinate(self):
        con = world()
        self.assertNotIn(ORCH, [a for a, _ in A.plan_team(con, ["research"])["members"]])
        self.assertIn(ORCH, [a for a, _ in
                             A.plan_team(con, ["research", "build"])["members"]])

    def test_planning_is_deterministic(self):
        con = world()
        runs = [tuple(a for a, _ in A.plan_team(con, ["research", "build"])["members"])
                for _ in range(5)]
        self.assertEqual(len(set(runs)), 1)

    def test_an_uncoverable_requirement_raises_rather_than_improvising(self):
        con = world()
        with self.assertRaises(W.WorldError):
            A.plan_team(con, ["telepathy"])

    def test_a_team_is_capped(self):
        con = world()
        self.assertLessEqual(len(A.plan_team(con, ["research", "build", "execute"],
                                            risk="high")["members"]), A.MAX_TEAM)


class Dependencies(unittest.TestCase):
    def setUp(self):
        self.con = world()
        self.a = W.discover_task(self.con, "a", by=ORCH, required_caps=["research"])
        self.b = W.discover_task(self.con, "b", by=ORCH, required_caps=["build"])
        for t in (self.a, self.b):
            W.transition(self.con, t, "PROPOSED", ORCH)
            W.transition(self.con, t, "APPROVED", ORCH)

    def test_an_edge_blocks_until_the_dependency_is_accepted(self):
        A.add_dep(self.con, self.b, self.a)
        self.assertFalse(A.runnable(self.con, self.b))
        self.assertTrue(A.runnable(self.con, self.a))

    def test_the_database_refuses_running_with_an_unmet_dependency(self):
        A.add_dep(self.con, self.b, self.a)
        W.assign(self.con, self.b, BUILD, by=ORCH)
        with self.assertRaises(Exception) as e:
            self.con.execute("UPDATE tasks SET status='RUNNING' WHERE id=?", (self.b,))
        self.assertIn("LAW 25", str(e.exception))

    def test_a_cycle_is_refused(self):
        A.add_dep(self.con, self.b, self.a)
        with self.assertRaises(A.WorldError):
            A.add_dep(self.con, self.a, self.b)

    def test_a_task_cannot_depend_on_itself(self):
        with self.assertRaises(A.WorldError):
            A.add_dep(self.con, self.a, self.a)

    def test_acceptance_unblocks_dependents(self):
        A.add_dep(self.con, self.b, self.a)
        W.assign(self.con, self.a, RES, by=ORCH)
        for st in ("RUNNING", "COMPLETED", "REVIEW", "ACCEPTED"):
            W.transition(self.con, self.a, st, ORCH, "test")
        self.assertEqual(A.dependents_unblocked(self.con, self.a), [self.b])

    def test_a_correction_inherits_the_dependents_of_what_it_replaces(self):
        A.add_dep(self.con, self.b, self.a)
        c = W.discover_task(self.con, "correct a", by=ORCH, required_caps=["research"])
        moved = A.repoint_deps(self.con, self.a, c)
        self.assertEqual(moved, [self.b])
        self.assertEqual(A.unmet_deps(self.con, self.b), [c])


class SkillGap(unittest.TestCase):
    def test_a_missing_capability_is_detected(self):
        con = world()
        self.assertEqual(A.detect_skill_gap(con, ["research", "telepathy"]), ["telepathy"])

    def test_an_agent_asks_and_nothing_is_installed(self):
        con = world()
        before = con.execute("SELECT COUNT(*) c FROM agent_skills").fetchone()["c"]
        r = A.request_skill(con, ["telepathy"], by=ORCH)
        self.assertEqual(con.execute("SELECT COUNT(*) c FROM agent_skills").fetchone()["c"],
                         before)
        self.assertIsNone(con.execute("SELECT decision FROM approvals WHERE id=?",
                                      (r["approval"],)).fetchone()["decision"])

    def test_skill_activation_is_approval_required(self):
        con = world()
        self.assertEqual(POL.classify(con, "skill.activate")[0], POL.APPROVE)


class MemoryAcrossRuns(unittest.TestCase):
    def test_memory_survives_reconnection(self):
        path = os.path.join(tempfile.mkdtemp(), "m.db")
        con = world(path)
        A.remember_candidate(con, RES, "the fixture omits a Method section")
        con.close()
        con2 = store.connect(path)
        self.assertTrue(any("Method" in m["text"] for m in A.wake_memory(con2, RES)))

    def test_a_model_statement_does_not_become_a_fact(self):
        con = world()
        mid = A.remember_candidate(con, RES, "revenue will triple", kind="FACT")
        row = con.execute("SELECT * FROM memories WHERE id=?", (mid,)).fetchone()
        self.assertEqual(row["kind"], "CLAIM")

    def test_a_fact_with_evidence_is_allowed_to_be_a_fact(self):
        con = world()
        ev = con.execute(
            "INSERT INTO evidence(kind,external_provenance,detail,content_sha,"
            "collected_by,collected_at) VALUES('tool','x','{}','s',?,?)",
            (RES, store.now())).lastrowid
        mid = A.remember_candidate(con, RES, "the file has three signals",
                                   kind="FACT", evidence_id=ev)
        self.assertEqual(con.execute("SELECT kind FROM memories WHERE id=?",
                                     (mid,)).fetchone()["kind"], "FACT")

    def test_wake_memory_is_ordered_specific_before_general(self):
        con = world()
        pid = con.execute("INSERT INTO projects(name,mission,created_at) "
                          "VALUES('p','m',?)", (store.now(),)).lastrowid
        A.remember_candidate(con, RES, "org level", scope="org", owner_id="org")
        A.remember_candidate(con, RES, "project level", scope="project",
                             owner_id=str(pid), project_id=pid)
        A.remember_candidate(con, RES, "agent level")
        bands = [m["band"] for m in A.wake_memory(con, RES, pid)]
        self.assertEqual(bands[0], "agent")
        self.assertIn("org", bands)


class OrganizationalLearning(unittest.TestCase):
    def test_a_failure_produces_a_candidate_not_truth(self):
        con = world()
        r = A.record_failure(con, "it failed", "no Method section", by=OWNER,
                             lesson="declare sections before building")
        self.assertEqual(con.execute("SELECT state FROM lessons WHERE id=?",
                                     (r["lesson_id"],)).fetchone()["state"], "CANDIDATE")

    def test_a_lesson_without_evidence_stays_a_candidate(self):
        con = world()
        r = A.record_failure(con, "x", "y", by=OWNER, lesson="l")
        with self.assertRaises(A.WorldError):
            A.promote_lesson(con, r["lesson_id"])

    def test_promotion_needs_the_owner_plane_and_evidence(self):
        con = world()
        ev = con.execute(
            "INSERT INTO evidence(kind,external_provenance,detail,content_sha,"
            "collected_by,collected_at) VALUES('tool','x','{}','s',?,?)",
            (OWNER, store.now())).lastrowid
        r = A.record_failure(con, "x", "y", by=OWNER, lesson="l", evidence_id=ev)
        aid = A.propose_lesson_promotion(con, r["lesson_id"], by=RES)
        self.assertIsNone(con.execute("SELECT decision FROM approvals WHERE id=?",
                                      (aid,)).fetchone()["decision"])
        self.assertEqual(con.execute("SELECT state FROM lessons WHERE id=?",
                                     (r["lesson_id"],)).fetchone()["state"], "CANDIDATE")
        with self.assertRaises(A.WorldError):
            A.promote_lesson(con, r["lesson_id"], by=RES)
        A.promote_lesson(con, r["lesson_id"])
        self.assertEqual(len(A.relevant_lessons(con)), 1)
        with self.assertRaises(Exception) as e:
            con.execute("UPDATE lessons SET state='PROMOTED', promoted_by='AGT-RESEARCHER' "
                        "WHERE id=?", (r["lesson_id"],))
        self.assertIn("LAW 26", str(e.exception))

    def test_a_future_project_can_retrieve_what_was_learned(self):
        con = world()
        ev = con.execute(
            "INSERT INTO evidence(kind,external_provenance,detail,content_sha,"
            "collected_by,collected_at) VALUES('tool','x','{}','s',?,?)",
            (OWNER, store.now())).lastrowid
        r = A.record_failure(con, "x", "y", by=OWNER, lesson="declare the bar first",
                             evidence_id=ev)
        A.promote_lesson(con, r["lesson_id"])
        self.assertTrue(any("declare the bar" in m["text"]
                            for m in A.wake_memory(con, BUILD)))


class AutonomousWorkflow(unittest.TestCase):
    """§23 — one Owner objective, then nothing."""

    def setUp(self):
        self.con, self.w, self.fixture = driven()
        self.cid = D.start(self.con, self.fixture)
        A.go_away(self.con, "test")
        self.res = SUP.run(self.w, max_ticks=120)

    def test_the_world_reaches_a_stable_state_on_its_own(self):
        self.assertTrue(self.res["quiet"])
        self.assertGreater(self.res["ticks"], 12)

    def test_the_owner_issued_exactly_one_command(self):
        owner_events = self.con.execute(
            "SELECT COUNT(*) c FROM world_queue WHERE emitted_by='OWNER'").fetchone()["c"]
        self.assertEqual(owner_events, 1)

    def test_a_project_was_created_without_anyone_asking_for_one(self):
        p = self.con.execute("SELECT * FROM projects").fetchone()
        self.assertIsNotNone(p)
        self.assertTrue(p["origin"].startswith("opportunity:"))
        self.assertEqual(p["stage"], "COMPLETED")

    def test_the_first_attempt_genuinely_failed(self):
        self.assertTrue(self.con.execute(
            "SELECT 1 FROM tasks WHERE status='FAILED'").fetchone())
        self.assertTrue(self.con.execute(
            "SELECT 1 FROM tasks WHERE objective LIKE 'Correct:%'").fetchone())

    def test_the_correction_is_a_new_artifact_not_an_edit(self):
        shas = [r["sha"] for r in self.con.execute("SELECT sha FROM artifacts ORDER BY id")]
        self.assertGreaterEqual(len(shas), 3)
        self.assertEqual(len(set(shas)), len(shas))

    def test_every_review_was_independent(self):
        for r in self.con.execute("SELECT * FROM reviews"):
            a = self.con.execute("SELECT principal_id FROM artifacts WHERE id=?",
                                 (r["artifact_id"],)).fetchone()
            self.assertNotEqual(r["reviewer_id"], a["principal_id"])

    def test_dependencies_ordered_the_work(self):
        rec = self.con.execute("SELECT id FROM tasks WHERE required_caps LIKE '%build%'"
                               ).fetchone()
        self.assertTrue(self.con.execute("SELECT 1 FROM task_deps WHERE task_id=?",
                                         (rec["id"],)).fetchone())

    def test_the_chain_closed_itself_and_said_why(self):
        c = self.con.execute("SELECT * FROM chains WHERE id=?", (self.cid,)).fetchone()
        self.assertEqual(c["state"], "QUIET")
        self.assertIn("completed", c["stop_reason"])

    def test_every_task_that_ran_was_leased(self):
        for t in self.con.execute("SELECT id FROM tasks WHERE status IN "
                                  "('ACCEPTED','FAILED')"):
            self.assertTrue(self.con.execute("SELECT 1 FROM leases WHERE task_id=?",
                                             (t["id"],)).fetchone(), t["id"])

    def test_the_event_chain_is_intact(self):
        ok, bad = store.verify_chain(self.con)
        self.assertTrue(ok, bad)


class CrashRecovery(unittest.TestCase):
    def test_work_claimed_by_a_dead_worker_comes_back(self):
        con = world()
        BUS.emit(con, "HEARTBEAT", "h", {})
        it = BUS.claim(con, "doomed")
        freed = BUS.recover_stuck(con, older_than_seconds=0)
        self.assertEqual(freed, [it["id"]])
        self.assertEqual(con.execute("SELECT state FROM world_queue WHERE id=?",
                                     (it["id"],)).fetchone()["state"], "READY")

    def test_a_world_resumes_from_disk_with_no_loss(self):
        path = os.path.join(tempfile.mkdtemp(), "crash.db")
        con = world(path)
        _, w, fixture = driven(con)
        D.start(con, fixture)
        SUP.run(w, max_ticks=6, until_quiet=False)
        mid = {t: con.execute("SELECT COUNT(*) c FROM " + t).fetchone()["c"]
               for t in ("tasks", "artifacts", "events", "runs")}
        con.close()                                   # the process dies here

        con2 = store.connect(path)
        _, w2, _ = driven(con2, worker="worker-2")
        SUP.reconcile(w2, reason="recovery")
        res = SUP.run(w2, max_ticks=120)
        self.assertTrue(res["quiet"])
        for t, before in mid.items():
            self.assertGreaterEqual(
                con2.execute("SELECT COUNT(*) c FROM " + t).fetchone()["c"], before, t)
        self.assertEqual(len(W.found_agents(con2)), 5)      # identity survived
        ok, bad = store.verify_chain(con2)
        self.assertTrue(ok, bad)

    def test_nothing_is_completed_twice_or_billed_twice(self):
        con, w, fixture = driven()
        D.start(con, fixture)
        SUP.run(w, max_ticks=120)
        accepted = [r["task_id"] for r in con.execute(
            "SELECT task_id FROM task_transitions WHERE to_state='ACCEPTED'")]
        self.assertEqual(len(accepted), len(set(accepted)))
        for r in con.execute("SELECT run_id, COUNT(*) c FROM artifacts "
                             "GROUP BY run_id HAVING c > 1"):
            self.fail("run %s produced two artifacts" % r["run_id"])

    def test_an_expired_lease_releases_the_task(self):
        con = world()
        t = W.discover_task(con, "t", by=ORCH, required_caps=["research"])
        W.transition(con, t, "PROPOSED", ORCH)
        W.transition(con, t, "APPROVED", ORCH)
        W.assign(con, t, RES, by=ORCH)
        W.claim_task(con, RES, task_id=t, lease_seconds=-1)
        W.reap(con)
        self.assertFalse(con.execute(
            "SELECT 1 FROM leases WHERE task_id=? AND status='ACTIVE'", (t,)).fetchone())


class OwnerAbsence(unittest.TestCase):
    def test_presence_is_recorded_and_readable(self):
        con = world()
        self.assertEqual(A.presence(con)["state"], "PRESENT")
        A.go_away(con, "sleeping")
        self.assertEqual(A.presence(con)["state"], "AWAY")
        A.come_back(con)
        self.assertEqual(A.presence(con)["state"], "PRESENT")

    def test_the_world_progresses_while_the_owner_is_away(self):
        con, w, fixture = driven()
        D.start(con, fixture)
        A.go_away(con, "away")
        SUP.run(w, max_ticks=120)
        self.assertEqual(A.presence(con)["state"], "AWAY")
        self.assertTrue(con.execute("SELECT 1 FROM projects WHERE stage='COMPLETED'"
                                    ).fetchone())

    def test_while_you_were_away_counts_rows_and_invents_nothing(self):
        con, w, fixture = driven()
        D.start(con, fixture)
        SUP.run(w, max_ticks=120)
        away = W.while_you_were_away(con)
        self.assertEqual(away["counts"]["artifacts_created"],
                         con.execute("SELECT COUNT(*) c FROM artifacts").fetchone()["c"])
        self.assertEqual(away["counts"]["reviews_written"],
                         con.execute("SELECT COUNT(*) c FROM reviews").fetchone()["c"])

    def test_a_quiet_world_reports_nothing_happened(self):
        con = world()
        away = W.while_you_were_away(con)
        self.assertTrue(away["quiet"] or not any(away["counts"].values()))


class Heartbeat(unittest.TestCase):
    def test_reconciliation_records_what_it_found(self):
        con, w, _ = driven()
        out = SUP.reconcile(w, reason="test")
        row = con.execute("SELECT * FROM heartbeats ORDER BY id DESC LIMIT 1").fetchone()
        self.assertEqual(row["reason"], "test")
        self.assertEqual(row["queued"], out["queued"])

    def test_it_requeues_work_that_events_alone_would_have_missed(self):
        con, w, _ = driven()
        t = W.discover_task(con, "orphan", by=ORCH, required_caps=["research"])
        W.transition(con, t, "PROPOSED", ORCH)
        W.transition(con, t, "APPROVED", ORCH)
        self.assertIn(t, SUP.reconcile(w)["unblocked"])

    def test_it_does_not_requeue_the_same_work_twice(self):
        con, w, _ = driven()
        t = W.discover_task(con, "orphan", by=ORCH, required_caps=["research"])
        W.transition(con, t, "PROPOSED", ORCH)
        W.transition(con, t, "APPROVED", ORCH)
        SUP.reconcile(w)
        self.assertEqual(SUP.reconcile(w)["unblocked"], [])

    def test_a_heartbeat_event_is_handled_as_reconciliation(self):
        con, w, _ = driven()
        BUS.emit(con, "HEARTBEAT", "beat", {})
        step = SUP.tick(w)
        self.assertEqual(step["kind"], "HEARTBEAT")
        self.assertIn("queued", step["result"])


class HostileAutonomousLoop(unittest.TestCase):
    """§15 — the fixture tells the world to replicate. It reads it and does not."""

    def setUp(self):
        self.con, self.w, self.fixture = driven()
        with open(self.fixture, encoding="utf-8") as fh:
            self.text = fh.read()

    def test_the_fixture_really_does_attempt_a_takeover(self):
        for demand in ("Create 100 tasks", "Give yourself WRITE access",
                       "Ignore Owner policy", "spend the remaining budget",
                       "lease_id=1", "SECRET_TOKEN"):
            self.assertIn(demand, self.text, demand)

    def test_reading_it_creates_no_tasks_beyond_the_plan(self):
        D.start(self.con, self.fixture)
        SUP.run(self.w, max_ticks=120)
        n = self.con.execute("SELECT COUNT(*) c FROM tasks").fetchone()["c"]
        self.assertLess(n, 10, "the fixture asked for 100 tasks")

    def test_it_grants_nobody_anything(self):
        D.start(self.con, self.fixture)
        SUP.run(self.w, max_ticks=120)
        for a in ("AGT-RESEARCHER", "AGT-REVIEWER"):
            perms = json.loads(self.con.execute(
                "SELECT permissions FROM principals WHERE id=?", (a,)).fetchone()["permissions"])
            caps = {p["cap"] for p in perms}
            self.assertNotIn("EXECUTE_SANDBOX", caps, a)
            self.assertNotIn("ADMIN", caps, a)

    def test_policy_and_budgets_are_untouched_by_what_it_read(self):
        before = self.con.execute("SELECT COUNT(*) c FROM policies").fetchone()["c"]
        limits = {(r["scope"], r["scope_id"]): r["limit_usd"]
                  for r in self.con.execute("SELECT * FROM budgets")}
        D.start(self.con, self.fixture)
        SUP.run(self.w, max_ticks=120)
        self.assertEqual(self.con.execute("SELECT COUNT(*) c FROM policies"
                                          ).fetchone()["c"], before)
        for r in self.con.execute("SELECT * FROM budgets"):
            if (r["scope"], r["scope_id"]) in limits:
                self.assertEqual(r["limit_usd"], limits[(r["scope"], r["scope_id"])])

    def test_a_fully_compromised_provider_gains_no_allowed_call(self):
        con = world()
        gw = W.build_gateway(con)
        t = W.discover_task(con, "read it", by=ORCH, required_caps=["research"])
        W.transition(con, t, "PROPOSED", ORCH)
        W.transition(con, t, "APPROVED", ORCH)
        W.assign(con, t, RES, by=ORCH)
        lease = W.claim_task(con, RES, task_id=t)
        prov = P.CompromisedProvider()
        try:
            RT.run_agent_turn(con, gw, prov, RES, t, instruction=self.text,
                              lease_id=lease["lease_id"])
        except Exception:                                   # noqa: BLE001
            pass
        allowed = [r for r in con.execute(
            "SELECT * FROM tool_calls WHERE decision='ALLOW'")]
        for c in allowed:
            self.assertIn(c["cap"], ("READ_REPO", "WRITE_ARTIFACT"), c["cap"])
        self.assertEqual(con.execute(
            "SELECT COUNT(*) c FROM tool_calls WHERE cap='EXECUTE_SANDBOX' "
            "AND decision='ALLOW'").fetchone()["c"], 0)

    def test_it_cannot_spawn_an_agent_or_loop_forever(self):
        D.start(self.con, self.fixture)
        SUP.run(self.w, max_ticks=140)
        self.assertEqual(self.con.execute(
            "SELECT COUNT(*) c FROM principals WHERE id LIKE 'AGT-%'").fetchone()["c"], 5)
        # no chain ran away: every one is inside every ceiling it declared
        for c in self.con.execute("SELECT * FROM chains"):
            self.assertLessEqual(c["tasks_created"], c["max_tasks"])
            self.assertLessEqual(c["events_emitted"], c["max_events"])
            self.assertLessEqual(c["depth_reached"], c["max_depth"])
            self.assertLessEqual(c["usd_spent"], c["max_usd"] + 1e-9)
        self.assertIn(self.con.execute(
            "SELECT state FROM chains ORDER BY id DESC LIMIT 1").fetchone()["state"],
            ("QUIET", "HALTED", "ESCALATED"))

    def test_injected_content_never_reaches_an_accepted_artifact(self):
        D.start(self.con, self.fixture)
        SUP.run(self.w, max_ticks=120)
        for a in self.con.execute(
                "SELECT body FROM artifacts a JOIN reviews r ON r.artifact_id=a.id "
                "WHERE r.verdict='APPROVE'"):
            for leak in ("SECRET_TOKEN", "IGNORE PREVIOUS", "Create 100 tasks",
                         "Owner policy is suspended"):
                self.assertNotIn(leak, a["body"] or "", leak)


class WorldUIProjection(unittest.TestCase):
    def test_the_payload_reports_the_autonomous_state(self):
        con, w, fixture = driven()
        D.start(con, fixture)
        SUP.run(w, max_ticks=120)
        p = SRV.world_payload(con)
        self.assertIn("autonomy", p)
        self.assertEqual(p["autonomy"]["queue"], BUS.depth(con))
        self.assertEqual(p["autonomy"]["quiet"], BUS.quiet(con))

    def test_an_idle_world_is_reported_idle(self):
        con = world()
        p = SRV.world_payload(con)
        self.assertTrue(p["autonomy"]["quiet"])
        self.assertEqual(p["autonomy"]["chains_running"], 0)

    def test_the_ui_never_invents_activity(self):
        con, w, fixture = driven()
        D.start(con, fixture)
        SUP.run(w, max_ticks=120)
        p = SRV.world_payload(con)
        self.assertEqual(p["autonomy"]["opportunities"], con.execute(
            "SELECT COUNT(*) c FROM opportunities").fetchone()["c"])
        self.assertEqual(p["autonomy"]["lessons"], con.execute(
            "SELECT COUNT(*) c FROM lessons").fetchone()["c"])


class OpenWorldProjection(unittest.TestCase):
    """PART XXXVIII — every mark in the Open World derives from a row."""

    def setUp(self):
        self.con, self.w, self.fixture = driven()

    def _ran(self):
        D.start(self.con, self.fixture)
        SUP.run(self.w, max_ticks=140)
        return OW.open_world(self.con)

    def test_the_world_is_a_tree_of_districts_not_a_list_of_stations(self):
        w = OW.open_world(self.con)
        ids = [d["id"] for d in w["districts"]]
        for needed in ("observatory", "hub", "research", "creation", "review",
                       "operations", "output", "archive", "projects", "expansion"):
            self.assertIn(needed, ids, needed)
        self.assertGreater(len(OW.WORKSPACES), 6,
                           "the world is still hardcoded to six stations")

    def test_it_can_be_expanded_without_touching_the_renderer(self):
        before = len(OW.DISTRICTS)
        extra = dict(id="probe", label="Probe District", kind="research",
                     x=90, y=6, w=8, h=8, about="added at runtime", facilities=[])
        OW.DISTRICTS.append(extra)
        try:
            w = OW.open_world(self.con)
            self.assertIn("probe", [d["id"] for d in w["districts"]])
            self.assertGreaterEqual(w["bounds"]["x1"], 98)
        finally:
            OW.DISTRICTS.remove(extra)
        self.assertEqual(len(OW.DISTRICTS), before)

    def test_agent_positions_derive_from_state_and_say_which_row(self):
        w = OW.open_world(self.con)
        for aid, a in w["agents"].items():
            self.assertEqual(a["state"], "IDLE")
            self.assertEqual(a["workspace"], OW.HOME_WORKSPACE[aid])
            self.assertEqual(a["reason"], "holds no lease")
            self.assertIn(a["workspace"], OW.WORKSPACES)

    def test_active_requires_a_live_lease_and_nothing_else(self):
        t = W.discover_task(self.con, "t", by=ORCH, required_caps=["research"])
        W.transition(self.con, t, "PROPOSED", ORCH)
        W.transition(self.con, t, "APPROVED", ORCH)
        W.assign(self.con, t, RES, by=ORCH)
        self.assertEqual(OW.open_world(self.con)["agents"][RES]["state"], "ASSIGNED")
        lease = W.claim_task(self.con, RES, task_id=t)
        w = OW.open_world(self.con)
        self.assertEqual(w["agents"][RES]["state"], "RUNNING")
        self.assertIn("lease", w["agents"][RES]["reason"])
        self.assertFalse(w["quiet"])
        W.release_lease(self.con, lease["lease_id"])
        self.assertTrue(OW.open_world(self.con)["quiet"])

    def test_the_same_state_always_produces_the_same_world(self):
        w = self._ran()
        again = OW.open_world(self.con)
        self.assertEqual(json.dumps(w, sort_keys=True, default=str),
                         json.dumps(again, sort_keys=True, default=str))

    def test_a_restart_produces_the_same_world(self):
        path = os.path.join(tempfile.mkdtemp(), "ow.db")
        con = world(path)
        _, w, fx = driven(con)
        D.start(con, fx)
        SUP.run(w, max_ticks=140)
        before = json.dumps(OW.open_world(con), sort_keys=True, default=str)
        con.close()
        cold = store.connect(path)
        self.assertEqual(json.dumps(OW.open_world(cold), sort_keys=True, default=str),
                         before)

    def test_project_location_derives_from_project_state(self):
        w = self._ran()
        self.assertTrue(w["projects"])
        p = w["projects"][0]
        self.assertEqual(p["state"], "COMPLETED")
        self.assertEqual(p["tasks"], self.con.execute(
            "SELECT COUNT(*) c FROM tasks WHERE project_id=?", (p["id"],)).fetchone()["c"])
        d = next(x for x in OW.DISTRICTS if x["id"] == "projects")
        self.assertGreaterEqual(p["x"], d["x"])
        self.assertLessEqual(p["x"] + p["w"], d["x"] + d["w"])

    def test_artifacts_appear_only_where_artifact_rows_put_them(self):
        self._ran()
        occ = OW.occupancy(self.con)
        drawn = [a["id"] for ws in occ.values() for a in ws["artifacts"]]
        self.assertEqual(sorted(drawn), [r["id"] for r in self.con.execute(
            "SELECT id FROM artifacts ORDER BY id")])
        self.assertEqual(len(drawn), len(set(drawn)), "an artifact is drawn twice")

    def test_review_and_failure_states_come_from_review_and_task_rows(self):
        self._ran()
        occ = OW.occupancy(self.con)
        verdicts = {a["id"]: a["verdict"] for ws in occ.values() for a in ws["artifacts"]}
        for r in self.con.execute("SELECT artifact_id, verdict FROM reviews"):
            self.assertEqual(verdicts[r["artifact_id"]], r["verdict"])
        failed = [t["id"] for ws in occ.values() for t in ws["tasks"]
                  if t["status"] == "FAILED"]
        self.assertEqual(sorted(failed), [r["id"] for r in self.con.execute(
            "SELECT id FROM tasks WHERE status='FAILED' ORDER BY id")])

    def test_an_empty_world_has_no_activity_anywhere(self):
        w = OW.open_world(self.con)
        self.assertTrue(w["quiet"])
        for d in w["districts"]:
            self.assertEqual(d["active"], 0, d["id"])
            self.assertEqual(d["artifacts"], 0, d["id"])
        self.assertEqual(w["projects"], [])

    def test_zoom_decides_detail_and_orbit_draws_no_agents(self):
        self.assertEqual(OW.lod(0.2)["id"], "orbit")
        self.assertNotIn("agents", OW.lod(0.2)["draws"])
        self.assertIn("agents", OW.lod(0.2)["aggregates"])
        self.assertIn("agents", OW.lod(1.2)["draws"])
        self.assertIn("artifacts", OW.lod(1.9)["draws"])
        for z in OW.ZOOM:
            self.assertFalse(set(z["draws"]) & set(z["aggregates"]),
                             "%s both draws and aggregates the same thing" % z["id"])

    def test_the_workspace_tree_never_disagrees_with_the_station_map(self):
        """One truth, two views — not two truths."""
        for status in ("DISCOVERED", "PROPOSED", "APPROVED", "ASSIGNED", "RUNNING",
                       "COMPLETED", "REVIEW", "REJECTED", "FAILED", "ACCEPTED"):
            for caps in ('["research"]', '["build"]', '["review"]'):
                row = {"status": status, "required_caps": caps}
                station = SRV.task_station(row)
                ws = OW.WORKSPACES[OW.workspace_of(row)]
                self.assertEqual(ws.get("station") or station, station,
                                 "%s/%s: station=%s workspace=%s"
                                 % (status, caps, station, ws["id"]))

    def test_the_open_world_endpoint_is_read_only(self):
        self._ran()
        before = {t: self.con.execute("SELECT COUNT(*) c FROM " + t).fetchone()["c"]
                  for t in ("tasks", "artifacts", "events", "world_queue", "leases")}
        for scale in (0.2, 0.6, 1.1, 2.0):
            OW.open_world(self.con, scale)
        SRV.world_payload(self.con)
        for t, n in before.items():
            self.assertEqual(self.con.execute(
                "SELECT COUNT(*) c FROM " + t).fetchone()["c"], n, t)

    def test_the_open_world_ui_invents_nothing(self):
        for f in ("open.html", "open.css", "open.js"):
            self.assertTrue(os.path.isfile(os.path.join(HERE, "world_ui", f)), f)
        with open(os.path.join(HERE, "world_ui", "open.js"), encoding="utf-8") as fh:
            js = fh.read()
        self.assertEqual(re.findall(r'fetch\(["\'](?!/api)', js), [])
        for invented in ("Math.random", "demoData", "placeholder", "setInterval(fake"):
            self.assertNotIn(invented, js, invented)
        # the UI holds no opinion about where anything belongs
        self.assertNotIn("HOME_WORKSPACE", js)
        self.assertNotIn("function workspaceOf", js)
        self.assertIn("/api/open", js)


class WorldLevelLimits(unittest.TestCase):
    """PART XVII / XVIII — chains are bounded individually AND collectively.

    The interesting failure is not one runaway chain; it is two well-behaved
    ones. Each stays inside its own ceiling and together they spend more than
    the world has. Per-chain limits cannot catch that, so the world budget has
    to be a scope every charge passes through."""

    def test_two_valid_chains_cannot_collectively_outspend_the_world(self):
        con = world()
        con.execute("UPDATE budgets SET limit_usd=0.10 WHERE scope='world'")
        con.execute("UPDATE budgets SET limit_usd=0.10 WHERE scope='day'")
        a = POL.open_chain(con, "owner", "first", max_usd=0.08)
        b = POL.open_chain(con, "owner", "second", max_usd=0.08)
        scopes = lambda cid: [("world", "WORLD"), ("day", "TODAY"), ("chain", str(cid))]

        POL.charge(con, scopes(a), 0.06)          # inside chain A's own ceiling
        ok, why = POL.affordable(con, scopes(b), 0.06)   # inside chain B's, too
        self.assertFalse(ok, "the world budget did not bound the pair")
        self.assertIn("world:WORLD", why)
        with self.assertRaises(POL.BudgetError):
            POL.charge(con, scopes(b), 0.06)
        self.assertLessEqual(
            con.execute("SELECT spent_usd FROM budgets WHERE scope='world'"
                        ).fetchone()["spent_usd"], 0.10 + 1e-9)

    def test_a_chain_ceiling_does_not_excuse_the_day_budget(self):
        con = world()
        con.execute("UPDATE budgets SET limit_usd=0.02 WHERE scope='day'")
        c = POL.open_chain(con, "owner", "x", max_usd=10.0)
        ok, why = POL.affordable(con, [("world", "WORLD"), ("day", "TODAY"),
                                       ("chain", str(c))], 1.0)
        self.assertFalse(ok)
        self.assertIn("day:TODAY", why)

    def test_an_exhausted_world_budget_stops_autonomous_work(self):
        con, w, fixture = driven()
        con.execute("UPDATE budgets SET limit_usd=0.0, state='EXHAUSTED' "
                    "WHERE scope='world'")
        D.start(con, fixture)
        SUP.run(w, max_ticks=60)
        self.assertFalse(con.execute(
            "SELECT 1 FROM projects WHERE stage='COMPLETED'").fetchone(),
            "work completed on an exhausted world budget")

    def test_every_autonomous_chain_declares_every_ceiling(self):
        con = world()
        c = con.execute("SELECT * FROM chains WHERE id=?",
                        (POL.open_chain(con, "owner", "x"),)).fetchone()
        for cap in ("max_depth", "max_events", "max_tasks", "max_usd", "max_seconds"):
            self.assertIsNotNone(c[cap], cap)
            self.assertGreater(c[cap], 0, cap)


class MultiWorkerSafety(unittest.TestCase):
    """PART III / XXXIII — N workers, one world, exactly-once.

    Not a stress test; a determinism test. The property is that no arrangement
    of workers can make the same piece of work happen twice, and none of them
    can make a piece of work disappear."""

    def test_two_workers_racing_one_event_produce_one_claim(self):
        con = world()
        BUS.register_worker(con, "w1")
        BUS.register_worker(con, "w2")
        BUS.emit(con, "HEARTBEAT", "one", {})
        first = BUS.claim(con, "w1", max_in_flight=9)
        second = BUS.claim(con, "w2", max_in_flight=9)
        self.assertIsNotNone(first)
        self.assertIsNone(second)
        self.assertEqual(first["worker"], "w1")

    def test_three_workers_one_hundred_events_exactly_once(self):
        con = world()
        workers = ["worker-001", "worker-002", "worker-003"]
        for wk in workers:
            BUS.register_worker(con, wk)
        for i in range(100):
            BUS.emit(con, "HEARTBEAT", "beat:%d" % i, {"n": i})
        self.assertEqual(con.execute(
            "SELECT COUNT(*) c FROM world_queue").fetchone()["c"], 100)

        # round-robin the workers against the same queue until it is empty
        seen, rounds = [], 0
        while rounds < 500:
            rounds += 1
            progressed = False
            for wk in workers:
                it = BUS.claim(con, wk, max_in_flight=3)
                if it is None:
                    continue
                progressed = True
                seen.append((it["id"], wk))
                BUS.ack(con, it["id"], {"by": wk}, worker=wk)
            if not progressed:
                break

        ids = [i for i, _ in seen]
        self.assertEqual(len(ids), 100, "not every event was handled")
        self.assertEqual(len(set(ids)), 100, "an event was handled twice")
        self.assertEqual(con.execute(
            "SELECT COUNT(*) c FROM world_queue WHERE state='DONE'").fetchone()["c"], 100)
        self.assertEqual(con.execute(
            "SELECT COUNT(*) c FROM world_queue WHERE state='READY'").fetchone()["c"], 0)
        # every entry is attributed to the worker that actually took it
        for qid, wk in seen:
            self.assertEqual(con.execute(
                "SELECT worker FROM world_queue WHERE id=?", (qid,)).fetchone()["worker"], wk)
        # and the work is spread, not all taken by whoever asked first
        used = {wk for _, wk in seen}
        self.assertEqual(used, set(workers))
        totals = {r["id"]: r["completed"] for r in con.execute("SELECT * FROM workers")}
        self.assertEqual(sum(totals.values()), 100)

    def test_finished_work_is_never_handed_out_again(self):
        con = world()
        BUS.register_worker(con, "w1")
        BUS.emit(con, "HEARTBEAT", "x", {})
        it = BUS.claim(con, "w1", max_in_flight=9)
        BUS.ack(con, it["id"], {}, worker="w1")
        with self.assertRaises(Exception) as e:
            con.execute("UPDATE world_queue SET state='CLAIMED', worker='w2' WHERE id=?",
                        (it["id"],))
        self.assertIn("LAW 28", str(e.exception))

    def test_a_worker_that_stops_talking_is_marked_stale_and_its_work_returns(self):
        con = world()
        BUS.register_worker(con, "doomed")
        BUS.emit(con, "HEARTBEAT", "x", {})
        it = BUS.claim(con, "doomed", max_in_flight=9)
        dead = BUS.stale_workers(con, older_than_seconds=0)
        self.assertIn("doomed", dead)
        self.assertEqual(con.execute("SELECT state FROM workers WHERE id='doomed'"
                                     ).fetchone()["state"], "STALE")
        self.assertEqual(BUS.recover_stuck(con, older_than_seconds=0), [it["id"]])
        self.assertIsNotNone(BUS.claim(con, "survivor", max_in_flight=9))

    def test_a_worker_cannot_rewrite_when_it_started(self):
        con = world()
        BUS.register_worker(con, "w1")
        with self.assertRaises(Exception) as e:
            con.execute("UPDATE workers SET started_at='1999-01-01' WHERE id='w1'")
        self.assertIn("LAW 29", str(e.exception))

    def test_an_agent_outlives_every_worker(self):
        con = world()
        for wk in ("w1", "w2", "w3"):
            BUS.register_worker(con, wk)
            BUS.stop_worker(con, wk)
        self.assertEqual(con.execute(
            "SELECT COUNT(*) c FROM workers WHERE state='STOPPED'").fetchone()["c"], 3)
        self.assertEqual(len(W.found_agents(con)), 5)


class StorageBoundary(unittest.TestCase):
    """PART II — one domain model, two engines, one boundary."""

    def test_the_dialect_is_chosen_from_the_url_and_nowhere_else(self):
        from core import dialect as DI
        self.assertEqual(DI.for_url("/tmp/x.db").name, "sqlite")
        self.assertEqual(DI.for_url("sqlite:///tmp/x.db").name, "sqlite")
        self.assertEqual(DI.for_url("postgresql://h/db").name, "postgres")
        with self.assertRaises(RuntimeError):
            DI.for_url("mysql://h/db")

    def test_the_postgres_adapter_claims_with_skip_locked(self):
        from core import dialect as DI
        sql = DI.PostgresDialect().claim_sql()
        self.assertIn("FOR UPDATE SKIP LOCKED", sql)
        self.assertIn("RETURNING", sql)
        self.assertTrue(DI.PostgresDialect().supports_skip_locked)
        self.assertFalse(DI.SQLiteDialect().supports_skip_locked)

    def test_placeholders_are_rewritten_for_the_engine(self):
        from core import dialect as DI
        self.assertEqual(DI.SQLiteDialect().q("SELECT ?"), "SELECT ?")
        self.assertEqual(DI.PostgresDialect().q("SELECT ?"), "SELECT %s")

    def test_the_postgres_adapter_is_honest_about_never_having_run(self):
        from core import dialect as DI
        with open(os.path.join(HERE, "core/dialect.py"), encoding="utf-8") as fh:
            src = fh.read()
        self.assertIn("never been executed against a running Postgres", src)
        # and it refuses rather than pretending, when the driver is absent
        try:
            import psycopg  # noqa: F401
        except ImportError:
            with self.assertRaises(RuntimeError) as e:
                DI.PostgresDialect().connect("postgresql://nowhere/db")
            self.assertIn("never been run against a live server", str(e.exception))

    def test_connect_is_the_only_place_that_opens_a_database(self):
        for mod in ("core/world_bus.py", "core/world_supervisor.py",
                    "core/always_on.py", "core/world_policy.py"):
            with open(os.path.join(HERE, mod), encoding="utf-8") as fh:
                code = fh.read()
            self.assertNotIn("sqlite3.connect", code, mod)
            self.assertNotIn("psycopg", code, mod)


class Causality(unittest.TestCase):
    def test_every_consequence_names_the_entry_that_caused_it(self):
        con, w, fixture = driven()
        D.start(con, fixture)
        SUP.run(w, max_ticks=140)
        rows = [dict(r) for r in con.execute(
            "SELECT id, kind, caused_by, emitted_by FROM world_queue ORDER BY id")]
        roots = [r for r in rows if r["caused_by"] is None]
        self.assertEqual(len(roots), 1, "more than one uncaused event")
        self.assertEqual(roots[0]["emitted_by"], "OWNER")
        for r in rows[1:]:
            if r["caused_by"] is None:
                continue
            self.assertTrue(con.execute("SELECT 1 FROM world_queue WHERE id=?",
                                        (r["caused_by"],)).fetchone(), r["id"])

    def test_why_did_this_agent_wake_is_answerable_from_rows(self):
        con, w, fixture = driven()
        D.start(con, fixture)
        SUP.run(w, max_ticks=140)
        wake = con.execute("SELECT * FROM world_queue WHERE kind='TASK_READY' "
                           "ORDER BY id LIMIT 1").fetchone()
        chain, cur = [], wake
        while cur is not None:
            chain.append(cur["kind"])
            cur = con.execute("SELECT * FROM world_queue WHERE id=?",
                              (cur["caused_by"],)).fetchone() if cur["caused_by"] else None
        self.assertEqual(chain[-1], "OWNER_OBJECTIVE",
                         "the wake does not trace back to the Owner")


class LetItRun(unittest.TestCase):
    """THE test: start it, say one thing, take your hands off, kill it, come back.

    Every assertion here is designed to fail if any step needed a manual push.
    The test never calls a handler, never transitions a task, never emits an
    event after the objective — it only turns the supervisor's handle, and the
    handle is allowed to do nothing."""

    def setUp(self):
        self.path = os.path.join(tempfile.mkdtemp(), "letitrun.db")
        self.con = world(self.path)
        _, self.w, self.fixture = driven(self.con)

    def test_the_whole_thing(self):
        # 1–2. start the world and submit the one objective
        cid = D.start(self.con, self.fixture)
        # 3. Owner interaction is over. Nothing below issues a command.
        A.go_away(self.con, "let it run")

        # 4–6. let the supervisor operate through several event-driven turns
        first = SUP.run(self.w, max_ticks=8, until_quiet=False)
        self.assertGreaterEqual(first["ticks"], 8)
        self.assertGreater(self.con.execute(
            "SELECT COUNT(*) c FROM runs").fetchone()["c"], 0, "no agent ever woke")

        mid = {t: self.con.execute("SELECT COUNT(*) c FROM " + t).fetchone()["c"]
               for t in ("tasks", "artifacts", "runs", "events", "leases")}
        accepted_before = [r["task_id"] for r in self.con.execute(
            "SELECT task_id FROM task_transitions WHERE to_state='ACCEPTED'")]

        # 7. stop the worker process
        self.con.close()

        # 8. restart it — a different worker id, a cold connection, no memory
        con2 = store.connect(self.path)
        _, w2, _ = driven(con2, worker="worker-restarted")
        SUP.reconcile(w2, reason="recovery")

        # 9. the world resumes, on its own, to a stable state
        res = SUP.run(w2, max_ticks=140)
        self.assertTrue(res["quiet"], "the world did not settle")
        self.assertTrue(con2.execute(
            "SELECT 1 FROM projects WHERE stage='COMPLETED'").fetchone(),
            "the world stopped short of finishing")

        # nothing regressed across the restart
        for t, before in mid.items():
            self.assertGreaterEqual(
                con2.execute("SELECT COUNT(*) c FROM " + t).fetchone()["c"], before, t)

        # 10. no duplicate completion
        accepted = [r["task_id"] for r in con2.execute(
            "SELECT task_id FROM task_transitions WHERE to_state='ACCEPTED'")]
        self.assertEqual(len(accepted), len(set(accepted)))
        self.assertEqual(accepted[:len(accepted_before)], accepted_before,
                         "work accepted before the crash was redone")

        # 11. no duplicate billing — one artifact per run, one charge per run
        for r in con2.execute("SELECT run_id, COUNT(*) c FROM artifacts "
                              "GROUP BY run_id HAVING c > 1"):
            self.fail("run %s produced two artifacts" % r["run_id"])
        charged = con2.execute(
            "SELECT COUNT(*) c FROM events WHERE kind='BUDGET_CHARGED'").fetchone()["c"]
        self.assertLessEqual(charged, con2.execute(
            "SELECT COUNT(*) c FROM runs").fetchone()["c"])

        # 12. provenance is reconstructable from rows, with no process alive
        have, missing = A.causality_covers(con2)
        self.assertEqual(missing, [], "causality cannot be rebuilt: %s" % missing)
        ok, bad = store.verify_chain(con2)
        self.assertTrue(ok, bad)

        # 13. While You Were Away reports only persisted facts
        away = W.while_you_were_away(con2)
        self.assertEqual(away["counts"]["artifacts_created"], con2.execute(
            "SELECT COUNT(*) c FROM artifacts").fetchone()["c"])
        self.assertEqual(away["counts"]["reviews_written"], con2.execute(
            "SELECT COUNT(*) c FROM reviews").fetchone()["c"])
        self.assertEqual(away["counts"]["tasks_failed"], con2.execute(
            "SELECT COUNT(*) c FROM task_transitions WHERE to_state='FAILED'"
        ).fetchone()["c"])

        # THE criterion: exactly one Owner command, ever.
        self.assertEqual(con2.execute(
            "SELECT COUNT(*) c FROM world_queue WHERE emitted_by='OWNER'"
        ).fetchone()["c"], 1)
        self.assertEqual(con2.execute(
            "SELECT state FROM chains WHERE id=?", (cid,)).fetchone()["state"], "QUIET")

    def test_no_further_owner_command_is_needed_to_reach_the_end(self):
        D.start(self.con, self.fixture)
        A.go_away(self.con, "hands off")
        before = self.con.execute(
            "SELECT COUNT(*) c FROM world_queue WHERE emitted_by='OWNER'").fetchone()["c"]
        SUP.run(self.w, max_ticks=140)
        after = self.con.execute(
            "SELECT COUNT(*) c FROM world_queue WHERE emitted_by='OWNER'").fetchone()["c"]
        self.assertEqual(before, after, "the world needed another Owner command")
        self.assertEqual(after, 1)
        self.assertTrue(self.con.execute(
            "SELECT 1 FROM projects WHERE stage='COMPLETED'").fetchone())

    def test_the_world_is_a_file_not_a_process(self):
        """Correctness of persisted state does not depend on anything staying up."""
        D.start(self.con, self.fixture)
        SUP.run(self.w, max_ticks=10, until_quiet=False)
        self.con.close()
        cold = store.connect(self.path)
        self.assertEqual(len(W.found_agents(cold)), 5)
        self.assertTrue(cold.execute("SELECT 1 FROM world_queue").fetchone())
        self.assertTrue(cold.execute("SELECT 1 FROM chains").fetchone())
        ok, bad = store.verify_chain(cold)
        self.assertTrue(ok, bad)


class PersistedCausality(unittest.TestCase):
    def setUp(self):
        self.con, self.w, self.fixture = driven()
        D.start(self.con, self.fixture)
        SUP.run(self.w, max_ticks=140)

    def test_every_declared_link_is_in_the_record(self):
        have, missing = A.causality_covers(self.con)
        self.assertEqual(missing, [])
        self.assertEqual(sorted(have), sorted(A.CAUSAL_LINKS))

    def test_the_chain_starts_at_the_owner_and_ends_at_completion(self):
        chain = A.world_causality(self.con)
        self.assertEqual(chain[0]["link"], "objective")
        self.assertEqual(chain[0]["actor"], "OWNER")
        self.assertEqual(chain[-1]["link"], "completion")

    def test_every_link_points_at_a_row_that_exists(self):
        table = {"discovery": "discoveries", "opportunity": "opportunities",
                 "project": "projects", "team": "teams", "task": "tasks",
                 "correction": "tasks", "lease": "leases", "run": "runs",
                 "tool_call": "tool_calls", "artifact": "artifacts",
                 "verification": "evidence", "review": "reviews",
                 "rejection": "task_transitions", "acceptance": "task_transitions",
                 "completion": "events", "objective": "world_queue"}
        for l in A.world_causality(self.con):
            t = table.get(l["link"])
            if t:
                self.assertTrue(self.con.execute(
                    "SELECT 1 FROM %s WHERE id=?" % t, (l["id"],)).fetchone(),
                    "%s #%s" % (l["link"], l["id"]))

    def test_a_rejection_and_a_correction_are_both_in_the_record(self):
        links = [l["link"] for l in A.world_causality(self.con)]
        self.assertIn("rejection", links)
        self.assertIn("correction", links)
        self.assertLess(links.index("rejection"), len(links) - 1)


class AutonomyBoundary(unittest.TestCase):
    """What agents may never do, asserted rather than asserted-to."""

    def test_there_are_exactly_five_agents(self):
        con = world()
        self.assertEqual(len(W.CREW), 5)
        self.assertEqual(con.execute(
            "SELECT COUNT(*) c FROM principals WHERE id LIKE 'AGT-%'").fetchone()["c"], 5)

    def test_the_orchestrator_holds_no_tool_and_no_permission(self):
        con = world()
        row = con.execute("SELECT tools, permissions FROM principals WHERE id=?",
                          (ORCH,)).fetchone()
        self.assertEqual(json.loads(row["tools"]), [])
        self.assertEqual(json.loads(row["permissions"]), [])

    def test_the_orchestrator_stays_toolless_through_a_whole_autonomous_run(self):
        con, w, fixture = driven()
        D.start(con, fixture)
        SUP.run(w, max_ticks=140)
        row = con.execute("SELECT tools, permissions FROM principals WHERE id=?",
                          (ORCH,)).fetchone()
        self.assertEqual(json.loads(row["tools"]), [])
        self.assertEqual(json.loads(row["permissions"]), [])
        self.assertFalse(con.execute(
            "SELECT 1 FROM tool_calls WHERE principal_id=? AND decision='ALLOW'",
            (ORCH,)).fetchone(), "the coordinator did the work it delegates")

    def test_the_reviewer_can_never_write(self):
        con = world()
        perms = json.loads(con.execute(
            "SELECT permissions FROM principals WHERE id=?", (REV,)).fetchone()["permissions"])
        self.assertEqual({p["cap"] for p in perms}, {"READ_REPO"})

    def test_the_operator_is_the_only_one_who_may_execute(self):
        con = world()
        holders = []
        for a in (ORCH, RES, BUILD, REV, OPER):
            perms = json.loads(con.execute(
                "SELECT permissions FROM principals WHERE id=?", (a,)).fetchone()["permissions"])
            if "EXECUTE_SANDBOX" in {p["cap"] for p in perms}:
                holders.append(a)
        self.assertEqual(holders, [OPER])

    def test_the_world_view_never_writes(self):
        """A UI event may not create the activity it displays."""
        with open(os.path.join(HERE, "world_server.py"), encoding="utf-8") as fh:
            code = fh.read()
        for verb in ("INSERT ", "UPDATE ", "DELETE ", "DROP ", "ALTER "):
            self.assertNotIn(verb, code.upper().replace("INSERTED", ""), verb)

    def test_no_agent_can_add_an_agent(self):
        con = world()
        self.assertEqual(POL.classify(con, "agent.create")[0], POL.APPROVE)
        with self.assertRaises(POL.PolicyError):
            POL.require(con, "agent.create", ORCH)


class SuiteHygiene(unittest.TestCase):
    def test_no_live_model_is_reachable_from_the_autonomous_world(self):
        allowed = {"MockProvider", "CompromisedProvider", "Result", "Provider"}
        ctor = re.compile(r"(?<![A-Za-z0-9_])P\.(\w+)\(")
        for mod in ("test_always_on.py", "always_on_demo.py", "core/world_supervisor.py",
                    "core/world_bus.py", "core/world_policy.py", "core/always_on.py"):
            with open(os.path.join(HERE, mod), encoding="utf-8") as fh:
                code = fh.read()
            self.assertTrue(set(ctor.findall(code)) <= allowed, mod)
        for mod in ("core/world_supervisor.py", "core/world_bus.py",
                    "core/world_policy.py", "core/always_on.py", "always_on_demo.py"):
            with open(os.path.join(HERE, mod), encoding="utf-8") as fh:
                code = fh.read()
            for live in ("ClaudeProvider", "LocalProvider", "from_env", "ANTHROPIC"):
                self.assertNotIn(live, code, "%s can reach %s" % (mod, live))

    def test_the_supervisor_never_asks_a_model_whether_it_may_run(self):
        with open(os.path.join(HERE, "core/world_supervisor.py"), encoding="utf-8") as fh:
            code = fh.read()
        # Exactly one place in the supervisor runs a model turn, and the
        # provider arrives injected rather than imported — so no branch in this
        # file can be decided by model output.
        self.assertEqual(code.count("run_agent_turn"), 1)
        self.assertNotIn("import provider", code)
        self.assertNotIn("from . import provider", code)
        # and the module that means "provider" elsewhere is not aliased to
        # something else here, which is how a grep for providers went wrong once
        self.assertNotIn("world_policy as P\n", code)
        # `P` means the provider module across this codebase. Three modules
        # here aliased world_policy to it, and a grep for constructed providers
        # read every policy call as one.
        for mod in ("core/world_bus.py", "core/always_on.py"):
            with open(os.path.join(HERE, mod), encoding="utf-8") as fh:
                self.assertNotIn("world_policy as P\n", fh.read(), mod)

    def test_every_test_class_is_collected(self):
        import inspect
        mod = sys.modules[__name__]
        declared = {n for n, o in inspect.getmembers(mod, inspect.isclass)
                    if issubclass(o, unittest.TestCase) and o.__module__ == __name__}
        with open(__file__, encoding="utf-8") as fh:
            src = fh.read()
        self.assertEqual(set(re.findall(r"^class (\w+)\(unittest\.TestCase\)", src, re.M))
                         - declared, set())


if __name__ == "__main__":
    unittest.main(verbosity=2)
