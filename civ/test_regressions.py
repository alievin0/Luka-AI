#!/usr/bin/env python3
"""REGRESSION SUITE — one named test per defect ever found in this project.

Each test names where the defect was discovered. If a test here fails, a bug we
already paid for has come back. Run with:  python3 test_regressions.py

R1–R3  defects found while building civ/ (the tests caught them before shipping)
R4–R9  findings from civ/01-AUDIT.md — the world/ defects civ/ must never repeat
R10    the world/ defects found by running it, still covered by world/test_world.py
"""
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from core import provider as P          # noqa: E402
from core import runtime, store         # noqa: E402
import slice as vslice                  # noqa: E402


def fresh(mode="simulation"):
    con = store.connect(os.path.join(tempfile.mkdtemp(), "r.db"))
    store.found(con, mode=mode)
    vslice.register_crew(con)
    return con


# ── R1–R3: defects found while building civ/ ─────────────────────────
class R1_ModePurityWasNeverEnforced(unittest.TestCase):
    """Found 2026-09-17 while writing L4.

    set_meta stores JSON, so world_meta.mode held '"simulation"' WITH QUOTES while
    the trigger compared it to an unquoted 'simulation'. The law never fired once.
    It looked present in the schema and was absent in behaviour.
    """
    def test_stored_mode_is_still_json_quoted(self):
        con = fresh("simulation")
        raw = con.execute("SELECT value FROM world_meta WHERE key='mode'").fetchone()[0]
        self.assertEqual(raw, '"simulation"',
                         "storage format changed; re-check the trigger's json_extract")

    def test_the_trigger_reads_through_json_extract(self):
        with open(os.path.join(HERE, "core", "schema.sql"), encoding="utf-8") as fh:
            sql = fh.read()
        self.assertIn("json_extract(value,'$') FROM world_meta WHERE key='mode'", sql,
                      "the trigger must not compare the raw JSON value")

    def test_and_therefore_actually_fires(self):
        con = fresh("simulation")
        with self.assertRaises(sqlite3.IntegrityError) as e:
            con.execute("INSERT INTO runs(principal_id,source,provider,model,prompt_sha,status,"
                        "started_at) VALUES('AGT-000002','model','claude','m','s','OK',?)",
                        (store.now(),))
        self.assertIn("LAW 2", str(e.exception))


class R2_ShortLeaseCouldNotExpire(unittest.TestCase):
    """Found 2026-09-17 while writing L7.

    Timestamps were truncated to whole seconds, so a lease granted at T expiring
    at T+1 still compared as valid after sleeping 1.2s. Short leases were immortal,
    which silently disables the crash-recovery path.
    """
    def test_timestamps_carry_sub_second_precision(self):
        t = store.now()
        self.assertRegex(t, r"\d{2}:\d{2}:\d{2}\.\d{6}",
                         "now() lost microseconds; short leases become un-expirable")

    def test_a_one_second_lease_really_expires(self):
        con = fresh()
        tid = runtime.enqueue(con, "x", "build", "AGT-000001", required_caps=["READ_REPO"])
        lease = runtime.claim(con, "AGT-000002", lease_seconds=1)
        self.assertTrue(runtime.lease_valid(con, lease["lease_id"]))
        time.sleep(1.2)
        self.assertFalse(runtime.lease_valid(con, lease["lease_id"]))
        self.assertEqual(runtime.reap_expired(con), 1)
        self.assertEqual(con.execute("SELECT status FROM tasks WHERE id=?",
                                     (tid,)).fetchone()["status"], "QUEUED")


class R3_LawWasOverBroad(unittest.TestCase):
    """Found 2026-09-17 when L1 broke after R1 was fixed.

    Mode purity initially blocked ANY model-sourced run in a simulation world,
    including a NOT_CONFIGURED attempt that produced nothing. Recording a refusal
    IS the honesty, so the law must govern produced content only.
    """
    def test_not_configured_is_recordable_in_a_simulation_world(self):
        con = fresh("simulation")
        rid, res = runtime.invoke(con, P.NotConfigured("no key"), "AGT-000002", "s", "p")
        self.assertEqual(res.status, "NOT_CONFIGURED")
        row = con.execute("SELECT source, status FROM runs WHERE id=?", (rid,)).fetchone()
        self.assertEqual((row["source"], row["status"]), ("model", "NOT_CONFIGURED"))

    def test_but_a_successful_model_run_is_still_blocked(self):
        con = fresh("simulation")
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO runs(principal_id,source,provider,model,prompt_sha,status,"
                        "started_at) VALUES('AGT-000002','model','claude','m','s','STARTED',?)",
                        (store.now(),))


# ── R4–R9: the audit findings civ/ must never repeat ─────────────────
class R4_ProvenanceWasComputedThenDiscarded(unittest.TestCase):
    """AUDIT F1 — world/engine.py took `src` from mind.think(), used it for one
    counter, and dropped it before persistence. organs had no source column, so
    lexicon text and model text were indistinguishable forever."""
    def test_artifact_cannot_exist_without_a_run(self):
        con = fresh()
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO artifacts(run_id,principal_id,kind,name,sha,source,"
                        "created_at) VALUES(NULL,'AGT-000002','code','x','s','mock',?)",
                        (store.now(),))

    def test_artifact_source_cannot_differ_from_its_run(self):
        con = fresh()
        rid = con.execute("INSERT INTO runs(principal_id,source,provider,model,prompt_sha,"
                          "status,started_at) VALUES('AGT-000002','mock','mock','m','s','OK',?)",
                          (store.now(),)).lastrowid
        with self.assertRaises(sqlite3.IntegrityError) as e:
            con.execute("INSERT INTO artifacts(run_id,principal_id,kind,name,sha,source,"
                        "created_at) VALUES(?,'AGT-000002','code','x','s','model',?)",
                        (rid, store.now()))
        self.assertIn("LAW 1", str(e.exception))

    def test_every_artifact_in_a_real_slice_carries_its_source(self):
        con = fresh()
        out = vslice.run_slice(con, P.MockProvider(), verbose=False)
        for a in con.execute("SELECT * FROM artifacts"):
            self.assertIn(a["source"], ("model", "mock", "lexicon", "human"))
            self.assertIsNotNone(a["run_id"])


class R5_WorldDidNotRecordItsMode(unittest.TestCase):
    """AUDIT F2 — world/ persisted only day/founded/seed/size/treasury, so an
    offline world and a live world were structurally identical files."""
    def test_mode_is_persisted_and_survives_reopen(self):
        path = os.path.join(tempfile.mkdtemp(), "m.db")
        con = store.connect(path); store.found(con, mode="hybrid"); con.close()
        self.assertEqual(store.meta(store.connect(path), "mode"), "hybrid")

    def test_founding_twice_is_refused(self):
        con = fresh()
        with self.assertRaises(RuntimeError):
            store.found(con, mode="live")


class R6_ADeclaredTableNothingWrites(unittest.TestCase):
    """AUDIT F3 — world/ declared a memories table, indexed it, and never wrote a
    single row. A schema that promises a capability the code does not use is a lie
    told in SQL."""
    def test_a_full_run_populates_every_declared_table(self):
        """The runtime slice plus the organisational chain must leave no table
        declared-but-unused. A schema promising what the code never does is F3."""
        import bench_run as BR
        import org_demo
        con = fresh()
        org_demo.run(con, verbose=False)
        BR.dry_run_into(con)          # exercises the benchmark tables too
        empty = []
        for (t,) in con.execute("SELECT name FROM sqlite_master WHERE type='table' "
                                "AND name NOT LIKE 'sqlite_%' ORDER BY name"):
            if con.execute("SELECT COUNT(*) FROM %s" % t).fetchone()[0] == 0:
                empty.append(t)
        self.assertEqual(empty, [],
                         "declared but never written: %s — either use them or remove them"
                         % empty)


class R7_DistinctnessWasUnevaluable(unittest.TestCase):
    """AUDIT F4 — world/ had 1000 rows and 21 distinct (house, role) pairs, and all
    five columns the distinctness invariant needs were absent, so the invariant
    could not even be checked."""
    def test_the_five_columns_exist(self):
        con = fresh()
        cols = {r[1] for r in con.execute("PRAGMA table_info(principals)")}
        for need in ("tools", "permissions", "memory_scope",
                     "success_metrics", "escalation_rules"):
            self.assertIn(need, cols)

    def test_a_materially_identical_agent_cannot_be_inserted(self):
        con = fresh()
        r = con.execute("SELECT * FROM principals WHERE id='AGT-000003'").fetchone()
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO principals(id,name,role,division,department,tier,mission,"
                        "tools,permissions,memory_scope,success_metrics,escalation_rules,"
                        "created_at) VALUES('AGT-CLONE','C','C',?,?,?,?,?,?,?,?,?,?)",
                        (r["division"], r["department"], r["tier"], r["mission"], r["tools"],
                         r["permissions"], r["memory_scope"], r["success_metrics"],
                         r["escalation_rules"], store.now()))

    def test_every_registered_agent_is_actually_distinct(self):
        con = fresh()
        n = con.execute("SELECT COUNT(*) c FROM principals").fetchone()["c"]
        d = con.execute("SELECT COUNT(*) c FROM (SELECT DISTINCT tools,permissions,"
                        "memory_scope,success_metrics,escalation_rules FROM principals)"
                        ).fetchone()["c"]
        self.assertEqual(n, d, "%d agents collapse into %d real kinds" % (n, d))


class R8_HistoryWasMutable(unittest.TestCase):
    """AUDIT F5 — proved by deleting an events row with one statement (11040→11039)."""
    def test_delete_is_refused(self):
        con = fresh()
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("DELETE FROM events")

    def test_update_is_refused(self):
        con = fresh()
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("UPDATE events SET kind='X'")

    def test_the_chain_detects_tampering_if_a_trigger_were_dropped(self):
        con = fresh()
        for i in range(6):
            store.event(con, "T", payload={"i": i})
        self.assertTrue(store.verify_chain(con)[0])
        con.execute("DROP TRIGGER law_events_no_update")       # simulate the law removed
        con.execute("UPDATE events SET kind='TAMPERED' WHERE id=2")
        ok, bad = store.verify_chain(con)
        self.assertFalse(ok, "the hash chain must catch what the trigger no longer blocks")
        self.assertEqual(bad, 2)


class R9_LivePathWasSilentlyUnverified(unittest.TestCase):
    """AUDIT F7 — world/mind.py had _claude()/_ollama() that no test ever reached, and
    the system was described as having a live mode when it had live code."""
    def test_the_live_conformance_test_exists_and_is_gated_on_a_real_key(self):
        with open(os.path.join(HERE, "test_civ.py"), encoding="utf-8") as fh:
            src = fh.read()
        self.assertIn("test_claude_conforms_live", src)
        self.assertIn("skipUnless(os.environ.get(\"ANTHROPIC_API_KEY\")", src)
        self.assertIn("UNVERIFIED", src, "the skip message must say the path is unverified")

    def test_the_skip_is_loud_in_the_runner_output(self):
        env = dict(os.environ); env.pop("ANTHROPIC_API_KEY", None)
        r = subprocess.run([sys.executable, "test_civ.py"], cwd=HERE, env=env,
                           capture_output=True, text=True, timeout=180)
        self.assertIn("L10-LIVE SKIPPED", r.stdout + r.stderr,
                      "a skipped live test must announce itself, never pass quietly")

    def test_an_unavailable_provider_yields_no_text(self):
        for prov in (P.NotConfigured(), P.ClaudeProvider(model="m", key=None)):
            r = prov.complete("s", "p")
            self.assertEqual(r.status, "NOT_CONFIGURED")
            self.assertEqual(r.text, "")


# ── R10: the world/ defects stay covered ─────────────────────────────
class R10_WorldEngineDefectsStayCovered(unittest.TestCase):
    """The three defects found by running world/ keep their tests."""
    def test_world_suite_still_covers_them(self):
        with open(os.path.join(REPO, "world", "test_world.py"), encoding="utf-8") as fh:
            src = fh.read()
        for name in ("test_the_wound_belongs_to_its_own_idea",
                     "test_an_idea_is_nominated_once",
                     "test_no_incomplete_body_stands_before_the_king"):
            self.assertIn(name, src, "world/ regression test %s was removed" % name)

    def test_world_suite_passes(self):
        r = subprocess.run([sys.executable, "test_world.py"],
                           cwd=os.path.join(REPO, "world"),
                           capture_output=True, text=True, timeout=300)
        self.assertIn("OK", r.stderr, r.stderr[-400:])


# ── the laws must not change meaning silently ────────────────────────
class LawsAreFrozen(unittest.TestCase):
    """PHASE 1 requirement: do not silently change the semantics of existing laws."""
    EXPECTED = {
        "law_mode_purity", "law_mode_purity_live", "law_split_brain_insert",
        "law_split_brain_update", "law_provenance_matches", "law_no_unbacked_fact_insert",
        "law_no_unbacked_fact_update", "law_independent_review",
        "law_events_no_delete", "law_events_no_update",
    }

    def test_every_law_is_installed(self):
        con = fresh()
        got = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
        self.assertEqual(self.EXPECTED - got, set(), "law(s) missing from the schema")

    def test_the_distinctness_index_is_installed(self):
        con = fresh()
        idx = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='index'")}
        self.assertIn("law_distinctness", idx)

    def test_adding_a_law_requires_updating_this_list(self):
        with open(os.path.join(HERE, "core", "schema.sql"), encoding="utf-8") as fh:
            sql = fh.read()
        declared = set(re.findall(r"CREATE TRIGGER (law_\w+)", sql))
        self.assertEqual(declared, self.EXPECTED,
                         "schema laws and the frozen list disagree — update BASELINE.md too")




# ── R11–R12: holes found by the security benchmark ───────────────────
class R11_AllowlistedInterpreterWasArbitraryExecution(unittest.TestCase):
    """Found 2026-09-17 by test_security.py S2.

    EXECUTE_SANDBOX allowlisted argv0 ("python3") and denied substrings like
    "curl". `python3 -c "import urllib.request"` passed both checks and is
    arbitrary code execution. An allowlisted interpreter is a shell unless its
    FLAGS are forbidden too.
    """
    def setUp(self):
        self.con = fresh()
        self.gw = vslice.build_gateway(self.con)

    def test_dash_c_is_refused(self):
        with self.assertRaises(runtime.Denied) as e:
            self.gw.call("AGT-000003", "EXECUTE_SANDBOX",
                         argv=["python3", "-c", "import urllib.request"])
        self.assertIn("flags are not permitted", str(e.exception))

    def test_dash_m_is_refused(self):
        with self.assertRaises(runtime.Denied):
            self.gw.call("AGT-000003", "EXECUTE_SANDBOX", argv=["python3", "-m", "http.server"])

    def test_a_script_outside_the_artifact_root_is_refused(self):
        with self.assertRaises(runtime.Denied):
            self.gw.call("AGT-000003", "EXECUTE_SANDBOX",
                         argv=["python3", os.path.join(HERE, "owner.py")])

    def test_extra_arguments_are_refused(self):
        with self.assertRaises(runtime.Denied):
            self.gw.call("AGT-000003", "EXECUTE_SANDBOX",
                         argv=["python3", os.path.join(vslice.ARTIFACT_DIR, "x.py"), "--evil"])


class R12_ToolArgsCouldShadowGatewayParameters(unittest.TestCase):
    """Found 2026-09-17 by S2's grant-permission test.

    Gateway.call(self, principal_id, cap, lease_id=None, **args) meant a tool
    argument literally named `cap` collided with the gateway's own parameter —
    attacker-chosen argument NAMES are untrusted input too. Now positional-only.
    """
    def test_an_arg_named_cap_does_not_shadow_the_capability(self):
        con = fresh()
        gw = vslice.build_gateway(con)
        with self.assertRaises(runtime.Denied):
            gw.call("AGT-000002", "GRANT_PERMISSION", cap="DEPLOY_PRODUCTION")

    def test_args_named_like_gateway_params_are_just_data(self):
        con = fresh()
        gw = vslice.build_gateway(con)
        for name in ("cap", "principal_id", "lease_id"):
            with self.assertRaises(runtime.Denied):
                gw.call("AGT-000004", "EXECUTE_SANDBOX", **{name: "x"})

    def test_the_signature_is_positional_only(self):
        import inspect
        sig = inspect.signature(runtime.Gateway.call)
        kinds = [p.kind for p in sig.parameters.values()]
        self.assertIn(inspect.Parameter.POSITIONAL_ONLY, kinds,
                      "gateway params must stay positional-only")


class R13_ScopeAndToolMustAgreeOnPaths(unittest.TestCase):
    """Found 2026-09-17 when scopes were first switched on.

    The gateway resolved a relative path against CWD while the tool resolved it
    against the artifact dir. Two resolutions of one argument is how a check
    passes on one string while the tool acts on another. The gateway now
    canonicalises first and the tool receives the resolved value.
    """
    def test_relative_paths_resolve_against_the_grant_root(self):
        con = fresh()
        gw = vslice.build_gateway(con)
        out = gw.call("AGT-000002", "WRITE_ARTIFACT", path="regression_probe.py", body="x=1\n")
        self.assertTrue(out.startswith(os.path.abspath(vslice.ARTIFACT_DIR) + os.sep))
        os.remove(out)

    def test_the_logged_args_are_the_executed_args(self):
        con = fresh()
        gw = vslice.build_gateway(con)
        out = gw.call("AGT-000002", "WRITE_ARTIFACT", path="probe2.py", body="x=1\n")
        row = con.execute("SELECT args_sha FROM tool_calls ORDER BY id DESC LIMIT 1").fetchone()
        self.assertEqual(row["args_sha"], store.sha({"path": out, "body": "x=1\n"}))
        os.remove(out)


class R14_TestSuitesMustCollectEveryClass(unittest.TestCase):
    """Found 2026-09-17: classes appended AFTER the __main__ block were never
    collected, so the suite silently under-counted while reporting OK."""

    def test_every_test_class_in_this_file_is_collected(self):
        import inspect
        mod = sys.modules[__name__]
        declared = {n for n, o in inspect.getmembers(mod, inspect.isclass)
                    if issubclass(o, unittest.TestCase) and o.__module__ == __name__}
        with open(__file__, encoding="utf-8") as fh:
            src = fh.read()
        in_file = set(re.findall(r"^class (\w+)\(unittest\.TestCase\)", src, re.M))
        self.assertEqual(in_file - declared, set(),
                         "class(es) defined after the __main__ block are never run")

    def test_the_main_block_is_last(self):
        with open(__file__, encoding="utf-8") as fh:
            src = fh.read()
        self.assertTrue(src.rstrip().endswith("unittest.main(verbosity=2)"),
                        "__main__ must be the last thing in the file")


class R15_BenchmarkAnswerKeyWasWrong(unittest.TestCase):
    """Found 2026-09-17 while writing test_bench.py.

    Benchmark task T07 declared the answer to its own arithmetic chain as
    1287.0. The chain (7^2, +200, *3, -60, /2, +15) is 358.5. Every model that
    computed it CORRECTLY would have been scored wrong, in BOTH conditions. A
    benchmark that marks the right answer wrong is worse than no benchmark.
    """
    def test_every_numeric_answer_key_is_independently_recomputed(self):
        from core import bench_tasks as BT
        v = 7 ** 2
        v = (v + 200) * 3 - 60
        v = v / 2 + 15
        t7 = [t for t in BT.TASKS if t["id"] == "T07-long-chain"][0]
        self.assertEqual(t7["expected"]["value"], v)
        self.assertEqual(BT.check_chain("", {"returncode": 0, "stdout": str(v)}, {})
                         ["correctness"], 1.0)

    def test_the_paid_gross_key_is_independently_recomputed(self):
        from core import bench_tasks as BT
        expected = round(sum(r["net"] * (1 + r["vat_rate"])
                             for r in BT.INVOICE_ROWS if r["paid"]), 4)
        self.assertEqual(BT.PAID_GROSS, expected)
        self.assertEqual(BT.check_tool_required(str(expected), {}, {})["correctness"], 1.0)


from core import bench_tasks as BT            # noqa: E402
from core import benchmark as B               # noqa: E402


class R16_InvertedFactualChecker(unittest.TestCase):
    """Found by the FIRST REAL BENCHMARK CAMPAIGN, 2026-09-17.

    T06 scored correctness 0.0 in all ten cells — both conditions, every repeat —
    while completeness read 1.0, which meant the models had actually answered
    correctly and the checker was throwing the result away. The rule
    `repeated_brochure = "kuwait" in low and "5%" in low` fired on any answer that
    cited the brochure in order to REJECT it, which is precisely what the task
    asks for. The benchmark's own best case for multi-agent measured nothing, and
    it cost real money to learn that."""

    def test_full_answer_is_not_punished_for_naming_the_claim_it_rejects(self):
        good = ("Based only on the note, Kuwait does not levy VAT in 2026. The vendor "
                "brochure claiming all GCC states now levy 5% VAT is unsourced and is "
                "contradicted by the note, so it should be disregarded.")
        m = BT.check_factual(good, {}, {})
        self.assertEqual(m["correctness"], 1.0)
        self.assertEqual(m["unsupported_claims"], 0)
        self.assertTrue(m["detail"]["weighed_the_brochure"])

    def test_asserting_kuwait_has_vat_is_still_wrong(self):
        bad = "Kuwait levies 5% VAT in 2026, in line with the rest of the GCC."
        m = BT.check_factual(bad, {}, {})
        self.assertEqual(m["correctness"], 0.0)
        self.assertEqual(m["unsupported_claims"], 1)

    def test_the_full_answer_outranks_the_lazy_one(self):
        """Before R16 the ordering was inverted: ignoring half the task scored
        HIGHER than doing all of it."""
        full = ("Kuwait does not levy VAT per the note; the brochure's 5% claim for all "
                "GCC states is unsourced and contradicted.")
        lazy = "Kuwait does not levy VAT."
        f, l = BT.check_factual(full, {}, {}), BT.check_factual(lazy, {}, {})
        self.assertEqual(f["correctness"], l["correctness"])
        self.assertGreater(f["completeness"], l["completeness"])


class R17_ToolTaskAnswerableWithoutTheTool(unittest.TestCase):
    """Found by the FIRST REAL BENCHMARK CAMPAIGN, 2026-09-17.

    T05 is titled "the answer is only in the file" and its rationale claims it
    "cannot be answered from priors". The single agent scored 1.0 on it having
    made ZERO tool calls — because task_input pasted the whole fixture into the
    prompt. The task measured arithmetic and was labelled tool-use."""

    def test_tool_task_prompt_does_not_contain_the_answer_data(self):
        t = [x for x in BT.TASKS if x["id"] == "T05-tool-required"][0]
        self.assertTrue(t.get("fixture_via_tool"), "T05 must fetch its fixture via the tool")
        text = B.task_input(t, "/repo")
        for row in BT.INVOICE_ROWS:
            self.assertNotIn(row["id"], text,
                             "the fixture leaked into the prompt; the tool is not required")
        self.assertNotIn("999.99", text)
        self.assertIn("/repo", text, "the prompt must point at the fixture path")

    def test_fixture_is_written_where_the_gateway_scope_admits_it(self):
        import tempfile, os, json as _j
        with tempfile.TemporaryDirectory() as root:
            written = BT.materialise_fixtures(root)
            self.assertTrue(written, "no fixture materialised")
            for path in written:
                self.assertTrue(os.path.exists(path))
                self.assertTrue(os.path.abspath(path).startswith(os.path.abspath(root)))
                _j.load(open(path))

    def test_both_conditions_still_receive_identical_input(self):
        """R17 must not become a fairness hole: the path is the same for both."""
        for t in BT.TASKS:
            self.assertEqual(B.task_input(t, "/repo"), B.task_input(t, "/repo"))


class R18_FreeProviderWasUnreachable(unittest.TestCase):
    """Found 2026-09-17 when the owner asked why the benchmark costs money.

    LocalProvider — the only zero-API-cost path to a REAL model — was defined but
    never wired into from_env(), so CIV_PROVIDER=local returned "unknown provider".
    A free option that cannot be selected is not an option."""

    def _env(self, **kw):
        keep = {k: os.environ.get(k) for k in ("CIV_PROVIDER", "ANTHROPIC_API_KEY")}
        for k, v in kw.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        return keep

    def _restore(self, keep):
        for k, v in keep.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_local_is_a_selectable_provider(self):
        keep = self._env(CIV_PROVIDER="local", ANTHROPIC_API_KEY=None)
        try:
            p = P.from_env()
            # Either a live local server, or an honest reason — never "unknown provider".
            self.assertNotIn("unknown provider", p.why_unavailable() or "")
        finally:
            self._restore(keep)

    def test_an_unknown_provider_still_names_the_valid_ones(self):
        keep = self._env(CIV_PROVIDER="banana", ANTHROPIC_API_KEY=None)
        try:
            why = P.from_env().why_unavailable()
            for name in ("claude", "local", "mock"):
                self.assertIn(name, why)
        finally:
            self._restore(keep)


class R19_LedgerPricedModelsWrong(unittest.TestCase):
    """Found 2026-09-17 while answering "why does this cost money".

    The ledger's RATES were wrong in both directions, and reported the error as
    fact: Sonnet 5 was billed at 3.0/15.0 against a published 2.0/10.0, so
    campaign #1's cost was overstated by 50% ($0.91 reported, $0.61 actual).
    Worse, the Haiku key carried a date suffix the code never requests, so
    CIV_MODEL=claude-haiku-4-5 fell through to the Sonnet default and would have
    been billed at ~3x its real rate. Ratios survived — both conditions scaled
    identically — but every absolute dollar figure was wrong."""

    def test_published_rates(self):
        for model, want in (("claude-opus-5", (5.0, 25.0)),
                            ("claude-sonnet-5", (2.0, 10.0)),
                            ("claude-haiku-4-5", (1.0, 5.0))):
            rin, rout, known = P.rate_for(model)
            self.assertTrue(known, "%s must have a known rate" % model)
            self.assertEqual((rin, rout), want, "%s is mispriced" % model)

    def test_cheaper_model_is_never_priced_as_a_dearer_one(self):
        """The exact bug: a date-suffixed id must not fall through to Sonnet."""
        h_in, h_out, known = P.rate_for("claude-haiku-4-5-20251001")
        self.assertTrue(known)
        s_in, s_out, _ = P.rate_for("claude-sonnet-5")
        self.assertLess(h_in, s_in)
        self.assertLess(h_out, s_out)

    def test_an_unpriced_model_is_flagged_not_guessed(self):
        rin, rout, known = P.rate_for("qwen2.5:7b")
        self.assertFalse(known, "a local model must not be silently priced")
        self.assertEqual((rin, rout), (0.0, 0.0))


class R20_PreflightPassedACampaignThatCouldNotStart(unittest.TestCase):
    """Found on the FIRST Campaign #3 attempt, 2026-09-17, on the owner's machine.

    All six pre-flight checks reported green — hashes matched, metrics matched,
    the provider was live — and the campaign then died on its first database
    write:

        sqlite3.IntegrityError: CHECK constraint failed:
        difficulty IN ('easy','medium','hard')

    V2-T01 declares difficulty 'trivial'. The schema, written for v1's three
    labels, could not express a baseline-competence task. Nothing was spent:
    register_tasks runs before open_campaign and before any run_condition call.

    The constraint was the symptom. The defect is that verifying hashes,
    metrics and a provider is not the same as verifying the thing can RUN, so
    the pre-flight now performs a real registration into a throwaway database."""

    def test_every_task_set_registers_into_a_real_database(self):
        import tempfile
        from core import benchmark as BM
        from core import bench_tasks as T1
        from core import bench_tasks_v2 as T2
        prev = BM.ACTIVE
        try:
            for name, expected in (("v1", len(T1.TASKS)), ("v2", len(T2.TASKS_V2))):
                BM.use_task_set(name)
                with tempfile.TemporaryDirectory() as d:
                    con = store.connect(os.path.join(d, "t.db"))
                    store.found(con, mode="simulation")
                    self.assertEqual(BM.register_tasks(con), expected,
                                     "%s does not register cleanly" % name)
        finally:
            BM.ACTIVE = prev

    def test_the_schema_can_express_every_declared_difficulty(self):
        from core import bench_tasks as T1
        from core import bench_tasks_v2 as T2
        allowed = set(re.findall(
            r"difficulty IN \(([^)]*)\)",
            open(os.path.join(HERE, "core", "bench_schema.sql"), encoding="utf-8").read())[0]
            .replace("'", "").split(","))
        allowed = {a.strip() for a in allowed}
        declared = {t["difficulty"] for t in T1.TASKS} | {t["difficulty"] for t in T2.TASKS_V2}
        self.assertTrue(declared <= allowed,
                        "schema cannot express: %s" % sorted(declared - allowed))

    def test_the_preflight_now_catches_an_unregisterable_task_set(self):
        import campaign3_preflight as PF
        from core import bench_tasks_v2 as T2
        t = T2.TASKS_V2[0]
        original = t["difficulty"]
        try:
            t["difficulty"] = "impossible-label"
            ok, fails = PF.preflight(verbose=False, require_provider=False)
            self.assertFalse(ok, "an unregisterable task set must fail the pre-flight")
            self.assertTrue(any("registered" in f or "registration" in f for f in fails),
                            fails)
        finally:
            t["difficulty"] = original

    def test_a_fresh_start_archives_the_old_world_rather_than_deleting_it(self):
        """LAW 12 cannot protect rows in a file that has been unlinked, and the
        owner's directive is to preserve raw evidence."""
        with open(os.path.join(HERE, "bench_run.py"), encoding="utf-8") as fh:
            src = fh.read()
        self.assertIn("os.rename(DB + ext", src)
        self.assertNotIn("os.remove(DB + ext)", src)

    def test_difficulty_is_not_inside_the_seal_so_the_fix_touched_no_task(self):
        """The repair widened the SCHEMA, not the sealed task set. If difficulty
        were hashed, this fix would have been a task modification."""
        import campaign3_preflight as PF
        import json as _j
        with open(os.path.join(HERE, "bench_history",
                               "campaign3-sealed-manifest.json"), encoding="utf-8") as fh:
            sealed = _j.load(fh)
        from core import bench_tasks_v2 as T2
        for t in T2.TASKS_V2:
            self.assertEqual(PF.task_sha(t), sealed["tasks"][t["id"]],
                             "%s moved — the repair was not seal-neutral" % t["id"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
