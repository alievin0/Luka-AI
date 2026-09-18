#!/usr/bin/env python3
"""BOARD F — the five agent entities, their frames and their states."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import concept_render as C
import board as B

CREW = [
    ("ORCHESTRATOR", "THE ARMATURE",
     "an open cage, one anchor per crew member, and no manipulator of any kind"),
    ("RESEARCHER", "THE APERTURE",
     "an iris that opens to read and closes at rest; a focal stem"),
    ("BUILDER", "THE ASSEMBLY",
     "strata on a spine; they part to work and the work is visible in the gap"),
    ("REVIEWER", "THE GAUGE",
     "calipers that close on another's work — no iris, no strata"),
    ("OPERATOR", "THE ROTOR",
     "the only enclosed core; it turns only while something is running"),
]
STATES = ["IDLE", "ASSIGNED", "WORKING", "TOOL", "REVIEW", "BLOCKED", "FAILED", "COMPLETED"]

W, H = 1680, 1080
out = ['<svg viewBox="0 0 %d %d" width="%d" height="%d">' % (W, H, W, H),
       '<defs><filter id="glow" x="-80%" y="-80%" width="260%" height="260%">'
       '<feGaussianBlur stdDeviation="9"/></filter>'
       '<filter id="soft" x="-60%" y="-60%" width="220%" height="220%">'
       '<feGaussianBlur stdDeviation="5"/></filter>'
       '<radialGradient id="key" cx="46%" cy="12%" r="82%">'
       '<stop offset="0" stop-color="#283743" stop-opacity=".5"/>'
       '<stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>',
       '<rect width="%d" height="%d" fill="#0d1217"/>' % (W, H),
       '<rect width="%d" height="%d" fill="url(#key)"/>' % (W, H)]

# ── the five, at scale, each on its plinth ────────────────────────────
x0, step = 190, 320
for i, (kind, name, note) in enumerate(CREW):
    cx = x0 + i * step
    cy = 250
    out.append('<ellipse cx="%d" cy="%d" rx="74" ry="15" fill="#000" opacity=".5" '
               'filter="url(#soft)"/>' % (cx, cy + 128))
    out.append('<ellipse cx="%d" cy="%d" rx="70" ry="13" fill="#1b232c"/>'
               % (cx, cy + 128))
    out.append(C.entity_glyph(kind, "WORKING" if i == 1 else "IDLE", 52, cx, cy))
    out.append('<text x="%d" y="%d" class="lbl big" text-anchor="middle">%s</text>'
               % (cx, cy + 172, kind))
    out.append('<text x="%d" y="%d" class="lbl a" text-anchor="middle">%s</text>'
               % (cx, cy + 192, name))
    for j, ln in enumerate(_wrap(note, 34) if (_wrap := lambda s, n: __import__("textwrap").wrap(s, n)) else []):
        out.append('<text x="%d" y="%d" class="lbl tiny" text-anchor="middle">%s</text>'
                   % (cx, cy + 212 + j * 13, ln))

out.append('<line x1="70" y1="520" x2="%d" y2="520" stroke="rgba(150,172,196,.14)"/>' % (W - 70))
out.append('<text x="70" y="556" class="lbl big">THE FIELD CARRIES STATE — one grammar, five bodies</text>')
out.append('<text x="70" y="576" class="lbl tiny">the frame opens with work · the ring breaks on failure · '
           'the core never goes out, because identity does not depend on activity</text>')

# ── the state matrix ──────────────────────────────────────────────────
gx, gy, gstep = 175, 700, 192
for j, st in enumerate(STATES):
    cx = gx + j * gstep
    out.append(C.entity_glyph("RESEARCHER", st, 34, cx, gy))
    out.append('<text x="%d" y="%d" class="lbl k" text-anchor="middle">%s</text>'
               % (cx, gy + 84, st))
NOTE = {"IDLE": "no ring · core dim · at its own station",
        "ASSIGNED": "thin cool ring · moved, not yet leased",
        "WORKING": "warm ring · frame open · casts light",
        "TOOL": "beam to a bolted station · one pulse per call",
        "REVIEW": "violet · its work is being judged",
        "BLOCKED": "amber and STILL — stillness reads as stuck",
        "FAILED": "the ring breaks · core dark · sits lower",
        "COMPLETED": "ring closes, releases once, returns home"}
import textwrap
for j, st in enumerate(STATES):
    cx = gx + j * gstep
    for k, ln in enumerate(textwrap.wrap(NOTE[st], 24)):
        out.append('<text x="%d" y="%d" class="lbl tiny" text-anchor="middle">%s</text>'
                   % (cx, gy + 104 + k * 13, ln))

out.append('<line x1="70" y1="880" x2="%d" y2="880" stroke="rgba(150,172,196,.14)"/>' % (W - 70))
out.append('<text x="70" y="916" class="lbl big">CORE · FRAME · FIELD — and why it survives a change of body</text>')
for i, (t, d) in enumerate((
        ("CORE", "the identity. identical across all five. the principal row, the contract, "
                 "the memory band. it never changes and it is never absent."),
        ("FRAME", "the role. the silhouette. THIS is the embodiment — swap it and the "
                  "identity is untouched, which is how a physical body arrives later."),
        ("FIELD", "the state. one grammar for every entity. it is driven by rows and by "
                  "nothing else, so it can never be switched on for effect."))):
    y = 946 + i * 42
    out.append('<text x="70" y="%d" class="lbl a">%s</text>' % (y, t))
    out.append('<text x="160" y="%d" class="lbl">%s</text>' % (y, d))
out.append('</svg>')

B.write("F-entities", "Five Entities", "BOARD F",
        "One species, five machines. The grammar is shared so they read as a crew; the frame "
        "is role-specific so no two are recolours of each other. Nothing here is humanoid, and "
        "nothing is a generic icon — each frame is the shape of what the role is permitted to do.",
        "".join(out),
        legend=[("#5fd4c4", "work is happening (a lease is held)"),
                ("#7fa8d4", "assigned, not yet leased"),
                ("#a98ce8", "under judgement"),
                ("#e0a44c", "blocked · needs a decision"),
                ("#d9736f", "failed · rejected"),
                ("#7cc48f", "verified · accepted"),
                ("#5d6773", "idle")],
        tiers=[("t1", "frame identity, state, tool grants — all rows"),
               ("t2", "which glyph, which colour — a tested lookup"),
               ("t3", "the plinths, the key light")],
        direction="DIRECTION A · THE LIT MODEL")
print("wrote board F")
