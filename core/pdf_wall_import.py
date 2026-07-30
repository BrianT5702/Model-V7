"""
Import walls from United Panel PDF floor plans.

v1 strategy:
- Extract green wall face strokes from vector PDF drawings
- Pair nearest parallel faces into wall centerlines
- OCR dimension labels; classify wall vs panel dims
- Scale geometry from overall wall dimension (e.g. 13293)
- Return preview walls (joints/doors/windows left to the user)
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


def _is_wall_green(color) -> bool:
    if not color or len(color) < 3:
        return False
    r, g, b = color[0], color[1], color[2]
    return g >= 0.7 and r <= 0.35 and b <= 0.45


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


def _extract_green_segments(page) -> list[dict]:
    segs = []
    for drawing in page.get_drawings():
        if not _is_wall_green(drawing.get("color")):
            continue
        for item in drawing.get("items", []):
            if item[0] != "l":
                continue
            p1, p2 = item[1], item[2]
            length = math.hypot(p2.x - p1.x, p2.y - p1.y)
            # Keep short recess/end-cap faces (~25pt on AEON sheets)
            if length < 5:
                continue
            segs.append(
                {
                    "x1": float(p1.x),
                    "y1": float(p1.y),
                    "x2": float(p2.x),
                    "y2": float(p2.y),
                    "len": length,
                    "mx": (p1.x + p2.x) / 2,
                    "my": (p1.y + p2.y) / 2,
                }
            )
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


def _pair_wall_centerlines(segs: list[dict]) -> list[dict]:
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
            # Symbolic wall thickness in these PDFs is often ~0.7–2.2 pt
            if perp < 0.4 or perp > 2.8:
                continue
            ar = _proj_range(a["x1"], a["y1"], a["x2"], a["y2"], aux, auy)
            br = _proj_range(b["x1"], b["y1"], b["x2"], b["y2"], aux, auy)
            overlap = max(0.0, min(ar[1], br[1]) - max(ar[0], br[0]))
            if overlap < min(a_len, b_len) * 0.45:
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
        b_len = br[1] - br[0]
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


def _pick_best_walls(segs: list[dict], wall_dims: list[dict]) -> tuple[list[dict], str]:
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
) -> list[dict]:
    xs = [w["x1"] for w in walls_pt] + [w["x2"] for w in walls_pt]
    ys = [w["y1"] for w in walls_pt] + [w["y2"] for w in walls_pt]
    min_x, min_y = min(xs), min(ys)
    bw = max(xs) - min_x
    bh = max(ys) - min_y
    rotate = bh >= bw  # long axis often vertical in the extracted cluster

    raw_lengths = []
    mapped = []
    for wall in walls_pt:
        def map_pt(x, y, _rotate=rotate, _min_x=min_x, _min_y=min_y, _scale=scale):
            if _rotate:
                # PDF +Y down long axis -> model +X
                return ((y - _min_y) * _scale, (x - _min_x) * _scale)
            return ((x - _min_x) * _scale, (y - _min_y) * _scale)

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
        if abs(dy) / length <= tol_ratio and abs(dy) <= 80:
            y = round((y1 + y2) / 2)
            y1 = y2 = y
        elif abs(dx) / length <= tol_ratio and abs(dx) <= 80:
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


def _infer_height_mm(labels: list[dict], default: float = 2500) -> float:
    """Prefer explicit room/external heights (2900mm HT / EXT. HT) over defaults."""
    preferred = (2400, 2500, 2700, 2800, 2900, 3000, 3600)
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
        r"EXT\.?\s*HT\.?\s*[:=]?\s*(\d{4})\s*mm",
        r"(\d{4})\s*mm\s*HT",
        r"HT\.?\s*[:=]?\s*(\d{4})",
    ]
    hits = []
    for pat in patterns:
        for m in re.finditer(pat, raw, flags=re.IGNORECASE):
            val = int(m.group(1))
            if val in (2400, 2500, 2700, 2800, 2900, 3000, 3600):
                hits.append(val)
    if hits:
        # Prefer the most common declared height
        return float(max(set(hits), key=hits.count))

    # OCR fallback for sheets where height is only in rasterized annotations
    try:
        import pytesseract
        from PIL import Image
        import os

        for candidate in (
            r"C:\Program Files\Tesseract-OCR\tesseract.exe",
            r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
            os.path.expanduser(r"~\tesseract.exe"),
        ):
            if os.path.exists(candidate):
                pytesseract.pytesseract.tesseract_cmd = candidate
                break
        else:
            which = __import__("shutil").which("tesseract")
            if which:
                pytesseract.pytesseract.tesseract_cmd = which

        pix = page.get_pixmap(matrix=__import__("fitz").Matrix(1.5, 1.5))
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        text = pytesseract.image_to_string(img) or ""
        for pat in patterns:
            for m in re.finditer(pat, text, flags=re.IGNORECASE):
                val = int(m.group(1))
                if val in (2400, 2500, 2700, 2800, 2900, 3000, 3600):
                    hits.append(val)
        if hits:
            return float(max(set(hits), key=hits.count))
    except Exception as exc:
        logger.debug("Height OCR fallback failed: %s", exc)
    return default


def _infer_thickness_mm(labels: list[dict], default: float = 100) -> float:
    hundreds = [d["value_mm"] for d in labels if d["value_mm"] in (75, 100, 125, 150, 200)]
    if hundreds:
        # Prefer 100 when present
        if 100 in hundreds:
            return 100.0
        return float(hundreds[0])
    return float(default)


def extract_walls_from_pdf_bytes(pdf_bytes: bytes, page_index: int = 0) -> dict[str, Any]:
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

    segs = _extract_green_segments(page)
    if not segs:
        raise ValueError(
            "Could not detect green wall outlines in this PDF. "
            "Expected United Panel vector drawings with green wall faces."
        )

    labels = _ocr_dimension_labels(page)
    classified = _classify_dimensions(labels)
    walls_pt, cluster_name = _pick_best_walls(segs, classified["wall"])
    if not walls_pt:
        raise ValueError(
            "Could not pair wall faces in this PDF. "
            "Expected green double-line wall outlines."
        )

    scale, overall = _estimate_scale_mm_per_pt(walls_pt, classified["wall"])
    walls_mm = _dedupe_walls(
        _transform_walls_to_mm(
            walls_pt,
            scale,
            classified["wall"],
            classified["panel"],
            snap=False,
        )
    )
    walls_mm = [w for w in walls_mm if w["length_mm"] >= 200]
    walls_mm = _normalize_origin(walls_mm)
    walls_mm = _orient_notches_to_top(walls_mm)
    walls_mm = _axis_align_walls(walls_mm)
    walls_mm = _stitch_wall_corners(walls_mm, join_tol_mm=90)
    walls_mm = _axis_align_walls(walls_mm)
    walls_mm = _enforce_snapped_lengths(walls_mm, classified["wall"], classified["panel"])
    walls_mm = _stitch_wall_corners(walls_mm, join_tol_mm=100)
    walls_mm = _axis_align_walls(walls_mm)
    refined = _refine_wall_plan_topology(
        walls_mm,
        classified["wall"],
        overall,
        classified["panel"],
    )
    # Refine returns original walls when no top-chain pattern is detected
    walls_mm = refined
    walls_mm = _normalize_origin(walls_mm)
    height_mm = _infer_height_mm(labels)
    page_height = _infer_height_from_page_text(page)
    if page_height:
        height_mm = page_height
    thickness_mm = _infer_thickness_mm(labels)

    return {
        "page_index": page_index,
        "page_count": doc.page_count,
        "cluster": cluster_name,
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
        "notes": [
            "Joints are not set (define later).",
            "Doors and windows are not imported.",
            "Panel dimensions were detected but not turned into walls.",
        ],
    }
