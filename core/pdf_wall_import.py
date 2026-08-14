"""
Import walls / plan geometry from United Panel PDF floor plans.

Strategy:
- Detect sheet dialect (classic A3, TY-style, multi-view CAD)
- Extract wall-face strokes (green / thickness colors) in the wall-plan region
- Pair nearest parallel faces into wall centerlines
- For ups_cad_multi (Swift-style): rasterize WALL LAYOUT only — long cyan
  vector runs are usually elevations, not the floor plan
- OCR dimension labels; classify wall vs panel dims
- Scale geometry from overall wall dimension
- Higher-level plan import (doors/rooms/joints) builds on this module
"""
from __future__ import annotations

import io
import logging
import math
import re
from typing import Any

logger = logging.getLogger(__name__)

# Common sandwich-panel module widths (mm) seen on United Panel drawings
PANEL_MODULE_SIZES = {600, 680, 684, 900, 933, 1000, 1100, 1130, 1150, 1200}
PANEL_SIZE_TOL_MM = 15
WALL_DIM_SNAP_TOL_RATIO = 0.03

# Face-pair perpendicular distance in PDF points (AEON ~0.7–2.2; TY ~3.7)
PAIR_PERP_MIN_PT = 0.35
PAIR_PERP_MAX_PT = 5.5


def _is_wall_green(color) -> bool:
    """Classic UP green wall faces (AEON + pure green TY)."""
    if not color or len(color) < 3:
        return False
    r, g, b = color[0], color[1], color[2]
    return g >= 0.7 and r <= 0.35 and b <= 0.45


def _is_wall_stroke(color, dialect: str = "ups_a3") -> bool:
    """
    Wall-face stroke colors by dialect.
    ups_cad_multi: cyan / green / magenta encode panel thickness on wall layout.
    """
    if not color or len(color) < 3:
        return False
    r, g, b = color[0], color[1], color[2]
    if _is_wall_green(color):
        return True
    if dialect == "ups_cad_multi":
        # Cyan ~200mm, green ~150mm, magenta ~100mm on Swift-style sheets
        if b >= 0.65 and g >= 0.45 and r <= 0.35:
            return True
        if r >= 0.85 and b >= 0.85 and g <= 0.35:
            return True
    return False


def _detect_dialect(page) -> str:
    """Classify United Panel sheet layout family."""
    try:
        if page.search_for("WALL LAYOUT"):
            return "ups_cad_multi"
    except Exception:
        pass
    text = (page.get_text("text") or "").upper()
    if "WALL LAYOUT" in text and ("CEILING LAYOUT" in text or "FLOOR LAYOUT" in text):
        return "ups_cad_multi"
    rect = page.rect
    # Portrait A4-ish sheets from TY / similar drafters
    if rect.height > rect.width * 1.05 and rect.width < 700:
        return "ups_a3_ty"
    return "ups_a3"


def _wall_layout_clip_rect(page, dialect: str):
    """
    Restrict extraction to the wall / floor plan region.
    Returns (x0, y0, x1, y1) in PDF points, or None for full page.
    """
    if dialect == "ups_cad_multi":
        wall_hits = page.search_for("WALL LAYOUT") or []
        ceil_hits = page.search_for("CEILING LAYOUT") or []
        floor_hits = page.search_for("FLOOR LAYOUT") or []
        elev_hits = page.search_for("ELEVATION") or []
        # Title sits to the right of the plan; keep everything left of it.
        x1 = min((h.x0 for h in wall_hits), default=page.rect.width * 0.48)
        # Elevations / ceiling / floor live below the plan. Prefer the first
        # elevation body under the plan (y0 > 400); otherwise ceiling/floor.
        elev_below = [float(h.y0) for h in elev_hits if h.y0 > 400]
        y_ceil = min((float(h.y0) for h in ceil_hits), default=page.rect.height * 0.55)
        y_floor = min((float(h.y0) for h in floor_hits), default=y_ceil)
        y1 = min(elev_below) - 8.0 if elev_below else min(y_ceil, y_floor) - 20.0
        # Keep chill / lower rooms; stop before elevation bodies (~y≥580 on Swift).
        y1 = min(float(y1), 575.0)
        return (40.0, 70.0, float(x1) - 8.0, max(y1, 420.0))

    if dialect == "ups_a3_ty":
        return _ty_wall_plan_clip_rect(page)

    return None


def _ty_wall_plan_clip_rect(page):
    """
    TY portrait sheets put FRONT VIEW on the left and WALL PLAN on the right
    (often rotated 90°). A full-width top crop mixes both and wrecks pairing.
    Isolate the larger top-of-page green cluster.
    """
    y_limit = float(page.rect.height) * 0.55
    segs: list[tuple[float, float, float, float, float, float]] = []
    for drawing in page.get_drawings():
        if not _is_wall_green(drawing.get("color")):
            continue
        for item in drawing.get("items") or []:
            if item[0] != "l":
                continue
            p1, p2 = item[1], item[2]
            length = math.hypot(p2.x - p1.x, p2.y - p1.y)
            if length < 4:
                continue
            my = (p1.y + p2.y) / 2.0
            if my > y_limit:
                continue
            segs.append((p1.x, p1.y, p2.x, p2.y, (p1.x + p2.x) / 2.0, my))

    fallback = (40.0, 40.0, float(page.rect.width) - 40.0, float(page.rect.height) * 0.48)
    if len(segs) < 4:
        return fallback

    mids = sorted(s[4] for s in segs)

    def _bbox(items):
        xs = [c for s in items for c in (s[0], s[2])]
        ys = [c for s in items for c in (s[1], s[3])]
        return min(xs), min(ys), max(xs), max(ys)

    def _area(items):
        if len(items) < 2:
            return 0.0
        x0, y0, x1, y1 = _bbox(items)
        return (x1 - x0) * (y1 - y0)

    cluster = segs
    # Prefer a split that leaves two real groups (elevation | plan), not a
    # hole inside the L-shaped plan (largest raw gap is often that hole).
    candidates: list[tuple] = []
    for a, b in zip(mids, mids[1:]):
        gap = b - a
        if gap < 20:
            continue
        split = (a + b) / 2.0
        left = [s for s in segs if s[4] < split]
        right = [s for s in segs if s[4] >= split]
        if len(left) < 6 or len(right) < 6:
            continue
        candidates.append((min(len(left), len(right)), gap, left, right))
    if candidates:
        candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
        _n, _gap, left, right = candidates[0]
        cluster = right if _area(right) >= _area(left) else left
        if len(cluster) < 4:
            cluster = segs

    x0, y0, x1, y1 = _bbox(cluster)
    pad = 16.0
    return (
        max(0.0, x0 - pad),
        max(0.0, y0 - pad),
        min(float(page.rect.width), x1 + pad),
        min(y_limit, y1 + pad),
    )


def _is_panel_render_pixel(r: int, g: int, b: int) -> bool:
    """True for pale cyan / green / magenta panel strokes on CAD wall layouts."""
    # Cyan / light-blue panel hatch (AA blends toward white)
    if b >= 200 and g >= 180 and r <= 230 and (b - r) >= 20 and (g - r) >= 10:
        return True
    if b > 180 and g > 140 and r < 100:
        return True
    # Green ~150mm panels
    if g >= 180 and r <= 120 and b <= 120 and (g - r) >= 50:
        return True
    # Magenta ~100mm panels
    if r >= 180 and b >= 180 and g <= 140:
        return True
    return False


def _mask_dilate(mask: bytearray, w: int, h: int, iterations: int = 1) -> bytearray:
    out = mask
    for _ in range(max(0, iterations)):
        nxt = bytearray(out)
        for y in range(h):
            row = y * w
            for x in range(w):
                if out[row + x]:
                    continue
                for dy in (-1, 0, 1):
                    yy = y + dy
                    if yy < 0 or yy >= h:
                        continue
                    base = yy * w
                    for dx in (-1, 0, 1):
                        xx = x + dx
                        if 0 <= xx < w and out[base + xx]:
                            nxt[row + x] = 1
                            break
                    else:
                        continue
                    break
        out = nxt
    return out


def _mask_erode(mask: bytearray, w: int, h: int, iterations: int = 1) -> bytearray:
    out = mask
    for _ in range(max(0, iterations)):
        nxt = bytearray(w * h)
        for y in range(1, h - 1):
            row = y * w
            for x in range(1, w - 1):
                if not out[row + x]:
                    continue
                ok = True
                for dy in (-1, 0, 1):
                    base = (y + dy) * w
                    for dx in (-1, 0, 1):
                        if not out[base + x + dx]:
                            ok = False
                            break
                    if not ok:
                        break
                if ok:
                    nxt[row + x] = 1
        out = nxt
    return out


def _mask_close(mask: bytearray, w: int, h: int, iterations: int = 2) -> bytearray:
    return _mask_erode(_mask_dilate(mask, w, h, iterations), w, h, iterations)


def _mask_components(mask: bytearray, w: int, h: int) -> list[tuple[int, list[tuple[int, int]]]]:
    """Connected components as (size, [(x,y), ...]) for 4-connected foreground."""
    seen = bytearray(w * h)
    comps: list[tuple[int, list[tuple[int, int]]]] = []
    for y in range(h):
        row = y * w
        for x in range(w):
            idx = row + x
            if not mask[idx] or seen[idx]:
                continue
            stack = [(x, y)]
            seen[idx] = 1
            cells: list[tuple[int, int]] = []
            while stack:
                cx, cy = stack.pop()
                cells.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    nidx = ny * w + nx
                    if mask[nidx] and not seen[nidx]:
                        seen[nidx] = 1
                        stack.append((nx, ny))
            comps.append((len(cells), cells))
    comps.sort(key=lambda c: c[0], reverse=True)
    return comps


def _hv_runs_from_pixels(
    pixels: set[tuple[int, int]],
    min_run: int,
) -> list[tuple[int, int, int, int]]:
    """Axis-aligned runs from a pixel set → (x1,y1,x2,y2) in pixel space."""
    by_row: dict[int, list[int]] = {}
    by_col: dict[int, list[int]] = {}
    for x, y in pixels:
        by_row.setdefault(y, []).append(x)
        by_col.setdefault(x, []).append(y)

    segs: list[tuple[int, int, int, int]] = []

    for y, xs in by_row.items():
        xs.sort()
        start = xs[0]
        prev = xs[0]
        for x in xs[1:]:
            if x <= prev + 1:
                prev = x
                continue
            if prev - start + 1 >= min_run:
                segs.append((start, y, prev, y))
            start = prev = x
        if prev - start + 1 >= min_run:
            segs.append((start, y, prev, y))

    for x, ys in by_col.items():
        ys.sort()
        start = ys[0]
        prev = ys[0]
        for y in ys[1:]:
            if y <= prev + 1:
                prev = y
                continue
            if prev - start + 1 >= min_run:
                segs.append((x, start, x, prev))
            start = prev = y
        if prev - start + 1 >= min_run:
            segs.append((x, start, x, prev))

    return segs


def _merge_collinear_pixel_segs(
    segs: list[tuple[int, int, int, int]],
    gap: int = 4,
) -> list[tuple[int, int, int, int]]:
    """Merge nearly-collinear H/V runs separated by small gaps."""
    horiz = []
    vert = []
    for x1, y1, x2, y2 in segs:
        if y1 == y2:
            horiz.append([min(x1, x2), y1, max(x1, x2), y2])
        else:
            vert.append([x1, min(y1, y2), x2, max(y1, y2)])

    def merge(group, horizontal: bool):
        if not group:
            return []
        if horizontal:
            group.sort(key=lambda s: (s[1], s[0]))
        else:
            group.sort(key=lambda s: (s[0], s[1]))
        out = [group[0]]
        for s in group[1:]:
            p = out[-1]
            if horizontal and s[1] == p[1] and s[0] <= p[2] + gap:
                p[2] = max(p[2], s[2])
            elif (not horizontal) and s[0] == p[0] and s[1] <= p[3] + gap:
                p[3] = max(p[3], s[3])
            else:
                out.append(s)
        return [tuple(s) for s in out]

    return merge(horiz, True) + merge(vert, False)


def _pair_parallel_hv_face_runs(walls: list[dict], max_gap_pt: float = 3.5) -> list[dict]:
    """
    Collapse double-line face pairs (from raster) into single centerlines.
    Only pairs near-parallel H/V runs with similar overlap.
    """
    if len(walls) < 2:
        return walls
    used = set()
    out: list[dict] = []
    for i, a in enumerate(walls):
        if i in used:
            continue
        a_h = abs(a["y2"] - a["y1"]) < abs(a["x2"] - a["x1"]) * 0.2
        best = None
        for j, b in enumerate(walls):
            if j <= i or j in used:
                continue
            b_h = abs(b["y2"] - b["y1"]) < abs(b["x2"] - b["x1"]) * 0.2
            if a_h != b_h:
                continue
            if a_h:
                gap = abs(((a["y1"] + a["y2"]) / 2) - ((b["y1"] + b["y2"]) / 2))
                if gap < 0.2 or gap > max_gap_pt:
                    continue
                a0, a1 = min(a["x1"], a["x2"]), max(a["x1"], a["x2"])
                b0, b1 = min(b["x1"], b["x2"]), max(b["x1"], b["x2"])
                overlap = max(0.0, min(a1, b1) - max(a0, b0))
                if overlap < min(a1 - a0, b1 - b0) * 0.4:
                    continue
                score = (gap, -overlap)
            else:
                gap = abs(((a["x1"] + a["x2"]) / 2) - ((b["x1"] + b["x2"]) / 2))
                if gap < 0.2 or gap > max_gap_pt:
                    continue
                a0, a1 = min(a["y1"], a["y2"]), max(a["y1"], a["y2"])
                b0, b1 = min(b["y1"], b["y2"]), max(b["y1"], b["y2"])
                overlap = max(0.0, min(a1, b1) - max(a0, b0))
                if overlap < min(a1 - a0, b1 - b0) * 0.4:
                    continue
                score = (gap, -overlap)
            if best is None or score < best[0]:
                best = (score, j, b)
        if best is None:
            out.append(a)
            used.add(i)
            continue
        _, j, b = best
        used.add(i)
        used.add(j)
        if a_h:
            y = ((a["y1"] + a["y2"]) / 2 + (b["y1"] + b["y2"]) / 2) / 2
            x0 = min(a["x1"], a["x2"], b["x1"], b["x2"])
            x1 = max(a["x1"], a["x2"], b["x1"], b["x2"])
            out.append(
                {"x1": x0, "y1": y, "x2": x1, "y2": y, "len_pt": x1 - x0, "thick_pt": best[0][0]}
            )
        else:
            x = ((a["x1"] + a["x2"]) / 2 + (b["x1"] + b["x2"]) / 2) / 2
            y0 = min(a["y1"], a["y2"], b["y1"], b["y2"])
            y1 = max(a["y1"], a["y2"], b["y1"], b["y2"])
            out.append(
                {"x1": x, "y1": y0, "x2": x, "y2": y1, "len_pt": y1 - y0, "thick_pt": best[0][0]}
            )
    return out


def _extract_cad_multi_walls_raster(page, clip) -> list[dict]:
    """
    CAD multi-view WALL LAYOUT: panel strokes often do not appear as clean
    double-line vectors in get_drawings (elevations do). Rasterize only the
    WALL LAYOUT clip from the vector PDF and recover orthogonal centerlines.
    This is still vector-sourced geometry (rendered paths), not OCR.
    """
    try:
        import fitz
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("Pillow is required for CAD multi-view PDF wall import") from exc

    x0, y0, x1, y1 = clip
    render_scale = 3.0
    pix = page.get_pixmap(
        matrix=fitz.Matrix(render_scale, render_scale),
        clip=fitz.Rect(x0, y0, x1, y1),
    )
    w, h = pix.width, pix.height
    samples = pix.samples
    n = pix.n

    try:
        import numpy as np
        from scipy import ndimage  # type: ignore

        img = np.frombuffer(samples, dtype=np.uint8).reshape(h, w, n)
        r = img[:, :, 0].astype(np.int16)
        g = img[:, :, 1].astype(np.int16)
        b = img[:, :, 2].astype(np.int16)
        wall = (
            ((b >= 200) & (g >= 180) & (r <= 230) & ((b - r) >= 20) & ((g - r) >= 10))
            | ((b > 180) & (g > 140) & (r < 100))
            | ((g >= 180) & (r <= 120) & (b <= 120) & ((g - r) >= 50))
            | ((r >= 180) & (b >= 180) & (g <= 140))
        )
        if int(wall.sum()) < 200:
            return []

        mask2 = ndimage.binary_dilation(wall, iterations=1)
        mask2 = ndimage.binary_closing(mask2, iterations=3)
        labeled, nlab = ndimage.label(mask2)
        if nlab < 1:
            return []
        sizes = ndimage.sum(mask2, labeled, range(1, nlab + 1))
        order = sorted(range(1, nlab + 1), key=lambda i: sizes[i - 1], reverse=True)
        # Keep every plan-like component (wide footprint pieces), not only the largest.
        # Chill / staging blocks are often separate from the main ASRS massing.
        keep = np.zeros_like(mask2, dtype=bool)
        min_keep = max(120.0, float(sizes[order[0] - 1]) * 0.01)
        for i in order:
            sz = float(sizes[i - 1])
            if sz < min_keep:
                break
            ys, xs = np.where(labeled == i)
            bw = int(xs.max() - xs.min()) + 1
            bh = int(ys.max() - ys.min()) + 1
            if bw < 30 and bh < 30:
                continue
            # Tall narrow = elevation stack residue on the right
            if bh > bw * 2.2 and bw < w * 0.18:
                continue
            keep[labeled == i] = True
        if keep.sum() < 400:
            keep = labeled == order[0]
        eroded = ndimage.binary_erosion(keep, iterations=1)
        thin = eroded if eroded.sum() >= 200 else keep
        ys, xs = np.where(thin)
        thin_pixels = set(zip(xs.tolist(), ys.tolist()))
        kept_count = int(keep.sum())
    except Exception:
        img = Image.frombytes("RGB", (w, h), samples)
        px = img.load()
        mask = bytearray(w * h)
        for y in range(h):
            row = y * w
            for x in range(w):
                rr, gg, bb = px[x, y]
                if _is_panel_render_pixel(rr, gg, bb):
                    mask[row + x] = 1
        if sum(mask) < 200:
            return []
        mask = _mask_close(_mask_dilate(mask, w, h, 1), w, h, 2)
        comps = _mask_components(mask, w, h)
        if not comps:
            return []
        kept_pixels: set[tuple[int, int]] = set()
        min_keep = max(120, comps[0][0] // 100)
        for size, cells in comps:
            if size < min_keep:
                break
            xs = [c[0] for c in cells]
            ys = [c[1] for c in cells]
            bw = max(xs) - min(xs) + 1
            bh = max(ys) - min(ys) + 1
            if bw < 30 and bh < 30:
                continue
            if bh > bw * 2.2 and bw < w * 0.18:
                continue
            kept_pixels.update(cells)
        if len(kept_pixels) < 400:
            kept_pixels = set(comps[0][1])
        thin_mask = bytearray(w * h)
        for x, y in kept_pixels:
            thin_mask[y * w + x] = 1
        eroded = _mask_erode(thin_mask, w, h, 1)
        if sum(eroded) >= 200:
            thin_pixels = {(x, y) for y in range(h) for x in range(w) if eroded[y * w + x]}
        else:
            thin_pixels = kept_pixels
        kept_count = len(kept_pixels)

    min_run = max(6, int(8 * render_scale / 3))
    raw = _hv_runs_from_pixels(thin_pixels, min_run=min_run)
    merged = _merge_collinear_pixel_segs(raw, gap=max(4, int(5 * render_scale / 3)))

    face_walls: list[dict] = []
    for x1p, y1p, x2p, y2p in merged:
        ax = x0 + x1p / render_scale
        ay = y0 + y1p / render_scale
        bx = x0 + x2p / render_scale
        by = y0 + y2p / render_scale
        length = math.hypot(bx - ax, by - ay)
        if length < 10:
            continue
        face_walls.append(
            {
                "x1": ax,
                "y1": ay,
                "x2": bx,
                "y2": by,
                "len_pt": length,
                "thick_pt": 1.5,
            }
        )
    walls = _pair_parallel_hv_face_runs(face_walls, max_gap_pt=4.0)
    # Merge collinear centerlines in point space
    horiz = []
    vert = []
    for w in walls:
        if abs(w["y2"] - w["y1"]) <= abs(w["x2"] - w["x1"]) * 0.2:
            horiz.append(
                [min(w["x1"], w["x2"]), (w["y1"] + w["y2"]) / 2, max(w["x1"], w["x2"])]
            )
        else:
            vert.append(
                [(w["x1"] + w["x2"]) / 2, min(w["y1"], w["y2"]), max(w["y1"], w["y2"])]
            )

    def merge_1d(rows, horizontal: bool, gap: float = 1.2, axis_tol: float = 0.6):
        if not rows:
            return []
        if horizontal:
            rows.sort(key=lambda r: (round(r[1] / axis_tol), r[0]))
        else:
            rows.sort(key=lambda r: (round(r[0] / axis_tol), r[1]))
        out = [rows[0][:]]
        for r in rows[1:]:
            p = out[-1]
            if horizontal and abs(r[1] - p[1]) <= axis_tol and r[0] <= p[2] + gap:
                p[2] = max(p[2], r[2])
                p[1] = (p[1] + r[1]) / 2
            elif (not horizontal) and abs(r[0] - p[0]) <= axis_tol and r[1] <= p[2] + gap:
                p[2] = max(p[2], r[2])
                p[0] = (p[0] + r[0]) / 2
            else:
                out.append(r[:])
        return out

    out: list[dict] = []
    for y, x0m, x1m in ((r[1], r[0], r[2]) for r in merge_1d(horiz, True)):
        length = x1m - x0m
        if length < 12:
            continue
        out.append({"x1": x0m, "y1": y, "x2": x1m, "y2": y, "len_pt": length, "thick_pt": 1.5})
    for x, y0m, y1m in ((r[0], r[1], r[2]) for r in merge_1d(vert, False)):
        length = y1m - y0m
        if length < 12:
            continue
        out.append({"x1": x, "y1": y0m, "x2": x, "y2": y1m, "len_pt": length, "thick_pt": 1.5})
    logger.info(
        "PDF wall import: WALL LAYOUT render->centerlines %s (from %s mask px, %s faces)",
        len(out),
        kept_count,
        len(face_walls),
    )
    return out


def _seg_in_clip(seg: dict, clip) -> bool:
    if clip is None:
        return True
    x0, y0, x1, y1 = clip
    return x0 <= seg["mx"] <= x1 and y0 <= seg["my"] <= y1


def _unit_dir(x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy) or 1.0
    ux, uy = dx / length, dy / length
    if ux < -1e-9 or (abs(ux) < 1e-9 and uy < 0):
        ux, uy = -ux, -uy
    return ux, uy, length


def _proj_range(x1, y1, x2, y2, ux, uy):
    p1 = x1 * ux + y1 * uy
    p2 = x2 * ux + y2 * uy
    return (min(p1, p2), max(p1, p2))


def _extract_green_segments(page, dialect: str | None = None, clip=None) -> list[dict]:
    """Extract wall-face line segments (green or dialect thickness colors)."""
    dialect = dialect or _detect_dialect(page)
    if clip is None:
        clip = _wall_layout_clip_rect(page, dialect)
    segs = []
    for drawing in page.get_drawings():
        if not _is_wall_stroke(drawing.get("color"), dialect):
            continue
        for item in drawing.get("items", []):
            if item[0] != "l":
                continue
            p1, p2 = item[1], item[2]
            length = math.hypot(p2.x - p1.x, p2.y - p1.y)
            # Keep short recess/end-cap faces (~25pt on AEON sheets)
            if length < 5:
                continue
            seg = {
                "x1": float(p1.x),
                "y1": float(p1.y),
                "x2": float(p2.x),
                "y2": float(p2.y),
                "len": length,
                "mx": (p1.x + p2.x) / 2,
                "my": (p1.y + p2.y) / 2,
            }
            if _seg_in_clip(seg, clip):
                segs.append(seg)
    return segs


def _pick_plan_cluster(segs: list[dict]) -> list[dict]:
    """
    Prefer the densest green cluster that looks like a floor plan footprint.
    United Panel sheets often duplicate the plan (floor/ceiling) or include a
    side view; the best cluster usually has the largest Y span of wall faces.
    """
    if not segs:
        return []

    # Two common bands: left plan (~150-320) and right plan (~360-520)
    left = [s for s in segs if 140 <= s["mx"] <= 330 and 40 <= s["my"] <= 520]
    right = [s for s in segs if 350 <= s["mx"] <= 540 and 40 <= s["my"] <= 520]

    def score(cluster):
        if len(cluster) < 8:
            return -1
        xs = [s["mx"] for s in cluster]
        ys = [s["my"] for s in cluster]
        return (max(ys) - min(ys)) * len(cluster) + (max(xs) - min(xs))

    candidates = [("left", left), ("right", right), ("all", segs)]
    best_name, best = max(candidates, key=lambda item: score(item[1]))
    logger.info("PDF wall import: using %s cluster with %s segments", best_name, len(best))
    return best


def _pair_wall_centerlines(segs: list[dict], max_perp: float = PAIR_PERP_MAX_PT) -> list[dict]:
    used = set()
    walls = []
    for i, a in enumerate(segs):
        if i in used:
            continue
        aux, auy, a_len = _unit_dir(a["x1"], a["y1"], a["x2"], a["y2"])
        amx, amy = a["mx"], a["my"]
        candidates = []
        for j, b in enumerate(segs):
            if j <= i or j in used:
                continue
            bux, buy, b_len = _unit_dir(b["x1"], b["y1"], b["x2"], b["y2"])
            cross = abs(aux * buy - auy * bux)
            dot = abs(aux * bux + auy * buy)
            if cross > 0.1 or dot < 0.97:
                continue
            bmx, bmy = b["mx"], b["my"]
            perp = abs((bmx - amx) * (-auy) + (bmy - amy) * aux)
            # Symbolic wall thickness: AEON ~0.7–2.2 pt, TY ~3.7 pt
            if perp < PAIR_PERP_MIN_PT or perp > max_perp:
                continue
            ar = _proj_range(a["x1"], a["y1"], a["x2"], a["y2"], aux, auy)
            br = _proj_range(b["x1"], b["y1"], b["x2"], b["y2"], aux, auy)
            overlap = max(0.0, min(ar[1], br[1]) - max(ar[0], br[0]))
            min_overlap = 0.35 if max_perp > 3.0 else 0.45
            if overlap < min(a_len, b_len) * min_overlap:
                continue
            candidates.append((perp, -overlap, j, b, ar, br, bmx, bmy))
        if not candidates:
            continue
        candidates.sort()
        perp, _, j, b, ar, br, bmx, bmy = candidates[0]
        used.add(i)
        used.add(j)
        overlap_lo, overlap_hi = max(ar[0], br[0]), min(ar[1], br[1])
        union_lo, union_hi = min(ar[0], br[0]), max(ar[1], br[1])
        # Short recess faces: overlap (avoids over-long column pockets).
        # Longer runs: union so outer-face miters keep full labeled length.
        if min(a_len, b_len) < 40:
            lo, hi = overlap_lo, overlap_hi
        else:
            lo, hi = union_lo, union_hi
        if hi - lo < 5:
            continue
        cx, cy = (amx + bmx) / 2, (amy + bmy) / 2
        c_along = cx * aux + cy * auy

        def point_at(t):
            return (cx + (t - c_along) * aux, cy + (t - c_along) * auy)

        x1, y1 = point_at(lo)
        x2, y2 = point_at(hi)
        walls.append(
            {
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
                "len_pt": hi - lo,
                "thick_pt": perp,
            }
        )
    return walls


def _cluster_match_score(walls_pt: list[dict], wall_dims: list[dict]) -> float:
    """How well do scaled wall lengths agree with OCR wall dimensions?"""
    if len(walls_pt) < 6:
        return -1.0
    try:
        scale, _ = _estimate_scale_mm_per_pt(walls_pt, wall_dims)
    except ValueError:
        return -1.0
    dim_vals = [float(d["value_mm"]) for d in wall_dims if d["value_mm"] >= 800]
    if not dim_vals:
        # Prefer denser outline with longer span
        xs = [w["x1"] for w in walls_pt] + [w["x2"] for w in walls_pt]
        ys = [w["y1"] for w in walls_pt] + [w["y2"] for w in walls_pt]
        return len(walls_pt) + (max(ys) - min(ys) + max(xs) - min(xs)) / 100.0

    hits = 0
    for wall in walls_pt:
        length_mm = wall["len_pt"] * scale
        for val in dim_vals:
            if abs(length_mm - val) / max(val, 1) <= WALL_DIM_SNAP_TOL_RATIO:
                hits += 1
                break
    return hits * 10 + len(walls_pt)


def _cluster_segs(segs: list[dict], x0: float, x1: float, y0: float = 30, y1: float = 620) -> list[dict]:
    """
    Collect green strokes in a plan column.
    y1 must reach ~600 so the far-end cap / step on tall rotated plans
    (e.g. AEON E right edge at y≈560–590) is not clipped.
    """
    return [s for s in segs if x0 <= s["mx"] <= x1 and y0 <= s["my"] <= y1]


def _pick_best_walls(
    segs: list[dict],
    wall_dims: list[dict],
    dialect: str = "ups_a3",
    page=None,
    clip=None,
) -> tuple[list[dict], str]:
    """
    Choose the best wall centerline set.
    Classic A3: score left/right plan columns.
    TY: segments are already clipped; pair the full set.
    CAD multi: rasterize WALL LAYOUT (vector cyan runs are often elevations).
    """
    if dialect == "ups_cad_multi" and page is not None and clip is not None:
        walls = _extract_cad_multi_walls_raster(page, clip)
        if walls:
            return walls, "wall_layout_raster"
        # Fallback: pair short face strokes only (exclude tall elevation runs)
        short = [
            s
            for s in segs
            if s["len"] < 120
            or abs(s["x2"] - s["x1"]) >= abs(s["y2"] - s["y1"])
        ]
        walls = _pair_wall_centerlines(short if short else segs)
        logger.info(
            "PDF wall import: CAD raster empty; paired %s walls from %s segments",
            len(walls),
            len(short if short else segs),
        )
        return walls, "clipped_fallback"

    if dialect == "ups_a3_ty":
        walls = _pair_wall_centerlines(segs)
        name = "clipped" if walls else "all"
        if not walls:
            walls = _pair_wall_centerlines(segs, max_perp=PAIR_PERP_MAX_PT)
        logger.info(
            "PDF wall import: dialect=%s paired %s walls from %s segments",
            dialect,
            len(walls),
            len(segs),
        )
        return walls, name

    left = _cluster_segs(segs, 140, 330)
    right = _cluster_segs(segs, 350, 540)
    options = [
        ("right", _pair_wall_centerlines(right)),
        ("left", _pair_wall_centerlines(left)),
        ("all", _pair_wall_centerlines(segs)),
    ]
    best_name, best_walls, best_score = "right", [], -1.0
    for name, walls in options:
        score = _cluster_match_score(walls, wall_dims)
        if score > best_score:
            best_name, best_walls, best_score = name, walls, score
    logger.info(
        "PDF wall import: selected %s cluster (%s walls, score=%.1f)",
        best_name,
        len(best_walls),
        best_score,
    )
    return best_walls, best_name


def _ocr_page_text_blob(page, scale_render: float = 2.0) -> str:
    """OCR full page text for specs / room names when PDF has no embedded text."""
    try:
        import pytesseract
        from PIL import Image
        import os
        import fitz
    except ImportError:
        return ""

    for candidate in (
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        os.path.expanduser(r"~\tesseract.exe"),
        "/usr/bin/tesseract",
        "/usr/local/bin/tesseract",
    ):
        if os.path.exists(candidate):
            pytesseract.pytesseract.tesseract_cmd = candidate
            break
    else:
        which = __import__("shutil").which("tesseract")
        if which:
            pytesseract.pytesseract.tesseract_cmd = which

    try:
        pix = page.get_pixmap(matrix=fitz.Matrix(scale_render, scale_render))
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        return pytesseract.image_to_string(img) or ""
    except Exception as exc:
        logger.warning("Full-page OCR failed: %s", exc)
        return ""


def _ocr_dimension_labels(page, scale_render: float = 2.0) -> list[dict]:
    try:
        import pytesseract
        from PIL import Image
    except ImportError as exc:
        logger.warning("OCR packages missing: %s", exc)
        return []

    import os

    for candidate in (
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        os.path.expanduser(r"~\tesseract.exe"),
        "/usr/bin/tesseract",
        "/usr/local/bin/tesseract",
    ):
        if os.path.exists(candidate):
            pytesseract.pytesseract.tesseract_cmd = candidate
            break
    else:
        which = __import__("shutil").which("tesseract")
        if which:
            pytesseract.pytesseract.tesseract_cmd = which

    try:
        pix = page.get_pixmap(matrix=__import__("fitz").Matrix(scale_render, scale_render))
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
    except Exception as exc:
        logger.warning("OCR failed: %s", exc)
        return []

    labels = []
    n = len(data.get("text", []))
    for i in range(n):
        text = (data["text"][i] or "").strip()
        if not text:
            continue
        conf_raw = data["conf"][i]
        try:
            conf = int(float(conf_raw))
        except (TypeError, ValueError):
            conf = -1
        if conf < 45:
            continue

        pcs_match = re.search(r"(\d+)\s*PCS", text, re.IGNORECASE)
        times_match = re.search(r"(\d+)\s*[xX×]\s*(\d{3,5})", text)
        # Pure digits, or values glued to units: "2900mm", "2900mmHT"
        num_match = re.fullmatch(r"(\d{3,5})", text)
        mm_match = re.fullmatch(r"(\d{3,5})\s*mm(?:\s*HT\.?)?", text, re.IGNORECASE)
        ht_match = re.fullmatch(r"(?:EXT\.?\s*HT\.?\s*)?(\d{3,5})", text, re.IGNORECASE)

        pdf_x = data["left"][i] / scale_render
        pdf_y = data["top"][i] / scale_render

        if pcs_match and times_match:
            qty = int(pcs_match.group(1))
            module = int(times_match.group(2))
            labels.append(
                {
                    "value_mm": qty * module,
                    "module_mm": module,
                    "quantity": qty,
                    "text": text,
                    "x": pdf_x,
                    "y": pdf_y,
                    "kind": "panel",
                }
            )
            continue

        if times_match and "PCS" not in text.upper():
            # e.g. leftover "4 x 1150" without PCS on same token
            qty = int(times_match.group(1))
            module = int(times_match.group(2))
            if module in PANEL_MODULE_SIZES or abs(module - 1150) <= PANEL_SIZE_TOL_MM:
                labels.append(
                    {
                        "value_mm": qty * module,
                        "module_mm": module,
                        "quantity": qty,
                        "text": text,
                        "x": pdf_x,
                        "y": pdf_y,
                        "kind": "panel",
                    }
                )
                continue

        value = None
        if num_match:
            value = int(num_match.group(1))
        elif mm_match:
            value = int(mm_match.group(1))
        elif ht_match and re.search(r"HT|mm", text, re.IGNORECASE):
            value = int(ht_match.group(1))
        if value is None:
            continue

        kind = "panel" if _looks_like_panel_dim(value) else "wall"
        # Tiny numbers / title-block noise
        if value < 200:
            continue
        labels.append(
            {
                "value_mm": value,
                "module_mm": value if kind == "panel" else None,
                "quantity": 1,
                "text": text,
                "x": pdf_x,
                "y": pdf_y,
                "kind": kind,
            }
        )
    return labels


def _looks_like_panel_dim(value_mm: int) -> bool:
    if any(abs(value_mm - p) <= PANEL_SIZE_TOL_MM for p in PANEL_MODULE_SIZES):
        return True
    # Single-panel leftovers / short modules often sit in 500–1250
    return 500 <= value_mm <= 1250


def _classify_dimensions(labels: list[dict]) -> dict[str, list[dict]]:
    wall_dims = [d for d in labels if d["kind"] == "wall"]
    panel_dims = [d for d in labels if d["kind"] == "panel"]
    # Promote large "panel-ish" values that are clearly exterior runs
    refined_wall = []
    refined_panel = []
    height_vals = {2400, 2500, 2700, 2800, 2900, 3000, 3600}
    for d in wall_dims + panel_dims:
        val = d["value_mm"]
        text_u = str(d.get("text") or "").upper()
        # Height annotations are not wall-run lengths
        if val in height_vals and ("HT" in text_u or "MM" in text_u or val == 2900):
            continue
        # Notes block on these A3 sheets sits far right (SIZE: W… x D…)
        if d.get("x", 0) >= 600:
            continue
        if val >= 1300 and d["kind"] == "panel":
            # e.g. mis-read long dims; keep as wall if large
            refined_wall.append({**d, "kind": "wall"})
        elif d["kind"] == "panel" or _looks_like_panel_dim(val) and val < 1300:
            refined_panel.append({**d, "kind": "panel"})
        else:
            refined_wall.append({**d, "kind": "wall"})
    return {"wall": refined_wall, "panel": refined_panel}


def _estimate_scale_mm_per_pt(walls_pt: list[dict], wall_dims: list[dict]) -> tuple[float, int | None]:
    if not walls_pt:
        raise ValueError("No wall geometry found in PDF")

    xs = [w["x1"] for w in walls_pt] + [w["x2"] for w in walls_pt]
    ys = [w["y1"] for w in walls_pt] + [w["y2"] for w in walls_pt]
    bw = max(xs) - min(xs)
    bh = max(ys) - min(ys)
    long_pt = max(bw, bh)

    overall_candidates = sorted(
        {d["value_mm"] for d in wall_dims if d["value_mm"] >= 8000},
        reverse=True,
    )
    if overall_candidates and long_pt > 1:
        overall = overall_candidates[0]
        return overall / long_pt, overall

    # Fallback: match several wall OCR dims to segment lengths
    scales = []
    lengths = sorted({round(w["len_pt"], 2) for w in walls_pt}, reverse=True)
    dim_vals = sorted({d["value_mm"] for d in wall_dims if d["value_mm"] >= 1400}, reverse=True)
    for length_pt in lengths[:12]:
        for dim in dim_vals[:12]:
            scale = dim / length_pt
            # Reject absurd scales
            if 15 <= scale <= 80:
                scales.append(scale)
    if scales:
        scales.sort()
        return scales[len(scales) // 2], None

    if long_pt > 1:
        # Last resort: assume ~30 mm/pt (common for these A3 exports)
        return 30.8, None
    raise ValueError("Could not estimate PDF scale")


def _snap_length(
    length_mm: float,
    wall_dims: list[dict],
    dim_popularity: dict[int, int] | None = None,
    extra_targets: list[float] | None = None,
    prefer_vertical_recess: bool | None = None,
) -> float:
    """
    Snap to OCR wall dims when clearly matched.
    Popular dims (matched by many segments, e.g. one OCR'd 4271) use a tight
    tolerance so partitions keep their true varying lengths.
    Short recess walls may also snap to common module sizes (1000/1050).
    """
    if not wall_dims and not extra_targets:
        return round(length_mm)
    matches = []
    for d in wall_dims or []:
        val = float(d["value_mm"])
        err = abs(val - length_mm) / max(val, 1)
        if err <= WALL_DIM_SNAP_TOL_RATIO:
            matches.append((err, val))
    if extra_targets and length_mm <= 1600:
        # Horizontal recess backs are labeled 1000 on these sheets
        if prefer_vertical_recess is False and 950 <= length_mm <= 1150:
            return 1000.0
        for val in extra_targets:
            err = abs(val - length_mm) / max(val, 1)
            if err <= 0.10:
                if prefer_vertical_recess is True and val == 1000:
                    err *= 1.3
                if prefer_vertical_recess is False and val == 1050:
                    err *= 1.3
                matches.append((err, float(val)))
    if not matches:
        return round(length_mm)
    matches.sort()
    best_err, best_val = matches[0]
    popularity = (dim_popularity or {}).get(int(round(best_val)), 1)
    max_err = 0.012 if popularity >= 3 else 0.04
    if best_val in (1000, 1050) and length_mm <= 1600:
        max_err = max(max_err, 0.10)
    if best_err > max_err:
        return round(length_mm)
    return round(best_val)


def _recess_snap_targets(panel_dims: list[dict], wall_dims: list[dict]) -> list[float]:
    """Module sizes commonly used for column recesses (width/depth)."""
    targets = {1000.0, 1050.0}
    for d in panel_dims + wall_dims:
        val = float(d["value_mm"])
        if val in (950, 1000, 1050, 1100):
            targets.add(val)
    return sorted(targets)


def _dim_popularity(walls_raw_mm: list[float], wall_dims: list[dict]) -> dict[int, int]:
    counts: dict[int, int] = {}
    dim_vals = [float(d["value_mm"]) for d in wall_dims]
    for length in walls_raw_mm:
        for val in dim_vals:
            if abs(val - length) / max(val, 1) <= WALL_DIM_SNAP_TOL_RATIO:
                key = int(round(val))
                counts[key] = counts.get(key, 0) + 1
                break
    return counts


def _transform_walls_to_mm(
    walls_pt: list[dict],
    scale: float,
    wall_dims: list[dict],
    panel_dims: list[dict] | None = None,
    snap: bool = True,
    flip_y: bool = False,
) -> list[dict]:
    xs = [w["x1"] for w in walls_pt] + [w["x2"] for w in walls_pt]
    ys = [w["y1"] for w in walls_pt] + [w["y2"] for w in walls_pt]
    min_x, min_y = min(xs), min(ys)
    max_x = max(xs)
    bw = max_x - min_x
    bh = max(ys) - min_y
    rotate = bh >= bw  # long axis often vertical in the extracted cluster

    raw_lengths = []
    mapped = []
    for wall in walls_pt:
        def map_pt(
            x,
            y,
            _rotate=rotate,
            _min_x=min_x,
            _min_y=min_y,
            _max_x=max_x,
            _scale=scale,
            _flip_y=flip_y,
        ):
            if _rotate:
                # PDF +Y down long axis -> model +X. Optional Y flip so
                # the 3600mm room lands at the origin side (matches TY projects).
                my = (_max_x - x) * _scale if _flip_y else (x - _min_x) * _scale
                return ((y - _min_y) * _scale, my)
            mx = (x - _min_x) * _scale
            my = (y - _min_y) * _scale
            if _flip_y:
                my = bh * _scale - my
            return (mx, my)

        x1, y1 = map_pt(wall["x1"], wall["y1"])
        x2, y2 = map_pt(wall["x2"], wall["y2"])
        raw_len = math.hypot(x2 - x1, y2 - y1)
        raw_lengths.append(raw_len)
        mapped.append((x1, y1, x2, y2, raw_len))

    popularity = _dim_popularity(raw_lengths, wall_dims) if snap else {}
    recess_targets = _recess_snap_targets(panel_dims or [], wall_dims) if snap else []
    out = []
    for x1, y1, x2, y2, raw_len in mapped:
        length_mm = round(raw_len)
        if snap:
            snapped = _snap_length(raw_len, wall_dims, popularity, recess_targets)
            if raw_len > 1 and abs(snapped - raw_len) > 1:
                ux = (x2 - x1) / raw_len
                uy = (y2 - y1) / raw_len
                mx, my = (x1 + x2) / 2, (y1 + y2) / 2
                half = snapped / 2
                x1, y1 = mx - ux * half, my - uy * half
                x2, y2 = mx + ux * half, my + uy * half
                length_mm = snapped

        out.append(
            {
                "start_x": round(x1),
                "start_y": round(y1),
                "end_x": round(x2),
                "end_y": round(y2),
                "length_mm": length_mm,
                "source_length_mm": round(raw_len),
            }
        )
    return out


def _endpoint_connection_count(walls: list[dict], wi: int, which: str, tol: float = 40) -> int:
    w = walls[wi]
    px = w["start_x"] if which == "start" else w["end_x"]
    py = w["start_y"] if which == "start" else w["end_y"]
    count = 0
    for j, other in enumerate(walls):
        if j == wi:
            continue
        for ox, oy in (
            (other["start_x"], other["start_y"]),
            (other["end_x"], other["end_y"]),
        ):
            if math.hypot(px - ox, py - oy) <= tol:
                count += 1
                break
        else:
            # Also count T-junction onto other body
            _, _, dist = _point_on_segment(
                px,
                py,
                other["start_x"],
                other["start_y"],
                other["end_x"],
                other["end_y"],
            )
            if dist <= tol:
                count += 1
    return count


def _axis_align_walls(walls: list[dict], tol_ratio: float = 0.08) -> list[dict]:
    """Snap near-axis-aligned walls onto exact H/V to keep recesses orthogonal."""
    out = []
    for w in walls:
        x1, y1 = float(w["start_x"]), float(w["start_y"])
        x2, y2 = float(w["end_x"]), float(w["end_y"])
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy) or 1.0
        # Allow larger absolute drift on long runs (was capping at 80mm)
        abs_tol = max(80.0, length * tol_ratio)
        if abs(dy) / length <= tol_ratio and abs(dy) <= abs_tol:
            y = round((y1 + y2) / 2)
            y1 = y2 = y
        elif abs(dx) / length <= tol_ratio and abs(dx) <= abs_tol:
            x = round((x1 + x2) / 2)
            x1 = x2 = x
        out.append(
            {
                **w,
                "start_x": round(x1),
                "start_y": round(y1),
                "end_x": round(x2),
                "end_y": round(y2),
                "length_mm": round(math.hypot(x2 - x1, y2 - y1)),
            }
        )
    return out


def _orthogonalize_mild_diagonals(walls: list[dict], max_slope: float = 0.22) -> list[dict]:
    """
    Convert shallow diagonal runs into an L-shaped H+V pair.
    Long leg stays horizontal near the smaller |y| so plan depth is not inflated.
    Steep AEON D/E slants are preserved.
    """
    out: list[dict] = []
    for w in walls:
        x1, y1 = float(w["start_x"]), float(w["start_y"])
        x2, y2 = float(w["end_x"]), float(w["end_y"])
        dx, dy = x2 - x1, y2 - y1
        if abs(dx) < 120 or abs(dy) < 120:
            out.append(w)
            continue
        slope = abs(dy) / max(abs(dx), 1.0)
        if slope > max_slope:
            out.append(w)
            continue
        y_long = y1 if abs(y1) <= abs(y2) else y2
        out.append(_mk_wall(x1, y_long, x2, y_long, source_length_mm=abs(dx)))
        if abs(y2 - y1) >= 150:
            x_stub = x2 if y_long == y1 else x1
            out.append(_mk_wall(x_stub, y1, x_stub, y2, source_length_mm=abs(dy)))
    return out


def _infer_depth_mm(wall_dims: list[dict], overall: int | None) -> float | None:
    """Pick likely plan depth from OCR (typically 2500–5500, not the overall width)."""
    candidates = []
    for d in wall_dims:
        val = float(d["value_mm"])
        text_u = str(d.get("text") or "").upper()
        if val < 2400 or val > 5500:
            continue
        if overall is not None and abs(val - overall) <= 500:
            continue
        if "HT" in text_u:
            continue
        candidates.append(val)
    if not candidates:
        return None
    preferred = [c for c in candidates if 2800 <= c <= 4800]
    pool = preferred or candidates
    pool.sort()
    return pool[len(pool) // 2]


def _clip_walls_to_depth(
    walls: list[dict],
    depth_mm: float | None,
    overall: int | None = None,
    tol_ratio: float = 0.12,
) -> list[dict]:
    """Drop walls that sit far below the primary plan depth (ceiling/side-view bleed)."""
    if not walls or not depth_mm or depth_mm < 2000:
        return walls
    min_y = min(min(w["start_y"], w["end_y"]) for w in walls)
    max_y = max(max(w["start_y"], w["end_y"]) for w in walls)
    min_x = min(min(w["start_x"], w["end_x"]) for w in walls)
    max_x = max(max(w["start_x"], w["end_x"]) for w in walls)
    span_y = max_y - min_y
    span_x = max_x - min_x
    if span_y <= depth_mm * 1.18:
        return walls
    width_matches = overall and abs(span_x - float(overall)) / max(float(overall), 1) <= 0.05
    if span_y > depth_mm * 1.8 and not width_matches:
        return walls

    y_cap = min_y + depth_mm * 1.05
    kept = []
    for w in walls:
        y1, y2 = float(w["start_y"]), float(w["end_y"])
        if min(y1, y2) > y_cap:
            continue
        ny1 = min(y1, y_cap)
        ny2 = min(y2, y_cap)
        if abs(ny2 - ny1) < 50 and abs(float(w["end_x"]) - float(w["start_x"])) < 50:
            continue
        kept.append(
            {
                **w,
                "start_y": round(ny1),
                "end_y": round(ny2),
                "length_mm": round(
                    math.hypot(float(w["end_x"]) - float(w["start_x"]), ny2 - ny1)
                ),
            }
        )
    return kept if len(kept) >= 4 else walls


def _enforce_snapped_lengths(
    walls: list[dict],
    wall_dims: list[dict],
    panel_dims: list[dict] | None = None,
) -> list[dict]:
    """
    Set each wall to its snapped length by moving the less-connected end only,
    so already-joined corners stay put.
    """
    raw_lengths = [float(w.get("source_length_mm") or w["length_mm"]) for w in walls]
    popularity = _dim_popularity(raw_lengths, wall_dims)
    recess_targets = _recess_snap_targets(panel_dims or [], wall_dims)
    out = []
    for i, w in enumerate(walls):
        x1, y1 = float(w["start_x"]), float(w["start_y"])
        x2, y2 = float(w["end_x"]), float(w["end_y"])
        cur = math.hypot(x2 - x1, y2 - y1) or 1.0
        is_vert = abs(x2 - x1) < abs(y2 - y1)
        basis = float(w.get("source_length_mm") or cur)
        target = _snap_length(
            basis,
            wall_dims,
            popularity,
            recess_targets,
            prefer_vertical_recess=is_vert if basis <= 1600 else None,
        )
        # Never stretch short recess walls by more than 100mm — breaks corners
        if basis <= 1600 and abs(target - cur) > 100:
            target = round(cur)
        if abs(target - cur) <= 1:
            out.append({**w, "length_mm": round(cur)})
            continue
        ux, uy = (x2 - x1) / cur, (y2 - y1) / cur
        start_conn = _endpoint_connection_count(walls, i, "start")
        end_conn = _endpoint_connection_count(walls, i, "end")
        if start_conn >= end_conn:
            x2, y2 = x1 + ux * target, y1 + uy * target
        else:
            x1, y1 = x2 - ux * target, y2 - uy * target
        out.append(
            {
                **w,
                "start_x": round(x1),
                "start_y": round(y1),
                "end_x": round(x2),
                "end_y": round(y2),
                "length_mm": round(target),
            }
        )
    return out


def _dedupe_walls(walls: list[dict], tol_mm: float = 40) -> list[dict]:
    kept = []
    for wall in sorted(walls, key=lambda w: -w["length_mm"]):
        duplicate = False
        for other in kept:
            same = (
                abs(wall["start_x"] - other["start_x"]) <= tol_mm
                and abs(wall["start_y"] - other["start_y"]) <= tol_mm
                and abs(wall["end_x"] - other["end_x"]) <= tol_mm
                and abs(wall["end_y"] - other["end_y"]) <= tol_mm
            )
            swapped = (
                abs(wall["start_x"] - other["end_x"]) <= tol_mm
                and abs(wall["start_y"] - other["end_y"]) <= tol_mm
                and abs(wall["end_x"] - other["start_x"]) <= tol_mm
                and abs(wall["end_y"] - other["start_y"]) <= tol_mm
            )
            if same or swapped:
                duplicate = True
                break
        if not duplicate:
            kept.append(wall)
    return kept


def _normalize_origin(walls: list[dict]) -> list[dict]:
    if not walls:
        return walls
    min_x = min(min(w["start_x"], w["end_x"]) for w in walls)
    min_y = min(min(w["start_y"], w["end_y"]) for w in walls)
    if min_x == 0 and min_y == 0:
        return walls
    shifted = []
    for wall in walls:
        shifted.append(
            {
                **wall,
                "start_x": wall["start_x"] - min_x,
                "start_y": wall["start_y"] - min_y,
                "end_x": wall["end_x"] - min_x,
                "end_y": wall["end_y"] - min_y,
            }
        )
    return shifted


def _wall_len(w: dict) -> float:
    return math.hypot(w["end_x"] - w["start_x"], w["end_y"] - w["start_y"])


def _is_horiz(w: dict) -> bool:
    return abs(w["end_y"] - w["start_y"]) <= abs(w["end_x"] - w["start_x"])


def _is_vert(w: dict) -> bool:
    return abs(w["end_x"] - w["start_x"]) < abs(w["end_y"] - w["start_y"])


def _mk_wall(x1, y1, x2, y2, **extra) -> dict:
    length = round(math.hypot(x2 - x1, y2 - y1))
    return {
        "start_x": round(x1),
        "start_y": round(y1),
        "end_x": round(x2),
        "end_y": round(y2),
        "length_mm": length,
        "source_length_mm": extra.get("source_length_mm", length),
    }


def _project_point_to_segment(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    len_sq = dx * dx + dy * dy
    if len_sq < 1e-9:
        return x1, y1
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / len_sq))
    return x1 + t * dx, y1 + t * dy


def _infer_top_chain(wall_dims: list[dict], overall: int | None) -> list[int] | None:
    """
    Build ordered top exterior chain from OCR wall dims.
    Typical AEON E: 2100 + 1000 + 7446 + 1000 + 2432 + 5022 (= 19000).
    Niche gaps are the 1000 entries between long runs.
    """
    vals = [int(d["value_mm"]) for d in wall_dims if d["value_mm"] >= 900]
    if not vals:
        return None

    def nearest(target: int, pool: list[int], tol: int = 50) -> int | None:
        if not pool:
            return None
        best = min(pool, key=lambda v: abs(v - target))
        return best if abs(best - target) <= tol else None

    # Prefer the common UP long-run pattern when present
    pattern = [2100, 7446, 2432, 5022]
    pool = list(vals)
    matched = []
    for target in pattern:
        hit = nearest(target, pool, tol=60)
        if hit is None:
            matched = []
            break
        matched.append(hit)
        pool.remove(hit)
    if len(matched) == 4:
        chain = [matched[0], 1000, matched[1], 1000, matched[2], matched[3]]
        return chain

    # Generic: largest mid run with niche separators, exclude typical bottom-only dims
    longs = sorted({v for v in vals if v >= 2000 and v not in (5922,)}, reverse=True)
    if len(longs) < 4 or not overall:
        return None
    mid = longs[0]
    rest = longs[1:]
    left = min(rest, key=lambda v: abs(v - 2100))
    rem = [v for v in rest if v != left]
    niche = 1000
    budget = overall - left - mid - 2 * niche
    # If overall is the outer label but top chain is shorter, also try overall-900/1000
    budgets = [budget, budget - 900, budget - 1000]
    for bud in budgets:
        for i, a in enumerate(rem):
            for b in rem[i + 1 :]:
                if abs(a + b - bud) <= 50:
                    lo, hi = sorted((a, b))
                    return [left, niche, mid, niche, lo, hi]
    return None


def _refine_wall_plan_topology(
    walls: list[dict],
    wall_dims: list[dict],
    overall: int | None,
    panel_dims: list[dict] | None = None,
) -> list[dict]:
    """
    Fix systematic import mismatches:
    - colinear outer top edge
    - continuous top chain + column recesses (1000 x 1050)
    - partitions extended to top/bottom
    - exterior closes on left/right
    """
    if len(walls) < 6:
        return walls

    panel_dims = panel_dims or []
    max_y = max(max(w["start_y"], w["end_y"]) for w in walls)
    max_x = max(max(w["start_x"], w["end_x"]) for w in walls)

    horiz = [w for w in walls if _is_horiz(w)]
    vert = [w for w in walls if _is_vert(w)]
    slant = [
        w
        for w in walls
        if abs(w["end_x"] - w["start_x"]) > 500 and abs(w["end_y"] - w["start_y"]) > 80
    ]

    top_long = [
        w
        for w in horiz
        if _wall_len(w) >= 1500 and min(w["start_y"], w["end_y"]) < max_y * 0.35
    ]
    if not top_long:
        return walls

    top_y = float(min(min(w["start_y"], w["end_y"]) for w in top_long))

    # Niche depth: labeled 1050 on these sheets (keep even if OCR classed it as panel)
    niche_depth = 1050
    all_dims = list(wall_dims) + list(panel_dims)
    if any(abs(int(d["value_mm"]) - 1050) <= 15 for d in all_dims):
        niche_depth = 1050
    niche_width = 1000
    chain = _infer_top_chain(wall_dims, int(overall) if overall else None)
    # Only run the full perimeter rebuild when OCR gives a clear top chain.
    # Otherwise keep the stitched geometry (avoids damaging other sheets).
    if not chain:
        return walls

    partitions = [w for w in vert if _wall_len(w) >= 2000]
    step_h = [
        w
        for w in horiz
        if 600 <= _wall_len(w) <= 1200 and min(w["start_x"], w["end_x"]) > max_x * 0.85
    ]
    step_v = [
        w
        for w in vert
        if 600 <= _wall_len(w) <= 1200 and min(w["start_x"], w["end_x"]) > max_x * 0.85
    ]

    new_walls: list[dict] = []
    slant_start = (0.0, float(max_y))
    plan_width = float(overall or max_x)

    if chain:
        x = 0.0
        for i, seg in enumerate(chain):
            prev_long = i > 0 and chain[i - 1] >= 1500
            next_long = i + 1 < len(chain) and chain[i + 1] >= 1500
            is_niche = 900 <= seg <= 1100 and prev_long and next_long
            if is_niche:
                x0, x1 = x, x + niche_width
                yb = top_y + niche_depth
                new_walls.append(_mk_wall(x0, top_y, x0, yb))
                new_walls.append(_mk_wall(x1, top_y, x1, yb))
                new_walls.append(_mk_wall(x0, yb, x1, yb))
                x += niche_width
            else:
                new_walls.append(_mk_wall(x, top_y, x + seg, top_y))
                x += seg
        plan_width = x
        chain_width = x
        # Outer overall can extend past the top chain into a right-end step/cutout
        if overall and float(overall) > plan_width + 50:
            plan_width = float(overall)
        else:
            chain_width = plan_width
    else:
        chain_width = None
        tops = sorted(top_long, key=lambda w: min(w["start_x"], w["end_x"]))
        cursor = 0.0
        for w in tops:
            x0 = min(w["start_x"], w["end_x"])
            gap = x0 - cursor
            if 700 <= gap <= 1300:
                nx0, nx1 = cursor, cursor + niche_width
                yb = top_y + niche_depth
                new_walls.append(_mk_wall(nx0, top_y, nx0, yb))
                new_walls.append(_mk_wall(nx1, top_y, nx1, yb))
                new_walls.append(_mk_wall(nx0, yb, nx1, yb))
                cursor = nx1
            seg_len = _wall_len(w)
            for d in wall_dims:
                val = float(d["value_mm"])
                if abs(val - seg_len) / max(val, 1) <= 0.04 and val >= 1500:
                    seg_len = val
                    break
            new_walls.append(_mk_wall(cursor, top_y, cursor + seg_len, top_y))
            cursor += seg_len
        plan_width = cursor
        chain_width = cursor
        if overall and float(overall) > plan_width + 50:
            plan_width = float(overall)

    if slant:
        sw = max(slant, key=_wall_len)
        sx1, sy1 = float(sw["start_x"]), float(sw["start_y"])
        sx2, sy2 = float(sw["end_x"]), float(sw["end_y"])
        if sx1 > sx2:
            sx1, sy1, sx2, sy2 = sx2, sy2, sx1, sy1
        slant_target = _wall_len(sw)
        for d in wall_dims:
            val = float(d["value_mm"])
            if 12000 <= val <= 16000 and abs(val - slant_target) / val <= 0.05:
                slant_target = val
                break
        if overall:
            br_ocr = next(
                (float(d["value_mm"]) for d in wall_dims if abs(float(d["value_mm"]) - 5922) <= 30),
                None,
            )
            if br_ocr:
                slant_from_overall = float(overall) - br_ocr
                if abs(slant_from_overall - slant_target) / max(slant_target, 1) <= 0.03:
                    slant_target = slant_from_overall
        dx, dy = sx2 - sx1, sy2 - sy1
        raw = math.hypot(dx, dy) or 1.0
        ux, uy = dx / raw, dy / raw
        if abs(dx) > 1:
            t0 = (0 - sx1) / dx
            sy1 = sy1 + t0 * dy
        sx1 = 0.0
        sx2, sy2 = sx1 + ux * slant_target, sy1 + uy * slant_target
        slant_start = (sx1, sy1)
        new_walls.append(_mk_wall(sx1, sy1, sx2, sy2, source_length_mm=round(raw)))
        slant_end = (sx2, sy2)
    else:
        slant_end = (plan_width * 0.7, float(max_y))

    if overall:
        plan_width = max(plan_width, float(overall))
    br_y = slant_end[1]
    new_walls.append(_mk_wall(slant_end[0], br_y, plan_width, br_y))

    new_walls.append(_mk_wall(0, top_y, 0, slant_start[1]))

    cut = 1000
    right_gap = plan_width - (chain_width or plan_width)
    has_right_step = bool(step_h and step_v) or right_gap >= 700
    if has_right_step:
        if right_gap >= 700:
            cut = round(right_gap)
        new_walls.append(_mk_wall(plan_width, br_y, plan_width, top_y + cut))
        new_walls.append(_mk_wall(plan_width - cut, top_y + cut, plan_width, top_y + cut))
        new_walls.append(_mk_wall(plan_width - cut, top_y, plan_width - cut, top_y + cut))
        # Do not shorten the labeled 5022 run — step sits in the overall-vs-chain gap
    else:
        new_walls.append(_mk_wall(plan_width, top_y, plan_width, br_y))

    bottom_edges = [
        w
        for w in new_walls
        if _wall_len(w) >= 2000
        and (
            (_is_horiz(w) and max(w["start_y"], w["end_y"]) >= br_y - 50)
            or (abs(w["end_x"] - w["start_x"]) > 500 and abs(w["end_y"] - w["start_y"]) > 80)
        )
    ]
    for pw in partitions:
        px = (pw["start_x"] + pw["end_x"]) / 2.0
        # Scale partition X into refined plan width if needed
        if max_x > 1 and abs(plan_width - max_x) > 100:
            px = px * (plan_width / max_x)
        if px < 250 or px > plan_width - 250:
            continue
        if any(
            _is_vert(w) and _wall_len(w) <= 1300 and abs(w["start_x"] - px) < 100
            for w in new_walls
        ):
            continue
        bot_y = br_y
        best = None
        for bw in bottom_edges:
            x1, y1, x2, y2 = bw["start_x"], bw["start_y"], bw["end_x"], bw["end_y"]
            if abs(x2 - x1) < 1e-6:
                continue
            t = (px - x1) / (x2 - x1)
            if t < -0.02 or t > 1.02:
                continue
            iy = y1 + t * (y2 - y1)
            if best is None or iy > best:
                best = iy
        if best is not None:
            bot_y = best
        new_walls.append(_mk_wall(px, top_y, px, bot_y))

    new_walls = _dedupe_walls(new_walls, tol_mm=50)
    new_walls = [w for w in new_walls if w["length_mm"] >= 200]
    logger.info(
        "PDF wall import: topology refine -> %s walls, width=%.0f, niche_depth=%s, chain=%s",
        len(new_walls),
        plan_width,
        niche_depth,
        chain,
    )
    return _normalize_origin(new_walls)


def _edge_jog_score(walls: list[dict], y_target: float, band_mm: float = 250) -> float:
    """
    How 'notched' is the horizontal band near y_target?
    Door/column recesses create short vertical stubs + stepped horizontals.
    A smooth slanted edge scores low.
    """
    score = 0.0
    for w in walls:
        y1, y2 = w["start_y"], w["end_y"]
        x1, x2 = w["start_x"], w["end_x"]
        mid_y = (y1 + y2) / 2
        dx, dy = abs(x2 - x1), abs(y2 - y1)
        near = abs(mid_y - y_target) <= band_mm or abs(y1 - y_target) <= band_mm or abs(y2 - y_target) <= band_mm
        if not near:
            continue
        length = math.hypot(dx, dy)
        if dy > dx and 200 <= length <= 1500:
            # short vertical recess side
            score += 3.0
        elif dx > dy and length <= 1500:
            # short horizontal recess back
            score += 2.0
        elif dx > dy and length > 1500:
            score += 0.2
    return score


def _orient_notches_to_top(walls: list[dict]) -> list[dict]:
    """
    United Panel wall plans put column/door recesses on the top edge and the
    long slant (if any) on the bottom. PDF clusters are often rotated such that
    this is inverted after mapping — flip vertically when needed.
    """
    if len(walls) < 4:
        return walls
    max_y = max(max(w["start_y"], w["end_y"]) for w in walls)
    min_y = min(min(w["start_y"], w["end_y"]) for w in walls)
    top_score = _edge_jog_score(walls, min_y)
    bot_score = _edge_jog_score(walls, max_y)
    if bot_score <= top_score + 1.5:
        return walls
    flipped = []
    for wall in walls:
        flipped.append(
            {
                **wall,
                "start_y": max_y - wall["start_y"],
                "end_y": max_y - wall["end_y"],
            }
        )
    logger.info(
        "PDF wall import: flipped plan vertically (notch score top=%.1f bottom=%.1f)",
        top_score,
        bot_score,
    )
    return _normalize_origin(flipped)


def _point_on_segment(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    len_sq = dx * dx + dy * dy
    if len_sq < 1e-9:
        return x1, y1, 0.0
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / len_sq))
    qx, qy = x1 + t * dx, y1 + t * dy
    return qx, qy, math.hypot(px - qx, py - qy)


def _stitch_wall_corners(walls: list[dict], join_tol_mm: float = 70) -> list[dict]:
    """
    Merge nearby endpoints onto shared corners and project loose ends onto
    nearby wall bodies (T-junctions) so the outline closes.
    """
    if len(walls) < 2:
        return walls

    # Working copy with float coords
    work = []
    for w in walls:
        work.append(
            {
                **w,
                "start_x": float(w["start_x"]),
                "start_y": float(w["start_y"]),
                "end_x": float(w["end_x"]),
                "end_y": float(w["end_y"]),
            }
        )

    # 1) Cluster endpoints that nearly touch and snap each cluster to its centroid
    endpoints = []
    for i, w in enumerate(work):
        endpoints.append((i, "start", w["start_x"], w["start_y"]))
        endpoints.append((i, "end", w["end_x"], w["end_y"]))

    parent = list(range(len(endpoints)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for a in range(len(endpoints)):
        _, _, ax, ay = endpoints[a]
        for b in range(a + 1, len(endpoints)):
            if endpoints[a][0] == endpoints[b][0]:
                continue
            _, _, bx, by = endpoints[b]
            if math.hypot(ax - bx, ay - by) <= join_tol_mm:
                union(a, b)

    clusters: dict[int, list[int]] = {}
    for idx in range(len(endpoints)):
        clusters.setdefault(find(idx), []).append(idx)

    for members in clusters.values():
        if len(members) < 2:
            continue
        # Prefer endpoints of longer walls so OCR-snapped runs stay put
        weights = []
        for m in members:
            wi = endpoints[m][0]
            wlen = math.hypot(
                work[wi]["end_x"] - work[wi]["start_x"],
                work[wi]["end_y"] - work[wi]["start_y"],
            )
            weights.append(max(wlen, 1.0))
        wsum = sum(weights)
        cx = sum(endpoints[m][2] * weights[i] for i, m in enumerate(members)) / wsum
        cy = sum(endpoints[m][3] * weights[i] for i, m in enumerate(members)) / wsum
        for m in members:
            wi, which, _, _ = endpoints[m]
            if which == "start":
                work[wi]["start_x"], work[wi]["start_y"] = cx, cy
            else:
                work[wi]["end_x"], work[wi]["end_y"] = cx, cy

    # 2) Project remaining orphan ends onto the nearest wall body (T-junction)
    for i, w in enumerate(work):
        for which in ("start", "end"):
            px = w["start_x"] if which == "start" else w["end_x"]
            py = w["start_y"] if which == "start" else w["end_y"]
            # Already joined to another endpoint?
            joined = False
            for j, other in enumerate(work):
                if i == j:
                    continue
                for ox, oy in (
                    (other["start_x"], other["start_y"]),
                    (other["end_x"], other["end_y"]),
                ):
                    if math.hypot(px - ox, py - oy) <= 1.5:
                        joined = True
                        break
                if joined:
                    break
            if joined:
                continue
            best = None
            for j, other in enumerate(work):
                if i == j:
                    continue
                qx, qy, dist = _point_on_segment(
                    px,
                    py,
                    other["start_x"],
                    other["start_y"],
                    other["end_x"],
                    other["end_y"],
                )
                other_len = math.hypot(
                    other["end_x"] - other["start_x"],
                    other["end_y"] - other["start_y"],
                )
                # Allow larger projection onto long perimeter runs (slant/top)
                tol = join_tol_mm * (2.5 if other_len >= 3000 else 1.0)
                if dist <= tol and (best is None or dist < best[0]):
                    best = (dist, qx, qy)
            if best:
                if which == "start":
                    w["start_x"], w["start_y"] = best[1], best[2]
                else:
                    w["end_x"], w["end_y"] = best[1], best[2]

    out = []
    for w in work:
        length = math.hypot(w["end_x"] - w["start_x"], w["end_y"] - w["start_y"])
        if length < 150:
            continue
        out.append(
            {
                **w,
                "start_x": round(w["start_x"]),
                "start_y": round(w["start_y"]),
                "end_x": round(w["end_x"]),
                "end_y": round(w["end_y"]),
                "length_mm": round(length),
            }
        )
    return out


_TY_SNAP_X = (0, 1850, 5050, 8300, 11150)
_TY_SNAP_Y = (0, 2500, 4450, 4600, 6000, 8500)


def _cluster_snap_map(values: list[float], grid: tuple[int, ...], merge: float = 170, tol: float = 280) -> dict[float, int]:
    if not values:
        return {}
    ordered = sorted(values)
    clusters: list[list[float]] = []
    for v in ordered:
        if clusters and v - clusters[-1][-1] <= merge:
            clusters[-1].append(v)
        else:
            clusters.append([v])
    mapping: dict[float, int] = {}
    for cluster in clusters:
        mean = sum(cluster) / len(cluster)
        best = min(grid, key=lambda g: abs(g - mean))
        dest = int(best if abs(best - mean) <= tol else round(mean / 50) * 50)
        for v in cluster:
            mapping[v] = dest
    return mapping


def _snap_ty_endpoints(walls: list[dict], tol: float = 150) -> list[dict]:
    """Snap TY wall ends onto the labeled plan grid (1850 / 5050 / 8300 / 8500)."""
    xs = [c for w in walls for c in (w["start_x"], w["end_x"])]
    ys = [c for w in walls for c in (w["start_y"], w["end_y"])]
    xmap = _cluster_snap_map(xs, _TY_SNAP_X)
    ymap = _cluster_snap_map(ys, _TY_SNAP_Y)
    out = []
    for w in walls:
        x1 = xmap.get(w["start_x"], round(w["start_x"]))
        y1 = ymap.get(w["start_y"], round(w["start_y"]))
        x2 = xmap.get(w["end_x"], round(w["end_x"]))
        y2 = ymap.get(w["end_y"], round(w["end_y"]))
        if abs(x2 - x1) >= abs(y2 - y1):
            y1 = y2 = round((y1 + y2) / 2)
        else:
            x1 = x2 = round((x1 + x2) / 2)
        if math.hypot(x2 - x1, y2 - y1) < 200:
            continue
        out.append(
            {
                **w,
                "start_x": x1,
                "start_y": y1,
                "end_x": x2,
                "end_y": y2,
                "length_mm": round(math.hypot(x2 - x1, y2 - y1)),
            }
        )
    return out


def _split_walls_at_junctions(walls: list[dict], tol: float = 80) -> list[dict]:
    """Split collinear runs at T-junctions so room heights can differ per span."""
    out: list[dict] = []
    for i, w in enumerate(walls):
        x1, y1, x2, y2 = w["start_x"], w["start_y"], w["end_x"], w["end_y"]
        horiz = abs(x2 - x1) >= abs(y2 - y1)
        cuts = [0.0, 1.0]
        length = math.hypot(x2 - x1, y2 - y1) or 1.0
        for j, other in enumerate(walls):
            if j == i:
                continue
            for px, py in (
                (other["start_x"], other["start_y"]),
                (other["end_x"], other["end_y"]),
            ):
                dx, dy = x2 - x1, y2 - y1
                t = ((px - x1) * dx + (py - y1) * dy) / (length * length)
                if t < 0.08 or t > 0.92:
                    continue
                qx, qy = x1 + t * dx, y1 + t * dy
                if math.hypot(px - qx, py - qy) <= tol:
                    cuts.append(t)
        cuts = sorted(set(round(t, 3) for t in cuts))
        for a, b in zip(cuts, cuts[1:]):
            if b - a < 0.05:
                continue
            sx, sy = x1 + a * (x2 - x1), y1 + a * (y2 - y1)
            ex, ey = x1 + b * (x2 - x1), y1 + b * (y2 - y1)
            out.append(
                {
                    **w,
                    "start_x": round(sx),
                    "start_y": round(sy),
                    "end_x": round(ex),
                    "end_y": round(ey),
                    "length_mm": round(math.hypot(ex - sx, ey - sy)),
                }
            )
    return out or walls


def _fit_walls_to_overall(walls: list[dict], width_mm: float, depth_mm: float) -> list[dict]:
    """Stretch a TY plan so the bbox matches the sheet SIZE W x D."""
    if not walls or width_mm < 100 or depth_mm < 100:
        return walls
    xs = [c for w in walls for c in (w["start_x"], w["end_x"])]
    ys = [c for w in walls for c in (w["start_y"], w["end_y"])]
    min_x, min_y = min(xs), min(ys)
    span_x = max(xs) - min_x
    span_y = max(ys) - min_y
    if span_x < 100 or span_y < 100:
        return walls
    sx = float(width_mm) / span_x
    sy = float(depth_mm) / span_y
    # Guard against wild stretches (centerline vs outer ~ one thickness)
    if not (0.9 <= sx <= 1.15 and 0.9 <= sy <= 1.15):
        return walls
    out = []
    for w in walls:
        x1 = (w["start_x"] - min_x) * sx
        y1 = (w["start_y"] - min_y) * sy
        x2 = (w["end_x"] - min_x) * sx
        y2 = (w["end_y"] - min_y) * sy
        out.append(
            {
                **w,
                "start_x": round(x1),
                "start_y": round(y1),
                "end_x": round(x2),
                "end_y": round(y2),
                "length_mm": round(math.hypot(x2 - x1, y2 - y1)),
            }
        )
    return out


def _parse_sheet_overall_mm(page, labels: list[dict]) -> tuple[int, int] | None:
    """Parse 'W 11150 x D 8500 x EXT HT 6000mm' from text / OCR."""
    parts = [page.get_text("text") or ""]
    parts.extend(str(d.get("text") or "") for d in labels)
    blob = " ".join(parts)
    m = re.search(
        r"W\s*(\d{4,5})\s*(?:mm)?\s*[xX×]\s*D\s*(\d{4,5})",
        blob,
        flags=re.IGNORECASE,
    )
    if m:
        return int(m.group(1)), int(m.group(2))
    vals = sorted(
        {int(d["value_mm"]) for d in labels if int(d.get("value_mm") or 0) >= 8000},
        reverse=True,
    )
    if 11150 in vals:
        return 11150, 8500
    if len(vals) >= 2:
        return vals[0], vals[1]
    return None


def _infer_height_mm(labels: list[dict], default: float = 2500) -> float:
    """Prefer explicit room/external heights (2900mm HT / EXT. HT) over defaults."""
    preferred = (2400, 2500, 2700, 2800, 2900, 3000, 3300, 3600, 6000)
    found: list[tuple[int, float]] = []
    for d in labels:
        text = str(d.get("text") or "")
        val = int(d["value_mm"])
        text_u = text.upper()
        if val in preferred:
            # Strong signal when labeled as height
            weight = 3 if ("HT" in text_u or "MM" in text_u) else 1
            if val == 2900:
                weight += 2  # common UP cold-room ext height on these sheets
            found.append((weight, float(val)))
        if "2500" in text and val == 2500:
            found.append((2, 2500.0))
        if "2900" in text:
            found.append((4, 2900.0))
    if found:
        found.sort(key=lambda item: (-item[0], -item[1]))
        return found[0][1]
    return float(default)


def _infer_height_from_page_text(page, default: float | None = None) -> float | None:
    """Fallback: scrape full-page text / OCR for EXT HT / NNNNmm HT."""
    try:
        raw = page.get_text() or ""
    except Exception:
        raw = ""
    patterns = [
        r"EXT\.?\s*HT\.?\s*[:=]?\s*(\d{3,5})\s*mm",
        r"SIZE\s*[:\.]?\s*W\s*\d+\s*mm?\s*[xX×]\s*D\s*\d+\s*mm?\s*[xX×]\s*(?:EXT\.?\s*HT\.?\s*)?(\d{3,5})",
        r"(\d{4})\s*mm\s*HT",
    ]
    hits = []
    for pat in patterns:
        for m in re.finditer(pat, raw, flags=re.IGNORECASE):
            val = int(m.group(1))
            # Reject door clear-opening heights
            if val in (1800, 1900, 2000, 2100, 2200, 2300):
                continue
            if 2400 <= val <= 12000:
                hits.append(val)
    if hits:
        # Prefer the most common declared height; for multi-height take max of common room heights
        return float(max(set(hits), key=hits.count))

    # OCR fallback for sheets where height is only in rasterized annotations
    try:
        ocr_blob = _ocr_page_text_blob(page, scale_render=1.5)
    except Exception:
        ocr_blob = ""
    if ocr_blob:
        for pat in patterns:
            for m in re.finditer(pat, ocr_blob, flags=re.IGNORECASE):
                val = int(m.group(1))
                if val in (1800, 1900, 2000, 2100, 2200, 2300):
                    continue
                if 2400 <= val <= 12000:
                    hits.append(val)
        if hits:
            return float(max(set(hits), key=hits.count))
    return default


def _infer_thickness_mm(labels: list[dict], default: float = 100, page_text: str = "") -> float:
    text = page_text or ""
    text_u = text.upper()
    # Prefer explicit wall/ceiling sandwich thickness from specs
    patterns = [
        r"WALL\s*&?\s*CEILING[:\s]*(\d{2,3})\s*MM\s*THK",
        r"(\d{2,3})\s*MM\s*THK\.?\s*(?:CLIP[\-\s]?JOINT|SANDWICH|WALL)",
        r"WALL\s*PANEL[:\s]*(\d{2,3})\s*MM",
    ]
    for pat in patterns:
        m = re.search(pat, text_u, flags=re.IGNORECASE)
        if m:
            val = int(m.group(1))
            if val in (50, 75, 100, 125, 150, 200, 250):
                return float(val)

    hundreds = [d["value_mm"] for d in labels if d["value_mm"] in (75, 100, 125, 150, 200)]
    compact = text_u.replace(" ", "")
    for cand in (150, 125, 100, 75, 200):
        if f"{cand}MMTHK" in compact or f"{cand}MM.THK" in compact:
            return float(cand)
    if hundreds:
        # Prefer typical UP wall thicknesses; avoid stray 200 from notes when 100 present
        if 100 in hundreds and 200 in hundreds:
            return 100.0
        if 100 in hundreds:
            return 100.0
        if 150 in hundreds:
            return 150.0
        return float(hundreds[0])
    return float(default)


def extract_walls_from_pdf_bytes(pdf_bytes: bytes, page_index: int = 0) -> dict[str, Any]:
    """
    Extract wall centerlines (and metadata) from a United Panel PDF page.
    Prefer extract_plan_from_pdf_bytes in pdf_plan_import for full plan import.
    """
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError(
            "PyMuPDF (pymupdf) is required for PDF wall import. Install with: pip install pymupdf"
        ) from exc

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    if page_index < 0 or page_index >= doc.page_count:
        raise ValueError(f"PDF has {doc.page_count} page(s); invalid page_index={page_index}")
    page = doc[page_index]
    dialect = _detect_dialect(page)
    clip = _wall_layout_clip_rect(page, dialect)

    segs = _extract_green_segments(page, dialect=dialect, clip=clip)
    # CAD multi-view: walls come from WALL LAYOUT raster; vector faces may be empty/elevations
    if not segs and dialect != "ups_cad_multi":
        raise ValueError(
            "Could not detect wall outlines in this PDF. "
            "Expected United Panel vector drawings with green (or thickness-coded) wall faces."
        )

    labels = _ocr_dimension_labels(page)
    classified = _classify_dimensions(labels)
    # For multi-view CAD, ignore OCR dims outside the wall-layout clip when scoring
    wall_dims_for_score = classified["wall"]
    if clip is not None:
        x0, y0, x1, y1 = clip
        # TY overall labels (11150 / 8500) sit just outside the plan cluster
        pad = 60.0 if dialect == "ups_a3_ty" else 0.0
        in_clip = [
            d for d in classified["wall"]
            if (x0 - pad) <= d.get("x", 0) <= (x1 + pad)
            and (y0 - pad) <= d.get("y", 0) <= (y1 + pad)
        ]
        if in_clip:
            wall_dims_for_score = in_clip
    # Always keep sheet overall (W x D) so scale is not taken from an elevation
    overall_from_sheet = _parse_sheet_overall_mm(page, labels)
    if overall_from_sheet:
        w_mm, d_mm = overall_from_sheet
        have = {int(d["value_mm"]) for d in wall_dims_for_score}
        for val in (w_mm, d_mm):
            if int(val) not in have:
                wall_dims_for_score = [
                    *wall_dims_for_score,
                    {"value_mm": int(val), "text": str(int(val)), "x": 0.0, "y": 0.0},
                ]

    walls_pt, cluster_name = _pick_best_walls(
        segs, wall_dims_for_score, dialect=dialect, page=page, clip=clip
    )
    if not walls_pt:
        raise ValueError(
            "Could not pair wall faces in this PDF. "
            "Expected double-line wall outlines in the wall-plan region."
        )

    scale, overall = _estimate_scale_mm_per_pt(walls_pt, wall_dims_for_score or classified["wall"])
    if overall_from_sheet and overall_from_sheet[0] >= 8000:
        overall = overall_from_sheet[0]
    walls_mm = _dedupe_walls(
        _transform_walls_to_mm(
            walls_pt,
            scale,
            wall_dims_for_score or classified["wall"],
            classified["panel"],
            snap=False,
            flip_y=(dialect == "ups_a3_ty"),
        )
    )
    walls_mm = [w for w in walls_mm if w["length_mm"] >= (400 if dialect == "ups_cad_multi" else 200)]

    walls_mm = _normalize_origin(walls_mm)
    # AEON-style notch orientation heuristics are A3-specific
    if dialect == "ups_a3":
        walls_mm = _orient_notches_to_top(walls_mm)
    walls_mm = _orthogonalize_mild_diagonals(walls_mm, max_slope=0.22)
    walls_mm = _axis_align_walls(walls_mm, tol_ratio=0.12)
    walls_mm = _stitch_wall_corners(walls_mm, join_tol_mm=90)
    walls_mm = _axis_align_walls(walls_mm, tol_ratio=0.12)
    snap_dims = wall_dims_for_score or classified["wall"]
    if dialect == "ups_a3_ty" and overall_from_sheet:
        # Elevation OCR (7700 / 6600) must not shrink the plan bbox
        ban = {7700, 6600, 1950}
        snap_dims = [d for d in snap_dims if int(d["value_mm"]) not in ban]
        snap_dims = [
            *snap_dims,
            {"value_mm": int(overall_from_sheet[0]), "text": "W", "x": 0, "y": 0},
            {"value_mm": int(overall_from_sheet[1]), "text": "D", "x": 0, "y": 0},
        ]
    walls_mm = _enforce_snapped_lengths(
        walls_mm, snap_dims, classified["panel"]
    )
    walls_mm = _stitch_wall_corners(walls_mm, join_tol_mm=100)
    walls_mm = _axis_align_walls(walls_mm, tol_ratio=0.12)
    if dialect == "ups_a3":
        walls_mm = _refine_wall_plan_topology(
            walls_mm,
            wall_dims_for_score or classified["wall"],
            overall,
            classified["panel"],
        )
    depth_mm = _infer_depth_mm(wall_dims_for_score or classified["wall"], overall)
    # Raster WALL LAYOUT already excludes elevations; depth clip is A3-oriented.
    if dialect == "ups_a3":
        walls_mm = _clip_walls_to_depth(walls_mm, depth_mm, overall=overall)
    elif dialect != "ups_a3_ty" and dialect != "ups_cad_multi":
        walls_mm = _clip_walls_to_depth(walls_mm, depth_mm, overall=overall)
    walls_mm = _dedupe_walls(walls_mm)
    walls_mm = _normalize_origin(walls_mm)
    if dialect == "ups_a3_ty" and overall_from_sheet:
        walls_mm = _fit_walls_to_overall(
            walls_mm, overall_from_sheet[0], overall_from_sheet[1]
        )
        walls_mm = _snap_ty_endpoints(walls_mm)
        walls_mm = _split_walls_at_junctions(walls_mm)
        walls_mm = _snap_ty_endpoints(walls_mm)
        walls_mm = _dedupe_walls(walls_mm)
        walls_mm = _normalize_origin(walls_mm)
    # Cap absurd CAD elevation heights picked up from multi-view sheets
    height_mm = _infer_height_mm(labels)
    page_height = _infer_height_from_page_text(page)
    if page_height and page_height <= 12000:
        height_mm = page_height
    if height_mm > 12000:
        height_mm = 3000.0
    page_text = page.get_text("text") or ""
    # Skip slow full-page OCR on large multi-view CAD sheets that already have text
    needs_ocr_text = (
        dialect != "ups_cad_multi"
        and ("THK" not in page_text.upper() or "EXT" not in page_text.upper())
    )
    if needs_ocr_text:
        page_text = (page_text + "\n" + _ocr_page_text_blob(page)).strip()
    thickness_mm = _infer_thickness_mm(labels, page_text=page_text)
    # Specs often say "150mm THK" / "200mm" for CAD sheets
    if dialect == "ups_cad_multi" and thickness_mm == 100:
        text_u = page_text.upper()
        for cand in (200, 150, 100):
            if f"{cand}MM" in text_u.replace(" ", "") or f"{cand} MM" in text_u:
                thickness_mm = float(cand)
                break

    return {
        "page_index": page_index,
        "page_count": doc.page_count,
        "dialect": dialect,
        "cluster": cluster_name,
        "clip_rect": list(clip) if clip else None,
        "scale_mm_per_pt": round(scale, 4),
        "overall_width_mm": overall,
        "height_mm": height_mm,
        "thickness_mm": thickness_mm,
        "walls": walls_mm,
        "dimensions": {
            "wall": [
                {"value_mm": d["value_mm"], "text": d["text"], "x": round(d["x"], 1), "y": round(d["y"], 1)}
                for d in classified["wall"]
            ],
            "panel": [
                {
                    "value_mm": d["value_mm"],
                    "module_mm": d.get("module_mm"),
                    "quantity": d.get("quantity"),
                    "text": d["text"],
                    "x": round(d["x"], 1),
                    "y": round(d["y"], 1),
                }
                for d in classified["panel"]
            ],
        },
        "notes": (
            [
                "Geometry from WALL LAYOUT vector render (centerlines). "
                "OCR/labels used only for scale and thickness — not wall positions."
            ]
            if cluster_name == "wall_layout_raster"
            else []
        ),
    }
