# Agent World — Visual Specification

The build sheet. Rationale and alternatives are in
[`AGENT_WORLD_VISUAL_ARCHITECTURE.md`](AGENT_WORLD_VISUAL_ARCHITECTURE.md);
this is what you implement. **Not implemented yet. `civ/world_ui/` is unchanged.**

---

## 1. Camera

```css
.stage { transform-style: preserve-3d;
         transform: perspective(2600px) rotateX(56deg) rotateZ(-38deg) scale(var(--k)); }
```
Pan translates the ground plane; zoom sets `--k`. The plate is **finite with a
visible edge**. Never an infinite grid.

**Draw order is a topological sort, not a depth number.** `A` before `B` when
`A.x1<=B.x0 || A.y1<=B.y0 || A.z1<=B.z0`. Kahn's algorithm; tie-break on centre
depth; cycles fall back to centre depth and are never dropped. Reference
implementation: `design/concept_render.py::Scene._order`.

## 2. Tokens

```
--ground:#0D1217  --plate:#141B23  --structure:#C9CDD2  --structure-shade:#3A424C
--accent:#5FD4C4    work is happening — NOTHING else
--amber:#E0A44C     blocked · decision owed
--clay:#D9736F      failed · rejected
--sage:#7CC48F      verified · accepted
--violet:#A98CE8    under judgement
```
Face shading from one key: top `×1.06`, near face `×0.52`, far face `×0.27`.
Saturated colour only ever means state.

## 3. Entity

`CORE + FRAME + FIELD`, inline SVG, billboarded, hovering.

- **FRAME comes from `agents.form`** — a column, never a map keyed by agent id.
- **FIELD** knows nothing about which frame it decorates.
- **Position** is independent of both.
- Scale ≈ 1:6 against facility height. Orchestrator 1.15× and higher hover.

Frames: Armature (open cage, five anchors, **no manipulator**) · Aperture (iris +
focal stem) · Assembly (strata on a spine) · Gauge (opposing calipers) · Rotor
(driven ring, **sealed** core).

| State | Field | Frame | Core | Pos |
|---|---|---|---|---|
| IDLE | none | rest | dim breath | home, low |
| ASSIGNED | thin cool ring | rest | steady | workspace, low |
| WORKING | warm ring + **ground light pool** | open | bright | raised |
| TOOL | beam to station, one pulse/call | opens | flash | — |
| REVIEW | violet ring | — | — | waits |
| BLOCKED | amber, **static** | caught | dim | drops |
| FAILED | **ring broken** | slack | dark | drops |
| COMPLETED | ring closes, releases once | rest | steady | home |
| SELECTED | light shaft; world desaturates | — | — | framed |

Stillness is BLOCKED. A broken ring is FAILED — both readable without colour.

## 4. Spatial model

```
INTAKE → RESEARCH HALL → DESIGN FLOOR → BUILD CELLS → TEST BENCH → INSPECTION → OUTPUT DOCK
            EVIDENCE VAULT                                              └─ RETURN LANE ─→ BUILD
                                   ARCHIVE (sunken)
```
Hard constraints the plan must enforce:
- **No path from a build cell to Inspection except through Test.**
- **Inspection has no write station.**
- **The return lane is in the open.**
- **Tool stations are bolted down.** Agents travel to capability.
- The Works grows by **repeating cells**, then by repeating Works.

Projects are **plots** off the line: stele (objective), berths, artifact shelf,
evidence locker, findings wall, failure markers, decision post, spend meter. A
lit thread connects a plot to its live cell; when BLOCKED the thread's travelling
highlight **stops**.

Owner **Observatory** sits off the plate. Eight instruments, each a **sightline**
(click → camera goes there), not a tile. Only DECISIONS glows.

## 5. Motion

1. Nothing moves unless a row changed.
2. Ambient motion is only: core luminance breath, and the Operator rotor **while
   an execution is live**.
3. Transitions 600–900ms, decelerating, between two rest states.
4. No pathfinding, no walking. Hover + translate along drawn lanes.
5. **A world loading mid-flight resolves instantly and does not animate into
   place.** Only deltas seen while watching animate.
6. Light comes on for a lease and nothing else.

## 6. Zoom / LOD

| Z | Drawn | Aggregated |
|---|---|---|
| Z0 ORBIT | districts as lit mass, **no agents** | counts; activity = lit area |
| Z1 DISTRICT | facilities; agents as points | tasks per facility |
| Z2 FACILITY | **roof off** → section view; agents with frames | artifact detail |
| Z3 WORKSPACE | everything: slabs, motes, gauges, marks, sha | — |
| Z4 INSPECTOR | the record + provenance spine (not spatial) | — |

**Cull below ~8px of screen area** into the parent aggregate. Culling runs
*before* the depth sort. Every aggregate is a real `COUNT`.

## 7. Materials

| Object | Form | Notes |
|---|---|---|
| Artifact | frosted slab | **face pattern = f(sha)**, deterministic |
| Evidence | faceted mote | refracts, never glows |
| Task | docket + gauges | gauges = declared conditions |
| Tool | bolted station | never carried |
| Memory | etched band on the frame | subtractive |
| Review | stamp on the artifact's face | additive, permanent |
| Failure | struck slab on the plot | kept forever |
| Decision | upright post | **only non-lease emitter** |

Only three things emit: an agent core, a working agent's field, a decision post.

## 8. Reality boundary

- **Tier 1** — a row exists; the visual is a lookup.
- **Tier 2** — a deterministic function of Tier 1 that adds no information.
  **Every Tier 2 function gets a test**, as `task_station` has now.
- **Tier 3** — decorative; removable with zero loss.

Rules: Tier 3 never uses accent or semantic colour · **Tier 3 never moves** ·
nothing may imply an action that did not happen · **absence must be visible** ·
where a guarantee does not exist the visual must not imply it (the Operator
enclosure is an **open frame**, not a sealed vessel) · every mark can state its
tier and its source row.

## 9. Build order

1. Camera + finite plate + topological depth sort. *Gate: occlusion is correct.*
2. Entity system from `agents.form`; the state table; no positions yet.
3. `world_stage` extended to 3D coordinates. **Tests first** — this is Tier 2.
4. The Works, as static architecture.
5. Bind Tier 1: leases → light, tasks → stations, artifacts → slabs.
6. Motion, under §5. *Gate: a mid-flight load animates nothing.*
7. Plots, then the Observatory.
8. LOD + culling. *Gate: 1,000 synthetic agents stay readable at Z0.*

## 10. Open, before Z0 is attempted

Text legibility at Z3 · CSS-3D performance and the O(n²) sort at city scale ·
**accessibility — Z4 must be complete enough to be the only surface** ·
colour-blind safety: every semantic state needs a second non-colour channel (the
broken ring does this for FAILED; amber/clay/sage do not yet) · what a brand-new,
entirely dark world should look like, without reaching for decoration.
