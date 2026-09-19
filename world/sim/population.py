"""ولادة العالم: ألف نفس، ثلاثة بيوت، ووظائف يعيشون بها.

التوزيع ليس عشوائياً بالكامل — كل بيت يحتاج نسبة مختلفة من الوظائف،
لأن بيت الوجع يحتاج كشّافين أكثر، وبيت الحيلة يحتاج مُحاسبين أكثر.
"""
import random

from . import db, names

# كم واحد من كل وظيفة في كل مئة — يختلف باختلاف عقيدة البيت
MIX = {
    "wound":  {"كشّاف": 34, "صانع": 20, "مُشرّح": 16, "مُحاسب": 8,  "تاجر": 14, "معلّم": 6, "شيخ البيت": 2},
    "craft":  {"كشّاف": 16, "صانع": 30, "مُشرّح": 18, "مُحاسب": 18, "تاجر": 10, "معلّم": 6, "شيخ البيت": 2},
    "market": {"كشّاف": 22, "صانع": 18, "مُشرّح": 12, "مُحاسب": 8,  "تاجر": 32, "معلّم": 6, "شيخ البيت": 2},
}


def _name(rng, used):
    for _ in range(60):
        first = rng.choice(names.MALE if rng.random() < 0.55 else names.FEMALE)
        full = first + " " + rng.choice(names.FAMILY)
        if full not in used:
            used.add(full)
            return full
    return first + " " + rng.choice(names.FAMILY) + " " + str(len(used))


def _roles_for(house, count, rng):
    mix = MIX[house]
    total = sum(mix.values())
    out = []
    for role, share in mix.items():
        out += [role] * int(round(count * share / total))
    while len(out) < count:
        out.append("كشّاف")
    out = out[:count]
    rng.shuffle(out)
    # كل بيت له شيخ واحد على الأقل مهما دار العشوائي
    if "شيخ البيت" not in out:
        out[0] = "شيخ البيت"
    return out


def found(con, size=1000, seed=7, day=0):
    """يبني الساكنة من الصفر. يرجع عدد من وُلدوا."""
    rng = random.Random(seed)
    houses = list(names.HOUSES)
    per = size // len(houses)
    sizes = {h: per for h in houses}
    sizes[houses[0]] += size - per * len(houses)

    used_names = set()
    rows = []
    aid = 0
    for house in houses:
        roles = _roles_for(house, sizes[house], rng)
        for role in roles:
            aid += 1
            # المهارة تتوزع كواقع: أغلبهم متوسط، وقلة نادرة ممتازة
            skill = min(0.97, max(0.05, rng.betavariate(2.2, 4.0)))
            rows.append((
                aid,
                _name(rng, used_names),
                house,
                role,
                day,
                1.0,
                round(rng.uniform(0, 30), 2),
                round(skill, 3),
                round(min(1.0, max(0.02, rng.betavariate(2, 2))), 3),   # nerve
                round(min(1.0, max(0.02, rng.betavariate(2, 2.6))), 3),  # eye
                round(min(1.0, max(0.02, rng.betavariate(2.4, 2))), 3),  # patience
                rng.choice(names.TRAITS),
            ))

    con.executemany(
        "INSERT INTO agents(id,name,house,role,born_day,energy,coin,skill,nerve,eye,patience,trait) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        rows,
    )

    # المعلّمون يتبنّون الصغار: كل معلّم يأخذ من يقدر عليه
    for house in houses:
        teachers = [r["id"] for r in con.execute(
            "SELECT id FROM agents WHERE house=? AND role='معلّم'", (house,))]
        juniors = [r["id"] for r in con.execute(
            "SELECT id FROM agents WHERE house=? AND role!='معلّم' AND skill<0.4", (house,))]
        if not teachers:
            continue
        for i, jid in enumerate(juniors):
            con.execute("UPDATE agents SET mentor_id=? WHERE id=?", (teachers[i % len(teachers)], jid))

    # روابط البداية: كل واحد يعرف حفنة من بيته
    links = []
    for house in houses:
        ids = [r["id"] for r in con.execute("SELECT id FROM agents WHERE house=?", (house,))]
        for a in ids:
            for b in rng.sample(ids, min(4, len(ids))):
                if a != b:
                    links.append((a, b, round(rng.uniform(0.1, 0.6), 2), "زميل"))
    con.executemany(
        "INSERT OR IGNORE INTO relations(a,b,bond,kind) VALUES(?,?,?,?)", links)

    db.put(con, "day", day)
    db.put(con, "size", size)
    db.put(con, "seed", seed)
    db.put(con, "treasury", 0.0)
    db.put(con, "founded", True)
    db.log(con, day, "تأسيس",
           "وُلد العالم: %d نفس في %d بيوت." % (size, len(houses)))
    con.commit()
    return size


def standings(con):
    """ترتيب البيوت — بالنتيجة، لا بالنشاط."""
    out = []
    for h, meta in names.HOUSES.items():
        alive = con.execute(
            "SELECT COUNT(*) c FROM agents WHERE house=? AND died_day IS NULL", (h,)).fetchone()["c"]
        row = con.execute(
            "SELECT COUNT(*) n, COALESCE(AVG(score),0) avg, COALESCE(MAX(score),0) best "
            "FROM ideas WHERE house=? AND status IN ('ينمو','مرفوعة','ممولة')", (h,)).fetchone()
        funded = con.execute(
            "SELECT COUNT(*) c, COALESCE(SUM(funding),0) s FROM ideas WHERE house=? AND status='ممولة'",
            (h,)).fetchone()
        dead = con.execute(
            "SELECT COUNT(*) c FROM ideas WHERE house=? AND status='ميتة'", (h,)).fetchone()["c"]
        out.append({
            "house": h, "ar": meta["ar"], "alive": alive,
            "ideas": row["n"], "avg": round(row["avg"], 1), "best": round(row["best"], 1),
            "funded": funded["c"], "money": round(funded["s"], 2), "dead": dead,
        })
    out.sort(key=lambda r: (r["funded"], r["best"], r["avg"]), reverse=True)
    return out
