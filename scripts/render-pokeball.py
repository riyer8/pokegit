#!/usr/bin/env python3
"""Render a smooth Pokéball PNG set from geometry (no pixel-art source)."""
from __future__ import annotations

import math
import os
import struct
import zlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "icons")

RED_TOP = (255, 112, 78)
RED_MID = (227, 53, 13)
RED_DEEP = (176, 24, 12)
WHITE_TOP = (255, 255, 255)
WHITE_BOT = (232, 226, 216)
INK = (22, 30, 44)


def write_png(path: str, w: int, h: int, rgba: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + rgba[y * w * 4 : (y + 1) * w * 4] for y in range(h))
    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n")
        fh.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)))
        fh.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        fh.write(chunk(b"IEND", b""))


def mix(a, b, t: float):
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def coverage(dist: float, radius: float, aa: float) -> float:
    if dist <= radius - aa:
        return 1.0
    if dist >= radius + aa:
        return 0.0
    return (radius + aa - dist) / (2 * aa)


def sample(x: float, y: float, cx: float, cy: float, r: float):
    dx = x - cx
    dy = y - cy
    d = math.hypot(dx, dy)
    aa = max(0.85, r * 0.012)
    alpha = coverage(d, r, aa)
    if alpha <= 0:
        return (0, 0, 0, 0)

    ny = dy / r
    band = coverage(abs(dy), r * 0.055, aa)
    button = coverage(d, r * 0.20, aa)
    button_face = coverage(d, r * 0.11, aa)
    button_core = coverage(d, r * 0.045, aa)
    outline = coverage(d, r - r * 0.045, aa)

    if ny < 0:
        t = min(1.0, (dy + r) / r)
        col = mix(mix(RED_TOP, RED_MID, t), RED_DEEP, max(0.0, t - 0.55) / 0.45)
    else:
        col = mix(WHITE_TOP, WHITE_BOT, min(1.0, ny))

    col = mix(INK, col, outline)
    col = mix(col, INK, band * (1.0 - button))
    col = mix(col, INK, button)
    col = mix(col, WHITE_TOP, button_face)
    col = mix(col, INK, button_core)

    gx = (dx + r * 0.28) / r
    gy = (dy + r * 0.34) / r
    gloss = math.exp(-(gx * gx + gy * gy) / 0.18)
    if ny < 0:
        col = mix(col, (255, 255, 255), gloss * 0.32 * (1.0 - button))

    return (*[int(round(c)) for c in col], int(round(alpha * 255)))


def render(size: int, scale: int) -> bytes:
    hi = size * scale
    cx = cy = (hi - 1) / 2
    r = hi * 0.46
    acc = [[0, 0, 0, 0] for _ in range(size * size)]
    for y in range(hi):
        for x in range(hi):
            px, py, pz, pa = sample(x, y, cx, cy, r)
            ox, oy = x // scale, y // scale
            i = oy * size + ox
            acc[i][0] += px * pa
            acc[i][1] += py * pa
            acc[i][2] += pz * pa
            acc[i][3] += pa
    n = scale * scale
    out = bytearray(size * size * 4)
    for i, (sr, sg, sb, sa) in enumerate(acc):
        a = sa / n
        j = i * 4
        if a < 0.4:
            out[j : j + 4] = b"\x00\x00\x00\x00"
            continue
        out[j] = min(255, int(sr / sa))
        out[j + 1] = min(255, int(sg / sa))
        out[j + 2] = min(255, int(sb / sa))
        out[j + 3] = min(255, int(round(a)))
    return bytes(out)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    jobs = [(16, 12), (32, 10), (48, 8), (128, 8)]
    for size, scale in jobs:
        rgba = render(size, scale)
        dest = os.path.join(OUT, f"icon{size}.png")
        write_png(dest, size, size, rgba)
        print(f"wrote {dest} ({len(rgba)} bytes raster)")


if __name__ == "__main__":
    main()
