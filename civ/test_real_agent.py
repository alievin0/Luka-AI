#!/usr/bin/env python3
"""REAL AGENT ACCEPTANCE.  python3 test_real_agent.py

The question this suite exists to answer:

    Can an agent receive an objective, decide what to do, use an authorised
    tool, observe the result, decide again on the strength of it, talk to
    another agent, produce evidence, be independently reviewed, correct its
    work, and leave the whole causal chain behind — without the Owner directing
    any single step?

It is a SEPARATE suite on purpose. The deterministic suites pin the
infrastructure and must not be disturbed; this one is about the loop.

What it does NOT show, and says so in several places: reasoning. No model is
reachable in this environment, so the decisions come from `ReactiveWorker`, a
hand-written policy that branches on what the gateway actually returned. That
makes it a real test of the RUNTIME and no evidence at all about intelligence.
The difference from a scripted demo is that the sequence here is a consequence:
take a tool away and the path changes, and there are tests below that take a
tool away and check that it does.

No model is called and nothing is spent.
"""
import json
import os
import re
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import agent_context as CTX       # noqa: E402
from core import agent_runtime as RT        # noqa: E402
from core import agent_world as W           # noqa: E402
from core import provider as P              # noqa: E402
from core import runtime                    # noqa: E402
from core import store                      # noqa: E402
from core import world_bus as BUS           # noqa: E402
from core import world_factory as WF        # noqa: E402
from core import world_policy as POL        # noqa: E402
from core import world_supervisor as SUP    # noqa: E402
import real_agent_demo as D                 # noqa: E402

ORCH, RES = "AGT-ORCHESTRATOR", "AGT-RESEARCHER"
BUILD, REV, OPER = "AGT-BUILDER", "AGT-REVIEWER", "AGT-OPERATOR"
SOURCE = os.path.join(HERE, "AGENT_WORLD_SERVER.md")


def world(db=None):
    con = store.connect(db or os.path.join(tempfile.mkdtemp(), "ra.db"))
    store.found(con, mode="simulation")
    W.found_agents(con)
    POL.seed(con)
    return con


def driven(con=None, worker="worker-1"):
    con = con or world()
    gw = W.build_gateway(con)
    return con, SUP.World(con, gw, provider_for=D.provider_for,
                          requirements_for=D.requirements_for,
                          instruction_for=D.instruction_for, worker=worker)


def ran(con=None, ticks=200):
    """One objective, then nothing. Exactly what the Owner is allowed to do."""
    con, w = driven(con)
    BUS.emit(con, "OWNER_OBJECTIVE", "objective:1",
             {"objective": "Establish what this world can already prove about "
                           "itself, with evidence.",
              "fixture": SOURCE, "required_caps": ["research", "build"]},
             by="OWNER")
    res = SUP.run(w, max_ticks=ticks)
    return con, w, res


def approved_task(con, caps=("research",), objective="do the thing", conds=()):
    tid = W.discover_task(con, objective, by=ORCH, required_caps=caps,
                          conditions=conds)
    W.transition(con, tid, "PROPOSED", ORCH)
    W.transition(con, tid, "APPROVED", ORCH)
    return tid


# ── 1. what an agent knows when it wakes ────────────────────────────
class TheBriefingIsAssembledFromRows(unittest.TestCase):
    def test_memory_actually_reaches_the_agent(self):
        """It used to be fetched into a local variable and dropped, while the
        handler reported `memory_recalled: N` — the record said memory had been
        recalled when nothing had recalled it to anybody."""
        con = world()
        tid = approved_task(con)
        W.remember(con, "agent", RES, "OBSERVATION",
                   "Reports without a named source get rejected.", by=RES)
        text, ctx = CTX.briefing(con, RES, tid)
        self.assertIn("Reports without a named source", text)
        self.assertTrue(ctx["memory"])

    def test_the_briefing_carries_the_task_and_its_declared_conditions(self):
        con = world()
        tid = approved_task(con, conds=[{"description": "a source was read",
                                         "kind": "evidence"}])
        text, _ = CTX.briefing(con, RES, tid)
        self.assertIn("TASK #%d" % tid, text)
        self.assertIn("a source was read", text)
        self.assertIn("CONDITIONS", text)

    def test_the_briefing_carries_messages_addressed_to_this_agent(self):
        con = world()
        tid = approved_task(con)
        W.send(con, ORCH, RES, "ASSIGN", {"text": "Start with the server doc."},
               task_id=tid)
        W.send(con, ORCH, BUILD, "ASSIGN", {"text": "Not for the researcher."},
               task_id=tid)
        text, _ = CTX.briefing(con, RES, tid)
        self.assertIn("Start with the server doc.", text)
        self.assertNotIn("Not for the researcher.", text)

    def test_the_briefing_lists_only_the_tools_this_agent_holds(self):
        con = world()
        tid = approved_task(con)
        rev, _ = CTX.briefing(con, REV, tid)
        self.assertIn("READ_REPO", rev)
        self.assertNotIn("WRITE_ARTIFACT", rev.split("TOOLS YOU HOLD:")[1])
        orch, _ = CTX.briefing(con, ORCH, tid)
        held = orch.split("TOOLS YOU HOLD:")[1]
        self.assertNotIn("READ_REPO", held)
        self.assertNotIn("EXECUTE_SANDBOX", held)

    def test_the_briefing_tells_nobody_what_to_do(self):
        """The sequence is supposed to come from the task and the agent's own
        decisions. A briefing containing the plan would make the decision
        ceremonial, so this fails if one creeps in."""
        con = world()
        tid = approved_task(con)
        text, _ = CTX.briefing(con, RES, tid)
        low = text.lower()
        for banned in ("first read", "then write", "step 1", "step 2",
                       "you should read", "begin by", "next, ", "finally, "):
            self.assertNotIn(banned, low, banned)

    def test_a_correction_can_see_the_attempt_it_exists_to_answer(self):
        con, w, _ = ran()
        corr = con.execute("SELECT id, parent_id FROM tasks WHERE parent_id "
                           "IS NOT NULL ORDER BY id LIMIT 1").fetchone()
        self.assertIsNotNone(corr, "no correction task was created")
        text, ctx = CTX.briefing(con, RES, corr["id"])
        self.assertIn("WHAT THIS TASK ALREADY TRIED", text)
        self.assertIn("FAILED", text)
        self.assertTrue(ctx["attempts"], "the correction saw no prior attempt")

    def test_a_correction_can_see_the_lesson_its_predecessor_produced(self):
        """A `failures.lesson` only reaches `memories` when the owner plane
        promotes it, and nothing promotes anything unattended — so the lesson is
        read from the failure record directly."""
        con, w, _ = ran()
        corr = con.execute("SELECT id FROM tasks WHERE parent_id IS NOT NULL "
                           "ORDER BY id LIMIT 1").fetchone()
        text, ctx = CTX.briefing(con, RES, corr["id"])
        self.assertTrue(ctx["failures"], "no failure was visible to the correction")
        self.assertIn("ALREADY BEEN FOUND TO GET WRONG", text)


# ── 2. the decision is the agent's ──────────────────────────────────
class TheSequenceIsNotScripted(unittest.TestCase):
    """Take something away and the path changes. That is the whole difference
    between a loop and a demo."""

    def _turn(self, con, agent, tid):
        gw = W.build_gateway(con)
        W.assign(con, tid, agent, by=ORCH)
        lease = W.claim_task(con, agent, task_id=tid)
        brief, _ = CTX.briefing(con, agent, tid, extra={
            "the owner's instruction": D.instruction_for(
                con.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone())})
        return RT.run_agent_turn(con, gw, D.ReactiveWorker(agent, tid), agent,
                                 tid, instruction=brief,
                                 lease_id=lease["lease_id"])

    def test_an_agent_that_can_read_reads_first(self):
        con = world()
        tid = approved_task(con, ("research",))
        turn = self._turn(con, RES, tid)
        caps = [s.detail["tool"] for s in turn.steps if s.kind == "tool"]
        self.assertEqual(caps[0], "READ_REPO", caps)
        self.assertIn("WRITE_ARTIFACT", caps)

    def test_an_agent_denied_its_reading_tool_takes_a_different_path(self):
        """Nothing about the sequence is fixed: revoke READ_REPO and the same
        double produces a different, still-honest artifact."""
        con = world()
        tid = approved_task(con, ("research",))
        con.execute("UPDATE principals SET permissions=? WHERE id=?",
                    (json.dumps([W.write_scope("research"), W.TALK_SCOPE]), RES))
        turn = self._turn(con, RES, tid)
        caps = [s.detail["tool"] for s in turn.steps if s.kind == "tool"]
        self.assertNotIn("READ_REPO", caps)
        self.assertIn("WRITE_ARTIFACT", caps)
        self.assertIn("No source was read", turn.artifact_body or "",
                      "it claimed a source it never read")

    def test_an_agent_with_no_writing_tool_answers_rather_than_pretending(self):
        con = world()
        tid = approved_task(con, ("review",))
        turn = self._turn(con, REV, tid)
        self.assertIsNone(turn.artifact_path)
        self.assertTrue(turn.answer)
        self.assertIn("no artifact", (turn.answer or "").lower())

    def test_the_artifact_content_depends_on_what_was_actually_read(self):
        """Not a canned string: the body carries bytes the gateway returned."""
        con = world()
        tid = approved_task(con, ("research",))
        turn = self._turn(con, RES, tid)
        body = turn.artifact_body or ""
        self.assertIn("Bytes observed:", body)
        n = int(re.search(r"Bytes observed: (\d+)", body).group(1))
        self.assertGreater(n, 1000)
        with open(SOURCE, encoding="utf-8") as fh:
            first = next(ln for ln in fh if ln.strip()).strip()[:60]
        self.assertIn(first[:40], body, "the artifact does not quote the source")


# ── 3. agents talk to each other, and it is a real row ──────────────
class AgentsCommunicate(unittest.TestCase):
    def test_an_agent_sends_a_message_as_its_own_decision(self):
        con, w, _ = ran()
        mine = [dict(r) for r in con.execute(
            "SELECT * FROM agent_messages WHERE authority='agent'")]
        self.assertTrue(mine, "no agent ever sent a message of its own")
        for m in mine:
            self.assertTrue(m["sender"].startswith("AGT-"))
            self.assertTrue(m["recipient"].startswith("AGT-"))
            self.assertNotEqual(m["sender"], m["recipient"])

    def test_every_agent_message_went_through_the_gateway(self):
        con, w, _ = ran()
        n = con.execute("SELECT COUNT(*) c FROM agent_messages WHERE "
                        "authority='agent'").fetchone()["c"]
        allowed = con.execute("SELECT COUNT(*) c FROM tool_calls WHERE "
                              "cap='SEND_MESSAGE' AND decision='ALLOW'"
                              ).fetchone()["c"]
        self.assertEqual(n, allowed,
                         "a message exists that no gateway call produced")

    def test_a_message_reaches_the_recipient_s_next_briefing(self):
        con, w, _ = ran()
        m = con.execute("SELECT * FROM agent_messages WHERE authority='agent' "
                        "ORDER BY id LIMIT 1").fetchone()
        tid = approved_task(con, ("build",), objective="follow up")
        text, _ = CTX.briefing(con, m["recipient"], tid)
        self.assertIn("MESSAGES ADDRESSED TO YOU", text)
        self.assertIn(m["sender"], text)


# ── 4. the whole chain, unattended ──────────────────────────────────
class TheOwnerIssuedOneCommand(unittest.TestCase):
    """The acceptance question, in one class."""

    @classmethod
    def setUpClass(cls):
        cls.con, cls.w, cls.res = ran()

    def test_the_owner_issued_exactly_one_command(self):
        n = self.con.execute("SELECT COUNT(*) c FROM world_queue WHERE "
                             "emitted_by='OWNER'").fetchone()["c"]
        self.assertEqual(n, 1)

    def test_the_world_reached_a_stable_state_on_its_own(self):
        self.assertTrue(self.res["quiet"])
        self.assertGreater(self.res["ticks"], 8)

    def test_more_than_one_agent_did_work(self):
        who = {r["principal_id"] for r in self.con.execute(
            "SELECT DISTINCT principal_id FROM tool_calls WHERE decision='ALLOW'")}
        self.assertGreaterEqual(len(who), 2, who)

    def test_there_were_several_decision_points_per_task(self):
        """Multi-turn: a tool result came back and the agent decided again."""
        rows = self.con.execute(
            "SELECT l.task_id, COUNT(*) n FROM tool_calls tc "
            "JOIN leases l ON l.id=tc.lease_id WHERE tc.decision='ALLOW' "
            "GROUP BY l.task_id").fetchall()
        self.assertTrue(any(r["n"] >= 3 for r in rows),
                        "no task involved three or more consecutive decisions")

    def test_a_real_tool_ran_and_returned_real_bytes(self):
        n = self.con.execute("SELECT COUNT(*) c FROM tool_calls WHERE "
                             "cap='READ_REPO' AND decision='ALLOW'").fetchone()["c"]
        self.assertGreater(n, 0)

    def test_an_artifact_exists_with_a_sha(self):
        a = self.con.execute("SELECT * FROM artifacts ORDER BY id").fetchall()
        self.assertTrue(a)
        for r in a:
            self.assertTrue(r["sha"])
            self.assertTrue(r["body"])

    def test_verification_ran_outside_the_agent_that_produced_the_work(self):
        ev = [dict(r) for r in self.con.execute(
            "SELECT * FROM evidence WHERE kind='verification'")]
        self.assertTrue(ev)
        self.assertTrue(any(not json.loads(e["detail"])["passed"] for e in ev),
                        "nothing ever failed verification")
        self.assertTrue(any(json.loads(e["detail"])["passed"] for e in ev),
                        "nothing ever passed verification")

    def test_the_reviewer_is_not_the_author(self):
        for r in self.con.execute(
                "SELECT r.reviewer_id, a.principal_id FROM reviews r "
                "JOIN artifacts a ON a.id=r.artifact_id"):
            self.assertNotEqual(r["reviewer_id"], r["principal_id"])

    def test_a_failure_produced_a_correction_that_then_passed(self):
        failed = self.con.execute("SELECT COUNT(*) c FROM tasks WHERE "
                                  "status='FAILED'").fetchone()["c"]
        self.assertGreater(failed, 0, "nothing ever failed")
        corr = self.con.execute(
            "SELECT * FROM tasks WHERE parent_id IS NOT NULL").fetchall()
        self.assertTrue(corr, "a failure produced no correction")
        self.assertTrue(any(t["status"] in ("ACCEPTED", "ARCHIVED") for t in corr),
                        "no correction was ever accepted")

    def test_the_correction_is_a_new_artifact_not_an_edit(self):
        shas = [r["sha"] for r in self.con.execute("SELECT sha FROM artifacts")]
        self.assertEqual(len(set(shas)), len(shas), "an artifact was overwritten")

    def test_a_failure_was_recorded_with_a_lesson(self):
        f = [dict(r) for r in self.con.execute(
            "SELECT * FROM failures WHERE subject_kind='task'")]
        self.assertTrue(f)
        self.assertTrue(all(x["lesson"] for x in f))

    def test_agents_moved_because_work_sent_them_somewhere(self):
        rows = [dict(r) for r in self.con.execute(
            "SELECT * FROM movements WHERE phase='ARRIVED' AND "
            "from_workspace IS NOT NULL")]
        self.assertTrue(rows)
        for m in rows:
            self.assertIsNotNone(m["task_id"], m["why"])

    def test_the_causal_chain_rebuilds_from_rows_alone(self):
        tid = self.con.execute(
            "SELECT id FROM tasks WHERE status IN ('ACCEPTED','ARCHIVED') "
            "AND parent_id IS NOT NULL ORDER BY id LIMIT 1").fetchone()
        self.assertIsNotNone(tid)
        chain = RT.provenance_chain(self.con, tid["id"])
        kinds = {c["link"] for c in chain}
        for link in ("tool_call", "artifact"):
            self.assertIn(link, kinds, kinds)


# ── 5. a commissioned agent is employable ───────────────────────────
class AFactoryAgentCanActuallyWork(unittest.TestCase):
    """The factory could create an agent, embody it and seat it — and then it
    could never be selected for anything, because three separate places read
    the FOUNDING capability map instead of the capabilities table."""

    def setUp(self):
        self.con = world()
        out = WF.commission(
            self.con, "OWNER",
            gap="statistical inference over quantitative datasets: regression, "
                "variance decomposition and confidence interval estimation",
            role="Data Analyst", name="Data Analyst",
            required_caps=["quantitative_analysis"])
        self.aid = out["agent_id"]
        self.assertIsNotNone(self.aid, out)
        WF.deploy(self.con, self.aid)

    def test_its_capabilities_are_visible_to_the_world(self):
        self.assertIn("quantitative_analysis", W.capabilities_of(self.con, self.aid))

    def test_it_can_be_assigned_a_task_needing_its_capability(self):
        tid = approved_task(self.con, ("quantitative_analysis",),
                            objective="analyse the numbers")
        W.assign(self.con, tid, self.aid, by=ORCH)
        self.assertEqual(W.assignee(self.con, tid), self.aid)

    def test_the_supervisor_would_pick_it_for_that_work(self):
        tid = approved_task(self.con, ("quantitative_analysis",),
                            objective="analyse the numbers")
        task = self.con.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
        self.assertEqual(SUP._worker_for(self.con, task), self.aid)

    def test_it_can_be_staffed_onto_a_team(self):
        team = W.form_team_for(self.con, ["research", "quantitative_analysis"])
        self.assertIn(self.aid, [a for a, _ in team["members"]])

    def test_its_briefing_knows_what_it_can_do(self):
        tid = approved_task(self.con, ("quantitative_analysis",))
        text, ctx = CTX.briefing(self.con, self.aid, tid)
        self.assertIn("quantitative_analysis", ctx["capabilities"])

    def test_a_capability_nobody_holds_is_reported_rather_than_faked(self):
        team = W.form_team_for(self.con, ["research", "time_travel"], strict=False)
        self.assertEqual(team["uncovered"], ["time_travel"])
        self.assertIsNone(team["team_id"])


# ── 6. teams come from requirements ─────────────────────────────────
class TeamsAreDerivedNotDeclared(unittest.TestCase):
    def test_the_team_is_the_minimum_that_covers_the_requirement(self):
        con = world()
        team = W.form_team_for(con, ["research"])
        self.assertEqual(len(team["members"]), 1)
        self.assertEqual(team["members"][0][0], RES)

    def test_a_bigger_requirement_produces_a_bigger_team(self):
        con = world()
        small = W.form_team_for(con, ["research"])
        big = W.form_team_for(con, ["research", "build", "review", "operate"])
        self.assertGreater(len(big["members"]), len(small["members"]))

    def test_the_same_requirement_always_produces_the_same_team(self):
        con = world()
        a = W.form_team_for(con, ["research", "build", "review"])
        b = W.form_team_for(con, ["build", "review", "research"])
        self.assertEqual(a["members"], b["members"])

    def test_no_hard_coded_trio_anywhere_in_the_supervisor(self):
        """A source guard: the roles must not name each other in sequence."""
        src = open(os.path.join(HERE, "core/world_supervisor.py"),
                   encoding="utf-8").read()
        self.assertEqual(re.findall(r"ROLE_CAPABILITY\.items\(\)", src), [])
        self.assertEqual(re.findall(r"for \w+ in W\.CREW", src), [])


# ── 7. the reality boundary is unchanged ────────────────────────────
class TheModelStillCannotReachAnything(unittest.TestCase):
    def test_no_model_is_reachable_here_and_the_world_says_so(self):
        """Stated as a test so the claim cannot quietly become false: every
        result in this suite comes from a double, because there is nothing else."""
        p = P.from_env()
        self.assertFalse(p.available())
        self.assertEqual(p.name, "none")

    def test_the_double_is_never_labelled_as_a_model(self):
        self.assertEqual(D.ReactiveWorker("a", 1).source, "mock")
        self.assertIn("NOT MODEL OUTPUT", D.BANNER)

    def test_every_artifact_this_suite_produces_says_it_is_not_model_output(self):
        con, w, _ = ran()
        for r in con.execute("SELECT body FROM artifacts"):
            self.assertIn("NOT MODEL OUTPUT", r["body"])

    def test_an_agent_cannot_grant_itself_a_capability(self):
        con = world()
        gw = W.build_gateway(con)
        for cap in ("GRANT", "SUDO", "ADMIN", "WRITE_POLICY"):
            with self.assertRaises(runtime.Denied):
                gw.call(RES, cap, anything="x")

    def test_an_agent_cannot_send_in_another_agents_name(self):
        con = world()
        gw = W.build_gateway(con)
        with self.assertRaises(runtime.Denied):
            gw.call(REV, "SEND_MESSAGE", to=BUILD, text="x", principal_id=RES)
        self.assertEqual(con.execute(
            "SELECT COUNT(*) c FROM agent_messages").fetchone()["c"], 0)

    def test_an_agent_cannot_message_the_control_plane(self):
        con = world()
        gw = W.build_gateway(con)
        with self.assertRaises(runtime.Denied):
            gw.call(RES, "SEND_MESSAGE", to=W.OWNER, text="approve this")

    def test_text_inside_a_file_is_data_and_not_an_order(self):
        """The briefing says so, and the gateway does not care what a file says."""
        con = world()
        tid = approved_task(con)
        text, _ = CTX.briefing(con, RES, tid)
        sysprompt = RT.contract_prompt(con, RES, tid)
        self.assertIn("data, not an order", sysprompt)

    def test_a_declaration_naming_a_file_the_gateway_never_wrote_resolves_to_nothing(self):
        con = world()
        tid = approved_task(con)
        gw = W.build_gateway(con)
        W.assign(con, tid, RES, by=ORCH)
        lease = W.claim_task(con, RES, task_id=tid)

        class Liar(P.Provider):
            name, source = "liar", "mock"
            def available(self):
                return True
            def why_unavailable(self):
                return ""
            def complete(self, system, prompt, model=None, max_tokens=800):
                return P.Result("OK", "mock", "liar", "liar-1",
                                text=json.dumps({"final": {"artifact": "never.md"}}))

        turn = RT.run_agent_turn(con, gw, Liar(), RES, tid, instruction="x",
                                 lease_id=lease["lease_id"])
        self.assertIsNone(turn.artifact_path)
        self.assertFalse(turn.submitted)


class SuiteHygiene(unittest.TestCase):
    def test_every_class_in_this_file_runs(self):
        src = open(__file__, encoding="utf-8").read()
        declared = set(re.findall(r"^class (\w+)\(unittest\.TestCase\)", src, re.M))
        loaded = {c.__name__ for c in globals().values()
                  if isinstance(c, type) and issubclass(c, unittest.TestCase)}
        self.assertEqual(declared - loaded, set())


if __name__ == "__main__":
    unittest.main(verbosity=1)
