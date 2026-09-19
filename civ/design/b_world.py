#!/usr/bin/env python3
"""BOARD A — the full World. Direction A: THE LIT MODEL."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import concept_render as C
import board as B

S = C.Scene(w=1680, h=1010, s=12.4, ox=800, oy=300)
PALE = C.PALE
STONE = (156, 163, 172)
DARK = (78, 88, 100)
WALL = 0.5

S.plate(0, 0, 80, 56, fill="#141b23", edge=1.4)


def shed(x, y, dx, dy, h, k=1.0, lit=False, ribs=True):
    """A building you can see into: floor, two walls, an open canopy."""
    S.box(x, y, 0, dx, dy, 0.32, base=STONE, k=0.92 * k)
    S.box(x, y, 0.32, WALL, dy, h, base=PALE, k=0.94 * k)
    S.box(x, y, 0.32, dx, WALL, h, base=PALE, k=1.0 * k)
    if ribs:
        S.frame(x, y, h + 0.32, dx, dy, 0.8, col=C.sh(PALE, 0.5 * k), w=1.0)


# ── THE WORKS ─────────────────────────────────────────────────────────
S.mark(2, 14, 76, 24, col=C.sh(PALE, 0.2), op=0.4)

# intake — opportunities nobody has agreed to, standing in the open
S.box(3, 15, 0, 7, 20, 0.3, base=DARK, k=1.0)
for (ox_, oy_) in ((4.4, 18), (4.4, 23), (7.2, 20.5)):
    S.box(ox_, oy_, 0.3, 1.5, 1.1, 0.5, base=(126, 134, 146), k=1.0)
S.leader(6.5, 15, 0.5, "INTAKE · 3 noticed, 0 agreed", dx=-140, dy=-30, cls="lbl k")

# research hall + evidence vault
shed(12, 14, 13, 22, 6.2)
S.bench(15, 20, 0.32, 6, 3, 0.5, lit=True)
S.bench(15, 26, 0.32, 6, 2.4, 0.4)
S.pool(18, 23, 5.4, C.ACCENT, 0.20)
S.leader(18.5, 14, 6.6, "RESEARCH HALL", dx=-58, dy=-34, cls="lbl k")
S.box(13, 3, 0, 8, 8, 3.2, base=(120, 148, 160), k=1.0, op=0.55)
S.frame(13, 3, 0, 8, 8, 3.2, col=C.sh(PALE, 0.72), w=1.0)
for i in range(9):
    S.mote(14.2 + (i % 3) * 2.4, 4.2 + (i // 3) * 2.4, 3.35)
S.leader(17, 3, 3.4, "EVIDENCE VAULT · 9 rows held", dx=-30, dy=-38, cls="lbl k")

# design floor — where the acceptance bar is set, before anyone builds
S.box(27, 16, 0, 8, 18, 0.9, base=STONE, k=0.95)
S.frame(27, 16, 0.9, 8, 18, 2.4, col=C.sh(PALE, 0.42), w=0.9)
S.gauge(29, 22, 1.0, 3, 0)
S.leader(31, 16, 2.2, "DESIGN FLOOR · 3 conditions declared, 0 met", dx=-20, dy=-56, cls="lbl k")

# build cells — the scaling primitive: the Works grows by repeating these
for i in range(4):
    bx = 37 + i * 5.6
    lit = (i == 1)
    S.box(bx, 15, 0, 4.8, 20, 0.3, base=STONE, k=0.98 if lit else 0.8)
    S.box(bx, 15, 0.3, WALL, 20, 4.4, base=PALE, k=0.96 if lit else 0.64)
    S.frame(bx, 15, 4.7, 4.8, 20, 0.7, col=C.sh(PALE, 0.55 if lit else 0.26))
    if lit:
        S.pool(bx + 2.4, 24, 4.0, C.ACCENT, 0.26)
        S.slab(bx + 1.1, 22, 0.3, "c41e88a", w=2.4, d=1.6)
S.leader(45, 15, 4.8, "BUILD CELLS · 1 of 4 occupied", dx=-16, dy=-46, cls="lbl k")

# test bench — physically outside the cell that produced the work
S.box(60, 17, 0, 4.4, 15, 0.3, base=STONE, k=0.95)
S.frame(60, 17, 0.3, 4.4, 15, 3.8, col=C.sh(PALE, 0.62), w=1.2)
S.gauge(61.3, 21, 0.4, 3, 2)
S.leader(62, 17, 4.0, "TEST BENCH · outside the producer", dx=0, dy=-44, cls="lbl k")

# inspection — its own approach; no door to the build cells
shed(67, 7, 9, 12, 5.2)
S.bench(69.5, 11, 0.32, 4, 3.2, 0.5)
S.leader(71.5, 7, 5.4, "INSPECTION", dx=-26, dy=-30, cls="lbl k")

# output dock · archive
S.box(70, 22, 0, 7, 12, 0.6, base=(120, 148, 128), k=0.95)
S.slab(71.3, 24, 0.6, "a19f4c2", w=2.2, d=1.5)
S.slab(71.3, 27.4, 0.6, "77bd013", w=2.2, d=1.5)
S.leader(73.5, 22, 0.9, "OUTPUT DOCK · 2 accepted", dx=26, dy=-24, cls="lbl g")
S.box(37, 1, -0.8, 22, 7, 0.8, base=DARK, k=0.78)
S.leader(48, 1, 0.0, "ARCHIVE · sunken · never deleted", dx=14, dy=-24, cls="lbl tiny")

# ── lanes: the spine, and the return ──────────────────────────────────
for a, b in (((10, 24), (12, 24)), ((25, 24), (27, 24)), ((35, 24), (37, 24)),
             ((59, 24), (60, 24)), ((64.4, 22), (67, 17))):
    S.lane(a, b, w=2.2)
S.lane((70, 20), (72, 22), w=2.0, col=C.SAGE, op=0.65)
S.lane((69, 19.5), (69, 38), col=C.CLAY, w=2.4, op=0.8)
S.lane((69, 38), (40, 38), col=C.CLAY, w=2.4, op=0.8)
S.lane((40, 38), (40, 35), col=C.CLAY, w=2.4, op=0.8)
S.leader(54, 38, 0, "RETURN LANE · a rejection travels back in the open", dx=-30, dy=54, cls="lbl f")

# ── project plots ─────────────────────────────────────────────────────
for px, py, st in ((10, 44, "RUNNING"), (30, 44, "BLOCKED"), (50, 44, "IDLE")):
    on = st != "IDLE"
    S.box(px, py, 0, 14, 10, 0.26, base=DARK, k=1.0 if on else 0.72)
    S.box(px + 0.9, py + 0.9, 0.26, 0.45, 3.0, 2.7, base=PALE, k=0.9)
    for i in range(3):
        S.box(px + 3.2 + i * 1.4, py + 1.1, 0.26, 0.85, 0.85, 0.22,
              base=(112, 122, 134), k=1.0 if (on and i < 2) else 0.66)
    if st == "RUNNING":
        S.slab(px + 9, py + 2, 0.26, "c41e88a", w=1.9, d=1.3)
        S.lane((px + 7, py + 4.5), (44, 28), col=C.ACCENT, w=1.2, op=0.45, dash="3 5")
    if st == "BLOCKED":
        S.post(px + 10.5, py + 5, 2.8, C.AMBER)
        S.slab(px + 7, py + 7, 0.26, "0f0f0f0", w=2.0, d=1.4,
               col=(104, 74, 76), mark=C.CLAY)
    S.leader(px + 7, py + 10, 0.26, "PROJECT · " + st, dx=-16, dy=42,
             cls="lbl " + ("a" if on and st == "RUNNING" else "w" if on else "tiny"))

# ── the crew, placed where rows put them ──────────────────────────────
S.entity(31, 24, "ORCHESTRATOR", "IDLE", r=1.9, hover=2.6)
S.entity(18, 22, "RESEARCHER", "WORKING", r=1.7, tool=(16, 8, 3.4))
S.entity(44.6, 24, "BUILDER", "WORKING", r=1.7)
S.entity(71, 11, "REVIEWER", "ASSIGNED", r=1.7)
S.entity(62, 24, "OPERATOR", "IDLE", r=1.7)

# ── the observatory, off the plate ────────────────────────────────────
S.box(-16, 38, 2.2, 11, 13, 0.6, base=(100, 112, 126), k=0.95)
S.frame(-16, 38, 2.8, 11, 13, 3.0, col=C.sh(PALE, 0.52), w=1.0)
for i in range(4):
    S.box(-15 + i * 2.7, 39, 2.8, 1.3, 0.9, 1.4, base=(158, 176, 194), k=1.05)
S.lane((-5, 44), (10, 47), col=C.sh(PALE, 0.3), w=1.0, op=0.35, dash="2 6")
S.leader(-10.5, 38, 3.4, "OWNER OBSERVATORY · off the plate, looking in",
         dx=-44, dy=-44, cls="lbl k")

B.write("A-world", "The World", "BOARD A",
        "An axonometric model with a finite edge, not an infinite map. Every depth cue the "
        "current flat UI lacks is doing work here: occlusion, contact shadow, cast light, a "
        "strict scale hierarchy. The world is dark except where a lease is held — two pools of "
        "light in a quiet campus is what 'two agents are working' looks like, and an empty "
        "intake yard is what 'nothing has been noticed' looks like.",
        S.svg(),
        legend=[(C.ACCENT, "a lease is held — the only thing that lights the ground"),
                (C.AMBER, "blocked · a decision is owed"),
                (C.CLAY, "rejected · failed"),
                (C.SAGE, "verified · accepted"),
                ("#7d8794", "structure, unlit")],
        tiers=[("t1", "every mass, light, slab, mote and post is one row"),
               ("t2", "where a station sits · which lane an object takes · LOD"),
               ("t3", "plate edge, canopy ribs, the lighting rig")],
        direction="DIRECTION A · THE LIT MODEL")
print("wrote A")
