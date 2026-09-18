#!/usr/bin/env python3
"""THE REVIEWER'S VERDICT.  python3 test_multi_agent.py

`real_world_demo.py` lets a real model be the Reviewer. That puts one sentence
of free text between a model's judgement and a row in `reviews` reading APPROVE
or REJECT, and what can go wrong with the arrangement goes wrong in that
sentence. This suite pins both ends of it.

The rule is narrow on purpose: **the verdict is the first word, or it is not
there.** A parser that searches the whole answer for either word looks like the
more forgiving one and is measurably worse —

    "I see no reason to REJECT this work, so: APPROVE"

— an approval, in plain English, that a searching parser records as a
rejection. That exact sentence is a test below. It was a real defect in this
file before it was a test.

Reading one word instead cannot make that mistake, and the price is that an
answer in some other shape yields no verdict at all. That is the right price:
the supervisor escalates to a person rather than picking a side, which is what
"the reviewer did not answer the question" actually means. The second part of
the suite checks that it does.

The third part is about a different way to be wrong: reporting a finish that
never happened. A run whose reviewer ran out of quota left a task RUNNING and an
artifact unreviewed, and twenty passing checks carried it along as though it had
completed. `completion_state` computes what actually happened from rows, in four
states — COMPLETE, INCOMPLETE, FAILED, QUOTA_EXHAUSTED — and the verdict line
now carries it, so the verdict cannot be quoted without it.

No model is called, no network is touched, and nothing is spent.
"""
import io
import os
import sqlite3
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import agent_world as W            # noqa: E402
from core import store                       # noqa: E402
from core import world_bus as BUS            # noqa: E402
from core import world_policy as POL         # noqa: E402
from core import world_supervisor as SUP     # noqa: E402
import real_agent_demo as D                  # noqa: E402
import real_world_demo as RWD                # noqa: E402

SOURCE = os.path.join(HERE, "AGENT_WORLD_SERVER.md")
OBJECTIVE = ("Establish what this world can already prove about itself, "
             "with evidence.")


def ran(review_for=None, ticks=200):
    """One objective and then silence, with the Reviewer's verdict injected.

    The rest of the world is `real_agent_demo` — deterministic, offline, and
    unchanged — because the question here is what the supervisor does with a
    verdict, not where the verdict came from."""
    con = store.connect(os.path.join(tempfile.mkdtemp(), "mav.db"))
    store.found(con, mode="simulation")
    W.found_agents(con)
    POL.seed(con)
    w = SUP.World(con, W.build_gateway(con), provider_for=D.provider_for,
                  requirements_for=D.requirements_for,
                  instruction_for=D.instruction_for, review_for=review_for)
    BUS.emit(con, "OWNER_OBJECTIVE", "objective:1",
             {"objective": OBJECTIVE, "fixture": SOURCE,
              "required_caps": ["research", "build"]}, by="OWNER")
    SUP.run(w, max_ticks=ticks)
    return con, w


def reviews(con):
    return [dict(r) for r in
            con.execute("SELECT id,artifact_id,verdict,rationale FROM reviews")]


def signals(con):
    return [(r["priority"], r["headline"], r["detail"])
            for r in con.execute("SELECT * FROM signals")]



QUOTA_RUN = (
    "INSERT INTO runs(principal_id,task_id,source,provider,model,prompt_sha,status,"
    "tokens_in,tokens_out,usd,latency_ms,error,started_at) VALUES"
    "(?,1,'mock','g','x','abc','FAILED',0,0,0,12,?,'now')")


def silent_reviewer(w, art, task, ver, unmet):
    """A reviewer that answers without deciding. The supervisor escalates."""
    return None, "the reviewer answered without a verdict", None


# ── 1. reading one word ──────────────────────────────────────────────
class TheVerdictIsTheFirstWord(unittest.TestCase):

    def test_the_misreading_that_started_this(self):
        """The sentence that a searching parser gets backwards."""
        said = "I see no reason to REJECT this work, so: APPROVE"
        self.assertIsNone(RWD._verdict_in(said),
                          "an answer that opens with neither word is not a verdict")
        self.assertNotEqual(RWD._verdict_in(said), "REJECT",
                            "the reviewer approved; this must never read as a rejection")

    def test_an_answer_that_opens_with_the_verdict_is_read(self):
        for said, want in (
                ("APPROVE", "APPROVE"),
                ("APPROVE. Every requirement is met.", "APPROVE"),
                ("APPROVED — the sources check out.", "APPROVE"),
                ("**APPROVE** the artifact is acceptable work.", "APPROVE"),
                ("  \n\n  approve, with one small reservation", "APPROVE"),
                ("REJECT", "REJECT"),
                ("REJECT: the summary cites nothing.", "REJECT"),
                ("Rejected. The third heading is empty.", "REJECT"),
                ("> REJECT — this does not meet the bar", "REJECT"),
                ('"REJECT" is my verdict.', "REJECT")):
            with self.subTest(said=said):
                self.assertEqual(RWD._verdict_in(said), want)

    def test_a_word_reached_later_in_the_sentence_is_not_a_verdict(self):
        """Both words appear in ordinary reasoning about a verdict."""
        for said in (
                "The work is sound and I would not REJECT it.",
                "My verdict: APPROVE",
                "Verdict: REJECT",
                "After reading the artifact I APPROVE of it.",
                "This does not clear the bar, so I must REJECT it.",
                "Neither APPROVE nor REJECT applies until I can see the source."):
            with self.subTest(said=said):
                self.assertIsNone(RWD._verdict_in(said))

    def test_an_answer_in_no_shape_at_all_is_no_verdict(self):
        for said in ("", None, "   \n\t ", "MAYBE", "LGTM", "I could not read the file.",
                     "*", "42", "الموافقة"):
            with self.subTest(said=said):
                self.assertIsNone(RWD._verdict_in(said))

    def test_only_the_two_verdicts_come_out_of_it(self):
        """Whatever goes in, what comes out is one of two words or nothing."""
        for said in ("APPROVE now", "REJECTED outright", "approval", "rejection",
                     "APPROVEMENT", "Rejecting this", None):
            with self.subTest(said=said):
                self.assertIn(RWD._verdict_in(said), (None,) + RWD.VERDICTS)

    def test_the_prompt_asks_for_exactly_what_is_parsed(self):
        """The rule the Reviewer is given and the rule that reads it back are
        one string, so the two cannot drift apart in a later edit."""
        import inspect
        src = inspect.getsource(RWD.gemini_review)
        self.assertIn("VERDICT_RULE", src,
                      "the reviewer's prompt states the rule in its own words")
        self.assertIn("FIRST word", RWD.VERDICT_RULE)
        # And an answer in the shape the rule describes is one the parser reads.
        self.assertEqual(RWD._verdict_in("APPROVE, because the bar is met"),
                         "APPROVE")


# ── 2. reading the handoff ───────────────────────────────────────────
class TheHandoffIsMeasuredAgainstWhatTheAgentWasGiven(unittest.TestCase):
    """The demo asks whether the Researcher's message carried its own result.

    The evidence is vocabulary the message shares with the artifact — minus the
    briefing, because words the agent was handed are not evidence that it
    worked. The check claimed that subtraction in its comment and did not do it,
    so a message that restated its instructions scored as one that had."""

    ARTIFACT = ("The document asserts that no model is reachable in this "
                "environment. That assertion is dated and is now superseded.")
    BRIEFING = ("Establish what AGENT_COGNITION.md claims about whether a model "
                "can drive this world, and whether that claim still holds.")

    def shared(self, message):
        return ((RWD._distinctive(message) & RWD._distinctive(self.ARTIFACT))
                - RWD._distinctive(self.BRIEFING))

    def test_an_acknowledgement_does_not_pass_for_a_result(self):
        ack = ("I have finished establishing what the document claims about "
               "whether a model can drive this world.")
        self.assertLess(len(self.shared(ack)), 4)

    def test_a_message_that_carries_the_result_does(self):
        said = ("The document asserts that no model is reachable in this "
                "environment; that assertion is superseded.")
        self.assertGreaterEqual(len(self.shared(said)), 4)

    def test_the_briefing_is_what_gets_subtracted(self):
        """Every word of the objective is a word the agent was given."""
        self.assertEqual(self.shared(self.BRIEFING), set())

    def test_short_words_are_not_evidence(self):
        self.assertEqual(RWD._distinctive("the that a model is in this and"), set())

    def test_a_verbatim_run_is_measured_not_guessed(self):
        body = "one two three four five six seven eight"
        self.assertEqual(RWD._verbatim_run("one two three four five six", body), 6)
        self.assertEqual(RWD._verbatim_run("one two three four", body), 0)
        self.assertEqual(RWD._verbatim_run("nothing here at all whatever", body), 0)
        self.assertEqual(RWD._verbatim_run("", body), 0)
        self.assertEqual(RWD._verbatim_run(body, ""), 0)


# ── 3. what the supervisor does with it ──────────────────────────────
class TheSupervisorNeverSuppliesTheVerdict(unittest.TestCase):

    def test_no_verdict_escalates_and_writes_no_review(self):
        seen = []

        def silent(w, art, task, ver, unmet):
            seen.append(art)
            return None, "the reviewer answered without a verdict: 'I read it.'", None

        con, _ = ran(review_for=silent)
        self.assertTrue(seen, "the injected reviewer was never consulted")
        self.assertEqual(reviews(con), [],
                         "a review row was written for a verdict nobody gave")
        self.assertTrue(any(p == "HIGH" and "no usable verdict" in h
                            for p, h, _ in signals(con)),
                        "nobody was told the artifact could not be reviewed")

    def test_the_reviewers_own_words_reach_the_person_who_is_told(self):
        def silent(w, art, task, ver, unmet):
            return None, "the reviewer answered without a verdict: 'unsure'", None

        con, _ = ran(review_for=silent)
        detail = " ".join(d for p, h, d in signals(con) if "no usable verdict" in h)
        self.assertIn("unsure", detail,
                      "the escalation hides what the reviewer actually said")

    def test_an_invented_verdict_is_refused(self):
        """Anything that is not one of the two words is not a verdict, however
        confidently it is returned."""
        for made_up in ("LGTM", "approve", "APPROVE-ISH", "PASS", ""):
            with self.subTest(verdict=made_up):
                con, _ = ran(review_for=lambda *a, **k: (made_up, "because", None))
                self.assertEqual(reviews(con), [],
                                 "%r was accepted as a verdict" % made_up)

    def test_a_rejection_is_recorded_as_a_rejection(self):
        con, _ = ran(review_for=lambda *a, **k:
                     ("REJECT", "the summary cites nothing", None))
        rows = reviews(con)
        self.assertTrue(rows, "the rejection was not persisted")
        self.assertEqual({r["verdict"] for r in rows}, {"REJECT"})
        self.assertEqual(rows[0]["rationale"], "the summary cites nothing",
                         "the reviewer's reason was replaced with the world's")

    def test_an_approval_is_recorded_as_an_approval(self):
        con, _ = ran(review_for=lambda *a, **k:
                     ("APPROVE", "it meets the bar and reads well", None))
        rows = reviews(con)
        self.assertTrue(rows, "the approval was not persisted")
        self.assertEqual({r["verdict"] for r in rows}, {"APPROVE"})

    def test_the_default_is_the_worlds_own_verdict_not_a_models(self):
        con, w = ran()
        self.assertIs(w.review_for, SUP.deterministic_review)
        self.assertTrue(reviews(con), "the default reviewer decided nothing")

    def test_the_default_can_reject(self):
        """The deterministic reviewer is not a rubber stamp either."""
        self.assertEqual(
            SUP.deterministic_review(None, 1, None, None, [])[0], "APPROVE")
        verdict, why, run = SUP.deterministic_review(
            None, 1, None, None, ["a section headed Sources"])
        self.assertEqual(verdict, "REJECT")
        self.assertIn("a section headed Sources", why)
        self.assertIsNone(run, "no model was consulted, so no run may be cited")




# ── 4. the run cannot claim a finish it did not reach ────────────────
class TheRunCannotClaimAFinishItDidNotReach(unittest.TestCase):
    """THE INVARIANT, in one sentence:

        every artifact carries a terminal verification state; every artifact
        whose verification PASSED carries a review outcome; and no task is left
        RUNNING — unless the run terminates explicitly as INCOMPLETE,
        QUOTA_EXHAUSTED or FAILED.

    Twenty passing checks are not a finished workflow. A task left RUNNING
    because the model hit its daily quota used to sit behind a full tally with
    nothing in the report saying so, which is the whole reason this exists.
    """

    def test_an_approval_completes_the_workflow(self):
        con, _ = ran()
        state, why, accounted = RWD.completion_state(con)
        self.assertEqual(state, RWD.COMPLETE, why)
        self.assertTrue(accounted)

    def test_a_rejection_is_an_outcome_not_a_hole(self):
        """The checker asks for a review, not for an approval."""
        con, _ = ran(review_for=lambda *a, **k:
                     ("REJECT", "the summary cites nothing", None))
        rejected = [r["artifact_id"] for r in
                    con.execute("SELECT artifact_id FROM reviews WHERE verdict='REJECT'")]
        self.assertTrue(rejected, "no rejection was recorded to test with")
        state, why, accounted = RWD.completion_state(con)
        # Nothing here is unreviewed: every artifact that passed verification
        # carries a REJECT, and REJECT counts. What is unfinished is the
        # correction chain, which the world escalated to a person.
        self.assertNotIn("reached no review outcome", why)
        self.assertTrue(accounted, "an escalated rejection chain is an honest stop")

    def test_an_artifact_with_no_review_outcome_is_incomplete(self):
        con, _ = ran(review_for=silent_reviewer)
        state, why, _ = RWD.completion_state(con)
        self.assertEqual(state, RWD.INCOMPLETE, why)
        self.assertIn("no review outcome", why)

    def test_a_quota_failure_during_review_is_named_as_such(self):
        con, _ = ran(review_for=silent_reviewer)
        con.execute(QUOTA_RUN, ("AGT-REVIEWER",
                                "HTTP 429: You exceeded your current quota"))
        con.commit()
        state, why, accounted = RWD.completion_state(con)
        self.assertEqual(state, RWD.QUOTA, why)
        self.assertIn("ran out of allowance", why)
        self.assertTrue(accounted)

    def test_a_number_that_merely_contains_429_is_not_a_quota_failure(self):
        """The `$0.50000` lesson: a substring match on a number reads a token
        count as an HTTP status."""
        con, _ = ran(review_for=silent_reviewer)
        con.execute(QUOTA_RUN, ("AGT-REVIEWER", "empty completion after 429 tokens"))
        con.commit()
        state, _, _ = RWD.completion_state(con)
        self.assertEqual(state, RWD.FAILED,
                         "a failed run without a quota marker is FAILED, not QUOTA")

    def test_a_transport_failure_is_FAILED_and_says_so(self):
        con, _ = ran(review_for=silent_reviewer)
        con.execute(QUOTA_RUN, ("AGT-REVIEWER", "HTTP 503: upstream unavailable"))
        con.commit()
        state, why, accounted = RWD.completion_state(con)
        self.assertEqual(state, RWD.FAILED, why)
        self.assertTrue(accounted)

    def test_a_refused_opportunity_is_a_terminal_outcome_not_a_hole(self):
        """The world judged, declined, recorded why and stopped. That is the
        behaviour the gate exists for, and it must not read as an unexplained
        silence — a real run reported one as `accounted=False`."""
        import first_project as FP
        con = store.connect(os.path.join(tempfile.mkdtemp(), "refused.db"))
        store.found(con, mode="simulation")
        W.found_agents(con)
        POL.seed(con)
        w = SUP.World(con, W.build_gateway(con), provider_for=D.provider_for,
                      requirements_for=D.requirements_for,
                      instruction_for=D.instruction_for,
                      evaluate_for=lambda w, o, chain_id=None:
                      ("REJECTED", "not worth the calls", None),
                      gate_for=FP.owner_gate, worker="refused")
        BUS.emit(con, "OWNER_OBJECTIVE", "objective:1",
                 {"objective": OBJECTIVE, "fixture": SOURCE,
                  "required_caps": ["research", "build"]}, by="OWNER")
        SUP.run(w, max_ticks=200)
        state, why, accounted = RWD.completion_state(con)
        self.assertEqual(state, RWD.INCOMPLETE, why)
        self.assertIn("was refused", why)
        self.assertTrue(accounted, "a deliberate refusal read as an unexplained hole")
        self.assertEqual([], [a for a in con.execute("SELECT * FROM artifacts")])

    def test_no_artifact_is_never_a_completion(self):
        con = store.connect(os.path.join(tempfile.mkdtemp(), "empty.db"))
        store.found(con, mode="simulation")
        W.found_agents(con)
        POL.seed(con)
        state, why, accounted = RWD.completion_state(con)
        self.assertEqual(state, RWD.INCOMPLETE, why)
        self.assertIn("no artifact", why)
        self.assertFalse(accounted, "nothing in an empty world explains the silence")

    def test_an_artifact_with_no_verification_evidence_is_not_complete(self):
        """Missing provenance never reads as finished, and is never excused."""
        con, _ = ran()
        self.assertEqual(RWD.completion_state(con)[0], RWD.COMPLETE)
        r = con.execute("SELECT id, source FROM runs ORDER BY id DESC LIMIT 1").fetchone()
        con.execute(
            "INSERT INTO artifacts(task_id,run_id,principal_id,kind,name,path,body,"
            "sha,source,created_at) VALUES(2,?,'AGT-RESEARCHER','doc','untraced.md',"
            "'artifacts/research/untraced.md','x','deadbeef',?,?)",
            (r["id"], r["source"], store.now()))
        con.commit()
        state, why, accounted = RWD.completion_state(con)
        self.assertEqual(state, RWD.INCOMPLETE, why)
        self.assertIn("no verification evidence", why)
        self.assertFalse(accounted)

    def test_provenance_is_enforced_one_level_below_this_checker(self):
        """An artifact that names no run cannot be written at all: the schema
        refuses it, so the checker's own guard is a second line, not the only
        one."""
        con, _ = ran()
        r = con.execute("SELECT id, source FROM runs ORDER BY id DESC LIMIT 1").fetchone()
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute(
                "INSERT INTO artifacts(task_id,run_id,principal_id,kind,name,path,"
                "body,sha,source,created_at) VALUES(2,NULL,'AGT-RESEARCHER','doc',"
                "'y.md','artifacts/research/y.md','b','s2',?,?)",
                (r["source"], store.now()))

    def test_a_superseded_first_attempt_is_not_unfinished_work(self):
        """An artifact that FAILED verification never reaches a reviewer — it is
        routed to correction — so demanding a review for it would misread the
        workflow and call every ordinary run incomplete."""
        con, _ = ran()
        failed = [a for a in con.execute("SELECT id FROM artifacts")
                  if not con.execute("SELECT 1 FROM reviews WHERE artifact_id=?",
                                     (a["id"],)).fetchone()]
        self.assertTrue(failed, "this run had no superseded attempt to test with")
        self.assertEqual(RWD.completion_state(con)[0], RWD.COMPLETE)

    def test_the_verdict_line_carries_the_state(self):
        """The protection that matters: no one can quote the verdict without
        the workflow state attached to it."""
        con, _ = ran(review_for=silent_reviewer)
        con.execute(QUOTA_RUN, ("AGT-REVIEWER",
                                "HTTP 429: You exceeded your current quota"))
        con.commit()

        class Cap:
            calls, max_calls, refusals = 17, 35, []

        out, real = io.StringIO(), sys.stdout
        try:
            sys.stdout = out
            RWD.report(con, Cap(), {"ticks": 20, "quiet": True, "seconds": 1.0,
                                    "steps": []}, None)
        finally:
            sys.stdout = real
        printed = out.getvalue()
        self.assertIn("workflow state    QUOTA_EXHAUSTED", printed)
        for line in printed.splitlines():
            if "REAL MULTI-AGENT WORLD" in line:
                self.assertIn("QUOTA_EXHAUSTED", line,
                              "the verdict line can be quoted without the state")


if __name__ == "__main__":
    unittest.main(verbosity=2)
