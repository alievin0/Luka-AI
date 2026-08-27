#!/usr/bin/env python3
"""
Generates the dashboard warning-light pictograms.

A dashboard-light app that shows no dashboard lights is asking the driver to
match the shape in front of them against a paragraph of text. These are the
actual symbols, drawn from the same signed-distance primitives the app icons
use, since no image library is available here.

They are rendered as white on transparent and tinted at display time, so one
asset serves a red, an amber and a green state — and the severity colour can
never disagree with the entry's own severity, because it comes from the same
field.

Run: python3 scripts/make-symbols.py
"""
import importlib.util
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

spec = importlib.util.spec_from_file_location("icons", ROOT / "scripts" / "make-icons.py")
icons = importlib.util.module_from_spec(spec)
spec.loader.exec_module(icons)

write_png, render = icons.write_png, icons.render
sd_circle, sd_capsule, sd_round_rect = icons.sd_circle, icons.sd_capsule, icons.sd_round_rect
make_polygon = icons.make_polygon

WHITE = (255, 255, 255)
SIZE = 128


# ------------------------------------------------------------- extra shapes

def sd_ring(px, py, cx, cy, r, half_thickness):
    return abs(math.hypot(px - cx, py - cy) - r) - half_thickness


def sd_arc(px, py, cx, cy, r, half_thickness, start_deg, end_deg):
    """A ring limited to an angular span. Angles are screen-space degrees,
    measured clockwise from east, because y runs downward."""
    angle = math.degrees(math.atan2(py - cy, px - cx)) % 360
    start, end = start_deg % 360, end_deg % 360
    inside = start <= angle <= end if start <= end else (angle >= start or angle <= end)
    ring = sd_ring(px, py, cx, cy, r, half_thickness)
    if inside:
        return ring
    # Outside the span, fall back to the distance to the nearer endpoint so the
    # arc terminates in a round cap instead of a hard edge.
    ends = [
        (cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
        for a in (start_deg, end_deg)
    ]
    return min(math.hypot(px - ex, py - ey) for ex, ey in ends) - half_thickness


def union(*fns):
    return lambda px, py: min(f(px, py) for f in fns)


def subtract(base, cut):
    """base minus cut — used for the hollow shapes (a bulb's filament gap)."""
    return lambda px, py: max(base(px, py), -cut(px, py))


class Pen:
    """Draws in a normalised square where the glyph spans roughly -1..1."""

    def __init__(self, size, scale=0.78):
        self.c = size / 2
        self.u = size / 2 * scale

    def X(self, x):
        return self.c + x * self.u

    def Y(self, y):
        return self.c + y * self.u

    def S(self, v):
        return v * self.u

    def dot(self, x, y, r):
        cx, cy, rr = self.X(x), self.Y(y), self.S(r)
        return lambda px, py: sd_circle(px, py, cx, cy, rr)

    def bar(self, x1, y1, x2, y2, w=0.07):
        ax, ay, bx, by, r = self.X(x1), self.Y(y1), self.X(x2), self.Y(y2), self.S(w)
        return lambda px, py: sd_capsule(px, py, ax, ay, bx, by, r)

    def box(self, x, y, hw, hh, r=0.06):
        cx, cy, w, h, rr = self.X(x), self.Y(y), self.S(hw), self.S(hh), self.S(r)
        return lambda px, py: sd_round_rect(px, py, cx, cy, w, h, rr)

    def ring(self, x, y, r, w=0.07):
        cx, cy, rr, ww = self.X(x), self.Y(y), self.S(r), self.S(w)
        return lambda px, py: sd_ring(px, py, cx, cy, rr, ww)

    def arc(self, x, y, r, start, end, w=0.07):
        cx, cy, rr, ww = self.X(x), self.Y(y), self.S(r), self.S(w)
        return lambda px, py: sd_arc(px, py, cx, cy, rr, ww, start, end)

    def poly(self, points, r=0.04):
        verts = [(self.X(x), self.Y(y)) for x, y in points]
        return make_polygon(verts, self.S(r))

    def bang(self, x, y, h=0.42, w=0.075):
        """The exclamation mark that half these symbols are built around."""
        return union(
            self.bar(x, y - h, x, y + h * 0.35, w),
            self.dot(x, y + h * 0.78, w * 1.05),
        )


# ------------------------------------------------------------------- glyphs

def engine(p):
    # The check-engine block: a solid silhouette with fin notches cut into the
    # top edge only. Cutting them all the way through, as a first attempt did,
    # breaks the shape into unreadable fragments at row-icon size.
    body = p.poly(
        [(-0.74, -0.06), (-0.52, -0.06), (-0.52, -0.38), (-0.14, -0.38),
         (0.00, -0.16), (0.34, -0.16), (0.34, -0.40), (0.54, -0.40),
         (0.54, -0.16), (0.76, -0.16), (0.76, 0.28), (0.54, 0.28),
         (0.54, 0.46), (-0.50, 0.46), (-0.50, 0.20), (-0.74, 0.20)],
        0.06,
    )
    notches = union(*[
        p.poly([(x - 0.05, -0.46), (x + 0.05, -0.46), (x + 0.05, -0.04), (x - 0.05, -0.04)], 0.01)
        for x in (-0.30, -0.06)
    ])
    return [subtract(body, notches)]

def oil_can(p):
    body = p.poly([(-0.60, 0.06), (0.30, 0.06), (0.30, 0.44), (-0.60, 0.44)], 0.10)
    spout = p.poly([(0.18, -0.02), (0.74, -0.44), (0.80, -0.32), (0.30, 0.10)], 0.04)
    drop = union(
        p.dot(-0.30, -0.22, 0.13),
        p.poly([(-0.30, -0.52), (-0.18, -0.20), (-0.42, -0.20)], 0.03),
    )
    return [union(body, spout, drop)]


def thermometer(p):
    stem = p.bar(0, -0.46, 0, 0.18, 0.11)
    bulb = p.dot(0, 0.34, 0.22)
    waves = union(
        *[p.arc(-0.52, y, 0.16, 190, 350, 0.055) for y in (-0.10, 0.26)],
        *[p.arc(0.52, y, 0.16, 190, 350, 0.055) for y in (-0.10, 0.26)],
    )
    return [union(stem, bulb, waves)]


def brake(p, mark="bang"):
    ring = p.ring(0, 0, 0.44, 0.075)
    left = p.arc(-0.30, 0, 0.42, 120, 240, 0.07)
    right = p.arc(0.30, 0, 0.42, 300, 60, 0.07)
    inner = p.bang(0, -0.02, 0.24, 0.065) if mark == "bang" else p.bar(-0.16, 0, 0.16, 0, 0.07)
    return [union(ring, left, right, inner)]


def abs_symbol(p):
    ring = p.ring(0, 0, 0.44, 0.075)
    left = p.arc(-0.30, 0, 0.42, 120, 240, 0.07)
    right = p.arc(0.30, 0, 0.42, 300, 60, 0.07)
    # "ABS" is unreadable at 24pt, so the centre carries a dashed band instead.
    band = union(*[p.bar(x, 0, x, 0, 0.075) for x in (-0.17, 0, 0.17)])
    return [union(ring, left, right, band)]


def battery(p, ev=False):
    body = p.box(0, 0.06, 0.62, 0.34, 0.08)
    caps = union(
        p.box(-0.30, -0.34, 0.13, 0.10, 0.03),
        p.box(0.30, -0.34, 0.13, 0.10, 0.03),
    )
    plus = union(p.bar(-0.30, 0.06, -0.30, 0.06, 0.0), p.bar(-0.42, 0.06, -0.18, 0.06, 0.055),
                 p.bar(-0.30, -0.06, -0.30, 0.18, 0.055))
    minus = p.bar(0.18, 0.06, 0.42, 0.06, 0.055)
    if ev:
        # Cut, not drawn over: a white bolt unioned onto a white body is
        # invisible, which is exactly what the first attempt produced.
        bolt = p.poly([(0.10, -0.20), (-0.12, 0.06), (0.00, 0.06), (-0.08, 0.30),
                       (0.16, 0.02), (0.04, 0.02)], 0.02)
        return [subtract(union(body, caps), bolt)]
    return [union(body, caps, plus, minus)]


def airbag(p):
    # The seated occupant and the inflated bag between them and the wheel.
    person = union(
        p.dot(-0.44, -0.28, 0.19),
        p.poly([(-0.74, 0.54), (-0.70, 0.02), (-0.20, 0.06), (-0.12, 0.54)], 0.08),
    )
    bag = p.dot(0.22, 0.12, 0.34)
    wheel = p.bar(0.70, -0.34, 0.70, 0.46, 0.10)
    return [union(person, bag, wheel)]

def tyre(p):
    """TPMS: the tyre in cross-section with the exclamation inside it.

    Screen space runs y-downward, so the bottom half of a circle is angles
    0..180 — that is the U. The exclamation belongs in the opening between the
    walls; put it any higher and it reads as a separate mark floating above
    the tyre, which is what a first attempt drew."""
    u = p.arc(0, 0.02, 0.48, 0, 180, 0.11)
    walls = union(
        p.bar(-0.48, 0.02, -0.48, -0.40, 0.11),
        p.bar(0.48, 0.02, 0.48, -0.40, 0.11),
    )
    tread = union(*[p.bar(x, 0.56, x, 0.70, 0.055) for x in (-0.34, -0.11, 0.11, 0.34)])
    return [union(u, walls, tread, p.bang(0, 0.02, 0.26, 0.085))]

def steering(p):
    return [union(
        p.ring(0, 0.04, 0.50, 0.08),
        p.dot(0, 0.04, 0.15),
        p.bar(-0.42, 0.04, 0.42, 0.04, 0.06),
        p.bar(0, 0.16, 0, 0.50, 0.06),
    )]


def skid_car(p):
    car = p.poly([(-0.46, -0.06), (-0.28, -0.32), (0.28, -0.32), (0.46, -0.06),
                  (0.46, 0.14), (-0.46, 0.14)], 0.07)
    wheels = union(p.dot(-0.28, 0.20, 0.11), p.dot(0.28, 0.20, 0.11))
    skids = union(
        p.arc(-0.60, 0.44, 0.26, 250, 30, 0.05),
        p.arc(0.60, 0.44, 0.26, 150, 290, 0.05),
    )
    return [union(car, wheels, skids)]


def dpf(p):
    body = p.box(0, 0, 0.66, 0.34, 0.10)
    dots = union(*[p.dot(x, y, 0.075)
                   for x in (-0.30, 0, 0.30) for y in (-0.13, 0.13)])
    puffs = union(p.arc(0, -0.44, 0.18, 200, 340, 0.05),
                  p.arc(0.34, -0.52, 0.13, 200, 340, 0.05))
    return [union(subtract(body, dots), puffs)]


def droplet(p, lines=False):
    drop = union(
        p.dot(0, 0.16, 0.34),
        p.poly([(0, -0.52), (0.30, 0.10), (-0.30, 0.10)], 0.05),
    )
    if not lines:
        return [drop]
    bars = union(*[p.bar(-0.14, y, 0.14, y, 0.05) for y in (0.06, 0.24)])
    return [subtract(drop, bars)]


def coolant(p):
    # Low coolant: the tank, the fluid line inside it, and the cap on top.
    tank = p.box(0, 0.10, 0.48, 0.36, 0.09)
    cap = p.box(0, -0.34, 0.16, 0.12, 0.04)
    fluid = union(*[p.arc(x, 0.14, 0.15, 190, 350, 0.055) for x in (-0.24, 0.06, 0.36)])
    return [union(subtract(tank, fluid), cap)]

def bulb(p):
    glass = p.dot(0, -0.14, 0.36)
    base = p.box(0, 0.30, 0.20, 0.16, 0.04)
    rays = union(*[
        p.bar(0.52 * math.cos(math.radians(a)), -0.14 + 0.52 * math.sin(math.radians(a)),
              0.74 * math.cos(math.radians(a)), -0.14 + 0.74 * math.sin(math.radians(a)), 0.05)
        for a in (200, 250, 290, 340)
    ])
    return [union(glass, base, rays)]


def key(p):
    return [union(
        p.ring(-0.34, -0.10, 0.26, 0.075),
        p.bar(-0.12, 0.02, 0.62, 0.36, 0.075),
        p.bar(0.34, 0.20, 0.44, 0.02, 0.06),
        p.bar(0.50, 0.28, 0.60, 0.10, 0.06),
    )]


def radar_car(p):
    # Collision warning: the car, and the obstacle it is being warned about.
    car = p.poly([(-0.08, 0.02), (0.10, -0.26), (0.56, -0.26), (0.74, 0.02),
                  (0.74, 0.26), (-0.08, 0.26)], 0.07)
    wheels = union(p.dot(0.12, 0.32, 0.11), p.dot(0.56, 0.32, 0.11))
    waves = union(*[p.arc(-0.26, 0.06, r, 110, 250, 0.06) for r in (0.16, 0.34, 0.52)])
    return [union(car, wheels, waves)]

def suspension(p):
    # Air suspension: the car body, and the ride height it is holding.
    body = p.poly([(-0.62, -0.40), (-0.40, -0.62), (0.40, -0.62), (0.62, -0.40),
                   (0.62, -0.16), (-0.62, -0.16)], 0.07)
    road = p.bar(-0.66, 0.56, 0.66, 0.56, 0.075)
    arrows = union(
        p.bar(0, -0.02, 0, 0.42, 0.065),
        p.poly([(0, 0.56), (0.17, 0.32), (-0.17, 0.32)], 0.02),
        p.poly([(0, -0.14), (0.17, 0.10), (-0.17, 0.10)], 0.02),
    )
    return [union(body, road, arrows)]

def turtle(p):
    shell = p.arc(0, 0.16, 0.46, 180, 360, 0.10)
    belly = p.bar(-0.46, 0.16, 0.46, 0.16, 0.07)
    head = p.dot(0.58, 0.02, 0.13)
    legs = union(p.bar(-0.30, 0.20, -0.34, 0.42, 0.07), p.bar(0.24, 0.20, 0.30, 0.42, 0.07))
    return [union(shell, belly, head, legs)]


def hybrid(p):
    return [union(
        p.arc(0, 0, 0.46, 200, 110, 0.08),
        p.poly([(0.32, -0.44), (0.52, -0.24), (0.24, -0.16)], 0.02),
        p.poly([(0.10, -0.14), (-0.08, 0.10), (0.02, 0.10), (-0.04, 0.32),
                (0.16, 0.04), (0.06, 0.04)], 0.02),
    )]


def glow_plug(p):
    stem = p.bar(-0.62, -0.20, 0.10, -0.20, 0.085)
    coil = union(*[p.arc(0.18 + i * 0.20, -0.20, 0.16, 200, 20, 0.07) for i in range(3)])
    return [union(stem, coil)]


def plug(p):
    body = p.box(0, 0.12, 0.34, 0.28, 0.08)
    pins = union(p.bar(-0.18, -0.44, -0.18, -0.12, 0.07), p.bar(0.18, -0.44, 0.18, -0.12, 0.07))
    lead = p.bar(0, 0.40, 0, 0.62, 0.07)
    return [union(body, pins, lead)]


def spanner(p):
    # An open-end spanner: a round head with a slot bitten out of it, on a
    # shaft. The bite is what makes it a spanner rather than a lollipop.
    head = subtract(
        p.dot(-0.34, -0.34, 0.30),
        union(
            p.dot(-0.34, -0.34, 0.15),
            p.poly([(-0.74, -0.76), (-0.14, -0.76), (-0.14, -0.40), (-0.74, -0.40)], 0.02),
        ),
    )
    shaft = p.bar(-0.20, -0.16, 0.44, 0.48, 0.115)
    return [union(head, shaft)]

def fuel_pump(p):
    body = p.box(-0.18, 0.02, 0.34, 0.44, 0.07)
    base = p.bar(-0.58, 0.50, 0.22, 0.50, 0.07)
    window = p.box(-0.18, -0.20, 0.20, 0.13, 0.03)
    hose = union(p.bar(0.18, -0.28, 0.48, -0.28, 0.06), p.bar(0.48, -0.28, 0.48, 0.24, 0.06),
                 p.bar(0.48, 0.24, 0.30, 0.24, 0.06))
    return [union(subtract(body, window), base, hose)]


def door_ajar(p):
    """The car from above with both doors open.

    Drawn as outlines with a real gap at the hinge. Solid shapes at this scale
    fuse into one mass — earlier attempts produced first a plus sign and then
    an aeroplane."""
    body = subtract(
        p.poly([(-0.26, -0.66), (0.26, -0.66), (0.26, 0.66), (-0.26, 0.66)], 0.09),
        p.poly([(-0.14, -0.54), (0.14, -0.54), (0.14, 0.54), (-0.14, 0.54)], 0.05),
    )
    left = subtract(
        p.poly([(-0.40, -0.30), (-0.84, -0.12), (-0.84, 0.20), (-0.40, 0.06)], 0.06),
        p.poly([(-0.50, -0.18), (-0.74, -0.08), (-0.74, 0.10), (-0.50, 0.00)], 0.03),
    )
    right = subtract(
        p.poly([(0.40, -0.30), (0.84, -0.12), (0.84, 0.20), (0.40, 0.06)], 0.06),
        p.poly([(0.50, -0.18), (0.74, -0.08), (0.74, 0.10), (0.50, 0.00)], 0.03),
    )
    return [union(body, left, right)]

def beam(p, rear_fog=False):
    lamp = union(
        p.arc(-0.20, 0, 0.42, 90, 270, 0.09),
        p.bar(-0.20, -0.42, -0.20, 0.42, 0.09),
    )
    if rear_fog:
        rays = union(*[union(p.bar(0.06, y, 0.44, y, 0.055),
                             p.bar(0.52, y, 0.72, y, 0.055)) for y in (-0.24, 0, 0.24)])
        squiggle = p.arc(0.40, 0.40, 0.20, 180, 0, 0.05)
        return [union(lamp, rays, squiggle)]
    rays = union(*[p.bar(0.06, y, 0.70, y, 0.055) for y in (-0.24, 0, 0.24)])
    return [union(lamp, rays)]


def cruise(p):
    # A speedometer holding a set speed: the dial, its ticks, and the needle.
    ticks = union(*[
        p.bar(0.40 * math.cos(math.radians(a)), 0.06 + 0.40 * math.sin(math.radians(a)),
              0.54 * math.cos(math.radians(a)), 0.06 + 0.54 * math.sin(math.radians(a)), 0.055)
        for a in (180, 225, 270, 315, 0)
    ])
    return [union(
        p.arc(0, 0.06, 0.56, 180, 0, 0.085),
        ticks,
        p.bar(0, 0.06, 0.30, -0.26, 0.07),
        p.dot(0, 0.06, 0.10),
    )]

def snowflake(p):
    arms = []
    for a in (90, 30, 150):
        dx, dy = math.cos(math.radians(a)), math.sin(math.radians(a))
        arms.append(p.bar(-0.56 * dx, -0.56 * dy, 0.56 * dx, 0.56 * dy, 0.06))
        for t in (0.30, -0.30):
            px_, py_ = 0.34 * dx, 0.34 * dy
            arms.append(p.bar(px_, py_,
                              px_ + 0.22 * math.cos(math.radians(a + 140 * (1 if t > 0 else -1))),
                              py_ + 0.22 * math.sin(math.radians(a + 140 * (1 if t > 0 else -1))), 0.05))
    return [union(*arms)]


def seatbelt(p):
    # A seated figure with the belt crossing the torso and running past it on
    # both ends — a strap that stops at the body reads as a stripe, not a belt.
    person = union(
        p.dot(-0.06, -0.40, 0.19),
        p.poly([(-0.40, 0.56), (-0.34, -0.06), (0.22, -0.06), (0.34, 0.56)], 0.08),
    )
    channel = p.bar(-0.56, 0.06, 0.44, 0.52, 0.135)
    belt = p.bar(-0.56, 0.06, 0.44, 0.52, 0.085)
    return [union(subtract(person, channel), belt)]

def start_stop(p):
    # The power mark: a ring broken at the top with a bar rising through the
    # gap. The literal symbol is an "A" in a circle, which is illegible at the
    # size this is actually shown.
    return [union(
        p.arc(0, 0.04, 0.46, 300, 240, 0.085),
        p.bar(0, -0.50, 0, 0.02, 0.085),
    )]

def triangle_bang(p):
    tri = p.poly([(0, -0.58), (0.66, 0.44), (-0.66, 0.44)], 0.07)
    return [subtract(tri, p.bang(0, 0.04, 0.20, 0.055))]


def catalytic(p):
    body = p.box(0, 0.02, 0.52, 0.24, 0.08)
    pipes = union(p.bar(-0.78, 0.02, -0.50, 0.02, 0.08), p.bar(0.50, 0.02, 0.78, 0.02, 0.08))
    heat = union(*[p.arc(x, -0.40, 0.15, 200, 340, 0.05) for x in (-0.28, 0.04, 0.36)])
    return [union(body, pipes, heat)]


def ev_ready(p):
    car = p.poly([(-0.52, 0.06), (-0.32, -0.24), (0.32, -0.24), (0.52, 0.06),
                  (0.52, 0.26), (-0.52, 0.26)], 0.07)
    wheels = union(p.dot(-0.30, 0.32, 0.11), p.dot(0.30, 0.32, 0.11))
    bolt = p.poly([(0.08, -0.62), (-0.10, -0.34), (0.00, -0.34), (-0.06, -0.12),
                   (0.16, -0.42), (0.06, -0.42)], 0.02)
    return [union(car, wheels, bolt)]


def regen(p):
    return [union(
        p.arc(0, 0, 0.44, 200, 110, 0.08),
        p.poly([(0.30, -0.44), (0.52, -0.22), (0.22, -0.16)], 0.02),
        p.ring(0, 0, 0.18, 0.06),
    )]


def epb(p):
    ring = p.ring(0, 0, 0.44, 0.075)
    left = p.arc(-0.30, 0, 0.42, 120, 240, 0.07)
    right = p.arc(0.30, 0, 0.42, 300, 60, 0.07)
    # A "P" reduced to its readable parts at 24pt: a stem and a bowl.
    stem = p.bar(-0.10, -0.22, -0.10, 0.22, 0.07)
    bowl = p.arc(0.02, -0.10, 0.14, 270, 90, 0.07)
    return [union(ring, left, right, stem, bowl)]


def pad_wear(p):
    disc = p.ring(0, 0, 0.42, 0.08)
    pads = union(p.box(-0.60, 0, 0.09, 0.26, 0.03), p.box(0.60, 0, 0.09, 0.26, 0.03))
    dashes = union(*[p.bar(-0.30 + i * 0.30, -0.52, -0.22 + i * 0.30, -0.52, 0.05)
                     for i in range(3)])
    return [union(disc, pads, dashes)]


def water_in_fuel(p):
    body = p.box(-0.18, 0.02, 0.32, 0.42, 0.07)
    base = p.bar(-0.56, 0.50, 0.20, 0.50, 0.07)
    hose = union(p.bar(0.16, -0.28, 0.46, -0.28, 0.06), p.bar(0.46, -0.28, 0.46, 0.20, 0.06))
    drop = union(p.dot(-0.18, 0.06, 0.13),
                 p.poly([(-0.18, -0.24), (-0.05, 0.02), (-0.31, 0.02)], 0.02))
    return [union(subtract(body, drop), base, hose)]


def washer(p):
    # The windscreen with the jet playing across it: a trapezoid, a wiper
    # sweeping up it, and spray arriving from the left.
    screen = p.poly([(-0.46, 0.36), (-0.30, -0.18), (0.50, -0.18), (0.62, 0.36)], 0.07)
    wiper = p.bar(-0.16, 0.30, 0.36, -0.08, 0.075)
    spray = union(*[
        p.bar(-0.88, y, -0.60, y - 0.10, 0.055) for y in (-0.26, -0.04, 0.18)
    ])
    return [union(screen, wiper, spray)]

def ev_fault(p):
    body = p.box(0, 0.08, 0.60, 0.32, 0.08)
    caps = union(p.box(-0.28, -0.30, 0.12, 0.10, 0.03), p.box(0.28, -0.30, 0.12, 0.10, 0.03))
    bolt = p.poly([(0.06, -0.14), (-0.12, 0.10), (-0.02, 0.10), (-0.08, 0.30),
                   (0.14, 0.04), (0.04, 0.04)], 0.02)
    return [union(subtract(union(body, caps), bolt))]


def esc_off(p):
    # Stability control switched off: the skidding car, struck through. The
    # strike is cut clear of the shapes beneath so it reads as crossing them
    # rather than merging into them.
    car = p.poly([(-0.38, -0.10), (-0.22, -0.34), (0.22, -0.34), (0.38, -0.10),
                  (0.38, 0.08), (-0.38, 0.08)], 0.07)
    wheels = union(p.dot(-0.22, 0.14, 0.10), p.dot(0.22, 0.14, 0.10))
    skids = union(p.arc(-0.54, 0.40, 0.22, 250, 30, 0.055),
                  p.arc(0.54, 0.40, 0.22, 150, 290, 0.055))
    gap = p.bar(-0.72, -0.72, 0.72, 0.72, 0.165)
    slash = p.bar(-0.66, -0.66, 0.66, 0.66, 0.085)
    return [union(subtract(union(car, wheels, skids), gap), slash)]


GLYPHS = {
    "engine": engine,
    "oil-can": oil_can,
    "thermometer": thermometer,
    "brake": lambda p: brake(p),
    "abs": abs_symbol,
    "battery": lambda p: battery(p),
    "ev-battery": lambda p: battery(p, ev=True),
    "ev-fault": ev_fault,
    "airbag": airbag,
    "tyre": tyre,
    "steering": steering,
    "skid-car": skid_car,
    "esc-off": esc_off,
    "dpf": dpf,
    "droplet": lambda p: droplet(p, lines=True),
    "coolant": coolant,
    "bulb": bulb,
    "key": key,
    "radar-car": radar_car,
    "suspension": suspension,
    "turtle": turtle,
    "hybrid": hybrid,
    "glow-plug": glow_plug,
    "plug": plug,
    "spanner": spanner,
    "fuel-pump": fuel_pump,
    "door-ajar": door_ajar,
    "high-beam": lambda p: beam(p),
    "rear-fog": lambda p: beam(p, rear_fog=True),
    "cruise": cruise,
    "snowflake": snowflake,
    "seatbelt": seatbelt,
    "start-stop": start_stop,
    "warning-triangle": triangle_bang,
    "catalytic": catalytic,
    "ev-ready": ev_ready,
    "regen": regen,
    "epb": epb,
    "pad-wear": pad_wear,
    "water-in-fuel": water_in_fuel,
    "washer": washer,
}


def main():
    out = ROOT / "assets" / "symbols"
    out.mkdir(parents=True, exist_ok=True)
    pen = Pen(SIZE)
    for name, build in sorted(GLYPHS.items()):
        shapes = [(fn, WHITE) for fn in build(pen)]
        write_png(out / f"{name}.png", render(SIZE, None, shapes), SIZE, SIZE)
        print(f"symbols/{name}.png")
    print(f"\n{len(GLYPHS)} symbols")


if __name__ == "__main__":
    main()
