#!/usr/bin/env python3
"""MULTI-PROJECT AUTONOMY.  python3 test_many_projects.py

`many_projects.py` asks whether the single-project workflow is a workflow or a
path: three opportunities, from three files, with three different capability
requirements, in one world at the same time. That run needs a model. Everything
about the SHAPE of it does not, and this suite is the shape:

    the task graph and the team are a FUNCTION of what the project requires,
    so three requirement sets give three shapes and identical ones do not;
    each project works from the file ITS objective named, read back out of the
    record rather than out of this file;
    each project spends its own allowance, so one running out starves nobody;
    each project accounts for ITSELF — a project stopped by an exhausted
    allowance is QUOTA_EXHAUSTED and a finished neighbour is still COMPLETE;
    each passport carries that project's rows and no other project's;
    and re-stating the same objectives resumes rather than repeats.

Every default is unchanged and there are tests that say so: a world built
without `plan_for` gets `always_on.PLAN`, and `completion_state` and
`world_causality` asked without a project answer exactly as they did.

No model is called and nothing is spent. The end-to-end runs are driven by a
scripted double whose runs are tagged `source='mock'` in a simulation world,
which is what LAW 2 requires and what keeps this suite from ever being mistaken
for the run it describes.
"""
import contextlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import agent_world as W            # noqa: E402
from core import always_on as A              # noqa: E402
from core import spend as SPEND              # noqa: E402
from core import store                       # noqa: E402
from core import world_bus as BUS            # noqa: E402
from core import world_policy as POL         # noqa: E402
from core import world_supervisor as SUP     # noqa: E402
import first_project as FP                   # noqa: E402
import many_projects as MP                   # noqa: E402
import real_agent_demo as D                  # noqa: E402
import real_world_demo as RWD                # noqa: E402


class Scripted(D.ReactiveWorker):
    """The reactive double, plus the two things these prompts ask for that
    `real_agent_demo`'s version has no reason to do: open with a verdict when a
    verdict is what was asked for, and name the file it read when the bar says
    to name it. It decides nothing else, and its runs are tagged `mock`."""

    name = "scripted-double"
    model = "scripted-1"
    free = True                 # a double costs nothing; `Budgeted` must not refuse it

    def __init__(self):
        super().__init__(agent_id=None, task_id=None)

    @staticmethod
    def _task_in(prompt):
        m = re.search(r"TASK #(\d+)", prompt)
        return m.group(1) if m else "x"

    def _decide(self, prompt):
        if "must be APPROVE or REJECT" in prompt:
            return {"final": {"answer": "APPROVE. The evidence row exists and the "
                                        "question has a checkable answer."}}
        self.task_id = self._task_in(prompt)
        return super()._decide(prompt)

    def _compose(self, prompt, seen):
        return super()._compose(prompt, seen) + (
            "\n## Source file\n\n%s\n" % (self._source_path(prompt) or "?"))


def run_the_world(db=None, max_calls="20"):
    """One whole run of `many_projects.main`, silently, on the double."""
    db = db or os.path.join(tempfile.mkdtemp(), "mp.db")
    was, os.environ["CIV_MAX_CALLS"] = os.environ.get("CIV_MAX_CALLS"), max_calls
    try:
        with contextlib.redirect_stdout(io.StringIO()) as out:
            rc = MP.main(["--db", db], provider=Scripted())
    finally:
        if was is None:
            os.environ.pop("CIV_MAX_CALLS", None)
        else:
            os.environ["CIV_MAX_CALLS"] = was
    return rc, db, out.getvalue()


def opportunity(con, required_caps, problem="does the document still hold?"):
    """A row shaped like the one the world proposes, without running one."""
    return con.execute(
        "INSERT INTO opportunities(source,problem,required_caps,status,created_at,"
        "discovered_by,rationale,confidence) VALUES('test',?,?,'APPROVED',?,"
        "'AGT-RESEARCHER','because',0.5)",
        (problem, json.dumps(required_caps), store.now())).lastrowid


def bare_world():
    con = store.connect(os.path.join(tempfile.mkdtemp(), "mp.db"))
    store.found(con, mode="simulation")
    W.found_agents(con)
    POL.seed(con)
    return con


# ── 1. the graph is a function of the requirements ───────────────────
class TheGraphFollowsTheRequirements(unittest.TestCase):

    def plan(self, caps):
        con = bare_world()
        o = con.execute("SELECT * FROM opportunities WHERE id=?",
                        (opportunity(con, caps),)).fetchone()
        return MP.plan_for(o)

    def test_one_capability_is_one_task_with_no_edge(self):
        steps = self.plan(["research"])
        self.assertEqual([s["key"] for s in steps], ["research"])
        self.assertNotIn("after", steps[0])

    def test_the_other_capability_alone_is_the_other_task(self):
        steps = self.plan(["build"])
        self.assertEqual([s["key"] for s in steps], ["build"])
        self.assertNotIn("after", steps[0])

    def test_two_capabilities_are_two_tasks_and_one_edge(self):
        steps = self.plan(["research", "build"])
        self.assertEqual([s["key"] for s in steps], ["research", "build"])
        self.assertEqual(steps[1]["after"], "research")

    def test_the_order_is_the_workflows_not_the_callers(self):
        self.assertEqual([s["key"] for s in self.plan(["build", "research"])],
                         ["research", "build"])

    def test_a_capability_with_no_step_is_refused_not_dropped(self):
        with self.assertRaises(A.WorldError) as e:
            self.plan(["research", "telepathy"])
        self.assertIn("telepathy", str(e.exception))

    def test_an_opportunity_that_requires_nothing_is_not_work(self):
        with self.assertRaises(A.WorldError):
            self.plan([])

    def test_the_project_gets_exactly_that_graph(self):
        con = bare_world()
        oid = opportunity(con, ["research", "build"])
        r = A.open_project_from(con, oid, plan_for=MP.plan_for)
        tasks = [dict(t) for t in con.execute(
            "SELECT * FROM tasks WHERE project_id=? ORDER BY id", (r["project_id"],))]
        self.assertEqual(len(tasks), 2)
        deps = [dict(d) for d in con.execute("SELECT * FROM task_deps")]
        self.assertEqual(len(deps), 1)
        self.assertEqual(deps[0]["depends_on"], tasks[0]["id"])

    def test_one_capability_opens_a_one_task_project(self):
        con = bare_world()
        r = A.open_project_from(con, opportunity(con, ["build"]), plan_for=MP.plan_for)
        self.assertEqual(con.execute(
            "SELECT COUNT(*) c FROM tasks WHERE project_id=?",
            (r["project_id"],)).fetchone()["c"], 1)
        self.assertEqual(con.execute("SELECT COUNT(*) c FROM task_deps").fetchone()["c"], 0)

    def test_the_team_covers_what_the_work_declared(self):
        con = bare_world()
        r = A.open_project_from(con, opportunity(con, ["build"]), plan_for=MP.plan_for)
        self.assertEqual(sorted(r["members"]), ["AGT-BUILDER", "AGT-REVIEWER"])
        r2 = A.open_project_from(con, opportunity(con, ["research", "build"]),
                                 plan_for=MP.plan_for)
        self.assertEqual(sorted(r2["members"]),
                         ["AGT-BUILDER", "AGT-ORCHESTRATOR", "AGT-RESEARCHER",
                          "AGT-REVIEWER"])

    def test_without_a_planner_the_default_graph_is_unchanged(self):
        con = bare_world()
        r = A.open_project_from(con, opportunity(con, ["research"]))
        self.assertEqual(con.execute(
            "SELECT COUNT(*) c FROM tasks WHERE project_id=?",
            (r["project_id"],)).fetchone()["c"], len(A.PLAN))

    def test_a_planner_that_returns_nothing_is_refused(self):
        con = bare_world()
        with self.assertRaises(A.WorldError):
            A.open_project_from(con, opportunity(con, ["research"]),
                                plan_for=lambda o: [])


# ── 2. each project works from its own source ────────────────────────
class EachProjectWorksFromItsOwnSource(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.rc, cls.db, _ = run_the_world()
        cls.con = store.connect(cls.db)
        cls.pids = [p["id"] for p in cls.con.execute(
            "SELECT id FROM projects ORDER BY id")]

    def test_every_project_names_a_different_file(self):
        srcs = [MP.source_of(self.con, pid) for pid in self.pids]
        self.assertEqual(len(srcs), 3)
        self.assertEqual(len(set(srcs)), 3, srcs)
        self.assertTrue(all(os.path.exists(s) for s in srcs), srcs)

    def test_the_source_comes_from_the_record_not_from_the_script(self):
        # Nothing was passed in: the fixture travelled in the queue payload from
        # the Owner's objective all the way to PROJECT_OPENED.
        row = self.con.execute(
            "SELECT payload FROM world_queue WHERE kind='PROJECT_OPENED' "
            "AND subject=? LIMIT 1", ("project:%d" % self.pids[0],)).fetchone()
        self.assertEqual(json.loads(row["payload"])["fixture"],
                         MP.source_of(self.con, self.pids[0]))

    def test_the_bar_names_this_projects_file(self):
        for pid in self.pids:
            task = self.con.execute("SELECT * FROM tasks WHERE project_id=? "
                                    "ORDER BY id LIMIT 1", (pid,)).fetchone()
            stem = os.path.basename(MP.source_of(self.con, pid)).split(".")[0]
            labels = [lab for lab, _ in MP.requirements_for(self.con, task)]
            self.assertIn(stem, " ".join(labels))

    def test_an_artifact_for_another_project_does_not_pass_this_bar(self):
        a = self.con.execute("SELECT * FROM tasks WHERE project_id=? ORDER BY id "
                             "LIMIT 1", (self.pids[0],)).fetchone()
        b = self.con.execute("SELECT * FROM tasks WHERE project_id=? ORDER BY id "
                             "LIMIT 1", (self.pids[2],)).fetchone()
        body = self.con.execute(
            "SELECT body FROM artifacts WHERE task_id=? ORDER BY id LIMIT 1",
            (a["id"],)).fetchone()["body"]
        self.assertTrue(all(pred(body) for _, pred in
                            MP.requirements_for(self.con, a)))
        self.assertFalse(all(pred(body) for _, pred in
                             MP.requirements_for(self.con, b)),
                         "one project's bar accepted another project's artifact")

    def test_the_briefing_names_the_same_file_the_bar_checks_for(self):
        task = self.con.execute("SELECT * FROM tasks WHERE project_id=? ORDER BY id "
                                "LIMIT 1", (self.pids[1],)).fetchone()
        self.assertIn(MP.source_of(self.con, self.pids[1]),
                      MP.instruction_for(self.con, task))

    def test_a_task_with_no_source_is_refused_not_invented(self):
        con = bare_world()
        tid = W.discover_task(con, "read something", by=SUP.ORCH,
                              required_caps=["research"])
        task = con.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
        with self.assertRaises(A.WorldError):
            MP.requirements_for(con, task)


# ── 3. the allowance is per project ──────────────────────────────────
class TheAllowanceIsPerProject(unittest.TestCase):

    def lanes(self, max_calls=2):
        return MP.Lanes(make_cap=lambda: SPEND.Cap(max_usd=1.0, max_calls=max_calls))

    def test_two_lanes_are_two_allowances(self):
        lanes = self.lanes()
        a, b = lanes.cap("opportunity:1"), lanes.cap("opportunity:2")
        self.assertIsNot(a, b)
        a.calls = a.max_calls
        self.assertTrue(a.refuse_reason("m", "", "", 10, free=True))
        self.assertIsNone(b.refuse_reason("m", "", "", 10, free=True),
                          "one project's exhausted cap refused another's call")

    def test_the_same_lane_is_the_same_allowance(self):
        lanes = self.lanes()
        self.assertIs(lanes.cap("opportunity:1"), lanes.cap("opportunity:1"))

    def test_a_task_is_charged_through_its_projects_origin(self):
        con = bare_world()
        oid = opportunity(con, ["research"])
        r = A.open_project_from(con, oid, plan_for=MP.plan_for)
        task = con.execute("SELECT * FROM tasks WHERE project_id=? LIMIT 1",
                           (r["project_id"],)).fetchone()
        self.assertEqual(self.lanes().key_for_task(con, task), "opportunity:%d" % oid)

    def test_the_evaluation_is_charged_to_the_project_it_is_evaluating(self):
        lanes = self.lanes()
        with lanes.charging(7):
            self.assertEqual(lanes.key_for_task(None, None), "opportunity:7")
            self.assertIn("opportunity:7", lanes.caps)
        self.assertIsNone(lanes.current, "the lane outlived the work it was for")

    def test_work_that_belongs_to_no_project_falls_to_the_world_lane(self):
        lanes = self.lanes()
        self.assertIsNone(lanes.key_for_task(None, None))
        self.assertIs(lanes.cap(None), lanes.cap(MP.Lanes.WORLD))

    def test_the_run_gives_every_project_its_own_lane(self):
        _, db, _ = run_the_world()
        con = store.connect(db)
        origins = {p["origin"] for p in con.execute("SELECT origin FROM projects")}
        self.assertEqual(len(origins), 3, origins)


# ── 4. stopping is asked per project ─────────────────────────────────
class StoppingIsAskedPerProject(unittest.TestCase):
    """Each project accounts for itself, and nobody accounts for anybody else.

    The starved project here is a real fourth project with real rows: an
    opportunity, a team, a task nobody could run, and a run that died the way an
    exhausted allowance kills one. Its three neighbours finished. The question
    every test below asks is whether those two facts stay separate.

    One limit is stated rather than hidden: asked of the WHOLE world, a project
    that produced nothing is invisible behind neighbours that produced
    everything, because the world-wide answer walks artifacts. That is exactly
    why the per-project answer exists, and there is a test for it."""

    @classmethod
    def setUpClass(cls):
        cls.rc, cls.template, _ = run_the_world()
        store.connect(cls.template).execute("PRAGMA wal_checkpoint(TRUNCATE)")

    def setUp(self):
        # Every test here adds rows to prove something about stopping, so each
        # gets its own copy of the finished world. Sharing one would mean the
        # fourth project one test invents is a neighbour the next test counts.
        self.db = os.path.join(tempfile.mkdtemp(), "mp.db")
        shutil.copy(self.template, self.db)
        self.con = store.connect(self.db)
        self.finished = [p["id"] for p in self.con.execute(
            "SELECT id FROM projects ORDER BY id")]

    def a_fourth_project(self, caps=("research",)):
        """A project whose work never ran. No artifact, no verification."""
        oid = opportunity(self.con, list(caps), problem="a fourth question")
        r = A.open_project_from(self.con, oid, plan_for=MP.plan_for)
        return r["project_id"]

    def a_dead_run(self, pid, status="BUDGET", error="call cap reached: 2 of 2"):
        tid = self.con.execute("SELECT id FROM tasks WHERE project_id=? LIMIT 1",
                               (pid,)).fetchone()["id"]
        return self.con.execute(
            "INSERT INTO runs(principal_id,task_id,source,provider,model,prompt_sha,"
            "status,error,started_at) VALUES('AGT-RESEARCHER',?,'mock',"
            "'scripted-double','scripted-1','x',?,?,?)",
            (tid, status, error, store.now())).lastrowid

    def test_every_project_that_finished_says_so(self):
        for pid in self.finished:
            self.assertEqual(RWD.completion_state(self.con, pid)[0], RWD.COMPLETE)

    def test_a_project_that_produced_nothing_and_says_why_is_not_complete(self):
        pid = self.a_fourth_project()
        state, why, accounted = RWD.completion_state(self.con, pid)
        self.assertEqual(state, RWD.INCOMPLETE, why)
        self.assertFalse(accounted, "an unexplained hole reported itself as explained")

    def test_an_exhausted_allowance_is_quota_and_not_failure(self):
        pid = self.a_fourth_project()
        self.a_dead_run(pid)
        state, why, accounted = RWD.completion_state(self.con, pid)
        self.assertEqual(state, RWD.QUOTA, why)
        self.assertTrue(accounted)
        self.assertIn("allowance", why)
        self.assertIn("call cap reached", why)

    def test_a_providers_429_is_the_same_kind_of_stop(self):
        pid = self.a_fourth_project()
        self.a_dead_run(pid, status="FAILED",
                        error="google: HTTP 429 RESOURCE_EXHAUSTED quota")
        self.assertEqual(RWD.completion_state(self.con, pid)[0], RWD.QUOTA)

    def test_an_ordinary_failure_is_still_a_failure(self):
        pid = self.a_fourth_project()
        self.a_dead_run(pid, status="FAILED", error="connection reset by peer")
        state, why, accounted = RWD.completion_state(self.con, pid)
        self.assertEqual(state, RWD.FAILED, why)
        self.assertTrue(accounted)

    def test_one_projects_exhaustion_leaves_its_neighbours_alone(self):
        pid = self.a_fourth_project()
        self.a_dead_run(pid)
        self.assertEqual(RWD.completion_state(self.con, pid)[0], RWD.QUOTA)
        for other in self.finished:
            self.assertEqual(RWD.completion_state(self.con, other)[0], RWD.COMPLETE,
                             "project %d inherited a neighbour's quota" % other)

    def test_a_finished_project_is_not_excused_by_a_neighbours_stop(self):
        # The other direction, and the one that matters more: a neighbour that
        # finished must not be the reason a starved project looks accounted for.
        pid = self.a_fourth_project()
        self.assertFalse(RWD.completion_state(self.con, pid)[2])

    def test_a_run_with_no_task_belongs_to_no_project(self):
        self.con.execute(
            "INSERT INTO runs(principal_id,source,provider,model,prompt_sha,status,"
            "error,started_at) VALUES('AGT-ORCHESTRATOR','mock','scripted-double',"
            "'scripted-1','x','BUDGET','call cap reached',?)", (store.now(),))
        for pid in self.finished:
            self.assertEqual(RWD.completion_state(self.con, pid)[0], RWD.COMPLETE)

    def test_a_project_that_finished_everything_finished(self):
        # A run that died on the way is not an unfinished project. Every
        # artifact is verified, every one that passed was reviewed, nothing is
        # running — that is what COMPLETE means, and a dead run does not undo it.
        self.a_dead_run(self.finished[0])
        self.assertEqual(RWD.completion_state(self.con, self.finished[0])[0],
                         RWD.COMPLETE)

    def test_an_open_question_accounts_for_the_project_it_was_raised_on(self):
        pid = self.a_fourth_project()
        POL.propose(self.con, "opportunity.approve", SUP.ORCH, "continue?",
                    "it could not pass", project_id=pid)
        self.assertTrue(RWD.completion_state(self.con, pid)[2])
        other = self.a_fourth_project()
        self.assertFalse(RWD.completion_state(self.con, other)[2],
                         "one project's open question accounted for another")

    def test_the_unscoped_answer_is_unchanged(self):
        self.assertEqual(RWD.completion_state(self.con)[0], RWD.COMPLETE)

    def test_the_unscoped_answer_cannot_see_a_project_that_made_nothing(self):
        # Stated, not hidden: this is the limit the per-project answer exists
        # to remove, and pretending it is not there would be the same kind of
        # false comfort the invariant was written against.
        pid = self.a_fourth_project()
        self.a_dead_run(pid)
        self.assertEqual(RWD.completion_state(self.con, pid)[0], RWD.QUOTA)
        # Every artifact in the world is verified and reviewed and no task is
        # running, so the world-wide answer is COMPLETE — while one of its
        # projects has stopped dead. The world-wide walk starts from artifacts,
        # and a project that produced none never enters it.
        self.assertEqual(RWD.completion_state(self.con)[0], RWD.COMPLETE)


# ── 5. the passport is the project's own ─────────────────────────────
class ThePassportIsTheProjectsOwn(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.rc, cls.db, _ = run_the_world()
        cls.con = store.connect(cls.db)
        cls.opp = {o["project_id"]: o["id"] for o in cls.con.execute(
            "SELECT id, project_id FROM opportunities WHERE project_id IS NOT NULL")}
        cls.books = {pid: FP.passport(cls.con, pid, oid)
                     for pid, oid in cls.opp.items()}

    def ids(self, book, key, field="id"):
        return {x[field] for x in book[key]}

    def test_no_two_passports_share_a_row(self):
        for key in ("tasks", "artifacts", "reviews", "approval", "lessons",
                    "corrections"):
            seen = {}
            for pid, book in self.books.items():
                for i in self.ids(book, key):
                    self.assertNotIn(i, seen,
                                     "%s #%s is in projects %s and %s"
                                     % (key, i, seen.get(i), pid))
                    seen[i] = pid

    def test_each_passport_carries_exactly_one_answered_approval(self):
        for pid, book in self.books.items():
            decided = [a for a in book["approval"] if a["decision"]]
            self.assertEqual(len(decided), 1, (pid, book["approval"]))

    def test_the_gate_approval_is_tied_to_its_project_by_a_row(self):
        # Its own `project_id` is null — the project did not exist when the
        # question was asked — so the link has to come from the DECISION_REQUIRED
        # row naming both the approval and the opportunity.
        for pid, book in self.books.items():
            aid = book["approval"][0]["id"]
            self.assertIsNone(self.con.execute(
                "SELECT project_id FROM approvals WHERE id=?", (aid,)
            ).fetchone()["project_id"])
            payloads = [json.loads(r["payload"]) for r in self.con.execute(
                "SELECT payload FROM world_queue WHERE kind='DECISION_REQUIRED'")]
            self.assertIn({"approval_id": aid, "opportunity_id": self.opp[pid]},
                          [{"approval_id": p.get("approval_id"),
                            "opportunity_id": p.get("opportunity_id")}
                           for p in payloads])

    def test_every_verification_belongs_to_one_of_this_projects_artifacts(self):
        for pid, book in self.books.items():
            arts = self.ids(book, "artifacts")
            for v in book["verifications"]:
                self.assertIn(FP._artifact_in(v["provenance"]), arts)

    def test_verification_names_the_artifacts_own_sha(self):
        for book in self.books.values():
            by_id = {a["id"]: a["sha"] for a in book["artifacts"]}
            self.assertTrue(book["verifications"])
            for v in book["verifications"]:
                art = FP._artifact_in(v["provenance"])
                self.assertTrue(v["provenance"].startswith(
                    "artifact:%d@%s" % (art, by_id[art][:16])), v["provenance"])

    def test_each_passport_reports_its_own_completion(self):
        for pid, book in self.books.items():
            self.assertEqual(book["completion"]["state"],
                             RWD.completion_state(self.con, pid)[0])


# ── 6. the causal chain is rebuilt per project ───────────────────────
class CausalityIsRebuiltPerProject(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.rc, cls.db, _ = run_the_world()
        cls.con = store.connect(cls.db)
        cls.pids = [p["id"] for p in cls.con.execute(
            "SELECT id FROM projects ORDER BY id")]

    def test_each_project_names_its_own_objective(self):
        firsts = []
        for pid in self.pids:
            chain = A.world_causality(self.con, project_id=pid)
            self.assertEqual(chain[0]["link"], "objective")
            firsts.append(chain[0]["id"])
        self.assertEqual(len(set(firsts)), 3, firsts)

    def test_each_project_names_one_opportunity_and_one_project(self):
        for pid in self.pids:
            links = A.world_causality(self.con, project_id=pid)
            self.assertEqual(len([l for l in links if l["link"] == "project"]), 1)
            self.assertEqual(len([l for l in links if l["link"] == "opportunity"]), 1)

    def test_a_single_task_project_has_no_next_task_and_says_so(self):
        one = [pid for pid in self.pids if self.con.execute(
            "SELECT COUNT(*) c FROM tasks WHERE project_id=?", (pid,)
        ).fetchone()["c"] == 1]
        self.assertTrue(one)
        _, missing = A.causality_covers(self.con, project_id=one[0])
        self.assertIn("next_task", missing)

    def test_a_two_task_project_shows_the_second_becoming_runnable(self):
        two = [pid for pid in self.pids if self.con.execute(
            "SELECT COUNT(*) c FROM tasks WHERE project_id=?", (pid,)
        ).fetchone()["c"] == 2]
        self.assertTrue(two)
        seen, _ = A.causality_covers(self.con, project_id=two[0])
        self.assertIn("next_task", seen)

    def test_the_unscoped_chain_still_covers_the_whole_world(self):
        whole = A.world_causality(self.con)
        self.assertEqual(len([l for l in whole if l["link"] == "project"]), 3)
        self.assertEqual(whole[0]["link"], "objective")


# ── 7. the whole workflow, end to end ────────────────────────────────
class TheWholeWorkflow(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.rc, cls.db, cls.out = run_the_world()
        cls.con = store.connect(cls.db)

    def test_it_ran_and_every_graded_check_held(self):
        self.assertEqual(self.rc, 0, self.out[-3000:])
        self.assertNotIn("[FAIL]", self.out)

    def test_it_refuses_the_word_demonstrated_for_a_mock_run(self):
        self.assertIn("SHAPE EXERCISED, NOT DEMONSTRATED", self.out)
        self.assertNotIn("MULTI-PROJECT AUTONOMY DEMONSTRATED", self.out)

    def test_three_projects_from_three_signals(self):
        self.assertEqual(self.con.execute(
            "SELECT COUNT(*) c FROM projects").fetchone()["c"], 3)

    def test_three_different_shapes_from_three_different_requirements(self):
        # WHO is on the team is part of the shape. Two projects can each need
        # one task and two seats and still be different work — one staffed by
        # the Researcher, one by the Builder — and a check that counted seats
        # without naming them called those two the same graph.
        shapes = set()
        for p in self.con.execute("SELECT id FROM projects"):
            tasks = self.con.execute("SELECT COUNT(*) c FROM tasks WHERE project_id=?",
                                     (p["id"],)).fetchone()["c"]
            seats = tuple(sorted(r["principal_id"] for r in self.con.execute(
                "SELECT principal_id FROM team_members m JOIN teams t ON t.id=m.team_id "
                "WHERE t.project_id=?", (p["id"],))))
            shapes.add((tasks, seats))
        self.assertEqual(len(shapes), 3, shapes)

    def test_law_2_held_every_run_is_tagged_mock(self):
        sources = {r["source"] for r in self.con.execute("SELECT source FROM runs")}
        self.assertEqual(sources, {"mock"})

    def test_the_reviewer_reviewed_and_never_produced(self):
        self.assertTrue(list(self.con.execute("SELECT 1 FROM reviews LIMIT 1")))
        self.assertFalse(list(self.con.execute(
            "SELECT 1 FROM artifacts WHERE principal_id=? LIMIT 1", (SUP.REV,))))

    def test_the_owner_issued_nothing_after_the_last_answer(self):
        last = self.con.execute(
            "SELECT MAX(id) m FROM events WHERE kind='OWNER_DECIDED'").fetchone()["m"]
        after = [dict(r) for r in self.con.execute(
            "SELECT * FROM events WHERE actor='OWNER' AND id>?", (last,))]
        self.assertTrue(all(e["kind"] == "OWNER_AWAY" for e in after), after)
        self.assertFalse(list(self.con.execute(
            "SELECT 1 FROM world_queue WHERE emitted_by='OWNER' AND kind<>"
            "'OWNER_OBJECTIVE' LIMIT 1")))

    def test_nothing_touched_the_benchmark(self):
        self.assertFalse(list(self.con.execute("SELECT 1 FROM bench_runs LIMIT 1")))


# ── 8. a restart resumes; it does not repeat ─────────────────────────
class ARestartRepeatsNothing(unittest.TestCase):

    def test_running_the_same_objectives_twice_duplicates_no_work(self):
        rc, db, _ = run_the_world()
        self.assertEqual(rc, 0)
        con = store.connect(db)
        before = MP.census(con)
        rc2, _, out = run_the_world(db=db)
        after = MP.census(con)
        self.assertEqual(rc2, 0, out[-3000:])
        for table in MP.NEVER_TWICE:
            self.assertEqual(after[table], before[table],
                             "%s grew on a restart: %d → %d"
                             % (table, before[table], after[table]))

    def test_the_second_pass_queues_no_new_objective(self):
        rc, db, _ = run_the_world()
        con = store.connect(db)
        n = con.execute("SELECT COUNT(*) c FROM world_queue WHERE "
                        "kind='OWNER_OBJECTIVE'").fetchone()["c"]
        run_the_world(db=db)
        self.assertEqual(con.execute(
            "SELECT COUNT(*) c FROM world_queue WHERE kind='OWNER_OBJECTIVE'"
        ).fetchone()["c"], n)

    def test_a_reused_chain_keeps_the_dedupe_key_stable(self):
        # This is the whole mechanism: the chain id is part of every queue row's
        # dedupe key, so a second chain for the same objective would make every
        # already-queued event look new and the project would run twice.
        con = bare_world()
        sig = dict(MP.SIGNALS[0])
        cid, opened = MP.chain_for(con, sig)
        self.assertTrue(opened)
        again, opened_again = MP.chain_for(con, sig)
        self.assertEqual(cid, again)
        self.assertFalse(opened_again)
        self.assertTrue(MP.owner_states_the_problem(con, sig, cid)[1])
        self.assertFalse(MP.owner_states_the_problem(con, sig, cid)[1])

    def test_a_fresh_chain_would_have_duplicated_the_objective(self):
        con = bare_world()
        sig = dict(MP.SIGNALS[0])
        first = POL.open_chain(con, "objective:1", sig["objective"])
        second = POL.open_chain(con, "objective:1-again", sig["objective"])
        self.assertTrue(MP.owner_states_the_problem(con, sig, first)[1])
        self.assertTrue(MP.owner_states_the_problem(con, sig, second)[1],
                        "the dedupe key was not chain-sensitive after all")


# ── 9. every default is unchanged ────────────────────────────────────
class TheDefaultsAreUnchanged(unittest.TestCase):

    def test_a_world_without_a_planner_gets_the_template(self):
        con = bare_world()
        w = SUP.World(con, W.build_gateway(con), provider_for=D.provider_for)
        self.assertIsNone(w.plan_for)

    def test_the_supervisor_still_opens_the_default_graph(self):
        con = bare_world()
        w = SUP.World(con, W.build_gateway(con), provider_for=D.provider_for,
                      requirements_for=D.requirements_for,
                      instruction_for=D.instruction_for, worker="t-default")
        BUS.emit(con, "OWNER_OBJECTIVE", "objective:1",
                 {"objective": "Establish what this world can prove.",
                  "fixture": os.path.join(HERE, "AGENT_WORLD_SERVER.md"),
                  "required_caps": ["research", "build"]}, by="OWNER")
        SUP.run(w, max_ticks=200)
        pid = con.execute("SELECT id FROM projects ORDER BY id LIMIT 1").fetchone()["id"]
        # Plan steps only: `D.requirements_for` holds back one requirement on
        # purpose, so the default demo produces corrections as well, and a
        # correction is a child of the task it answers.
        self.assertEqual(con.execute(
            "SELECT COUNT(*) c FROM tasks WHERE project_id=? AND parent_id IS NULL",
            (pid,)).fetchone()["c"], len(A.PLAN))

    def test_completion_state_without_a_project_reads_the_world(self):
        _, db, _ = run_the_world()
        con = store.connect(db)
        self.assertEqual(RWD.completion_state(con)[0], RWD.COMPLETE)

    def test_causality_without_a_project_reads_the_world(self):
        _, db, _ = run_the_world()
        con = store.connect(db)
        seen, _ = A.causality_covers(con)
        for link in ("objective", "discovery", "opportunity", "project", "team",
                     "task", "run", "artifact", "verification", "review"):
            self.assertIn(link, seen)


if __name__ == "__main__":
    unittest.main(verbosity=1)
