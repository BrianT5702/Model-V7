"""Detailed mismatch report: imported walls vs PDF E ground truth."""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core.pdf_wall_import import extract_walls_from_pdf_bytes

pdf = open(
    r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh\UPS 20970 E- RETAIL SOLUTIONS SDN BHD (AEON MIDTOWN).pdf",
    "rb",
).read()
r = extract_walls_from_pdf_bytes(pdf)
walls = r["walls"]

PDF = {
    "overall": 19900,
    "height": 2900,
    "top": [2100, 1000, 7446, 1000, 2432, 5022],  # incl niche widths
    "slant": 13983,
    "bottom_right": 5922,
    "niche_w": 1000,
    "niche_d": 1050,
    "left_depth": 4271,
}

def L(w):
    return math.hypot(w["end_x"] - w["start_x"], w["end_y"] - w["start_y"])

horiz = [w for w in walls if abs(w["end_y"] - w["start_y"]) <= abs(w["end_x"] - w["start_x"])]
vert = [w for w in walls if abs(w["end_x"] - w["start_x"]) < abs(w["end_y"] - w["start_y"])]
slant = [w for w in walls if abs(w["end_x"] - w["start_x"]) > 100 and abs(w["end_y"] - w["start_y"]) > 80]

print(f"n={len(walls)} H={r['height_mm']} scale={r['scale_mm_per_pt']}")
print(f"bbox W={max(max(w['start_x'],w['end_x']) for w in walls)-min(min(w['start_x'],w['end_x']) for w in walls)} "
      f"L={max(max(w['start_y'],w['end_y']) for w in walls)-min(min(w['start_y'],w['end_y']) for w in walls)}")

# Top band y levels
top_h = sorted([w for w in horiz if min(w["start_y"], w["end_y"]) < 250], key=lambda w: min(w["start_x"], w["end_x"]))
print("\nTOP horizontals:")
for w in top_h:
    print(f"  L={L(w):.0f} x={min(w['start_x'],w['end_x']):.0f}-{max(w['start_x'],w['end_x']):.0f} y={w['start_y']:.0f}/{w['end_y']:.0f}")

niche_h = [w for w in horiz if 800 < min(w["start_y"], w["end_y"]) < 1200 and 800 < L(w) < 1300]
niche_v = [w for w in vert if L(w) < 1200 and min(w["start_y"], w["end_y"]) < 300]
print("\nNICHE backs (H):", [(round(L(w)), w["start_y"]) for w in niche_h])
print("NICHE sides (V):", [(round(L(w)), min(w["start_y"], w["end_y"]), max(w["start_y"], w["end_y"])) for w in niche_v])

# Corner gaps
pts = []
for i, w in enumerate(walls):
    pts.append((i, w["start_x"], w["start_y"]))
    pts.append((i, w["end_x"], w["end_y"]))

def nearest_end(i, x, y):
    best = 1e9
    for j, (wj, x2, y2) in enumerate(pts):
        if pts[i][0] == wj and j != i:
            continue
        if j == i:
            continue
        # skip same wall
        wi = pts[i][0]
        if wj == wi:
            continue
        best = min(best, math.hypot(x - x2, y - y2))
    return best

def nearest_body(x, y, exclude_i):
    best = 1e9
    for j, w in enumerate(walls):
        if j == exclude_i:
            continue
        dx, dy = w["end_x"] - w["start_x"], w["end_y"] - w["start_y"]
        len_sq = dx * dx + dy * dy or 1
        t = max(0, min(1, ((x - w["start_x"]) * dx + (y - w["start_y"]) * dy) / len_sq))
        qx, qy = w["start_x"] + t * dx, w["start_y"] + t * dy
        best = min(best, math.hypot(x - qx, y - qy))
    return best

print("\nEndpoint connectivity (end gap / body gap):")
bad = 0
for idx, (wi, x, y) in enumerate(pts):
    de = nearest_end(idx, x, y)
    db = nearest_body(x, y, wi)
    if min(de, db) > 25:
        bad += 1
        print(f"  wall{wi} ({x:.0f},{y:.0f}) end={de:.0f} body={db:.0f}")
print(f"loose ends: {bad}/{len(pts)}")

# Compare key dims
def closest(target, vals, tol=200):
    if not vals:
        return None, None
    v = min(vals, key=lambda z: abs(z - target))
    return v, abs(v - target)

lengths = [L(w) for w in walls]
print("\nDIM CHECK:")
for name, target in [
    ("2100", 2100), ("7446", 7446), ("2432", 2432), ("5022", 5022),
    ("13983", 13983), ("5922", 5922), ("1000 niche", 1000), ("1050 niche", 1050),
]:
    v, err = closest(target, lengths)
    mark = "OK" if err is not None and err <= 40 else "FAIL"
    print(f"  [{mark}] {name}: got={v:.0f} err={err:.0f}" if v else f"  [FAIL] {name}: missing")

# Top chain continuity / colinearity
print("\nTOP Y spread:", sorted({round(w["start_y"]) for w in top_h if L(w) > 1500}))
