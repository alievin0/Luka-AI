#!/usr/bin/env python3
"""THE FIRST AUTONOMOUS PROJECT.  python3 test_first_project.py

`first_project.py` asks whether the world can take something it noticed, decide
it is worth doing, ask a person once, and then carry a project to an outcome
without being told the steps. That run needs a model. Everything about the SHAPE
of it does not, and this suite is the shape:

    the opportunity is judged by whoever the world was built with, and a verdict
    that is neither APPROVE nor REJECT escalates rather than defaulting;
    an approved opportunity STOPS and asks, and cannot answer itself;
    an undecided proposal stays undecided however many times the world ticks;
    the Owner's one word — and only the Owner's — carries it forward;
    and after that word the Owner issues nothing at all.

The default is unchanged and there is a test that says so: a world built without
a gate opens its project exactly as it always did.

No model is called and nothing is spent.
"""
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import agent_world as W            # noqa: E402
from core import always_on as A              # noqa: E402
from core import store                       # noqa: E402
from core import world_bus as BUS            # noqa: E402
from core import world_policy as POL         # noqa: E402
from core import world_supervisor as SUP     # noqa: E402
import first_project as FP                   # noqa: E402
import real_agent_demo as D                  # noqa: E402

SOURCE = os.path.join(HERE, "AGENT_WORLD_SERVER.md")
OWNER_HUMAN = "OWNER"


def world(gate=True, evaluate_for=None, review_for=None):
    con = store.connect(os.path.join(tempfile.mkdtemp(), "fp.db"))
    store.found(con, mode="simulation")
    W.found_agents(con)
    POL.seed(con)
    w = SUP.World(con, W.build_gateway(con), provider_for=D.provider_for,
                  requirements_for=D.requirements_for,
                  instruction_for=D.instruction_for,
                  evaluate_for=evaluate_for, review_for=review_for,
                  gate_for=FP.owner_gate if gate else None, worker="test-fp")
    return con, w


def objective(con):
    return BUS.emit(con, "OWNER_OBJECTIVE", "objective:1",
                    {"objective": "Establish what this world can prove about "
                                  "itself, with evidence.",
                     "fixture": SOURCE, "required_caps": ["research", "build"],
                     "interpretation": json.dumps(FP.FRAMING)},
                    by=OWNER_HUMAN)


def approvals(con):
    return [dict(r) for r in con.execute("SELECT * FROM approvals ORDER BY id")]


def projects(con):
    return [dict(r) for r in con.execute("SELECT * FROM projects ORDER BY id")]


# ── 1. who judges the opportunity ────────────────────────────────────
class TheOpportunityIsJudgedByWhoeverTheWorldWasBuiltWith(unittest.TestCase):

    def test_the_default_is_the_worlds_own_rules(self):
        con, w = world(gate=False)
        self.assertIs(w.evaluate_for, SUP.deterministic_evaluation)
        objective(con)
        SUP.run(w, max_ticks=200)
        self.assertTrue(projects(con), "the default path stopped opening projects")

    def test_a_refusal_stops_the_world_and_is_recorded(self):
        con, w = world(evaluate_for=lambda w, oid, chain_id=None:
                       ("REJECTED", ["not worth the calls"], None))
        objective(con)
        SUP.run(w, max_ticks=200)
        self.assertEqual(projects(con), [], "a refused opportunity became a project")
        o = con.execute("SELECT * FROM opportunities ORDER BY id LIMIT 1").fetchone()
        self.assertEqual(o["status"], "REJECTED")
        self.assertEqual(approvals(con), [], "a refused opportunity asked the Owner")

    def test_an_unreadable_verdict_escalates_rather_than_defaulting(self):
        con, w = world(evaluate_for=lambda w, oid, chain_id=None:
                       (None, "the evaluator answered without a verdict", None))
        objective(con)
        SUP.run(w, max_ticks=200)
        self.assertEqual(projects(con), [])
        self.assertTrue(any("evaluator returned no usable verdict" in s["headline"]
                            for s in con.execute("SELECT * FROM signals")),
                        "nobody was told the opportunity could not be judged")

    def test_the_evaluation_can_cite_a_model_run(self):
        """The supervisor takes a run id from the evaluator and does not care
        where it came from."""
        seen = {}

        def evaluate(w, oid, chain_id=None):
            seen["oid"] = oid
            return "APPROVED", "it is worth doing", 4242

        con, w = world(evaluate_for=evaluate)
        objective(con)
        res = SUP.run(w, max_ticks=200)
        self.assertIn("oid", seen)
        runs = [s["result"].get("run") for s in res["steps"]
                if s["kind"] == "OPPORTUNITY_PROPOSED"]
        self.assertEqual(runs, [4242])


# ── 2. the gate ──────────────────────────────────────────────────────
class TheWorldProposesAndThenStops(unittest.TestCase):

    def run_to_the_question(self, **kw):
        con, w = world(evaluate_for=lambda w, oid, chain_id=None:
                       ("APPROVED", "worth doing", None), **kw)
        objective(con)
        SUP.run(w, max_ticks=200)
        return con, w

    def test_an_approved_opportunity_asks_before_it_becomes_work(self):
        con, _ = self.run_to_the_question()
        rows = approvals(con)
        self.assertEqual(len(rows), 1, "the world did not stop to ask")
        self.assertIsNone(rows[0]["decision"])
        self.assertEqual(projects(con), [],
                         "the world opened a project without being told to")
        self.assertEqual(
            [t["id"] for t in con.execute("SELECT id FROM tasks WHERE project_id IS NOT NULL")],
            [], "tasks exist for a project nobody approved")

    def test_ticking_again_does_not_answer_the_question(self):
        con, w = self.run_to_the_question()
        for _ in range(3):
            SUP.run(w, max_ticks=50)
            self.assertIsNone(approvals(con)[0]["decision"])
            self.assertEqual(projects(con), [])

    def test_housekeeping_does_nothing_while_it_is_unanswered(self):
        con, w = self.run_to_the_question()
        self.assertEqual(SUP.resume_if_the_owner_decided(w), [])
        self.assertEqual(projects(con), [])

    def test_the_question_names_the_evidence_it_rests_on(self):
        con, _ = self.run_to_the_question()
        self.assertIsNotNone(approvals(con)[0]["evidence_id"],
                             "the Owner was asked to decide with no evidence cited")


# ── 3. the Owner's one word ──────────────────────────────────────────
class OnlyTheOwnerCarriesIt(unittest.TestCase):

    def answered(self, verdict):
        con, w = world(evaluate_for=lambda w, oid, chain_id=None:
                       ("APPROVED", "worth doing", None))
        objective(con)
        SUP.run(w, max_ticks=200)
        aid = approvals(con)[0]["id"]
        mark_q = con.execute("SELECT COALESCE(MAX(id),0) m FROM world_queue").fetchone()["m"]
        FP.owner_answers(con, aid, verdict)
        A.go_away(con, "unattended from here")
        carried = SUP.resume_if_the_owner_decided(w)
        SUP.run(w, max_ticks=200)
        return con, w, mark_q, carried

    def test_an_approval_becomes_a_project_the_world_opened(self):
        con, _, _, carried = self.answered("APPROVE")
        self.assertEqual(carried, [{"opportunity": 1, "decision": "APPROVE"}])
        self.assertTrue(projects(con), "the approval did not become a project")
        self.assertTrue([t for t in con.execute("SELECT * FROM tasks WHERE project_id IS NOT NULL")],
                        "a project with no tasks is not a decomposition")

    def test_a_refusal_ends_it_and_opens_nothing(self):
        con, _, _, carried = self.answered("REJECT")
        self.assertEqual(carried, [{"opportunity": 1, "decision": "REJECT"}])
        self.assertEqual(projects(con), [])
        o = con.execute("SELECT * FROM opportunities ORDER BY id LIMIT 1").fetchone()
        self.assertEqual(o["status"], "REJECTED")
        self.assertIn("Owner answered", o["decision_why"])

    def test_the_owner_issues_nothing_after_answering(self):
        con, _, mark_q, _ = self.answered("APPROVE")
        after = [dict(r) for r in con.execute(
            "SELECT * FROM world_queue WHERE emitted_by=? AND id>?",
            (OWNER_HUMAN, mark_q))]
        self.assertEqual(after, [], "the Owner kept giving orders after approving")

    def test_carrying_it_forward_is_not_the_owners_act(self):
        """The event that turns the decision into a project is the world's."""
        con, _, mark_q, _ = self.answered("APPROVE")
        row = con.execute("SELECT * FROM world_queue WHERE kind='OPPORTUNITY_APPROVED' "
                          "ORDER BY id LIMIT 1").fetchone()
        self.assertIsNotNone(row)
        self.assertNotEqual(row["emitted_by"], OWNER_HUMAN)
        self.assertEqual(row["emitted_by"], SUP.OWNER)      # the control plane
        self.assertIsNotNone(row["caused_by"], "it names nothing as its cause")

    def test_it_is_carried_once_however_often_housekeeping_runs(self):
        con, w, _, _ = self.answered("APPROVE")
        before = len(projects(con))
        for _ in range(3):
            SUP.resume_if_the_owner_decided(w)
            SUP.run(w, max_ticks=50)
        self.assertEqual(len(projects(con)), before, "the project was opened twice")

    def test_the_decision_row_is_the_only_place_the_answer_lives(self):
        con, _, _, _ = self.answered("APPROVE")
        deciders = [r["actor"] for r in con.execute(
            "SELECT actor FROM events WHERE kind='OWNER_DECIDED'")]
        self.assertEqual(deciders, [OWNER_HUMAN],
                         "something other than the Owner answered")


# ── 4. the whole slice, deterministically ────────────────────────────
class TheProjectRunsItselfToAnOutcome(unittest.TestCase):
    """The same path `first_project.py` walks, with doubles where the model
    would be. It proves the wiring, and says nothing about reasoning."""

    def setUp(self):
        self.con, self.w = world(evaluate_for=lambda w, oid, chain_id=None:
                                 ("APPROVED", "worth doing", None))
        objective(self.con)
        SUP.run(self.w, max_ticks=200)
        self.aid = approvals(self.con)[0]["id"]
        FP.owner_answers(self.con, self.aid, "APPROVE")
        A.go_away(self.con, "unattended")
        SUP.resume_if_the_owner_decided(self.w)
        SUP.run(self.w, max_ticks=300)
        self.pid = projects(self.con)[0]["id"]
        self.book = FP.passport(self.con, self.pid, 1)

    def test_the_team_covers_the_required_capabilities(self):
        need = set(self.book["opportunity"]["required_caps"])
        covered = set()
        for m in self.book["team"]:
            covered |= set(m["seat"].split(","))
        self.assertTrue(need <= covered, "%s does not cover %s" % (covered, need))

    def test_the_task_graph_has_real_edges(self):
        self.assertTrue(self.book["task_graph"])
        for edge in self.book["task_graph"]:
            self.assertNotEqual(edge["task"], edge["depends_on"])

    def test_artifacts_verification_and_review_all_happened(self):
        self.assertTrue(self.book["artifacts"])
        self.assertTrue(self.book["verifications"])
        self.assertTrue(self.book["reviews"])

    def test_the_reviewer_produced_none_of_the_work(self):
        self.assertNotIn(SUP.REV, {a["by"] for a in self.book["artifacts"]})

    def test_the_passport_carries_every_section(self):
        for key in ("opportunity", "opportunity_evidence", "approval", "team",
                    "tasks", "task_graph", "artifacts", "verifications",
                    "reviews", "corrections", "lessons", "completion",
                    "unresolved", "status"):
            self.assertIn(key, self.book)
        self.assertTrue(self.book["opportunity"]["framing"]["origin"]
                        .startswith("INTERNALLY DERIVED"),
                        "the opportunity does not say where it came from")
        self.assertEqual([a["decision"] for a in self.book["approval"]], ["APPROVE"])

    def test_every_lesson_names_the_failure_it_came_from(self):
        for l in self.book["lessons"]:
            self.assertTrue(l["failure"], "a lesson with no failure under it")
            self.assertTrue(l["task"] or l["project"])

    def test_completion_is_computed_not_assumed(self):
        self.assertIn(self.book["completion"]["state"],
                      ("COMPLETE", "INCOMPLETE", "FAILED", "QUOTA_EXHAUSTED"))
        if self.book["completion"]["state"] != "COMPLETE":
            self.assertTrue(self.book["completion"]["accounted"],
                            "unfinished, and nothing in the record says why")

    def test_provenance_rebuilds_the_chain_from_rows(self):
        chain = A.world_causality(self.con)
        kinds = {l["link"] for l in chain}
        for link in ("objective", "discovery", "opportunity", "project", "team"):
            self.assertIn(link, kinds)

    def test_the_owner_never_authored_the_work(self):
        authored = [dict(r) for r in self.con.execute(
            "SELECT * FROM world_queue WHERE emitted_by=?", (OWNER_HUMAN,))]
        self.assertEqual([r["kind"] for r in authored], ["OWNER_OBJECTIVE"],
                         "the Owner put something other than the objective on the queue")


if __name__ == "__main__":
    unittest.main(verbosity=2)
