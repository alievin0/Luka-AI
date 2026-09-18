"""THE STORAGE BOUNDARY — one domain model, two engines.

The world is a database. Which database is a deployment decision, and the
domain must not know: `store.connect()` stays the single boundary, and the
handful of places where SQLite and Postgres genuinely differ live here.

There are exactly three such places, and pretending there are none is how a
"portable" codebase discovers at deploy time that it is not:

  1. the parameter placeholder (`?` vs `%s`)
  2. claiming one row from a queue without two workers getting the same row
  3. what "now" means to the server

**Honest status.** The SQLite dialect is the one every test in this repository
runs against. The Postgres dialect is written, its SQL is asserted, and it has
never been executed against a running Postgres — there is none in this
environment and none is being deployed. It is a declared adapter, not a
verified one, and the documentation says so in the same words.
"""
import os
import sqlite3


class Dialect:
    """What the domain is allowed to know about its engine."""

    name = "abstract"
    placeholder = "?"
    supports_skip_locked = False

    def connect(self, url):                       # pragma: no cover - abstract
        raise NotImplementedError

    def q(self, sql):
        """Rewrite `?` placeholders for engines that spell them differently."""
        return sql if self.placeholder == "?" else sql.replace("?", self.placeholder)

    def claim_sql(self):                          # pragma: no cover - abstract
        raise NotImplementedError

    def claim_one(self, con, worker, kinds, now, max_in_flight):
        """Take exactly one READY entry, or return None. Never two workers, one row."""
        raise NotImplementedError                 # pragma: no cover - abstract


class SQLiteDialect(Dialect):
    """The engine the tests run on.

    Claiming is a SELECT followed by an UPDATE guarded on `state='READY'`. The
    guard is the whole mechanism: two workers may both read the same candidate
    row, and exactly one UPDATE reports `rowcount == 1`. The loser gets None,
    which is a normal outcome and not an error."""

    name = "sqlite"
    placeholder = "?"
    supports_skip_locked = False

    def connect(self, url):
        path = url[len("sqlite://"):] if url.startswith("sqlite://") else url
        con = sqlite3.connect(path, isolation_level=None)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys=ON")
        return con

    def claim_sql(self):
        return ("UPDATE world_queue SET state='CLAIMED', worker=?, claimed_at=?, "
                "attempts=attempts+1 WHERE id=? AND state='READY'")

    def claim_one(self, con, worker, kinds, now, max_in_flight):
        in_flight = con.execute(
            "SELECT COUNT(*) c FROM world_queue WHERE state='CLAIMED'").fetchone()["c"]
        if in_flight >= max_in_flight:
            return None
        sql = ("SELECT * FROM world_queue WHERE state='READY' AND available_at<=? "
               + ("AND kind IN (%s) " % ",".join("?" * len(kinds)) if kinds else "")
               + "ORDER BY priority DESC, id LIMIT 1")
        row = con.execute(sql, [now] + (list(kinds) if kinds else [])).fetchone()
        if row is None:
            return None
        if not con.execute(self.claim_sql(), (worker, now, row["id"])).rowcount:
            return None                    # another worker won; that is fine
        return con.execute("SELECT * FROM world_queue WHERE id=?",
                           (row["id"],)).fetchone()


class PostgresDialect(Dialect):
    """WRITTEN, NOT EXERCISED. No Postgres runs in this environment.

    Claiming uses `FOR UPDATE SKIP LOCKED`, which is the reason to move to
    Postgres at all: the database itself hands each worker a different row
    instead of making them race for the same one and discard the loser."""

    name = "postgres"
    placeholder = "%s"
    supports_skip_locked = True

    def connect(self, url):                       # pragma: no cover - not deployed
        try:
            import psycopg                        # noqa: F401
        except ImportError as e:
            raise RuntimeError(
                "the Postgres dialect needs psycopg, which is not installed here. "
                "This adapter has never been run against a live server.") from e
        import psycopg
        from psycopg.rows import dict_row
        con = psycopg.connect(url, autocommit=True, row_factory=dict_row)
        return con

    def claim_sql(self):
        return ("UPDATE world_queue SET state='CLAIMED', worker=%s, claimed_at=%s, "
                "attempts=attempts+1 WHERE id = (SELECT id FROM world_queue "
                "WHERE state='READY' AND available_at<=%s {kinds} "
                "ORDER BY priority DESC, id FOR UPDATE SKIP LOCKED LIMIT 1) "
                "RETURNING *")

    def claim_one(self, con, worker, kinds, now, max_in_flight):  # pragma: no cover
        cur = con.execute(
            "SELECT COUNT(*) AS c FROM world_queue WHERE state='CLAIMED'")
        if cur.fetchone()["c"] >= max_in_flight:
            return None
        clause = ("AND kind IN (%s) " % ",".join(["%s"] * len(kinds))) if kinds else ""
        sql = self.claim_sql().format(kinds=clause)
        cur = con.execute(sql, [worker, now, now] + (list(kinds) if kinds else []))
        return cur.fetchone()


DIALECTS = {"sqlite": SQLiteDialect, "postgres": PostgresDialect,
            "postgresql": PostgresDialect}


def for_url(url):
    """Pick the dialect from the URL scheme. A bare path is SQLite."""
    scheme = url.split("://", 1)[0] if "://" in url else "sqlite"
    cls = DIALECTS.get(scheme)
    if cls is None:
        raise RuntimeError("no dialect for %r — known: %s"
                           % (scheme, ", ".join(sorted(DIALECTS))))
    return cls()


def from_env(default_path):
    """`CIV_DATABASE_URL` wins, then `CIV_DB`, then the default file.

    One variable is what makes the deployment decision a deployment decision
    rather than a code change."""
    return os.environ.get("CIV_DATABASE_URL") or os.environ.get("CIV_DB") or default_path
