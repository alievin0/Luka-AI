"""THE WORLD RUNTIME — the world's own clock, independent of anything watching.

This module is the answer to one specific defect. Before it, the world had a
persistent database, a supervisor, a queue and an HTTP server — and none of them
made it a running world, because **nothing turned the handle**. `world_server.py`
read state and served it; the supervisor only ticked inside `always_on_demo.py`
or a test. Close the terminal running the demo and the world stopped advancing
while the HTTP server went on cheerfully serving a frozen snapshot of it.

That is what made the world an artifact: its clock belonged to a script.

Here the clock belongs to a process. A `Runtime` claims from the queue, ticks
the supervisor, beats, recovers work its predecessors died holding, and un-parks
work that was waiting for a model once a model exists. It runs until it is told
to stop.

Three things it deliberately does NOT do:

  * **It does not invent work.** An empty queue produces a heartbeat and
    nothing else. A runtime that manufactured activity to look busy would be
    the same lie as an animation loop, just further down the stack.
  * **It does not fabricate inference.** The provider comes from the model
    gate. With no model, `h_task_ready` parks the task as WAITING_FOR_MODEL and
    the runtime keeps running — the world stays alive, the work waits.
  * **It does not own state.** Every durable fact goes through the same tables
    and the same laws as before. Kill this process and the world is exactly
    what the database says it is.

The liveness record is the existing `workers` row: pid, host, started_at,
last_seen, state. A runtime that dies leaves an ALIVE row that stops beating,
which `BUS.stale_workers` turns into STALE and whose work `BUS.recover_stuck`
hands back. Nothing has to be cleaned up by hand.
"""
import json
import os
import socket
import threading
import time

from . import model_gate as GATE
from . import provider as P
from . import spend as SPEND
from . import store
from . import world_bus as BUS
from . import world_supervisor as SUP
from .store import now

OWNER = "OWNER"

# How long an idle runtime waits before looking again. Not a busy loop: with an
# empty queue this is the entire cost of keeping the world alive.
IDLE_SECONDS = 1.0
# How often the periodic repair runs — stale workers, stuck work, parked work
# that a model can now take. Events cover the rest.
HOUSEKEEP_SECONDS = 20.0
# How often the runtime says it is still here.
BEAT_SECONDS = 5.0


class RuntimeError_(RuntimeError):
    """A runtime that refuses to start. Never a crash — a decision."""


def worker_name(port=None, suffix=None):
    """A worker id that identifies the PROCESS, not the run.

    Two runtimes on one machine must not share an id, or each will read the
    other's heartbeat as its own and neither will ever be detected as dead."""
    return "worldd-%s-%d%s" % (socket.gethostname()[:20], os.getpid(),
                               ("-" + suffix) if suffix else "")


def provider_factory(force=None, cap=None, stop_file=None):
    """The world's provider, chosen the same way for every agent and task.

    Honest by construction: `P.from_env()` returns `NotConfigured` rather than
    something that produces text, so a world with no model parks its work
    instead of inventing an answer for it.

    **Capped by construction too.** A world left running with a real key set
    would otherwise make real paid calls, unattended, for as long as it had
    work — which is the one thing an autonomous world must not be able to do by
    default. A provider that can actually spend gets a hard cap and a kill
    switch in front of it; one that cannot spend is handed back untouched, so a
    world with no model, or a test running a double, behaves exactly as before.

    The cap is per runtime process and comes from `CIV_MAX_USD` / `CIV_MAX_CALLS`.
    `stop_file` is checked before every call: `touch` it and the world stops
    calling out, without a signal and without waiting for anything to finish."""
    shared = cap or SPEND.Cap.from_env()

    def make(agent, task, attempt):
        prov = P.from_env() if force is None else force
        if prov.source == "model" and prov.available():
            return SPEND.Budgeted(prov, cap=shared, stop_file=stop_file)
        return prov
    make.cap = shared
    return make


def build(con, worker=None, provider_for=None, api="", max_in_flight=3):
    """Assemble the World a runtime turns. Same `SUP.World` the demos use.

    The supervisor cannot tell a runtime from a demo from a test, which is the
    point: there is one world, and this is simply the caller that keeps
    running."""
    from . import agent_world as W
    from . import world_policy as POL
    gw = W.build_gateway(con)
    W.found_agents(con)
    POL.seed(con)
    w = SUP.World(con, gw, provider_for=provider_for or provider_factory(),
                  worker=worker or worker_name(), max_in_flight=max_in_flight)
    _record_api(con, w.worker, api)
    return w


def _record_api(con, worker, api):
    """Where this runtime can be reached. A client needs to be able to ask the
    world where the world is, and the answer has to survive the process."""
    if not api:
        return
    cols = {r[1] for r in con.execute("PRAGMA table_info(workers)")}
    if "api" in cols:
        con.execute("UPDATE workers SET api=? WHERE id=?", (api, worker))


class Runtime:
    """One process turning the handle on one world.

    `run()` blocks. `stop()` is safe from another thread, which is how the HTTP
    server's shutdown endpoint and a signal handler both reach it."""

    def __init__(self, world, api="", idle_seconds=IDLE_SECONDS,
                 housekeep_seconds=HOUSEKEEP_SECONDS, beat_seconds=BEAT_SECONDS):
        self.w = world
        self.con = world.con
        self.api = api
        self.idle_seconds = idle_seconds
        self.housekeep_seconds = housekeep_seconds
        self.beat_seconds = beat_seconds
        self._stop = threading.Event()
        self.started_at = None
        self.steps = 0
        self.idles = 0
        self.housekeeps = 0
        self.last_step = None
        self.error = None

    # ── lifecycle ────────────────────────────────────────────────────
    def start(self):
        """Announce the runtime. The `workers` row is the liveness record."""
        BUS.register_worker(self.con, self.w.worker, note="world runtime")
        _record_api(self.con, self.w.worker, self.api)
        self.started_at = now()
        st = GATE.status(self.con)
        store.event(self.con, "WORLD_RUNTIME_STARTED", actor=OWNER,
                    subject="worker:%s" % self.w.worker,
                    payload={"pid": os.getpid(), "api": self.api,
                             "model": st.get("model"), "work": st.get("work")})
        # Somebody else's crash is this runtime's inheritance. Take it on
        # before claiming anything new, so work a dead process was holding is
        # back in the queue rather than stranded in it.
        self.housekeep()
        return self

    def stop(self, why="stopped"):
        self._stop.set()
        self._why = why

    def stopping(self):
        return self._stop.is_set()

    # ── the loop ─────────────────────────────────────────────────────
    def step(self):
        """One pass. Returns what happened, which is often 'nothing'."""
        out = SUP.tick(self.w)
        self.steps += 1
        if out is None:
            self.idles += 1
            self.last_step = {"kind": "IDLE"}
            return None
        self.last_step = out
        return out

    def housekeep(self):
        """Everything events alone can miss. All of it is repair, none of it is
        work: nothing here creates a task, moves an agent or completes anything."""
        self.housekeeps += 1
        stale = BUS.stale_workers(self.con)
        # NOT filtered to this worker. The whole point of recovery is to pick up
        # what a process that DIED was holding, and a filter on the live worker's
        # own id recovers precisely the items that were never stranded.
        recovered = BUS.recover_stuck(self.con)
        resumed = SUP._resume_if_an_engine_exists(self.w)
        # A proposal the Owner has since answered. Carrying it forward is the
        # world's own act: if the Owner had to emit the follow-up event, "no
        # further Owner commands" would be false by construction.
        decided = SUP.resume_if_the_owner_decided(self.w)
        BUS.beat(self.con, self.w.worker)
        out = {"stale": stale, "recovered": recovered, "resumed": resumed,
               "decided": decided}
        if stale or recovered or resumed or decided:
            store.event(self.con, "WORLD_RUNTIME_REPAIRED", actor=OWNER,
                        subject="worker:%s" % self.w.worker, payload=out)
        return out

    def run(self, max_seconds=None, max_steps=None):
        """Turn the handle until told to stop.

        The two ceilings are for tests and for supervised runs; a daemon passes
        neither and runs until `stop()`."""
        self.start()
        t0 = time.time()
        last_beat = last_house = 0.0
        try:
            while not self._stop.is_set():
                if max_seconds and time.time() - t0 > max_seconds:
                    break
                if max_steps and self.steps >= max_steps:
                    break
                did = self.step()
                el = time.time() - t0
                if el - last_beat > self.beat_seconds:
                    BUS.beat(self.con, self.w.worker)
                    last_beat = el
                if el - last_house > self.housekeep_seconds:
                    self.housekeep()
                    last_house = el
                if did is None:
                    # Nothing to do is a real answer. Wait, do not spin, and do
                    # not manufacture something to be seen doing.
                    self._stop.wait(self.idle_seconds)
        except Exception as e:                    # pragma: no cover - defensive
            self.error = "%s: %s" % (type(e).__name__, e)
            store.event(self.con, "WORLD_RUNTIME_FAILED", actor=OWNER,
                        subject="worker:%s" % self.w.worker,
                        payload={"error": self.error})
            raise
        finally:
            self.shutdown()
        return self.report()

    def shutdown(self):
        why = getattr(self, "_why", "stopped")
        try:
            BUS.stop_worker(self.con, self.w.worker, note=why)
            store.event(self.con, "WORLD_RUNTIME_STOPPED", actor=OWNER,
                        subject="worker:%s" % self.w.worker,
                        payload={"steps": self.steps, "why": why,
                                 "error": self.error})
        except Exception:                          # pragma: no cover - defensive
            pass

    def report(self):
        """In-process counters ONLY.

        This is read by the HTTP thread, and the runtime's SQLite connection
        belongs to the thread that made it — so nothing here may touch the
        database. Anything the caller wants from the world's state it reads on
        its own connection; what it can only learn from here is how this
        particular process is getting on."""
        return {"worker": self.w.worker, "pid": os.getpid(), "api": self.api,
                "started_at": self.started_at, "steps": self.steps,
                "idles": self.idles, "housekeeps": self.housekeeps,
                "ticks": self.w.ticks, "error": self.error,
                "stopping": self._stop.is_set()}


# ── what a client needs to know about the world it is looking at ─────
def runtimes(con, alive_only=False):
    """Every runtime that has ever turned this world, newest first."""
    q = "SELECT * FROM workers"
    if alive_only:
        q += " WHERE state='ALIVE'"
    q += " ORDER BY started_at DESC"
    cols = {r[1] for r in con.execute("PRAGMA table_info(workers)")}
    out = []
    for r in con.execute(q):
        d = dict(r)
        if "api" not in cols:
            d["api"] = ""
        out.append(d)
    return out


def live(con, older_than_seconds=120):
    """The runtimes currently turning this world.

    A row is not evidence on its own — a process that died leaves an ALIVE row
    behind. So a heartbeat older than the staleness window counts as gone, which
    is the same rule `BUS.stale_workers` applies."""
    BUS.stale_workers(con, older_than_seconds=older_than_seconds)
    return [r for r in runtimes(con, alive_only=True)]


def health(con):
    """Is this world running, and what is it waiting on?

    Written to be readable by something that is not a browser: this is the
    answer `curl /api/health` gives, and it is the difference between a world
    that is alive and a world whose last picture is still on screen."""
    alive = live(con)
    st = GATE.status(con)
    depth = BUS.depth(con)
    return {
        "world": "RUNNING" if alive else "NOT_RUNNING",
        "runtimes": [{"worker": r["id"], "pid": r["pid"], "host": r["host"],
                      "api": r.get("api", ""), "started_at": r["started_at"],
                      "last_seen": r["last_seen"], "claimed": r["claimed"],
                      "completed": r["completed"]} for r in alive],
        "model": st.get("model"), "work": st.get("work"),
        "queue": depth,
        "waiting_for_model": BUS.waiting_for_model(con),
        "agents": con.execute(
            "SELECT COUNT(*) c FROM principals WHERE tier<>'owner_plane' "
            "AND lifecycle_state='ACTIVE'").fetchone()["c"],
        "tasks_open": con.execute(
            "SELECT COUNT(*) c FROM tasks WHERE status NOT IN "
            "('ACCEPTED','ARCHIVED','CANCELLED')").fetchone()["c"],
        "at": now(),
    }
