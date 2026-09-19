#!/usr/bin/env python3
"""Concept renderer for the Agent World visual architecture — EXPLORATION ONLY.

This is not the World UI and must never become it. It exists to test whether a
spatial language holds up before any of it is implemented against real state:
the scenes below are hand-authored massing studies with invented contents, and
every figure in them is a placeholder. The real World reads rows.

Axonometric, because a place needs a viewpoint. Occlusion by painter's
algorithm, because overlap is the strongest depth cue there is and the current
flat UI has none of it.

Python standard library only. Emits SVG inside an HTML board.
"""
import math

YAW, PITCH = 30.0, 22.0
CY, SP = math.cos(math.radians(YAW)), math.sin(math.radians(PITCH))

# ── the material language, as values ──────────────────────────────────
INK = "#e8ecf1"
GROUND = "#0d1217"
PLATE = "#161d25"
PALE = (201, 205, 210)        # structure, lit
WARM = (214, 208, 198)        # structure, key-lit warm neutral
DEEP = (58, 66, 76)           # structure, shade
ACCENT = "#5fd4c4"            # work is happening — the ONLY accent
AMBER = "#e3a busy"           # placeholder, replaced below
AMBER = "#e0a44c"             # needs a decision / blocked
CLAY = "#d9736f"              # failed / rejected
SAGE = "#7cc48f"              # verified / accepted
VIOLET = "#a98ce8"            # under judgement
DIM = "#7d8794"
GHOST = "#48525e"


def sh(rgb, k):
    return "rgb(%d,%d,%d)" % tuple(max(0, min(255, int(c * k))) for c in rgb)


def P(x, y, z=0.0, s=1.0):
    """World → screen. +x right-down, +y left-down, +z up."""
    return ((x - y) * CY * s, ((x + y) * SP - z) * s)


class Scene:
    def __init__(self, w=1600, h=980, s=13.0, ox=None, oy=None, bg=GROUND):
        self.w, self.h, self.s, self.bg = w, h, s, bg
        self.ox = w * 0.5 if ox is None else ox
        self.oy = h * 0.60 if oy is None else oy
        self.items = []          # (bounds, svg); ordered by a partial order
        self.under = []          # drawn before everything (ground marks)
        self.over = []           # drawn after everything
        self.labels = []         # (anchor, [(text, cls)]) — placed at render time

    def pt(self, x, y, z=0.0):
        sx, sy = P(x, y, z, self.s)
        return (self.ox + sx, self.oy + sy)

    def poly(self, pts, fill, stroke=None, op=1.0, w=0.6):
        d = " ".join("%.1f,%.1f" % p for p in pts)
        st = ' stroke="%s" stroke-width="%s"' % (stroke, w) if stroke else ""
        return '<polygon points="%s" fill="%s" opacity="%.3f"%s/>' % (d, fill, op, st)

    # ── primitives ────────────────────────────────────────────────────
    def _add(self, b, svg, bias=0.0):
        self.items.append((b, bias, svg))

    def _order(self):
        """Topological sort over 'A is strictly behind B on some axis'.

        An axonometric camera at +x+y+z sees A behind B when A ends before B
        begins on any one axis. That relation is a partial order, not a number;
        Kahn's algorithm resolves it, and anything left in a cycle falls back to
        centre depth rather than disappearing."""
        n = len(self.items)
        after = [[] for _ in range(n)]     # i must be drawn before these
        indeg = [0] * n

        def behind(a, b):
            return (a[3] <= b[0]) or (a[4] <= b[1]) or (a[5] <= b[2])

        for i in range(n):
            for j in range(n):
                if i == j:
                    continue
                bi, bj = self.items[i][0], self.items[j][0]
                if behind(bi, bj) and not behind(bj, bi):
                    after[i].append(j)
                    indeg[j] += 1

        def key(i):
            b, bias = self.items[i][0], self.items[i][1]
            return (b[0] + b[3] + b[1] + b[4]) * 0.5 + (b[2] + b[5]) * 0.25 + bias

        import heapq
        ready = [(key(i), i) for i in range(n) if indeg[i] == 0]
        heapq.heapify(ready)
        out, seen = [], 0
        while ready:
            _, i = heapq.heappop(ready)
            out.append(i); seen += 1
            for j in after[i]:
                indeg[j] -= 1
                if indeg[j] == 0:
                    heapq.heappush(ready, (key(j), j))
        if seen < n:                       # a cycle: fall back, never drop
            out += sorted((i for i in range(n) if indeg[i] > 0), key=key)
        return out

    def plate(self, x, y, dx, dy, z=0.0, fill=PLATE, edge=0.9):
        """The ground the world stands on. Finite, with an edge: a model, not a map."""
        a = self.pt(x, y, z); b = self.pt(x + dx, y, z)
        c = self.pt(x + dx, y + dy, z); d = self.pt(x, y + dy, z)
        s = [self.poly([a, b, c, d], fill)]
        if edge:
            lo = self.pt(x + dx, y, z - edge); lo2 = self.pt(x + dx, y + dy, z - edge)
            lo3 = self.pt(x, y + dy, z - edge)
            s.append(self.poly([b, lo, lo2, c], sh(DEEP, 0.55)))
            s.append(self.poly([c, lo2, lo3, d], sh(DEEP, 0.4)))
        self.under.append("".join(s))

    def box(self, x, y, z, dx, dy, dz, base=PALE, k=1.0, op=1.0, top=None, glow=None):
        """An extruded volume: top + two visible faces, one key, one shade."""
        t = [self.pt(x, y, z + dz), self.pt(x + dx, y, z + dz),
             self.pt(x + dx, y + dy, z + dz), self.pt(x, y + dy, z + dz)]
        f = [t[2], t[3], self.pt(x, y + dy, z), self.pt(x + dx, y + dy, z)]
        r = [t[1], t[2], self.pt(x + dx, y + dy, z), self.pt(x + dx, y, z)]
        g = []
        g.append(self.poly(t, top or sh(base, 1.06 * k), op=op))
        g.append(self.poly(f, sh(base, 0.52 * k), op=op))
        g.append(self.poly(r, sh(base, 0.27 * k), op=op))
        if glow:
            g.append(self.poly(t, glow, op=0.5))
        self._add((x, y, z, x + dx, y + dy, z + dz), "".join(g))

    def frame(self, x, y, z, dx, dy, dz, col=None, w=1.0, op=0.75):
        """An open structure: posts and a ring. Structure without occlusion."""
        col = col or sh(PALE, 0.62)
        c = []
        for (cx, cy) in ((x, y), (x + dx, y), (x + dx, y + dy), (x, y + dy)):
            a = self.pt(cx, cy, z); b = self.pt(cx, cy, z + dz)
            c.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" '
                     'stroke-width="%s" opacity="%.2f"/>' % (a[0], a[1], b[0], b[1], col, w, op))
        top = [self.pt(x, y, z + dz), self.pt(x + dx, y, z + dz),
               self.pt(x + dx, y + dy, z + dz), self.pt(x, y + dy, z + dz)]
        c.append(self.poly(top, "none", stroke=col, op=op, w=w))
        self._add((x, y, z, x + dx, y + dy, z + dz), "".join(c), bias=0.01)

    def bench(self, x, y, z, dx, dy, dz=0.35, base=None, lit=False):
        """Interior furniture. A building with nothing in it reads as a tray."""
        self.box(x, y, z, dx, dy, dz, base=base or (118, 127, 138), k=1.0,
                 glow=ACCENT if lit else None)

    def shadow(self, x, y, r=1.0, op=0.5):
        """Contact shadow. Without it nothing sits on anything."""
        cx, cy = self.pt(x, y, 0)
        self.under.append(
            '<ellipse cx="%.1f" cy="%.1f" rx="%.1f" ry="%.1f" fill="#000" opacity="%.2f" '
            'filter="url(#soft)"/>' % (cx, cy, r * self.s * 1.05, r * self.s * 0.52, op))

    def pool(self, x, y, r=3.0, col=ACCENT, op=0.30):
        """Cast light on the ground. Only a working agent casts one."""
        cx, cy = self.pt(x, y, 0)
        self.under.append(
            '<ellipse cx="%.1f" cy="%.1f" rx="%.1f" ry="%.1f" fill="%s" opacity="%.2f" '
            'filter="url(#glow)"/>' % (cx, cy, r * self.s * 1.1, r * self.s * 0.55, col, op))

    def lane(self, a, b, col=None, w=1.4, op=0.5, dash=None):
        """Drawn infrastructure. Things travel along lanes; nothing wanders."""
        p0, p1 = self.pt(*a), self.pt(*b)
        d = ' stroke-dasharray="%s"' % dash if dash else ""
        self.under.append(
            '<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="%s" '
            'opacity="%.2f" stroke-linecap="round"%s/>'
            % (p0[0], p0[1], p1[0], p1[1], col or sh(PALE, 0.38), w, op, d))

    def mark(self, x, y, dx, dy, col=None, op=0.5, dash="3 5"):
        """A boundary painted on the ground: a zone, not a wall."""
        pts = [self.pt(x, y), self.pt(x + dx, y), self.pt(x + dx, y + dy), self.pt(x, y + dy)]
        self.under.append(self.poly(pts, "none", stroke=col or sh(PALE, 0.3), op=op, w=1.0)
                          .replace("/>", ' stroke-dasharray="%s"/>' % dash))

    def slab(self, x, y, z, sha="", w=2.0, d=1.4, t=0.22, col=None, mark=None):
        """An ARTIFACT. Frosted glass; its face pattern is a function of its sha,
        so a revision is a different object rather than a repainted one."""
        col = col or (176, 198, 208)
        self.box(x, y, z, w, d, t, base=col, k=1.05, op=0.92)
        # the fingerprint face: deterministic from the hash text
        if sha:
            rows = []
            for i, ch in enumerate(sha[:12]):
                v = (ord(ch) * 37) % 7
                fx = x + 0.18 + (i % 6) * (w - 0.36) / 6.0
                fy = y + 0.22 + (i // 6) * (d - 0.44) / 2.0
                a = self.pt(fx, fy, z + t + 0.01)
                b = self.pt(fx + (w - 0.36) / 6.0 * 0.62, fy, z + t + 0.01)
                c = self.pt(fx + (w - 0.36) / 6.0 * 0.62, fy + 0.30, z + t + 0.01)
                e = self.pt(fx, fy + 0.30, z + t + 0.01)
                rows.append(self.poly([a, b, c, e], sh(DEEP, 1.0 + v * 0.22), op=0.55))
            self._add((x, y, z + t, x + w, y + d, z + t), "".join(rows), bias=0.02)
        if mark:
            p = self.pt(x + w * 0.5, y + d * 0.5, z + t + 0.02)
            self._add((x, y, z + t, x + w, y + d, z + t),
                '<circle cx="%.1f" cy="%.1f" r="%.1f" fill="none" stroke="%s" '
                'stroke-width="1.6"/>' % (p[0], p[1], self.s * 0.34, mark), bias=0.05)

    def mote(self, x, y, z, col=None, r=0.20, tether=None):
        """EVIDENCE. Hard, faceted, refractive — it does not glow."""
        p = self.pt(x, y, z)
        col = col or "#bcd6de"
        g = ('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s" opacity="0.85"/>'
             % (p[0], p[1], r * self.s, col))
        if tether:
            q = self.pt(*tether)
            g = ('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" '
                 'stroke-width="0.8" opacity="0.5"/>' % (p[0], p[1], q[0], q[1], col)) + g
        self._add((x, y, z, x, y, z), g, bias=0.1)

    def post(self, x, y, h=2.6, col=AMBER, label=None):
        """A DECISION. The only object that emits without a lease."""
        a, b = self.pt(x, y, 0), self.pt(x, y, h)
        self._add((x, y, 0, x, y, h),
            '<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="2.2" '
            'opacity="0.9"/><circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s" '
            'filter="url(#glow)"/>' % (a[0], a[1], b[0], b[1], col, b[0], b[1],
                                       self.s * 0.17, col))
        self.pool(x, y, 1.5, col, 0.22)

    def gauge(self, x, y, z, n, filled, col=SAGE):
        """A task's DECLARED CONDITIONS, standing unmet until they are met."""
        g = []
        for i in range(n):
            px = x + i * 0.42
            a, b = self.pt(px, y, z), self.pt(px, y, z + 0.7)
            on = i < filled
            g.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" '
                     'stroke-width="2.4" opacity="%.2f"/>'
                     % (a[0], a[1], b[0], b[1], col if on else GHOST, 0.95 if on else 0.55))
        self._add((x, y, z, x + n * 0.42, y, z + 0.7), "".join(g), bias=0.2)

    def label(self, x, y, z, text, cls="lbl", dx=0, dy=0):
        px, py = self.pt(x, y, z)
        self.over.append('<text x="%.1f" y="%.1f" class="%s">%s</text>'
                         % (px + dx, py + dy, cls, text))

    def leader(self, x, y, z, text, dx=0, dy=0, cls="lbl"):
        """Annotate a point. Position is NOT the caller's problem.

        Hand-placed offsets do not survive a change of scale — tuned at one
        zoom they pile into the middle of the scene at another. Labels are
        collected here and laid out at render time in the gutters, stacked so
        none overlaps, each tied back to its anchor by a leader. Consecutive
        calls on the same anchor become one block."""
        if self.labels and self.labels[-1][0] == (x, y, z):
            self.labels[-1][1].append((text, cls))
        else:
            self.labels.append(((x, y, z), [(text, cls)]))

    def _place_labels(self, gutter=26, line=13, gap=13, pad=18):
        out, mid = [], self.w * 0.5
        sides = {"L": [], "R": []}
        for (wx, wy, wz), lines in self.labels:
            px, py = self.pt(wx, wy, wz)
            sides["L" if px < mid else "R"].append((px, py, lines))
        for side, items in sides.items():
            items.sort(key=lambda i: i[1])
            cursor = pad
            for px, py, lines in items:
                h = len(lines) * line
                ty = max(cursor, py - h * 0.5)
                ty = min(ty, self.h - pad - h)
                cursor = ty + h + gap
                lx = gutter if side == "L" else self.w - gutter
                anc = "start" if side == "L" else "end"
                elbow = lx + (78 if side == "L" else -78)
                my = ty + h * 0.5 - line * 0.35
                out.append(
                    '<path d="M%.1f %.1f L%.1f %.1f L%.1f %.1f" fill="none" stroke="%s" '
                    'stroke-width="0.7" opacity="0.45"/>'
                    '<circle cx="%.1f" cy="%.1f" r="1.8" fill="%s"/>'
                    % (px, py, elbow, my, lx + (6 if side == "L" else -6), my, GHOST,
                       px, py, GHOST))
                for i, (t, cls) in enumerate(lines):
                    out.append('<text x="%.1f" y="%.1f" class="%s" text-anchor="%s">%s</text>'
                               % (lx, ty + (i + 1) * line - 3, cls, anc, t))
        return "".join(out)

    # ── output ────────────────────────────────────────────────────────
    def svg(self):
        body = "".join(self.under)
        for i in self._order():
            body += self.items[i][2]
        body += "".join(self.over)
        body += self._place_labels()
        return ('<svg viewBox="0 0 %d %d" width="%d" height="%d">'
                '<defs>'
                '<filter id="soft" x="-60%%" y="-60%%" width="220%%" height="220%%">'
                '<feGaussianBlur stdDeviation="5"/></filter>'
                '<filter id="glow" x="-80%%" y="-80%%" width="260%%" height="260%%">'
                '<feGaussianBlur stdDeviation="9"/></filter>'
                '<radialGradient id="key" cx="42%%" cy="18%%" r="78%%">'
                '<stop offset="0" stop-color="#2a3a46" stop-opacity="0.55"/>'
                '<stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>'
                '</defs>'
                '<rect width="%d" height="%d" fill="%s"/>'
                '<rect width="%d" height="%d" fill="url(#key)"/>%s</svg>'
                % (self.w, self.h, self.w, self.h, self.w, self.h, self.bg,
                   self.w, self.h, body))


# ── the agent entity system ───────────────────────────────────────────
# Every entity is CORE + FRAME + FIELD.
#   CORE  — identity. Identical across all five, and the only part that would
#           survive a change of body. This is what §13 hangs on.
#   FRAME — role. The silhouette. Five different machines, one species.
#   FIELD — state. Same grammar for all five; colour and completeness carry it.
STATE_COL = {"IDLE": GHOST, "ASSIGNED": "#7fa8d4", "WORKING": ACCENT,
             "TOOL": ACCENT, "REVIEW": VIOLET, "BLOCKED": AMBER,
             "FAILED": CLAY, "COMPLETED": SAGE, "SELECTED": ACCENT}


def _frame_paths(kind, r, open_amt):
    """The five FRAMES, in local glyph space, centred on 0,0, radius r.
    `open_amt` is 0 at rest and 1 at full work — the frame itself opens."""
    o = open_amt
    g = []
    if kind == "ORCHESTRATOR":
        # The Armature: an open cage with one anchor per crew member, and no
        # manipulator of any kind — the visual form of holding no tool.
        for i in range(5):
            a = math.radians(-90 + i * 72)
            x, y = math.cos(a) * r, math.sin(a) * r
            g.append('<line x1="0" y1="0" x2="%.2f" y2="%.2f" stroke="{C}" stroke-width="{W}" fill="none" stroke-linecap="round"/>' % (x, y))
            g.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="{C}" stroke="none"/>' % (x, y, r * 0.13))
        pts = " ".join("%.2f,%.2f" % (math.cos(math.radians(-90 + i * 72)) * r * 0.66,
                                      math.sin(math.radians(-90 + i * 72)) * r * 0.66)
                       for i in range(5))
        g.append('<polygon points="%s" stroke="{C}" stroke-width="{W}" fill="none" stroke-linecap="round" fill="none"/>' % pts)
    elif kind == "RESEARCHER":
        # The Aperture: an iris that opens to read and closes at rest.
        for i in range(7):
            a = math.radians(i * 360 / 7)
            ri, ro = r * (0.34 + o * 0.30), r * 0.92
            g.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="{C}" stroke-width="{W}" fill="none" stroke-linecap="round"/>'
                     % (math.cos(a) * ri, math.sin(a) * ri,
                        math.cos(a + 0.55) * ro, math.sin(a + 0.55) * ro))
        g.append('<circle cx="0" cy="0" r="%.2f" stroke="{C}" stroke-width="{W}" fill="none" stroke-linecap="round" fill="none"/>' % (r * 0.95))
        g.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="{C}" stroke-width="{S}" fill="none" stroke-linecap="round" opacity=".65"/>'
                 % (r * 0.66, r * 0.66, r * 1.5, r * 1.5))
    elif kind == "BUILDER":
        # The Assembly: strata on a spine. They part to work; the thing being
        # built is visible in the gap.
        g.append('<line x1="0" y1="%.2f" x2="0" y2="%.2f" stroke="{C}" stroke-width="{S}" fill="none" stroke-linecap="round" opacity=".65"/>' % (-r * 1.05, r * 1.05))
        for i, w in enumerate((0.60, 1.00, 1.00, 0.60)):
            y = (-1.5 + i) * r * (0.34 + o * 0.30)
            g.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="{C}" stroke-width="{W}" fill="none" stroke-linecap="round"/>'
                     % (-r * w, y, r * w, y))
        g.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="{C}" stroke="none"/>'
                 % (-r * 0.16, -r * 1.26, r * 0.32, r * 0.32))
    elif kind == "REVIEWER":
        # The Gauge: calipers that close on someone else's work. No aperture and
        # no strata — it cannot gather and it cannot build.
        d = r * (0.96 - o * 0.22)
        for s_ in (-1, 1):
            g.append('<path d="M %.2f %.2f h %.2f v %.2f h %.2f" stroke="{C}" stroke-width="{W}" fill="none" stroke-linecap="round" fill="none"/>'
                     % (s_ * d, -r * 0.92, s_ * r * 0.30, r * 1.84, -s_ * r * 0.30))
        g.append('<circle cx="0" cy="0" r="%.2f" stroke="{C}" stroke-width="{W}" fill="none" stroke-linecap="round" fill="none"/>' % (r * 0.52))
        for (x1, y1, x2, y2) in ((-r * .78, 0, -r * .3, 0), (r * .3, 0, r * .78, 0),
                                 (0, -r * .78, 0, -r * .3), (0, r * .3, 0, r * .78)):
            g.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="{C}" stroke-width="{W}" fill="none" stroke-linecap="round"/>'
                     % (x1, y1, x2, y2))
    elif kind == "OPERATOR":
        # The Rotor: the only entity whose core is enclosed, because execution
        # is contained. It turns only while something is actually running.
        g.append('<circle cx="0" cy="0" r="%.2f" stroke="{C}" stroke-width="{W}" fill="none" stroke-linecap="round" fill="none"/>' % (r * 0.92))
        g.append('<circle cx="0" cy="0" r="%.2f" stroke="{C}" stroke-width="{W}" fill="none" stroke-linecap="round" fill="none"/>' % (r * 0.45))
        for i in range(8):
            a = math.radians(i * 45 + o * 22)
            g.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="{C}" stroke-width="{S}" fill="none" stroke-linecap="round" opacity=".65"/>'
                     % (math.cos(a) * r * 0.92, math.sin(a) * r * 0.92,
                        math.cos(a) * r * 1.22, math.sin(a) * r * 1.22))
    return "".join(g)


def entity_glyph(kind, state="IDLE", r=22.0, cx=0.0, cy=0.0):
    """One agent, billboarded. Agents hover: a digital entity has no gait, so
    there is no walk to fake and no pathing to invent."""
    col = STATE_COL.get(state, GHOST)
    work = state in ("WORKING", "TOOL", "SELECTED")
    o = 1.0 if work else (0.45 if state == "BLOCKED" else 0.0)
    line = col if state != "IDLE" else "#6a7684"
    g = ['<g transform="translate(%.1f,%.1f)">' % (cx, cy)]
    # FIELD — the ring. A break in it is a failure; a full ring is a completion.
    if state != "IDLE":
        if state == "FAILED":
            g.append('<path d="M %.2f %.2f A %.2f %.2f 0 1 1 %.2f %.2f" fill="none" '
                     'stroke="%s" stroke-width="%.2f" opacity=".9"/>'
                     % (0, -r * 1.5, r * 1.5, r * 1.5, -r * 1.06, r * 1.06, col, r * 0.075))
        else:
            g.append('<circle cx="0" cy="0" r="%.2f" fill="none" stroke="%s" '
                     'stroke-width="%.2f" opacity="%.2f"/>'
                     % (r * 1.5, col, r * 0.075, 0.95 if work else 0.7))
        if work:
            g.append('<circle cx="0" cy="0" r="%.2f" fill="%s" opacity=".13" '
                     'filter="url(#glow)"/>' % (r * 1.7, col))
    g.append(_frame_paths(kind, r, o).format(
        C=line, W="%.2f" % max(1.1, r * 0.062), S="%.2f" % max(1.0, r * 0.05)))
    # CORE — identity. Present in every state, dim when idle, never absent.
    g.append('<circle cx="0" cy="0" r="%.2f" fill="%s" opacity="%.2f"/>'
             % (r * 0.17, col if state != "IDLE" else "#98a4b2",
                0.35 if state in ("IDLE", "FAILED") else 1.0))
    g.append('</g>')
    return "".join(g)


def _entity_on(self, x, y, kind, state="IDLE", r=1.05, hover=1.1, tool=None):
    """Place an entity in the world: contact shadow on the ground, the glyph
    above it, and a cast light pool only when a lease is actually held."""
    if state in ("WORKING", "TOOL", "SELECTED"):
        self.pool(x, y, 2.6, STATE_COL[state], 0.26)
        hover += 0.5
    elif state in ("BLOCKED", "FAILED"):
        hover -= 0.35
    self.shadow(x, y, r * 0.95, 0.55 if state != "FAILED" else 0.7)
    px, py = self.pt(x, y, hover)
    g = entity_glyph(kind, state, r * self.s, px, py)
    if tool:                       # a directed beam to a bolted-down station
        q = self.pt(*tool)
        g = ('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="1.6" '
             'opacity=".55" stroke-dasharray="2 4"/>' % (px, py, q[0], q[1], ACCENT)) + g
    self._add((x, y, hover, x, y, hover), g, bias=0.4)


Scene.entity = _entity_on
