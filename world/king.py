#!/usr/bin/env python3
"""الملك — الواجهة الوحيدة بينك وبين العالم.

    python3 king.py found                 # يخلق العالم: ١٠٠٠ نفس، ٣ بيوت
    python3 king.py run 60                # يمرّر ٦٠ يوماً
    python3 king.py brief                 # إحاطة آخر يوم
    python3 king.py ideas --top 10        # لوح الأفكار مرتّباً
    python3 king.py idea 42               # جسد الفكرة وتاريخها كاملاً
    python3 king.py fund 42 500           # تموّلها — وتُسجَّل في خزينتك
    python3 king.py kill 42 "السبب"       # تقتلها، ويُكتب سببك في التاريخ
    python3 king.py decree "..." --set think_budget=16
    python3 king.py agent 317             # سيرة نفس واحدة
    python3 king.py houses                # ترتيب البيوت
"""
import argparse
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sim import db, engine, ideas, mind, names, population  # noqa: E402

BAR = "─" * 66


def _con(args):
    return db.connect(getattr(args, "world", None))


def _need_world(con):
    if not db.get(con, "founded"):
        sys.exit("العالم غير موجود بعد. شغّل:  python3 king.py found")


def cmd_found(args):
    con = _con(args)
    if db.get(con, "founded") and not args.force:
        sys.exit("العالم موجود أصلاً (يوم %s). استخدم --force لهدمه وإعادة بنائه."
                 % db.get(con, "day"))
    if args.force:
        for t in ("agents", "memories", "relations", "ideas", "organs",
                  "events", "ledger", "decrees", "briefs", "world"):
            con.execute("DELETE FROM " + t)
    n = population.found(con, size=args.size, seed=args.seed)
    print(BAR)
    print("وُلد العالم: %d نفس" % n)
    for h, meta in names.HOUSES.items():
        c = con.execute("SELECT COUNT(*) c FROM agents WHERE house=?", (h,)).fetchone()["c"]
        print("  %-12s %4d  ·  %s" % (meta["ar"], c, meta["creed"]))
    print(BAR)
    print("العقل: %s" % mind.describe())
    print("التالي:  python3 king.py run 30")


def cmd_run(args):
    con = _con(args)
    _need_world(con)
    start = db.get(con, "day", 0)
    print("العقل: %s · ميزانية التفكير: %d/يوم" % (mind.describe(), args.budget))
    print(BAR)

    def tick(s):
        if args.quiet:
            return
        print("يوم %-5d وُلد %-3d نما %-3d شُرّح %-3d مات %-3d رُفع %-2d %s"
              % (s["day"], s["born"], s["grown"], s["cut"], s["dead"], s["nominated"],
                 ("· فكّر %d" % s["thought"]) if s["thought"] else ""))

    engine.run(con, args.days, budget=args.budget, on_day=tick)
    print(BAR)
    print("مرّ %d يوم. الآن يوم %d." % (args.days, db.get(con, "day")))
    if mind.CALLS["asked"]:
        c = mind.CALLS
        print("النموذج: طُلب %d · ردّ %d · فشل %d · توكنز %d↓ %d↑"
              % (c["asked"], c["served"], c["failed"], c["tokens_in"], c["tokens_out"]))
    cmd_ideas(argparse.Namespace(world=args.world, top=5, status=None))


def cmd_brief(args):
    con = _con(args)
    _need_world(con)
    d = args.day if args.day else db.get(con, "day", 0)
    row = con.execute("SELECT text FROM briefs WHERE day=?", (d,)).fetchone()
    print(row["text"] if row else "لا توجد إحاطة ليوم %d" % d)


def cmd_ideas(args):
    con = _con(args)
    _need_world(con)
    rows = ideas.board(con, limit=args.top, status=args.status)
    if not rows:
        print("لوح الأفكار فارغ.")
        return
    print(BAR)
    print("%-5s %-6s %-6s %-11s %s" % ("رقم", "درجة", "أعضاء", "الحالة", "الفكرة"))
    print(BAR)
    for r in rows:
        print("%-5d %-6.1f %d/7    %-11s %s" %
              (r["id"], r["score"], r["grown"], r["status"], r["title"][:44]))
    print(BAR)
    print("للتفصيل:  python3 king.py idea <رقم>")


def cmd_idea(args):
    con = _con(args)
    _need_world(con)
    r = con.execute(
        "SELECT i.*, a.name author FROM ideas i JOIN agents a ON a.id=i.author_id WHERE i.id=?",
        (args.id,)).fetchone()
    if not r:
        sys.exit("ما في فكرة بهذا الرقم.")
    print(BAR)
    print("[%d] %s" % (r["id"], r["title"]))
    print("  %s · %s · صاحبها %s · وُلدت يوم %d · الدرجة %.1f"
          % (names.HOUSES[r["house"]]["ar"], r["status"], r["author"], r["born_day"], r["score"]))
    if r["died_why"]:
        print("  ماتت يوم %d: %s" % (r["died_day"], r["died_why"]))
    if r["funding"]:
        print("  مموّلة بـ %.2f" % r["funding"])
    print(BAR)
    for o in ideas.body(con, r["id"]):
        bar = "█" * int(o["strength"] * 10) + "░" * (10 - int(o["strength"] * 10))
        print("  %-12s %s %.2f" % (o["ar"], bar, o["strength"]))
        print("      %s" % (o["text"] or "— لم ينبت بعد: " + o["ask"]))
    miss = ideas.missing(con, r["id"])
    if miss:
        print(BAR)
        print("  ناقصها: " + "، ".join(names.ORGAN_AR[m] for m in miss))
    _, capped = ideas.score(con, r["id"], r["house"])
    if capped:
        print("  مقصوصة: " + capped)
    print(BAR)
    for e in con.execute("SELECT * FROM events WHERE idea_id=? ORDER BY day DESC LIMIT 12",
                         (r["id"],)):
        print("  يوم %-5d %-8s %s" % (e["day"], e["kind"], e["text"]))


def cmd_fund(args):
    con = _con(args)
    _need_world(con)
    r = con.execute("SELECT * FROM ideas WHERE id=?", (args.id,)).fetchone()
    if not r:
        sys.exit("ما في فكرة بهذا الرقم.")
    miss = ideas.missing(con, args.id)
    if miss and not args.anyway:
        sys.exit("جسدها ناقص: %s\nإذا مصرّ، أضف --anyway — وسيُكتب في التاريخ أنك مولتها ناقصة."
                 % "، ".join(names.ORGAN_AR[m] for m in miss))
    d = db.get(con, "day", 0)
    con.execute("UPDATE ideas SET status='ممولة', funding=funding+? WHERE id=?", (args.amount, args.id))
    con.execute("INSERT INTO ledger(day,amount,note,idea_id) VALUES(?,?,?,?)",
                (d, -args.amount, "تمويل ملكي: " + r["title"], args.id))
    con.execute("UPDATE agents SET standing=standing+6, coin=coin+? WHERE id=?",
                (args.amount * 0.05, r["author_id"]))
    db.put(con, "treasury", db.get(con, "treasury", 0.0) - args.amount)
    db.log(con, d, "تمويل", "الملك موّل «%s» بـ %.2f%s"
           % (r["title"], args.amount, " رغم نقص جسدها" if miss else ""), None, args.id)
    con.commit()
    print("مُوّلت [%d] بـ %.2f. الخزينة: %.2f" % (args.id, args.amount, db.get(con, "treasury", 0.0)))


def cmd_kill(args):
    con = _con(args)
    _need_world(con)
    d = db.get(con, "day", 0)
    ideas.kill(con, args.id, d, "قرار الملك: " + args.why)
    con.commit()
    print("قُتلت [%d]." % args.id)


def cmd_decree(args):
    con = _con(args)
    _need_world(con)
    effect = {}
    for pair in args.set or []:
        k, _, v = pair.partition("=")
        try:
            effect[k.strip()] = float(v) if "." in v else int(v)
        except ValueError:
            effect[k.strip()] = v.strip()
    d = db.get(con, "day", 0)
    import json as _json
    con.execute("INSERT INTO decrees(day,text,effect) VALUES(?,?,?)",
                (d, args.text, _json.dumps(effect, ensure_ascii=False)))
    db.log(con, d, "مرسوم", args.text)
    con.commit()
    print("صدر المرسوم يوم %d." % d)
    if effect:
        print("أثره: %s" % effect)


def cmd_agent(args):
    con = _con(args)
    _need_world(con)
    a = con.execute("SELECT * FROM agents WHERE id=?", (args.id,)).fetchone()
    if not a:
        sys.exit("ما في أحد بهذا الرقم.")
    print(BAR)
    print("[%d] %s — %s في %s" % (a["id"], a["name"], a["role"], names.HOUSES[a["house"]]["ar"]))
    print("  %s" % a["trait"])
    print("  مهارة %.2f · جرأة %.2f · عين %.2f · صبر %.2f · سمعة %.1f · رصيد %.2f"
          % (a["skill"], a["nerve"], a["eye"], a["patience"], a["standing"], a["coin"]))
    print("  وُلد يوم %d%s" % (a["born_day"], " · اعتزل يوم %d" % a["died_day"] if a["died_day"] else ""))
    mine = con.execute("SELECT id,title,score,status FROM ideas WHERE author_id=? "
                       "ORDER BY score DESC LIMIT 6", (a["id"],)).fetchall()
    if mine:
        print(BAR)
        print("  أفكاره:")
        for m in mine:
            print("    [%d] %-5.1f %-10s %s" % (m["id"], m["score"], m["status"], m["title"][:40]))
    ev = con.execute("SELECT * FROM events WHERE agent_id=? ORDER BY day DESC LIMIT 8",
                     (a["id"],)).fetchall()
    if ev:
        print(BAR)
        for e in ev:
            print("  يوم %-5d %-8s %s" % (e["day"], e["kind"], e["text"]))


def cmd_houses(args):
    con = _con(args)
    _need_world(con)
    print(BAR)
    print("%-12s %-6s %-7s %-7s %-7s %-8s %s" %
          ("البيت", "أحياء", "أفكار", "أعلى", "متوسط", "مموّلة", "ماتت"))
    print(BAR)
    for r in population.standings(con):
        print("%-12s %-6d %-7d %-7.1f %-7.1f %-8d %d" %
              (r["ar"], r["alive"], r["ideas"], r["best"], r["avg"], r["funded"], r["dead"]))
    print(BAR)
    for h, meta in names.HOUSES.items():
        print("  %s — %s" % (meta["ar"], meta["creed"]))


def cmd_status(args):
    con = _con(args)
    _need_world(con)
    d = db.get(con, "day", 0)
    alive = con.execute("SELECT COUNT(*) c FROM agents WHERE died_day IS NULL").fetchone()["c"]
    counts = {r["status"]: r["c"] for r in con.execute(
        "SELECT status, COUNT(*) c FROM ideas GROUP BY status")}
    print(BAR)
    print("يوم %d · %d نفس على قيد الحياة · الخزينة %.2f"
          % (d, alive, db.get(con, "treasury", 0.0)))
    print("الأفكار: " + " · ".join("%s %d" % (k, v) for k, v in counts.items()) or "لا شيء بعد")
    print("العقل: %s" % mind.describe())
    print("الملف: %s" % (args.world or db.DEFAULT_PATH))
    print(BAR)


def main(argv=None):
    p = argparse.ArgumentParser(prog="king", description="الملك — واجهة العالم")
    p.add_argument("--world", help="مسار ملف العالم (الافتراضي world/world.db)")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("found", help="يخلق العالم")
    s.add_argument("--size", type=int, default=1000)
    s.add_argument("--seed", type=int, default=7)
    s.add_argument("--force", action="store_true")
    s.set_defaults(fn=cmd_found)

    s = sub.add_parser("run", help="يمرّر أياماً")
    s.add_argument("days", type=int)
    s.add_argument("--budget", type=int, default=engine.THINK_BUDGET)
    s.add_argument("--quiet", action="store_true")
    s.set_defaults(fn=cmd_run)

    s = sub.add_parser("brief"); s.add_argument("day", nargs="?", type=int); s.set_defaults(fn=cmd_brief)

    s = sub.add_parser("ideas")
    s.add_argument("--top", type=int, default=12)
    s.add_argument("--status", choices=["جنين", "ينمو", "مرفوعة", "ممولة", "ميتة"])
    s.set_defaults(fn=cmd_ideas)

    s = sub.add_parser("idea"); s.add_argument("id", type=int); s.set_defaults(fn=cmd_idea)

    s = sub.add_parser("fund")
    s.add_argument("id", type=int); s.add_argument("amount", type=float)
    s.add_argument("--anyway", action="store_true")
    s.set_defaults(fn=cmd_fund)

    s = sub.add_parser("kill")
    s.add_argument("id", type=int); s.add_argument("why"); s.set_defaults(fn=cmd_kill)

    s = sub.add_parser("decree")
    s.add_argument("text"); s.add_argument("--set", action="append")
    s.set_defaults(fn=cmd_decree)

    s = sub.add_parser("agent"); s.add_argument("id", type=int); s.set_defaults(fn=cmd_agent)
    sub.add_parser("houses").set_defaults(fn=cmd_houses)
    sub.add_parser("status").set_defaults(fn=cmd_status)

    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    # `king.py ideas | head` يقطع الأنبوب؛ هذا ليس خطأ يستحق أثراً
    try:
        main()
    except BrokenPipeError:
        try:
            sys.stdout.close()
        except BrokenPipeError:
            pass
        os._exit(0)
    except KeyboardInterrupt:
        sys.exit(130)
