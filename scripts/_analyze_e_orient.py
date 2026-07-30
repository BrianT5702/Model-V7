import fitz
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

pdf = r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh\UPS 20970 E- RETAIL SOLUTIONS SDN BHD (AEON MIDTOWN).pdf"
page = fitz.open(pdf)[0]


def is_green(c):
    if not c or len(c) < 3:
        return False
    r, g, b = c
    return g >= 0.7 and r <= 0.35 and b <= 0.45


# Collect ALL green strokes with length, orientation
segs = []
for d in page.get_drawings():
    col = d.get("color")
    if not is_green(col):
        continue
    for item in d.get("items", []):
        if item[0] != "l":
            continue
        p1, p2 = item[1], item[2]
        length = ((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2) ** 0.5
        segs.append(
            {
                "x1": p1.x,
                "y1": p1.y,
                "x2": p2.x,
                "y2": p2.y,
                "mx": (p1.x + p2.x) / 2,
                "my": (p1.y + p2.y) / 2,
                "len": length,
                "dx": abs(p2.x - p1.x),
                "dy": abs(p2.y - p1.y),
                "color": tuple(round(x, 3) for x in col),
            }
        )

print("total green lines", len(segs), "incl short")
long = [s for s in segs if s["len"] >= 8]
print("len>=8", len(long))

# Longest segments
for s in sorted(long, key=lambda z: -z["len"])[:25]:
    orient = "H" if s["dx"] > s["dy"] else "V"
    print(
        f"  {orient} len={s['len']:.1f} mid=({s['mx']:.0f},{s['my']:.0f}) "
        f"({s['x1']:.0f},{s['y1']:.0f})-({s['x2']:.0f},{s['y2']:.0f}) c={s['color']}"
    )

# Separate by color
from collections import Counter

print("colors", Counter(s["color"] for s in long))

# Is there a wide horizontal plan? Look for H segments with large dx
h_long = [s for s in long if s["dx"] > s["dy"] and s["len"] > 40]
print("long H segs", len(h_long))
for s in sorted(h_long, key=lambda z: -z["len"])[:15]:
    print(f"  H len={s['len']:.1f} y={s['my']:.0f} x={s['x1']:.0f}-{s['x2']:.0f}")

# Right cluster only - dump paired wall result orientation
right = [s for s in long if 350 <= s["mx"] <= 540 and 40 <= s["my"] <= 520]
print("right n", len(right))
xs = [c for s in right for c in (s["x1"], s["x2"])]
ys = [c for s in right for c in (s["y1"], s["y2"])]
print("right bbox", min(xs), min(ys), max(xs), max(ys))
print("right span X", max(xs) - min(xs), "Y", max(ys) - min(ys))

# Compare: for architectural reading, after 90° CCW: PDF (x,y) -> (-y, x) or similar
# Current import: model=(y, x) roughly
# User expects: slant at BOTTOM, niches at TOP (like wall_plan crop)

# Flip model Y so niches (large PDF x = large model y) become TOP (small y)
# That means model_y' = max_y - model_y
