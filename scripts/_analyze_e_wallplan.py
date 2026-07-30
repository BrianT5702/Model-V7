"""Inspect raw paired centerlines for wall-plan region only."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import fitz
from core import pdf_wall_import as pwi

pdf = open(
    r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh\UPS 20970 E- RETAIL SOLUTIONS SDN BHD (AEON MIDTOWN).pdf",
    "rb",
).read()
page = fitz.open(stream=pdf, filetype="pdf")[0]
segs = pwi._extract_green_segments(page)

# Find horizontal separator between wall & ceiling (strong H lines near y=428)
right = [s for s in segs if 350 <= s["mx"] <= 540]
h_seps = [
    s
    for s in right
    if abs(s["y1"] - s["y2"]) < 1.5 and abs(s["x2"] - s["x1"]) > 80
]
print("H separators:")
for s in sorted(h_seps, key=lambda z: z["my"]):
    print(f"  y={s['my']:.1f} x={s['x1']:.0f}-{s['x2']:.0f} len={s['len']:.1f}")

# Wall plan: above the main separator at ~428
ycut = 420
wall_plan = [s for s in right if s["my"] < ycut and s["my"] > 40]
print("wall_plan segs", len(wall_plan))
walls_pt = pwi._pair_wall_centerlines(wall_plan)
print("paired", len(walls_pt))
for w in sorted(walls_pt, key=lambda z: -z["len_pt"]):
    print(
        f"  len_pt={w['len_pt']:.1f} thick={w['thick_pt']:.2f} "
        f"({w['x1']:.1f},{w['y1']:.1f})->({w['x2']:.1f},{w['y2']:.1f})"
    )

# Also try left cluster wall plan (might be ceiling panel layout - skip)
# Measure outer bbox of wall_plan faces
xs = [c for s in wall_plan for c in (s["x1"], s["x2"])]
ys = [c for s in wall_plan for c in (s["y1"], s["y2"])]
print("bbox", min(xs), min(ys), max(xs), max(ys))
print("span", max(xs) - min(xs), max(ys) - min(ys))

# Expected: length 19900 along Y, depth ~4628 along X
span_y = max(ys) - min(ys)
span_x = max(xs) - min(xs)
print("scale_from_19900_y", 19900 / span_y)
print("depth_at_that_scale", span_x * 19900 / span_y)
print("scale_from_4271_x", 4271 / span_x)
print("width_at_that_scale", span_y * 4271 / span_x)
