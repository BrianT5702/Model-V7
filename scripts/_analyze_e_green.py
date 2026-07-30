import fitz
from collections import Counter

pdf = r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh\UPS 20970 E- RETAIL SOLUTIONS SDN BHD (AEON MIDTOWN).pdf"
page = fitz.open(pdf)[0]


def is_green(c):
    if not c or len(c) < 3:
        return False
    r, g, b = c
    return g >= 0.7 and r <= 0.35 and b <= 0.45


segs = []
for d in page.get_drawings():
    if not is_green(d.get("color")):
        continue
    for item in d.get("items", []):
        if item[0] != "l":
            continue
        p1, p2 = item[1], item[2]
        length = ((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2) ** 0.5
        if length < 8:
            continue
        segs.append(
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

print("n segs", len(segs))
# histogram by y bands
for y0, y1 in [(40, 200), (200, 320), (320, 450), (450, 590), (590, 800)]:
    band = [s for s in segs if y0 <= s["my"] < y1]
    if not band:
        continue
    xs = [s["mx"] for s in band]
    print(f"y[{y0},{y1}) n={len(band)} mx={min(xs):.0f}-{max(xs):.0f}")

# Render only green lines to image for inspection
out = r"C:\Users\brian\OneDrive\Desktop\United Panel\UPFYP\Code Clean Trying\Code Clean Try 1\Model-V6\scripts\_pdf_20970_E\green_only.png"
# draw via pixmap of page then we just save coords
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(12, 8))
for s in segs:
    ax.plot([s["x1"], s["x2"]], [s["y1"], s["y2"]], color="lime", lw=0.8)
ax.set_xlim(0, 842)
ax.set_ylim(595, 0)
ax.set_aspect("equal")
ax.set_title("All green wall strokes (PDF coords)")
# mark cluster boxes
ax.add_patch(plt.Rectangle((140, 40), 190, 480, fill=False, ec="blue", ls="--", label="left"))
ax.add_patch(plt.Rectangle((350, 40), 190, 480, fill=False, ec="red", ls="--", label="right"))
ax.legend()
fig.savefig(out, dpi=150, bbox_inches="tight")
print("saved", out)

# Also: what does wall-plan-only look like? Top plan typically y~50-280, x~160-520?
top = [s for s in segs if 40 <= s["my"] <= 280]
fig2, ax2 = plt.subplots(figsize=(12, 4))
for s in top:
    ax2.plot([s["x1"], s["x2"]], [s["y1"], s["y2"]], color="lime", lw=0.8)
ax2.set_xlim(140, 540)
ax2.set_ylim(280, 40)
ax2.set_aspect("equal")
ax2.set_title(f"Green strokes y=40-280 n={len(top)}")
fig2.savefig(
    r"C:\Users\brian\OneDrive\Desktop\United Panel\UPFYP\Code Clean Trying\Code Clean Try 1\Model-V6\scripts\_pdf_20970_E\green_top.png",
    dpi=150,
    bbox_inches="tight",
)
print("top n", len(top))
