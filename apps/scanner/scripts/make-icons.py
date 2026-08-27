#!/usr/bin/env python3
"""
Generates the app icons for every scanner pack.

No image libraries are available (or wanted) in this project, so shapes are
rendered from signed distance fields straight into a PNG written with zlib.
Anti-aliasing comes from the SDF itself, which keeps edges clean at every
size without supersampling a huge buffer.

    python3 scripts/make-icons.py
"""
import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------- png output

def write_png(path: Path, pixels: bytearray, w: int, h: int) -> None:
    """pixels is RGBA, row-major, 4 bytes per pixel."""
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)  # filter type 0 (None)
        raw += pixels[y * stride : (y + 1) * stride]

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


# ------------------------------------------------------------------- shapes
# Each returns a signed distance: negative inside, positive outside.

def sd_circle(px, py, cx, cy, r):
    return math.hypot(px - cx, py - cy) - r


def sd_round_rect(px, py, cx, cy, hw, hh, r):
    dx = abs(px - cx) - (hw - r)
    dy = abs(py - cy) - (hh - r)
    outside = math.hypot(max(dx, 0.0), max(dy, 0.0))
    return outside + min(max(dx, dy), 0.0) - r


def sd_capsule(px, py, ax, ay, bx, by, r):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    denom = vx * vx + vy * vy
    t = 0.0 if denom == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / denom))
    return math.hypot(wx - vx * t, wy - vy * t) - r


def make_triangle(verts, radius):
    """Rounded convex polygon as a distance function.

    Uses the exact distance to the boundary — taking `max` of the edge
    half-planes and subtracting the radius miters the corners outward
    instead of rounding them, which visibly inflates a sharp shape like a
    triangle well past its nominal size.
    """
    gx = sum(v[0] for v in verts) / 3
    gy = sum(v[1] for v in verts) / 3

    segs = []
    planes = []
    for i in range(3):
        ax, ay = verts[i]
        bx, by = verts[(i + 1) % 3]
        ex, ey = bx - ax, by - ay
        length = math.hypot(ex, ey)
        nx, ny = ey / length, -ex / length
        # The centroid must be inside, i.e. at a negative distance.
        if (gx - ax) * nx + (gy - ay) * ny > 0:
            nx, ny = -nx, -ny
        segs.append((ax, ay, ex, ey, ex * ex + ey * ey))
        planes.append((ax, ay, nx, ny))

    def dist(px, py):
        best = float("inf")
        for ax, ay, ex, ey, denom in segs:
            wx, wy = px - ax, py - ay
            t = max(0.0, min(1.0, (wx * ex + wy * ey) / denom))
            d = math.hypot(wx - ex * t, wy - ey * t)
            if d < best:
                best = d
        inside = all((px - ax) * nx + (py - ay) * ny <= 0 for ax, ay, nx, ny in planes)
        return (-best if inside else best) - radius

    return dist


# ------------------------------------------------------------------ painting

def blend(pixels, idx, colour, alpha):
    if alpha <= 0:
        return
    r, g, b = colour
    if alpha >= 1:
        pixels[idx] = r
        pixels[idx + 1] = g
        pixels[idx + 2] = b
        pixels[idx + 3] = 255
        return
    inv = 1 - alpha
    pixels[idx] = int(pixels[idx] * inv + r * alpha)
    pixels[idx + 1] = int(pixels[idx + 1] * inv + g * alpha)
    pixels[idx + 2] = int(pixels[idx + 2] * inv + b * alpha)
    pixels[idx + 3] = int(pixels[idx + 3] * inv + 255 * alpha)


def render(size, background, shapes, feather=1.4):
    """shapes: list of (distance_fn, colour). Painted in order."""
    pixels = bytearray(size * size * 4)
    if background is not None:
        r, g, b = background
        for i in range(0, len(pixels), 4):
            pixels[i] = r
            pixels[i + 1] = g
            pixels[i + 2] = b
            pixels[i + 3] = 255

    half = feather / 2
    for y in range(size):
        py = y + 0.5
        row = y * size * 4
        for dist_fn, colour in shapes:
            for x in range(size):
                d = dist_fn(x + 0.5, py)
                if d > half:
                    continue
                alpha = 1.0 if d < -half else (half - d) / feather
                blend(pixels, row + x * 4, colour, alpha)
    return pixels


def rounded_square_bg(size, radius_ratio, colour):
    r = size * radius_ratio
    fn = lambda px, py: sd_round_rect(px, py, size / 2, size / 2, size / 2, size / 2, r)
    return (fn, colour)


# -------------------------------------------------------------------- marks

def warning_mark(size, scale=1.0):
    """Amber warning triangle with the exclamation punched out — the symbol
    every driver already recognises from their own dashboard."""
    c = size / 2
    s = size * scale
    tri_h = s * 0.62
    tri_w = s * 0.72
    apex_y = c - tri_h * 0.55
    base_y = c + tri_h * 0.45
    verts = [
        (c, apex_y),
        (c - tri_w / 2, base_y),
        (c + tri_w / 2, base_y),
    ]
    return verts, s


def build_dashlight(size, scale=1.0, background=(20, 23, 31)):
    amber = (242, 163, 60)
    dark = background if background else (20, 23, 31)
    verts, s = warning_mark(size, scale)
    tri = make_triangle(verts, s * 0.07)

    c = size / 2
    bar_top = c - s * 0.13
    bar_bottom = c + s * 0.10
    bar_r = s * 0.035
    bar = lambda px, py: sd_capsule(px, py, c, bar_top, c, bar_bottom, bar_r)
    dot = lambda px, py: sd_circle(px, py, c, c + s * 0.20, s * 0.045)

    shapes = [(tri, amber), (bar, dark), (dot, dark)]
    return shapes


def build_bugscan(size, scale=1.0, background=(15, 23, 20)):
    green = (91, 192, 138)
    c = size / 2
    s = size * scale

    body_cx, body_cy = c, c + s * 0.06
    body_r = s * 0.20
    # Abdomen: two overlapping circles read as a segmented body at icon size.
    abdomen = lambda px, py: sd_circle(px, py, body_cx, body_cy + s * 0.09, body_r)
    thorax = lambda px, py: sd_circle(px, py, body_cx, body_cy - s * 0.11, s * 0.135)
    head = lambda px, py: sd_circle(px, py, body_cx, body_cy - s * 0.255, s * 0.085)

    legs = []
    for side in (-1, 1):
        for i, (y_off, spread, drop) in enumerate(
            ((-0.14, 0.30, -0.16), (-0.02, 0.33, 0.02), (0.10, 0.30, 0.20))
        ):
            ax = body_cx + side * s * 0.10
            ay = body_cy + s * y_off
            bx = body_cx + side * s * spread
            by = body_cy + s * drop
            legs.append(
                (lambda px, py, a=(ax, ay), b=(bx, by): sd_capsule(
                    px, py, a[0], a[1], b[0], b[1], s * 0.026
                ), green)
            )

    antennae = []
    for side in (-1, 1):
        ax = body_cx + side * s * 0.04
        ay = body_cy - s * 0.30
        bx = body_cx + side * s * 0.17
        by = body_cy - s * 0.44
        antennae.append(
            (lambda px, py, a=(ax, ay), b=(bx, by): sd_capsule(
                px, py, a[0], a[1], b[0], b[1], s * 0.022
            ), green)
        )

    return legs + antennae + [(abdomen, green), (thorax, green), (head, green)]


# --------------------------------------------------------------------- packs

PACKS = {
    "dashlight": {"bg": (20, 23, 31), "build": build_dashlight},
    "bugscan": {"bg": (15, 23, 20), "build": build_bugscan},
}


def main():
    for name, spec in PACKS.items():
        out = ROOT / "assets" / name
        out.mkdir(parents=True, exist_ok=True)
        bg = spec["bg"]
        build = spec["build"]

        # icon.png — full-bleed square; iOS applies its own corner mask.
        size = 1024
        write_png(out / "icon.png", render(size, bg, build(size, 0.84, bg)), size, size)
        print(f"{name}/icon.png")

        # adaptive-icon.png — Android crops ~25% per side, so the mark sits
        # inside the safe zone over a transparent background.
        size = 1024
        px = render(size, None, build(size, 0.62, bg))
        write_png(out / "adaptive-icon.png", px, size, size)
        print(f"{name}/adaptive-icon.png")

        # splash-icon.png — mark only, transparent.
        size = 512
        write_png(out / "splash-icon.png", render(size, None, build(size, 0.9, bg)), size, size)
        print(f"{name}/splash-icon.png")

        # favicon.png — web.
        size = 64
        write_png(out / "favicon.png", render(size, bg, build(size, 0.84, bg)), size, size)
        print(f"{name}/favicon.png")


if __name__ == "__main__":
    main()
