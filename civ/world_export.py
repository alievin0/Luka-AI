#!/usr/bin/env python3
"""WORLD EXPORT / RESTORE — the Owner owns the world, so the Owner can move it.

    python3 world_export.py export --db always-on.db --out my-world.json
    python3 world_export.py verify --in my-world.json
    python3 world_export.py restore --in my-world.json --db /somewhere/else.db

One file carries everything: identities, contracts, capabilities, permissions,
memories, projects, tasks, dependencies, opportunities, discoveries, artifacts
(with their bodies), evidence, reviews, failures, lessons, budgets, policies,
decisions, events, leases, queue state, workers, presence, world meta — and the
world's own geography: every district, facility and workspace, where each agent
is standing, where it was going, and every movement it has ever made.

Restore it on another computer and the same agents are there, with the same
memories, the same projects, the same history and a hash chain that still
verifies. No cloud account is involved at any point, because none was involved
in creating it.

**What this does not claim.** A powered-off computer runs nothing — an export is
portability, not immortality. It survives a dead laptop only in the sense that
you can carry it to a machine that is on.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import store                   # noqa: E402

FORMAT = "agent-world-export/1"

# Insert order matters: a row whose foreign key is not there yet is a row that
# restores into a world that cannot be trusted. Parents first, always.
ORDER = [
    "world_meta", "principals", "workers", "owner_presence",
    "policies", "budgets", "chains",
    "projects", "teams", "team_members",
    "runs", "tasks", "task_deps", "task_transitions", "task_conditions",
    "leases", "tool_calls",
    # The world itself: the places before anything that stands in them, and the
    # movement record after the tasks and leases it points at. A world that
    # arrives on another machine with its agents nowhere is not the same world.
    "world_places", "agent_locations", "movements",
    "evidence", "artifacts", "claims", "reviews",
    "discoveries", "ideas", "opportunities", "failures", "lessons",
    "memories", "agent_messages",
    "skills", "agent_skills", "capabilities", "agent_capabilities",
    "permission_grants", "agent_versions", "agent_lineage", "factory_jobs",
    "experiments", "disagreements", "positions", "cross_project_signals",
    "owner_state", "signals", "approvals", "heartbeats", "policy_decisions",
    "world_queue", "events",
]

# Deliberately NOT exported: nothing. The benchmark tables travel too — they are
# the Owner's record of their own experiments, and a world that leaves its
# history behind is not the same world.
SKIP = {"sqlite_sequence"}


def tables(con):
    have = {r["name"] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    known = [t for t in ORDER if t in have]
    extra = sorted(have - set(ORDER) - SKIP)
    return known + extra


def export_world(con, path):
    """Write the whole world to one portable file."""
    bundle = {"format": FORMAT, "exported_at": store.now(), "tables": {}}
    counts = {}
    for t in tables(con):
        rows = [dict(r) for r in con.execute("SELECT * FROM %s" % t)]
        bundle["tables"][t] = rows
        counts[t] = len(rows)
    ok, bad = store.verify_chain(con)
    head = con.execute("SELECT hash FROM events ORDER BY id DESC LIMIT 1").fetchone()
    bundle["manifest"] = {
        "counts": counts,
        "rows": sum(counts.values()),
        "chain_intact": bool(ok),
        "chain_broken_at": bad,
        "event_head": head["hash"] if head else None,
        "agents": [r["id"] for r in con.execute(
            "SELECT id FROM principals WHERE id LIKE 'AGT-%' ORDER BY id")],
        "mode": store.meta(con, "mode"),
        "founded": store.meta(con, "founded"),
    }
    # The checksum covers the DATA, computed before it is written, so a file
    # that was edited on the way between two machines does not restore quietly.
    bundle["manifest"]["checksum"] = store.sha(bundle["tables"])
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(bundle, fh, ensure_ascii=False, indent=1, sort_keys=True)
    return bundle["manifest"]


def read_bundle(path):
    with open(path, encoding="utf-8") as fh:
        b = json.load(fh)
    if b.get("format") != FORMAT:
        raise RuntimeError("not an agent-world export: %r" % b.get("format"))
    return b


def verify(path):
    """Check a bundle before trusting it, without touching a database."""
    b = read_bundle(path)
    m = b["manifest"]
    got = store.sha(b["tables"])
    return {
        "format": b["format"],
        "exported_at": b["exported_at"],
        "rows": m["rows"],
        "agents": m["agents"],
        "chain_intact_at_export": m["chain_intact"],
        "checksum_ok": got == m["checksum"],
        "checksum": got,
    }


def restore_world(path, db_path, force=False):
    """Rebuild the world in a fresh database. Refuses to overwrite by default."""
    v = verify(path)
    if not v["checksum_ok"]:
        raise RuntimeError("checksum mismatch: this export was modified after export")
    b = read_bundle(path)
    if os.path.exists(db_path) and not force:
        raise RuntimeError("%s exists; pass --force to replace it" % db_path)
    for ext in ("", "-wal", "-shm"):
        if os.path.exists(db_path + ext):
            os.remove(db_path + ext)

    con = store.connect(db_path)
    # Foreign keys off for the load only: the rows were consistent when they were
    # written, and insisting on order within a table (a task whose parent_id
    # points forward) would fail on data that is not actually wrong.
    con.execute("PRAGMA foreign_keys=OFF")
    written = {}
    try:
        for t in tables(con):
            rows = b["tables"].get(t) or []
            if not rows:
                continue
            cols = [r[1] for r in con.execute("PRAGMA table_info(%s)" % t)]
            usable = [c for c in cols if c in rows[0]]
            sql = ("INSERT OR REPLACE INTO %s(%s) VALUES(%s)"
                   % (t, ",".join(usable), ",".join("?" * len(usable))))
            for r in rows:
                con.execute(sql, [r.get(c) for c in usable])
            written[t] = len(rows)
    finally:
        con.execute("PRAGMA foreign_keys=ON")

    ok, bad = store.verify_chain(con)
    bad_fk = list(con.execute("PRAGMA foreign_key_check"))
    return {"db": db_path, "tables": len(written), "rows": sum(written.values()),
            "chain_intact": bool(ok), "chain_broken_at": bad,
            "foreign_keys_ok": not bad_fk,
            "agents": [r["id"] for r in con.execute(
                "SELECT id FROM principals WHERE id LIKE 'AGT-%' ORDER BY id")],
            "memories": con.execute("SELECT COUNT(*) c FROM memories").fetchone()["c"],
            "projects": con.execute("SELECT COUNT(*) c FROM projects").fetchone()["c"],
            "events": con.execute("SELECT COUNT(*) c FROM events").fetchone()["c"]}


def compare(a_con, b_con):
    """Is the restored world the same world? Table by table, row by row."""
    diff = {}
    for t in tables(a_con):
        x = store.sha([dict(r) for r in a_con.execute("SELECT * FROM %s" % t)])
        y = store.sha([dict(r) for r in b_con.execute("SELECT * FROM %s" % t)])
        if x != y:
            diff[t] = {"source": x[:12], "restored": y[:12]}
    return diff


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=("export", "verify", "restore"))
    ap.add_argument("--db", default=os.path.join(HERE, "always-on.db"))
    ap.add_argument("--out", default=os.path.join(HERE, "world-export.json"))
    ap.add_argument("--in", dest="inp", default=os.path.join(HERE, "world-export.json"))
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)

    if a.action == "export":
        m = export_world(store.connect(a.db), a.out)
        print("exported %d rows across %d tables → %s (%.0f KB)"
              % (m["rows"], len(m["counts"]), a.out, os.path.getsize(a.out) / 1024))
        print("  agents        %s" % ", ".join(m["agents"]))
        print("  event head    %s" % (m["event_head"] or "—")[:16])
        print("  chain intact  %s" % m["chain_intact"])
        print("  checksum      %s" % m["checksum"][:16])
    elif a.action == "verify":
        v = verify(a.inp)
        for k, val in v.items():
            print("  %-22s %s" % (k, val))
        return 0 if v["checksum_ok"] else 1
    else:
        r = restore_world(a.inp, a.db, force=a.force)
        print("restored → %s" % r["db"])
        for k in ("tables", "rows", "agents", "memories", "projects", "events",
                  "chain_intact", "foreign_keys_ok"):
            print("  %-16s %s" % (k, r[k]))
        return 0 if (r["chain_intact"] and r["foreign_keys_ok"]) else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
