#!/usr/bin/env python3
"""BOARDS B, C, D, E, G — the Works and the three workspaces, plus the Owner."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import concept_render as C
import board as B

PALE, STONE, DARK = C.PALE, (156, 163, 172), (78, 88, 100)
TIER3 = "plate, canopy ribs, the lighting rig"


def shed(S, x, y, dx, dy, h, k=1.0, ribs=True, wall=0.5):
    S.box(x, y, 0, dx, dy, 0.3, base=STONE, k=0.92 * k)
    S.box(x, y, 0.3, wall, dy, h, base=PALE, k=0.94 * k)
    S.box(x, y, 0.3, dx, wall, h, base=PALE, k=1.0 * k)
    if ribs:
        S.frame(x, y, h + 0.3, dx, dy, 0.8, col=C.sh(PALE, 0.5 * k), w=1.0)


# ══ BOARD B — THE WORKS ══════════════════════════════════════════════
S = C.Scene(w=1680, h=900, s=14.6, ox=690, oy=300)
S.plate(-1, 2, 48, 26, fill="#141b23", edge=1.2)
S.mark(1, 4, 45, 21, col=C.sh(PALE, 0.2), op=0.4)

S.box(1.5, 5, 0, 5, 18, 0.28, base=DARK, k=1.0)
for ox_, oy_ in ((2.6, 7), (2.6, 11), (4.4, 9)):
    S.box(ox_, oy_, 0.28, 1.3, 1.0, 0.45, base=(126, 134, 146), k=1.0)
S.leader(4, 5, 0.5, "1 · INTAKE", dx=-120, dy=-44, cls="lbl k")
S.leader(4, 5, 0.5, "an opportunity nobody has agreed to,", dx=-120, dy=-30, cls="lbl tiny")
S.leader(4, 5, 0.5, "sitting in the open until someone does", dx=-120, dy=-18, cls="lbl tiny")

shed(S, 8, 4, 9, 19, 4.6)
S.bench(10, 8, 0.3, 4.4, 2.6, 0.45, lit=True)
S.bench(10, 13, 0.3, 4.4, 2.2, 0.4)
S.pool(12.5, 11, 4.4, C.ACCENT, 0.20)
S.entity(12.5, 9.5, "RESEARCHER", "WORKING", r=1.5, tool=(9.5, 1.5, 2.4))
S.leader(12.5, 4, 4.8, "2 · RESEARCH HALL", dx=-40, dy=-58, cls="lbl k")
S.box(8, -1.5, 0, 6, 5, 2.4, base=(120, 148, 160), k=1.0, op=0.55)
S.frame(8, -1.5, 0, 6, 5, 2.4, col=C.sh(PALE, 0.72), w=1.0)
for i in range(9):
    S.mote(9 + (i % 3) * 1.8, -0.4 + (i // 3) * 1.6, 2.55)
S.leader(11, -1.5, 2.6, "9 · EVIDENCE VAULT — one slot per row",
         dx=26, dy=-34, cls="lbl k")

S.box(19, 5, 0, 5, 17, 0.8, base=STONE, k=0.95)
S.frame(19, 5, 0.8, 5, 17, 2.0, col=C.sh(PALE, 0.42), w=0.9)
S.gauge(20.2, 9, 0.9, 3, 0)
S.entity(21.5, 13, "ORCHESTRATOR", "IDLE", r=1.5, hover=2.2)
S.leader(21.5, 5, 2.2, "3 · DESIGN FLOOR — the bar is set HERE, before",
         dx=96, dy=-98, cls="lbl k")
S.leader(21.5, 5, 2.2, "anyone builds, and it stands visibly unmet",
         dx=96, dy=-86, cls="lbl tiny")

for i in range(4):
    bx = 26 + i * 3.4
    lit = (i == 1)
    S.box(bx, 4, 0, 2.9, 19, 0.28, base=STONE, k=0.98 if lit else 0.8)
    S.box(bx, 4, 0.28, 0.42, 19, 3.6, base=PALE, k=0.96 if lit else 0.62)
    S.frame(bx, 4, 3.9, 2.9, 19, 0.6, col=C.sh(PALE, 0.55 if lit else 0.26))
    if lit:
        S.pool(bx + 1.5, 12, 3.0, C.ACCENT, 0.26)
        S.slab(bx + 0.7, 10.5, 0.28, "c41e88a", w=1.6, d=1.1)
        S.entity(bx + 1.5, 13.5, "BUILDER", "WORKING", r=1.4)
S.leader(31, 4, 4.0, "4 · BUILD CELLS — the Works grows by repeating",
         dx=44, dy=-62, cls="lbl k")
S.leader(31, 4, 4.0, "a cell, never by cramming one", dx=44, dy=-50, cls="lbl tiny")

S.box(40.5, 6, 0, 2.6, 14, 0.28, base=STONE, k=0.95)
S.frame(40.5, 6, 0.28, 2.6, 14, 3.2, col=C.sh(PALE, 0.62), w=1.2)
S.gauge(41.2, 9, 0.35, 3, 2)
S.entity(41.8, 13, "OPERATOR", "IDLE", r=1.4)
S.leader(41.8, 20, 3.4, "5 · TEST BENCH — deterministic, and",
         dx=34, dy=34, cls="lbl k")
S.leader(41.8, 20, 3.4, "physically OUTSIDE the producing cell", dx=34, dy=46, cls="lbl tiny")

shed(S, 44, -2, 6, 7, 3.8)
S.bench(45.4, 0.6, 0.3, 2.6, 2.0, 0.45)
S.slab(45.6, 0.9, 0.75, "c41e88a", w=1.6, d=1.1, mark=C.CLAY)
S.entity(47, 3, "REVIEWER", "WORKING", r=1.4)
S.leader(47, -2, 4.0, "6 · INSPECTION — reachable only via Test.", dx=-44, dy=-66, cls="lbl k")
S.leader(47, -2, 4.0, "No door from a build cell to this room.",
         dx=-44, dy=-54, cls="lbl tiny")

S.box(44, 16, 0, 5, 9, 0.5, base=(120, 148, 128), k=0.95)
S.slab(44.9, 17.4, 0.5, "a19f4c2", w=1.7, d=1.2)
S.slab(44.9, 19.6, 0.5, "77bd013", w=1.7, d=1.2)
S.leader(46.5, 25, 0.7, "7 · OUTPUT DOCK", dx=12, dy=32, cls="lbl g")
S.box(26, 0, -0.7, 14, 3.2, 0.7, base=DARK, k=0.78)
S.leader(33, 0, -0.1, "8 · ARCHIVE — sunken, dim, never deleted", dx=-300, dy=-48, cls="lbl tiny")

for a, b in (((6.5, 12), (8, 12)), ((17, 12), (19, 12)), ((24, 12), (26, 12)),
             ((39.5, 12), (40.5, 12)), ((43.1, 9), (44, 5))):
    S.lane(a, b, w=2.4)
S.lane((47, 5), (46.5, 16), w=2.0, col=C.SAGE, op=0.6)
S.lane((44.6, 5), (44.6, 24), col=C.CLAY, w=2.6, op=0.85)
S.lane((44.6, 24), (28, 24), col=C.CLAY, w=2.6, op=0.85)
S.lane((28, 24), (28, 23), col=C.CLAY, w=2.6, op=0.85)
S.leader(36, 24, 0, "10 · RETURN LANE — a rejection travels back in the open", dx=-250, dy=58, cls="lbl f")

B.write("B-works", "The Works", "BOARD B",
        "One building with a real plan, entered at one end. The circulation IS the law: work "
        "reaches Inspection only through Test, and there is no door from a build cell to the "
        "inspection room. A reviewer who could walk into the cell would be a co-author.",
        S.svg(),
        legend=[(C.ACCENT, "occupied — a lease is held here"),
                (C.CLAY, "the return lane · a rejected artifact"),
                (C.SAGE, "accepted, leaving by the dock"),
                ("#7d8794", "unoccupied structure")],
        tiers=[("t1", "which cells are occupied · gauges met · slabs · motes · verdicts"),
               ("t2", "the plan itself — a fixed, tested mapping from status to station"),
               ("t3", TIER3)],
        direction="DIRECTION A · THE LIT MODEL")
print("B")


# ══ BOARD C — RESEARCH WORKSPACE ═════════════════════════════════════
S = C.Scene(w=1680, h=820, s=33.0, ox=800, oy=250)
S.plate(-0.5, -0.5, 15, 11, fill="#141b23", edge=0.6)
shed(S, 0.5, 0.5, 12, 9, 2.6, wall=0.22)
S.bench(2.2, 2.0, 0.3, 4.2, 2.4, 0.42, lit=True)                     # source table
S.bench(2.2, 5.6, 0.3, 4.2, 2.2, 0.42)                               # synthesis table
S.pool(4.3, 3.2, 3.0, C.ACCENT, 0.22)
S.entity(4.3, 4.6, "RESEARCHER", "TOOL", r=0.62, tool=(1.6, 2.6, 1.1))

# the tool is BOLTED DOWN. an agent goes to it; it is never carried.
S.box(1.0, 2.2, 0.3, 0.6, 1.6, 0.8, base=(96, 104, 116), k=1.0)
S.leader(1.3, 2.2, 1.1, "READ_REPO — a station, bolted down.", dx=-180, dy=-40, cls="lbl a")
S.leader(1.3, 2.2, 1.1, "Capability lives here, not in a hand.", dx=-180, dy=-28, cls="lbl tiny")

S.slab(2.6, 2.4, 0.72, "", w=1.5, d=1.0, col=(138, 160, 172))        # the source
S.leader(3.3, 2.4, 0.8, "SOURCE · billing.py — width = bytes the gateway returned",
         dx=-40, dy=-52, cls="lbl k")
S.slab(4.6, 2.4, 0.72, "", w=1.9, d=1.0, col=(120, 140, 154))        # the observation
S.leader(5.5, 2.4, 0.8, "OBSERVATION — a torn edge if it was clipped.",
         dx=52, dy=-34, cls="lbl k")
S.leader(5.5, 2.4, 0.8, "The world never hides a truncation.", dx=52, dy=-22, cls="lbl tiny")

for i in range(5):                                                    # evidence collected
    S.mote(2.7 + i * 0.5, 6.2, 0.78)
S.leader(3.7, 6.2, 0.82, "EVIDENCE · 5 motes, one per row. Hard and faceted; it refracts,",
         dx=-30, dy=48, cls="lbl k")
S.leader(3.7, 6.2, 0.82, "it does not glow — only agents and decisions emit light.",
         dx=-30, dy=60, cls="lbl tiny")

S.mote(3.2, 7.4, 1.6, col=C.SAGE, r=0.11, tether=(3.2, 6.2, 0.78))   # a backed FACT
S.mote(5.4, 7.4, 1.7, col="#8f9aa8", r=0.11)                          # an unbacked claim
S.leader(3.2, 7.4, 1.7, "FACT — tethered to the evidence under it", dx=-40, dy=-36, cls="lbl g")
S.leader(5.4, 7.4, 1.8, "HYPOTHESIS — floating, untethered.", dx=44, dy=-38, cls="lbl k")
S.leader(5.4, 7.4, 1.8, "You can see which beliefs are backed.", dx=44, dy=-26, cls="lbl tiny")

S.box(9.2, 1.4, 0.3, 2.6, 6.0, 1.9, base=(120, 148, 160), k=1.0, op=0.5)
S.frame(9.2, 1.4, 0.3, 2.6, 6.0, 1.9, col=C.sh(PALE, 0.7), w=1.0)
for i in range(6):
    S.mote(9.8 + (i % 2) * 1.2, 2.2 + (i // 2) * 1.6, 2.3)
S.leader(10.5, 1.4, 2.2, "THE VAULT — it fills over the life of the world.",
         dx=40, dy=-40, cls="lbl k")
S.leader(10.5, 1.4, 2.2, "A world that has done work looks different from a fresh one.",
         dx=40, dy=-28, cls="lbl tiny")

B.write("C-research", "Research Workspace", "BOARD C",
        "What the Researcher actually does, with nothing invented. The source object appears "
        "because a tool_calls row says ALLOW; its width is the bytes the gateway returned. The "
        "observation beside it shows a torn edge when it was clipped, because a world that hides "
        "a truncation is lying about what the model saw.",
        S.svg(),
        legend=[(C.ACCENT, "reading — a tool call is in flight"),
                (C.SAGE, "a claim with evidence under it"),
                ("#8f9aa8", "a claim with none")],
        tiers=[("t1", "the call, the bytes, each mote, each claim's evidence_id"),
               ("t2", "where the table sits · mote layout in the vault"),
               ("t3", "the hall, the canopy, the key light")],
        direction="DIRECTION A · THE LIT MODEL")
print("C")


# ══ BOARD D — BUILD WORKSPACE ════════════════════════════════════════
S = C.Scene(w=1680, h=820, s=33.0, ox=810, oy=250)
S.plate(-0.5, -0.5, 15, 11, fill="#141b23", edge=0.6)
S.box(0.5, 0.5, 0, 12, 9, 0.28, base=STONE, k=0.98)
S.box(0.5, 0.5, 0.28, 0.22, 9, 3.0, base=PALE, k=0.96)
S.box(0.5, 0.5, 0.28, 12, 0.22, 3.0, base=PALE, k=1.0)
S.frame(0.5, 0.5, 3.28, 12, 9, 0.5, col=C.sh(PALE, 0.5))
S.pool(5.0, 4.4, 3.4, C.ACCENT, 0.24)

# the SPECIFICATION, pinned at the back, with its bar standing unmet
S.box(1.1, 1.0, 0.28, 0.16, 3.4, 2.0, base=(128, 138, 150), k=1.0)
S.gauge(1.5, 1.4, 1.5, 3, 0)
S.leader(1.3, 1.2, 2.3, "SPECIFICATION + the 3 conditions, declared when the task",
         dx=-40, dy=-52, cls="lbl k")
S.leader(1.3, 1.2, 2.3, "was created. Unfilled gauges are an unmet bar, visible from outside.",
         dx=-40, dy=-40, cls="lbl tiny")

S.entity(4.2, 4.2, "BUILDER", "WORKING", r=0.66)
S.slab(3.5, 5.4, 0.28, "c41e88a2", w=2.2, d=1.4)                    # forming between the plates
S.leader(4.6, 5.4, 0.5, "ARTIFACT — the face pattern is a function of the sha,",
         dx=40, dy=44, cls="lbl k")
S.leader(4.6, 5.4, 0.5, "so a revision is a NEW object, never a repaint.",
         dx=40, dy=56, cls="lbl tiny")

# attempt 1: rejected, and still here. nothing is tidied away.
S.slab(2.2, 7.2, 0.28, "b49a8527", w=2.0, d=1.3, col=(104, 74, 76), mark=C.CLAY)
S.leader(3.2, 7.2, 0.5, "ATTEMPT 1 — rejected, and still standing here.",
         dx=-56, dy=44, cls="lbl f")
S.leader(3.2, 7.2, 0.5, "Work that did not pass is still work that happened.",
         dx=-56, dy=56, cls="lbl tiny")

S.box(8.6, 2.0, 0.28, 0.5, 1.4, 0.7, base=(96, 104, 116), k=1.0)
S.leader(8.85, 2.0, 1.0, "WRITE_ARTIFACT → build/ only", dx=44, dy=-34, cls="lbl a")
S.leader(8.85, 2.0, 1.0, "The Researcher's identical tool writes elsewhere. Same",
         dx=44, dy=-22, cls="lbl tiny")
S.leader(8.85, 2.0, 1.0, "capability, different scope — so they are not interchangeable.",
         dx=44, dy=-10, cls="lbl tiny")
S.lane((10.2, 4.4), (12.5, 4.4), w=2.6)
S.leader(11.4, 4.4, 0, "→ TEST", dx=10, dy=26, cls="lbl k")

B.write("D-build", "Build Workspace", "BOARD D",
        "Specification → work → artifact → test. The bar is pinned at the back of the cell and "
        "stands visibly unmet until verification fills it. The rejected first attempt is still "
        "in the room: nothing is tidied away, because a world that removes its failures is a "
        "world you cannot audit.",
        S.svg(),
        legend=[(C.ACCENT, "occupied · a lease is held"),
                (C.CLAY, "rejected, and kept"),
                (C.SAGE, "a met condition")],
        tiers=[("t1", "the artifact, its sha, its producer, each condition's satisfied flag"),
               ("t2", "the sha → surface-pattern mapping · cell placement"),
               ("t3", "the cell shell, the canopy")],
        direction="DIRECTION A · THE LIT MODEL")
print("D")


# ══ BOARD E — REVIEW WORKSPACE ═══════════════════════════════════════
S = C.Scene(w=1680, h=820, s=33.0, ox=790, oy=250)
S.plate(-0.5, -0.5, 15, 11, fill="#141b23", edge=0.6)
shed(S, 0.5, 0.5, 11, 9, 2.8, wall=0.22)
S.bench(3.0, 3.2, 0.3, 4.0, 2.6, 0.45)
S.pool(5.0, 4.4, 3.0, C.VIOLET, 0.20)
S.slab(3.6, 3.6, 0.75, "b49a8527", w=2.4, d=1.6, mark=C.CLAY)
S.entity(5.0, 6.2, "REVIEWER", "WORKING", r=0.66)

S.leader(4.8, 3.6, 0.95, "THE ARTIFACT, and nothing else. There is no window from this",
         dx=-20, dy=-56, cls="lbl k")
S.leader(4.8, 3.6, 0.95, "room onto the build cells: the Reviewer never sees the producer's",
         dx=-20, dy=-44, cls="lbl tiny")
S.leader(4.8, 3.6, 0.95, "reasoning, only what was handed over.", dx=-20, dy=-32, cls="lbl tiny")

for i, (mx, my) in enumerate(((4.0, 3.9), (4.8, 4.4), (5.4, 3.9))):
    p = S.pt(mx, my, 0.98)
    S._add((mx, my, 0.98, mx, my, 0.98),
           '<circle cx="%.1f" cy="%.1f" r="7" fill="none" stroke="%s" stroke-width="1.6"/>'
           '<circle cx="%.1f" cy="%.1f" r="2" fill="%s"/>'
           % (p[0], p[1], C.CLAY, p[0], p[1], C.CLAY), bias=0.6)
S.leader(5.4, 3.9, 1.0, "FINDINGS — marks ON the artifact's own face, each anchored",
         dx=60, dy=-30, cls="lbl f")
S.leader(5.4, 3.9, 1.0, "to the requirement it failed. Not a comment in a list.",
         dx=60, dy=-18, cls="lbl tiny")

S.box(0.9, 1.0, 0.3, 0.18, 2.6, 1.6, base=(128, 138, 150), k=1.0)
S.gauge(1.3, 1.4, 1.2, 3, 2)
S.leader(1.2, 1.2, 1.9, "THE DECLARED BAR — 2 of 3. The Reviewer judges against",
         dx=-40, dy=-44, cls="lbl k")
S.leader(1.2, 1.2, 1.9, "the bar that was set before the work started.", dx=-40, dy=-32, cls="lbl tiny")

S.lane((6.0, 8.0), (6.0, 10.2), col=C.CLAY, w=2.8, op=0.85)
S.leader(6.0, 9.6, 0, "REJECT → the return lane, in the open", dx=-30, dy=40, cls="lbl f")
S.lane((11.6, 4.0), (14.0, 4.0), col=C.SAGE, w=2.4, op=0.5)
S.leader(12.9, 4.0, 0, "APPROVE → the dock", dx=10, dy=-24, cls="lbl g")

B.write("E-review", "Review Workspace", "BOARD E",
        "The Reviewer receives an artifact, inspects it, marks findings on its face and sends it "
        "one of two ways. The room's architecture is the guarantee: it has a bench, a bar and two "
        "exits, and no window onto the cells. It also has no WRITE station — you can see that it "
        "cannot edit what it is judging.",
        S.svg(),
        legend=[(C.VIOLET, "under judgement"),
                (C.CLAY, "a finding · the return lane"),
                (C.SAGE, "approved · to the dock")],
        tiers=[("t1", "the artifact, the verdict, each finding, each condition"),
               ("t2", "where a mark sits on the face · which exit the artifact takes"),
               ("t3", "the room, the canopy")],
        direction="DIRECTION A · THE LIT MODEL")
print("E")


# ══ BOARD G — OWNER CONTROL CENTER ═══════════════════════════════════
S = C.Scene(w=1680, h=820, s=17.0, ox=800, oy=250)
S.box(-2, 2, 3.0, 22, 12, 0.6, base=(100, 112, 126), k=0.98)
S.frame(-2, 2, 3.6, 22, 12, 3.2, col=C.sh(PALE, 0.5), w=1.0)
RAIL = [("WHAT'S NEW", "k"), ("DISCOVERIES", "k"), ("OPPORTUNITIES", "k"), ("PROJECTS", "k"),
        ("ARTIFACTS", "k"), ("REVIEWS", "k"), ("FAILURES", "f"), ("DECISIONS", "w")]
for i, (name, cls) in enumerate(RAIL):
    ix = -0.6 + i * 2.6
    hot = name in ("DECISIONS",)
    S.box(ix, 3.0, 3.6, 1.6, 1.2, 1.5,
          base=(190, 150, 90) if hot else (156, 174, 192), k=1.05)
    S.lane((ix + 0.8, 4.2), (6 + i * 3.0, 26), col=C.AMBER if hot else C.sh(PALE, 0.34),
           w=1.4 if hot else 0.9, op=0.55 if hot else 0.22, dash="2 7")
    S.leader(ix + 0.8, 3.0, 5.2, name, dx=-16, dy=-24 - (i % 2) * 14, cls="lbl " + cls)

# the world below, at ORBIT level: lit mass, never individual agents
S.plate(2, 22, 44, 20, fill="#10161d", edge=0.8)
for i, (bx, by, bw, bd, bh, lit) in enumerate((
        (5, 25, 12, 13, 2.2, True), (20, 24, 9, 15, 1.8, False),
        (31, 26, 11, 12, 2.4, True))):
    S.box(bx, by, 0, bw, bd, bh, base=STONE, k=0.92 if lit else 0.66)
    if lit:
        S.pool(bx + bw / 2, by + bd / 2, 5.0, C.ACCENT, 0.16)
S.post(26, 34, 3.4, C.AMBER)
S.leader(24, 30, 2.6, "Z0 · ORBIT — districts as lit mass. At 1,000 agents this draws",
         dx=-110, dy=54, cls="lbl k")
S.leader(24, 30, 2.6, "no agents at all: brightness is a COUNT, not a crowd of sprites.",
         dx=-110, dy=66, cls="lbl tiny")
S.leader(-1, 2, 4.0, "THE OBSERVATORY — a platform OFF the plate. The Owner is not",
         dx=-30, dy=-64, cls="lbl k")
S.leader(-1, 2, 4.0, "an agent and does not stand in the organisation.",
         dx=-30, dy=-52, cls="lbl tiny")
S.leader(9, 14, 3.6, "Every readout is a SIGHTLINE, not a tile: each instrument points at the "
         "thing it reports, and clicking it takes the camera there.", dx=-180, dy=58, cls="lbl a")

B.write("G-observatory", "Owner Observatory", "BOARD G",
        "The Owner's environment is a platform outside the world's boundary, looking in. The "
        "eight required exposures are instruments on a rail, each aimed at what it reports — so "
        "you never read a figure without being able to go to the thing behind it. Only DECISIONS "
        "glows, because only a decision is owed by the Owner.",
        S.svg(),
        legend=[(C.AMBER, "a decision is owed — the only instrument that emits"),
                (C.ACCENT, "lit mass: somewhere down there a lease is held"),
                ("#7d8794", "quiet districts")],
        tiers=[("t1", "every count, every sightline's target row"),
               ("t2", "LOD aggregation at orbit · instrument → target mapping"),
               ("t3", "the console housing, the platform")],
        direction="DIRECTION A · THE LIT MODEL")
print("G")
