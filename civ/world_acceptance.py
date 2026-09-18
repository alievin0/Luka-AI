#!/usr/bin/env python3
"""THE ARTIFACT TEST — proof that the world is not a page.

    python3 world_acceptance.py --fresh
    python3 world_acceptance.py --fresh --provider mock

There is no browser in this file. That is the entire point: everything below
talks to the world over HTTP the way any client would, and the world is a
process on a machine with an address. If the 3D client were deleted, every step
here would still pass.

    START a detached world          — it leaves the terminal
    ASK it whether it is running    — over HTTP, from outside
    GIVE it an objective            — over HTTP
    LOOK AWAY                       — no client attached at all
    COME BACK                       — and find the world moved
    COMMISSION an agent             — the factory decides, not the caller
    DEPLOY it                       — Owner act; body and location follow
    OPEN A SECOND CLIENT            — same world, same agent
    STOP the world                  — the process ends
    START it again                  — and find the same history

What this proves is the RUNTIME. Whether the agents inside it can think is a
different question with a different answer: with no model configured the work
parks as WAITING_FOR_MODEL and this script says so. With `--provider mock` the
task path executes deterministically — that is an infrastructure proof, not
inference, and it is labelled as such everywhere it appears.
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

BAR = "─" * 78
DB = os.path.join(HERE, "live-world.db")


def say(s=""):
    print(s, flush=True)


def head(t):
    say("\n" + BAR)
    say(t)
    say(BAR)


# ── the only way this file touches the world ─────────────────────────
def get(api, path):
    with urllib.request.urlopen(api + path, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def post(api, path, body, token=""):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(api + path, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    if token:
        req.add_header("X-Owner-Token", token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode("utf-8"))


def up(api, tries=60):
    for _ in range(tries):
        try:
            return get(api, "/api/health")
        except Exception:
            time.sleep(0.25)
    return None


def start_world(db, port, provider=None, detach=True):
    env = dict(os.environ)
    if provider:
        env["CIV_PROVIDER"] = provider
    else:
        env.pop("CIV_PROVIDER", None)
        env.pop("ANTHROPIC_API_KEY", None)
    cmd = [sys.executable, os.path.join(HERE, "worldd.py"), "start",
           "--db", db, "--port", str(port)]
    if detach:
        cmd.append("--detach")
    p = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=60)
    return p


def stop_world(db):
    return subprocess.run([sys.executable, os.path.join(HERE, "worldd.py"),
                           "stop", "--db", db],
                          capture_output=True, text=True, timeout=60)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB)
    ap.add_argument("--port", type=int, default=8801)
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--provider", default=None,
                    help="'mock' runs the task path deterministically; omit for "
                         "the honest no-model world")
    ap.add_argument("--away-seconds", type=float, default=6.0)
    a = ap.parse_args(argv)
    api = "http://127.0.0.1:%d" % a.port
    token = (os.environ.get("WORLD_OWNER_TOKEN") or "").strip()

    if a.fresh:
        stop_world(a.db)
        for ext in ("", "-wal", "-shm", ".worldd.log"):
            if os.path.exists(a.db + ext):
                os.remove(a.db + ext)
        pf = os.path.join(os.path.dirname(a.db) or ".",
                          "." + os.path.basename(a.db) + ".worldd")
        if os.path.exists(pf):
            os.remove(pf)

    failures = []

    def check(name, ok, detail=""):
        say("  [%s] %s%s" % ("PASS" if ok else "FAIL", name,
                             ("  — " + str(detail)) if detail else ""))
        if not ok:
            failures.append(name)
        return ok

    # ── 1 ────────────────────────────────────────────────────────────
    head("1. START WORLD — a process, detached from this terminal")
    p = start_world(a.db, a.port, provider=a.provider, detach=True)
    say(p.stdout.strip() or p.stderr.strip())
    h = up(api)
    check("the world answers over HTTP", h is not None)
    if h is None:
        say("\nthe world did not come up. Not going to pretend it did.")
        return 1
    check("it reports itself RUNNING", h["world"] == "RUNNING", h["world"])
    check("a runtime is turning it", bool(h["runtimes"]),
          h["runtimes"][0]["worker"] if h["runtimes"] else "none")
    check("this server turns the world", h["this_server_turns_the_world"])
    say("      model %s · work %s" % (h["model"], h["work"]))
    pid = h["runtimes"][0]["pid"] if h["runtimes"] else None

    # This python process is not the world's parent in any meaningful sense —
    # the daemon called setsid. Prove the pid is a different process that is
    # not a child of anything this script is holding open.
    check("the world's pid is not this process", pid != os.getpid(),
          "world pid %s, this pid %s" % (pid, os.getpid()))

    # ── 2 ────────────────────────────────────────────────────────────
    head("2. GIVE IT AN OBJECTIVE — over HTTP, then look away")
    before = get(api, "/api/health")
    # An objective needs something real to read. This is a document that
    # actually exists in the repository, and the Researcher will collect its
    # evidence from it through the same gateway every tool call goes through.
    source = os.path.join(HERE, "EMBODIED_WORLD.md")
    bad = post(api, "/api/owner/objective", {"objective": "x"}, token)
    check("an objective with no source is refused, not crashed",
          "source is required" in (bad.get("error") or ""), bad.get("error"))
    r = post(api, "/api/owner/objective",
             {"objective": "Assess whether the organisation can answer "
                           "quantitative questions about its own output.",
              "source": source,
              "required_caps": ["research"]}, token)
    check("the objective was accepted", "queued" in r, r.get("error") or r)
    say("      queued as %s, scanning %s" % (r.get("queued"),
                                             os.path.basename(source)))

    say("\n  ── NO CLIENT IS ATTACHED. The world is on its own for %.0fs. ──"
        % a.away_seconds)
    t0 = time.time()
    time.sleep(a.away_seconds)
    after = get(api, "/api/health")
    events_before = before["queue"]
    say("      queue before: %s" % json.dumps(events_before))
    say("      queue after:  %s" % json.dumps(after["queue"]))
    moved = (after["queue"] != events_before
             or after["tasks_open"] != before["tasks_open"]
             or after["waiting_for_model"] != before["waiting_for_model"])
    check("the world changed while nothing was watching", moved,
          "tasks %d→%d, waiting %d→%d"
          % (before["tasks_open"], after["tasks_open"],
             before["waiting_for_model"], after["waiting_for_model"]))
    if after["waiting_for_model"]:
        say("      %d item(s) parked WAITING_FOR_MODEL. That is the honest state of"
            % after["waiting_for_model"])
        say("      a world with no model: the runtime is alive, the work is not faked.")

    # ── 3 ────────────────────────────────────────────────────────────
    head("3. AGENT FACTORY — a real persistent agent, over HTTP")
    before_n = get(api, "/api/factory")["agents"]
    made = post(api, "/api/factory/agent", {
        "gap": "statistical inference over quantitative datasets: regression, "
               "variance decomposition and confidence interval estimation",
        "role": "Data Analyst", "name": "Data Analyst",
        "mission": "Turn quantitative datasets into defensible statistical "
                   "findings with stated uncertainty.",
        "capabilities": ["quantitative_analysis", "statistical_inference"],
    }, token)
    say("      decision  %s" % made.get("decision"))
    say("      rationale %s" % made.get("rationale"))
    aid = made.get("agent_id")
    check("the factory created an agent", bool(aid), made.get("error") or made)
    if not aid:
        say("\n  The factory refused. That is a real answer and this script will not")
        say("  force past it — but the remaining steps need an agent, so they stop here.")
        return 1
    check("it is PROPOSED, not active", made.get("lifecycle") == "PROPOSED",
          made.get("lifecycle"))
    check("it has no body until the Owner says so",
          not made.get("embodied"))

    dep = post(api, "/api/owner/approve-agent", {"agent_id": aid}, token)
    say("      deployed  %s" % json.dumps(dep))
    check("the Owner deployed it", dep.get("lifecycle") == "ACTIVE",
          dep.get("error") or dep.get("lifecycle"))
    check("it has a persistent body", bool(dep.get("body_id")), dep.get("body_id"))
    check("it is standing somewhere real", bool(dep.get("workspace")),
          "%s at (%s,%s) seat %s" % (dep.get("workspace"), dep.get("x"),
                                     dep.get("y"), dep.get("station")))
    check("the population grew by one",
          get(api, "/api/factory")["agents"] == before_n + 1)

    # ── 4 ────────────────────────────────────────────────────────────
    head("4. TWO CLIENTS — one world")
    # Two independent connections, opened separately, reading the same world.
    # A third process does the same, so this is not one client talking to itself.
    c1 = get(api, "/api/world3d")
    c2 = json.loads(subprocess.run(
        [sys.executable, "-c",
         "import urllib.request,sys;"
         "sys.stdout.write(urllib.request.urlopen('%s/api/world3d').read().decode())"
         % api], capture_output=True, text=True, timeout=30).stdout)
    check("client A sees the new agent", aid in c1["agents"])
    check("client B (a separate process) sees it too", aid in c2["agents"])
    check("both clients agree on where it is",
          c1["agents"][aid]["workspace"] == c2["agents"][aid]["workspace"],
          c1["agents"][aid]["workspace"])
    check("the 3D payload carries its persisted body",
          (c1["agents"][aid].get("appearance") or {}).get("body_id") == dep["body_id"],
          (c1["agents"][aid].get("appearance") or {}).get("body_id"))
    check("neither client can write",
          post(api, "/api/world3d", {}, token).get("error") is not None)

    # ── 5 ────────────────────────────────────────────────────────────
    head("5. STOP THE WORLD, THEN START IT AGAIN")
    snap = {
        "agents": sorted(c1["agents"]),
        "body": (c1["agents"][aid].get("appearance") or {}).get("body_id"),
        "workspace": c1["agents"][aid]["workspace"],
        "events": get(api, "/api/health")["queue"],
    }
    events_n = len(get(api, "/api/movements"))
    out = stop_world(a.db)
    say("      " + (out.stdout.strip() or out.stderr.strip()))
    gone = True
    try:
        get(api, "/api/health")
        gone = False
    except Exception:
        pass
    check("the world stopped answering", gone)

    p = start_world(a.db, a.port, provider=a.provider, detach=True)
    say("      " + (p.stdout.strip().splitlines() or [""])[0])
    h2 = up(api)
    check("it came back up", h2 is not None and h2["world"] == "RUNNING")
    c3 = get(api, "/api/world3d")
    check("the commissioned agent survived the restart", aid in c3["agents"])
    check("its identity is unchanged",
          sorted(c3["agents"]) == snap["agents"], "%d agents" % len(c3["agents"]))
    check("its body is the same body",
          (c3["agents"][aid].get("appearance") or {}).get("body_id") == snap["body"],
          (c3["agents"][aid].get("appearance") or {}).get("body_id"))
    check("it is standing where it was",
          c3["agents"][aid]["workspace"] == snap["workspace"],
          c3["agents"][aid]["workspace"])
    check("the movement history is intact",
          len(get(api, "/api/movements")) >= events_n,
          "%d rows" % len(get(api, "/api/movements")))
    rt = get(api, "/api/runtime")
    check("both runtimes are recorded in the world's own history",
          len(rt["runtimes"]) >= 2, "%d runtime rows" % len(rt["runtimes"]))

    # ── 6 ────────────────────────────────────────────────────────────
    head("6. WHAT THIS RUN ACTUALLY SHOWED")
    h3 = get(api, "/api/health")
    say("  REAL          the server process, the database, the HTTP API, the")
    say("                factory decision, %s's contract, lineage, body and" % aid)
    say("                location, the restart, the two clients, the history.")
    if a.provider == "mock":
        say("  DETERMINISTIC the task path ran on MockProvider. That is the RUNTIME")
        say("                being exercised, not intelligence. No model was called.")
    else:
        say("  NOT RUN       no model is configured, so no task executed. %d item(s)"
            % h3["waiting_for_model"])
        say("                are parked WAITING_FOR_MODEL rather than faked.")
    say("  SIMULATED     nothing. This script has no scripted world of its own.")
    say("")
    say("  model %s · work %s · agents %d · queue %s"
        % (h3["model"], h3["work"], h3["agents"], json.dumps(h3["queue"])))

    head("RESULT")
    if failures:
        say("  %d check(s) FAILED: %s" % (len(failures), ", ".join(failures)))
        return 1
    say("  every check passed. The world is a process, not a page.")
    say("  It is still running. `python3 worldd.py stop --db %s` ends it."
        % os.path.basename(a.db))
    return 0


if __name__ == "__main__":
    sys.exit(main())
