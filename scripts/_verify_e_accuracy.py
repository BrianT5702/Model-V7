"""Compare project E / extractor output against PDF wall-plan dimensions."""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import django
import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "model_builder.settings")
django.setup()

from core.models import Project, Wall

# PDF wall-plan ground truth (from sheet UPS 20970 E)
PDF = {
    "overall_top": 19900,
    "height": 2900,
    "thickness": 100,
    "top_chain": [2100, 1000, 7446, 1000, 2432, 5022],  # niches as 1000 gaps
    "bottom_slant": 13983,
    "bottom_right": 5922,
    "left_depth_label": 4271,
    "right_depth_label": 4628,
    "niche_width": 1000,
    "niche_depth_label": 1050,  # labeled near recesses
}

p = Project.objects.filter(name__icontains="20970/E").first()
print("PROJECT", p.id if p else None, p.name if p else None)
print(
    f"  attrs W={p.width} L={p.length} H={p.height} th={p.wall_thickness}"
)

walls = list(Wall.objects.filter(project=p))
segs = []
for w in walls:
    dx, dy = w.end_x - w.start_x, w.end_y - w.start_y
    L = math.hypot(dx, dy)
    segs.append(
        {
            "id": w.id,
            "x1": w.start_x,
            "y1": w.start_y,
            "x2": w.end_x,
            "y2": w.end_y,
            "L": L,
            "horiz": abs(dy) < abs(dx),
            "vert": abs(dx) < abs(dy),
        }
    )

# Classify
horiz = [s for s in segs if s["horiz"]]
vert = [s for s in segs if s["vert"]]
slant = [s for s in segs if not s["horiz"] and not s["vert"]]
print(f"\nwalls: {len(segs)} (H={len(horiz)} V={len(vert)} slant={len(slant)})")

# Top band y~0-120
top_h = sorted([s for s in horiz if min(s["y1"], s["y2"]) < 120], key=lambda s: min(s["x1"], s["x2"]))
bot_h = sorted([s for s in horiz if max(s["y1"], s["y2"]) > 3500], key=lambda s: min(s["x1"], s["x2"]))
print("\nTOP horizontals (y<120):")
top_sum = 0
for s in top_h:
    print(f"  L={s['L']:.0f} x={min(s['x1'],s['x2']):.0f}-{max(s['x1'],s['x2']):.0f} y={s['y1']:.0f}")
    top_sum += s["L"]
print(f"  sum={top_sum:.0f}  PDF top chain sum={sum(PDF['top_chain'])}")

print("\nBOTTOM horizontals (y>3500) + slants:")
for s in bot_h:
    print(f"  L={s['L']:.0f} x={min(s['x1'],s['x2']):.0f}-{max(s['x1'],s['x2']):.0f} y={s['y1']:.0f}")
for s in slant:
    print(f"  SLANT L={s['L']:.0f} ({s['x1']:.0f},{s['y1']:.0f})->({s['x2']:.0f},{s['y2']:.0f})")

print("\nVERTICALS:")
for s in sorted(vert, key=lambda z: min(z["x1"], z["x2"])):
    print(
        f"  L={s['L']:.0f} x={s['x1']:.0f} y={min(s['y1'],s['y2']):.0f}-{max(s['y1'],s['y2']):.0f}"
    )

# Endpoint connectivity: for each endpoint, nearest other endpoint
pts = []
for s in segs:
    pts.append((s["x1"], s["y1"], s["id"]))
    pts.append((s["x2"], s["y2"], s["id"]))

print("\nENDPOINT GAPS (>30mm from any other wall end):")
orphans = 0
for i, (x, y, wid) in enumerate(pts):
    best = 1e9
    for j, (x2, y2, wid2) in enumerate(pts):
        if i == j or wid == wid2:
            continue
        best = min(best, math.hypot(x - x2, y - y2))
    if best > 30:
        orphans += 1
        print(f"  wall {wid} ({x:.0f},{y:.0f}) nearest_other_end={best:.0f}mm")
print(f"  orphan endpoints: {orphans}/{len(pts)}")

# Comparison table
print("\n=== ACCURACY CHECK ===")
checks = []

def add(name, expected, actual, tol_ratio=0.02, tol_abs=50):
    if expected is None:
        return
    err = abs(actual - expected)
    ok = err <= max(tol_abs, abs(expected) * tol_ratio)
    checks.append((ok, name, expected, actual, err))
    mark = "OK" if ok else "FAIL"
    print(f"  [{mark}] {name}: PDF={expected}  got={actual:.0f}  err={err:.0f}")

add("height", PDF["height"], p.height, tol_abs=1)
add("thickness", PDF["thickness"], p.wall_thickness, tol_abs=1)
add("overall W (bbox)", PDF["overall_top"], p.width, tol_ratio=0.01)
add("bottom slant", PDF["bottom_slant"], slant[0]["L"] if slant else 0, tol_abs=80)
add("bottom right 5922", PDF["bottom_right"], next((s["L"] for s in bot_h if s["L"] > 5000), 0))
add("top 7446", 7446, next((s["L"] for s in top_h if 7000 < s["L"] < 8000), 0))
add("top left ~2100", 2100, next((s["L"] for s in top_h if 1500 < s["L"] < 2500), 0), tol_abs=100)
add("top ~2432", 2432, next((s["L"] for s in top_h if 2200 < s["L"] < 2600), 0), tol_abs=100)
add("top ~5022", 5022, next((s["L"] for s in top_h if 4500 < s["L"] < 5500), 0), tol_abs=100)
add("niche width ~1000", 1000, next((s["L"] for s in horiz if 900 < s["L"] < 1200 and min(s["y1"], s["y2"]) > 500), 0), tol_abs=80)

# niche depth = short verts near top
niche_verts = [s for s in vert if s["L"] < 1200 and min(s["y1"], s["y2"]) < 200]
if niche_verts:
    add("niche depth ~1050", 1050, niche_verts[0]["L"], tol_abs=100)

# right exterior wall present?
max_x = max(max(s["x1"], s["x2"]) for s in segs)
right_verts = [s for s in vert if min(s["x1"], s["x2"]) > max_x - 200]
print(f"  [{'OK' if right_verts else 'FAIL'}] right exterior vertical: found={len(right_verts)} (PDF has stepped right end wall)")

# top chain coverage vs 19900
print(f"  [{'OK' if abs(top_sum - 19900) < 400 else 'FAIL'}] top horizontal coverage sum={top_sum:.0f} vs 19900")

ok_n = sum(1 for c in checks if c[0])
print(f"\nSUMMARY: {ok_n}/{len(checks)} numeric checks passed; topology orphans={orphans}")
