import fitz
from collections import Counter
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

pdf = r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh\UPS 20970 E- RETAIL SOLUTIONS SDN BHD (AEON MIDTOWN).pdf"
page = fitz.open(pdf)[0]

# Color stats for longer strokes
cols = Counter()
by_color = {}
for d in page.get_drawings():
    c = d.get("color")
    if not c:
        continue
    key = tuple(round(x, 3) for x in c)
    for item in d.get("items", []):
        if item[0] != "l":
            continue
        p1, p2 = item[1], item[2]
        length = ((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2) ** 0.5
        if length < 5:
            continue
        cols[key] += 1
        by_color.setdefault(key, []).append(
            {
                "x1": p1.x,
                "y1": p1.y,
                "x2": p2.x,
                "y2": p2.y,
                "mx": (p1.x + p2.x) / 2,
                "my": (p1.y + p2.y) / 2,
                "len": length,
            }
        )

print("stroke colors (len>=5):")
for k, n in cols.most_common(12):
    segs = by_color[k]
    xs = [c for s in segs for c in (s["x1"], s["x2"])]
    ys = [c for s in segs for c in (s["y1"], s["y2"])]
    print(
        f"  {k}: n={n} bbox=({min(xs):.0f},{min(ys):.0f})-({max(xs):.0f},{max(ys):.0f}) "
        f"span=({max(xs)-min(xs):.0f}x{max(ys)-min(ys):.0f})"
    )

# Plot orange and green overlays
orange = (1.0, 0.247, 0.0)
green = (0.0, 1.0, 0.247)
fig, ax = plt.subplots(figsize=(14, 10))
for s in by_color.get(orange, []):
    ax.plot([s["x1"], s["x2"]], [s["y1"], s["y2"]], color="darkorange", lw=0.4, alpha=0.8)
for s in by_color.get(green, []):
    ax.plot([s["x1"], s["x2"]], [s["y1"], s["y2"]], color="lime", lw=0.9)
for s in by_color.get((0.0, 0.867, 0.0), []):
    ax.plot([s["x1"], s["x2"]], [s["y1"], s["y2"]], color="green", lw=0.9)
ax.set_xlim(0, 842)
ax.set_ylim(595, 0)
ax.set_aspect("equal")
ax.set_title("Orange vs green strokes")
out = r"C:\Users\brian\OneDrive\Desktop\United Panel\UPFYP\Code Clean Trying\Code Clean Try 1\Model-V6\scripts\_pdf_20970_E\orange_vs_green.png"
fig.savefig(out, dpi=150, bbox_inches="tight")
print("saved", out)

# Zoom wall-plan region where orange might form the readable plan
# From page render: wall plan upper-leftish
fig2, ax2 = plt.subplots(figsize=(14, 6))
for s in by_color.get(orange, []):
    if s["my"] < 320 and s["mx"] < 520:
        ax2.plot([s["x1"], s["x2"]], [s["y1"], s["y2"]], color="darkorange", lw=0.5)
ax2.set_xlim(50, 550)
ax2.set_ylim(320, 30)
ax2.set_aspect("equal")
ax2.set_title("Orange strokes upper plan region")
fig2.savefig(
    r"C:\Users\brian\OneDrive\Desktop\United Panel\UPFYP\Code Clean Trying\Code Clean Try 1\Model-V6\scripts\_pdf_20970_E\orange_upper.png",
    dpi=150,
    bbox_inches="tight",
)
