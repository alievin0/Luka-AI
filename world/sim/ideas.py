"""الفكرة ككائن حي: تولد ناقصة، تنبت أعضاءها، أو تموت.

القاعدة التي يقوم عليها كل شيء: الفكرة بلا جسد لا تُرفع للملك مهما كانت جميلة.
الأعضاء السبعة في names.ORGANS، وأثقلها «الدليل» — لأن أغلى ما يُفقد
في المشاريع هو اكتشاف بعد سنة أن أحداً لم يكن مستعداً للدفع أصلاً.
"""
import random

from . import db, names

# أوزان الأعضاء. مجموعها 1.0
WEIGHT = {
    "wound": 0.18, "frequency": 0.16, "price": 0.13, "proof": 0.20,
    "cost": 0.10, "channel": 0.13, "moat": 0.10,
}

# سقوف صارمة: عضو ضعيف يقصّ الدرجة مهما كان الباقي ممتازاً
GATES = [
    ("frequency", 0.34, 35.0, "لا تكرار — وجع يصير مرة بالسنة ما يبني شركة"),
    ("proof",     0.01, 55.0, "ولا واحد دفع — كل الباقي رأي"),
    ("price",     0.15, 62.0, "ما نعرف كم يدفع اليوم، فما نعرف كم نطلب"),
    ("channel",   0.15, 70.0, "ما في طريق يوصلها — منتج ممتاز بلا باب"),
]

NEGLECT_DAYS = 14   # فكرة ما لمسها أحد أسبوعين: تموت إهمالاً
NOMINATE_AT = 72.0  # الدرجة التي عندها يرفعها شيخ البيت للملك


def conceive(con, day, agent, rng, seed_text=None):
    """كشّاف يرجع بملاحظة. الملاحظة ليست فكرة — هي عضو واحد فقط."""
    sector = rng.choice(names.SECTORS)
    pain = rng.choice(names.PAINS)
    title = "%s: %s" % (sector, pain)
    cur = con.execute(
        "INSERT INTO ideas(title,house,author_id,born_day,status,sector,audience) "
        "VALUES(?,?,?,?,'جنين',?,?)",
        (title, agent["house"], agent["id"], day, sector, sector),
    )
    iid = cur.lastrowid
    # الوجع هو العضو الوحيد الذي يولد معها، وقوته من حدّة عين الكشّاف
    strength = min(0.95, 0.30 + agent["eye"] * 0.5 + rng.uniform(-0.08, 0.12))
    grow(con, iid, "wound", seed_text or pain, strength, day, agent["id"])
    db.log(con, day, "ملاحظة", "%s رجع بملاحظة من %s" % (agent["name"], sector),
           agent["id"], iid)
    return iid


def grow(con, idea_id, organ, text, strength, day, by_agent):
    """ينبت عضواً أو يقوّيه. العضو لا يضعف بالنمو — يضعف بالتشريح فقط."""
    row = con.execute(
        "SELECT strength FROM organs WHERE idea_id=? AND organ=?", (idea_id, organ)).fetchone()
    strength = max(0.0, min(1.0, strength))
    if row is None:
        con.execute(
            "INSERT INTO organs(idea_id,organ,text,strength,day,by_agent) VALUES(?,?,?,?,?,?)",
            (idea_id, organ, text, strength, day, by_agent))
    elif strength > row["strength"]:
        con.execute(
            "UPDATE organs SET text=?,strength=?,day=?,by_agent=? WHERE idea_id=? AND organ=?",
            (text, strength, day, by_agent, idea_id, organ))
    else:
        con.execute("UPDATE organs SET day=? WHERE idea_id=? AND organ=?",
                    (day, idea_id, organ))


def dissect(con, idea_id, organ, day, critic, rng):
    """المُشرّح يهاجم عضواً. إن كان مدّعى بلا سند، يضعف — وقد يُقتل الجسد كله."""
    row = con.execute(
        "SELECT strength,text FROM organs WHERE idea_id=? AND organ=?", (idea_id, organ)).fetchone()
    if row is None:
        return None
    bite = 0.10 + critic["nerve"] * 0.30 * rng.random()
    new = max(0.0, row["strength"] - bite)
    con.execute("UPDATE organs SET strength=? WHERE idea_id=? AND organ=?",
                (new, idea_id, organ))
    return (organ, row["strength"], new, bite)


def missing(con, idea_id):
    """الأعضاء التي لم تنبت بعد."""
    have = {r["organ"] for r in con.execute(
        "SELECT organ FROM organs WHERE idea_id=? AND strength>0.05", (idea_id,))}
    return [k for k, _, _ in names.ORGANS if k not in have]


def body(con, idea_id):
    rows = {r["organ"]: r for r in con.execute(
        "SELECT * FROM organs WHERE idea_id=?", (idea_id,))}
    out = []
    for key, ar, ask in names.ORGANS:
        r = rows.get(key)
        out.append({
            "key": key, "ar": ar, "ask": ask,
            "text": r["text"] if r else "",
            "strength": round(r["strength"], 2) if r else 0.0,
            "day": r["day"] if r else None,
        })
    return out


def score(con, idea_id, house=None):
    """الدرجة: مجموع موزون، مضروب بميل البيت، ثم مقصوص بالبوابات."""
    if house is None:
        row = con.execute("SELECT house FROM ideas WHERE id=?", (idea_id,)).fetchone()
        house = row["house"] if row else "wound"
    bias = names.HOUSES[house]["bias"]
    organs = {r["organ"]: r["strength"] for r in con.execute(
        "SELECT organ,strength FROM organs WHERE idea_id=?", (idea_id,))}

    raw, wsum = 0.0, 0.0
    for key, weight in WEIGHT.items():
        w = weight * bias.get(key, 1.0)
        raw += organs.get(key, 0.0) * w
        wsum += w
    value = 100.0 * raw / wsum if wsum else 0.0

    capped_by = None
    for organ, floor, cap, why in GATES:
        if organs.get(organ, 0.0) < floor and value > cap:
            value, capped_by = cap, why

    # جسد ناقص لا يتجاوز ٨٥ مهما بلغت بقية الأعضاء
    if missing(con, idea_id) and value > 85.0:
        value, capped_by = 85.0, "الجسد ناقص عضواً"

    value = round(value, 1)
    con.execute("UPDATE ideas SET score=? WHERE id=?", (value, idea_id))
    return value, capped_by


def kill(con, idea_id, day, why):
    con.execute("UPDATE ideas SET status='ميتة',died_day=?,died_why=? WHERE id=? AND status!='ممولة'",
                (day, why, idea_id))
    db.log(con, day, "موت", why, None, idea_id)


def reap(con, day):
    """يمرّ على الأحياء ويقتل المهمَل. يرجع عدد من مات."""
    dead = 0
    rows = con.execute(
        "SELECT i.id, i.born_day, COALESCE(MAX(o.day), i.born_day) last "
        "FROM ideas i LEFT JOIN organs o ON o.idea_id=i.id "
        "WHERE i.status IN ('جنين','ينمو') GROUP BY i.id").fetchall()
    for r in rows:
        if day - r["last"] >= NEGLECT_DAYS:
            kill(con, r["id"], day, "ماتت إهمالاً — %d يوم وما لمسها أحد" % (day - r["last"]))
            dead += 1
    return dead


def board(con, limit=12, status=None):
    q = ("SELECT i.*, a.name author, (SELECT COUNT(*) FROM organs o "
         "WHERE o.idea_id=i.id AND o.strength>0.05) grown "
         "FROM ideas i JOIN agents a ON a.id=i.author_id ")
    if status:
        q += "WHERE i.status=? "
        args = (status, limit)
    else:
        q += "WHERE i.status IN ('ينمو','مرفوعة','ممولة') "
        args = (limit,)
    q += "ORDER BY i.score DESC, i.id ASC LIMIT ?"
    return con.execute(q, args).fetchall()
