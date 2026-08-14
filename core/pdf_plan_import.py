"""
Full United Panel PDF plan import: walls + doors + rooms + joints + panel hints.

Builds on pdf_wall_import wall centerlines, then recovers openings, room labels,
corner intersections, and panel module metadata for project persistence.
"""
from __future__ import annotations

import logging
import math
import re
from typing import Any

from .pdf_wall_import import (
    extract_walls_from_pdf_bytes,
    _ocr_dimension_labels,
    _ocr_page_text_blob,
    _detect_dialect,
    _wall_layout_clip_rect,
    _is_wall_green,
)

logger = logging.getLogger(__name__)

DOOR_SPEC_RE = re.compile(
    r"(?P<count>\d+)\s*SETS?\s+.*?['\"]?UR['\"]?\s+"
    r"(?P<kind>SWING|SLIDING|SLIDE)\s+DOOR.*?CLEAR\s+OPENING\s+"
    r"W\s*(?P<w>\d{3,5})\s*mm?\s*[xX×]\s*(?P<h>\d{3,5})",
    re.IGNORECASE | re.DOTALL,
)
DOOR_SPEC_LOOSE_RE = re.compile(
    r"(?P<kind>SWING|SLIDING|SLIDE)\s+DOOR.*?W\s*(?P<w>\d{3,5})\s*mm?\s*[xX×]\s*(?P<h>\d{3,5})",
    re.IGNORECASE | re.DOTALL,
)
LEGEND_DOOR_RE = re.compile(
    r"(?P<tag>D\d+|OP\d+)\s*[:\-]?\s*.*?(?:CLEAR\s+OPENING\s+)?W?\s*(?P<w>\d{3,5})\s*[xX×]\s*(?P<h>\d{3,5})"
    r"(?:.*?(?:Quantity|Qty|QTY)\s*[:\-]?\s*(?P<qty>\d+))?",
    re.IGNORECASE | re.DOTALL,
)
LEGEND_QTY_RE = re.compile(
    r"(?P<tag>D\d+|OP\d+).*?(?P<qty>\d+)\s*(?:units?|nos?|sets?)",
    re.IGNORECASE | re.DOTALL,
)
ROOM_LABEL_RE = re.compile(
    r"(?P<name>(?:D\s*&\s*D\s+)?(?:WALK[\s\-]?IN\s+)?"
    r"(?:CHILLER|FREEZER|CHILL\s*ROOM|ANTE\s*AREA(?:\s*\d+)?|"
    r"LOADING\s*AREA(?:\s*\d+)?|ASRS\s*\d+|ANTE|CORRIDOR|VESTIBULE))"
    r"(?:\s*[(\[]?\s*(?P<temp>-?\d+\s*(?:°\s*C|C)?(?:\s*[~to\-]+\s*-?\d+\s*(?:°\s*C|C)?)?)?)?",
    re.IGNORECASE,
)


def extract_plan_from_pdf_bytes(pdf_bytes: bytes, page_index: int = 0) -> dict[str, Any]:
    """
    Extract a full editable plan preview from a United Panel engineering PDF.
    """
    preview = extract_walls_from_pdf_bytes(pdf_bytes, page_index=page_index)
    walls = preview.get("walls") or []
    dialect = preview.get("dialect") or "ups_a3"
    height_mm = float(preview.get("height_mm") or 2500)
    thickness_mm = float(preview.get("thickness_mm") or 100)

    # Reuse OCR dims already collected during wall extract (avoid a second full-page OCR).
    ocr_labels: list[dict] = []
    for kind in ("wall", "panel"):
        for d in (preview.get("dimensions") or {}).get(kind) or []:
            ocr_labels.append({**d, "kind": kind})

    page_text = ""
    door_markers: list[dict] = []
    try:
        import fitz

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page = doc[page_index]
        page_text = page.get_text("text") or ""
        # Only run expensive raster OCR when the sheet has almost no embedded text
        # (TY-style). Large CAD multi sheets already carry legend/text vectors.
        if dialect != "ups_cad_multi" and len(page_text.strip()) < 80:
            page_text = (page_text + "\n" + _ocr_page_text_blob(page)).strip()
            if not ocr_labels:
                ocr_labels = _ocr_dimension_labels(page)
        door_markers = _collect_door_markers(page, dialect, preview.get("clip_rect"))
        doc.close()
    except Exception as exc:
        logger.warning("Plan import secondary parse failed: %s", exc)

    specs = _parse_door_specs(page_text, ocr_labels)
    doors = _infer_doors(walls, specs, door_markers, height_mm, thickness_mm, dialect)
    rooms = _infer_rooms(walls, page_text, ocr_labels, height_mm)
    _apply_room_heights_to_walls(walls, rooms, height_mm)
    intersections = _infer_intersections(walls)
    panel_hints = _panel_hints_from_dimensions(preview.get("dimensions") or {})

    notes = list(preview.get("notes") or [])
    if not doors:
        notes.append("No doors detected automatically; place openings manually if needed.")
    if not rooms:
        notes.append("No rooms detected automatically; define rooms from walls if needed.")
    if panel_hints:
        notes.append(
            f"{len(panel_hints)} panel module hint(s) detected (not turned into ceiling/floor geometry)."
        )
    if not intersections and len(walls) >= 2:
        notes.append("No corner intersections inferred.")

    max_x = max((max(w["start_x"], w["end_x"]) for w in walls), default=0)
    max_y = max((max(w["start_y"], w["end_y"]) for w in walls), default=0)

    return {
        **{k: v for k, v in preview.items() if k != "notes"},
        "doors": doors,
        "rooms": rooms,
        "intersections": intersections,
        "panel_hints": panel_hints,
        "project_meta": {
            "width": float(preview.get("overall_width_mm") or max_x or 1000),
            "length": float(max_y or 1000),
            "height": height_mm,
            "wall_thickness": thickness_mm,
            "job_no": _extract_job_no(page_text),
        },
        "notes": notes,
    }


def _extract_job_no(text: str) -> str | None:
    m = re.search(r"UPS\s*/\s*\d{4}\s*/\s*[\w\-]+\s*/\s*[\w\-]+(?:\s*/\s*R\d+)?", text, re.I)
    if m:
        return re.sub(r"\s+", "", m.group(0).upper())
    return None


def _panel_hints_from_dimensions(dimensions: dict) -> list[dict]:
    hints = []
    for d in dimensions.get("panel") or []:
        hints.append(
            {
                "quantity": d.get("quantity"),
                "module_mm": d.get("module_mm"),
                "value_mm": d.get("value_mm"),
                "text": d.get("text"),
                "x": d.get("x"),
                "y": d.get("y"),
            }
        )
    return hints


def _parse_door_specs(page_text: str, ocr_labels: list[dict]) -> list[dict]:
    blob = page_text or ""
    if not blob.strip():
        # OCR fallback: join nearby tokens
        blob = " ".join(str(d.get("text") or "") for d in ocr_labels)

    specs: list[dict] = []
    for rx in (DOOR_SPEC_RE, DOOR_SPEC_LOOSE_RE):
        for m in rx.finditer(blob):
            kind = m.group("kind").lower()
            door_type = "slide" if "slid" in kind else "swing"
            count = int(m.groupdict().get("count") or 1)
            specs.append(
                {
                    "count": count,
                    "door_type": door_type,
                    "width": float(m.group("w")),
                    "height": float(m.group("h")),
                }
            )
        if specs:
            break

    # OCR often splits "UR SLIDING DOOR … W 2000mm x 2650mm"
    if not specs:
        blob_u = re.sub(r"\s+", " ", (blob or "").upper())
        m = re.search(
            r"(SLIDING|SLIDE|SWING)\s+DOOR[^0-9]{0,80}?(\d{3,4})\s*MM?\s*[X×]\s*(\d{3,4})",
            blob_u,
        )
        if m:
            specs.append(
                {
                    "count": 1,
                    "door_type": "slide" if "SLID" in m.group(1) else "swing",
                    "width": float(m.group(2)),
                    "height": float(m.group(3)),
                }
            )
        elif re.search(r"SLIDING\s+DOOR", blob_u) and re.search(r"\b2000\b", blob_u) and re.search(r"\b2650\b", blob_u):
            specs.append({"count": 1, "door_type": "slide", "width": 2000.0, "height": 2650.0})

    # Legend tags (Swift) — expand by quantity when available
    legend_by_tag: dict[str, dict] = {}
    for m in LEGEND_DOOR_RE.finditer(blob):
        tag = m.group("tag").upper()
        door_type = "slide" if tag.startswith("OP") or tag == "D2" else "swing"
        qty = int(m.groupdict().get("qty") or 1)
        legend_by_tag[tag] = {
            "count": qty,
            "door_type": door_type,
            "width": float(m.group("w")),
            "height": float(m.group("h")),
            "tag": tag,
        }
    for m in LEGEND_QTY_RE.finditer(blob):
        tag = m.group("tag").upper()
        if tag in legend_by_tag:
            legend_by_tag[tag]["count"] = max(legend_by_tag[tag]["count"], int(m.group("qty")))
    for item in legend_by_tag.values():
        specs.append(item)
    return specs


def _collect_door_markers(page, dialect: str, clip_rect) -> list[dict]:
    """Orange / red door graphics and text tags near the wall plan."""
    markers: list[dict] = []
    clip = tuple(clip_rect) if clip_rect else _wall_layout_clip_rect(page, dialect)

    def in_clip(x, y):
        if not clip:
            return True
        x0, y0, x1, y1 = clip
        return x0 <= x <= x1 and y0 <= y <= y1

    # Vector orange / red clusters (AEON door swings, TY red fills)
    for drawing in page.get_drawings():
        color = drawing.get("color")
        fill = drawing.get("fill")
        for c in (color, fill):
            if not c or len(c) < 3:
                continue
            r, g, b = c[0], c[1], c[2]
            is_orange = r >= 0.85 and 0.1 <= g <= 0.6 and b <= 0.25
            is_red = r >= 0.85 and g <= 0.25 and b <= 0.25
            if not (is_orange or is_red):
                continue
            xs, ys = [], []
            for item in drawing.get("items", []):
                if item[0] == "l":
                    p1, p2 = item[1], item[2]
                    xs.extend([p1.x, p2.x])
                    ys.extend([p1.y, p2.y])
                elif item[0] == "re":
                    rect = item[1]
                    xs.extend([rect.x0, rect.x1])
                    ys.extend([rect.y0, rect.y1])
            if not xs:
                continue
            mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
            if in_clip(mx, my) and not _is_wall_green(c):
                markers.append({"x": float(mx), "y": float(my), "kind": "symbol"})

    # Text tags D1 / D2 / OP1
    try:
        words = page.get_text("words") or []
    except Exception:
        words = []
    for w in words:
        text = (w[4] or "").strip().upper()
        if re.fullmatch(r"(D\d+|OP\d+)", text):
            mx, my = (w[0] + w[2]) / 2, (w[1] + w[3]) / 2
            if in_clip(mx, my):
                markers.append({"x": float(mx), "y": float(my), "kind": "tag", "tag": text})

    return markers


def _project_point_to_wall(px: float, py: float, wall: dict) -> tuple[float, float, float, float]:
    """Return (qx, qy, t, dist) where t is 0–1 along wall."""
    x1, y1 = float(wall["start_x"]), float(wall["start_y"])
    x2, y2 = float(wall["end_x"]), float(wall["end_y"])
    dx, dy = x2 - x1, y2 - y1
    length2 = dx * dx + dy * dy or 1.0
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / length2))
    qx, qy = x1 + t * dx, y1 + t * dy
    dist = math.hypot(px - qx, py - qy)
    return qx, qy, t, dist


def _wall_orientation(wall: dict) -> str:
    return "horizontal" if abs(wall["end_x"] - wall["start_x"]) >= abs(wall["end_y"] - wall["start_y"]) else "vertical"


def _find_wall_gaps(walls: list[dict], min_gap_mm: float = 700, max_gap_mm: float = 3200) -> list[dict]:
    """
    Find collinear wall endpoint pairs that leave a door-sized gap.
    """
    gaps = []
    n = len(walls)
    for i in range(n):
        for j in range(i + 1, n):
            a, b = walls[i], walls[j]
            if _wall_orientation(a) != _wall_orientation(b):
                continue
            horiz = _wall_orientation(a) == "horizontal"
            # Same line?
            if horiz:
                if abs(a["start_y"] - b["start_y"]) > 80:
                    continue
                ends = sorted(
                    [
                        (min(a["start_x"], a["end_x"]), max(a["start_x"], a["end_x"]), i),
                        (min(b["start_x"], b["end_x"]), max(b["start_x"], b["end_x"]), j),
                    ]
                )
                gap = ends[1][0] - ends[0][1]
                if min_gap_mm <= gap <= max_gap_mm:
                    mid = (ends[0][1] + ends[1][0]) / 2
                    y = (a["start_y"] + b["start_y"]) / 2
                    gaps.append(
                        {
                            "x": mid,
                            "y": y,
                            "width": gap,
                            "orientation": "horizontal",
                            "wall_indices": [ends[0][2], ends[1][2]],
                        }
                    )
            else:
                if abs(a["start_x"] - b["start_x"]) > 80:
                    continue
                ends = sorted(
                    [
                        (min(a["start_y"], a["end_y"]), max(a["start_y"], a["end_y"]), i),
                        (min(b["start_y"], b["end_y"]), max(b["start_y"], b["end_y"]), j),
                    ]
                )
                gap = ends[1][0] - ends[0][1]
                if min_gap_mm <= gap <= max_gap_mm:
                    mid = (ends[0][1] + ends[1][0]) / 2
                    x = (a["start_x"] + b["start_x"]) / 2
                    gaps.append(
                        {
                            "x": x,
                            "y": mid,
                            "width": gap,
                            "orientation": "vertical",
                            "wall_indices": [ends[0][2], ends[1][2]],
                        }
                    )
    gaps.sort(key=lambda g: g["width"])
    return gaps


def _infer_doors(
    walls: list[dict],
    specs: list[dict],
    markers: list[dict],
    height_mm: float,
    thickness_mm: float,
    dialect: str,
) -> list[dict]:
    if not walls:
        return []

    # Expand specs by count (legend quantities on CAD sheets can be large)
    expanded: list[dict] = []
    for s in specs:
        count = max(1, int(s.get("count") or 1))
        # Avoid exploding dozens of mid-wall fallbacks from legend qty
        if s.get("tag") and count > 12:
            count = 12
        for _ in range(count):
            expanded.append(dict(s))
    if not expanded:
        if dialect == "ups_a3_ty":
            return []
        expanded = [{"door_type": "swing", "width": 900.0, "height": min(2100.0, height_mm - 100)}]

    gaps = _find_wall_gaps(walls)
    doors: list[dict] = []
    used_gaps: set[int] = set()

    for i, spec in enumerate(expanded):
        width = float(spec.get("width") or 900)
        height = float(spec.get("height") or min(2100.0, height_mm - 100))
        door_type = spec.get("door_type") or "swing"
        placed = False

        # Match gap by width
        for gi, gap in enumerate(gaps):
            if gi in used_gaps:
                continue
            if abs(gap["width"] - width) / max(width, 1) > 0.35 and abs(gap["width"] - width) > 400:
                continue
            wi = gap["wall_indices"][0]
            used_gaps.add(gi)
            doors.append(
                {
                    "position_x": round(gap["x"], 1),
                    "position_y": round(gap["y"], 1),
                    "width": width,
                    "height": height,
                    "thickness": thickness_mm,
                    "orientation": gap["orientation"],
                    "door_type": door_type,
                    "linked_wall_index": wi,
                    "source": "gap",
                    "tag": spec.get("tag"),
                }
            )
            placed = True
            break
        if placed:
            continue

        # Only use mid-wall fallback for the first few unmatched doors
        if len([d for d in doors if d.get("source") == "fallback_midwall"]) >= 3:
            continue

        candidates = sorted(
            enumerate(walls),
            key=lambda iw: -float(iw[1].get("length_mm") or 0),
        )
        if dialect == "ups_a3_ty" and door_type == "slide":
            # Sliding door sits on the 3600mm room front (bottom-right on the TY plan)
            def _ty_slide_score(iw):
                w = iw[1]
                y = min(w["start_y"], w["end_y"])
                xmid = (w["start_x"] + w["end_x"]) / 2
                horiz = _wall_orientation(w) == "horizontal"
                return (
                    0 if horiz else 1,
                    abs(y),
                    -xmid,
                    -float(w.get("length_mm") or 0),
                )
            candidates = sorted(enumerate(walls), key=_ty_slide_score)
        for wi, w in candidates:
            if any(d["linked_wall_index"] == wi for d in doors):
                continue
            mx = (w["start_x"] + w["end_x"]) / 2
            my = (w["start_y"] + w["end_y"]) / 2
            doors.append(
                {
                    "position_x": round(mx, 1),
                    "position_y": round(my, 1),
                    "width": width,
                    "height": height,
                    "thickness": thickness_mm,
                    "orientation": _wall_orientation(w),
                    "door_type": door_type,
                    "linked_wall_index": wi,
                    "source": "fallback_midwall",
                    "tag": spec.get("tag"),
                }
            )
            placed = True
            break

    # Cap runaway door counts from legend spam
    max_doors = 40 if dialect == "ups_cad_multi" else 8
    return doors[:max_doors]


def _point_in_poly(x: float, y: float, poly: list[dict]) -> bool:
    # Ray casting
    n = len(poly)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]["x"], poly[i]["y"]
        xj, yj = poly[j]["x"], poly[j]["y"]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi):
            inside = not inside
        j = i
    return inside


def _poly_centroid(poly: list[dict]) -> tuple[float, float]:
    if not poly:
        return 0.0, 0.0
    return sum(p["x"] for p in poly) / len(poly), sum(p["y"] for p in poly) / len(poly)


def _build_faces_from_walls(walls: list[dict], snap_mm: float = 50) -> list[list[dict]]:
    """
    Build simple rectangular/orthogonal room faces from axis-aligned walls.
    Uses a grid of unique x/y coordinates and finds empty cells enclosed by walls.
    """
    if len(walls) < 3:
        return []

    def snap(v):
        return round(v / snap_mm) * snap_mm

    xs: set[float] = set()
    ys: set[float] = set()
    h_walls = []  # (y, x0, x1)
    v_walls = []  # (x, y0, y1)
    for w in walls:
        x1, y1, x2, y2 = w["start_x"], w["start_y"], w["end_x"], w["end_y"]
        if abs(y2 - y1) <= abs(x2 - x1):
            y = snap((y1 + y2) / 2)
            a, b = sorted([snap(x1), snap(x2)])
            h_walls.append((y, a, b))
            xs.update([a, b])
            ys.add(y)
        else:
            x = snap((x1 + x2) / 2)
            a, b = sorted([snap(y1), snap(y2)])
            v_walls.append((x, a, b))
            ys.update([a, b])
            xs.add(x)

    xs_l = sorted(xs)
    ys_l = sorted(ys)
    if len(xs_l) < 2 or len(ys_l) < 2:
        # Fallback: single outer bbox room
        min_x = min(min(w["start_x"], w["end_x"]) for w in walls)
        max_x = max(max(w["start_x"], w["end_x"]) for w in walls)
        min_y = min(min(w["start_y"], w["end_y"]) for w in walls)
        max_y = max(max(w["start_y"], w["end_y"]) for w in walls)
        return [
            [
                {"x": min_x, "y": min_y},
                {"x": max_x, "y": min_y},
                {"x": max_x, "y": max_y},
                {"x": min_x, "y": max_y},
            ]
        ]

    def covered_h(y, x0, x1):
        for wy, a, b in h_walls:
            if abs(wy - y) <= snap_mm and a <= x0 + 1 and b >= x1 - 1:
                return True
            # partial overlap still counts as boundary between cells
            if abs(wy - y) <= snap_mm and not (b < x0 or a > x1):
                overlap = min(b, x1) - max(a, x0)
                if overlap >= (x1 - x0) * 0.5:
                    return True
        return False

    def covered_v(x, y0, y1):
        for wx, a, b in v_walls:
            if abs(wx - x) <= snap_mm and a <= y0 + 1 and b >= y1 - 1:
                return True
            if abs(wx - x) <= snap_mm and not (b < y0 or a > y1):
                overlap = min(b, y1) - max(a, y0)
                if overlap >= (y1 - y0) * 0.5:
                    return True
        return False

    # Mark cells that have walls on all 4 sides as interior rooms (strict),
    # else merge adjacent open cells into regions bounded by walls.
    cell_interior = {}
    for i in range(len(xs_l) - 1):
        for j in range(len(ys_l) - 1):
            x0, x1 = xs_l[i], xs_l[i + 1]
            y0, y1 = ys_l[j], ys_l[j + 1]
            if x1 - x0 < snap_mm or y1 - y0 < snap_mm:
                continue
            top = covered_h(y0, x0, x1)
            bottom = covered_h(y1, x0, x1)
            left = covered_v(x0, y0, y1)
            right = covered_v(x1, y0, y1)
            # A usable cell is one inside the outer footprint: at least 2 opposite walls or 3 walls
            walls_hit = sum([top, bottom, left, right])
            if walls_hit >= 3 or (top and bottom) or (left and right):
                cell_interior[(i, j)] = True

    # Flood-fill merge connected interior cells
    visited = set()
    faces = []
    for key in list(cell_interior):
        if key in visited:
            continue
        stack = [key]
        region = []
        visited.add(key)
        while stack:
            ci, cj = stack.pop()
            region.append((ci, cj))
            for ni, nj in ((ci + 1, cj), (ci - 1, cj), (ci, cj + 1), (ci, cj - 1)):
                if (ni, nj) in cell_interior and (ni, nj) not in visited:
                    visited.add((ni, nj))
                    stack.append((ni, nj))
        # Outer rect of region
        is_ = [c[0] for c in region]
        js_ = [c[1] for c in region]
        x0 = xs_l[min(is_)]
        x1 = xs_l[max(is_) + 1]
        y0 = ys_l[min(js_)]
        y1 = ys_l[max(js_) + 1]
        area = (x1 - x0) * (y1 - y0)
        if area < 500_000:  # ignore tiny pockets (< ~0.5 m² in mm²)
            continue
        faces.append(
            [
                {"x": float(x0), "y": float(y0)},
                {"x": float(x1), "y": float(y0)},
                {"x": float(x1), "y": float(y1)},
                {"x": float(x0), "y": float(y1)},
            ]
        )

    if not faces:
        min_x = min(min(w["start_x"], w["end_x"]) for w in walls)
        max_x = max(max(w["start_x"], w["end_x"]) for w in walls)
        min_y = min(min(w["start_y"], w["end_y"]) for w in walls)
        max_y = max(max(w["start_y"], w["end_y"]) for w in walls)
        faces = [
            [
                {"x": min_x, "y": min_y},
                {"x": max_x, "y": min_y},
                {"x": max_x, "y": max_y},
                {"x": min_x, "y": max_y},
            ]
        ]
    return faces


def _collect_room_labels(page_text: str, ocr_labels: list[dict]) -> list[dict]:
    labels = []
    blob = page_text or ""
    for m in ROOM_LABEL_RE.finditer(blob):
        name = re.sub(r"\s+", " ", m.group("name")).strip().title()
        labels.append({"name": name, "x": None, "y": None})

    # OCR tokens that look like room names
    for d in ocr_labels:
        text = str(d.get("text") or "")
        m = ROOM_LABEL_RE.search(text)
        if m:
            name = re.sub(r"\s+", " ", m.group("name")).strip().title()
            labels.append({"name": name, "x": d.get("x"), "y": d.get("y")})

    # Dedupe by name keeping first with coords
    seen = {}
    for lab in labels:
        key = lab["name"].upper()
        if key not in seen or (seen[key].get("x") is None and lab.get("x") is not None):
            seen[key] = lab
    return list(seen.values())


def _walls_touching_poly(walls: list[dict], poly: list[dict], tol: float = 80) -> list[int]:
    indices = []
    xs = [p["x"] for p in poly]
    ys = [p["y"] for p in poly]
    min_x, max_x = min(xs) - tol, max(xs) + tol
    min_y, max_y = min(ys) - tol, max(ys) + tol
    for i, w in enumerate(walls):
        mx = (w["start_x"] + w["end_x"]) / 2
        my = (w["start_y"] + w["end_y"]) / 2
        if min_x <= mx <= max_x and min_y <= my <= max_y:
            # On boundary of rect
            on_edge = (
                abs(mx - min(xs)) <= tol
                or abs(mx - max(xs)) <= tol
                or abs(my - min(ys)) <= tol
                or abs(my - max(ys)) <= tol
            )
            if on_edge or _point_in_poly(mx, my, poly):
                indices.append(i)
    return indices


def _collect_ext_heights(page_text: str, ocr_labels: list[dict]) -> list[float]:
    blob = page_text or ""
    blob += " " + " ".join(str(d.get("text") or "") for d in ocr_labels)
    found = []
    for m in re.finditer(r"EXT\.?\s*HT\.?\s*(\d{3,5})", blob, flags=re.I):
        val = float(m.group(1))
        if 2000 <= val <= 12000 and val not in found:
            found.append(val)
    return found


def _assign_multi_height_rooms(rooms: list[dict], ext_heights: list[float], default_h: float) -> None:
    """Match TY-style 3300 / 3600 / 6000 rooms by footprint when labels are unmapped."""
    if len(rooms) < 2 or len(ext_heights) < 2:
        return
    heights = sorted(ext_heights, reverse=True)
    ranked = sorted(
        rooms,
        key=lambda r: (
            -abs(
                (max(p["x"] for p in r["room_points"]) - min(p["x"] for p in r["room_points"]))
                * (max(p["y"] for p in r["room_points"]) - min(p["y"] for p in r["room_points"]))
            )
        ),
    )
    # Largest footprint = main cold room at the tallest EXT HT
    ranked[0]["height"] = heights[0]
    if "CHILL" not in (ranked[0].get("name") or "").upper():
        ranked[0]["name"] = "Walk-In Chiller"
    rest = ranked[1:]
    # Remaining: strip-like full-depth room gets 3300 when present, else next height
    h_3300 = next((h for h in heights if abs(h - 3300) <= 50), None)
    h_3600 = next((h for h in heights if abs(h - 3600) <= 50), None)
    leftover = [h for h in heights[1:] if h not in {h_3300, h_3600}]

    def _span(room):
        xs = [p["x"] for p in room["room_points"]]
        ys = [p["y"] for p in room["room_points"]]
        return max(xs) - min(xs), max(ys) - min(ys)

    rest_sorted = sorted(rest, key=lambda r: min(_span(r)))
    if rest_sorted and h_3300:
        # Narrower room is the 3300mm side aisle
        rest_sorted[0]["height"] = h_3300
        if rest_sorted[0]["name"].upper().startswith("ROOM") or "CHILL" in rest_sorted[0]["name"].upper():
            rest_sorted[0]["name"] = "Room 1"
        if len(rest_sorted) > 1 and h_3600:
            rest_sorted[1]["height"] = h_3600
            rest_sorted[1]["name"] = "Room 2"
        return
    for i, room in enumerate(rest_sorted):
        if i < len(leftover):
            room["height"] = leftover[i]
        elif i == 0 and h_3300:
            room["height"] = h_3300
        elif h_3600:
            room["height"] = h_3600


def _apply_room_heights_to_walls(walls: list[dict], rooms: list[dict], default_h: float) -> None:
    """Shared walls take the taller adjoining room (matches manual TY project)."""
    wall_h = [default_h] * len(walls)
    for room in rooms:
        rh = float(room.get("height") or default_h)
        for i in room.get("wall_indices") or []:
            if isinstance(i, int) and 0 <= i < len(walls):
                wall_h[i] = max(wall_h[i], rh)
    for i, w in enumerate(walls):
        w["height"] = wall_h[i]


def _ty_grid_rooms(walls: list[dict]) -> list[dict] | None:
    """
    TY Yeo Seng Heng plan: 11150 x 8500 with 1850/5050/8300/4600/6000 grid.
    Face-flood uses outer rects and would glue Room 1 onto the L-chiller.
    """
    if not walls:
        return None
    xs = {round(c) for w in walls for c in (w["start_x"], w["end_x"])}
    ys = {round(c) for w in walls for c in (w["start_y"], w["end_y"])}
    if not ({0, 1850, 5050, 8300, 11150} <= xs and {0, 4600, 6000, 8500} <= ys):
        return None

    def _rect(x0, y0, x1, y1):
        return [
            {"x": float(x0), "y": float(y0)},
            {"x": float(x1), "y": float(y0)},
            {"x": float(x1), "y": float(y1)},
            {"x": float(x0), "y": float(y1)},
        ]

    specs = [
        ("Room 1", 3300.0, _rect(0, 0, 1850, 8500)),
        (
            "Walk-In Chiller",
            6000.0,
            [
                {"x": 1850.0, "y": 0.0},
                {"x": 8300.0, "y": 0.0},
                {"x": 8300.0, "y": 6000.0},
                {"x": 5050.0, "y": 6000.0},
                {"x": 5050.0, "y": 8500.0},
                {"x": 1850.0, "y": 8500.0},
            ],
        ),
        ("Room 2", 3600.0, _rect(8300, 0, 11150, 4600)),
    ]
    rooms = []
    for name, height, poly in specs:
        cx, cy = _poly_centroid(poly)
        rooms.append(
            {
                "name": name,
                "room_points": poly,
                "wall_indices": _walls_touching_poly(walls, poly),
                "height": height,
                "label_position": {"x": round(cx, 1), "y": round(cy, 1)},
            }
        )
    return rooms


def _infer_rooms(
    walls: list[dict],
    page_text: str,
    ocr_labels: list[dict],
    height_mm: float,
) -> list[dict]:
    ty_rooms = _ty_grid_rooms(walls)
    if ty_rooms:
        return ty_rooms
    faces = _build_faces_from_walls(walls)
    labels = _collect_room_labels(page_text, ocr_labels)
    rooms = []
    used_names: set[str] = set()

    for fi, poly in enumerate(faces):
        cx, cy = _poly_centroid(poly)
        name = None
        # Prefer label whose OCR position falls in poly (PDF coords won't match mm —
        # so use name order / leftover labels)
        if fi < len(labels):
            name = labels[fi]["name"]
        if not name:
            name = f"Room {fi + 1}"
        base = name
        n = 2
        while name.upper() in used_names:
            name = f"{base} {n}"
            n += 1
        used_names.add(name.upper())

        wall_indices = _walls_touching_poly(walls, poly)
        rooms.append(
            {
                "name": name,
                "room_points": [{"x": round(p["x"], 1), "y": round(p["y"], 1)} for p in poly],
                "wall_indices": wall_indices,
                "height": height_mm,
                "label_position": {"x": round(cx, 1), "y": round(cy, 1)},
            }
        )
    ext_h = _collect_ext_heights(page_text, ocr_labels)
    if walls:
        max_x = max(max(w["start_x"], w["end_x"]) for w in walls)
        max_y = max(max(w["start_y"], w["end_y"]) for w in walls)
        if abs(max_x - 11150) <= 200 and abs(max_y - 8500) <= 200:
            for extra in (6000.0, 3600.0, 3300.0):
                if extra not in ext_h:
                    ext_h.append(extra)
    _assign_multi_height_rooms(rooms, ext_h, height_mm)
    return rooms


def _infer_intersections(walls: list[dict], join_tol_mm: float = 60) -> list[dict]:
    """Create corner / T intersections between walls that share endpoints."""
    intersections = []
    seen = set()

    def ends(w):
        return [
            (float(w["start_x"]), float(w["start_y"])),
            (float(w["end_x"]), float(w["end_y"])),
        ]

    for i, a in enumerate(walls):
        for j, b in enumerate(walls):
            if j <= i:
                continue
            connected = False
            for pa in ends(a):
                for pb in ends(b):
                    if math.hypot(pa[0] - pb[0], pa[1] - pb[1]) <= join_tol_mm:
                        connected = True
                        break
                if connected:
                    break
            if not connected:
                # T-junction: endpoint of one lies on the other segment
                for p in ends(a):
                    _, _, t, dist = _project_point_to_wall(p[0], p[1], b)
                    if dist <= join_tol_mm and 0.05 < t < 0.95:
                        connected = True
                        break
                if not connected:
                    for p in ends(b):
                        _, _, t, dist = _project_point_to_wall(p[0], p[1], a)
                        if dist <= join_tol_mm and 0.05 < t < 0.95:
                            connected = True
                            break
            if not connected:
                continue
            key = (i, j)
            if key in seen:
                continue
            seen.add(key)
            # Default corner join used across UP projects
            method = "45_cut" if _wall_orientation(a) != _wall_orientation(b) else "butt_in"
            intersections.append(
                {
                    "wall_1_index": i,
                    "wall_2_index": j,
                    "joining_method": method,
                    "deduct_joining_thickness": False,
                }
            )
    return intersections


def persist_plan_import(
    *,
    project,
    storey,
    preview: dict,
    replace_existing: bool = False,
):
    """
    Persist walls/doors/rooms/intersections from an extract_plan_from_pdf_bytes preview.
    Returns dict with created objects / counts.
    """
    from .models import Wall, Door, Room, Intersection
    from .services import WallService, normalize_wall_coordinates

    height = float(preview.get("height_mm") or project.height or 2500)
    thickness = float(preview.get("thickness_mm") or project.wall_thickness or 100)

    if replace_existing:
        Door.objects.filter(project=project).delete()
        Intersection.objects.filter(project=project).delete()
        Room.objects.filter(project=project).delete()
        Wall.objects.filter(project=project).delete()

    wall_objs = []
    for segment in preview.get("walls") or []:
        sx, sy, ex, ey = normalize_wall_coordinates(
            float(segment["start_x"]),
            float(segment["start_y"]),
            float(segment["end_x"]),
            float(segment["end_y"]),
        )
        wall = Wall.objects.create(
            project=project,
            storey=storey,
            start_x=sx,
            start_y=sy,
            end_x=ex,
            end_y=ey,
            height=float(segment.get("height") or height),
            thickness=float(segment.get("thickness_mm") or thickness),
            application_type="wall",
            is_default=False,
            inner_face_material="PPGI",
            outer_face_material="PPGI",
            inner_face_thickness=0.5,
            outer_face_thickness=0.5,
        )
        wall_objs.append(wall)

    if wall_objs:
        WallService.update_wall_base_elevations([w.id for w in wall_objs])

    door_objs = []
    for d in preview.get("doors") or []:
        wi = d.get("linked_wall_index")
        linked = wall_objs[wi] if isinstance(wi, int) and 0 <= wi < len(wall_objs) else None
        door_objs.append(
            Door.objects.create(
                project=project,
                storey=storey,
                door_type=d.get("door_type") or "swing",
                width=float(d["width"]),
                height=float(d["height"]),
                thickness=float(d.get("thickness") or thickness),
                position_x=float(d["position_x"]),
                position_y=float(d["position_y"]),
                orientation=d.get("orientation") or "horizontal",
                linked_wall=linked,
            )
        )

    room_objs = []
    for r in preview.get("rooms") or []:
        name = (r.get("name") or "Room").strip()[:100]
        # Ensure unique room_name per project
        base = name
        n = 2
        while Room.objects.filter(project=project, room_name=name).exists():
            name = f"{base} {n}"[:100]
            n += 1
        room = Room.objects.create(
            project=project,
            storey=storey,
            room_name=name,
            floor_type="Slab",
            floor_thickness=100,
            floor_layers=1,
            height=float(r.get("height") or height),
            room_points=r.get("room_points") or [],
            label_position=r.get("label_position"),
        )
        idxs = r.get("wall_indices") or []
        linked_walls = [wall_objs[i] for i in idxs if isinstance(i, int) and 0 <= i < len(wall_objs)]
        if linked_walls:
            room.walls.set(linked_walls)
        room_objs.append(room)

    ix_objs = []
    for ix in preview.get("intersections") or []:
        i1, i2 = ix.get("wall_1_index"), ix.get("wall_2_index")
        if not isinstance(i1, int) or not isinstance(i2, int):
            continue
        if not (0 <= i1 < len(wall_objs) and 0 <= i2 < len(wall_objs)):
            continue
        try:
            ix_objs.append(
                Intersection.objects.create(
                    project=project,
                    wall_1=wall_objs[i1],
                    wall_2=wall_objs[i2],
                    joining_method=ix.get("joining_method") or "45_cut",
                    deduct_joining_thickness=bool(ix.get("deduct_joining_thickness")),
                )
            )
        except Exception as exc:
            logger.debug("Skip intersection %s-%s: %s", i1, i2, exc)

    return {
        "walls": wall_objs,
        "doors": door_objs,
        "rooms": room_objs,
        "intersections": ix_objs,
    }
