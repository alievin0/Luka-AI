#!/usr/bin/env python3
"""EMBODIMENT TESTS.  python3 test_embodiment.py

An agent now has a body: a persistent physical identity, a seat it holds, a
position it stands at and an animation derived from what it is actually doing.
Each of those is a claim, and each test below tries to make the claim false.

The claim under most pressure is the one about honesty. A 3D world is very easy
to make look busy, and a busy-looking world that is doing nothing is a lie told
in a medium that is hard to check. So the tests here spend most of their effort
on the negative direction: with no lease, no tool call and no message, the world
must report idle, dark and still.

No model is called and nothing is spent.
"""
import json
import math
import os
import re
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import agent_world as W          # noqa: E402
from core import embodiment as EMB         # noqa: E402
from core import open_world as OW          # noqa: E402
from core import store                     # noqa: E402
from core import world_policy as POL       # noqa: E402
from core import world_space as SPACE      # noqa: E402
from core import world_supervisor as SUP   # noqa: E402
import always_on_demo as D                 # noqa: E402
import world_server as SRV                 # noqa: E402

ORCH, RES = "AGT-ORCHESTRATOR", "AGT-RESEARCHER"
BUILD, REV, OPER = "AGT-BUILDER", "AGT-REVIEWER", "AGT-OPERATOR"
JS = os.path.join(HERE, "world_ui/three")


def world(db=None):
    con = store.connect(db or os.path.join(tempfile.mkdtemp(), "emb.db"))
    store.found(con, mode="simulation")
    W.found_agents(con)
    POL.seed(con)
    return con


def driven(con=None, worker="worker-1"):
    con = con or world()
    fixture = D.write_fixture()
    return con, D.build_world(con, fixture, worker=worker), fixture


def ran(con=None):
    """A world that has actually done a piece of work, end to end."""
    con, w, fixture = driven(con)
    D.start(con, fixture)
    SUP.run(w, max_ticks=140)
    return con, w


# ── 1. a body is an identity, not a decoration ──────────────────────
class ABodyIsAnIdentity(unittest.TestCase):
    def test_every_agent_has_exactly_one_body(self):
        con = world()
        n = con.execute("SELECT COUNT(*) c FROM agent_bodies").fetchone()["c"]
        self.assertEqual(n, len(W.CREW))
        ids = [r["body_id"] for r in con.execute("SELECT body_id FROM agent_bodies")]
        self.assertEqual(len(set(ids)), len(ids), "two agents share a body id")

    def test_the_same_agent_gets_the_same_body_every_time(self):
        a = EMB.design(RES, ["research"])
        b = EMB.design(RES, ["research"])
        self.assertEqual(a, b)

    def test_two_agents_do_not_get_the_same_body(self):
        seen = {}
        for c in W.CREW:
            d = EMB.design(c["id"], c.get("capabilities", []))
            key = (d["body_variant"], d["head_variant"], d["palette"])
            self.assertNotIn(key, seen, "%s looks like %s" % (c["id"], seen.get(key)))
            seen[key] = c["id"]

    def test_a_body_survives_a_restart_unchanged(self):
        db = os.path.join(tempfile.mkdtemp(), "restart.db")
        con = world(db)
        before = {r["principal_id"]: dict(r)
                  for r in con.execute("SELECT * FROM agent_bodies")}
        con.close()
        con = store.connect(db)
        W.found_agents(con)                 # founding again must change nothing
        after = {r["principal_id"]: dict(r)
                 for r in con.execute("SELECT * FROM agent_bodies")}
        self.assertEqual(before, after)

    def test_law_43_refuses_a_redesign(self):
        con = world()
        with self.assertRaises(Exception) as e:
            con.execute("UPDATE agent_bodies SET primary_color='#ff0000' "
                        "WHERE principal_id=?", (RES,))
        self.assertIn("LAW 43", str(e.exception))

    def test_law_43_refuses_a_deletion(self):
        con = world()
        with self.assertRaises(Exception) as e:
            con.execute("DELETE FROM agent_bodies WHERE principal_id=?", (RES,))
        self.assertIn("LAW 43", str(e.exception))

    def test_role_decides_equipment_and_never_colour(self):
        """Two agents with the same capability must not share a palette."""
        by_cap = {}
        for c in W.CREW:
            for cap in c.get("capabilities", []):
                by_cap.setdefault(cap, []).append(EMB.design(c["id"], [cap]))
        for cap, designs in by_cap.items():
            if len(designs) < 2:
                continue
            self.assertEqual(len({d["equipment"] for d in designs}), 1,
                             "%s: the same role carries different kit" % cap)
            self.assertGreater(len({d["palette"] for d in designs}), 1,
                               "%s: a role was painted one colour" % cap)

    def test_the_appearance_is_derived_from_the_agent_id_alone(self):
        """Not from the clock, not from a random number, not from the role."""
        one = EMB.design("AGT-FICTIONAL", ["research"])
        two = EMB.design("AGT-FICTIONAL", ["build", "review", "operate"])
        for field in ("body_variant", "head_variant", "chest_variant",
                      "sensor_variant", "palette", "build", "height", "marking"):
            self.assertEqual(one[field], two[field], field)
        self.assertNotEqual(one["equipment"], two["equipment"])

    def test_every_palette_is_a_real_colour(self):
        for name, p, s, a, mat in EMB.PALETTES:
            for hexa in (p, s, a):
                self.assertRegex(hexa, r"^#[0-9a-f]{6}$", "%s: %r" % (name, hexa))
            self.assertIn(mat, ("matte", "satin", "ceramic", "brushed", "carbon"))


# ── 2. a workstation is a row ───────────────────────────────────────
class AWorkstationIsARow(unittest.TestCase):
    def test_every_room_is_fitted_to_its_own_capacity(self):
        con = world()
        for p in con.execute("SELECT * FROM world_places WHERE kind='workspace'"):
            n = con.execute("SELECT COUNT(*) c FROM workstations WHERE workspace=?",
                            (p["id"],)).fetchone()["c"]
            self.assertEqual(n, max(1, p["capacity"]), p["id"])

    def test_a_station_kind_comes_from_what_the_room_is_for(self):
        con = world()
        for ws, cap in OW.WORKSPACE_CAPABILITY.items():
            row = con.execute("SELECT * FROM workstations WHERE workspace=? LIMIT 1",
                              (ws,)).fetchone()
            if row is None:
                continue
            self.assertEqual(row["kind"], EMB.STATION_KIND[cap], ws)

    def test_the_room_a_task_goes_to_agrees_with_what_that_room_is_for(self):
        """One table read both ways, so a build task cannot land in a room the
        renderer furnishes for reviewing. A room may serve more than one
        capability (execute and operate both use the pad), so the round trip is
        back to the same ROOM, not necessarily to the same word."""
        routed = {}
        for cap, ws in OW.CAP_WORKSPACE:
            routed.setdefault(ws, []).append(cap)
        for ws, caps in routed.items():
            back = OW.WORKSPACE_CAPABILITY[ws]
            self.assertIn(back, caps, ws)
            self.assertEqual(dict(OW.CAP_WORKSPACE)[back], ws, ws)
            self.assertEqual({EMB.STATION_KIND[c] for c in caps},
                             {EMB.STATION_KIND[back]},
                             "%s: two capabilities, two kinds of furniture" % ws)

    def test_law_44_refuses_one_agent_holding_two_seats(self):
        con = world()
        sid = con.execute("SELECT id FROM workstations WHERE workspace='ws_lab' "
                          "LIMIT 1").fetchone()["id"]
        with self.assertRaises(Exception) as e:
            con.execute("UPDATE workstations SET occupied_by=? WHERE id=?", (RES, sid))
        self.assertIn("LAW 44", str(e.exception))

    def test_law_44_refuses_evicting_whoever_is_already_sitting_there(self):
        """`occupied_by` holds one value, so the dangerous case is not a
        conflict — it is a silent overwrite that leaves the evicted agent
        standing at a desk it no longer holds."""
        con = world()
        sid = con.execute("SELECT id FROM workstations WHERE workspace='ws_lab' "
                          "LIMIT 1").fetchone()["id"]
        con.execute("UPDATE workstations SET occupied_by=NULL WHERE occupied_by=?",
                    (RES,))
        con.execute("UPDATE workstations SET occupied_by=? WHERE id=?", (RES, sid))
        con.execute("UPDATE workstations SET occupied_by=NULL WHERE occupied_by=?",
                    (BUILD,))
        with self.assertRaises(Exception) as e:
            con.execute("UPDATE workstations SET occupied_by=? WHERE id=?",
                        (BUILD, sid))
        self.assertIn("LAW 44", str(e.exception))

    def test_taking_a_seat_releases_the_one_before_it(self):
        con = world()
        first = EMB.station_of(con, RES)
        self.assertIsNotNone(first)
        second = EMB.take_station(con, RES, "ws_lab")
        self.assertIsNotNone(second)
        self.assertNotEqual(second["id"], first["id"])
        self.assertIsNone(con.execute(
            "SELECT occupied_by FROM workstations WHERE id=?",
            (first["id"],)).fetchone()["occupied_by"])

    def test_an_agent_holds_at_most_one_seat_anywhere(self):
        con, _ = ran()
        for aid in EMB.all_embodiments(con):
            n = con.execute("SELECT COUNT(*) c FROM workstations WHERE occupied_by=?",
                            (aid,)).fetchone()["c"]
            self.assertLessEqual(n, 1, aid)

    def test_a_seat_is_always_in_the_room_the_agent_is_standing_in(self):
        con, _ = ran()
        for aid in EMB.all_embodiments(con):
            st = EMB.station_of(con, aid)
            if st is None:
                continue
            self.assertEqual(st["workspace"], SPACE.locate(con, aid)["workspace"], aid)

    def test_an_agent_stands_at_its_own_desk(self):
        con, _ = ran()
        for aid in EMB.all_embodiments(con):
            st = EMB.station_of(con, aid)
            loc = SPACE.locate(con, aid)
            if st is None or loc["movement"] == SPACE.MOVING:
                continue
            d = math.hypot(loc["x"] - st["x"], loc["y"] - st["y"])
            self.assertAlmostEqual(d, SPACE.WORKING_SIDE, places=2,
                                   msg="%s stands %.2f from its desk" % (aid, d))

    def test_a_full_room_seats_nobody_extra_rather_than_stacking_them(self):
        con = world()
        con.execute("DELETE FROM workstations WHERE workspace='ws_lab'")
        con.execute("UPDATE world_places SET capacity=1 WHERE id='ws_lab'")
        EMB.fit_stations(con, "ws_lab")
        self.assertIsNotNone(EMB.take_station(con, RES, "ws_lab"))
        self.assertIsNone(EMB.take_station(con, BUILD, "ws_lab"))

    def test_two_agents_at_rest_are_never_in_the_same_place(self):
        """Separation is a property of the DATA — stations, capacity and slot —
        so the renderer never has to push two bodies apart."""
        con, _ = ran()
        pts = [(a, SPACE.locate(con, a)) for a in EMB.all_embodiments(con)]
        for i, (a, p) in enumerate(pts):
            for b, q in pts[i + 1:]:
                if p["workspace"] != q["workspace"]:
                    continue
                d = math.hypot(p["x"] - q["x"], p["y"] - q["y"])
                self.assertGreater(d, 0.9, "%s and %s overlap" % (a, b))


# ── 3. agent state → embodiment state ───────────────────────────────
class StateBecomesEmbodiment(unittest.TestCase):
    def test_an_agent_with_no_lease_is_idle(self):
        con = world()
        for aid in EMB.all_embodiments(con):
            e = EMB.embodiment(con, aid)
            self.assertEqual(e["activity_state"], EMB.IDLE, aid)
            self.assertEqual(e["animation_state"], EMB.ANIMATION[EMB.IDLE], aid)
            self.assertEqual(e["because"], "holds no lease")

    def test_a_live_lease_produces_the_activity_its_capability_implies(self):
        con = world()
        for agent, cap, expect in ((RES, "research", EMB.RESEARCHING),
                                   (BUILD, "build", EMB.BUILDING),
                                   (REV, "review", EMB.REVIEWING),
                                   (OPER, "operate", EMB.OPERATING)):
            tid = W.discover_task(con, "task for %s" % cap, by=ORCH,
                                  required_caps=[cap])
            W.transition(con, tid, "PROPOSED", ORCH)
            W.transition(con, tid, "APPROVED", ORCH)
            W.assign(con, tid, agent, by=ORCH)
            claim = W.claim_task(con, agent, tid)
            self.assertIsNotNone(claim, cap)
            e = EMB.embodiment(con, agent)
            self.assertEqual(e["activity_state"], expect, cap)
            self.assertEqual(e["animation_state"], EMB.ANIMATION[expect], cap)
            W.release_lease(con, claim["lease_id"])

    def test_every_activity_has_an_animation_and_every_animation_a_state(self):
        """Every activity constant the module defines must be playable, and no
        animation may exist that no state can produce."""
        declared = {v for k, v in vars(EMB).items()
                    if k.isupper() and isinstance(v, str) and v == k}
        self.assertEqual(declared - set(EMB.ANIMATION), set(),
                         "an activity exists that no body can show")
        for state, anim in EMB.ANIMATION.items():
            self.assertTrue(anim, state)
        for act in EMB.CAPABILITY_ACTIVITY.values():
            self.assertIn(act, EMB.ANIMATION, act)

    def test_the_renderer_knows_every_animation_the_world_can_ask_for(self):
        js = open(os.path.join(JS, "bodies.js"), encoding="utf-8").read()
        listed = set(re.findall(r'"([a-z]+)"',
                                re.search(r"export const ANIMS = \[(.*?)\];",
                                          js, re.S).group(1)))
        self.assertEqual(set(EMB.ANIMATION.values()) - listed, set(),
                         "the world can ask for an animation the body cannot do")

    def test_a_failed_task_under_correction_animates_as_rework(self):
        con, _ = ran()
        rows = [(a, EMB.embodiment(con, a)) for a in EMB.all_embodiments(con)]
        rework = [(a, e) for a, e in rows if e["activity_state"] == EMB.REWORK]
        for aid, e in rework:
            tid = int(re.search(r"#(\d+)", e["because"]).group(1))
            self.assertEqual(con.execute("SELECT status FROM tasks WHERE id=?",
                                         (tid,)).fetchone()["status"], "FAILED")
            self.assertEqual(e["animation_state"], EMB.ANIMATION[EMB.REWORK])


# ── 4. a destination is caused by work ──────────────────────────────
class MovementIsCausedByWork(unittest.TestCase):
    def setUp(self):
        self.con, _ = ran()

    def test_every_journey_names_the_task_that_caused_it(self):
        rows = list(self.con.execute(
            "SELECT * FROM movements WHERE phase='ARRIVED' "
            "AND from_workspace IS NOT NULL"))
        self.assertTrue(rows, "nobody moved at all")
        for m in rows:
            self.assertIsNotNone(m["task_id"], m["why"])
            self.assertTrue(m["why"])

    def test_a_destination_is_the_room_that_kind_of_work_belongs_in(self):
        for m in self.con.execute(
                "SELECT * FROM movements WHERE phase='ARRIVED' "
                "AND from_workspace IS NOT NULL AND task_id IS NOT NULL"):
            status = re.search(r"\((\w+)\)", m["why"])
            if not status:
                continue
            t = dict(self.con.execute("SELECT * FROM tasks WHERE id=?",
                                      (m["task_id"],)).fetchone())
            t["status"] = status.group(1)
            self.assertEqual(m["to_workspace"], OW.workspace_of(t), m["why"])

    def test_an_agent_that_is_working_is_in_the_facility_that_work_belongs_to(self):
        for aid in EMB.all_embodiments(self.con):
            e = EMB.embodiment(self.con, aid)
            # A LEASE is what puts an agent in a room. An agent whose assigned
            # task has failed is waiting at its own desk to correct it while the
            # failed record sits in Inspection; those are two different places
            # and the world is right to report them separately.
            if not e["lease_id"]:
                continue
            t = self.con.execute("SELECT * FROM tasks WHERE id=?",
                                 (e["task_id"],)).fetchone()
            self.assertEqual(e["workspace"], OW.workspace_of(t), aid)

    def test_more_than_one_agent_moved_and_they_did_not_all_move_together(self):
        movers = {m["principal_id"] for m in self.con.execute(
            "SELECT * FROM movements WHERE phase='ARRIVED' "
            "AND from_workspace IS NOT NULL")}
        self.assertGreater(len(movers), 1)
        dests = {m["to_workspace"] for m in self.con.execute(
            "SELECT * FROM movements WHERE phase='ARRIVED' "
            "AND from_workspace IS NOT NULL")}
        self.assertGreater(len(dests), 1, "everyone walked to the same room")

    def test_a_route_goes_through_doorways_and_not_through_walls(self):
        con = world()
        SPACE.move_to(con, OPER, "ws_pad", why="an operations task waits there",
                      worker="w")
        wps = EMB.waypoints(con, OPER)
        self.assertTrue(wps, "a moving agent has no route")
        doors = {d["place"]: d for d in EMB.navmesh(con)["doors"]}
        entered = [w for w in wps if w.get("door")]
        self.assertTrue(entered, "the route enters no building through a door")
        for w in entered:
            d = doors[w["door"]]
            self.assertAlmostEqual(w["x"], d["x"], places=3)
            self.assertAlmostEqual(w["y"], d["y"], places=3)

    def test_a_still_agent_has_no_route_at_all(self):
        con = world()
        self.assertEqual(EMB.waypoints(con, RES), [])

    def test_the_last_leg_enters_the_destination_through_its_doors(self):
        """The route is planned district to district, so the leg that actually
        goes INSIDE is the one most likely to cross a wall."""
        con = world()
        SPACE.move_to(con, OPER, "ws_pad", why="an operations task waits there",
                      worker="w")
        wps = EMB.waypoints(con, OPER)
        names = [w.get("door") for w in wps]
        self.assertIn("pad", names, "the route does not enter the building")
        self.assertIn("ws_pad", names, "the route does not enter the room")
        self.assertLess(names.index("pad"), names.index("ws_pad"),
                        "the room door comes before the building door")
        self.assertEqual(wps[-1].get("arrive"), "ws_pad")

    def test_the_first_leg_leaves_through_the_door_it_came_in_by(self):
        con = world()
        SPACE.move_to(con, OPER, "ws_pad", why="an operations task waits there",
                      worker="w")
        names = [w.get("door") for w in EMB.waypoints(con, OPER)]
        self.assertEqual(names[0], "ws_dispatch")
        self.assertEqual(names[1], "dispatch")

    def test_a_door_already_behind_the_agent_is_not_still_ahead_of_it(self):
        """`waypoints` is the route that REMAINS. Once the recorded position is
        outside the building, its exit is not part of what is left."""
        con = world()
        SPACE.move_to(con, OPER, "ws_pad", why="an operations task waits there",
                      worker="w")
        SPACE.advance(con, OPER, worker="w", steps=8)
        loc = SPACE.locate(con, OPER)
        if loc["movement"] != SPACE.MOVING:
            self.skipTest("the journey finished inside one advance")
        fac = SPACE.place(con, "dispatch")
        outside = not (fac["x"] <= loc["x"] <= fac["x"] + fac["w"]
                       and fac["y"] <= loc["y"] <= fac["y"] + fac["h"])
        if not outside:
            self.skipTest("still inside the building it started in")
        names = [w.get("door") for w in EMB.waypoints(con, OPER)]
        self.assertNotIn("dispatch", names)
        self.assertNotIn("ws_dispatch", names)

    def test_two_rooms_of_one_building_are_not_reached_by_going_outdoors(self):
        """The build cells share the factory. Walking between them still goes in
        through cell 2's own door — but NOT out through the factory's and back
        in again, which is what a route that treated every room as its own
        building would do for a journey of six metres."""
        con = world()
        self.assertEqual(SPACE.place(con, "ws_cell_0")["parent_id"],
                         SPACE.place(con, "ws_cell_2")["parent_id"])
        SPACE.move_to(con, BUILD, "ws_cell_0", why="assigned a build task",
                      worker="w")
        SPACE.advance(con, BUILD, worker="w", steps=60)
        self.assertEqual(SPACE.locate(con, BUILD)["workspace"], "ws_cell_0")
        SPACE.move_to(con, BUILD, "ws_cell_2", why="the next build task",
                      worker="w", redirect=True)
        names = [w.get("door") for w in EMB.waypoints(con, BUILD) if w.get("door")]
        self.assertEqual(names, ["ws_cell_2"])

    def test_the_renderer_walks_only_the_part_that_was_covered(self):
        """The payload's waypoints are what REMAINS. A renderer that walked the
        whole remainder and then jumped back to the current position would send
        every body on a round trip once per poll."""
        js = open(os.path.join(JS, "world3d.js"), encoding="utf-8").read()
        block = js[js.index("function legsFor"):]
        block = block[:block.index("\n}")]
        self.assertIn("passed", block)
        self.assertIn("e.route", js, "the previous route is never remembered")


# ── 5. nothing is invented ──────────────────────────────────────────
class TheWorldPrefersTruth(unittest.TestCase):
    def test_a_quiet_world_lights_no_workstation(self):
        con = world()
        self.assertEqual(EMB.active_stations(con), {})
        self.assertEqual(con.execute(
            "SELECT COUNT(*) c FROM leases WHERE status='ACTIVE'").fetchone()["c"], 0)

    def test_a_station_is_lit_only_while_a_lease_is_live(self):
        con = world()
        tid = W.discover_task(con, "read the thing", by=ORCH, required_caps=["research"])
        W.transition(con, tid, "PROPOSED", ORCH)
        W.transition(con, tid, "APPROVED", ORCH)
        W.assign(con, tid, RES, by=ORCH)
        EMB.take_station(con, RES, SPACE.locate(con, RES)["workspace"])
        claim = W.claim_task(con, RES, tid)
        self.assertIsNotNone(claim)
        lit = EMB.active_stations(con)
        self.assertEqual(len(lit), 1, "a live lease lit no station")
        W.release_lease(con, claim["lease_id"])
        self.assertEqual(EMB.active_stations(con), {}, "a released lease stayed lit")

    def test_two_agents_confer_only_when_a_message_really_passed(self):
        con = world()
        self.assertEqual(EMB.encounters(con), [])

    def test_co_location_is_a_fact_about_two_rows_not_a_guess(self):
        con, _ = ran()
        for e in EMB.encounters(con):
            a = SPACE.locate(con, e["from"])
            b = SPACE.locate(con, e["to"])
            self.assertEqual(e["same_room"],
                             a["workspace"] == b["workspace"], str(e))

    def test_the_renderer_invents_no_body_and_no_activity(self):
        for name in ("bodies.js", "world3d.js", "registry.js"):
            js = open(os.path.join(JS, name), encoding="utf-8").read()
            for banned in ("Math.random", "wander", "patrol", "idleChatter",
                           "fakeAgent", "demoBody", "setInterval(() => { poseBody"):
                self.assertNotIn(banned, js, "%s: %s" % (name, banned))

    def test_the_body_never_chooses_its_own_animation(self):
        """bodies.js is handed an animation name. If it could pick one, a body
        could look busy while its agent held nothing."""
        js = open(os.path.join(JS, "bodies.js"), encoding="utf-8").read()
        pose = js[js.index("export function poseBody"):]
        self.assertNotIn("fetch(", pose)
        # An assignment TO `anim`, as opposed to a comparison against it. The
        # comparison is how the switch works; the assignment would be the body
        # deciding for itself what it is doing.
        self.assertEqual(re.findall(r"\banim\s*=(?!=)", pose), [],
                         "poseBody assigns its own animation")

    def test_the_renderer_repaints_status_without_rebuilding_identity(self):
        """A state change must not rebuild the body: an agent that changed shape
        when a task failed would not be the same agent."""
        js = open(os.path.join(JS, "world3d.js"), encoding="utf-8").read()
        block = js[js.index("} else if (col !== e.col) {"):]
        block = block[:block.index("\n    }")]
        self.assertNotIn("buildBody", block)
        self.assertNotIn("embodiment(", block)

    def test_an_agent_with_no_body_is_drawn_as_having_no_body(self):
        js = open(os.path.join(JS, "world3d.js"), encoding="utf-8").read()
        self.assertIn("if (!app)", js)
        self.assertIn("wireframe", js, "an unembodied agent is drawn as a real one")


# ── 6. the payload is the world, and only the world ─────────────────
class ThePayloadReportsRows(unittest.TestCase):
    def setUp(self):
        self.con, _ = ran()
        self.d = SRV.world3d(self.con)

    def test_every_agent_carries_its_own_stored_appearance(self):
        for aid, a in self.d["agents"].items():
            row = dict(self.con.execute(
                "SELECT * FROM agent_bodies WHERE principal_id=?", (aid,)).fetchone())
            self.assertEqual(a["appearance"]["body_id"], row["body_id"], aid)
            for f in ("primary_color", "secondary_color", "accent_color",
                      "material", "body_variant", "head_variant", "marking"):
                self.assertEqual(a["appearance"][f], row[f], "%s.%s" % (aid, f))

    def test_every_station_in_the_payload_is_a_station_in_the_table(self):
        rows = {r["id"] for r in self.con.execute("SELECT id FROM workstations")}
        self.assertEqual({s["id"] for s in self.d["stations"]}, rows)

    def test_the_lit_stations_are_exactly_the_leased_ones(self):
        for sid, info in self.d["active_stations"].items():
            lease = self.con.execute("SELECT * FROM leases WHERE id=?",
                                     (info["lease_id"],)).fetchone()
            self.assertEqual(lease["status"], "ACTIVE", sid)

    def test_the_payload_writes_nothing(self):
        before = {t: self.con.execute("SELECT COUNT(*) c FROM " + t).fetchone()["c"]
                  for t in ("agent_bodies", "workstations", "agent_locations",
                            "movements", "events")}
        for _ in range(3):
            SRV.world3d(self.con)
        for t, n in before.items():
            self.assertEqual(self.con.execute(
                "SELECT COUNT(*) c FROM " + t).fetchone()["c"], n, t)

    def test_a_disconnected_client_changes_nothing_about_the_world(self):
        """The renderer is a reader. Not asking is not a state change."""
        before = SRV.world3d(self.con)
        after = SRV.world3d(self.con)
        self.assertEqual(json.dumps(before["agents"], sort_keys=True),
                         json.dumps(after["agents"], sort_keys=True))

    def test_the_world_reconstructs_itself_after_a_server_restart(self):
        db = os.path.join(tempfile.mkdtemp(), "reopen.db")
        con, _ = ran(world(db))
        before = SRV.world3d(con)
        con.close()
        con = store.connect(db)
        after = SRV.world3d(con)
        for aid in before["agents"]:
            for f in ("x", "y", "workspace", "movement", "station",
                      "activity_state", "animation_state", "at_station"):
                self.assertEqual(before["agents"][aid][f], after["agents"][aid][f],
                                 "%s.%s did not survive the restart" % (aid, f))
            self.assertEqual(before["agents"][aid]["appearance"],
                             after["agents"][aid]["appearance"], aid)


# ── 7. scale ────────────────────────────────────────────────────────
class ItScalesWithoutPretending(unittest.TestCase):
    def test_the_data_model_carries_hundreds_of_bodies(self):
        """Hundreds of BODIES is a claim about rows and geometry. It is not a
        claim that hundreds of agents are running — five are, and the seats and
        leases below still belong to those five."""
        con = world()
        made = 0
        for i in range(400):
            aid = "AGT-SYNTH-%03d" % i
            con.execute(
                "INSERT INTO principals(id,name,role,division,department,tier,"
                "mission,status,lifecycle_state,tools,permissions,memory_scope,"
                "success_metrics,escalation_rules,created_at) "
                "VALUES(?,?,'synthetic','test','test','reader','none',"
                "'AVAILABLE','ACTIVE',?,?,?,?,?,?)",
                (aid, aid, '["t%d"]' % i, '["p%d"]' % i, '["m%d"]' % i,
                 '["s%d"]' % i, '["e%d"]' % i, store.now()))
            EMB.embody(con, aid, ["research"])
            made += 1
        n = con.execute("SELECT COUNT(*) c FROM agent_bodies").fetchone()["c"]
        self.assertEqual(n, made + len(W.CREW))
        ids = [r["body_id"] for r in con.execute("SELECT body_id FROM agent_bodies")]
        self.assertEqual(len(set(ids)), len(ids), "body ids collided at scale")
        self.assertEqual(
            con.execute("SELECT COUNT(*) c FROM leases WHERE status='ACTIVE'"
                        ).fetchone()["c"], 0,
            "synthetic bodies acquired work")

    def test_the_grammar_really_does_produce_that_many_distinct_bodies(self):
        seen = set()
        for i in range(600):
            d = EMB.design("AGT-SPREAD-%04d" % i, ["research"])
            seen.add((d["body_variant"], d["head_variant"], d["chest_variant"],
                      d["sensor_variant"], d["palette"], d["build"]))
        self.assertGreater(len(seen), 300, "the appearance space collapsed")

    def test_the_renderer_has_three_detail_tiers_and_uses_them(self):
        js = open(os.path.join(JS, "world3d.js"), encoding="utf-8").read()
        self.assertIn("bodyTierFor", js)
        for tier in ('"far"', '"mid"', '"near"'):
            self.assertIn(tier, js, tier)
        body = open(os.path.join(JS, "bodies.js"), encoding="utf-8").read()
        self.assertIn('lod !== "far"', body, "far bodies cost the same as near")

    def test_the_stress_harness_cannot_reach_the_database(self):
        js = open(os.path.join(JS, "world3d.js"), encoding="utf-8").read()
        block = js[js.index("function stress(n)"):]
        block = block[:block.index("\n}")]
        self.assertNotIn("fetch", block)
        self.assertNotIn("AGENTS.set", block, "the stress harness registers agents")


# ── 8. the whole chain ──────────────────────────────────────────────
class TheChainEndToEnd(unittest.TestCase):
    """REAL TASK → REAL AGENT → REAL STATE TRANSITION → REAL EMBODIMENT UPDATE
    → REAL MOVEMENT → REAL WORKSTATION ACTIVITY → REAL TOOL EVENT
    → REAL ARTIFACT → REAL REVIEW → REAL FINAL STATE."""

    def setUp(self):
        self.con, _ = ran()

    def test_one_task_carries_every_link(self):
        t = self.con.execute(
            "SELECT t.* FROM tasks t WHERE t.status IN ('ACCEPTED','ARCHIVED') "
            "  AND EXISTS (SELECT 1 FROM leases l WHERE l.task_id=t.id) "
            "  AND EXISTS (SELECT 1 FROM artifacts a WHERE a.task_id=t.id) "
            "  AND EXISTS (SELECT 1 FROM movements m WHERE m.task_id=t.id "
            "              AND m.phase='ARRIVED' AND m.from_workspace IS NOT NULL) "
            "ORDER BY t.id LIMIT 1").fetchone()
        self.assertIsNotNone(t, "no task ran the whole way through")
        tid = t["id"]

        lease = self.con.execute("SELECT * FROM leases WHERE task_id=? ORDER BY id",
                                 (tid,)).fetchone()
        agent = lease["principal_id"]

        states = [r["to_state"] for r in self.con.execute(
            "SELECT to_state FROM task_transitions WHERE task_id=? ORDER BY id", (tid,))]
        for s in ("APPROVED", "ASSIGNED", "RUNNING", "COMPLETED", "REVIEW"):
            self.assertIn(s, states, s)

        move = self.con.execute(
            "SELECT * FROM movements WHERE task_id=? AND phase='ARRIVED' "
            "AND from_workspace IS NOT NULL ORDER BY id", (tid,)).fetchone()
        self.assertEqual(move["principal_id"], agent)
        self.assertGreater(move["distance"], 0)
        self.assertNotEqual(move["from_workspace"], move["to_workspace"])

        st = EMB.station_of(self.con, agent)
        self.assertIsNotNone(st, "the agent that did the work holds no seat")
        self.assertEqual(st["workspace"], move["to_workspace"])

        calls = self.con.execute(
            "SELECT tc.* FROM tool_calls tc JOIN leases l ON l.id=tc.lease_id "
            "WHERE l.task_id=?", (tid,)).fetchall()
        self.assertTrue(calls, "work happened with no tool call")

        art = self.con.execute("SELECT * FROM artifacts WHERE task_id=? ORDER BY id",
                               (tid,)).fetchone()
        self.assertTrue(art["sha"])

        rev = self.con.execute(
            "SELECT r.* FROM reviews r JOIN artifacts a ON a.id=r.artifact_id "
            "WHERE a.task_id=?", (tid,)).fetchone()
        self.assertIsNotNone(rev, "nothing was reviewed")
        self.assertIn(rev["verdict"], ("APPROVE", "REJECT"))
        self.assertNotEqual(rev["reviewer_id"], agent, "an agent reviewed itself")

        self.assertIn(t["status"], ("ACCEPTED", "ARCHIVED"))
        e = EMB.embodiment(self.con, agent)
        self.assertIn(e["animation_state"], set(EMB.ANIMATION.values()))
        self.assertTrue(e["because"])

    def test_the_demo_that_prints_this_chain_runs(self):
        import embodiment_demo                     # noqa: F401
        self.assertTrue(hasattr(embodiment_demo, "show_chain"))


class SuiteHygiene(unittest.TestCase):
    def test_every_class_in_this_file_runs(self):
        src = open(__file__, encoding="utf-8").read()
        declared = set(re.findall(r"^class (\w+)\(unittest\.TestCase\)", src, re.M))
        loaded = {c.__name__ for c in
                  globals().values() if isinstance(c, type)
                  and issubclass(c, unittest.TestCase)}
        self.assertEqual(declared - loaded, set())


if __name__ == "__main__":
    unittest.main(verbosity=1)
