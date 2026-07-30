import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core.pdf_wall_import import extract_walls_from_pdf_bytes
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import math

pdf = open(
    r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh\UPS 20970 E- RETAIL SOLUTIONS SDN BHD (AEON MIDTOWN).pdf",
    "rb",
).read()
r = extract_walls_from_pdf_bytes(pdf)
print("H", r["height_mm"], "th", r["thickness_mm"], "n", len(r["walls"]), "cluster", r["cluster"])
print("overall", r.get("overall_width_mm"), "scale", r["scale_mm_per_pt"])

walls = r["walls"]
for w in sorted(walls, key=lambda z: -z["length_mm"]):
    print(
        w["length_mm"],
        (w["start_x"], w["start_y"], w["end_x"], w["end_y"]),
        "src",
        w.get("source_length_mm"),
    )

# orphan check
pts = []
for i, w in enumerate(walls):
    pts.append((i, w["start_x"], w["start_y"]))
    pts.append((i, w["end_x"], w["end_y"]))
orphans = 0
for i, (wi, x, y) in enumerate(pts):
    best = 1e9
    for j, (wj, x2, y2) in enumerate(pts):
        if i == j or wi == wj:
            continue
        best = min(best, math.hypot(x - x2, y - y2))
    if best > 30:
        orphans += 1
        print(f"ORPHAN wall{wi} ({x},{y}) d={best:.0f}")
print(f"orphans {orphans}/{len(pts)}")

# key comparisons
PDF = {
    "top_left": 2100,
    "niche_w": 1000,
    "niche_d": 1050,
    "mid": 7446,
    "slant": 13983,
    "br": 5922,
    "overall": 19900,
}
horiz = [w for w in walls if abs(w["end_y"] - w["start_y"]) < abs(w["end_x"] - w["start_x"])]
vert = [w for w in walls if abs(w["end_x"] - w["start_x"]) < abs(w["end_y"] - w["start_y"])]
top_h = sorted([w for w in horiz if min(w["start_y"], w["end_y"]) < 200], key=lambda w: min(w["start_x"], w["end_x"]))
print("\nTOP H:")
for w in top_h:
    print(" ", w["length_mm"], min(w["start_x"], w["end_x"]), "-", max(w["start_x"], w["end_x"]), "y", w["start_y"])

fig, ax = plt.subplots(figsize=(14, 4))
for w in walls:
    ax.plot([w["start_x"], w["end_x"]], [w["start_y"], w["end_y"]], "-o", ms=2)
    mx = (w["start_x"] + w["end_x"]) / 2
    my = (w["start_y"] + w["end_y"]) / 2
    ax.text(mx, my, str(w["length_mm"]), fontsize=6)
ax.set_aspect("equal")
ax.invert_yaxis()
ax.set_title(f"E fixed2 n={len(walls)} H={r['height_mm']} orphans={orphans}")
ax.grid(True, alpha=0.3)
out = r"C:\Users\brian\OneDrive\Desktop\United Panel\UPFYP\Code Clean Trying\Code Clean Try 1\Model-V6\scripts\_pdf_20970_E\imported_walls_fixed2.png"
fig.savefig(out, dpi=140, bbox_inches="tight")
print("saved", out)
