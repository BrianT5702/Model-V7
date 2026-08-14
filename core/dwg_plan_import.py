"""
United Panel DWG/DXF plan import.

Converts DWG → DXF via bundled LibreDWG (dwg2dxf), then parses ENTITIES for
wall-layer LINE / LWPOLYLINE geometry. LibreDWG DXF often fails under ezdxf
(recover), so we use a tolerant group-code parser instead of a full DXF load.

Returns the same preview shape as pdf_plan_import.extract_plan_from_pdf_bytes
so persist_plan_import can be reused.
"""
from __future__ import annotations

import logging
import math
import os
import re
import shutil
import subprocess
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Layers that typically carry panel / partition wall faces in UP CAD.
WALL_LAYER_EXACT = {
    "W",
    "WALL",
    "COOLROOM PARTITION",
    "AC-PIR100mm",
    "AC 75mm PIR PANEL",
    "AC 200 PIR PANEL",
    "AC 50 PIR PANEL",
}
# Short hatch / panel-tick strokes — not structural walls.
HATCH_TICK_LAYERS = {"W"}
WALL_LAYER_RE = re.compile(
    r"(PIR\s*\d*\s*mm|PIR\s*PANEL|\bPANEL\b|\bWALL\b|PARTITION|COOLROOM)",
    re.IGNORECASE,
)
EXCLUDE_LAYER_RE = re.compile(
    r"^(DEFPOINTS|VIEWPORT|HATCH|DIM|TEXT|CENTER|AXIS|GRID|TITLE|BORDER|VIEW)",
    re.IGNORECASE,
)

# Double-line face gap ranges (mm) by layer hint. Fallback uses STANDARD_THICKNESSES.
LAYER_PAIR_RANGE: dict[str, tuple[float, float]] = {
    "AC-PIR100mm": (80, 130),
    "AC 75mm PIR PANEL": (55, 95),
    "AC 200 PIR PANEL": (160, 240),
    "AC 50 PIR PANEL": (40, 120),
    "W": (50, 95),
    "COOLROOM PARTITION": (90, 160),
}
STANDARD_THICKNESSES = (50, 75, 100, 125, 150, 200)
DEFAULT_PAIR_RANGE = (45, 220)
DOUBLE_STROKE_RANGE = (15.0, 45.0)
MIN_FACE_LEN_MM = 80.0
MIN_WALL_LEN_MM = 200.0
MIN_KEEP_UNPAIRED_MM = 600.0
ORIGIN_MARGIN_MM = 500.0
SPIKE_MIN_LEN_MM = 20000.0
SPIKE_MAX_INSIDE_FRAC = 0.4


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def find_dwg2dxf() -> Path | None:
    """Locate dwg2dxf: env DWG2DXF, PATH, or tools/libredwg next to the repo."""
    env = (os.environ.get("DWG2DXF") or "").strip()
    if env:
        p = Path(env)
        if p.is_file():
            return p
    which = shutil.which("dwg2dxf") or shutil.which("dwg2dxf.exe")
    if which:
        return Path(which)
    bundled = _repo_root() / "tools" / "libredwg" / "dwg2dxf.exe"
    if bundled.is_file():
        return bundled
    bundled_unix = _repo_root() / "tools" / "libredwg" / "dwg2dxf"
    if bundled_unix.is_file():
        return bundled_unix
    return None


def _thickness_from_layer(layer: str) -> float | None:
    m = re.search(r"(\d{2,3})\s*mm", layer, re.IGNORECASE)
    if m:
        return float(m.group(1))
    m = re.search(r"PIR\s*(\d{2,3})", layer, re.IGNORECASE)
    if m:
        return float(m.group(1))
    if re.search(r"\b200\b", layer):
        return 200.0
    if re.search(r"\b75\b", layer):
        return 75.0
    if re.search(r"\b50\b", layer):
        return 50.0
    if re.search(r"\b100\b", layer):
        return 100.0
    return None


def _pair_range_for_layer(layer: str) -> tuple[float, float]:
    if layer in LAYER_PAIR_RANGE:
        return LAYER_PAIR_RANGE[layer]
    t = _thickness_from_layer(layer)
    if t is not None:
        return (max(40.0, t * 0.7), t * 1.35)
    return DEFAULT_PAIR_RANGE


def _is_wall_layer(layer: str) -> bool:
    name = (layer or "").strip()
    if not name or EXCLUDE_LAYER_RE.match(name):
        return False
    if name in WALL_LAYER_EXACT or name.upper() in {x.upper() for x in WALL_LAYER_EXACT}:
        return True
    return bool(WALL_LAYER_RE.search(name))


def _is_single_line_layer(layer: str) -> bool:
    """Layers that already store centerlines (not double-line faces)."""
    return (layer or "").strip().upper() == "WALL"


def convert_dwg_to_dxf(dwg_bytes: bytes, *, as_version: str = "r2000") -> bytes:
    """
    Convert DWG bytes to DXF via LibreDWG dwg2dxf.
    Raises RuntimeError if the converter is missing or conversion fails.
    """
    dwg2dxf = find_dwg2dxf()
    if dwg2dxf is None:
        raise RuntimeError(
            "DWG converter not found. Install LibreDWG dwg2dxf, or place it at "
            "tools/libredwg/dwg2dxf.exe, or set DWG2DXF to the executable path."
        )

    with tempfile.TemporaryDirectory(prefix="up_dwg_") as tmp:
        tmp_path = Path(tmp)
        dwg_path = tmp_path / "input.dwg"
        dxf_path = tmp_path / "input.dxf"
        dwg_path.write_bytes(dwg_bytes)
        cmd = [
            str(dwg2dxf),
            "-y",
            f"--as={as_version}",
            "-o",
            str(dxf_path),
            str(dwg_path),
        ]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=180,
                cwd=str(tmp_path),
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("DWG→DXF conversion timed out.") from exc
        except OSError as exc:
            raise RuntimeError(f"Failed to run dwg2dxf: {exc}") from exc

        if not dxf_path.is_file() or dxf_path.stat().st_size < 64:
            # Some builds write beside the DWG with a fixed name
            alt = dwg_path.with_suffix(".dxf")
            if alt.is_file() and alt.stat().st_size >= 64:
                dxf_path = alt
            else:
                err = (proc.stderr or proc.stdout or "").strip()[:500]
                raise RuntimeError(
                    f"DWG→DXF conversion failed (exit {proc.returncode}). {err}"
                )
        return dxf_path.read_bytes()


def _entities_section(dxf_text: str) -> str:
    # LibreDWG pads group codes with spaces: "  0", "  2", etc.
    m = re.search(r"\n\s*0\nSECTION\n\s*2\nENTITIES\n", dxf_text)
    if not m:
        raise ValueError("DXF has no ENTITIES section.")
    start = m.end()
    end_m = re.search(r"\n\s*0\nENDSEC\n", dxf_text[start:])
    end = start + end_m.start() if end_m else len(dxf_text)
    return dxf_text[start:end]


def _iter_entity_blocks(section: str):
    for m in re.finditer(r"\n\s*0\n([A-Z][A-Z0-9_]*)\n(.*?)(?=\n\s*0\n|\Z)", section, flags=re.S):
        yield m.group(1), m.group(2)


def _group_dict(block: str) -> dict[str, str]:
    # Last value wins for duplicate codes (fine for layer/coords we need).
    return dict(re.findall(r"\n\s*(\d+)\n([^\n]*)", "\n" + block))


def _parse_wall_segments(dxf_text: str) -> list[dict]:
    section = _entities_section(dxf_text)
    segs: list[dict] = []

    for etype, block in _iter_entity_blocks(section):
        if etype == "LINE":
            d = _group_dict(block)
            layer = d.get("8", "0")
            if not _is_wall_layer(layer):
                continue
            try:
                x1, y1 = float(d["10"]), float(d["20"])
                x2, y2 = float(d["11"]), float(d["21"])
            except (KeyError, ValueError):
                continue
            length = math.hypot(x2 - x1, y2 - y1)
            if length < MIN_FACE_LEN_MM:
                continue
            segs.append(
                {
                    "layer": layer,
                    "x1": x1,
                    "y1": y1,
                    "x2": x2,
                    "y2": y2,
                    "len": length,
                    "mx": (x1 + x2) / 2,
                    "my": (y1 + y2) / 2,
                }
            )
        elif etype == "LWPOLYLINE":
            d = _group_dict(block)
            layer = d.get("8", "0")
            if not _is_wall_layer(layer):
                continue
            xs = [float(x) for x in re.findall(r"\n\s*10\n([^\n]*)", "\n" + block)]
            ys = [float(y) for y in re.findall(r"\n\s*20\n([^\n]*)", "\n" + block)]
            if len(xs) != len(ys) or len(xs) < 2:
                continue
            try:
                closed = int(float(d.get("70", "0"))) & 1
            except ValueError:
                closed = 0
            pts = list(zip(xs, ys))
            n = len(pts)
            edge_count = n if closed else n - 1
            for i in range(edge_count):
                x1, y1 = pts[i]
                x2, y2 = pts[(i + 1) % n]
                length = math.hypot(x2 - x1, y2 - y1)
                if length < MIN_FACE_LEN_MM:
                    continue
                segs.append(
                    {
                        "layer": layer,
                        "x1": x1,
                        "y1": y1,
                        "x2": x2,
                        "y2": y2,
                        "len": length,
                        "mx": (x1 + x2) / 2,
                        "my": (y1 + y2) / 2,
                    }
                )
    return segs


def _spatial_regions(segs: list[dict], cell: float = 5000.0) -> list[list[dict]]:
    if not segs:
        return []
    buckets: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, s in enumerate(segs):
        buckets[(int(s["mx"] // cell), int(s["my"] // cell))].append(i)
    cells = set(buckets)
    seen: set[tuple[int, int]] = set()
    regions: list[list[dict]] = []
    for c0 in cells:
        if c0 in seen:
            continue
        stack = [c0]
        seen.add(c0)
        members: list[int] = []
        while stack:
            c = stack.pop()
            members.extend(buckets[c])
            cx, cy = c
            for nb in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                if nb in cells and nb not in seen:
                    seen.add(nb)
                    stack.append(nb)
        regions.append([segs[i] for i in members])
    regions.sort(key=len, reverse=True)
    return regions


def _unit_dir(x1: float, y1: float, x2: float, y2: float) -> tuple[float, float, float]:
    length = math.hypot(x2 - x1, y2 - y1) or 1.0
    return (x2 - x1) / length, (y2 - y1) / length, length


def _pair_parallel_faces(
    faces: list[dict],
    min_perp: float,
    max_perp: float,
    min_len: float = MIN_WALL_LEN_MM,
    min_overlap: float = 0.35,
) -> tuple[list[dict], list[dict]]:
    """Pair parallel faces into centerlines. Returns (walls, unused faces)."""
    used: set[int] = set()
    walls: list[dict] = []
    for i, a in enumerate(faces):
        if i in used:
            continue
        aux, auy, alen = _unit_dir(a["x1"], a["y1"], a["x2"], a["y2"])
        candidates = []
        for j, b in enumerate(faces):
            if j <= i or j in used:
                continue
            bux, buy, blen = _unit_dir(b["x1"], b["y1"], b["x2"], b["y2"])
            if abs(aux * buy - auy * bux) > 0.12 or abs(aux * bux + auy * buy) < 0.96:
                continue
            perp = abs((b["mx"] - a["mx"]) * (-auy) + (b["my"] - a["my"]) * aux)
            if perp < min_perp or perp > max_perp:
                continue
            ar = sorted([a["x1"] * aux + a["y1"] * auy, a["x2"] * aux + a["y2"] * auy])
            br = sorted([b["x1"] * aux + b["y1"] * auy, b["x2"] * aux + b["y2"] * auy])
            overlap = max(0.0, min(ar[1], br[1]) - max(ar[0], br[0]))
            if overlap < min(alen, blen) * min_overlap:
                continue
            candidates.append((perp, -overlap, j, ar, br))
        if not candidates:
            continue
        candidates.sort()
        perp, _, j, ar, br = candidates[0]
        used.add(i)
        used.add(j)
        lo, hi = min(ar[0], br[0]), max(ar[1], br[1])
        if hi - lo < min_len:
            continue
        cx = (a["mx"] + faces[j]["mx"]) / 2
        cy = (a["my"] + faces[j]["my"]) / 2
        c_along = cx * aux + cy * auy
        x1 = cx + (lo - c_along) * aux
        y1 = cy + (lo - c_along) * auy
        x2 = cx + (hi - c_along) * aux
        y2 = cy + (hi - c_along) * auy
        walls.append(
            {
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
                "len": hi - lo,
                "thick": perp,
                "layer": a.get("layer") or faces[j].get("layer") or "",
            }
        )
    leftovers = [faces[i] for i in range(len(faces)) if i not in used]
    return walls, leftovers


def _axis_of(w: dict) -> str:
    return "H" if abs(w["x2"] - w["x1"]) >= abs(w["y2"] - w["y1"]) else "V"


def _merge_collinear_walls(
    walls: list[dict],
    *,
    gap: float = 300.0,
    perp_tol: float = 60.0,
) -> list[dict]:
    if not walls:
        return []
    items = [dict(w) for w in walls]
    used = [False] * len(items)
    out: list[dict] = []

    for i, a in enumerate(items):
        if used[i]:
            continue
        axis = _axis_of(a)
        group = [a]
        used[i] = True
        changed = True
        while changed:
            changed = False
            if axis == "H":
                gy = sum((g["y1"] + g["y2"]) / 2 for g in group) / len(group)
                glo = min(min(g["x1"], g["x2"]) for g in group)
                ghi = max(max(g["x1"], g["x2"]) for g in group)
            else:
                gx = sum((g["x1"] + g["x2"]) / 2 for g in group) / len(group)
                glo = min(min(g["y1"], g["y2"]) for g in group)
                ghi = max(max(g["y1"], g["y2"]) for g in group)
            for j, b in enumerate(items):
                if used[j] or _axis_of(b) != axis:
                    continue
                if axis == "H":
                    if abs(((b["y1"] + b["y2"]) / 2) - gy) > perp_tol:
                        continue
                    blo, bhi = min(b["x1"], b["x2"]), max(b["x1"], b["x2"])
                else:
                    if abs(((b["x1"] + b["x2"]) / 2) - gx) > perp_tol:
                        continue
                    blo, bhi = min(b["y1"], b["y2"]), max(b["y1"], b["y2"])
                if blo > ghi + gap or bhi < glo - gap:
                    continue
                group.append(b)
                used[j] = True
                changed = True

        thick = sum(float(g.get("thick") or 100) for g in group) / len(group)
        layer = group[0].get("layer") or ""
        if axis == "H":
            y = sum((g["y1"] + g["y2"]) / 2 for g in group) / len(group)
            lo = min(min(g["x1"], g["x2"]) for g in group)
            hi = max(max(g["x1"], g["x2"]) for g in group)
            out.append(
                {
                    "x1": lo,
                    "y1": y,
                    "x2": hi,
                    "y2": y,
                    "len": hi - lo,
                    "thick": thick,
                    "layer": layer,
                }
            )
        else:
            x = sum((g["x1"] + g["x2"]) / 2 for g in group) / len(group)
            lo = min(min(g["y1"], g["y2"]) for g in group)
            hi = max(max(g["y1"], g["y2"]) for g in group)
            out.append(
                {
                    "x1": x,
                    "y1": lo,
                    "x2": x,
                    "y2": hi,
                    "len": hi - lo,
                    "thick": thick,
                    "layer": layer,
                }
            )
    return [w for w in out if w["len"] >= MIN_WALL_LEN_MM]


def _snap_thickness(value: float) -> float:
    return float(min(STANDARD_THICKNESSES, key=lambda t: abs(t - value)))


def _bbox(items: list[dict]) -> tuple[float, float, float, float]:
    xs = [c for s in items for c in (s["x1"], s["x2"])]
    ys = [c for s in items for c in (s["y1"], s["y2"])]
    return min(xs), min(ys), max(xs), max(ys)


def _drop_outside_spikes(walls: list[dict]) -> list[dict]:
    """Drop long walls that mostly sit outside the rest of the plan (section marks / braces)."""
    if len(walls) < 3:
        return walls
    kept: list[dict] = []
    pad = 1500.0
    for i, w in enumerate(walls):
        others = [o for j, o in enumerate(walls) if j != i]
        if not others or w["len"] < SPIKE_MIN_LEN_MM:
            kept.append(w)
            continue
        x0, y0, x1, y1 = _bbox(others)
        x0 -= pad
        y0 -= pad
        x1 += pad
        y1 += pad
        samples = 24
        inside = 0
        for k in range(samples + 1):
            t = k / samples
            x = w["x1"] + (w["x2"] - w["x1"]) * t
            y = w["y1"] + (w["y2"] - w["y1"]) * t
            if x0 <= x <= x1 and y0 <= y <= y1:
                inside += 1
        if inside / (samples + 1) < SPIKE_MAX_INSIDE_FRAC:
            logger.info(
                "DWG import: drop outside spike %.0f mm on %s",
                w["len"],
                w.get("layer") or "?",
            )
            continue
        kept.append(w)
    return kept


def _walls_from_region(segs: list[dict]) -> list[dict]:
    structural = [
        s for s in segs if (s.get("layer") or "").strip() not in HATCH_TICK_LAYERS
    ]
    # If the drawing only has tick-layer geometry, fall back to it.
    use_segs = structural if structural else segs

    by_layer: dict[str, list[dict]] = defaultdict(list)
    for s in use_segs:
        by_layer[s["layer"]].append(s)

    walls: list[dict] = []
    for layer, faces in by_layer.items():
        layer_thick = _thickness_from_layer(layer) or 100.0
        if _is_single_line_layer(layer):
            for s in faces:
                if s["len"] < MIN_WALL_LEN_MM:
                    continue
                walls.append(
                    {
                        "x1": s["x1"],
                        "y1": s["y1"],
                        "x2": s["x2"],
                        "y2": s["y2"],
                        "len": s["len"],
                        "thick": layer_thick,
                        "layer": layer,
                    }
                )
            continue

        # Prefer long face runs (skip thickness-edge stubs ~ panel thickness).
        long_faces = [f for f in faces if f["len"] >= 200]
        use_faces = long_faces if len(long_faces) >= 4 else faces
        mn, mx = _pair_range_for_layer(layer)
        paired, leftover = _pair_parallel_faces(use_faces, mn, mx)
        if not paired and use_faces is not faces:
            paired, leftover = _pair_parallel_faces(faces, mn, mx)
        if not paired:
            paired, leftover = _pair_parallel_faces(use_faces, *DEFAULT_PAIR_RANGE)

        # Double-drawn strokes (15–45 mm) collapse to one centerline.
        stroked, leftover = _pair_parallel_faces(
            leftover, *DOUBLE_STROKE_RANGE, min_len=400
        )
        for w in stroked:
            w["thick"] = layer_thick

        walls.extend(paired)
        walls.extend(stroked)
        for a in leftover:
            if a["len"] < MIN_KEEP_UNPAIRED_MM:
                continue
            walls.append(
                {
                    "x1": a["x1"],
                    "y1": a["y1"],
                    "x2": a["x2"],
                    "y2": a["y2"],
                    "len": a["len"],
                    "thick": layer_thick,
                    "layer": layer,
                }
            )

    merged = _merge_collinear_walls(walls)
    return _drop_outside_spikes(merged)


def _normalize_walls(walls: list[dict]) -> tuple[list[dict], dict[str, float]]:
    if not walls:
        return [], {"min_x": 0, "min_y": 0, "max_x": 0, "max_y": 0}

    xs = [c for w in walls for c in (w["x1"], w["x2"])]
    ys = [c for w in walls for c in (w["y1"], w["y2"])]
    min_x, min_y = min(xs), min(ys)
    ox, oy = min_x - ORIGIN_MARGIN_MM, min_y - ORIGIN_MARGIN_MM

    out = []
    for w in walls:
        x1, y1 = w["x1"] - ox, w["y1"] - oy
        x2, y2 = w["x2"] - ox, w["y2"] - oy
        # Snap near-axis
        if abs(x2 - x1) >= abs(y2 - y1):
            y = (y1 + y2) / 2
            y1 = y2 = y
        else:
            x = (x1 + x2) / 2
            x1 = x2 = x
        length = math.hypot(x2 - x1, y2 - y1)
        out.append(
            {
                "start_x": round(x1),
                "start_y": round(y1),
                "end_x": round(x2),
                "end_y": round(y2),
                "length_mm": round(length),
                "source_length_mm": round(w["len"]),
                "thickness_mm": _snap_thickness(float(w.get("thick") or 100)),
                "layer": w.get("layer") or "",
            }
        )

    max_x = max(max(w["start_x"], w["end_x"]) for w in out)
    max_y = max(max(w["start_y"], w["end_y"]) for w in out)
    return out, {
        "min_x": ORIGIN_MARGIN_MM,
        "min_y": ORIGIN_MARGIN_MM,
        "max_x": float(max_x),
        "max_y": float(max_y),
        "origin_shift_x": ox,
        "origin_shift_y": oy,
    }


def _mode_thickness(walls: list[dict], default: float = 100.0) -> float:
    if not walls:
        return default
    counts = Counter(int(w.get("thickness_mm") or default) for w in walls)
    return float(counts.most_common(1)[0][0])


def extract_plan_from_dxf_bytes(
    dxf_bytes: bytes,
    *,
    region_index: int = 0,
) -> dict[str, Any]:
    """Extract editable wall plan preview from DXF bytes."""
    try:
        text = dxf_bytes.decode("utf-8")
    except UnicodeDecodeError:
        text = dxf_bytes.decode("latin-1", errors="replace")
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    segs = _parse_wall_segments(text)
    if not segs:
        raise ValueError(
            "No wall-layer LINE/LWPOLYLINE geometry found. "
            "Expected layers such as WALL, W, COOLROOM PARTITION, or *PIR* PANEL."
        )

    regions = _spatial_regions(segs)
    if not regions:
        raise ValueError("Could not cluster wall geometry into a plan region.")

    region_summaries = []
    for ri, reg in enumerate(regions):
        xs = [c for s in reg for c in (s["x1"], s["x2"])]
        ys = [c for s in reg for c in (s["y1"], s["y2"])]
        span_x = max(xs) - min(xs)
        span_y = max(ys) - min(ys)
        region_summaries.append(
            {
                "index": ri,
                "segment_count": len(reg),
                "span_x": round(span_x),
                "span_y": round(span_y),
                "layers": dict(Counter(s["layer"] for s in reg)),
            }
        )

    # Rank by footprint area (main building), not raw segment density
    # (coolroom module racks can have more segments but a narrow span).
    ranked = sorted(
        range(len(regions)),
        key=lambda i: (
            region_summaries[i]["span_x"] * region_summaries[i]["span_y"],
            region_summaries[i]["segment_count"],
        ),
        reverse=True,
    )
    # Re-order summaries/regions so index 0 is the best default footprint.
    regions = [regions[i] for i in ranked]
    region_summaries = [
        {**region_summaries[i], "index": new_i}
        for new_i, i in enumerate(ranked)
    ]

    idx = max(0, min(int(region_index), len(regions) - 1))
    raw_walls = _walls_from_region(regions[idx])
    if not raw_walls:
        raise ValueError(
            f"Region {idx} has wall faces but no centerlines could be paired. "
            "Try another region_index from the regions list."
        )

    walls, bounds = _normalize_walls(raw_walls)
    thickness = _mode_thickness(walls)
    height_mm = 2500.0

    from .pdf_plan_import import _infer_intersections, _infer_rooms

    intersections = _infer_intersections(walls)
    rooms = _infer_rooms(walls, "", [], height_mm)

    max_x = bounds["max_x"]
    max_y = bounds["max_y"]
    notes = [
        "Geometry from DWG/DXF wall layers (vector faces to centerlines).",
        f"Using plan region {idx} of {len(regions)} "
        f"({region_summaries[idx]['span_x']}×{region_summaries[idx]['span_y']} mm source span).",
    ]
    if len(regions) > 1:
        notes.append(
            "Multiple plan clusters detected — pass region_index to import a different building."
        )
    if not rooms:
        notes.append("No rooms inferred from wall loops; define rooms manually if needed.")

    return {
        "dialect": "ups_dwg",
        "cluster": f"region_{idx}",
        "page_index": 0,
        "page_count": 1,
        "scale_mm_per_pt": 1.0,
        "overall_width_mm": round(max_x),
        "height_mm": height_mm,
        "thickness_mm": thickness,
        "walls": walls,
        "doors": [],
        "rooms": rooms,
        "intersections": intersections,
        "panel_hints": [],
        "dimensions": {"wall": [], "panel": []},
        "regions": region_summaries,
        "region_index": idx,
        "layer_counts": dict(Counter(s["layer"] for s in regions[idx])),
        "notes": notes,
        "project_meta": {
            "width": float(max_x or 1000),
            "length": float(max_y or 1000),
            "height": height_mm,
            "wall_thickness": thickness,
            "job_no": None,
        },
    }


def extract_plan_from_cad_bytes(
    data: bytes,
    *,
    filename: str = "",
    region_index: int = 0,
) -> dict[str, Any]:
    """
    Entry point for .dwg / .dxf uploads.
    DWG is converted to DXF first; DXF is parsed directly.
    """
    name = (filename or "").lower()
    if name.endswith(".dwg"):
        dxf_bytes = convert_dwg_to_dxf(data)
    elif name.endswith(".dxf"):
        dxf_bytes = data
    else:
        # Sniff: DXF is text starting with group code 0 / SECTION
        head = data[:64].lstrip().lower()
        if head.startswith(b"0") or b"section" in head or b"autofcad" in head:
            dxf_bytes = data
        else:
            dxf_bytes = convert_dwg_to_dxf(data)

    return extract_plan_from_dxf_bytes(dxf_bytes, region_index=region_index)


def extract_plan_from_upload_bytes(
    data: bytes,
    *,
    filename: str = "",
    page_index: int = 0,
    region_index: int = 0,
) -> dict[str, Any]:
    """Dispatch PDF vs DWG/DXF to the appropriate extractor."""
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        from .pdf_plan_import import extract_plan_from_pdf_bytes

        return extract_plan_from_pdf_bytes(data, page_index=page_index)
    if name.endswith((".dwg", ".dxf")):
        return extract_plan_from_cad_bytes(
            data, filename=name, region_index=region_index
        )
    raise ValueError("Unsupported file type. Use PDF, DWG, or DXF.")
