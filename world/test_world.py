#!/usr/bin/env python3
"""فحوصات العالم — تُشغّل بـ: python3 test_world.py

كل فحص هنا وُجد لأن شيئاً انكسر فعلاً، لا لأنه بدا فحصاً جيداً.
"""
import os
import random
import tempfile
import unittest

from sim import db, engine, ideas, mind, names, population


class World(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.path = os.path.join(cls.tmp, "t.db")
        cls.con = db.connect(cls.path)
        population.found(cls.con, size=210, seed=3)
        engine.run(cls.con, 55, budget=0, seed=3)

    # ── الساكنة ────────────────────────────────────────────
    def test_population_size(self):
        n = self.con.execute("SELECT COUNT(*) c FROM agents").fetchone()["c"]
        self.assertGreaterEqual(n, 210)

    def test_every_house_has_an_elder(self):
        for h in names.HOUSES:
            c = self.con.execute(
                "SELECT COUNT(*) c FROM agents WHERE house=? AND role='شيخ البيت'",
                (h,)).fetchone()["c"]
            self.assertGreater(c, 0, "بيت %s بلا شيخ" % h)

    def test_scale_is_laptop_sized(self):
        """ألف نفس × ٣٠ يوماً يجب أن تمر في ثوانٍ، لا دقائق."""
        import time
        p = os.path.join(self.tmp, "big.db")
        con = db.connect(p)
        population.found(con, size=1000, seed=5)
        t0 = time.time()
        engine.run(con, 30, budget=0, seed=5)
        self.assertLess(time.time() - t0, 20.0)

    # ── الأفكار ────────────────────────────────────────────
    def test_ideas_are_born(self):
        c = self.con.execute("SELECT COUNT(*) c FROM ideas").fetchone()["c"]
        self.assertGreater(c, 0)

    def test_most_ideas_die(self):
        """عالم لا تموت فيه الأفكار عالم يكذب."""
        dead = self.con.execute(
            "SELECT COUNT(*) c FROM ideas WHERE status='ميتة'").fetchone()["c"]
        total = self.con.execute("SELECT COUNT(*) c FROM ideas").fetchone()["c"]
        self.assertGreater(dead / max(total, 1), 0.25)

    def test_no_incomplete_body_stands_before_the_king(self):
        bad = self.con.execute(
            "SELECT COUNT(*) c FROM ideas i WHERE i.status IN ('مرفوعة','ممولة') AND "
            "(SELECT COUNT(*) FROM organs o WHERE o.idea_id=i.id AND o.strength>0.05) < 7"
        ).fetchone()["c"]
        self.assertEqual(bad, 0)

    def test_an_idea_is_nominated_once(self):
        dup = self.con.execute(
            "SELECT COUNT(*) c FROM (SELECT idea_id FROM events WHERE kind='رفع' "
            "GROUP BY idea_id HAVING COUNT(*)>1)").fetchone()["c"]
        self.assertEqual(dup, 0)

    def test_the_wound_belongs_to_its_own_idea(self):
        """عضو الوجع يجب أن يكون وجع هذه الفكرة، لا وجعاً عشوائياً."""
        rows = self.con.execute(
            "SELECT i.title, o.text FROM ideas i JOIN organs o ON o.idea_id=i.id "
            "WHERE o.organ='wound' AND o.strength>0.05 LIMIT 80").fetchall()
        self.assertTrue(rows)
        for r in rows:
            own = (r["title"].split(": ", 1) + [""])[1]
            self.assertEqual(r["text"], own)

    # ── البوابات: هذه هي «الأفكار ذات الأجساد القوية» ──────
    def test_no_proof_is_capped(self):
        iid = self.con.execute(
            "INSERT INTO ideas(title,house,author_id,born_day,status) "
            "VALUES('اختبار','wound',1,1,'ينمو')").lastrowid
        for organ in ("wound", "frequency", "price", "cost", "channel", "moat"):
            ideas.grow(self.con, iid, organ, "ممتاز", 1.0, 1, 1)
        ideas.grow(self.con, iid, "proof", "", 0.0, 1, 1)
        value, why = ideas.score(self.con, iid)
        self.assertLessEqual(value, 55.0)
        self.assertIn("دفع", why)

    def test_no_frequency_is_capped_hardest(self):
        iid = self.con.execute(
            "INSERT INTO ideas(title,house,author_id,born_day,status) "
            "VALUES('اختبار٢','wound',1,1,'ينمو')").lastrowid
        for organ in ("wound", "price", "proof", "cost", "channel", "moat"):
            ideas.grow(self.con, iid, organ, "ممتاز", 1.0, 1, 1)
        ideas.grow(self.con, iid, "frequency", "مرة بالسنة", 0.05, 1, 1)
        value, why = ideas.score(self.con, iid)
        self.assertLessEqual(value, 35.0)
        self.assertIn("تكرار", why)

    def test_a_perfect_body_scores_high(self):
        """البوابات تقصّ الناقص — يجب ألا تقصّ الكامل."""
        iid = self.con.execute(
            "INSERT INTO ideas(title,house,author_id,born_day,status) "
            "VALUES('اختبار٣','wound',1,1,'ينمو')").lastrowid
        for organ, _, _ in names.ORGANS:
            ideas.grow(self.con, iid, organ, "مسنود برقم", 0.95, 1, 1)
        value, why = ideas.score(self.con, iid)
        self.assertGreater(value, 90.0)
        self.assertIsNone(why)

    def test_weights_sum_to_one(self):
        self.assertAlmostEqual(sum(ideas.WEIGHT.values()), 1.0, places=6)

    def test_every_organ_has_a_weight(self):
        for key, _, _ in names.ORGANS:
            self.assertIn(key, ideas.WEIGHT)

    # ── الملك ──────────────────────────────────────────────
    def test_decree_changes_the_world(self):
        con = db.connect(os.path.join(self.tmp, "d.db"))
        population.found(con, size=90, seed=9)
        con.execute("INSERT INTO decrees(day,text,effect) VALUES(1,'ارفع السقف','{\"nominate_at\": 99.5}')")
        con.commit()
        engine.run(con, 30, budget=0, seed=9)
        up = con.execute("SELECT COUNT(*) c FROM ideas WHERE status='مرفوعة'").fetchone()["c"]
        self.assertEqual(up, 0, "مرسوم رفع السقف إلى ٩٩.٥ ومع ذلك رُفعت أفكار")

    # ── العقل ──────────────────────────────────────────────
    def test_offline_never_raises(self):
        """العالم لا يتوقف لأن النموذج غائب أو الشبكة مقطوعة."""
        rng = random.Random(1)
        a = dict(self.con.execute("SELECT * FROM agents LIMIT 1").fetchone())
        i = dict(self.con.execute("SELECT * FROM ideas LIMIT 1").fetchone())
        for organ, _, _ in names.ORGANS:
            text, strength, src = mind.think(a, i, organ, "", rng)
            self.assertTrue(text)
            self.assertGreaterEqual(strength, 0.0)
            self.assertLessEqual(strength, 1.0)

    def test_mode_is_honest(self):
        self.assertIn("offline", mind.describe())


if __name__ == "__main__":
    unittest.main(verbosity=2)
