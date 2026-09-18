#!/usr/bin/env python3
"""START WORLD — the Agent World Server.

    python3 worldd.py start --db world.db --port 8790
    python3 worldd.py start --db world.db --port 8790 --detach
    python3 worldd.py status --db world.db
    python3 worldd.py stop   --db world.db

One process, two things in it:

    ┌─ thread ── HTTP API ────── reads state, accepts owner commands
    └─ main ──── WORLD RUNTIME ─ turns the supervisor's handle

The second is the one that matters. Before it existed the world had a database,
a supervisor and an HTTP server, and still was not running: the supervisor only
ticked inside a demo script, so the world's clock belonged to whichever terminal
happened to be open. The server served a frozen picture and called it a world.

With `--detach` the process leaves the terminal entirely (setsid + closed
stdio), so closing the shell, the browser, or the editor has no effect on it.
The world is then a process on a machine with an address, and the 3D page is one
of possibly several clients looking at it.

Nothing here owns state. Every durable fact goes through the same tables and the
same laws. Kill this process and the world is exactly what the database says it
is; start it again and it picks up from there.
"""
import argparse
import json
import os
import signal
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from core import store                     # noqa: E402
from core import world_bus as BUS          # noqa: E402
from core import world_runtime as RUN      # noqa: E402
import world_server as SRV                 # noqa: E402

DB = os.path.join(HERE, "world.db")
PIDFILE = ".worldd.pid"


def _pidfile(db):
    return os.path.join(os.path.dirname(os.path.abspath(db)) or ".",
                        "." + os.path.basename(db) + ".worldd")


def _stopfile(db):
    """Touch this and the world stops calling a paid model, immediately and
    without stopping the world itself. It is checked before every model call,
    so it does not wait for a turn, a lease or a queue to drain."""
    return os.path.join(os.path.dirname(os.path.abspath(db)) or ".",
                        "." + os.path.basename(db) + ".nomodel")


def _alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _read_pid(db):
    p = _pidfile(db)
    if not os.path.exists(p):
        return None
    try:
        with open(p, encoding="utf-8") as fh:
            d = json.load(fh)
        return d if _alive(int(d["pid"])) else None
    except Exception:
        return None


def _write_pid(db, info):
    with open(_pidfile(db), "w", encoding="utf-8") as fh:
        json.dump(info, fh)


def _clear_pid(db):
    try:
        os.remove(_pidfile(db))
    except OSError:
        pass


# ── start ────────────────────────────────────────────────────────────
def start(db, host, port, detach=False, max_seconds=None, ready=None,
          provider=None, mode="simulation"):
    """Run the world. Blocks until stopped, unless --detach was used."""
    if detach:
        return _detach(db, host, port, mode=mode)

    existing = _read_pid(db)
    if existing:
        print("a world is already running on this database: pid %s, api %s"
              % (existing["pid"], existing.get("api", "")), file=sys.stderr)
        return 3

    con = store.connect(db)
    if not store.meta(con, "founded"):
        store.found(con, mode=mode)
    api = "http://%s:%d" % (host, port)
    # A world left running with a real key set would otherwise spend, unattended,
    # for as long as it had work. The factory caps any provider that can
    # actually spend; with no model configured this changes nothing at all.
    make = RUN.provider_factory(provider, stop_file=_stopfile(db))
    world = RUN.build(con, api=api, provider_for=make)
    if os.environ.get("ANTHROPIC_API_KEY"):
        print("MODEL: a paid provider is configured. Hard cap $%.2f / %d calls "
              "(CIV_MAX_USD, CIV_MAX_CALLS).\n       Stop it spending at any "
              "time with:  touch %s"
              % (make.cap.max_usd, make.cap.max_calls, _stopfile(db)),
              file=sys.stderr)
    runtime = RUN.Runtime(world, api=api)

    # The HTTP server runs in its own thread with its own connections. The
    # runtime keeps the main thread, because the runtime IS the world.
    SRV.Handler.db_path = db
    SRV.Handler.runtime = runtime
    httpd = SRV.serve(db=db, port=port, host=host)
    t = threading.Thread(target=httpd.serve_forever, daemon=True,
                         name="world-api")
    t.start()

    _write_pid(db, {"pid": os.getpid(), "api": api, "db": os.path.abspath(db),
                    "worker": world.worker, "started_at": store.now()})

    def _sig(signum, frame):
        runtime.stop("signal %d" % signum)
    for s in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(s, _sig)
        except ValueError:                        # pragma: no cover - not main thread
            pass

    print("AGENT WORLD SERVER")
    print("  api      %s" % api)
    print("  db       %s" % os.path.abspath(db))
    print("  worker   %s  pid %d" % (world.worker, os.getpid()))
    print("  world    %s" % RUN.health(con)["world"])
    print("  model    %s" % (RUN.health(con)["model"] or "none"))
    print("  the world is running. closing this terminal does not stop it if you", flush=True)
    print("  started it with --detach; otherwise ctrl-c stops it.", flush=True)
    if ready:
        ready.set()
    try:
        report = runtime.run(max_seconds=max_seconds)
    finally:
        httpd.shutdown()
        _clear_pid(db)
    print(json.dumps(report, indent=2))
    return 0


def _detach(db, host, port, mode="simulation"):
    """Leave the terminal. The world outlives the shell that started it."""
    if _read_pid(db):
        print("already running", file=sys.stderr)
        return 3
    log = os.path.abspath(db) + ".worldd.log"
    pid = os.fork()
    if pid > 0:
        # wait for the child to claim the pidfile so `start --detach` returning
        # means the world IS up, not that it was asked to come up
        for _ in range(100):
            info = _read_pid(db)
            if info:
                print("AGENT WORLD SERVER detached")
                print("  api  %s" % info["api"])
                print("  pid  %s" % info["pid"])
                print("  log  %s" % log)
                return 0
            time.sleep(0.1)
        print("the world did not come up; see %s" % log, file=sys.stderr)
        return 1
    os.setsid()
    fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    os.dup2(fd, 1)
    os.dup2(fd, 2)
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)
    os._exit(start(db, host, port, mode=mode) or 0)


# ── status / stop ────────────────────────────────────────────────────
def status(db):
    con = store.connect(db)
    h = RUN.health(con)
    print("WORLD        %s" % h["world"])
    for r in h["runtimes"]:
        print("  runtime    %s  pid %s  on %s  since %s"
              % (r["worker"], r["pid"], r["api"] or "(no api)", r["started_at"]))
        print("             last seen %s, claimed %s, completed %s"
              % (r["last_seen"], r["claimed"], r["completed"]))
    if not h["runtimes"]:
        print("  no runtime is turning this world. It is persisted, not running.")
    print("MODEL        %s   WORK %s" % (h["model"], h["work"]))
    print("QUEUE        %s" % json.dumps(h["queue"]))
    print("WAITING      %d parked for a model" % h["waiting_for_model"])
    print("AGENTS       %d active" % h["agents"])
    print("TASKS        %d open" % h["tasks_open"])
    return 0 if h["world"] == "RUNNING" else 1


def stop(db, timeout=15.0):
    info = _read_pid(db)
    if not info:
        print("no world is running on this database")
        return 1
    pid = int(info["pid"])
    os.kill(pid, signal.SIGTERM)
    t0 = time.time()
    while time.time() - t0 < timeout:
        if not _alive(pid):
            print("stopped pid %d" % pid)
            return 0
        time.sleep(0.2)
    print("pid %d did not stop within %.0fs" % (pid, timeout), file=sys.stderr)
    return 1


def main(argv=None):
    ap = argparse.ArgumentParser(description="Agent World Server")
    ap.add_argument("command", choices=["start", "status", "stop"], nargs="?",
                    default="start")
    ap.add_argument("--db", default=DB)
    ap.add_argument("--host", default="127.0.0.1",
                    help="0.0.0.0 to accept connections from other devices")
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--detach", action="store_true",
                    help="run in the background, surviving this terminal")
    ap.add_argument("--max-seconds", type=float, default=None,
                    help="stop after this long (for supervised runs and tests)")
    ap.add_argument("--mode", choices=["simulation", "live", "hybrid"],
                    default="simulation",
                    help="how to found a NEW world. LAW 2 keeps the two apart: "
                         "a simulation refuses to record a real model run, and "
                         "a live world refuses to record a simulated one. Only "
                         "used when the database has no world in it yet.")
    a = ap.parse_args(argv)
    if a.command == "status":
        return status(a.db)
    if a.command == "stop":
        return stop(a.db)
    return start(a.db, a.host, a.port, detach=a.detach, max_seconds=a.max_seconds,
                 mode=a.mode)


if __name__ == "__main__":
    sys.exit(main())
