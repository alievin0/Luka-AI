# The embodied world

An agent in this world has a body. Not an icon standing in for one — a physical
identity with proportions, a finish, a seat it holds and a stance that comes
from what it is actually doing.

The body is **not** the intelligence. Nothing in the rendering layer reads a
task, decides an activity, or moves anybody. The chain runs strictly one way:

```
AGENT RUNTIME  ─ does the work, writes rows
      ↓
AGENT STATE    ─ tasks, leases, tool_calls, reviews, messages
      ↓
EMBODIMENT     ─ agent_bodies · workstations · agent_locations · movements
      ↓
3D WORLD       ─ reads the embodiment and draws it
```

Every arrow is one-directional. The renderer is a reader; there is no path from
a mesh back to a row.

---

## What is persisted

### `agent_bodies` — one identity, one body

| column | what it is |
|---|---|
| `principal_id` | the agent this body belongs to (primary key) |
| `body_id` | `BODY-0001`… — the body's own name |
| `seed` | `sha256(principal_id)`, the derivation the design came from |
| `body_variant` `head_variant` `chest_variant` `sensor_variant` | which frame, optics, chest plate and sensor fitting |
| `build` `height` | slim / standard / heavy, and metres |
| `palette` `primary_color` `secondary_color` `accent_color` `material` | the finish |
| `marking` | the two-letter/two-digit mark carried on the chest |
| `equipment` | what the role makes this body **carry** |

The appearance is **derived once** from `sha256(agent_id)` and then written
down. After that the row is the authority, not the function — so changing the
palette table never restyles an agent that already exists.

**LAW 43** refuses `UPDATE` and `DELETE` on this table. An identity that could
be redesigned would not be an identity, and an agent that changed shape when a
task failed would not be the same agent.

### `workstations` — one seat, one agent

| column | what it is |
|---|---|
| `id` | `ws_lab#3` — a specific desk, not the fourth rectangle |
| `workspace` `seat` | which room, and which seat in it |
| `x` `y` `facing` | where it is and which way it points |
| `kind` | `desk` · `bench` · `console` · `frame` · `shelf` |
| `capability` | what the room it stands in is **for** |
| `occupied_by` | who holds it, claimed by a guarded `UPDATE` |

A room is fitted to its own capacity, deterministically. The `kind` comes from
`open_world.WORKSPACE_CAPABILITY` — which is the *same table* that decides where
a task goes, read backwards. So a build cell gets benches because building
happens there, not because a renderer decided benches look good in cells.

**LAW 44** has two halves: an agent holds at most one seat anywhere, and a seat
cannot be handed to a second agent without being released first. The second half
matters more than it looks — `occupied_by` holds one value, so an unguarded
write would silently evict the sitting agent and leave it standing at a desk it
no longer holds.

A held station outranks a spread-out slot, so `world_space.slot` returns the
working side of an agent's own desk. There is still exactly one authority for
where anybody is: `agent_locations`.

---

## Activity is derived, never invented

`embodiment.activity_of` is the whole of it. Every branch names the row behind
its answer, and the answers it can give are:

| state | the row that produces it | animation |
|---|---|---|
| `WALKING` | `agent_locations.movement = MOVING` | `walk` |
| `USING_TOOL` | a `tool_calls` row with `decision='ALLOW'` under a live lease | `type` |
| `RESEARCHING` `BUILDING` `REVIEWING` `OPERATING` `COORDINATING` | a live lease, activity from the task's own capability | `read` `assemble` `inspect` `operate` `direct` |
| `BLOCKED` | an assigned task with status `BLOCKED` | `blocked` |
| `REWORK` | an assigned task with status `FAILED` | `rework` |
| `WAITING` | assigned, not yet leased | `wait` |
| `IDLE` | holds no lease | `idle` |

There is **no animation for looking busy**. With no lease, no tool call and no
message, the world reports `IDLE / idle / "holds no lease"`, every workstation
screen is dark, and every body stands still. That is the correct picture of a
world with no work in it, and it is the one the renderer draws.

Two agents are shown conferring only when a real `agent_messages` row passed
between them **and** `agent_locations` puts them in the same room. A message is
a message; it is not a meeting.

---

## The body design system

One technological civilisation, one grammar:

- **6 body frames** — shoulder width, chest depth, waist, limb gauge, gait
  (straight / digitigrade / braced), height multiplier
- **5 optical systems** — wrapping visor, twin recessed optics, segmented array,
  dome, faceted aperture. Robotic, never a face: a face would be a claim about
  an inner life that nothing here supports.
- **4 chest plates** · **4 sensor fittings** · **16 industrial palettes** ·
  **3 builds**

**23,040 combinations** before equipment and height, from one grammar.

**ROLE IS EQUIPMENT, NOT COLOUR.** What a role changes is the module an agent
carries — a sensor boom and data slate, a forearm tool and back rack, an
inspection lamp, a comms module, a coordination ring. Two researchers do not
share a palette, because a palette is an identity and a role is a job.

Geometry: every visible part is a chamfered slab, a capsule, a ball joint or a
curved shell. No bare boxes, no bare cylinders, no emoji, no placeholder
humanoid. The chamfer is doing most of the work — a bevelled edge catches a
highlight, and a highlight is what tells the eye "metal".

`/bodies` is the registry: every identity, its body, its stored configuration,
and the three detail tiers side by side.

---

## Movement

`world_space` already owned position, routes and the movement state machine
(LAWS 30–35). Embodiment adds the part the renderer needs:

- **`waypoints(agent)`** turns `agent_locations.path` into coordinates, entering
  each building through its own **doorway** rather than through a wall. It adds
  no leg the world did not plan — it only says where the planned legs are.
- **`navmesh()`** says what the ground is: rooms are the walkable islands,
  facilities are obstacles to anyone not going inside, doorways are the way in.

The renderer walks those legs at a steady pace, so a long journey takes longer
than a short one. It never picks a destination; `move_to` still demands a reason
and a cause, and refuses to send anyone towards finished work.

`waypoints` is the route that **remains**. Both thresholds are included — the
doors out of the building an agent is leaving and the doors into the one it is
entering, because the route is planned district to district and the legs that
actually cross a wall are the first and the last. A door the agent's recorded
position has already passed is dropped, and two rooms of one building are
reached along its corridor rather than by going outdoors and back in.

Between two polls a body walks only the part it actually covered: the renderer
keeps the previous route and takes the prefix that has since disappeared from
it. That difference is exact, so no body is ever sent on a round trip to the end
of its route and back.

An agent's floating identifier is the mark its own body carries — `RE-49 ·
Researcher · Rework` — and it stays small. A body you can recognise does not
need a banner, and a world of banners is a world you cannot see.

Separation between agents is a property of the **data** — stations, room
capacity and `slot` — so the renderer never has to push two bodies apart. A test
asserts no two agents at rest are within 0.9 units of each other.

---

## Rendering at scale

Three detail tiers, switched on camera distance:

| tier | distance | what it draws |
|---|---|---|
| `near` | < 26 | everything: equipment, badge, gripper fingers, panel seams |
| `mid` | 26–60 | role equipment stays, geometry coarsens |
| `far` | > 60 | silhouette only — build, height and palette |

Parts that move together are welded into one mesh per material when the body is
built, stopping at the rig boundary so joints still bend. A `far` body is welded
whole and shares materials: at sixty metres an arm swing is under a pixel, and a
body that cannot articulate is the correct thing to draw there.

Measured in this environment, with the renderer's own counters
(`window.__w3d`, a read-only test seam), under **software rasterisation**
(headless Chromium + SwiftShader — there is no GPU here, so the frame rates
below say almost nothing about real hardware and are reported only because they
are what was actually observed):

| bodies drawn | draw calls before welding | after | triangles |
|---|---|---|---|
| 5 | 164 | 164 | 3,774 |
| 105 | 6,222 | 4,447 | 1.03 M |
| 405 | 23,394 | 10,334 | 2.48 M |
| 1,005 | 56,523 | **14,130** | 4.19 M |

**Those are bodies, not agents.** Five agents exist. The extra bodies are clones
of real appearances with no identity, no row and no state, living in their own
group, gone the moment the measurement ends — a measurement of what the renderer
can carry, never a claim that a thousand agents are running. The harness cannot
reach the database and a test asserts it.

---

## What is real, and what is not

**Real:** the bodies, the seats, the positions, the routes, the doorways, the
derived activity, every law, every refusal. All of it survives a restart because
it was written down — reopen the database and the same agent comes back in the
same seat wearing the same body, and `found_agents` run again changes nothing.

**Not simulated at all:** there is no ambient behaviour, no idle wandering, no
background chatter, no decorative motion. When the world has nothing to do it
looks like a world with nothing to do.

**Not claimed:** none of this is consciousness, sentience or experience. A body
is a rendering of persisted state. It says where an agent is and what it holds,
and nothing about what it is like to be one.

---

## Running it

The world is a server; this page describes what its inhabitants look like. To
start the world itself see [`AGENT_WORLD_SERVER.md`](AGENT_WORLD_SERVER.md).

```
python3 worldd.py start --db world.db   # the world, as a process
python3 embodiment_demo.py --fresh      # the whole chain, printed from its rows
python3 test_embodiment.py              # 52 tests
python3 world_server.py --db embodied-world.db --port 8790
#   /3d       the world
#   /bodies   the agent registry
```

`civ/world_ui/three/shots/E1…E10` are the acceptance screenshots: campus,
district cutaway, a furnished floor, a body at arm's length, the build cell,
the dispatch floor, inspection, the registry, 405 bodies under stress, and an
agent actually in transit with its route drawn.
