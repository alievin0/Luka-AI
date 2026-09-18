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
"the reviewer did not answer the question" actually means. The second half of
the suite checks that it does.

No model is called, no network is touched, and nothing is spent.
"""
import os
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


# ── 2. what the supervisor does with it ──────────────────────────────
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
