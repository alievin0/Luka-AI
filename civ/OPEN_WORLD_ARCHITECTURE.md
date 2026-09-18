# The Open World

**A place, not a dashboard.** The world is a tree of districts with real
coordinates, drawn in axonometric, and every mark in it is a row.

```
python3 always_on_demo.py --fresh        # give the world something to have done
python3 world_server.py --db always-on.db
#   /       the Open World
#   /flat   the transitional floor plan, kept working
```

**Implemented, not designed.** `core/open_world.py` is the projection and it is
tested; `world_ui/open.{html,css,js}` draws it. The visual language it follows
was specified first in
[`AGENT_WORLD_VISUAL_ARCHITECTURE.md`](AGENT_WORLD_VISUAL_ARCHITECTURE.md).

**It runs with no model, and says so.** Who owns this world, what it depends on
and what survives each of those dependencies disappearing is
[`OWNERSHIP_AND_INDEPENDENCE.md`](OWNERSHIP_AND_INDEPENDENCE.md) —
`python3 offline_demo.py --fresh` is that document as a runnable drill.

**Positions are rows now, not arithmetic.** This page describes the projection;
the agents standing in it have persisted coordinates, destinations, routes and a
movement record, all written when work sent them somewhere. That is
[`SPATIAL_WORLD.md`](SPATIAL_WORLD.md), and `python3 spatial_demo.py --fresh` is
the proof.

---

## 1. Why the floor plan had to go

Three structural properties guarantee "diagram" no matter how it is styled, and
the previous UI had all three: orthographic top-down (a plan view is a map — a
place is seen *from* somewhere), **zero occlusion** (the strongest depth cue
humans have, entirely absent), and everything a rectangle on one plane.

A fourth was subtler: it had no darkness. Every bay drew at the same value
whether or not anything was happening in it, so "busy" and "quiet" differed by a
colour swap rather than by how much of the world was lit.

---

## 2. The spatial tree

`WORLD → DISTRICT → FACILITY → WORKSPACE → AGENT / TASK / ARTIFACT / EVIDENCE`

Districts are **data** (`open_world.DISTRICTS`), not code. Adding one is adding a
dict; a test adds a district at runtime and asserts it appears with the world's
bounds grown to fit. The world is explicitly **not** hardcoded to six stations —
there are ten districts and sixteen workspaces today.

| District | Facilities | Holds |
|---|---|---|
| **Owner Observatory** | Instrument Rail | off-plate, across a gap of dark ground |
| **Central Hub** | Intake · Dispatch | what was noticed; who it goes to |
| **Research District** | Research Hall · Evidence Vault · Knowledge Archive | reading, evidence, promoted memory |
| **Creation District** | Design Floor · Build Factory (4 cells) · Test Bench | spec → artifact → verification |
| **Review District** | Inspection | independent judgement; no door to the cells |
| **Operations District** | Containment Pad | execution, inside a **marked boundary** |
| **Output** | Dock | accepted work leaves |
| **Archive** | Stacks | sunken, dim, never deleted |
| **Project Districts** | *allocated* | one plot per project, laid out as projects arrive |
| **Future Expansion** | *none* | ground reserved, drawn dashed and empty |

---

## 3. Position is derived, never chosen

`place_agent(con, agent_id)` returns a workspace **and a `reason` naming the row
that put it there**:

```
AGT-RESEARCHER  ws_lab         RUNNING   holds an active lease on task #2
AGT-BUILDER     ws_cell_0      IDLE      holds no lease
AGT-REVIEWER    ws_inspection  ASSIGNED  assigned task #4 (BLOCKED)
```

`workspace_of(task)` maps a task's status and required capability onto the tree.
It does **not** duplicate `world_server.task_station` — that function stays
authoritative for the six-station view, and a test asserts the two never
disagree across every status × capability combination. One truth, two views.

---

## 4. What lights up, and why

- An entity is **RUNNING** only where a row in `leases` is ACTIVE and its task is
  RUNNING. A test releases the lease and asserts the world goes quiet.
- A **workspace** is lit because a task in it is RUNNING; it turns red because a
  task in it is FAILED, REJECTED or BLOCKED.
- A **district** is hot because an agent in it is working — so one lease lights
  one district and the rest of the world stays dark. That is the whole design:
  **darkness is meaningful.**
- Only three things emit light: an agent's core, a working agent's cast pool, and
  a decision post. Everything else is lit by them, so every bright pixel is
  attributable.

**Movement.** An entity moves only when its placement changes. Reading the world
twice without a write returns a byte-identical payload — asserted by a test that
compares two serialisations. There is no wandering, no idle animation of
position, and nothing decorative that moves at all.

---

## 5. Zoom and scale

| Level | Draws | Aggregates |
|---|---|---|
| **ORBIT** (`<0.45`) | districts | facilities, workspaces, **agents**, tasks, artifacts |
| **DISTRICT** (`<0.85`) | + facilities | workspaces, agents, tasks, artifacts |
| **FACILITY** (`<1.6`) | + workspaces, **agents** | artifacts |
| **WORKSPACE** | + tasks, artifacts, evidence | — |

At ORBIT **no agent is drawn at all** — a district renders as one cluster badge
carrying a count. A thousand agents is a city where some blocks are bright, not a
thousand sprites. A test asserts that no level both draws and aggregates the same
thing, and that ORBIT aggregates agents rather than drawing them.

The camera reports its scale to the server (`/api/open?scale=`), so level of
detail is computed in Python next to the data rather than guessed in the browser.

---

## 6. The five entities

One grammar, five machines — **CORE + FRAME + FIELD**. The core is identity and
is identical across all five; the frame is the role; the field carries state.

| Agent | Frame | What the geometry asserts |
|---|---|---|
| Orchestrator | hub with five radiating anchors | **no manipulator of any kind** |
| Researcher | an iris that opens to read | an instrument that looks |
| Builder | strata on a spine, parting to work | an instrument that composes |
| Reviewer | opposing calipers on a crosshair | measures someone else's work; no iris, no strata |
| Operator | a driven rotor around a sealed core | execution is contained |

State is colour and completeness: idle grey and dim · assigned cool · **running
warm, frame open, casting light** · review violet · blocked amber · failed a
broken ring. The split is also the embodiment boundary — swap the frame and the
identity is untouched.

---

## 7. Material language

| Object | Form |
|---|---|
| Agent | core + frame + field, hovering (a digital entity has no gait) |
| District | bounded ground with an address |
| Facility | an extruded volume with a lit top and two shaded faces |
| Workspace | a floor plate inside a facility |
| Project | a plot in the Projects district, allocated as projects arrive |
| Artifact | a small slab, coloured by its verdict — green approved, red rejected, pale unjudged |
| Evidence | hard faceted motes on the vault shelf, one per row |
| Task | occupancy of a workspace |
| Tool | a station, bolted down — an agent goes to capability, never carries it |

---

## 8. Navigation

Pan (drag), zoom (wheel, which re-reads at the new level of detail), four zoom
buttons, an Observatory button that flies to the Owner's platform, click a
district / agent / project / artifact to inspect it, and `#agent/AGT-RESEARCHER`
style deep links. The inspector is a **secondary layer** — the world is
understandable without opening it.

---

## 9. Reality boundary

**REAL STATE** — a row exists; the visual is a lookup. Agent existence, identity,
grants · lit/working (an ACTIVE lease) · which workspace holds which task ·
artifacts, their sha, their verdict · evidence counts · project state, spend,
team · queue depth, chain state, Owner presence.

**STATE PROJECTION** — a deterministic, *tested* function of real state that adds
no information. `workspace_of` · `place_agent` · plot allocation · LOD
aggregation · district coordinates · the axonometric mapping.

**DECORATION** — carries no information, removable with zero loss. The ground
plate, the vignette, the key-light gradient, facility face shading, the dashed
outline on reserved expansion ground.

Rules, enforced by tests: decoration never uses the accent or a semantic colour ·
decoration never moves · nothing implies an action that did not happen · absence
is visible (an empty vault, a dark cell, an empty Projects district) · **the UI
never writes** (`world_server.py` contains no INSERT/UPDATE/DELETE, and the
Open World endpoint is asserted read-only across four zoom scales).

One honest case: the Operations pad is drawn as an **open frame, not a sealed
vessel**, because `EXECUTE_SANDBOX` is a subprocess under the same user and a
containment field would imply a guarantee that does not exist.

---

## 10. Limitations

1. **The transitional floor plan still exists** at `/flat`. It is not the front
   door any more, and it is not deleted, because its 24 projection tests are
   still meaningful.
2. **LOD is tested, not benchmarked.** The contract holds at 5 agents and 1
   project; nobody has rendered 1,000.
3. **Occlusion is painter's-order over axis-aligned prisms.** Correct for this
   layout; a district that overlapped another in depth would need the
   topological sort used in the concept renderer.
4. **Labels are billboarded and unmanaged.** At WORKSPACE zoom with many tasks
   they will collide.
5. **Accessibility.** A world whose meaning is carried by light and position is
   hostile to screen readers and to low-vision users. The inspector is the
   accessible surface and must stay complete enough to be the only one. Amber /
   clay / sage are not separable by all viewers; only FAILED has a second,
   non-colour channel (the broken ring). The others need one.
6. **A brand-new world is entirely dark.** Honest, and possibly a poor first
   impression. It needs an answer that is not decoration.
