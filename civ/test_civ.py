#!/usr/bin/env python3
"""Acceptance tests for the civilization runtime.  python3 test_civ.py

L1–L9 are fully verifiable with no model provider.
L10 is the provider conformance suite: it SKIPS loudly without a key and runs
against the real provider the moment one exists. It is never silently green.
"""
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import provider as P          # noqa: E402
from core import runtime, store         # noqa: E402
import slice as vslice                  # noqa: E402


def fresh(mode="simulation"):
    path = os.path.join(tempfile.mkdtemp(), "t.db")
    con = store.connect(path)
    store.found(con, mode=mode)
    vslice.register_crew(con)
    return con


class L1_NoProviderNoOutput(unittest.TestCase):
    """A missing provider must block, never fabricate."""
    def test_not_configured_blocks_and_writes_no_artifact(self):
        con = fresh()
        out = vslice.run_slice(con, P.NotConfigured("no key in test"), verbose=False)
        self.assertIn("BLOCKED", out["status"])
        self.assertEqual(out["run_status"], "NOT_CONFIGURED")
        self.assertEqual(con.execute("SELECT COUNT(*) c FROM artifacts").fetchone()["c"], 0)
        self.assertEqual(con.execute("SELECT COUNT(*) c FROM evidence").fetchone()["c"], 0)
        sig = con.execute("SELECT headline FROM signals ORDER BY id DESC").fetchone()
        self.assertIn("no model provider", sig["headline"])


class L2_MockIsLabelled(unittest.TestCase):
    def test_mock_run_produces_labelled_artifact(self):
        con = fresh()
        out = vslice.run_slice(con, P.MockProvider(), verbose=False)
        self.assertEqual(out["status"], "COMPLETE")
        a = con.execute("SELECT * FROM artifacts WHERE id=?", (out["artifact_id"],)).fetchone()
        self.assertEqual(a["source"], "mock")
        self.assertIn("MOCK", a["body"])          # the label is in the file itself
        r = con.execute("SELECT source FROM runs WHERE id=?", (a["run_id"],)).fetchone()
        self.assertEqual(r["source"], "mock")


class L3_ProvenanceUnforgeable(unittest.TestCase):
    """LAW 1 — the database, not the code, refuses an artifact with no run."""
    def test_artifact_without_run_is_rejected(self):
        con = fresh()
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO artifacts(run_id,principal_id,kind,name,sha,source,"
                        "created_at) VALUES(NULL,'AGT-000002','code','x','s','mock',?)",
                        (store.now(),))

    def test_artifact_source_must_match_its_run(self):
        con = fresh()
        rid = con.execute("INSERT INTO runs(principal_id,source,provider,model,prompt_sha,"
                          "status,started_at) VALUES('AGT-000002','mock','mock','m','s','OK',?)",
                          (store.now(),)).lastrowid
        with self.assertRaises(sqlite3.IntegrityError) as e:
            con.execute("INSERT INTO artifacts(run_id,principal_id,kind,name,sha,source,"
                        "created_at) VALUES(?,'AGT-000002','code','x','s','model',?)",
                        (rid, store.now()))
        self.assertIn("LAW 1", str(e.exception))


class L4_ModeCannotBeMixed(unittest.TestCase):
    """LAW 2 — a simulation world cannot contain a model run, and vice versa."""
    def test_model_run_rejected_in_simulation_world(self):
        con = fresh("simulation")
        with self.assertRaises(sqlite3.IntegrityError) as e:
            con.execute("INSERT INTO runs(principal_id,source,provider,model,prompt_sha,status,"
                        "started_at) VALUES('AGT-000002','model','claude','m','s','OK',?)",
                        (store.now(),))
        self.assertIn("LAW 2", str(e.exception))

    def test_mock_run_rejected_in_live_world(self):
        con = fresh("live")
        with self.assertRaises(sqlite3.IntegrityError) as e:
            con.execute("INSERT INTO runs(principal_id,source,provider,model,prompt_sha,status,"
                        "started_at) VALUES('AGT-000002','mock','mock','m','s','OK',?)",
                        (store.now(),))
        self.assertIn("LAW 2", str(e.exception))

    def test_hybrid_allows_both_but_still_tags_each(self):
        con = fresh("hybrid")
        for src, prov in (("mock", "mock"), ("model", "claude")):
            con.execute("INSERT INTO runs(principal_id,source,provider,model,prompt_sha,status,"
                        "started_at) VALUES('AGT-000002',?,?,'m','s','OK',?)",
                        (src, prov, store.now()))
        got = {r["source"] for r in con.execute("SELECT source FROM runs")}
        self.assertEqual(got, {"mock", "model"})


class L5_HistoryImmutable(unittest.TestCase):
    """LAW 6 — F5 from the audit, made impossible."""
    def test_delete_and_update_are_refused(self):
        con = fresh()
        store.event(con, "TEST")
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("DELETE FROM events WHERE id=(SELECT MIN(id) FROM events)")
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("UPDATE events SET kind='TAMPERED' WHERE id=(SELECT MIN(id) FROM events)")

    def test_chain_verifies(self):
        con = fresh()
        for i in range(12):
            store.event(con, "TEST", payload={"i": i})
        ok, bad = store.verify_chain(con)
        self.assertTrue(ok, "chain broken at %s" % bad)


class L6_NoFactWithoutEvidence(unittest.TestCase):
    """LAW 4 — the failure recorded in QAYD's own PROJECT_STATUS.md."""
    def test_fact_without_evidence_is_rejected(self):
        con = fresh()
        with self.assertRaises(sqlite3.IntegrityError) as e:
            con.execute("INSERT INTO claims(principal_id,text,status,created_at) "
                        "VALUES('AGT-000003','customers will pay','FACT',?)", (store.now(),))
        self.assertIn("LAW 4", str(e.exception))

    def test_opinion_is_always_allowed(self):
        con = fresh()
        con.execute("INSERT INTO claims(principal_id,text,status,created_at) "
                    "VALUES('AGT-000003','I think this will work','OPINION',?)", (store.now(),))

    def test_fact_with_evidence_is_allowed(self):
        con = fresh()
        ev = con.execute("INSERT INTO evidence(kind,external_provenance,detail,content_sha,"
                         "collected_by,collected_at) VALUES('test','pytest -q','3 passed','s',"
                         "'AGT-000003',?)", (store.now(),)).lastrowid
        con.execute("INSERT INTO claims(principal_id,text,status,evidence_id,created_at) "
                    "VALUES('AGT-000003','the suite passes','FACT',?,?)", (ev, store.now()))


class L7_LeaseExpiry(unittest.TestCase):
    def test_expired_lease_returns_the_task_to_the_queue(self):
        con = fresh()
        t = runtime.enqueue(con, "do a thing", "build", "AGT-000001",
                            required_caps=["READ_REPO", "WRITE_ARTIFACT"])
        lease = runtime.claim(con, "AGT-000002", lease_seconds=1)
        self.assertIsNotNone(lease)
        self.assertEqual(con.execute("SELECT status FROM tasks WHERE id=?",
                                     (t,)).fetchone()["status"], "LEASED")
        time.sleep(1.2)
        self.assertFalse(runtime.lease_valid(con, lease["lease_id"]))
        self.assertEqual(runtime.reap_expired(con), 1)
        self.assertEqual(con.execute("SELECT status FROM tasks WHERE id=?",
                                     (t,)).fetchone()["status"], "QUEUED")

    def test_work_under_an_expired_lease_is_refused(self):
        con = fresh()
        runtime.enqueue(con, "x", "build", "AGT-000001", required_caps=["READ_REPO"])
        lease = runtime.claim(con, "AGT-000002", lease_seconds=1)
        time.sleep(1.2)
        rid, res = runtime.invoke(con, P.MockProvider(), "AGT-000002", "s", "p",
                                  lease_id=lease["lease_id"])
        self.assertEqual(res.status, "REFUSED")
        self.assertEqual(con.execute("SELECT status FROM runs WHERE id=?",
                                     (rid,)).fetchone()["status"], "REFUSED")


class L8_SurvivesRestart(unittest.TestCase):
    def test_world_tasks_and_events_survive_reopen(self):
        path = os.path.join(tempfile.mkdtemp(), "p.db")
        con = store.connect(path)
        store.found(con)
        vslice.register_crew(con)
        out = vslice.run_slice(con, P.MockProvider(), verbose=False)
        before = con.execute("SELECT COUNT(*) c FROM events").fetchone()["c"]
        con.close()                                   # simulate a hard stop
        con2 = store.connect(path)                    # cold reopen
        self.assertEqual(con2.execute("SELECT COUNT(*) c FROM events").fetchone()["c"], before)
        self.assertEqual(con2.execute("SELECT COUNT(*) c FROM principals").fetchone()["c"], 5)
        self.assertEqual(con2.execute("SELECT COUNT(*) c FROM artifacts").fetchone()["c"], 1)
        self.assertEqual(store.meta(con2, "mode"), "simulation")
        ok, _ = store.verify_chain(con2)
        self.assertTrue(ok)
        self.assertTrue(os.path.exists(out["artifact_path"]))


class L9_OwnerControl(unittest.TestCase):
    def test_pause_blocks_leases_runs_and_tools(self):
        con = fresh()
        runtime.enqueue(con, "x", "build", "AGT-000001", required_caps=["READ_REPO"])
        store.set_meta(con, "paused", True)
        self.assertIsNone(runtime.claim(con, "AGT-000002"))
        _, res = runtime.invoke(con, P.MockProvider(), "AGT-000002", "s", "p")
        self.assertEqual(res.status, "REFUSED")
        gw = vslice.build_gateway(con)
        with self.assertRaises(runtime.Denied):
            gw.call("AGT-000002", "READ_REPO", path=__file__)
        self.assertEqual(con.execute("SELECT decision FROM tool_calls ORDER BY id DESC "
                                     "LIMIT 1").fetchone()["decision"], "PAUSED")

    def test_budget_ceiling_stops_new_leases(self):
        con = fresh()
        store.set_meta(con, "usd_ceiling_day", 0.0)
        runtime.enqueue(con, "x", "build", "AGT-000001", required_caps=["READ_REPO"])
        self.assertIsNone(runtime.claim(con, "AGT-000002"))

    def test_capability_is_enforced_not_requested(self):
        """The Critic has no EXECUTE_SANDBOX. It cannot get one by asking."""
        con = fresh()
        gw = vslice.build_gateway(con)
        with self.assertRaises(runtime.Denied):
            gw.call("AGT-000004", "EXECUTE_SANDBOX", argv=["echo", "hi"])
        d = con.execute("SELECT decision, reason FROM tool_calls ORDER BY id DESC "
                        "LIMIT 1").fetchone()
        self.assertEqual(d["decision"], "DENY")
        self.assertIn("not granted", d["reason"])

    def test_writes_outside_the_artifact_dir_are_refused(self):
        con = fresh()
        gw = vslice.build_gateway(con)
        with self.assertRaises(runtime.Denied):
            gw.call("AGT-000002", "WRITE_ARTIFACT", path="../../escape.py", body="x")


class L9b_StructuralInvariants(unittest.TestCase):
    def test_a_reader_can_never_exceed_autonomy_2(self):
        con = fresh()
        with self.assertRaises(sqlite3.IntegrityError) as e:
            con.execute("UPDATE principals SET autonomy_level=4 WHERE id='AGT-000001'")
        self.assertIn("LAW 3", str(e.exception))

    def test_agents_must_be_materially_distinct(self):
        """F4 from the audit, made impossible."""
        con = fresh()
        row = con.execute("SELECT * FROM principals WHERE id='AGT-000002'").fetchone()
        with self.assertRaises(sqlite3.IntegrityError):
            con.execute("INSERT INTO principals(id,name,role,division,department,tier,mission,"
                        "tools,permissions,memory_scope,success_metrics,escalation_rules,"
                        "created_at) VALUES('AGT-999999','Clone','Clone',?,?,?,?,?,?,?,?,?,?)",
                        (row["division"], row["department"], row["tier"], row["mission"],
                         row["tools"], row["permissions"], row["memory_scope"],
                         row["success_metrics"], row["escalation_rules"], store.now()))

    def test_no_agent_reviews_its_own_artifact(self):
        con = fresh()
        out = vslice.run_slice(con, P.MockProvider(), verbose=False)
        with self.assertRaises(sqlite3.IntegrityError) as e:
            con.execute("INSERT INTO reviews(artifact_id,reviewer_id,domain,verdict,rationale,"
                        "created_at) VALUES(?,'AGT-000002','engineering','APPROVE','lgtm',?)",
                        (out["artifact_id"], store.now()))
        self.assertIn("LAW 5", str(e.exception))

    def test_the_slice_produces_real_evidence_even_in_mock_mode(self):
        con = fresh()
        out = vslice.run_slice(con, P.MockProvider(), verbose=False)
        ev = con.execute("SELECT * FROM evidence WHERE id=?", (out["evidence_id"],)).fetchone()
        self.assertEqual(ev["kind"], "process_exec")
        d = json.loads(ev["detail"])
        self.assertEqual(d["returncode"], 0)
        self.assertTrue(d["stdout"].isdigit(), "the verifier must record real program output")


class L10_ProviderConformance(unittest.TestCase):
    """The same suite every provider must pass. Loud skip, never silent green."""
    @staticmethod
    def _conform(t, prov):
        t.assertIsInstance(prov.available(), bool)
        r = prov.complete("Reply with the single word: ok", "Say ok.", max_tokens=16)
        t.assertIn(r.status, ("OK", "NOT_CONFIGURED", "FAILED"))
        t.assertIn(r.source, ("model", "mock", "lexicon", "human"))
        if r.status == "OK":
            t.assertTrue(r.text, "an OK result must carry text")
            t.assertGreaterEqual(r.tokens_in, 0)
            t.assertGreaterEqual(r.usd, 0.0)
        else:
            t.assertEqual(r.text, "", "a non-OK result must carry NO text")
        return r

    def test_mock_conforms(self):
        self._conform(self, P.MockProvider())

    def test_notconfigured_conforms(self):
        r = self._conform(self, P.NotConfigured())
        self.assertEqual(r.status, "NOT_CONFIGURED")

    @unittest.skipUnless(os.environ.get("ANTHROPIC_API_KEY"),
                         "L10-LIVE SKIPPED: no ANTHROPIC_API_KEY. "
                         "The live path is UNVERIFIED until this runs.")
    def test_claude_conforms_live(self):
        prov = P.ClaudeProvider()
        r = self._conform(self, prov)
        self.assertEqual(r.status, "OK", "live call failed: %s" % r.error)
        self.assertEqual(r.source, "model")
        self.assertGreater(r.tokens_out, 0)
        print("\n  L10-LIVE PASSED — %s/%s, %d in / %d out, $%.6f, %d ms"
              % (r.provider, r.model, r.tokens_in, r.tokens_out, r.usd, r.latency_ms))


if __name__ == "__main__":
    print("provider from environment: %s (%s)\n"
          % (P.from_env().name, P.from_env().why_unavailable() or "available"))
    unittest.main(verbosity=2)
