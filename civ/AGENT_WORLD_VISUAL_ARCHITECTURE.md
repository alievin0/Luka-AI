# Agent World — Visual Architecture

**Status: DESIGN ONLY. Nothing here is implemented.** The World UI at `53ba2ed`
is untouched. This document and the concept boards in `design/boards/` are the
specification for what replaces it; `AGENT_WORLD_VISUAL_SPEC.md` is the short
version to build from.

---

## 0. What is actually wrong with the current World

Not the styling. Three structural properties guarantee "diagram" no matter how
it is coloured, and the redesign at `53ba2ed` could not escape any of them:

1. **Orthographic top-down.** A plan view is a map. A place is seen *from*
   somewhere.
2. **No occlusion.** Nothing is ever in front of anything else. Occlusion is the
   strongest depth cue humans have, and the current world has zero.
3. **Everything is a rectangle on one plane.** No volume, no contact, no scale
   relationship between an inhabitant and the thing it inhabits.

A fourth, subtler one: **the current world has no darkness.** Every bay is drawn
at the same value whether or not anything is happening in it, so "busy" and
"quiet" differ by a colour swap rather than by how much of the world is lit.

The fix is not more detail. It is a viewpoint, volume, and light.

---

## 1. Visual philosophy

> **A working model of an organisation, lit by its own activity.**

The world is a physical scale model — the kind an architecture practice builds
in pale plaster and sets on a dark table under one soft light. It has a finite
edge, so it is an *object* you are looking at rather than a map that goes on
forever. It is mostly dark. Where work is happening, a light is on.

Five commitments follow from that image, and everything else in this document
is downstream of them:

| | |
|---|---|
| **Darkness is meaningful** | An unlit building is an idle one. Brightness is never decoration, so a quiet world genuinely looks quiet and a busy one genuinely looks busy. |
| **Only three things emit** | An agent's core, a working agent's field, and a decision post. Everything else is lit *by* them, so every bright pixel is attributable to a row. |
| **Tools are bolted down** | An agent goes to a capability; it never carries one. Privilege becomes spatial, and you can *see* that the Inspection room has no write station. |
| **Agents hover** | A digital entity has no gait. Nothing walks, so there is no locomotion to fake and no pathing to invent. |
| **Nothing is tidied away** | Failures stay on the ground, the archive fills, the evidence vault fills. A world that has done work looks different from a fresh one. |

**What it is not:** not a game, not cyberpunk, not military, not childish, not a
SaaS dashboard. The prohibitions in §10 are enforceable, not aspirational.

---

## 2. Direction study — and why this one

Three directions were drawn against identical content (board `H-directions`).

**A · THE LIT MODEL — adopted.** Axonometric massing under gallery light.
Occlusion, contact shadow and cast light carry the whole image; the accent is
spent only on activity. The only direction in which darkness means something.
*Risk:* could read inert. *Answer:* light is the life, and light is a lease.

**B · THE SECTION — borrowed, not adopted.** A vertical cut showing every room
at once. Superb for teaching the building, fatal as a world: it is a drawing,
and a drawing is exactly the failure mode being escaped. **Kept as the Z2
treatment** — zoom into a facility and the roof comes off, revealing the
section. That is how "entering a place" becomes literal rather than metaphorical.

**C · THE VOLUME — rejected.** Suspended lattices in a dark chamber, no ground.
Fails twice: without a ground plane there is no scale and no contact, so nothing
reads as inhabited; and every legible version slid toward neon. It looks like
the inside of a machine, not a place where work is done.

---

## 3. The camera and the ground

```
perspective: 2600px        a long lens — a whisper of convergence, not a game camera
rotateX(56deg)             ground-plane pitch
rotateZ(-38deg)            yaw
```

Long perspective rather than true axonometric is deliberate: the faint
convergence is what makes it read as a *photograph of a model* instead of a
technical illustration. Zoom scales the container; pan translates the ground.

**The ground is finite and has a visible edge.** An infinite grid is a map; a
plate with an edge is an object on a table. Districts sit on the plate. The
Owner's platform sits *off* it, across a gap of dark ground.

**Depth cues, in order of load-bearing importance:** occlusion → contact shadow
→ cast light → atmospheric falloff → scale hierarchy → layer parallax → depth of
field (used once, at Z3 only, never ambient).

**Draw order is a partial order, not a number.** A single depth value cannot sort
axis-aligned boxes in axonometric — by centre depth a long building hides behind
a short one; by near corner it covers everything in front of it. The rule is
*A is behind B if A ends before B begins on any axis*, resolved by topological
sort, with centre depth as the tie-break and cycle fallback. This is implemented
and verified in `design/concept_render.py`; it is not optional.

---

## 4. Agent entity system

Every entity is **CORE + FRAME + FIELD**. The grammar is shared so the five read
as one species; the frame is role-specific so none is a recolour of another.

| Part | Is | Driven by | Changes when |
|---|---|---|---|
| **CORE** | identity | the `principals` row, contract, memory | never |
| **FRAME** | role — the silhouette | `agents.form` (a column, **not** a hardcoded map) | the agent is re-embodied |
| **FIELD** | state — ring, glow, cast light | leases, task status, tool calls | constantly |

This split is the whole of §13 (embodiment). It costs nothing now and it is the
one thing that must not be got wrong, because retrofitting it means redesigning
identity.

**Scale:** agents are roughly 1:6 against a facility's height. They are
instruments, not giants; a place feels real when its inhabitants are small in it.
The Orchestrator is 1.15× and hovers higher — elevation is coordination, not rank.

### 4.1 The five frames

| Agent | Frame | What the geometry asserts |
|---|---|---|
| **ORCHESTRATOR** | **The Armature** — an open polyhedral cage, five anchor nodes, hollow | It has **no manipulator of any kind.** The only entity that is structure rather than mass. This is "holds no tool" as a silhouette. |
| **RESEARCHER** | **The Aperture** — a segmented iris on a focal stem | An instrument that *looks*. The iris opens to read and closes at rest. Collected evidence rides in its field as motes. |
| **BUILDER** | **The Assembly** — strata on a spine | An instrument that *composes*. The plates part to work and the artifact is visible in the gap — the thing being built is literally inside the machine. |
| **REVIEWER** | **The Gauge** — opposing calipers around a crosshair | An instrument that *measures someone else's work*. It has no iris and no strata: visibly incapable of gathering or producing. |
| **OPERATOR** | **The Rotor** — a driven ring with radial teeth around a sealed core | An instrument that *acts*. The only enclosed core, because execution is contained. It turns **only** while a sandbox execution is live. |

### 4.2 States

The field carries state, identically for all five.

| State | Field | Frame | Core | Position |
|---|---|---|---|---|
| IDLE | none; ground shadow only | at rest | dim, slow breath | home station, low hover |
| ASSIGNED | thin cool ring, static | at rest | steady | at the workspace, low hover |
| WORKING | warm ring, slow breath; **casts a light pool** | open | bright | raised hover |
| TOOL-USE | directed beam to a bolted station; one pulse per call | iris opens / plates part | flash on the call | unchanged |
| OBSERVING | a packet travels source → field | — | absorbs | unchanged |
| REVIEW | violet ring, held | — | — | its artifact is elsewhere; it waits |
| BLOCKED | amber ring, **static — stillness reads as stuck** | caught mid-open | dim | drops |
| FAILED | **the ring breaks** — a visible gap | slack | dark | drops; shadow hardens |
| COMPLETED | ring closes, releases outward once, fades | returns to rest | steady | returns home |
| SELECTED | vertical light shaft; the rest of the world desaturates | — | — | camera frames it |

Two of these are doing real work. **BLOCKED is still** — every other lit state
breathes, so stillness is the signal. **FAILED breaks the ring** — a gap in a
circle is legible at any zoom and at any size, including at Z1 where the frame
is no longer drawn.

### 4.3 Relationships

Drawn only for rows that exist, with direction (a slow travelling highlight) and
weight by recency:

- **delegation** — taut line, Orchestrator anchor → assignee (`task_assignments`)
- **authorship** — the artifact tethers to its producer until it leaves the cell
- **judgement** — caliper line, Reviewer → artifact (`reviews`)
- **evidence** — motes held in the collector's field (`evidence.collected_by`)

---

## 5. The Works — factory architecture

One building with a real plan, entered at one end. **The circulation is the law.**

```
INTAKE → RESEARCH HALL → DESIGN FLOOR → BUILD CELLS → TEST BENCH → INSPECTION → OUTPUT DOCK
   |          |                                            |            |
(opportunity  EVIDENCE                                  (verification)  └── RETURN LANE ──┐
 queue)       VAULT                                                                       │
                          ARCHIVE (sunken, behind)          BUILD CELLS ←─────────────────┘
```

| Space | Is | Shows |
|---|---|---|
| **INTAKE** | an open forecourt | DISCOVERED/PROPOSED tasks as sealed forms standing in the yard. An empty yard means nothing has been noticed. |
| **RESEARCH HALL** | a tall open volume | the reading floor; sources arrive from the vault |
| **EVIDENCE VAULT** | translucent, adjacent | one slot per `evidence` row. It visibly fills over the life of the world. |
| **DESIGN FLOOR** | a low wide bench | where a task's **conditions are declared** — gauges placed on the work-to-be, standing unfilled. The acceptance bar exists before the work does. |
| **BUILD CELLS** | a row of enclosed bays | one cell per concurrent build. **This is the scaling primitive.** |
| **TEST BENCH** | a frame the artifact passes through | deterministic verification, **physically outside the cell that produced the work** |
| **INSPECTION** | a room with its own approach | **no door to the build cells.** A reviewer who could walk into the cell would be a co-author. |
| **OUTPUT DOCK** | where accepted work leaves | |
| **ARCHIVE** | sunken behind everything, dim | ARCHIVED tasks and superseded artifacts. Visible, never deleted. |
| **RETURN LANE** | a marked lane, Inspection → Build | **the most important path in the building.** |

Two architectural decisions carry real guarantees and must not be softened for
composition:

- **Test sits between Build and Inspection, with no bypass.** The separation of
  verification from production is a law; the plan should make violating it
  obviously impossible.
- **The return lane is in the open.** A rejection is the most informative event
  the world produces. It travels back across the floor where it can be seen, not
  through a hidden channel.

---

## 6. Research environment

Researcher → station → source → observation → evidence → claims → artifact.

- **READ_REPO is a bolted-down station.** The agent moves to it. Capability lives
  at the station, never in a hand.
- A **SOURCE** object appears on the table when a `tool_calls` row records ALLOW.
  Its width is **the bytes the gateway returned**, and it is labelled with the
  actual path.
- The **OBSERVATION** beside it has a **torn edge when it was clipped.** A world
  that hides a truncation is lying about what the model saw.
- **EVIDENCE MOTES** — one per `evidence` row, collected into the vault. Hard and
  faceted; they refract, they do not glow.
- **CLAIMS** — a FACT is a mote **tethered to its evidence**; a HYPOTHESIS floats
  **untethered.** You can see at a glance which beliefs are backed. This is LAW 4
  rendered rather than described.

---

## 7. Build environment

Specification → work → artifact → test → verified output.

- The **SPECIFICATION** is pinned at the back of the cell with its conditions as
  **unfilled gauges**, visible from outside the cell. An unmet bar is a fact
  about the room.
- The Builder's plates part; the artifact forms between them as a slab.
- **The artifact's face pattern is a deterministic function of its sha.** Same
  artifact, same face, always. A revision is therefore a *different object*, not
  a repainted one — which is exactly what the data says, since a correction
  produces a new row with a new hash.
- **WRITE_ARTIFACT → `build/` only.** The Researcher's identical capability
  writes elsewhere. Same tool, different scope, so the two are not
  interchangeable — and the two stations are in different rooms.
- The rejected first attempt **stays in the room.** A world that removes its
  failures is a world you cannot audit.

---

## 8. Review environment

- The Reviewer receives **the artifact and nothing else.** The room has **no
  window onto the build cells**: the producer's reasoning is not available here,
  only what was handed over.
- The **declared bar** stands on the wall — the Reviewer judges against
  conditions set before the work started, not against taste.
- **FINDINGS are marks on the artifact's own face**, each anchored to the
  requirement it failed. Not a comment in a list beside it.
- Two exits, and only two: the **return lane** (clay) and the **dock** (sage).
- The room contains **no write station**, which is visible. It cannot edit what
  it is judging.

---

## 9. Operations environment — and one honest limitation

The Operator's yard is a containment pad with a marked boundary.

**The enclosure is drawn as an open frame, never as a sealed vessel.** We do not
have OS-level sandboxing; `EXECUTE_SANDBOX` is a subprocess under the same user.
A containment field would imply a guarantee that does not exist, and the world
must never visually imply an action or a property that is not real. An open
frame says "this is a marked boundary" — which is the truth.

When real isolation exists, the frame closes. The visual change *is* the
security change, and until then the picture stays honest.

---

## 10. Visual depth, palette, and the prohibitions

**Palette.** Cool ground, warm structure — that opposition is what makes a grey
massing model read as *lit* rather than as cardboard.

| Token | Value | Use |
|---|---|---|
| `ground` | `#0D1217` | the dark table |
| `plate` | `#141B23` | the world's base |
| `structure` | `#C9CDD2` key → `#3A424C` shade | every building, unlit |
| **`accent`** | `#5FD4C4` | **work is happening. Nothing else, ever.** |
| `amber` | `#E0A44C` | blocked · a decision is owed |
| `clay` | `#D9736F` | failed · rejected |
| `sage` | `#7CC48F` | verified · accepted |
| `violet` | `#A98CE8` | under judgement |

**Saturated colour only ever means state.** Semantic colour is separate from the
accent and is never spent on decoration.

**Forbidden, explicitly:** neon rim-light on static geometry; glow on anything
that is not emitting; grid floors with horizon glow; holographic scan-lines;
chromatic aberration; lens flare; HUD brackets on every object; any ambient
particle system. Each of these is the cyberpunk slide, and each one breaks the
rule that brightness is attributable.

---

## 11. Digital material language

Every domain object gets a form and a material. This is what stops "Artifact #17"
from being a card with a number on it.

| Object | Form | Material | Carries |
|---|---|---|---|
| **Agent** | core + frame + field | instrument metal; only the core emits | identity, role, state |
| **Project** | a plot with a stele | cut stone, matte | the objective, always readable |
| **Artifact** | a slab with a fingerprint face | dense frosted glass; **face = f(sha)** | name, sha, producer |
| **Evidence** | a small faceted mote | clear and hard — refracts, never glows | source path, collector |
| **Task** | a folded docket | matte paper | objective + conditions as gauges |
| **Tool** | a fixed station, **bolted down** | machined steel | the capability name |
| **Memory** | an inscribed band on the agent's own frame | etched, subtractive | scope, kind |
| **Review** | a stamp applied to an artifact's face | ink — additive, permanent | verdict, rationale |
| **Failure** | a struck slab on the project plot | fractured glass, unlit | task, reason |
| **Decision** | an upright post, lit amber | **the only object that emits without a lease** | the open question |

---

## 12. Project spaces

A project is a **plot** — bounded ground with an address — not a card.

It holds: a **stele** with the objective (always readable), **team berths** (one
per member, occupied or empty), an **artifact shelf** that accumulates, an
**evidence locker**, a **findings wall**, **failure markers** (permanent), a
**decision post**, and a **spend meter** on the stele.

| State | Appearance |
|---|---|
| IDLE | low light, berths empty, no thread to the Works |
| RUNNING | a lit thread runs plot → its live cell; berths occupied |
| BLOCKED | the thread is present but its travelling highlight **stops moving**; an amber post rises |
| UNDER REVIEW | the thread redirects to Inspection; violet |
| FAILED | a struck slab is placed; the thread drops; the ground is marked |
| COMPLETED | artifacts move to the output shelf; the plot goes quiet but the record stays |

A project's tasks are physically *in* the Works. The plot is where the project's
history lives; the building is where its work happens. The thread between them is
the only thing that moves.

---

## 13. Owner Control Center

**The Observatory** — a raised platform **off the plate**, across a gap of dark
ground. The Owner is not an agent and does not stand in the organisation.

Not a dashboard grid. An **instrument rail**: a curved console whose readouts are
*sightlines into the world*. Each instrument is aimed at what it reports, and
clicking one takes the camera there.

The eight required exposures:

| Instrument | Points at |
|---|---|
| WHAT'S NEW | an incident tape: events since you last looked, each traceable to its place |
| DISCOVERIES | the intake yard, from above |
| OPPORTUNITIES | proposed-but-unapproved forms standing in the yard |
| PROJECTS | the plot map |
| ARTIFACTS | the output shelf |
| REVIEWS | the findings wall |
| FAILURES | the struck slabs |
| **DECISIONS** | the lit posts — **the only instrument that glows**, because only a decision is owed by the Owner |

**The anti-SaaS rule: every number is a sightline, not a tile.** You never read a
figure without being able to go to the thing behind it. "While you were away"
stays — the world remembers when you last looked, and the tape starts there.

---

## 14. World states — what motion is allowed to mean

| Event | Visual consequence |
|---|---|
| task created | a form appears in the intake yard |
| task approved | the form opens; conditions are placed on the design floor, unfilled |
| agent assigned | the agent translates to the workspace; thin cool ring |
| **lease acquired** | **the field warms, the frame opens, a light pool appears on the ground** |
| tool call | a beam to the bolted station; one pulse; the iris opens or the plates part |
| observation returned | a packet travels station → field; the source object appears on the table |
| artifact created | a slab forms between the plates, its face set by the sha |
| verification runs | the artifact travels to Test; gauges fill or do not |
| review begins | the artifact travels to Inspection; the Reviewer's calipers close; violet |
| **review rejected** | **marks appear on the face; the artifact travels the return lane in the open; the project plot is struck** |
| correction | a *new* slab forms in the cell — never an edit to the old one |
| review accepted | marks clear, gauges lit, the artifact leaves by the dock |
| task completed | the agent's ring closes and releases once; it returns home; the cell goes dark |

### Motion rules

1. **Nothing moves unless a row changed.** Position is a pure function of state.
2. **No idle animation of position.** The only permitted ambient motion is the
   core's slow luminance breath (identity is alive, not busy) and the Operator's
   rotor — **and the rotor turns only while an execution is live.**
3. Every motion is a transition between two rest states: 600–900ms, decelerating.
4. **No pathfinding, no walking.** Entities hover and translate along drawn
   lanes. Lanes are infrastructure, not routes discovered at runtime.
5. Motion is replayable from a state diff, and there is no motion without one.
6. **A world loading mid-flight resolves instantly to the truth and does not
   animate into place.** Animating a load would stage activity that is not
   happening. Only deltas that occur while watching are animated.
7. Light is the primary activity signal, and light only comes on for a lease.

---

## 15. World navigation and zoom

| Z | Name | Drawn | Aggregated |
|---|---|---|---|
| **Z0** | **ORBIT** | districts as lit mass; **no individual agents** | agent counts; activity = total lit area |
| **Z1** | **DISTRICT** | facilities with form; agents as points of light | tasks per facility |
| **Z2** | **FACILITY** | **the roof comes off** — workspaces, cells, agents with frames (this is where Direction B is used) | artifact detail |
| **Z3** | **WORKSPACE** | full detail: artifacts, evidence, gauges, marks, sha | nothing |
| **Z4** | **INSPECTOR** | not spatial — the record itself, with the provenance spine | — |

Controls: fit-world, frame-a-district, wheel zoom, drag pan, and `?focus=` /
`?open=` deep links so any view can be linked, captured and compared. Selecting
an entity frames it and desaturates the rest.

---

## 16. Scaling: 5 → 20 → 100 → 1,000+

`WORLD → DISTRICTS → FACILITIES → WORKSPACES → AGENTS → TASKS → ARTIFACTS`

- **The Works grows by repeating cells**, not by cramming one. Past a threshold
  it grows by repeating *Works* — a second building, a third.
- **A district is the unit of ~100.** Self-contained Works + plots + crew. A
  thousand agents is a city of districts, not an impossible building.
- **At Z0 no agent is ever drawn.** 1,000 agents is not 1,000 sprites; it is a
  city where some blocks are bright. Brightness is a `COUNT`, not a crowd.
- **Hard culling rule:** anything below ~8px of screen area is not drawn
  individually and contributes to its parent's aggregate instead. This is what
  keeps the map readable, and it is not negotiable at scale.
- **Every aggregate is a real aggregate** — `COUNT` over rows, never sampled,
  never estimated, never smoothed.

---

## 17. Future embodiment

```
DIGITAL IDENTITY  → CORE    the principal row, contract, memory. Permanent, portable.
DIGITAL EMBODIMENT→ FRAME   the role geometry in this world.
SOFTWARE CAPABILITY→ the stations it may approach (permission_scope).
PHYSICAL EMBODIMENT→ a DIFFERENT FRAME bound to the same CORE, plus a physical site district.
```

**Identity is never drawn as its body.** The inspector shows CORE attributes; the
world shows FRAME. An agent that gains a physical body gets a second frame and a
second location — and "this identity, that embodiment" is a row, like everything
else.

Three things must be true now, and all three cost nothing:

1. **FRAME is data-driven** — an `agents.form` value, not a hardcoded map keyed
   by agent id. *The current implementation violates this:* `world.js` has
   `FORM["AGT-ORCHESTRATOR"]` as a literal. It must not be carried forward.
2. **FIELD is independent of FRAME** — the state machine knows nothing about
   which body it is decorating.
3. **Position is independent of both.**

Do not implement robotics. Just do not build the thing that would have to be
torn out.

---

## 18. Reality boundary

Every element is classified. This table is the contract.

**TIER 1 — REAL PERSISTED STATE.** A row exists; the visual is a lookup.
Agent existence, identity, contract, grants · station and position · lit/working
(an ACTIVE lease) · which tool stations exist per agent · each tool-use pulse and
its decision · artifacts, their sha, their producer · evidence motes and sources
· claims tethered or not · gauges filled or not · review marks and verdicts ·
failure slabs · decision posts · every count, spend and timestamp.

**TIER 2 — VISUAL PROJECTION.** A deterministic, *tested* function of Tier 1 that
adds no information. Status → station · world coordinates of a station · which
lane an object travels · LOD aggregation · the sha → face-pattern mapping ·
camera framing. **Every Tier 2 function gets a test, exactly as `task_station`
has now.**

**TIER 3 — DECORATIVE ENVIRONMENT.** Carries no information; removable with zero
loss. Plate edge and plinth · structural members, canopy ribs, railings · the
lighting rig itself · atmospheric falloff · the Observatory's console housing.

### The prohibitions

- Tier 3 may never use the accent or any semantic colour.
- **Tier 3 may never move.**
- No element may imply an action that did not happen: no "thinking" animation, no
  in-progress shimmer on an unleased task, no anticipatory motion.
- **Absence must be visible.** An empty vault, an empty intake yard, a dark cell.
  A quiet world must look quiet — not asleep-but-decorated.
- Where a guarantee does not exist, the visual must not imply it (§9).
- **Every element must be able to justify itself.** On inspection, any mark
  states its tier and the row it came from. This is the existing `reason` field
  generalised from placements to the whole world.

---

## 19. Concept boards

In `design/boards/` — HTML sources and PNG renders, produced by
`design/concept_render.py`.

| Board | Shows |
|---|---|
| `A-world` | the full World |
| `B-works` | the Factory, with its ten spaces and the return lane |
| `C-research` | the Research workspace |
| `D-build` | the Build workspace |
| `E-review` | the Review workspace |
| `F-entities` | the five entities, their frames, and the full state matrix |
| `G-observatory` | the Owner Control Center |
| `H-directions` | the three directions compared, with verdicts |

**These are exploration, not production.** They are hand-authored massing studies
with invented contents; every figure in them is a placeholder. The renderer must
never become the World UI — its value is that the spatial language was tested
before anything was built against real state.

---

## 20. What this does not answer

1. **Text legibility in an axonometric world.** Labels are billboarded and
   auto-placed into gutters in the boards; at Z3 with dense content this needs
   its own study.
2. **Performance.** CSS 3D with hundreds of volumes is untested. The topological
   depth sort is O(n²) and fine for ~50 objects; at Z0 with a city it is not, and
   LOD culling has to run before the sort rather than after.
3. **Accessibility.** A world where meaning is carried by light and position is
   hostile to screen readers and to low-vision users. The record view (Z4) is the
   accessible surface and must stay complete enough to be the *only* surface if
   needed. This is a requirement, not a footnote.
4. **Colour-blind safety.** Amber/clay/sage carry distinct meanings and are not
   separable by all viewers. Each semantic state needs a second, non-colour
   channel — the broken ring already does this for FAILED; the others need it too.
5. **The empty world.** A brand-new world is entirely dark. That is honest and it
   may be unusable as a first impression. It needs a deliberate answer that is
   not "add decoration".

---

## Stop condition

Design only. Nothing implemented, no model run, no calibration, no benchmark, no
new agents, no deployment, and `civ/world_ui/` unchanged.
