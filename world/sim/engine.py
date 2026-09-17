"""اليوم الواحد في هذا العالم.

ألف نفس تتحرك كل يوم، لكن قليلين منهم فقط «يفكّرون» بنموذج —
لأن التفكير يكلّف، والعالم لازم يشتغل على لابتوب بلا فاتورة.
البقية يشتغلون بقواعد: وهذا ليس غشاً، هذا ما يفعله البشر أغلب أيامهم.
"""
import json
import random

from . import db, ideas, mind, names, population

THINK_BUDGET = 8      # كم وكيلاً يستدعي النموذج في اليوم
REST_ENERGY = 0.34
RETIRE_AFTER = 900    # يوم خدمة قبل أن يشيخ


def _load(con):
    return [dict(r) for r in con.execute(
        "SELECT * FROM agents WHERE died_day IS NULL")]


def _decrees(con):
    eff = {}
    for r in con.execute("SELECT effect FROM decrees WHERE active=1"):
        try:
            eff.update(json.loads(r["effect"]))
        except (ValueError, TypeError):
            pass
    return eff


def _live_ideas(con, house):
    return [dict(r) for r in con.execute(
        "SELECT i.*, (SELECT COUNT(*) FROM organs o WHERE o.idea_id=i.id AND o.strength>0.05) grown "
        "FROM ideas i WHERE i.house=? AND i.status IN ('جنين','ينمو') "
        "ORDER BY i.score DESC LIMIT 60", (house,))]


def _bodytext(con, idea_id):
    rows = ideas.body(con, idea_id)
    lines = []
    for o in rows:
        mark = "—" if o["strength"] <= 0.05 else "%.2f" % o["strength"]
        lines.append("  %-12s [%s] %s" % (o["ar"], mark, o["text"] or "(لم ينبت)"))
    return "\n".join(lines)


def _organ_for(role, missing_list, rng):
    """كل وظيفة تنبت أعضاء بعينها. الدليل لا يأتي إلا من تاجر."""
    want = {
        "صانع":   ["wound", "frequency", "channel", "moat"],
        "مُحاسب": ["price", "cost"],
        "تاجر":   ["proof", "price", "channel"],
        "كشّاف":  ["wound", "frequency"],
    }.get(role, ["wound"])
    pool = [o for o in want if o in missing_list] or want
    return rng.choice(pool)


def day(con, rng, budget=THINK_BUDGET):
    """يمرّر يوماً واحداً. يرجع ملخّصاً رقمياً."""
    d = int(db.get(con, "day", 0)) + 1
    eff = _decrees(con)
    budget = int(eff.get("think_budget", budget))
    nominate_at = float(eff.get("nominate_at", ideas.NOMINATE_AT))

    agents = _load(con)
    by_house = {}
    for a in agents:
        by_house.setdefault(a["house"], []).append(a)

    pool = {h: _live_ideas(con, h) for h in by_house}
    planned = []       # (أولوية، وكيل، فكرة، عضو)
    stats = {"born": 0, "grown": 0, "cut": 0, "nominated": 0, "dead": 0,
             "thought": 0, "rested": 0}

    for a in agents:
        if a["energy"] < REST_ENERGY:
            a["energy"] = min(1.0, a["energy"] + 0.45)
            stats["rested"] += 1
            continue

        role, house = a["role"], a["house"]
        mine = pool.get(house, [])

        if role == "معلّم":
            for m in con.execute(
                    "SELECT id,skill FROM agents WHERE mentor_id=? AND died_day IS NULL", (a["id"],)):
                gain = 0.004 * (1.0 + a["skill"])
                con.execute("UPDATE agents SET skill=MIN(0.98, skill+?) WHERE id=?", (gain, m["id"]))
            a["energy"] -= 0.12
            continue

        if role == "شيخ البيت":
            for idea in mine:
                # الحالة في اللقطة قديمة: شيخ آخر قد يكون رفعها قبل دقيقة
                fresh = con.execute("SELECT status FROM ideas WHERE id=?",
                                    (idea["id"],)).fetchone()
                if fresh and fresh["status"] in ("ينمو", "جنين") \
                        and idea["score"] >= nominate_at \
                        and not ideas.missing(con, idea["id"]):
                    con.execute("UPDATE ideas SET status='مرفوعة' WHERE id=?", (idea["id"],))
                    db.log(con, d, "رفع", "%s رفع «%s» للملك بدرجة %.1f"
                           % (a["name"], idea["title"], idea["score"]), a["id"], idea["id"])
                    con.execute("UPDATE agents SET standing=standing+2 WHERE id=?",
                                (idea["author_id"],))
                    stats["nominated"] += 1
            a["energy"] -= 0.10
            continue

        if role == "كشّاف" and (not mine or rng.random() < 0.22 + a["eye"] * 0.2):
            ideas.conceive(con, d, a, rng)
            stats["born"] += 1
            a["energy"] -= 0.30
            continue

        if not mine:
            continue
        # يختار من بين ثلاث: الأعلى درجة يجذب، لكن العنيد يمسك الناقص
        pick = max(rng.sample(mine, min(3, len(mine))),
                   key=lambda x: x["score"] + (8.0 if x["id"] == a["focus_idea"] else 0.0))

        if role == "مُشرّح":
            organs = [r for r in con.execute(
                "SELECT organ,strength FROM organs WHERE idea_id=? ORDER BY strength DESC",
                (pick["id"],))]
            if organs:
                target = organs[0]["organ"] if a["nerve"] > 0.5 else organs[-1]["organ"]
                cut = ideas.dissect(con, pick["id"], target, d, a, rng)
                if cut:
                    stats["cut"] += 1
                    if cut[2] < 0.06 and rng.random() < a["nerve"]:
                        ideas.kill(con, pick["id"], d,
                                   "%s شرّحها: «%s» انهار تحت السؤال"
                                   % (a["name"], names.ORGAN_AR[target]))
                        stats["dead"] += 1
                    con.execute("UPDATE agents SET standing=standing+0.4 WHERE id=?", (a["id"],))
            a["energy"] -= 0.22
            continue

        miss = ideas.missing(con, pick["id"])
        organ = _organ_for(role, miss, rng)
        # الأولوية: فكرة واعدة + وكيل ماهر + عضو ناقص = تستحق تفكيراً حقيقياً
        priority = pick["score"] * 0.6 + a["skill"] * 40 + (25 if organ in miss else 0) \
            + (15 if organ == "proof" else 0)
        planned.append((priority, a, pick, organ))
        a["energy"] -= 0.26

    # ميزانية التفكير: الأعلى أولوية فقط يستدعون النموذج
    planned.sort(key=lambda p: p[0], reverse=True)
    for i, (_, a, idea, organ) in enumerate(planned):
        if i < budget and mind.available():
            text, strength, src = mind.think(a, idea, organ, _bodytext(con, idea["id"]), rng)
            if src != "offline":
                stats["thought"] += 1
        else:
            text, strength = mind._offline(a, idea, organ, rng)
        # الدليل غالٍ: التاجر ينجح في انتزاعه أحياناً فقط
        if organ == "proof" and rng.random() > 0.18 + a["skill"] * 0.35:
            db.log(con, d, "رفض", "%s حاول ينتزع دليل دفع لـ«%s» — ما أحد دفع"
                   % (a["name"], idea["title"]), a["id"], idea["id"])
            continue
        ideas.grow(con, idea["id"], organ, text, strength, d, a["id"])
        con.execute("UPDATE ideas SET status='ينمو' WHERE id=? AND status='جنين'", (idea["id"],))
        con.execute("UPDATE agents SET focus_idea=? WHERE id=?", (idea["id"], a["id"]))
        stats["grown"] += 1
        if organ == "proof":
            db.log(con, d, "دليل", "%s انتزع دليل دفع لـ«%s»" % (a["name"], idea["title"]),
                   a["id"], idea["id"])

    # إعادة التقدير، ثم حصاد المهمَل
    for r in con.execute(
            "SELECT id,house,status,title FROM ideas WHERE status IN ('جنين','ينمو','مرفوعة')").fetchall():
        ideas.score(con, r["id"], r["house"])
        # فكرة رُفعت للملك ثم هدم مُشرّح عضواً فيها: تنزل من اللوح.
        # لا يقف أمام الملك جسد ناقص، ولو وقف أمامه بالأمس كاملاً.
        if r["status"] == "مرفوعة" and ideas.missing(con, r["id"]):
            con.execute("UPDATE ideas SET status='ينمو' WHERE id=?", (r["id"],))
            db.log(con, d, "سحب", "سُحبت «%s» من لوح الملك: انهار عضو فيها بعد الرفع"
                   % r["title"], None, r["id"])
    stats["dead"] += ideas.reap(con, d)

    # الطاقة والعمر والعلاقات
    con.executemany("UPDATE agents SET energy=? WHERE id=?",
                    [(round(min(1.0, max(0.0, a["energy"] + 0.14)), 3), a["id"]) for a in agents])
    if d % 30 == 0:
        _turnover(con, d, rng)

    db.put(con, "day", d)
    _brief(con, d, stats)
    con.commit()
    stats["day"] = d
    return stats


def _turnover(con, d, rng):
    """الحياة تمشي: من طال به العمر بلا أثر يعتزل، ويأتي جديد مكانه."""
    old = con.execute(
        "SELECT id,name,house,role FROM agents WHERE died_day IS NULL AND ?-born_day > ? "
        "AND standing < 1 ORDER BY standing ASC LIMIT 6", (d, RETIRE_AFTER)).fetchall()
    for o in old:
        con.execute("UPDATE agents SET died_day=? WHERE id=?", (d, o["id"]))
        db.log(con, d, "اعتزال", "%s اعتزل بلا أثر يُذكر" % o["name"], o["id"])
        nid = con.execute("SELECT COALESCE(MAX(id),0)+1 n FROM agents").fetchone()["n"]
        nm = rng.choice(names.MALE + names.FEMALE) + " " + rng.choice(names.FAMILY)
        con.execute(
            "INSERT INTO agents(id,name,house,role,born_day,skill,nerve,eye,patience,trait) "
            "VALUES(?,?,?,?,?,?,?,?,?,?)",
            (nid, nm, o["house"], o["role"], d,
             round(min(0.9, max(0.05, rng.betavariate(2, 5))), 3),
             round(rng.random(), 3), round(rng.random(), 3), round(rng.random(), 3),
             rng.choice(names.TRAITS)))
        db.log(con, d, "ولادة", "%s دخل %s" % (nm, names.HOUSES[o["house"]]["ar"]), nid)


def _brief(con, d, s):
    top = ideas.board(con, limit=3)
    lines = ["يوم %d" % d,
             "  وُلد %d · نما %d عضواً · شُرّح %d · مات %d · رُفع %d"
             % (s["born"], s["grown"], s["cut"], s["dead"], s["nominated"])]
    if s["thought"]:
        lines.append("  فكّر بالنموذج: %d وكيلاً" % s["thought"])
    if top:
        lines.append("  الأعلى:")
        for t in top:
            lines.append("    [%d] %.1f · %s · %s" % (t["id"], t["score"], t["title"], t["status"]))
    text = "\n".join(lines)
    con.execute("INSERT INTO briefs(day,text) VALUES(?,?) "
                "ON CONFLICT(day) DO UPDATE SET text=excluded.text", (d, text))


def run(con, days, budget=THINK_BUDGET, seed=None, on_day=None):
    rng = random.Random(seed if seed is not None else db.get(con, "seed", 7) + db.get(con, "day", 0))
    out = []
    for _ in range(days):
        s = day(con, rng, budget)
        out.append(s)
        if on_day:
            on_day(s)
    return out
