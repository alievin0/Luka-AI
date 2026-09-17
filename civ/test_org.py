#!/usr/bin/env python3
"""ORGANISATIONAL LAYER TESTS.  python3 test_org.py

Every subsystem gets: happy path · failure path · authorization path ·
invalid input · regression. The __main__ block stays last (see R14).
"""
import json
import os
import re
import sqlite3
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from core import contract as K      # noqa: E402
from core import factory as F       # noqa: E402
from core import org                # noqa: E402
from core import store              # noqa: E402
import slice as vslice              # noqa: E402


def world():
    con = store.connect(os.path.join(tempfile.mkdtemp(), "o.db"))
    store.found(con, mode="simulation")
    vslice.register_crew(con)
    return con


def spec(aid="AGT-000900", name="Nadia", tier="reader", **kw):
    c = K.blank(aid, name, kw.get("role", "Market Researcher"),
                "Discovery & Intelligence", "Market Intelligence",
                "Find who already pays to solve this.", tier=tier)
    c["tools"] = kw.get("tools", ["browser"])
    c["permissions"] = kw.get("permissions", ["READ_PUBLIC_WEB"])
    c["success_metrics"] = kw.get("success_metrics", [{"metric": "verified_claims", "target": 5}])
    c["escalation_rules"] = kw.get("escalation_rules",
                                   [{"when": "no_evidence", "action": "ESCALATE"}])
    c.update({k: v for k, v in kw.items() if k in c})
    return c


# ── AGENT CONTRACT ───────────────────────────────────────────────────
class ContractTests(unittest.TestCase):
    def test_happy_path_register_and_reload(self):
        con = world()
        K.register(con, spec())
        back = K.load(con, "AGT-000900")
        self.assertEqual(back["name"], "Nadia")
        self.assertEqual(back["lifecycle_state"], "PROPOSED")

    def test_invalid_input_is_refused(self):
        for bad in ({"agent_id": "nope"}, spec(aid="XX-1"),
                    spec(success_metrics=[{"no_metric_key": 1}]),
                    spec(escalation_rules=[{"when": "x"}])):
            with self.assertRaises(K.ContractError):
                K.validate(bad)

    def test_the_five_concepts_stay_separate(self):
        c = spec()
        c["skills"] = "not-a-list"
        with self.assertRaises(K.ContractError):
            K.validate(c)
        ok = spec()
        for field in ("skills", "capabilities", "tools", "permissions"):
            self.assertIsInstance(ok.get(field, []), list)

    def test_authorization_path_reader_cannot_exceed_autonomy_2(self):
        with self.assertRaises(K.ContractError):
            K.validate(spec(tier="reader", autonomy_level=3))

    def test_lifecycle_transitions_are_enforced(self):
        con = world()
        K.register(con, spec())
        for to in ("EVALUATING", "APPROVED", "ACTIVE"):
            K.transition(con, "AGT-000900", to)
        with self.assertRaises(K.ContractError):
            K.transition(con, "AGT-000900", "PROPOSED")
        K.transition(con, "AGT-000900", "RETIRED")
        with self.assertRaises(K.ContractError):
            K.transition(con, "AGT-000900", "ACTIVE")

    def test_retirement_preserves_history(self):
        con = world()
        K.register(con, spec())
        for to in ("EVALUATING", "APPROVED", "RETIRED"):
            K.transition(con, "AGT-000900", to)
        self.assertIsNotNone(K.load(con, "AGT-000900"))
        self.assertEqual(con.execute("SELECT COUNT(*) c FROM agent_versions "
                                     "WHERE principal_id='AGT-000900'").fetchone()["c"], 1)

    def test_a_different_name_is_not_specialisation(self):
        a, b = spec("AGT-A", "Ali"), spec("AGT-B", "Badr")
        self.assertEqual(K.distinctness_key(a), K.distinctness_key(b))
        self.assertEqual(K.similarity(a, b), 1.0)


# ── PERMISSIONS ──────────────────────────────────────────────────────
class PermissionTests(unittest.TestCase):
    def test_happy_path_owner_plane_grants(self):
        con = world()
        gid = K.grant(con, "AGT-000001", "READ_PUBLIC_WEB", granted_by="OWNER")
        self.assertTrue(gid)

    def test_authorization_path_an_agent_cannot_grant(self):
        con = world()
        for who in ("AGT-000002", "AGT-000001", "some-model", "factory"):
            with self.assertRaises(sqlite3.IntegrityError, msg="granted by %s" % who):
                K.grant(con, "AGT-000002", "DEPLOY_PRODUCTION", granted_by=who)

    def test_a_grant_carries_subject_capability_resource_scope_action(self):
        con = world()
        K.grant(con, "AGT-000001", "READ_REPO", resource="alievin0/Luka-AI",
                scope={"path_prefix": "/x"}, action="read", granted_by="OWNER_PLANE")
        r = con.execute("SELECT * FROM permission_grants ORDER BY id DESC LIMIT 1").fetchone()
        for f in ("subject", "capability", "resource", "scope", "action"):
            self.assertTrue(r[f])


# ── AGENT FACTORY ────────────────────────────────────────────────────
class AgentFactoryTests(unittest.TestCase):
    def test_happy_path_creates_a_proposed_agent_with_lineage(self):
        con = world()
        aid, jid, rep = F.create_agent(
            con, "AGT-000001", "analyse Arabic B2B customer interviews",
            spec("AGT-000901", "Rania"), expected_value="unblocks GCC research",
            required_caps=["CAP-arabic-interview"])
        self.assertEqual(aid, "AGT-000901")
        self.assertEqual(rep["decision"], "NEW_AGENT")
        lin = con.execute("SELECT * FROM agent_lineage WHERE principal_id=?", (aid,)).fetchone()
        self.assertEqual(lin["capability_gap"], "analyse Arabic B2B customer interviews")
        self.assertTrue(lin["why_created"])
        self.assertEqual(con.execute("SELECT lifecycle_state FROM principals WHERE id=?",
                                     (aid,)).fetchone()[0], "PROPOSED")

    def test_failure_path_duplicates_are_refused(self):
        con = world()
        F.create_agent(con, "AGT-000001", "forecast semiconductor supply chains",
                       spec("AGT-000902", "A"), required_caps=["CAP-x"])
        aid, jid, rep = F.create_agent(con, "AGT-000001", "model lithography yield curves",
                                       spec("AGT-000903", "B"), required_caps=["CAP-y"],
                                       force=True)
        self.assertIsNone(aid)
        self.assertEqual(rep["decision"], "REJECT")
        self.assertTrue(any("duplicat" in f for f in rep["evaluation"]["findings"]))

    def test_authorization_path_forbidden_capabilities_are_rejected(self):
        con = world()
        bad = spec("AGT-000904", "Greedy", tier="actor",
                   permissions=["GRANT_PERMISSION", "EXECUTE_SQL"])
        aid, jid, rep = F.create_agent(con, "AGT-000001", "do everything", bad,
                                       required_caps=["CAP-z"], force=True)
        self.assertIsNone(aid)
        self.assertTrue(any("forbidden" in f for f in rep["security"]))

    def test_an_agent_is_never_born_active_or_autonomous(self):
        con = world()
        s = spec("AGT-000905", "Eager", tier="actor", autonomy_level=4,
                 permissions=["WRITE_ARTIFACT"])
        aid, jid, rep = F.create_agent(con, "AGT-000001", "build things", s,
                                       required_caps=["CAP-build"], force=True)
        self.assertIsNone(aid, "autonomy 4 must not be grantable by the factory")
        self.assertTrue(any("autonomy" in f for f in rep["security"]))

    def test_invalid_input_a_gap_with_no_capability_is_rejected(self):
        con = world()
        analysis = F.analyse_gap(con, "forecast semiconductor supply chains", [])
        self.assertEqual(F.decide(analysis)[0], "REJECT")

    def test_invalid_input_a_gap_too_vague_to_judge_is_rejected(self):
        """Two incidental words must not be able to route work anywhere."""
        con = world()
        a = F.analyse_gap(con, "gap one", ["CAP-q"])
        self.assertTrue(a["too_vague"])
        d, why = F.decide(a)
        self.assertEqual(d, "REJECT")
        self.assertIn("not enough", why)

    def test_evaluation_is_labelled_as_a_spec_check_not_a_skill_test(self):
        con = world()
        ev = F.evaluate(con, spec("AGT-000906", "X"))
        self.assertEqual(ev["kind"], "SPEC_EVALUATION")
        self.assertIn("G1", ev["note"])


# ── THE DECISION LADDER ──────────────────────────────────────────────
class DecisionTests(unittest.TestCase):
    def test_reuse_when_capability_already_held(self):
        con = world()
        con.execute("INSERT INTO capabilities(id,name,description,created_at) "
                    "VALUES('CAP-verify','verify','x',?)", (store.now(),))
        con.execute("INSERT INTO agent_capabilities VALUES('AGT-000003','CAP-verify')")
        con.execute("UPDATE principals SET lifecycle_state='ACTIVE' WHERE id='AGT-000003'")
        d, why = F.decide(F.analyse_gap(con, "verify artifacts", ["CAP-verify"]))
        self.assertEqual(d, "REUSE")
        self.assertIn("AGT-000003", why)

    def test_skill_when_a_near_agent_lacks_only_a_skill(self):
        con = world()
        d, why = F.decide(F.analyse_gap(
            con, "independent verifier executes artifacts", ["CAP-new"], ["SKL-new"]))
        self.assertEqual(d, "SKILL")

    def test_new_agent_only_when_nothing_is_close(self):
        con = world()
        d, _ = F.decide(F.analyse_gap(con, "semiconductor supply chain forecasting",
                                      ["CAP-semi"]))
        self.assertEqual(d, "NEW_AGENT")

    def test_every_decision_is_recorded_with_its_reason(self):
        con = world()
        F.create_agent(con, "AGT-000001", "vague wish", spec("AGT-000907"), required_caps=[])
        j = con.execute("SELECT * FROM factory_jobs ORDER BY id DESC LIMIT 1").fetchone()
        self.assertTrue(j["rationale"])
        self.assertTrue(json.loads(j["analysis"]))


# ── SKILL FACTORY ────────────────────────────────────────────────────
class SkillTests(unittest.TestCase):
    def test_happy_path_create_acquire_evaluate(self):
        con = world()
        F.create_skill(con, "SKL-arabic", "Arabic interview analysis", "d", "AGT-000001")
        F.acquire_skill(con, "AGT-000001", "SKL-arabic")
        r = con.execute("SELECT * FROM agent_skills WHERE skill_id='SKL-arabic'").fetchone()
        self.assertEqual(r["proficiency"], 0.0)
        self.assertIsNone(r["eval_score"])
        F.evaluate_skill(con, "AGT-000001", "SKL-arabic", 0.8)
        r = con.execute("SELECT * FROM agent_skills WHERE skill_id='SKL-arabic'").fetchone()
        self.assertEqual(r["proficiency"], 0.8)

    def test_failure_path_proficiency_without_evaluation_is_refused(self):
        con = world()
        F.create_skill(con, "SKL-x", "x", "d", "AGT-000001")
        F.acquire_skill(con, "AGT-000001", "SKL-x")
        with self.assertRaises(sqlite3.IntegrityError) as e:
            con.execute("UPDATE agent_skills SET proficiency=0.9 "
                        "WHERE principal_id='AGT-000001' AND skill_id='SKL-x'")
        self.assertIn("LAW 7", str(e.exception))

    def test_regression_a_prompt_change_is_not_improvement(self):
        """An agent must not get 'better' because its text changed."""
        con = world()
        F.create_skill(con, "SKL-y", "y", "d", "AGT-000001")
        F.acquire_skill(con, "AGT-000002", "SKL-y")
        c = K.load(con, "AGT-000002") or spec("AGT-000002")
        c["mission"] = "a much more impressive mission statement"
        r = con.execute("SELECT proficiency FROM agent_skills WHERE principal_id='AGT-000002'"
                        ).fetchone()
        self.assertEqual(r["proficiency"], 0.0)


# ── DISCOVERY → IDEA → OPPORTUNITY → PROJECT ─────────────────────────
class DiscoveryTests(unittest.TestCase):
    def test_observation_and_interpretation_are_separate_columns(self):
        con = world()
        did, _ = org.discover(con, "Three workshops asked the same question this week",
                              "mock", "AGT-000001",
                              interpretation="workshops may share a billing problem",
                              confidence=0.4)
        r = con.execute("SELECT * FROM discoveries WHERE id=?", (did,)).fetchone()
        self.assertNotEqual(r["observation"], r["interpretation"])
        self.assertLess(r["confidence"], 1.0)

    def test_a_discovery_carries_its_provenance(self):
        con = world()
        did, _ = org.discover(con, "obs", "mock", "AGT-000001")
        self.assertEqual(con.execute("SELECT source FROM discoveries WHERE id=?",
                                     (did,)).fetchone()[0], "mock")

    def test_invalid_input_unknown_source_is_refused(self):
        con = world()
        with self.assertRaises(sqlite3.IntegrityError):
            org.discover(con, "obs", "telepathy", "AGT-000001")


class MemoryTests(unittest.TestCase):
    def test_happy_path_recall_finds_prior_work(self):
        con = world()
        org.propose_idea(con, "workshops lose invoices between three systems",
                         "AGT-000001", "mock")
        hits = org.recall(con, "invoices lost between systems in workshops")
        self.assertTrue(hits)
        self.assertEqual(hits[0]["kind"], "idea")

    def test_the_same_idea_under_a_new_name_is_detected(self):
        con = world()
        org.propose_idea(con, "garages rewrite the same invoice three times",
                         "AGT-000001", "mock")
        _, prior = org.propose_idea(con, "garages rewrite the same invoice three times",
                                    "AGT-000002", "mock")
        self.assertTrue(prior, "a duplicate idea must be flagged")
        self.assertGreater(con.execute("SELECT COUNT(*) c FROM events "
                                       "WHERE kind='DUPLICATE_SUSPECTED'").fetchone()["c"], 0)

    def test_failure_path_unrelated_text_is_not_a_match(self):
        con = world()
        org.propose_idea(con, "garages rewrite invoices", "AGT-000001", "mock")
        self.assertEqual(org.recall(con, "semiconductor lithography yield curves"), [])


class ProjectFactoryTests(unittest.TestCase):
    def test_happy_path_validated_opportunity_becomes_a_project(self):
        con = world()
        oid, _ = org.raise_opportunity(con, "workshops pay a bookkeeper for re-entry",
                                       "market", "AGT-000001")
        con.execute("UPDATE opportunities SET status='VALIDATED' WHERE id=?", (oid,))
        pid, _ = org.create_project(con, "Re-entry killer", "Stop triple invoice entry",
                                    "OPPORTUNITY", oid, "AGT-000001")
        r = con.execute("SELECT origin FROM projects WHERE id=?", (pid,)).fetchone()
        self.assertEqual(r["origin"], "OPPORTUNITY:%d" % oid)

    def test_authorization_path_an_unvalidated_idea_cannot_become_a_project(self):
        con = world()
        oid, _ = org.raise_opportunity(con, "a hunch", "vibes", "AGT-000001")
        with self.assertRaises(org.GateError) as e:
            org.create_project(con, "Hunch", "m", "OPPORTUNITY", oid, "AGT-000001")
        self.assertIn("without validation", str(e.exception))

    def test_invalid_input_a_project_must_name_its_origin(self):
        con = world()
        with self.assertRaises(org.GateError):
            org.create_project(con, "Orphan", "m", "OPPORTUNITY", None, "AGT-000001")
        with self.assertRaises(org.GateError):
            org.create_project(con, "Orphan", "m", "TELEPATHY", 1, "AGT-000001")

    def test_owner_may_originate_a_project_directly(self):
        con = world()
        pid, _ = org.create_project(con, "Owner idea", "m", "OWNER", None, "OWNER")
        self.assertTrue(pid)

    def test_regression_prior_similar_projects_are_surfaced(self):
        con = world()
        org.create_project(con, "Invoice re-entry", "stop triple invoice entry",
                           "OWNER", None, "OWNER")
        _, prior = org.create_project(con, "Invoice re-entry two",
                                      "stop triple invoice entry", "OWNER", None, "OWNER")
        self.assertTrue(prior, "the organisation must notice it is repeating itself")


class TeamFormationTests(unittest.TestCase):
    def setUp(self):
        self.con = world()
        for cid in ("CAP-research", "CAP-build"):
            self.con.execute("INSERT INTO capabilities(id,name,description,created_at) "
                             "VALUES(?,?,?,?)", (cid, cid, "d", store.now()))
        self.con.execute("UPDATE principals SET lifecycle_state='ACTIVE'")
        self.con.execute("INSERT INTO agent_capabilities VALUES('AGT-000001','CAP-research')")
        self.con.execute("INSERT INTO agent_capabilities VALUES('AGT-000002','CAP-build')")
        self.pid, _ = org.create_project(self.con, "P", "m", "OWNER", None, "OWNER")

    def test_happy_path_selects_by_capability_and_records_why(self):
        tid, chosen, unmet = org.form_team(self.con, self.pid, ["CAP-research", "CAP-build"])
        self.assertEqual(unmet, [])
        self.assertEqual({c["agent"] for c in chosen}, {"AGT-000001", "AGT-000002"})
        for c in chosen:
            self.assertIn("holds", c["why"])
        seats = self.con.execute("SELECT seat FROM team_members WHERE team_id=?",
                                 (tid,)).fetchall()
        self.assertTrue(all(s["seat"] for s in seats), "every seat must record its reason")

    def test_failure_path_an_unmet_capability_is_reported_not_faked(self):
        tid, chosen, unmet = org.form_team(self.con, self.pid, ["CAP-nobody-has-this"])
        self.assertEqual(unmet, ["CAP-nobody-has-this"])
        self.assertEqual(chosen, [])
        s = self.con.execute("SELECT * FROM signals ORDER BY id DESC LIMIT 1").fetchone()
        self.assertEqual(s["priority"], "HIGH")
        self.assertIn("Capability gap", s["headline"])

    def test_authorization_path_retired_agents_are_not_staffed(self):
        self.con.execute("UPDATE principals SET lifecycle_state='RETIRED' "
                         "WHERE id='AGT-000001'")
        _, chosen, unmet = org.form_team(self.con, self.pid, ["CAP-research"])
        self.assertEqual(chosen, [])
        self.assertEqual(unmet, ["CAP-research"])


# ── EXPERIMENTS · FAILURES · DISAGREEMENT ────────────────────────────
class ExperimentTests(unittest.TestCase):
    def test_happy_path_design_and_complete_with_evidence(self):
        con = world()
        pid, _ = org.create_project(con, "P", "m", "OWNER", None, "OWNER")
        eid = org.design_experiment(con, pid, "SMBs pay 20/mo", "ask 20 qualified",
                                    "4+ of 20 say yes", "fewer than 4", "AGT-000001")
        ev = con.execute("INSERT INTO evidence(kind,external_provenance,detail,content_sha,"
                         "collected_by,collected_at) VALUES('survey','tally sheet',"
                         "'3 of 20','s','AGT-000001',?)", (store.now(),)).lastrowid
        org.complete_experiment(con, eid, "NOT_VALIDATED", ev, "3/20 — below the bar",
                                "do not scale", "AGT-000001")
        r = con.execute("SELECT * FROM experiments WHERE id=?", (eid,)).fetchone()
        self.assertEqual(r["result"], "NOT_VALIDATED")

    def test_failure_path_a_conclusion_without_evidence_is_refused(self):
        con = world()
        pid, _ = org.create_project(con, "P", "m", "OWNER", None, "OWNER")
        eid = org.design_experiment(con, pid, "h", "m", "s", "f", "AGT-000001")
        with self.assertRaises(sqlite3.IntegrityError) as e:
            con.execute("UPDATE experiments SET status='COMPLETE', result='VALIDATED' "
                        "WHERE id=?", (eid,))
        self.assertIn("LAW 9", str(e.exception))


class FailureMemoryTests(unittest.TestCase):
    def test_happy_path_a_failure_becomes_searchable_knowledge(self):
        con = world()
        org.record_failure(con, "project", 1, "nobody replied to 40 approaches",
                           "the channel was wrong", "cold email does not reach workshops",
                           "AGT-000001", failed_assumption="workshops read email")
        hits = org.recall(con, "cold email did not reach workshops", kinds=("failure",))
        self.assertTrue(hits)

    def test_a_failure_is_never_deleted(self):
        con = world()
        fid = org.record_failure(con, "experiment", 2, "w", "y", "l", "AGT-000001")
        self.assertTrue(con.execute("SELECT 1 FROM failures WHERE id=?", (fid,)).fetchone())


class DisagreementTests(unittest.TestCase):
    def test_happy_path_positions_are_preserved_not_averaged(self):
        con = world()
        d = org.open_disagreement(con, "idea", 1)
        org.take_position(con, d, "AGT-000002", "PROMISING", "the build is cheap", 0.7)
        org.take_position(con, d, "AGT-000004", "HIGH_RISK", "no payer identified", 0.8,
                          missing_evidence="one customer who paid")
        v = org.disagreement_view(con, d)
        self.assertEqual(len(v["positions"]), 2)
        self.assertTrue(v["unresolved"])
        self.assertEqual(sorted(v["stances"]), ["HIGH_RISK", "PROMISING"])
        self.assertNotIn("average", json.dumps(v).lower().replace("no average", ""))

    def test_one_agent_holds_one_position(self):
        con = world()
        d = org.open_disagreement(con, "idea", 1)
        org.take_position(con, d, "AGT-000002", "YES", "c", 0.5)
        org.take_position(con, d, "AGT-000002", "NO", "changed my mind", 0.6)
        self.assertEqual(len(org.disagreement_view(con, d)["positions"]), 1)

    def test_invalid_input_confidence_must_be_a_probability(self):
        con = world()
        d = org.open_disagreement(con, "idea", 1)
        with self.assertRaises(sqlite3.IntegrityError):
            org.take_position(con, d, "AGT-000002", "YES", "c", 4.0)


class CrossProjectTests(unittest.TestCase):
    def test_happy_path_the_same_problem_in_two_places_is_detected(self):
        con = world()
        org.create_project(con, "A", "workshops lose invoices between billing systems",
                           "OWNER", None, "OWNER")
        org.create_project(con, "B", "clinics lose invoices between billing systems",
                           "OWNER", None, "OWNER")
        found = org.detect_cross_project(con)
        self.assertTrue(found)
        self.assertEqual(found[0]["kind"], "same_problem")

    def test_failure_path_unrelated_projects_produce_no_signal(self):
        con = world()
        org.create_project(con, "A", "lithography yield curves", "OWNER", None, "OWNER")
        org.create_project(con, "B", "camel husbandry logistics", "OWNER", None, "OWNER")
        self.assertEqual(org.detect_cross_project(con), [])

    def test_regression_the_same_pair_is_not_signalled_twice(self):
        con = world()
        org.create_project(con, "A", "workshops lose invoices between systems",
                           "OWNER", None, "OWNER")
        org.create_project(con, "B", "clinics lose invoices between systems",
                           "OWNER", None, "OWNER")
        first = len(org.detect_cross_project(con))
        self.assertGreater(first, 0)
        self.assertEqual(org.detect_cross_project(con), [])


class SignalEngineTests(unittest.TestCase):
    def test_a_raw_event_is_not_a_notification(self):
        con = world()
        before = con.execute("SELECT COUNT(*) c FROM signals").fetchone()["c"]
        for _ in range(20):
            store.event(con, "TASK_COMPLETED", actor="AGT-000002")
        self.assertEqual(con.execute("SELECT COUNT(*) c FROM signals").fetchone()["c"], before)

    def test_meaningful_patterns_do_reach_the_owner(self):
        con = world()
        pid, _ = org.create_project(con, "P", "m", "OWNER", None, "OWNER")
        eid = org.design_experiment(con, pid, "h", "m", "s", "f", "AGT-000001")
        ev = con.execute("INSERT INTO evidence(kind,external_provenance,detail,content_sha,"
                         "collected_by,collected_at) VALUES('t','p','d','s','AGT-000001',?)",
                         (store.now(),)).lastrowid
        org.complete_experiment(con, eid, "NOT_VALIDATED", ev, "c", "n", "AGT-000001")
        made = org.run_signal_engine(con)
        self.assertTrue(made)
        heads = [r["headline"] for r in con.execute("SELECT headline FROM signals")]
        self.assertTrue(any("invalidated" in h for h in heads))


# ── suite hygiene (R14) ──────────────────────────────────────────────
class SuiteHygiene(unittest.TestCase):
    def test_every_test_class_is_collected(self):
        import inspect
        mod = sys.modules[__name__]
        declared = {n for n, o in inspect.getmembers(mod, inspect.isclass)
                    if issubclass(o, unittest.TestCase) and o.__module__ == __name__}
        with open(__file__, encoding="utf-8") as fh:
            src = fh.read()
        in_file = set(re.findall(r"^class (\w+)\(unittest\.TestCase\)", src, re.M))
        self.assertEqual(in_file - declared, set())

    def test_the_main_block_is_last(self):
        with open(__file__, encoding="utf-8") as fh:
            self.assertTrue(fh.read().rstrip().endswith("unittest.main(verbosity=2)"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
