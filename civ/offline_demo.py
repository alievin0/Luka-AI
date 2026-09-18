#!/usr/bin/env python3
"""THE OWNERSHIP DRILL — the world with no subscription, no key, no network.

    python3 offline_demo.py --fresh

This is the demonstration that the Agent World is the Owner's property rather
than a front-end for somebody's paid API. It runs four acts:

    I    BOOT OFFLINE     OFFLINE_MODE=1, every key stripped from the process,
                          and the socket module itself replaced with one that
                          raises. The world founds, five agents exist, laws,
                          policies and budgets are in place.
    II   PARK, DO NOT     The Owner states one objective. Work that needs
         PRETEND          inference becomes WAITING_FOR_MODEL. No run row, no
                          artifact, no review, no lease — because nobody worked.
    III  SAY SO           The four lines the Owner sees. MODEL is OFFLINE, and
                          the world does not dress that up.
    IV   MOVE HOUSE       Export the whole world to one file, verify it, restore
                          it into a different database, and compare row for row.

Nothing here contacts a network, costs money, or needs an account. What is NOT
demonstrated is inference: with no engine, no agent thinks, and that is the
honest half of the result.
"""
import argparse
import os
import socket
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import world_export as WE                    # noqa: E402
import world_server as SRV                   # noqa: E402
from core import agent_world as W            # noqa: E402
from core import model_gate as GATE          # noqa: E402
from core import open_world as OW            # noqa: E402
from core import store                       # noqa: E402
from core import world_bus as BUS            # noqa: E402
from core import world_policy as POL         # noqa: E402
from core import world_supervisor as SUP     # noqa: E402

import always_on_demo as D                   # noqa: E402

BAR = "─" * 74
# Every variable that could quietly hand this world to a vendor.
VENDOR_VARS = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CIV_PROVIDER",
               "CLAUDE_API_KEY", "CIV_API_KEY")


def say(s=""):
    print(s, flush=True)


class NoNetwork(socket.socket):
    """A socket that cannot be built. Proof, not an assurance."""

    def __init__(self, *a, **k):
        raise OSError("this process has no network")


def _refuse(*a, **k):
    raise OSError("this process has no network")


def act_one(db):
    say(BAR); say("ACT I — BOOT WITH NOTHING"); say(BAR)
    stripped = [v for v in VENDOR_VARS if os.environ.pop(v, None) is not None]
    os.environ["OFFLINE_MODE"] = "1"
    say("  keys removed from this process   %s"
        % (", ".join(stripped) if stripped else "none were set"))
    say("  OFFLINE_MODE                     %s" % os.environ["OFFLINE_MODE"])
    say("  sockets                          replaced; any connect() raises")

    con = store.connect(db)
    if not store.meta(con, "founded"):
        store.found(con, mode="simulation")
    agents = W.found_agents(con)
    POL.seed(con)
    say("  world founded                    %s" % db)
    say("  agents                           %d persistent identities" % len(agents))
    say("  laws                             %d database triggers"
        % con.execute("SELECT COUNT(*) c FROM sqlite_master WHERE type='trigger'"
                      ).fetchone()["c"])
    say("  local discovery                  %r (OFFLINE refuses even localhost)"
        % (GATE.discover_local(),))
    return con


def act_two(con):
    say("\n" + BAR); say("ACT II — WORK PARKS, NOBODY PRETENDS"); say(BAR)
    fixture = D.write_fixture()
    prov, why = GATE.select()
    say("  provider chosen                  %s (%s)" % (prov.name, why))

    w = SUP.World(con, W.build_gateway(con),
                  provider_for=lambda a, t, n: prov,
                  requirements_for=lambda t: D.requirements_for(t, fixture),
                  instruction_for=lambda t: t["objective"],
                  worker="worker-with-no-engine")
    D.start(con, fixture)
    say("  the Owner states one objective and issues no further command")
    SUP.run(w, max_ticks=60)

    say("  work WAITING_FOR_MODEL           %d" % BUS.waiting_for_model(con))

    # Two different things must be told apart here, and the difference is the
    # whole honesty of the claim. DETERMINISTIC tool work needs no engine and
    # still happens: the scan really opened the repository through the gateway
    # and really hashed what it read. Work that needs a model to THINK does not
    # happen, and is parked rather than invented.
    say("\n  what still happened, with no engine at all:")
    for t, note in (("tool_calls", "real, gated, and recorded"),
                    ("evidence", "real content hashes of files really read"),
                    ("tasks", "the graph the world planned for itself")):
        say("    %-30s %d   %s" % (t, con.execute(
            "SELECT COUNT(*) c FROM " + t).fetchone()["c"], note))

    say("\n  what did NOT happen, and is not faked:")
    for t, note in (("runs", "no model turn was taken"),
                    ("artifacts", "nobody wrote anything"),
                    ("reviews", "nobody reviewed anything")):
        n = con.execute("SELECT COUNT(*) c FROM " + t).fetchone()["c"]
        say("    %-30s %d   %s%s" % (t, n, note,
                                     "" if n == 0 else "   ← UNEXPECTED"))

    held = con.execute("SELECT COUNT(*) c FROM leases WHERE status='HELD'"
                       ).fetchone()["c"]
    say("\n  leases HELD on parked work       %d%s"
        % (held, "   ← a lock nobody can release" if held else
           "   ← no lock is taken for work that cannot run"))
    say("  the world is still up            queue depth %s"
        % BUS.depth(con).get("READY", 0))
    return fixture


def act_three(con):
    say("\n" + BAR); say("ACT III — WHAT THE OWNER IS TOLD"); say(BAR)
    st = GATE.status(con)
    for k in ("world", "agents", "runtime", "model", "work"):
        say("    %-8s %s" % (k.upper() + ":", st[k]))
    say("\n  why                              %s" % st["why"])
    say("  local url the Owner may set      LOCAL_MODEL_URL=%s" % st["local_url"])
    say("  local model the Owner may name   LOCAL_MODEL_NAME=%s"
        % (st["local_name"] or "(unset — nothing is guessed)"))
    ow = OW.open_world(con)
    say("  open world still projects        %d agents, %d districts, quiet=%s"
        % (len(ow["agents"]), len(ow["districts"]), ow["quiet"]))
    say("  owner view still renders         %d event rows"
        % len(SRV.world_payload(con)["activity"]))


def act_four(con, db):
    say("\n" + BAR); say("ACT IV — THE WORLD MOVES HOUSE"); say(BAR)
    out = os.path.join(tempfile.mkdtemp(), "world.json")
    meta = WE.export_world(con, out)
    say("  exported                         %d rows across %d tables, %d bytes"
        % (meta["rows"], len(meta["counts"]), os.path.getsize(out)))
    say("  agents in the bundle             %s" % ", ".join(meta["agents"]))
    say("  event head carried over          %s" % (meta["event_head"] or "")[:16])
    v = WE.verify(out)
    say("  format                           %s" % v["format"])
    say("  checksum matches the data        %s" % v["checksum_ok"])
    say("  chain was intact at export       %s" % v["chain_intact_at_export"])

    new = os.path.join(tempfile.mkdtemp(), "new-machine.db")
    report = WE.restore_world(out, new)
    other = store.connect(new)
    diff = WE.compare(con, other)
    say("  restored to a second database    %s" % new)
    say("  rows written                     %d across %d tables"
        % (report["rows"], report["tables"]))
    say("  tables differing                 %d%s"
        % (len(diff), "" if not diff else "   " + repr(diff)))
    say("  agents on the new machine        %d" % len(report["agents"]))
    say("  memories / projects / events     %d / %d / %d"
        % (report["memories"], report["projects"], report["events"]))
    say("  event chain on the new machine   intact=%s" % report["chain_intact"])
    say("  foreign keys on the new machine  ok=%s" % report["foreign_keys_ok"])
    return (not diff and v["checksum_ok"] and report["chain_intact"]
            and report["foreign_keys_ok"])


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.path.join(HERE, "offline-world.db"))
    ap.add_argument("--fresh", action="store_true")
    a = ap.parse_args(argv)
    if a.fresh:
        for ext in ("", "-wal", "-shm"):
            if os.path.exists(a.db + ext):
                os.remove(a.db + ext)

    real_socket, real_conn = socket.socket, socket.create_connection
    socket.socket, socket.create_connection = NoNetwork, _refuse
    try:
        con = act_one(a.db)
        act_two(con)
        act_three(con)
        moved = act_four(con, a.db)
    finally:
        socket.socket, socket.create_connection = real_socket, real_conn

    say("\n" + BAR); say("WHAT THIS DID AND DID NOT SHOW"); say(BAR)
    say("  SHOWN   the world boots, persists, projects and exports with no key,")
    say("          no subscription and no network, and parks the work it cannot do.")
    say("  SHOWN   the whole world moves to another database intact: %s" % moved)
    say("  NOT     inference. No agent reasoned here, because nothing was running")
    say("  SHOWN   that could reason. That is the point of ACT II, not a gap in it.")
    say("  COST    zero API spend. NOT zero cost: electricity and the machine")
    say("          itself are still paid for by the Owner.")
    return 0 if moved else 1


if __name__ == "__main__":
    raise SystemExit(main())
