"""World state. One SQLite file, and the laws live in it rather than above it."""
import hashlib
import json
import os
import sqlite3

from . import dialect as _dialect
from datetime import datetime, timezone

SCHEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")
ORG_SCHEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "org_schema.sql")
BENCH_SCHEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bench_schema.sql")
WORLD_SCHEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "agent_world_schema.sql")
ALWAYS_ON_SCHEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "always_on_schema.sql")
SPACE_SCHEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "space_schema.sql")
GROWTH_SCHEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "growth_schema.sql")
EMBODIMENT_SCHEMA = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 "embodiment_schema.sql")
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


DIALECT = None          # the engine this process is talking to


def connect(path=None):
    """THE single persistence boundary. Everything else goes through it.

    `path` may be a file (SQLite) or a URL (`postgresql://…`). The dialect is
    chosen here and nowhere else, so moving the world to Postgres is a
    deployment variable rather than a change to the domain."""
    global DIALECT
    url = path or _dialect.from_env(DEFAULT)
    DIALECT = _dialect.for_url(url)
    con = DIALECT.connect(url)
    if DIALECT.name != "sqlite":                  # pragma: no cover - not deployed
        return con
    for path in (SCHEMA, ORG_SCHEMA, BENCH_SCHEMA, WORLD_SCHEMA,
                 ALWAYS_ON_SCHEMA, SPACE_SCHEMA, GROWTH_SCHEMA,
                 EMBODIMENT_SCHEMA):
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
    # Widening a CHECK means rebuilding the table, and these tables hold the
    # owner's only copy of campaigns #1-#3 and of every tool call ever audited.
    # Each rebuild verifies itself before it drops anything. See _widen_check.
    _widen_check(con, BENCH_SCHEMA, "bench_runs", "'INCOMPLETE'")
    _widen_check(con, SCHEMA, "tool_calls", "'ERROR'")
    _widen_check(con, SCHEMA, "tasks", "'ARCHIVED'")
    _widen_check(con, ORG_SCHEMA, "opportunities", "'APPROVED'")
    _widen_check(con, ALWAYS_ON_SCHEMA, "world_queue", "'WAITING_FOR_MODEL'")
    pcols = {r[1] for r in con.execute("PRAGMA table_info(world_places)")}
    if "type_id" not in pcols:
        # Which archetype a place is an instance of. Guessing it from the id at
        # render time made the Archive district draw as an archive facility.
        con.execute("ALTER TABLE world_places ADD COLUMN type_id TEXT")
    qcols = {r[1] for r in con.execute("PRAGMA table_info(world_queue)")}
    if "caused_by" not in qcols:
        # Causality as a column, not an inference. "Which event caused this one"
        # has to be answerable from a row when no process is alive to remember.
        con.execute("ALTER TABLE world_queue ADD COLUMN caused_by INTEGER "
                    "REFERENCES world_queue(id)")
    # Additive columns for the opportunity radar. An opportunity now has to say
    # who found it, how sure they were and who decided — none of which existed
    # when an opportunity was something a person typed in.
    ocols = {r[1] for r in con.execute("PRAGMA table_info(opportunities)")}
    for col, ddl in (("confidence", "REAL NOT NULL DEFAULT 0"),
                     ("discovery_id", "INTEGER REFERENCES discoveries(id)"),
                     ("discovered_by", "TEXT"),
                     ("rationale", "TEXT NOT NULL DEFAULT ''"),
                     ("project_id", "INTEGER REFERENCES projects(id)"),
                     ("decided_by", "TEXT"),
                     ("decided_at", "TEXT"),
                     ("decision_why", "TEXT NOT NULL DEFAULT ''")):
        if col not in ocols:
            con.execute("ALTER TABLE opportunities ADD COLUMN %s %s" % (col, ddl))
    return con


def _table_ddl(schema_path, table):
    """The CREATE TABLE statement the schema file produces, read back from SQLite.

    Taken from a throwaway in-memory database rather than written out a second
    time here, so a migration can never drift from the schema it migrates to."""
    tmp = sqlite3.connect(":memory:")
    try:
        # A later schema file references tables an earlier one creates, so the
        # throwaway database has to be built in the same order the real one is.
        # Running always_on_schema.sql alone fails on `REFERENCES tasks(id)`,
        # which is the schema being correct, not the migration being wrong.
        for earlier in (SCHEMA, ORG_SCHEMA, BENCH_SCHEMA, WORLD_SCHEMA,
                        ALWAYS_ON_SCHEMA, SPACE_SCHEMA, GROWTH_SCHEMA,
                        EMBODIMENT_SCHEMA):
            with open(earlier, encoding="utf-8") as fh:
                tmp.executescript(fh.read())
            if os.path.samefile(earlier, schema_path):
                break
        row = tmp.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
                          (table,)).fetchone()
        return row[0] if row else None
    finally:
        tmp.close()


def _widen_check(con, schema_path, table, marker):
    """Let an existing world accept a CHECK value it predates. Lossless, or it
    does not happen.

    A CHECK constraint can only be widened by rebuilding the table, and these
    tables hold history: bench_runs carries the raw runs of campaigns #1-#3 and
    tool_calls carries every authorisation decision ever made. So the rebuild
    copies every row inside one transaction and verifies the count AND a checksum
    of the copy against the original before dropping anything. If they disagree
    the whole thing rolls back and the old table stands. LAW 12 forbids REWRITING
    a closed campaign; this changes no row, only what the table will accept from
    here on.

    `marker` is the new value, quoted exactly as the schema writes it. Its
    presence is the migration's own idempotence check, so re-opening a world is
    a no-op.
    """
    row = con.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
                      (table,)).fetchone()
    if row is None or marker in (row["sql"] or ""):
        return False
    ddl = _table_ddl(schema_path, table)
    if not ddl or marker not in ddl:
        return False
    tmp = "%s_migrating" % table
    cols = [r[1] for r in con.execute("PRAGMA table_info(%s)" % table)]
    collist = ",".join('"%s"' % c for c in cols)

    def fingerprint(name):
        rows = con.execute("SELECT %s FROM %s ORDER BY id" % (collist, name)).fetchall()
        return len(rows), sha([[r[c] for c in cols] for r in rows])

    before = fingerprint(table)
    con.execute("PRAGMA foreign_keys=OFF")
    try:
        con.execute("BEGIN")
        con.execute(ddl.replace(table, tmp, 1))
        con.execute("INSERT INTO %s(%s) SELECT %s FROM %s" % (tmp, collist, collist, table))
        if fingerprint(tmp) != before:
            raise RuntimeError("%s migration would lose rows: %r -> %r"
                               % (table, before, fingerprint(tmp)))
        con.execute("DROP TABLE %s" % table)
        # A trigger elsewhere may name this table (law_evaluator_isolation names
        # bench_runs). Modern SQLite reparses every trigger during a RENAME and
        # refuses while one points at a table that is momentarily absent;
        # legacy_alter_table is the documented way through, and re-running the
        # schema script below restores every trigger and index either way.
        con.execute("PRAGMA legacy_alter_table=ON")
        con.execute("ALTER TABLE %s RENAME TO %s" % (tmp, table))
        con.execute("PRAGMA legacy_alter_table=OFF")
        if list(con.execute("PRAGMA foreign_key_check")):
            raise RuntimeError("%s migration broke a foreign key" % table)
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        con.execute("PRAGMA legacy_alter_table=OFF")
        con.execute("PRAGMA foreign_keys=ON")
        raise
    con.execute("PRAGMA foreign_keys=ON")
    for path in (SCHEMA, ORG_SCHEMA, BENCH_SCHEMA, WORLD_SCHEMA):
        with open(path, encoding="utf-8") as fh:
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
