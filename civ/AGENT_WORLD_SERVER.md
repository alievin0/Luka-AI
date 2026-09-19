# The Agent World Server

The world is a process. The 3D page is one of its clients.

That sentence is the whole of this change, and until now it was not true.

---

## What made it an artifact

The world already had a persistent database, a supervisor, a queue, laws as
triggers, spatial state, embodiment and an HTTP server. It was still an
artifact, for one checkable reason:

**Nothing turned the handle.**

`world_server.py` read state and served it. The supervisor — the thing that
claims from the queue, wakes an agent, moves it, records what happened — only
ever ticked inside `always_on_demo.py`, `spatial_demo.py` or a test. So the
world's clock belonged to whichever terminal happened to be open. Close it and
the HTTP server went on cheerfully serving a frozen picture, with no way for
anyone looking at it to tell.

Three smaller things followed from that one:

| | before |
|---|---|
| **No control plane** | The server had no `do_POST`. Nothing could be started, commissioned or approved except by a Python call from a script. |
| **A factory-made agent was nowhere** | `factory.create_agent` wrote a real contract with real lineage — and no body, no address, no seat. It could not appear in any client. |
| **Every view enumerated `W.CREW`** | Four separate places built their agent list from the list the world is *founded* with. Any agent the factory made was silently excluded from the 3D payload, the flat world, the org view and the capability gap analysis. |

---

## What makes it a server now

```
worldd.py  ─ one process ────────────────────────────────┐
   ├─ thread   ThreadingHTTPServer   reads + owner commands
   └─ main     world_runtime.Runtime turns the supervisor
                     │
                     ▼
              SQLite (WAL) + 63 laws as triggers
```

### `core/world_runtime.py` — the world's own clock

A `Runtime` claims from the queue, ticks the supervisor, beats, recovers work a
dead predecessor was holding, and un-parks work that was waiting for a model
once a model exists. It runs until told to stop.

Three things it deliberately does not do:

* **It does not invent work.** An empty queue produces a heartbeat and nothing
  else. A test asserts that 25 idle steps change no row in `tasks`, `artifacts`,
  `movements`, `agent_locations`, `tool_calls` or `agent_messages`.
* **It does not fabricate inference.** The provider comes from the model gate.
  With no model the task parks as `WAITING_FOR_MODEL` and the world stays up.
* **It does not own state.** Kill the process and the world is exactly what the
  database says it is.

### `worldd.py` — START WORLD

```
python3 worldd.py start  --db world.db --port 8790            # foreground
python3 worldd.py start  --db world.db --port 8790 --detach   # leaves the terminal
python3 worldd.py start  --db world.db --port 8790 --host 0.0.0.0   # other devices
python3 worldd.py status --db world.db
python3 worldd.py stop   --db world.db
```

`--detach` forks, calls `setsid` and closes stdio, so closing the shell, the
editor or the browser has no effect on it. `start --detach` returns only once
the child has claimed the pidfile, so a successful return means the world *is*
up rather than that it was asked to come up.

### Liveness is a heartbeat, not a row

The `workers` table already recorded pid, host, `started_at` and `last_seen`;
this adds `api`, the address the runtime is reachable on. A process that dies
leaves an `ALIVE` row that stops beating — so `health()` calls
`BUS.stale_workers` first and a runtime whose heartbeat is older than the
staleness window counts as gone. **A row is not evidence; the heartbeat is.**

`GET /api/health` answers `RUNNING` or `NOT_RUNNING`, and a server that is only
*reading* a world it does not turn says so in
`this_server_turns_the_world: false` — so a client can never conclude the world
is alive merely because a page loaded.

---

## The control plane

Reads are open. Anything that **changes** the world needs the owner token,
because a browser tab is not the Owner.

| | |
|---|---|
| `GET /api/health` | is this world running, what is it waiting on |
| `GET /api/runtime` | every runtime that has ever turned this world |
| `GET /api/factory` | factory jobs, decisions, what was created |
| `GET /api/world3d` · `/api/world` · `/api/open` · `/api/movements` · `/api/agent/<id>` … | the world, as before |
| `POST /api/owner/objective` | `{objective, source, required_caps}` |
| `POST /api/factory/agent` | `{gap, role, capabilities, …}` |
| `POST /api/owner/approve-agent` | `{agent_id}` |
| `POST /api/owner/stop` | stops the runtime in this process |

The token comes from `WORLD_OWNER_TOKEN` or `WORLD_OWNER_TOKEN_FILE`. **Empty
means unauthenticated**, which is appropriate only for a loopback development
world — bind to `127.0.0.1` or set a token.

Every command calls the *same function a script would call*. The API is a second
door onto one world, never a second implementation of it.

### An objective needs a source

`POST /api/owner/objective` requires a `source` file, checked before the command
is accepted. The scan that starts every objective reads it through the real
gateway and attests to what it read, because an opportunity with no evidence
under it is the thing this system exists not to produce. Previously a missing
source surfaced three retries later as `TypeError: expected str … not NoneType`.

---

**The agents inside it can now work**, rather than being moved through a
script: [`AGENT_COGNITION.md`](AGENT_COGNITION.md), with
`python3 real_agent_demo.py --fresh` as the run and `python3 model_check.py` as
the preflight for pointing it at a real model. Whether one is actually driving
anything is [`REAL_INFERENCE.md`](REAL_INFERENCE.md); today it is not.

## The Agent Factory makes inhabitants

`factory.py` already did the hard part and still does: it decides whether a
capability gap actually warrants a new agent, refuses a duplicate, runs a
security review and an evaluation, and writes a contract with lineage.
`core/world_factory.py` adds only the missing wiring.

```
commission()  →  the existing pipeline, from an API-shaped request  →  PROPOSED
deploy()      →  Owner act: lifecycle → ACTIVE, then EMBODY, then PLACE
```

The split is the point. **The factory may propose; it may not staff the
organisation.** A commissioned agent has no body and no location until the Owner
deploys it. Absence of an Owner decision is not approval.

Deployment runs in one savepoint: `PROPOSED → EVALUATING → APPROVED → ACTIVE`,
then `EMB.embody`, then `SPACE.stand` on the dispatch floor, then
`EMB.take_station`. A half-deployed agent standing nowhere would be worse than
no agent.

Ids are sequential and never reused — the founding crew carry names, so the
first commissioned agent in a founded world is **AGT-000006**. Reuse would make
a retired agent's history silently become a new agent's history.

Retirement keeps everything: the contract, the lineage, the body, every artifact
attribution. It releases the desk and stops the work.

### The factory refuses, and says why

Most capability gaps are not answered by another head, and the ladder is
deterministic and inspectable:

```
REUSE     an existing agent already holds every required capability
TOOL      the gap is a missing tool, not a missing worker
SKILL     the nearest agent is close enough that teaching it is cheaper
WORKFLOW  the nearest agent needs no new skill; route the work
REJECT    the gap is too vague, or no capability was named, or the spec
          is functionally a duplicate of an agent that already exists
NEW_AGENT nothing else answers it
```

A refusal now always carries its reason in the same field a success does.

---

## Every view shows every inhabitant

`W.inhabitants(con)` replaced four enumerations of `W.CREW` — in `world3d`,
`world_stage`, `open_world` and `world_state` — plus the capability gap analysis
in `capability_graph.gaps`, which read the founding role map and would therefore
report a gap the organisation had already filled and commission a second agent
to fill it again. A source-level test now fails if `for … in W.CREW` reappears in
a view.

Fixing this exposed a second defect the first was hiding: `open_world` drew
`CREW` at *every* zoom level, including ORBIT and DISTRICT, which declare that
they **aggregate** agents. Drawing five of 112 is not aggregation; it is showing
an arbitrary five. It looked like aggregation only because the crew is small.
The renderer now honours its own LOD contract — none at ORBIT, all of them where
individuals are drawn.

### Distinct appearances at scale

Sixteen palettes and a handful of agents make a shared colour likely rather than
exceptional, and colour is the axis a person reads first — AGT-000006 came out
the same charcoal/orange as the Orchestrator. The identity now derives an
**order** of palettes rather than a winner, and `embody` takes the first one no
living agent holds, writes it down and freezes it. The preference order is still
a pure function of `sha256(agent_id)`; which one is taken depends on who was
embodied before, exactly as a registry assigning a unique mark works.

---

## Proof

```
python3 world_acceptance.py --fresh                 # the honest no-model world
python3 world_acceptance.py --fresh --provider mock # the task path, deterministically
```

There is no browser in that file. It starts a detached world, asks it over HTTP
whether it is running, gives it an objective, **stops talking to it**, comes back
and finds it moved, commissions and deploys an agent, opens a second client in a
separate process, stops the world, starts it again, and finds the same history.

Observed (no model configured):

```
queue before: {READY 0, CLAIMED 0, DONE 0, FAILED 0}
queue after:  {READY 0, CLAIMED 0, DONE 4, FAILED 0, WAITING_FOR_MODEL 1}
tasks 0 → 2
```

Four queue items completed and one parked, with no client attached, because an
HTTP request said so. The Researcher read `EMBODIED_WORLD.md` through the real
gateway and the discovery carries that evidence.

---

## Deployment

The world is portable by construction: Python standard library, one SQLite file,
no build step, no vendor. Nothing below is required to run it — this is the shape
it takes when it leaves a laptop.

| | how | status |
|---|---|---|
| **Server** | `worldd.py start --host 0.0.0.0 --port 8790` | **done** |
| **Database** | SQLite (WAL) by default. `store.connect` already takes a URL and picks a dialect, so Postgres is a deployment variable rather than a domain change | SQLite **done**; Postgres path exists, **not exercised** |
| **Worker process** | the runtime in the same process, or a second `worldd` against the same database — leases, `version` guards and heartbeats make that safe | **done** |
| **Health check** | `GET /api/health`, non-zero exit from `worldd.py status` | **done** |
| **Process restart** | systemd unit or `launchd` plist, `Restart=always`; the pidfile prevents two runtimes on one database | **documented, not shipped** |
| **Migrations** | `store.connect` applies every schema and widens CHECKs losslessly on open; there is no separate migration step to forget | **done** |
| **Logging** | `--detach` writes to `<db>.worldd.log`; the durable record is the `events` table | **done** |
| **Backups** | `world_export.py` for a portable dump; `sqlite3 .backup` for a hot copy | **done** |
| **Authentication** | one shared owner token on every mutating request | **minimal** — one token, no users, no roles, no expiry |
| **HTTPS / domain** | terminate TLS at a reverse proxy (nginx, Caddy, a tunnel) and forward to the loopback port | **not implemented in the server** |
| **Object storage** | artifacts are rows and files on local disk | **not implemented** |
| **Secret management** | environment variables; `ANTHROPIC_API_KEY` is never read except by the provider | **minimal** |

### Do not expose this to the internet as it stands

Stated plainly because the architecture supports it and the hardening does not:

* `ThreadingHTTPServer` is a standard-library server, not a hardened one.
* There is no TLS in-process. Put a reverse proxy in front.
* One shared token is not user authentication.
* The OS sandbox is **not** a complete security boundary. Before any production
  external action: container isolation, network isolation, filesystem isolation,
  scoped credentials, audit.

Bind to `127.0.0.1` or a private network address until those exist.

---

## Offline

The world boots and runs with no internet, no API key and no subscription. What
becomes unavailable is exactly what needs a model, and it says so rather than
pretending:

```
WORLD    RUNNING
MODEL    OFFLINE   WORK IDLE
WAITING  1 parked for a model
```

Everything deterministic keeps working: the database, the laws, identities,
memory, tasks, projects, spatial state, embodiment, the factory's decisions, the
3D client, export and restore.

---

## Real · deterministic · simulated

| | |
|---|---|
| **REAL** | the server process, the HTTP API, the database and its 63 laws, the queue, leases, the tool gateway, the factory's decision, AGT-000006's contract, lineage, body and location, movement, the restart, the two clients, the history, the model gate's honest `OFFLINE` |
| **DETERMINISTIC** | task execution under `--provider mock` or `ScriptedWorker`. This exercises the **runtime**. It is not inference, and no model is called |
| **NOT IN THESE RUNS** | real model inference. Everything above ran with the model absent or stubbed, so what is shown is the machinery that would carry reasoning and not the reasoning. A model has since driven the same loop — [`REAL_INFERENCE.md`](REAL_INFERENCE.md) — and produced none of the results recorded here |
| **SIMULATED** | nothing. There is no scripted activity anywhere in the runtime, and an idle world is idle |

---

## Known limitations

1. **No run recorded here was a model's.** Everything here is the machinery
   around a model, exercised with the model absent or stubbed. Inference is
   demonstrated separately, in [`REAL_INFERENCE.md`](REAL_INFERENCE.md); it
   produced none of these results.
2. **TLS, real authentication and object storage are not implemented.**
3. **The Postgres path is untested.** The dialect boundary exists; no Postgres
   has been connected.
4. **One runtime per database is enforced by a pidfile**, which is local-only.
   Two runtimes on two machines against one SQLite file over a network share
   would not be safe — that is what the Postgres path is for.
5. **Scale is demonstrated to 112 persistent agent locations** (the LOD test) and
   6 contracted agents. 1,000+ needs no different data model, but has not been
   run.
6. **The Owner token is a single shared secret** with no rotation or expiry.
