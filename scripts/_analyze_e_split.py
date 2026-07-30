"""Split right-cluster into upper (wall plan) vs lower (ceiling) and compare imports."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import fitz
from core import pdf_wall_import as pwi

pdf = open(
    r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh\UPS 20970 E- RETAIL SOLUTIONS SDN BHD (AEON MIDTOWN).pdf",
    "rb",
).read()
doc = fitz.open(stream=pdf, filetype="pdf")
page = doc[0]
segs = pwi._extract_green_segments(page)
right = [s for s in segs if 350 <= s["mx"] <= 540 and 40 <= s["my"] <= 520]
print("right all", len(right))

# Find gap / midpoint between wall and ceiling copies
ys = sorted(s["my"] for s in right)
print("y midpoints sample", [round(y) for y in ys[:: max(1, len(ys)//20)]])

for ycut in (250, 280, 300, 320, 350):
    upper = [s for s in right if s["my"] < ycut]
    lower = [s for s in right if s["my"] >= ycut]
    print(f"cut {ycut}: upper={len(upper)} lower={len(lower)}")

labels = pwi._ocr_dimension_labels(page)
classified = pwi._classify_dimensions(labels)
wall_dims = classified["wall"]

for name, subset in [
    ("right_all", right),
    ("right_upper_280", [s for s in right if s["my"] < 280]),
    ("right_upper_300", [s for s in right if s["my"] < 300]),
    ("right_lower_300", [s for s in right if s["my"] >= 300]),
]:
    walls_pt = pwi._pair_wall_centerlines(subset)
    score = pwi._cluster_match_score(walls_pt, wall_dims)
    if not walls_pt:
        print(name, "no walls")
        continue
    scale, overall = pwi._estimate_scale_mm_per_pt(walls_pt, wall_dims)
    walls = pwi._normalize_origin(
        pwi._dedupe_walls(pwi._transform_walls_to_mm(walls_pt, scale, wall_dims))
    )
    xs = [c for w in walls for c in (w["start_x"], w["end_x"])]
    ys2 = [c for w in walls for c in (w["start_y"], w["end_y"])]
    print(
        f"{name}: segs={len(subset)} paired={len(walls_pt)} out={len(walls)} "
        f"score={score:.1f} scale={scale:.3f} overall={overall} "
        f"bbox=({min(xs)},{min(ys2)})-({max(xs)},{max(ys2)})"
    )
    for w in sorted(walls, key=lambda z: -z["length_mm"])[:8]:
        print("   ", w["length_mm"], (w["start_x"], w["start_y"], w["end_x"], w["end_y"]))
