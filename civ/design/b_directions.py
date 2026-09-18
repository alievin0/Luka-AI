#!/usr/bin/env python3
"""BOARD H — three visual directions, compared on the same content."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import concept_render as C
import board as B

PALE, STONE, DARK = C.PALE, (156, 163, 172), (78, 88, 100)
PW, PH = 520, 430


def panel_a():
    """THE LIT MODEL — an architect's massing model under gallery light."""
    S = C.Scene(w=PW, h=PH, s=7.2, ox=250, oy=150, bg="#0d1217")
    S.plate(0, 0, 44, 30, fill="#141b23", edge=1.0)
    S.box(2, 8, 0, 5, 12, 0.3, base=DARK, k=1.0)
    S.box(9, 7, 0, 8, 14, 0.3, base=STONE, k=0.92)
    S.box(9, 7, 0.3, 0.5, 14, 4.2, base=PALE, k=0.94)
    S.box(9, 7, 0.3, 8, 0.5, 4.2, base=PALE, k=1.0)
    S.pool(13, 14, 3.6, C.ACCENT, 0.22)
    S.entity(13, 13, "RESEARCHER", "WORKING", r=1.3)
    for i in range(3):
        bx = 19 + i * 4.2
        lit = i == 0
        S.box(bx, 7, 0, 3.4, 14, 0.28, base=STONE, k=0.96 if lit else 0.78)
        S.box(bx, 7, 0.28, 0.45, 14, 3.4, base=PALE, k=0.94 if lit else 0.6)
        if lit:
            S.pool(bx + 1.7, 14, 2.8, C.ACCENT, 0.24)
            S.entity(bx + 1.7, 14, "BUILDER", "WORKING", r=1.2)
    S.box(33, 4, 0, 7, 9, 0.3, base=STONE, k=0.9)
    S.box(33, 4, 0.3, 0.5, 9, 3.8, base=PALE, k=0.92)
    S.box(33, 4, 0.3, 7, 0.5, 3.8, base=PALE, k=1.0)
    S.entity(36.5, 8, "REVIEWER", "ASSIGNED", r=1.2)
    S.box(34, 17, 0, 5, 7, 0.5, base=(120, 148, 128), k=0.95)
    S.lane((25, 24), (36, 24), col=C.CLAY, w=2.0, op=0.8)
    S.lane((36, 13), (36, 24), col=C.CLAY, w=2.0, op=0.8)
    return S.svg()


def panel_b():
    """THE SECTION — a vertical cut through the facility; every room at once."""
    o = ['<svg viewBox="0 0 %d %d" width="%d" height="%d">' % (PW, PH, PW, PH),
         '<defs><filter id="glow" x="-80%" y="-80%" width="260%" height="260%">'
         '<feGaussianBlur stdDeviation="8"/></filter></defs>',
         '<rect width="%d" height="%d" fill="#0d1217"/>' % (PW, PH)]
    # a background shaft, hazed back — depth from layered planes, not perspective
    o.append('<rect x="92" y="48" width="336" height="330" fill="#161d26" opacity=".55"/>')
    ROOMS = [("INSPECTION", 64, None), ("BUILD", 132, "BUILDER"),
             ("RESEARCH", 200, "RESEARCHER"), ("INTAKE · ARCHIVE", 268, None)]
    for name, y, who in ROOMS:
        o.append('<rect x="60" y="%d" width="400" height="60" fill="none" '
                 'stroke="rgba(160,178,198,.24)"/>' % y)
        o.append('<rect x="60" y="%d" width="400" height="5" fill="#8f9aa8" opacity=".5"/>'
                 % (y + 60))
        o.append('<text x="68" y="%d" class="lbl tiny">%s</text>' % (y + 15, name))
        if who:
            o.append('<ellipse cx="200" cy="%d" rx="52" ry="24" fill="%s" opacity=".13" '
                     'filter="url(#glow)"/>' % (y + 38, C.ACCENT))
            o.append(C.entity_glyph(who, "WORKING", 19, 200, y + 34))
        for i in range(6):
            o.append('<rect x="%d" y="%d" width="14" height="9" fill="#5d6773" '
                     'opacity=".5"/>' % (280 + i * 24, y + 40))
    o.append('<path d="M446 96 L446 300 L250 300" fill="none" stroke="%s" '
             'stroke-width="2" opacity=".8"/>' % C.CLAY)
    o.append('<text x="60" y="%d" class="lbl tiny">a vertical cut: every room visible at '
             'once, depth from stacked planes</text>' % (PH - 22))
    o.append("</svg>")
    return "".join(o)


def panel_c():
    """THE VOLUME — suspended lattices in a dark chamber; no ground at all."""
    S = C.Scene(w=PW, h=PH, s=7.2, ox=250, oy=210, bg="#080b10")
    for (x, y, z, dx, dy, dz, lit) in ((8, 6, 0, 9, 13, 5, True),
                                       (20, 5, 7, 8, 12, 4, False),
                                       (31, 8, -5, 8, 11, 5, True),
                                       (18, 18, 13, 7, 9, 3, False)):
        S.frame(x, y, z, dx, dy, dz, col=C.sh(PALE, 0.55 if lit else 0.22), w=1.2,
                op=0.85 if lit else 0.35)
        if lit:
            S.pool(x + dx / 2, y + dy / 2, 3.0, C.ACCENT, 0.13)
    S.entity(12, 12, "RESEARCHER", "WORKING", r=1.4, hover=2.4)
    S.entity(35, 13, "BUILDER", "WORKING", r=1.3, hover=-2.6)
    S.entity(24, 11, "REVIEWER", "IDLE", r=1.2, hover=9.0)
    S.under = [u for u in S.under if "ellipse" not in u or "opacity=\"0.1" in u]
    body = S.svg()
    return body.replace('<rect width="%d" height="%d" fill="url(#key)"/>' % (PW, PH),
                        '<rect width="%d" height="%d" fill="url(#key)" opacity=".4"/>' % (PW, PH))


VERDICTS = [
    ("A · THE LIT MODEL", "chosen", C.ACCENT,
     "An architect's massing model under gallery light. Occlusion, contact shadow and cast "
     "light do all the work; the accent is spent only on activity. Reads premium and calm, and "
     "it is the only direction where DARKNESS IS MEANINGFUL — an unlit building is an idle one. "
     "Risk: could read inert. The answer is that light is the life, and light is a lease."),
    ("B · THE SECTION", "borrowed", "#8f9aa8",
     "A vertical cut: every room legible at once, depth from stacked planes. Excellent for "
     "teaching the building and terrible as a world — it is a drawing, and a drawing is the "
     "failure mode we are leaving. KEPT as the close-zoom treatment: at Z2 the roof comes off "
     "and you see the section. Not adopted as the world view."),
    ("C · THE VOLUME", "rejected", C.CLAY,
     "Suspended lattices in a dark chamber, no ground. Genuinely futuristic, and it fails the "
     "brief twice: without a ground plane there is no scale and no contact, so nothing feels "
     "inhabited; and every legible version of it slid toward neon. Rejected — it looks like a "
     "machine's insides, not a place people work."),
]

out = ['<div style="display:flex;gap:18px;margin-bottom:6px">']
for title, (svg,) in zip(("A · THE LIT MODEL", "B · THE SECTION", "C · THE VOLUME"),
                         ((panel_a(),), (panel_b(),), (panel_c(),))):
    out.append('<div><div style="font:9.5px ui-monospace,monospace;letter-spacing:.2em;'
               'color:#cfd8e2;margin-bottom:7px">%s</div>%s</div>' % (title, svg))
out.append("</div>")
out.append('<div style="display:flex;gap:18px;margin-top:14px">')
for name, verdict, col, text in VERDICTS:
    out.append('<div style="width:520px">'
               '<div style="font:9px ui-monospace,monospace;letter-spacing:.2em;color:%s;'
               'border:1px solid %s;border-radius:3px;padding:3px 7px;display:inline-block;'
               'margin-bottom:8px">%s</div>'
               '<div style="font-size:11.5px;line-height:1.55;color:#8d97a4">%s</div></div>'
               % (col, col, verdict.upper(), text))
out.append("</div>")

B.write("H-directions", "Three Directions", "BOARD H",
        "The same content — a research hall, build cells, an inspection room, a rejection "
        "travelling back — drawn three ways, so the choice is made against evidence rather than "
        "taste. The test each had to pass: does a quiet world look quiet, and does a busy one "
        "look busy, without a single decorative mark?",
        "".join(out),
        legend=[(C.ACCENT, "adopted"), ("#8f9aa8", "kept for one zoom level"),
                (C.CLAY, "rejected")],
        tiers=[("t1", "identical in all three: the same rows drive each panel"),
               ("t2", "the projection itself is what differs"),
               ("t3", "lighting and structure")])
print("H")
