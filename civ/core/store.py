"""World state. One SQLite file, and the laws live in it rather than above it."""
import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone

SCHEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")
ORG_SCHEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "org_schema.sql")
BENCH_SCHEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bench_schema.sql")
DEFAULT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "civ.db")

MODES = ("simulation", "live", "hybrid")


def now():
    # microseconds, not seconds: a one-second lease must be able to expire
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def sha(x):
    if not isinstance(x, (bytes, bytearray)):
        x = json.dumps(x, sort_keys=True, ensure_ascii=False).encode() if not isinstance(x, str) \
            else x.encode()
    return hashlib.sha256(x).hexdigest()


def connect(path=None):
    path = path or os.environ.get("CIV_DB") or DEFAULT
    con = sqlite3.connect(path, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    for path in (SCHEMA, ORG_SCHEMA, BENCH_SCHEMA):
        with open(path, encoding="utf-8") as fh:
            con.executescript(fh.read())
    # Organisational lifecycle is a DIFFERENT axis from runtime status:
    # status says what the agent is doing right now, lifecycle_state says
    # whether the organisation has approved it to exist at all.
    cols = {r[1] for r in con.execute("PRAGMA table_info(principals)")}
    if "lifecycle_state" not in cols:
        con.execute("ALTER TABLE principals ADD COLUMN lifecycle_state TEXT NOT NULL "
                    "DEFAULT 'ACTIVE'")
    if "model_policy" not in cols:
        con.execute("ALTER TABLE principals ADD COLUMN model_policy TEXT NOT NULL "
                    "DEFAULT '{}'")
    if "cost_limit_usd" not in cols:
        con.execute("ALTER TABLE principals ADD COLUMN cost_limit_usd REAL NOT NULL "
                    "DEFAULT 1.0")
    if "task_limit" not in cols:
        con.execute("ALTER TABLE principals ADD COLUMN task_limit INTEGER NOT NULL "
                    "DEFAULT 50")
    if "review_policy" not in cols:
        con.execute("ALTER TABLE principals ADD COLUMN review_policy TEXT NOT NULL "
                    "DEFAULT '{}'")
    if "updated_at" not in cols:
        con.execute("ALTER TABLE principals ADD COLUMN updated_at TEXT")
    _widen_bench_run_status(con)
    return con


def _table_ddl(schema_path, table):
    """The CREATE TABLE statement the schema file produces, read back from SQLite.

    Taken from a throwaway in-memory database rather than written out a second
    time here, so a migration can never drift from the schema it migrates to."""
    tmp = sqlite3.connect(":memory:")
    try:
        with open(schema_path, encoding="utf-8") as fh:
            tmp.executescript(fh.read())
        row = tmp.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
                          (table,)).fetchone()
        return row[0] if row else None
    finally:
        tmp.close()


def _widen_bench_run_status(con):
    """Let an existing world record INCOMPLETE. Lossless, or it does not happen.

    A CHECK constraint can only be widened by rebuilding the table, and this
    table holds the raw runs of campaigns #1-#3 on the owner's machine. So the
    rebuild copies every row inside one transaction and verifies the count and a
    checksum of the copy against the original before dropping anything. If they
    disagree the whole thing rolls back and the old table stands. LAW 12 forbids
    REWRITING a closed campaign; this changes no row, only what the table will
    accept from here on.
    """
    row = con.execute("SELECT sql FROM sqlite_master WHERE type='table' "
                      "AND name='bench_runs'").fetchone()
    if row is None or "'INCOMPLETE'" in (row["sql"] or ""):
        return False
    ddl = _table_ddl(BENCH_SCHEMA, "bench_runs")
    if not ddl or "'INCOMPLETE'" not in ddl:
        return False
    cols = [r[1] for r in con.execute("PRAGMA table_info(bench_runs)")]
    collist = ",".join('"%s"' % c for c in cols)

    def fingerprint(table):
        rows = con.execute("SELECT %s FROM %s ORDER BY id" % (collist, table)).fetchall()
        return len(rows), sha([[r[c] for c in cols] for r in rows])

    before = fingerprint("bench_runs")
    con.execute("PRAGMA foreign_keys=OFF")
    try:
        con.execute("BEGIN")
        con.execute(ddl.replace("bench_runs", "bench_runs_migrating", 1))
        con.execute("INSERT INTO bench_runs_migrating(%s) SELECT %s FROM bench_runs"
                    % (collist, collist))
        after = fingerprint("bench_runs_migrating")
        if after != before:
            raise RuntimeError("bench_runs migration would lose rows: %r -> %r"
                               % (before, after))
        con.execute("DROP TABLE bench_runs")
        # law_evaluator_isolation lives on bench_evaluations and names bench_runs.
        # Modern SQLite reparses every trigger during a RENAME and refuses when one
        # of them points at a table that is momentarily absent; legacy_alter_table
        # is the documented way through, and the schema script below restores the
        # trigger either way.
        con.execute("PRAGMA legacy_alter_table=ON")
        con.execute("ALTER TABLE bench_runs_migrating RENAME TO bench_runs")
        con.execute("PRAGMA legacy_alter_table=OFF")
        if list(con.execute("PRAGMA foreign_key_check")):
            raise RuntimeError("bench_runs migration broke a foreign key")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        con.execute("PRAGMA legacy_alter_table=OFF")
        con.execute("PRAGMA foreign_keys=ON")
        raise
    con.execute("PRAGMA foreign_keys=ON")
    # The index and LAW 12's trigger went with the dropped table; the schema
    # script is idempotent and puts them back.
    with open(BENCH_SCHEMA, encoding="utf-8") as fh:
        con.executescript(fh.read())
    return True


def meta(con, key, default=None):
    r = con.execute("SELECT value FROM world_meta WHERE key=?", (key,)).fetchone()
    if r is None:
        return default
    try:
        return json.loads(r["value"])
    except (ValueError, TypeError):
        return r["value"]


def set_meta(con, key, value):
    con.execute("INSERT INTO world_meta(key,value) VALUES(?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value, ensure_ascii=False)))


def found(con, mode="simulation", owner="OWNER"):
    if mode not in MODES:
        raise ValueError("mode must be one of %s" % (MODES,))
    if meta(con, "founded"):
        raise RuntimeError("world already founded in mode=%s" % meta(con, "mode"))
    set_meta(con, "mode", mode)
    set_meta(con, "owner", owner)
    set_meta(con, "paused", False)
    set_meta(con, "usd_ceiling_day", 5.0)
    set_meta(con, "founded", now())
    event(con, "WORLD_FOUNDED", actor=owner, payload={"mode": mode})
    return mode


# ── events: append-only, hash-chained ────────────────────────────────
def event(con, kind, actor=None, subject=None, payload=None):
    prev = con.execute("SELECT hash FROM events ORDER BY id DESC LIMIT 1").fetchone()
    prev_hash = prev["hash"] if prev else "0" * 64
    at = now()
    body = json.dumps(payload or {}, sort_keys=True, ensure_ascii=False)
    h = sha(prev_hash + at + kind + str(actor) + str(subject) + body)
    cur = con.execute(
        "INSERT INTO events(at,kind,actor,subject,payload,prev_hash,hash) VALUES(?,?,?,?,?,?,?)",
        (at, kind, actor, subject, body, prev_hash, h))
    return cur.lastrowid


def verify_chain(con):
    """Recompute the whole chain. Returns (ok, first_bad_id)."""
    prev_hash = "0" * 64
    for r in con.execute("SELECT * FROM events ORDER BY id"):
        h = sha(prev_hash + r["at"] + r["kind"] + str(r["actor"]) + str(r["subject"]) + r["payload"])
        if h != r["hash"] or r["prev_hash"] != prev_hash:
            return False, r["id"]
        prev_hash = h
    return True, None


# ── owner switches (deterministic; no model may reach these) ─────────
def paused(con):
    return bool(meta(con, "paused", False))


def spent_today(con):
    day = now()[:10]
    r = con.execute("SELECT COALESCE(SUM(usd),0) s FROM runs WHERE substr(started_at,1,10)=?",
                    (day,)).fetchone()
    return float(r["s"])


def signal(con, priority, headline, detail="", event_id=None, project_id=None, artifact_id=None):
    return con.execute(
        "INSERT INTO signals(at,priority,headline,detail,event_id,project_id,artifact_id) "
        "VALUES(?,?,?,?,?,?,?)",
        (now(), priority, headline, detail, event_id, project_id, artifact_id)).lastrowid
