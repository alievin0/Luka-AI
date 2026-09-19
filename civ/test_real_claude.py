#!/usr/bin/env python3
"""THE REAL CLAUDE PATH.  python3 test_real_claude.py

Everything about the paid path that can be proven WITHOUT paying: that it fails
closed, that it never falls back to a double, that the cap refuses before the
call rather than after it, that the switch works, and that the credential never
reaches a row, a prompt or an agent.

Not one test here makes a network call. Two of them would fail if one did.

What these tests cannot establish is the thing the mission is actually about —
whether a real model can drive the loop. That needs a key and `real_claude_gate.py`.
"""
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import agent_world as W            # noqa: E402
from core import provider as P               # noqa: E402
from core import runtime                     # noqa: E402
from core import spend as SPEND              # noqa: E402
from core import store                       # noqa: E402
from core import world_policy as POL         # noqa: E402

ORCH, RES = "AGT-ORCHESTRATOR", "AGT-RESEARCHER"
# Deliberately NOT key-shaped. An `sk-ant-…` literal in a tracked file is what
# GitGuardian incident 37416729 was about, and the repo settled on a value that
# says what it is rather than one a scanner has to judge. Every assertion here
# looks for this string by name, never by shape, so nothing is weakened by it.
FAKE_KEY = "REDACTED-SYNTHETIC-PLACEHOLDER-NOT-A-CREDENTIAL"


def world(db=None, mode="simulation"):
    con = store.connect(db or os.path.join(tempfile.mkdtemp(), "claude.db"))
    store.found(con, mode=mode)
    W.found_agents(con)
    POL.seed(con)
    return con


class _NoNetwork:
    """Installs a urlopen that fails the test if anything calls out."""

    def __init__(self, case):
        self.case = case
        self.real = None

    def __enter__(self):
        import urllib.request
        self.real = urllib.request.urlopen

        def forbidden(*a, **k):
            self.case.fail("something made a network call")
        urllib.request.urlopen = forbidden
        return self

    def __exit__(self, *exc):
        import urllib.request
        urllib.request.urlopen = self.real
        return False


class _Answers(P.Provider):
    """A provider that would answer, so the guard in front of it is what is
    being tested rather than an unavailable provider."""
    name, source = "answers-double", "mock"

    def __init__(self, usd=0.01):
        self.usd, self.calls, self.model = usd, 0, "double-1"

    def available(self):
        return True

    def why_unavailable(self):
        return ""

    def complete(self, system, prompt, model=None, max_tokens=800):
        self.calls += 1
        return P.Result("OK", self.source, self.name, model or self.model,
                        text='{"type":"complete","result":"ok"}',
                        tokens_in=10, tokens_out=5, usd=self.usd)


# ═════════════════════════════════════════════════════════════════════
class ItFailsClosed(unittest.TestCase):
    """No credential, no call, no output, and no pretending."""

    def setUp(self):
        self.saved = {k: os.environ.get(k) for k in
                      ("ANTHROPIC_API_KEY", "CIV_PROVIDER", "CIV_MODEL", "CIV_EFFORT")}
        for k in self.saved:
            os.environ.pop(k, None)

    def tearDown(self):
        for k, v in self.saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_no_key_means_no_call_and_no_text(self):
        with _NoNetwork(self):
            res = P.ClaudeProvider().complete("sys", "hello")
        self.assertEqual(res.status, "NOT_CONFIGURED")
        self.assertEqual(res.text, "")
        self.assertIn("ANTHROPIC_API_KEY", res.error)

    def test_the_selector_does_not_guess_in_favour_of_working(self):
        self.assertIsInstance(P.from_env(), P.NotConfigured)
        self.assertFalse(P.from_env().available())

    def test_a_key_is_read_from_the_environment_and_nowhere_else(self):
        """Not from a file, not from a row, not from an argument default."""
        self.assertIsNone(P.ClaudeProvider().key)
        os.environ["ANTHROPIC_API_KEY"] = FAKE_KEY
        self.assertEqual(P.ClaudeProvider().key, FAKE_KEY)

    def test_a_key_present_selects_the_real_provider(self):
        os.environ["ANTHROPIC_API_KEY"] = FAKE_KEY
        prov = P.from_env()
        self.assertEqual(prov.name, "claude")
        self.assertEqual(prov.source, "model")
        self.assertTrue(prov.available())


class ItNeverFallsBackToADouble(unittest.TestCase):
    """The failure mode that would make the whole exercise worthless."""

    def test_the_gate_refuses_a_mock(self):
        import real_claude_gate as G
        os.environ["CIV_PROVIDER"] = "mock"
        try:
            prov = G.provider_from_env(SPEND.Cap(), None)
            self.assertFalse(prov.available())
            self.assertIn("not a model", prov.why_unavailable())
        finally:
            os.environ.pop("CIV_PROVIDER", None)

    def test_the_gate_exits_nonzero_with_no_model(self):
        import real_claude_gate as G
        saved, out = os.environ.pop("ANTHROPIC_API_KEY", None), io.StringIO()
        real_stdout = sys.stdout
        try:
            sys.stdout = out
            rc = G.main([])
        finally:
            sys.stdout = real_stdout
            if saved is not None:
                os.environ["ANTHROPIC_API_KEY"] = saved
        self.assertNotEqual(rc, 0)
        text = out.getvalue()
        self.assertIn("REAL INFERENCE NOT DEMONSTRATED", text)
        self.assertNotIn("REAL INFERENCE DEMONSTRATED\n", text.replace(
            "NOT DEMONSTRATED", ""))

    def test_a_green_checklist_alone_is_not_a_pass(self):
        """Every check passing, with a real-shaped provider, but no calls made
        and no rows written, must still be NOT DEMONSTRATED."""
        import real_claude_gate as G
        spender = _Answers()
        spender.source = "model"
        g = G.Gate()
        for i in range(5):
            g.check("check %d" % i, True, "")
        out, real_stdout = io.StringIO(), sys.stdout
        try:
            sys.stdout = out
            rc = G.verdict(g, SPEND.Cap(), SPEND.Budgeted(spender, SPEND.Cap()),
                           con=world(mode="live"))
        finally:
            sys.stdout = real_stdout
        self.assertNotEqual(rc, 0)
        self.assertIn("NOT DEMONSTRATED", out.getvalue())

    def test_a_double_can_never_reach_the_verdict(self):
        """Even a passing Gate does not produce success without a live model."""
        import real_claude_gate as G
        g = G.Gate()
        g.check("something", True, "")
        out, real_stdout = io.StringIO(), sys.stdout
        try:
            sys.stdout = out
            rc = G.verdict(g, SPEND.Cap(), SPEND.Budgeted(_Answers(), SPEND.Cap()))
        finally:
            sys.stdout = real_stdout
        self.assertNotEqual(rc, 0, "a mock-sourced provider reached a pass")


class TheCapRefusesBeforeItSpends(unittest.TestCase):
    """A ledger notices. A cap refuses. These are not the same thing."""

    def test_a_spent_cap_stops_the_next_call(self):
        inner = _Answers(usd=0.01)
        b = SPEND.Budgeted(inner, SPEND.Cap(max_usd=0.02, max_calls=99))
        # The ceiling for a tiny prompt at these rates is what bounds it.
        for _ in range(8):
            b.complete("s", "p", model="claude-haiku-4-5", max_tokens=100)
        self.assertLessEqual(b.cap.usd, b.cap.max_usd)
        last = b.complete("s", "p", model="claude-haiku-4-5", max_tokens=100)
        self.assertEqual(last.status, "BUDGET")
        self.assertIn("cap", last.error)

    def test_the_call_cap_stops_it_too(self):
        b = SPEND.Budgeted(_Answers(usd=0.0), SPEND.Cap(max_usd=99.0, max_calls=3))
        for _ in range(3):
            self.assertEqual(b.complete("s", "p", model="claude-haiku-4-5").status, "OK")
        self.assertEqual(b.complete("s", "p", model="claude-haiku-4-5").status, "BUDGET")
        self.assertEqual(b.inner.calls, 3, "a refused call still reached the provider")

    def test_a_refused_call_never_reaches_the_provider(self):
        inner = _Answers()
        b = SPEND.Budgeted(inner, SPEND.Cap(max_usd=0.0, max_calls=99))
        self.assertEqual(b.complete("s", "p", model="claude-opus-5").status, "BUDGET")
        self.assertEqual(inner.calls, 0)

    def test_an_unpriced_model_is_refused_rather_than_assumed_free(self):
        b = SPEND.Budgeted(_Answers(), SPEND.Cap(max_usd=10.0))
        res = b.complete("s", "p", model="some-model-we-have-no-rate-for")
        self.assertEqual(res.status, "BUDGET")
        self.assertIn("no published rate", res.error)

    def test_the_preflight_ceiling_over_counts_rather_than_under(self):
        """A cap that under-estimates is not a cap."""
        cap = SPEND.Cap()
        system, prompt = "s" * 400, "p" * 4000
        ceiling, known = cap.ceiling_for("claude-opus-5", system, prompt, 900)
        self.assertTrue(known)
        rin, rout, _ = P.rate_for("claude-opus-5")
        # Real English is ~4 chars/token; the guard assumes 3 and so bounds it.
        realistic = ((len(system) + len(prompt)) / 4.0 * rin + 900 * rout) / 1e6
        self.assertGreater(ceiling, realistic)

    def test_the_estimate_is_never_recorded_as_usage(self):
        """§7 again: the number that authorised the call is not the number
        that gets stored."""
        inner = _Answers(usd=0.004)
        b = SPEND.Budgeted(inner, SPEND.Cap(max_usd=1.0))
        b.complete("s" * 9000, "p" * 9000, model="claude-opus-5", max_tokens=900)
        self.assertAlmostEqual(b.cap.usd, 0.004, places=9)
        self.assertEqual((b.cap.tokens_in, b.cap.tokens_out), (10, 5))


class ALedgerRefusalDoesNotHideACost(unittest.TestCase):
    """The persisted ledger can refuse a charge the in-process cap allowed.
    The money is already gone at that point, so the result must survive — and
    the next call must not happen."""

    def _angry(self, res):
        raise POL.BudgetError("world:WORLD would reach $9.00 of $1.00")

    def test_the_result_is_kept_and_the_next_call_is_refused(self):
        inner = _Answers(usd=0.001)
        b = SPEND.Budgeted(inner, SPEND.Cap(max_usd=9.0, max_calls=9),
                           on_charge=self._angry)
        self.assertEqual(b.complete("s", "p", model="claude-haiku-4-5").status, "OK")
        self.assertEqual(b.complete("s", "p", model="claude-haiku-4-5").status,
                         "BUDGET")
        self.assertEqual(inner.calls, 1)
        self.assertIn("ledger refused", b.cap.refusals[0])

    def test_the_spend_that_happened_is_still_counted(self):
        inner = _Answers(usd=0.001)
        b = SPEND.Budgeted(inner, SPEND.Cap(max_usd=9.0), on_charge=self._angry)
        b.complete("s", "p", model="claude-haiku-4-5")
        self.assertAlmostEqual(b.cap.usd, 0.001, places=9)


class TheSwitchWorks(unittest.TestCase):
    def test_a_file_stops_it(self):
        d = tempfile.mkdtemp()
        stop = os.path.join(d, "STOP")
        inner = _Answers()
        b = SPEND.Budgeted(inner, SPEND.Cap(max_usd=9.0), stop_file=stop)
        self.assertEqual(b.complete("s", "p", model="claude-opus-5").status, "OK")
        open(stop, "w").close()
        res = b.complete("s", "p", model="claude-opus-5")
        self.assertEqual(res.status, "BUDGET")
        self.assertEqual(inner.calls, 1, "it called out after being stopped")
        os.remove(stop)
        self.assertEqual(b.complete("s", "p", model="claude-opus-5").status, "OK")

    def test_the_owners_pause_still_refuses_at_the_runtime(self):
        con = world()
        store.set_meta(con, "paused", True)
        rid, res = runtime.invoke(con, _Answers(), ORCH, "sys", "prompt")
        self.assertEqual(res.status, "REFUSED")
        row = con.execute("SELECT * FROM runs WHERE id=?", (rid,)).fetchone()
        self.assertEqual(row["status"], "REFUSED")


class TheWrapperCannotDisguiseWhatItWraps(unittest.TestCase):
    """An audit that can be fooled by a decorator is not an audit."""

    def test_identity_passes_through(self):
        inner = _Answers()
        b = SPEND.Budgeted(inner, SPEND.Cap())
        self.assertEqual((b.name, b.source, b.model),
                         (inner.name, inner.source, inner.model))

    def test_a_budget_stop_is_persisted_as_a_run_row(self):
        con = world()
        b = SPEND.Budgeted(_Answers(), SPEND.Cap(max_usd=0.0, max_calls=99))
        rid, res = runtime.invoke(con, b, ORCH, "sys", "prompt",
                                  model="claude-opus-5")
        row = dict(con.execute("SELECT * FROM runs WHERE id=?", (rid,)).fetchone())
        self.assertEqual(row["status"], "BUDGET")
        self.assertEqual(row["tokens_in"], 0)
        self.assertEqual(row["tokens_reported"], 0,
                         "a call that never happened reported usage")
        self.assertIn("cap", row["error"])

    def test_a_budget_stop_is_not_retried_as_a_transport_failure(self):
        from core import agent_runtime as RT
        res = P.Result("BUDGET", "model", "claude", "claude-opus-5",
                       error="would reach $0.60000 of the $0.50000 cap")
        self.assertFalse(RT._transport_failure(res))


class TheDatabaseRefusesTheFallback(unittest.TestCase):
    """LAW 2, the half that matters here.

    Every no-fallback check elsewhere in this suite is Python I wrote, and
    Python I wrote can be edited by someone who wants a green gate. This one is
    a trigger: in a world founded LIVE, a run whose source is `mock` is refused
    by the database. It does not matter what the calling code intended."""

    def test_a_live_world_refuses_a_mock_run(self):
        con = world(mode="live")
        with self.assertRaises(Exception) as caught:
            runtime.invoke(con, _Answers(), ORCH, "sys", "prompt")
        self.assertIn("LAW 2", str(caught.exception))
        self.assertEqual(con.execute(
            "SELECT COUNT(*) c FROM runs WHERE status='OK'").fetchone()["c"], 0)

    def test_a_simulation_refuses_a_real_model_run(self):
        """The other half, which is why the gate cannot run in a simulation."""
        con = world(mode="simulation")
        real = _Answers()
        real.source = "model"
        with self.assertRaises(Exception) as caught:
            runtime.invoke(con, real, ORCH, "sys", "prompt")
        self.assertIn("LAW 2", str(caught.exception))

    def test_the_gate_founds_its_world_live(self):
        import real_claude_gate as G
        con = G.live_world()
        self.assertEqual(store.meta(con, "mode"), "live")


class TheAutonomousWorldCannotSpendFreely(unittest.TestCase):
    """The hazard this mission creates: a world that keeps running by itself is
    exactly the thing that must not be able to run up a bill by itself."""

    def test_a_spending_provider_is_capped_before_the_world_gets_it(self):
        from core import world_runtime as RUN
        spender = _Answers()
        spender.source = "model"          # can spend
        make = RUN.provider_factory(force=spender)
        got = make("AGT-RESEARCHER", None, 1)
        self.assertIsInstance(got, SPEND.Budgeted)
        self.assertIs(got.inner, spender)

    def test_a_provider_that_cannot_spend_is_handed_back_untouched(self):
        """A world with no model, and every existing test, must be unaffected."""
        from core import world_runtime as RUN
        for prov in (P.MockProvider(), P.NotConfigured("nothing here")):
            got = RUN.provider_factory(force=prov)("AGT-RESEARCHER", None, 1)
            self.assertIs(got, prov, prov.name)

    def test_the_cap_is_the_worlds_not_the_turns(self):
        """One cap for the process. A per-call cap would reset every turn and
        bound nothing."""
        from core import world_runtime as RUN
        spender = _Answers(usd=0.01)
        spender.source = "model"
        make = RUN.provider_factory(force=spender, cap=SPEND.Cap(max_usd=9.0,
                                                                 max_calls=2))
        make("a", None, 1).complete("s", "p", model="claude-haiku-4-5")
        make("b", None, 1).complete("s", "p", model="claude-haiku-4-5")
        third = make("c", None, 1).complete("s", "p", model="claude-haiku-4-5")
        self.assertEqual(third.status, "BUDGET")
        self.assertEqual(spender.calls, 2)

    def test_a_detached_world_is_founded_in_the_mode_that_was_asked_for(self):
        """--mode live --detach has to reach the child. The child is the world;
        the parent exits. A mode that stops at the fork founds a simulation,
        and LAW 2 would then refuse every real model run in it."""
        import inspect
        import worldd
        self.assertIn("mode", inspect.signature(worldd._detach).parameters)
        self.assertIn("mode=mode", inspect.getsource(worldd._detach))

    def test_the_daemon_offers_a_switch_beside_its_database(self):
        import worldd
        d = tempfile.mkdtemp()
        stop = worldd._stopfile(os.path.join(d, "world.db"))
        self.assertEqual(os.path.dirname(stop), d)
        self.assertTrue(os.path.basename(stop).startswith("."))
        from core import world_runtime as RUN
        spender = _Answers()
        spender.source = "model"
        b = RUN.provider_factory(force=spender, stop_file=stop)("a", None, 1)
        open(stop, "w").close()
        self.assertEqual(b.complete("s", "p", model="claude-opus-5").status,
                         "BUDGET")
        self.assertEqual(spender.calls, 0)


class ThePaidPathsQueriesAreRealQueries(unittest.TestCase):
    """The gate's own SQL runs against the live schema.

    Everything in `real_claude_gate.py` past section 3 needs a credential, so
    none of it is exercised here — which is exactly how it shipped with
    `agent_messages.sender_id` in two queries. That column does not exist; it
    is `sender`. Both would have raised on the paid path, after the money was
    spent. These tests run the shapes without the model."""

    def setUp(self):
        import real_claude_gate as G
        self.G = G
        self.con = G.live_world()

    def test_the_helpers_build_a_real_task_in_a_live_world(self):
        tid = self.G.a_task(self.con, "do the thing", __file__,
                            conds=[{"description": "a source was actually read",
                                    "kind": "evidence"}])
        row = self.con.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
        self.assertEqual(row["status"], "APPROVED")
        self.assertEqual(store.meta(self.con, "mode"), "live")

    def test_the_agent_to_agent_query_names_columns_that_exist(self):
        rows = self.con.execute(
            "SELECT * FROM agent_messages WHERE sender=? AND recipient=? "
            "ORDER BY id DESC", (RES, "AGT-BUILDER")).fetchall()
        self.assertEqual(rows, [])

    def test_the_forged_sender_query_names_columns_that_exist(self):
        c = self.con.execute(
            "SELECT COUNT(*) c FROM agent_messages WHERE sender "
            "NOT IN (SELECT id FROM principals)").fetchone()["c"]
        self.assertEqual(c, 0)

    def test_the_forgery_the_gate_attempts_is_actually_refused(self):
        gw = W.build_gateway(self.con)
        with self.assertRaises(Exception):
            gw.call(RES, "SEND_MESSAGE", principal_id="AGT-BUILDER",
                    to="AGT-REVIEWER", text="not from me", kind="REPORT")

    def test_the_source_the_gate_reads_is_inside_the_repo_scope(self):
        """READ_REPO is path-scoped. A gate pointing the model at a file
        outside the scope would be testing the scope, not the model."""
        import real_claude_gate as G
        src = os.path.join(os.path.dirname(os.path.abspath(G.__file__)),
                           "AGENT_WORLD_SERVER.md")
        self.assertTrue(os.path.exists(src))
        self.assertTrue(G.first_line_of(src).startswith("#"))


class TheRecorderIsTransparent(unittest.TestCase):
    """The gate wraps the provider to capture prompts. A wrapper that altered
    anything would be measuring itself."""

    def test_it_changes_nothing_about_the_call(self):
        import real_claude_gate as G
        inner = _Answers()
        rec = G.Recorder(inner)
        self.assertEqual((rec.name, rec.source, rec.model),
                         (inner.name, inner.source, inner.model))
        res = rec.complete("sys", "prompt", model="claude-opus-5", max_tokens=99)
        self.assertEqual(res.status, "OK")
        self.assertEqual(inner.calls, 1)

    def test_it_keeps_every_prompt_in_order(self):
        import real_claude_gate as G
        rec = G.Recorder(_Answers())
        rec.complete("sys", "first")
        rec.complete("sys", "second")
        self.assertEqual(rec.saw, ["first", "second"])

    def test_a_cap_refusal_still_gets_through_it(self):
        import real_claude_gate as G
        rec = G.Recorder(SPEND.Budgeted(_Answers(),
                                        SPEND.Cap(max_usd=0.0, max_calls=99)))
        self.assertEqual(rec.complete("s", "p", model="claude-opus-5").status,
                         "BUDGET")


class TheCredentialStaysOutOfTheWorld(unittest.TestCase):
    def setUp(self):
        self.saved = os.environ.get("ANTHROPIC_API_KEY")
        os.environ["ANTHROPIC_API_KEY"] = FAKE_KEY

    def tearDown(self):
        if self.saved is None:
            os.environ.pop("ANTHROPIC_API_KEY", None)
        else:
            os.environ["ANTHROPIC_API_KEY"] = self.saved

    def test_it_is_in_no_row_a_run_writes(self):
        con = world(mode="live")
        rid, _ = runtime.invoke(con, P.ClaudeProvider(key=FAKE_KEY), ORCH,
                                "system text", "prompt text", model="claude-opus-5")
        for row in con.execute("SELECT * FROM runs"):
            self.assertNotIn(FAKE_KEY, json.dumps(dict(row), default=str))
        for row in con.execute("SELECT * FROM events"):
            self.assertNotIn(FAKE_KEY, json.dumps(dict(row), default=str))

    def test_it_is_not_in_the_contract_an_agent_is_given(self):
        from core import agent_runtime as RT
        con = world()
        tid = W.discover_task(con, "do something", by=ORCH, required_caps=["research"])
        W.transition(con, tid, "PROPOSED", ORCH)
        W.transition(con, tid, "APPROVED", ORCH)
        text = RT.contract_prompt(con, RES, tid)
        self.assertNotIn(FAKE_KEY, text)
        for word in ("anthropic", "api_key", "x-api-key"):
            self.assertNotIn(word, text.lower())

    def test_an_agent_identity_carries_no_credential(self):
        con = world()
        row = dict(con.execute("SELECT * FROM principals WHERE id=?",
                               (RES,)).fetchone())
        self.assertNotIn(FAKE_KEY, json.dumps(row, default=str))

    def test_an_http_error_body_is_recorded_without_the_key(self):
        """The one place a key could plausibly be echoed back at us."""
        import urllib.request
        real = urllib.request.urlopen

        def boom(*a, **k):
            raise urllib.error.HTTPError(
                "https://api.anthropic.com/v1/messages", 401, "Unauthorized", {},
                io.BytesIO(b'{"error":{"message":"invalid x-api-key"}}'))
        urllib.request.urlopen = boom
        try:
            res = P.ClaudeProvider(key=FAKE_KEY).complete("s", "p")
        finally:
            urllib.request.urlopen = real
        self.assertEqual(res.status, "FAILED")
        self.assertIn("401", res.error)
        self.assertNotIn(FAKE_KEY, res.error)


class TheRequestIsWhatWeThinkItIs(unittest.TestCase):
    """What actually goes on the wire, captured without sending it."""

    def _body(self, prov, **kw):
        import urllib.request
        real, seen = urllib.request.urlopen, {}

        def capture(req, *a, **k):
            seen["url"] = req.full_url
            seen["headers"] = dict(req.header_items())
            seen["body"] = json.loads(req.data.decode("utf-8"))
            raise urllib.error.URLError("not sent")
        urllib.request.urlopen = capture
        try:
            prov.complete(kw.pop("system", "sys"), kw.pop("prompt", "hi"), **kw)
        finally:
            urllib.request.urlopen = real
        return seen

    def test_the_default_body_is_unchanged_from_the_campaign_era(self):
        """Three closed campaigns ran against this request shape. Adding a
        field to it by default would change what a re-run sends."""
        seen = self._body(P.ClaudeProvider(key=FAKE_KEY), max_tokens=700)
        self.assertEqual(sorted(seen["body"]),
                         ["max_tokens", "messages", "model", "system"])

    def test_effort_appears_only_when_asked_for(self):
        seen = self._body(P.ClaudeProvider(key=FAKE_KEY, effort="low"))
        self.assertEqual(seen["body"]["output_config"], {"effort": "low"})

    def test_the_key_travels_in_the_header_and_not_the_body(self):
        seen = self._body(P.ClaudeProvider(key=FAKE_KEY))
        self.assertNotIn(FAKE_KEY, json.dumps(seen["body"]))
        self.assertIn(FAKE_KEY, json.dumps(seen["headers"]))

    def test_the_endpoint_is_the_published_one_by_default(self):
        seen = self._body(P.ClaudeProvider(key=FAKE_KEY))
        self.assertEqual(seen["url"], "https://api.anthropic.com/v1/messages")

    def test_the_endpoint_is_configurable_without_editing_code(self):
        prov = P.ClaudeProvider(key=FAKE_KEY, base_url="https://gateway.internal")
        self.assertEqual(self._body(prov)["url"],
                         "https://gateway.internal/v1/messages")

    def test_building_the_gate_does_not_change_what_anything_else_sends(self):
        """R-leak: the gate applied its model/effort defaults by writing
        CIV_MODEL and CIV_EFFORT into os.environ. Every ClaudeProvider built
        afterwards in that process then carried them — including a benchmark
        re-run, which would have sent a different request body than the one
        three closed campaigns ran against, without anybody asking it to."""
        import real_claude_gate as G
        before = (os.environ.get("CIV_MODEL"), os.environ.get("CIV_EFFORT"))
        G.provider_from_env(SPEND.Cap(), None)
        self.assertEqual((os.environ.get("CIV_MODEL"),
                          os.environ.get("CIV_EFFORT")), before)
        self.assertIsNone(P.ClaudeProvider(key=FAKE_KEY).effort)
        seen = self._body(P.ClaudeProvider(key=FAKE_KEY))
        self.assertNotIn("output_config", seen["body"])

    def test_the_gate_still_gets_its_own_defaults(self):
        import real_claude_gate as G
        saved = os.environ.get("ANTHROPIC_API_KEY")
        os.environ["ANTHROPIC_API_KEY"] = FAKE_KEY
        try:
            inner = G.provider_from_env(SPEND.Cap(), None).inner
            self.assertEqual(inner.model, G.DEFAULT_MODEL)
            self.assertEqual(inner.effort, G.DEFAULT_EFFORT)
        finally:
            if saved is None:
                os.environ.pop("ANTHROPIC_API_KEY", None)
            else:
                os.environ["ANTHROPIC_API_KEY"] = saved

    def test_the_published_rates_match_what_the_ledger_charges(self):
        for model, (rin, rout) in (("claude-opus-5", (5.0, 25.0)),
                                   ("claude-sonnet-5", (2.0, 10.0)),
                                   ("claude-haiku-4-5", (1.0, 5.0))):
            got_in, got_out, known = P.rate_for(model)
            self.assertTrue(known, model)
            self.assertEqual((got_in, got_out), (rin, rout), model)


class TheWorldStillRunsWithoutAModel(unittest.TestCase):
    """The regression that keeps the absence honest — §15, unchanged by any of
    the above."""

    def test_nothing_here_made_the_no_model_path_optimistic(self):
        con = world()
        rid, res = runtime.invoke(con, P.NotConfigured("no key in test"), ORCH,
                                  "sys", "prompt")
        self.assertEqual(res.status, "NOT_CONFIGURED")
        self.assertEqual(res.text, "")
        self.assertEqual(con.execute(
            "SELECT COUNT(*) c FROM artifacts").fetchone()["c"], 0)
        self.assertEqual(con.execute(
            "SELECT COUNT(*) c FROM runs WHERE status='OK'").fetchone()["c"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
