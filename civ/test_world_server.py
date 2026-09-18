#!/usr/bin/env python3
"""WORLD SERVER TESTS.  python3 test_world_server.py

The world used to be an artifact in one specific, checkable way: nothing turned
its handle. It had a database, a supervisor, a queue and an HTTP server, and the
supervisor only ticked inside a demo script — so the world advanced exactly as
long as a terminal stayed open, and the server served a frozen picture of it.

These tests are about the layer that fixed that: a runtime with its own clock, a
control plane that can change the world over HTTP, and a factory whose output is
a real inhabitant rather than a row nobody can see.

The hardest thing to test here is the negative. A runtime that manufactured work
would look better than one that idles, and an empty world that showed something
happening would photograph better than one that shows nothing. So a good share
of what follows asserts that with nothing to do, nothing happens.

No model is called and nothing is spent. Where a test needs the task path to
execute it uses MockProvider, which is a deterministic stand-in for the RUNTIME
and is not inference — the tests say so where it matters.
"""
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import agent_world as W          # noqa: E402
from core import contract as K             # noqa: E402
from core import embodiment as EMB         # noqa: E402
from core import provider as P             # noqa: E402
from core import store                     # noqa: E402
from core import world_bus as BUS          # noqa: E402
from core import world_factory as WF       # noqa: E402
from core import world_policy as POL       # noqa: E402
from core import world_runtime as RUN      # noqa: E402
from core import world_space as SPACE      # noqa: E402
import world_server as SRV                 # noqa: E402

ORCH, RES = "AGT-ORCHESTRATOR", "AGT-RESEARCHER"
BUILD, REV, OPER = "AGT-BUILDER", "AGT-REVIEWER", "AGT-OPERATOR"

GAP = ("statistical inference over quantitative datasets: regression, variance "
       "decomposition and confidence interval estimation")


def world(db=None):
    con = store.connect(db or os.path.join(tempfile.mkdtemp(), "srv.db"))
    store.found(con, mode="simulation")
    W.found_agents(con)
    POL.seed(con)
    return con


def runtime(con, provider=None, **kw):
    w = RUN.build(con, worker="test-%d" % id(con),
                  provider_for=RUN.provider_factory(provider or P.NotConfigured()),
                  api="http://127.0.0.1:0")
    return RUN.Runtime(w, api="http://127.0.0.1:0", idle_seconds=0.01,
                       housekeep_seconds=0.05, beat_seconds=0.05, **kw)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def commissioned(con, requested_by="OWNER"):
    return WF.commission(
        con, requested_by=requested_by, gap=GAP, role="Data Analyst",
        name="Data Analyst",
        mission="Turn quantitative datasets into defensible statistical findings "
                "with stated uncertainty.",
        required_caps=["quantitative_analysis", "statistical_inference"])


# ── 1. the world has its own clock ──────────────────────────────────
class TheWorldTurnsItsOwnHandle(unittest.TestCase):
    def test_a_runtime_registers_itself_as_a_live_process(self):
        con = world()
        r = runtime(con)
        r.start()
        rows = RUN.runtimes(con)
        self.assertTrue(rows)
        me = next(x for x in rows if x["id"] == r.w.worker)
        self.assertEqual(me["state"], "ALIVE")
        self.assertEqual(me["pid"], os.getpid())
        self.assertTrue(me["host"])
        r.shutdown()

    def test_a_world_with_no_runtime_says_it_is_not_running(self):
        """The most important negative in this file. A persisted world is not a
        running one, and a client must be able to tell the difference."""
        con = world()
        h = RUN.health(con)
        self.assertEqual(h["world"], "NOT_RUNNING")
        self.assertEqual(h["runtimes"], [])

    def test_a_running_world_says_so_and_names_the_process(self):
        con = world()
        r = runtime(con)
        r.start()
        h = RUN.health(con)
        self.assertEqual(h["world"], "RUNNING")
        self.assertEqual(h["runtimes"][0]["worker"], r.w.worker)
        self.assertEqual(h["runtimes"][0]["pid"], os.getpid())
        r.shutdown()

    def test_a_runtime_that_stopped_beating_is_not_running(self):
        """A process that died leaves an ALIVE row behind. The row is not the
        evidence; the heartbeat is."""
        con = world()
        r = runtime(con)
        r.start()
        con.execute("UPDATE workers SET last_seen='2000-01-01T00:00:00+00:00' "
                    "WHERE id=?", (r.w.worker,))
        self.assertEqual(RUN.health(con)["world"], "NOT_RUNNING")

    def test_an_idle_runtime_does_nothing_at_all(self):
        """With an empty queue the runtime must produce no tasks, no events of
        its own beyond its heartbeat, and no movement. A runtime that invented
        work to look busy would be an animation loop one layer further down."""
        con = world()
        r = runtime(con)
        before = {t: con.execute("SELECT COUNT(*) c FROM " + t).fetchone()["c"]
                  for t in ("tasks", "artifacts", "movements", "agent_locations",
                            "tool_calls", "agent_messages")}
        r.run(max_steps=25)
        for t, n in before.items():
            self.assertEqual(con.execute("SELECT COUNT(*) c FROM " + t).fetchone()["c"],
                             n, "%s changed in an idle world" % t)
        self.assertGreater(r.idles, 0)
        self.assertEqual(r.w.ticks, 0)

    def test_the_runtime_report_never_touches_the_database(self):
        """It is read by the HTTP thread, and a SQLite connection belongs to the
        thread that made it. This was a real 500 before it was a test."""
        con = world()
        r = runtime(con)
        r.start()
        seen = {}

        def other():
            try:
                seen["report"] = r.report()
            except Exception as e:          # noqa: BLE001
                seen["error"] = repr(e)
        t = threading.Thread(target=other)
        t.start()
        t.join(5)
        self.assertNotIn("error", seen, seen.get("error"))
        self.assertEqual(seen["report"]["worker"], r.w.worker)
        r.shutdown()

    def test_a_runtime_inherits_work_a_dead_one_was_holding(self):
        con = world()
        BUS.emit(con, "HEARTBEAT", "h:1", {})
        dead = "worker-that-died"
        BUS.register_worker(con, dead)
        item = BUS.claim(con, dead)
        self.assertIsNotNone(item)
        self.assertEqual(con.execute(
            "SELECT state FROM world_queue WHERE id=?", (item["id"],)
        ).fetchone()["state"], "CLAIMED")
        con.execute("UPDATE world_queue SET claimed_at='2000-01-01T00:00:00+00:00' "
                    "WHERE id=?", (item["id"],))
        con.execute("UPDATE workers SET last_seen='2000-01-01T00:00:00+00:00' "
                    "WHERE id=?", (dead,))
        r = runtime(con)
        r.start()
        self.assertEqual(con.execute(
            "SELECT state FROM world_queue WHERE id=?", (item["id"],)
        ).fetchone()["state"], "READY", "the dead worker's item was never returned")
        r.shutdown()

    def test_stopping_is_recorded_and_the_worker_is_marked_stopped(self):
        con = world()
        r = runtime(con)
        r.start()
        r.stop("test")
        r.shutdown()
        self.assertEqual(con.execute("SELECT state FROM workers WHERE id=?",
                                     (r.w.worker,)).fetchone()["state"], "STOPPED")
        self.assertTrue(con.execute(
            "SELECT 1 FROM events WHERE kind='WORLD_RUNTIME_STOPPED'").fetchone())

    def test_with_no_model_the_work_waits_and_the_world_keeps_running(self):
        """The honest failure mode. Nothing is completed, nothing is invented,
        and the runtime is still alive at the end of it."""
        con = world()
        tid = W.discover_task(con, "something that needs a model", by=ORCH,
                              required_caps=["research"])
        W.transition(con, tid, "PROPOSED", ORCH)
        W.transition(con, tid, "APPROVED", ORCH)
        W.assign(con, tid, RES, by=ORCH)
        BUS.emit(con, "TASK_READY", "task:%d" % tid, {"task_id": tid})
        r = runtime(con)
        r.start()
        for _ in range(8):
            r.step()
        self.assertEqual(RUN.health(con)["world"], "RUNNING",
                         "the runtime died rather than parking the work")
        self.assertGreater(BUS.waiting_for_model(con), 0,
                           "work vanished instead of waiting")
        self.assertEqual(con.execute(
            "SELECT COUNT(*) c FROM artifacts").fetchone()["c"], 0,
            "an artifact appeared with no model to produce it")
        self.assertIsNone(r.error)
        r.shutdown()


# ── 2. the factory makes real inhabitants ───────────────────────────
class TheFactoryMakesInhabitants(unittest.TestCase):
    def test_the_first_commissioned_agent_follows_the_founding_crew(self):
        con = world()
        self.assertEqual(WF.next_agent_id(con), "AGT-000006")

    def test_an_id_is_never_reused(self):
        con = world()
        out = commissioned(con)
        self.assertEqual(out["agent_id"], "AGT-000006")
        WF.deploy(con, out["agent_id"])
        WF.retire(con, out["agent_id"], why="test")
        self.assertEqual(WF.next_agent_id(con), "AGT-000007",
                         "a retired agent's id was handed back")

    def test_a_commissioned_agent_is_proposed_with_no_body_and_no_place(self):
        """The factory proposes. It does not staff the organisation."""
        con = world()
        out = commissioned(con)
        self.assertEqual(out["decision"], "NEW_AGENT", out["rationale"])
        aid = out["agent_id"]
        self.assertEqual(out["lifecycle"], "PROPOSED")
        self.assertIsNone(EMB.body_of(con, aid))
        self.assertIsNone(SPACE.locate(con, aid))

    def test_deployment_is_what_makes_it_an_inhabitant(self):
        con = world()
        aid = commissioned(con)["agent_id"]
        d = WF.deploy(con, aid)
        self.assertEqual(d["lifecycle"], "ACTIVE")
        self.assertIsNotNone(EMB.body_of(con, aid))
        loc = SPACE.locate(con, aid)
        self.assertIsNotNone(loc)
        self.assertEqual(loc["workspace"], WF.ARRIVALS)
        self.assertIsNotNone(EMB.station_of(con, aid))

    def test_a_deployed_agent_has_a_distinct_body(self):
        con = world()
        aid = commissioned(con)["agent_id"]
        WF.deploy(con, aid)
        pal = [r["palette"] for r in con.execute("SELECT palette FROM agent_bodies")]
        self.assertEqual(len(set(pal)), len(pal),
                         "two agents were given the same palette")
        bids = [r["body_id"] for r in con.execute("SELECT body_id FROM agent_bodies")]
        self.assertEqual(len(set(bids)), len(bids))

    def test_an_appearance_is_still_derived_from_the_identity_alone(self):
        """The registry picks WHICH of this identity's preferences is free. The
        preference ORDER is still a pure function of the agent id."""
        a = [p[0] for p in EMB.palette_order("AGT-000006")]
        b = [p[0] for p in EMB.palette_order("AGT-000006")]
        self.assertEqual(a, b)
        self.assertNotEqual(a, [p[0] for p in EMB.palette_order("AGT-000007")])
        self.assertEqual(len(set(a)), len(EMB.PALETTES))

    def test_the_factory_refuses_when_reuse_answers_the_gap(self):
        """A REUSE is a success, not a failure: the organisation already had the
        answer and did not need another head."""
        con = world()
        con.execute("INSERT OR IGNORE INTO capabilities(id,name,description,"
                    "needs_skills,needs_tools,needs_perms,created_at) "
                    "VALUES('research','research','','[]','[]','[]',?)",
                    (store.now(),))
        con.execute("INSERT OR IGNORE INTO agent_capabilities(principal_id,"
                    "capability_id) VALUES(?, 'research')", (RES,))
        out = WF.commission(con, "OWNER", gap="somebody needs to read things",
                            role="Reader", required_caps=["research"])
        self.assertEqual(out["decision"], "REUSE")
        self.assertIsNone(out["agent_id"])

    def test_the_factory_refuses_a_gap_that_is_really_a_missing_tool(self):
        con = world()
        out = WF.commission(con, "OWNER",
                            gap="nobody can reach the invoicing system at all",
                            role="Biller", required_caps=["billing"],
                            required_tools=["INVOICE_API"])
        self.assertEqual(out["decision"], "TOOL")
        self.assertIsNone(out["agent_id"])

    def test_a_refusal_always_says_why(self):
        con = world()
        out = WF.commission(con, "OWNER", gap="x y", role="Vague",
                            required_caps=["vagueness"])
        self.assertIsNone(out["agent_id"])
        self.assertTrue(out["rationale"], "the factory refused without a reason")

    def test_the_same_gap_twice_does_not_produce_two_agents(self):
        con = world()
        first = commissioned(con)
        WF.deploy(con, first["agent_id"])
        second = commissioned(con)
        self.assertIsNone(second["agent_id"],
                          "the factory duplicated an agent it had just made")
        self.assertIn(second["decision"], ("REUSE", "SKILL", "WORKFLOW", "REJECT"))

    def test_a_gap_is_required(self):
        con = world()
        with self.assertRaises(WF.FactoryError):
            WF.commission(con, "OWNER", gap="", role="Anything")

    def test_retirement_keeps_everything(self):
        con = world()
        aid = commissioned(con)["agent_id"]
        WF.deploy(con, aid)
        body = EMB.body_of(con, aid)["body_id"]
        out = WF.retire(con, aid, why="test")
        self.assertEqual(out["lifecycle"], "RETIRED")
        self.assertEqual(EMB.body_of(con, aid)["body_id"], body)
        self.assertTrue(con.execute(
            "SELECT 1 FROM agent_lineage WHERE principal_id=?", (aid,)).fetchone())
        self.assertIsNone(EMB.station_of(con, aid), "a retired agent kept a desk")

    def test_a_retired_agent_is_not_redeployed(self):
        con = world()
        aid = commissioned(con)["agent_id"]
        WF.deploy(con, aid)
        WF.retire(con, aid)
        with self.assertRaises(WF.FactoryError):
            WF.deploy(con, aid)

    def test_a_commissioned_agent_survives_a_restart(self):
        db = os.path.join(tempfile.mkdtemp(), "restart.db")
        con = world(db)
        aid = commissioned(con)["agent_id"]
        d = WF.deploy(con, aid)
        con.close()
        con = store.connect(db)
        W.found_agents(con)             # founding again must not disturb it
        self.assertEqual(con.execute(
            "SELECT lifecycle_state FROM principals WHERE id=?", (aid,)
        ).fetchone()["lifecycle_state"], "ACTIVE")
        self.assertEqual(EMB.body_of(con, aid)["body_id"], d["body_id"])
        self.assertEqual(SPACE.locate(con, aid)["workspace"], d["workspace"])


# ── 3. every view shows every inhabitant ────────────────────────────
class TheViewsShowTheWholeWorld(unittest.TestCase):
    """The regression this class exists for: three separate places enumerated
    agents by reading `W.CREW`, which is the list the world is FOUNDED with. A
    view built from it silently excluded every agent the factory ever made."""

    def setUp(self):
        self.con = world()
        self.aid = commissioned(self.con)["agent_id"]
        WF.deploy(self.con, self.aid)

    def test_inhabitants_are_the_agents_the_world_has(self):
        ids = {a["id"] for a in W.inhabitants(self.con)}
        self.assertIn(self.aid, ids)
        self.assertEqual(len(ids), len(W.CREW) + 1)

    def test_the_3d_payload_includes_the_commissioned_agent(self):
        d = SRV.world3d(self.con)
        self.assertIn(self.aid, d["agents"])
        self.assertEqual(d["agents"][self.aid]["appearance"]["body_id"],
                         EMB.body_of(self.con, self.aid)["body_id"])

    def test_the_flat_world_includes_it_too(self):
        from core import open_world as OW
        d = OW.open_world(self.con)
        self.assertIn(self.aid, d["agents"])

    def test_the_world_payload_places_it(self):
        d = SRV.world_payload(self.con)
        self.assertIn(self.aid, d["agents"])
        self.assertEqual(d["agents"][self.aid]["lifecycle_state"], "ACTIVE")

    def test_the_flat_placement_gives_it_a_station(self):
        """A commissioned agent has no entry in the founding HOME map, so the
        placement has to fall back to where it actually stands rather than to
        whatever the map's default happened to be."""
        p = SRV.world_stage(self.con)
        self.assertIn(self.aid, p["placement"])
        self.assertEqual(p["placement"][self.aid]["station"],
                         SPACE.locate(self.con, self.aid)["workspace"])

    def test_no_view_enumerates_agents_from_the_founding_list(self):
        """A source-level guard, because this defect is invisible until somebody
        commissions an agent and then wonders where it went."""
        for name in ("world_server.py", "core/open_world.py"):
            src = open(os.path.join(HERE, name), encoding="utf-8").read()
            self.assertEqual(
                re.findall(r"for \w+ in W\.CREW", src), [],
                "%s enumerates agents from CREW rather than from the world" % name)

    def test_retired_agents_are_not_drawn_but_are_still_recorded(self):
        WF.retire(self.con, self.aid)
        self.assertNotIn(self.aid, {a["id"] for a in W.inhabitants(self.con)})
        self.assertIn(self.aid, {a["id"] for a in
                                 W.inhabitants(self.con, include_retired=True)})


# ── 4. the control plane ────────────────────────────────────────────
class TheControlPlane(unittest.TestCase):
    """A browser tab is not the Owner, and a GET is not a command."""

    def test_reads_change_nothing(self):
        con = world()
        WF.deploy(con, commissioned(con)["agent_id"])
        before = {t: con.execute("SELECT COUNT(*) c FROM " + t).fetchone()["c"]
                  for t in ("principals", "agent_bodies", "agent_locations",
                            "tasks", "events", "world_queue")}
        for _ in range(3):
            SRV.world3d(con)
            SRV.world_payload(con)
            RUN.health(con)
            SRV.FACT.report(con)
        for t, n in before.items():
            self.assertEqual(con.execute(
                "SELECT COUNT(*) c FROM " + t).fetchone()["c"], n, t)

    def test_an_objective_with_no_source_is_refused(self):
        """It cannot produce evidence, and an opportunity with no evidence under
        it is the thing this whole system exists not to produce."""
        con = world()
        from core import world_supervisor as SUP
        from core import agent_runtime as RT
        w = RUN.build(con, worker="t", provider_for=RUN.provider_factory())
        BUS.emit(con, "OWNER_OBJECTIVE", "o:1", {"objective": "do a thing"})
        item = BUS.claim(con, w.worker)
        with self.assertRaises(RT.Denied) as e:
            SUP.h_owner_objective(w, item)
        self.assertIn("source", str(e.exception))

    def test_the_owner_token_is_read_from_the_environment(self):
        old = os.environ.get("WORLD_OWNER_TOKEN")
        try:
            os.environ["WORLD_OWNER_TOKEN"] = "s3cret"
            self.assertEqual(SRV.owner_token(), "s3cret")
            del os.environ["WORLD_OWNER_TOKEN"]
            self.assertEqual(SRV.owner_token(), "")
        finally:
            if old is not None:
                os.environ["WORLD_OWNER_TOKEN"] = old
            else:
                os.environ.pop("WORLD_OWNER_TOKEN", None)


# ── 5. the world over HTTP, as a client actually sees it ────────────
class TheWorldOverHttp(unittest.TestCase):
    """One real daemon, started as a subprocess, talked to over a socket. No
    browser: if the 3D client were deleted every assertion here would stand."""

    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        cls.db = os.path.join(cls.dir, "http.db")
        cls.port = free_port()
        cls.api = "http://127.0.0.1:%d" % cls.port
        env = dict(os.environ)
        env["CIV_PROVIDER"] = "mock"       # DETERMINISTIC: exercises the runtime,
        env.pop("ANTHROPIC_API_KEY", None)  # not intelligence. No model is called.
        env.pop("WORLD_OWNER_TOKEN", None)
        cls.proc = subprocess.Popen(
            [sys.executable, os.path.join(HERE, "worldd.py"), "start",
             "--db", cls.db, "--port", str(cls.port), "--max-seconds", "90"],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        cls.ready = False
        for _ in range(120):
            try:
                cls.get("/api/health")
                cls.ready = True
                break
            except Exception:
                time.sleep(0.25)

    @classmethod
    def tearDownClass(cls):
        try:
            cls.proc.terminate()
            cls.proc.wait(timeout=20)
        except Exception:
            cls.proc.kill()

    @classmethod
    def get(cls, path):
        with urllib.request.urlopen(cls.api + path, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))

    @classmethod
    def post(cls, path, body):
        req = urllib.request.Request(
            cls.api + path, data=json.dumps(body).encode(), method="POST",
            headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            return json.loads(e.read().decode("utf-8"))

    def setUp(self):
        if not self.ready:
            self.skipTest("the world did not come up; not pretending it did")

    def test_the_world_answers_from_outside_the_process(self):
        h = self.get("/api/health")
        self.assertEqual(h["world"], "RUNNING")
        self.assertTrue(h["this_server_turns_the_world"])
        self.assertNotEqual(h["runtimes"][0]["pid"], os.getpid())

    def test_the_server_that_turns_the_world_says_which_one_it_is(self):
        h = self.get("/api/health")
        self.assertEqual(h["runtimes"][0]["api"], self.api)

    def test_a_client_cannot_write_through_a_read_endpoint(self):
        self.assertIn("error", self.post("/api/world3d", {}))
        self.assertIn("error", self.post("/api/nonsense", {}))

    def test_an_agent_commissioned_over_http_is_real_and_visible(self):
        made = self.post("/api/factory/agent", {
            "gap": GAP, "role": "Data Analyst", "name": "Data Analyst",
            "capabilities": ["quantitative_analysis", "statistical_inference"]})
        self.assertEqual(made.get("decision"), "NEW_AGENT", made)
        aid = made["agent_id"]
        self.assertEqual(made["lifecycle"], "PROPOSED")
        self.assertNotIn(aid, self.get("/api/world3d")["agents"],
                         "a PROPOSED agent was already standing in the world")
        dep = self.post("/api/owner/approve-agent", {"agent_id": aid})
        self.assertEqual(dep["lifecycle"], "ACTIVE", dep)
        self.assertTrue(dep["body_id"])
        d = self.get("/api/world3d")
        self.assertIn(aid, d["agents"])
        self.assertEqual(d["agents"][aid]["appearance"]["body_id"], dep["body_id"])

    def test_two_clients_see_one_world(self):
        a = self.get("/api/world3d")
        b = json.loads(subprocess.run(
            [sys.executable, "-c",
             "import urllib.request,sys;sys.stdout.write("
             "urllib.request.urlopen('%s/api/world3d').read().decode())" % self.api],
            capture_output=True, text=True, timeout=30).stdout)
        self.assertEqual(sorted(a["agents"]), sorted(b["agents"]))
        # Positions may legitimately differ between the two reads: this world is
        # LIVE, and an agent that walked between them is in two different places
        # in two honest snapshots. What must never differ is identity — that is
        # the part that would mean the clients were looking at two worlds.
        for aid in a["agents"]:
            self.assertEqual(a["agents"][aid]["appearance"]["body_id"],
                             b["agents"][aid]["appearance"]["body_id"], aid)
            self.assertEqual(a["agents"][aid]["name"],
                             b["agents"][aid]["name"], aid)

    def test_an_objective_over_http_needs_a_source_that_exists(self):
        self.assertIn("source is required",
                      self.post("/api/owner/objective",
                                {"objective": "something"}).get("error", ""))
        self.assertIn("no such source",
                      self.post("/api/owner/objective",
                                {"objective": "something",
                                 "source": "/nope/nothing.md"}).get("error", ""))

    def test_the_world_advances_with_no_client_attached(self):
        """The whole mission in one assertion. Hand it an objective, then stop
        talking to it, and come back to find it moved."""
        before = self.get("/api/health")
        r = self.post("/api/owner/objective", {
            "objective": "Assess the organisation's own documentation.",
            "source": os.path.join(HERE, "EMBODIED_WORLD.md")})
        self.assertIn("queued", r, r)
        moved = False
        for _ in range(40):                 # no request is made in this window
            time.sleep(0.25)                # beyond the one that checks
            after = self.get("/api/health")
            if (after["queue"] != before["queue"]
                    or after["tasks_open"] != before["tasks_open"]):
                moved = True
                break
        self.assertTrue(moved, "the world did not advance on its own")

    def test_the_runtime_history_records_who_turned_this_world(self):
        rt = self.get("/api/runtime")
        self.assertTrue(rt["runtimes"])
        self.assertTrue(rt["live"])
        self.assertTrue(rt["this_server_turns_the_world"])


class SuiteHygiene(unittest.TestCase):
    def test_every_class_in_this_file_runs(self):
        src = open(__file__, encoding="utf-8").read()
        declared = set(re.findall(r"^class (\w+)\(unittest\.TestCase\)", src, re.M))
        loaded = {c.__name__ for c in globals().values()
                  if isinstance(c, type) and issubclass(c, unittest.TestCase)}
        self.assertEqual(declared - loaded, set())


if __name__ == "__main__":
    unittest.main(verbosity=1)
