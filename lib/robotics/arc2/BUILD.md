# ARC-2 — Engineering Build Plan

> ## STATUS: C4 (pass-budget) is **KILLED**. 2026-09-18.
>
> The build target below did not survive its own kill test. It was refuted on
> paper, before any part was bought, which is what the kill test was for.
>
> **1. The motivating failure is not a multi-pass failure.** Spirit "broke
> through a thin sulfate-rich soil crust and became embedded in an underlying
> mix of sulfate and basaltic sands" — a buried layer boundary hit once, not a
> rut deepened by repetition. A power law in pass number cannot predict a
> discontinuity. The example that motivated the idea argues against it.
>
> **2. Pass number is the wrong independent variable.** Sinkage is driven
> dominantly by slip — published slip-sinkage work puts sinkage at slip 0.6 at
> 3–7× static. With slip free, `a` is not a soil property, it is an unrecorded
> slip history in disguise, and it is not identifiable.
>
> **3. Direct measurement already does it, and has flown for twenty years.**
> MER Visual Odometry slip checks and keep-out zones resolve 2 mm and slip to
> 125 %. The literature's own recommendation is that slip ratio and sinkage are
> the immobility indices. No fitted exponent required.
>
> **4. Slip-triggered morphology switching is published.** *Choosing the Best
> Locomotion Mode in Reconfigurable Rovers* (Electronics 8(7) 818, 2019) has a
> reconfigurable rover reactively choosing its locomotion mode from an estimated
> slip ratio; the push–pull follow-up (J. Terramechanics, 2023) delineates the
> terrain and slope ranges where each mode wins. That is the core of C5 too.
>
> **5. The rig could not have measured it.** δa ≈ √2·(δz/z)/ln(1.5) from passes
> 2 and 3. A 10 mm first-pass rut needs δz ≤ 0.2 mm for δa = 0.05; the specced
> ±5 % ToF gives ≈ ±5 mm and so δa ≈ 0.9–1.5 on a parameter that lives in
> [0, 1]. Twenty-five times too coarse.
>
> **C5 is killed with it** — it was conditional on C4 returning a number, and
> its decision boundary is the published one above.
>
> **Do not buy the BOM below.** It is left in place as the record of what was
> specced, including the two errors worth remembering: the ToF that could not
> resolve the quantity, and a handheld ASABE penetrometer listed as if it were
> an onboard instrument when it measures soil strength by hand and can never be
> on the robot.
>
> Everything below this line is the plan as written **before** the kill test.
> It is kept unedited so the reasoning can be audited, not because it stands.

---


Not an audit. The one thing this document has to do is get a physical
experiment specified well enough that somebody can order the parts.

**Research access, stated first.** External search worked; `WebFetch` and direct
`curl` to every research and vendor domain were refused by this environment's
egress proxy (`arxiv.org`, `robotics.jpl.nasa.gov`, `nature.com`,
`sciencedirect.com`, `projectchrono.org`, vendor stores — all blocked). So every
source below was read as a **search-engine summary with quoted passages, not as
a full paper**. That is a real limitation on all of it and it is repeated in each
row. Any number here that matters should be checked against the paper before it
is built on. GitHub was reachable and was used directly.

---

## 0. Sources

| Source | Claim | Relevance | Limitation |
|---|---|---|---|
| ESA, ExoMars Rosalind Franklin wheel-walking (esa.int; phys.org 2021-12) | 6×6×6 rover with wheel-walking — deployment actuators combined with wheel rotation — escaped a sand trap with its front two wheels almost completely buried; ~2 m in ~20 min | **Morphology-based rut escape is built and demonstrated.** Kills "escape from a self-made rut" as a novel capability | Search summary only. Found no published quantitative comparison against a wheels-only baseline, and no claim that the mode is *triggered autonomously* |
| Creager, Johnson, Plant, Moreland, Skonieczny, *Push–pull locomotion for vehicle extrication*, J. Terramechanics, 2015 (NTRS 20150000897) | Inch-worming drove an entrapped vehicle out of its ruts at roughly **50 % of the entrapped sinkage**; less sinkage, lower travel reduction and better power efficiency than rolling in high-sinkage material. Tested on JSC-1a lunar simulant | Second independent prior art for articulated-morphology extrication, with numbers | JPL PDF egress-blocked; read via summary. Lunar simulant, one vehicle |
| Calleja-Huerta, Lamandé, Munkholm, *Soil & Tillage Research* 233 (2023) 105791 | On moist loamy sand under a lightweight autonomous field robot: **air permeability after the 10th pass ≈ 5× lower than after the 1st**; structural damage appears between the **6th and 10th** pass; a single pass with +400 kg was **never significantly different from five passes without it** | The strongest quantitative statement found that **pass count dominates load**. This is the effect the whole build targets | One soil, one machine, short-term, single site |
| *Impact of vertical load, multiple passes, and speed on rut depth*, Sci. Rep. 15 (2025) s41598-025-13535-w | Multiple passes the second most influential factor on rut depth (delta 5.71); **the first pass's share of total rut depth falls as vertical load rises** | Says the accumulation exponent is **not a constant even for one soil** — so it must be measured in situ, not looked up | Agricultural tyres and tracks at 2–4 kN, an order above a small robot wheel |
| Deep probabilistic traversability, Sci. Rep. (2026) s41598-026-40109-1; SlipNet (arXiv 2409.02273) | "Slip prediction for daily tactical planning is **a manual process on Earth**, where rover operators visually identify the terrain type and estimate slip from slope-vs-slip curves" | Names the gap precisely: the prediction exists, the **robot** does not make it | About slip on slopes from terrain appearance — not about ground the robot itself has already damaged |
| Spirit at Troy (JPL; Planetary Society; Arvidson et al., JGR Planets 2010) | Embedded 23 Apr 2009. **Eight months** of Earth-based simulation, a 2.7 t "dustbin" of diatomaceous earth and fire clay, two testbed rovers; extrication commanded from Earth; mission declared over 25 May 2011 | The cost of getting this wrong, and proof the decision was human and offline | n = 1, and Spirit had only five working wheels |
| Controlled Traffic Farming (soilquality.org.au; ACTFA; Virginia Tech BSE-374) | Confine all traffic to permanent lanes — trafficked area **≤ 12 %** of the field; CTF wheat yields **13 %** above no-till, canola 11 %, lupins 10 % | **The baseline any traffic-planning capability must beat** | Needs RTK guidance and matched track widths; high capex; an open-loop geometric policy that measures nothing |
| Compaction economics, IOP Environ. Res. Lett. (2025) ae7c8d | Compaction-induced cost in Europe ≈ **€7 ± 0.3 bn/yr** in crop yield, €5 ± 0.5 bn in carbon, €2.7 ± 0.3 bn in nitrogen. Yield losses across studies 9–55 %, median **21 % for two years** after wheel traffic | The mission that has been missing from this project since `MISSION INPUT REQUIRED` | Europe-wide modelled estimate, not a measurement |
| Chrono SCM docs (api.projectchrono.org, vehicle_terrain / terrain_synchronization) | Deformed nodes are kept in a hash map with their current height; multiple vehicles "interact with ruts and deformation created by each other" | **SCM retains rut geometry between passes** — it can host this experiment | Retains node *height*. Whether it hardens the soil pass-over-pass the way real soil does is exactly what the rig has to check |
| ForEnt (arXiv 2606.19675) | Quadruped entrapment dataset; entrapment windows isolated where the error between commanded and estimated forward velocity exceeds a threshold | Same detector family this repository already has in `core/conflict.ts` | Forest, quadruped, and detection **after** entrapment |

---

## 1. Capability candidates

Five, and the first three are dead on arrival — recorded so they are not
re-proposed.

### C1 — Escape a self-made rut by changing morphology · **KILLED (prior art)**
ExoMars wheel-walking and JPL push–pull both do this, both are built, one has
flown hardware. No claim here.

### C2 — Predict slip from terrain appearance · **KILLED (prior art)**
Active field with better funding and better data than this project will have.

### C3 — Measure rut depth with a leg used as a probe · **KILLED (beaten by a sensor)**
A downward time-of-flight sensor behind the wheel measures rut depth directly
for a few tens of dollars. This project's own rule — a capability an ordinary
sensor beats does not get built — kills it. The leg's value cannot be sensing.

### C4 — **Pass-budget from the robot's own first passes** · **THE BUILD TARGET**

| | |
|---|---|
| **Input** | Rut depth under its own wheel after each pass over the same ground, plus wheel load and slip. All proprioceptive or near-field; no terrain classifier, no map, no RTK |
| **Mechanism** | Fit `z_N = z_1 · N^a` in situ from the first 2–3 passes. `a` is a property of that soil at that moisture and cannot be looked up |
| **Effect** | The robot predicts the pass at which sinkage reaches belly clearance — and then has a reason to reroute, offset, or change morphology **before** it is stranded, rather than after |
| **Baseline** | (i) CTF: fixed lanes, confine damage, measure nothing. (ii) Drive until stuck, then extricate — ExoMars/JPL. (iii) Offline slip curves fitted on Earth |
| **Advantage** | CTF cannot adapt to soil that changed with rain, and needs field infrastructure. Extrication is a cure, not a warning. This is the only one of the three that produces a *number of remaining passes* from the machine's own traffic |
| **Experiment** | Single-wheel rig, one track, N passes without re-preparing the bed. Fit from the first *k*, compare to where the series actually reached the limit |
| **Hardware path** | Rung 1 of the ladder below. Needs no robot, no gait, no leg |

### C5 — Choose *where* the next pass goes · depends entirely on C4
Confine (CTF logic) versus spread versus place a contact on untrafficked ground
via leg mode. Cannot be posed as a decision until `a` is known to be
measurable, because the whole decision is a comparison of predicted damage.
**Not started until C4 returns a number.**

---

## 2. Prototype ladder

| Rung | What it is | Answers | Cost class |
|---|---|---|---|
| **1** | **Single wheel, dead-weight load, soil bin, N passes on one track** | Is `a` measurable, and does a fit from 2–3 passes predict the stranding pass with lead time? | Low — see BOM |
| 2 | Same rig, adjustable vertical load | Does `a` move with load, as Sci. Rep. 2025 implies for tyres? | + one actuator |
| 3 | Wheel plus one leg contact on the same carriage | Can a contact placed outside the rut change the accumulation, or only carry load? | + linkage, + second load cell |
| 4 | Two-contact carriage, load transfer between them | The load-sharing question the 2004 Grand result already governs | + control |
| 5 | Small tracked/wheeled rover, real field soil | Does any of it survive leaving the bin? | Vehicle class |
| 6 | ARC-2 | — | — |

Rung 1 is the only one being specified now. Rungs 2–6 are conditional on it.

---

## 3. Hardware BOM — rung 1

**Prices: one is verified, the rest are not.** Vendor sites are egress-blocked
from this environment, so exact part numbers and manufacturers are given and
price is marked `UNVERIFIED` where search did not return a figure. Do not treat
an unverified line as a quote.

| Item | Exact part | Maker | Price | Why |
|---|---|---|---|---|
| Cone penetrometer | SpotOn Digital Soil Compaction Meter, stock **76020**, 0.505″ cone, 0–825 psi / 0–5690 kPa, meets **ASABE S313.3** | Innoquest / Forestry Suppliers | **$449 — verified** | Bearing capacity per pass, to a written standard, so the result is comparable to the agronomy literature |
| Rut profile | **VL53L5CX** 8×8-zone ToF carrier, 400 cm, I²C — Pololu #3417, or SparkFun Qwiic ToF Imager | ST Microelectronics | UNVERIFIED | 8×8 zones give a rut *cross-section* per pass, not a single depth |
| Drawbar / rolling resistance | S-type load cell, 50 kg, + HX711 24-bit amplifier | generic | UNVERIFIED | Confirms the rut is costing what the model says |
| Wheel drive | Brushed gearmotor with quadrature encoder, ≥ 3 N·m at the wheel | e.g. Pololu 37D metal gearmotor | UNVERIFIED | Slip must be *commanded*, not observed, or passes are not comparable |
| Vertical load | Cast-iron slotted weights, class M1, 5–30 kg | generic | UNVERIFIED | Dead weight beats an actuator for v1: no force loop to go wrong, and load is known to the mass of the plate |
| Soil bin | 1.5 m × 0.3 m × 0.3 m, plywood with one acrylic side wall | build | UNVERIFIED | The acrylic wall is not cosmetic — it is how sub-surface deformation is seen |
| Soil | Washed quartz sand, 0.1–0.6 mm, plus a loam for a second series | local supplier | UNVERIFIED | Two soils, or `a` is a property of one bucket of sand |
| Moisture | Gravimetric: scale + drying oven, or a calibrated TDR probe | generic | UNVERIFIED | `a` without a moisture number is not reproducible |
| Logging | Raspberry Pi 4/5 or any Linux SBC with I²C | — | UNVERIFIED | Implements `SingleWheelRig` in `rig.ts` |

The rig needs **no linear rail and no closed-loop force control** at rung 1.
A hand-pushed carriage at constant slip with dead weight answers the question.

---

## 4. Simulator decision

**`NO SIMULATOR YET` — for the first experiment. Then `USE CHRONO`.**

The reason is not a preference between engines, it is circularity. The quantity
the whole capability turns on is `a`, the pass-accumulation exponent. A
simulator does not discover `a`; it is *given* a soil model and reproduces what
that model implies. Using SCM to produce `a`, then using `a` to decide whether
the capability is real, proves only that the soil model is self-consistent.
This project has already made that mistake once, with a simulator that had no
friction and a braking figure that was therefore unfalsifiable.

So: the rig measures `a`. Chrono earns its place **after** that, because its SCM
terrain is the only one of the candidates that keeps deformed node heights
between passes and lets vehicles drive into ruts other vehicles made — which is
the minimum a multi-pass study needs. MuJoCo, Isaac and Bullet take a
heightfield and do not evolve it from traffic; for this question they would be
answering a different one. Chrono's job is then extrapolation to geometries the
bin cannot hold, against a measured anchor.

---

## 5. First build

**One series.** One soil, one moisture, one load, one slip ratio, twelve passes
over the same track without re-preparing the bed. After each pass: rut
cross-section (ToF), cone index at three depths, drawbar, wheel torque.

Then, from `multipass.ts`:

- fit `z_N = z_1 · N^a` from passes 1–2, and again from 1–3;
- ask each fit for the pass at which sinkage reaches belly clearance;
- compare against where the series actually reached it.

### Kill condition

The capability is dead if **any** of these holds:

1. `leadPasses ≤ 0` from the first three passes — the warning arrives no
   earlier than the stranding, which is not a warning.
2. The power law does not describe the data (`fitQuality < 0.8`) — then `a` is
   not a thing and there is nothing to measure in situ.
3. The predicted critical pass is off by more than ±3 passes when the
   prediction is made from three — too loose to route on.
4. `a` does not differ meaningfully between the two soils — then it is a
   constant, belongs in a lookup table, and no robot needs to measure it.

Any of the four and C4 is struck out here, on a bench, at BOM cost. That is the
point of building it this way round.

### What is already in code

`arc2/multipass.ts` — the fit, the pass budget, and `earlyWarning`, which is the
kill condition as a function. `arc2/rig.ts` — the acquisition contract the rig
must satisfy. **No mock rig ships**, deliberately: a caller with no hardware has
to write their own source and tag it `simulated`, and every number derived from
it carries that tag out. `__tests__/multipass.test.ts` holds the arithmetic and
the provenance rule.

**Status: `SIMULATED` is not even claimed yet.** Nothing has been measured. The
code is the instrument, not the result.
