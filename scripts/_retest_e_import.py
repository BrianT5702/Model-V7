import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core.pdf_wall_import import extract_walls_from_pdf_bytes
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

pdf = open(
    r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh\UPS 20970 E- RETAIL SOLUTIONS SDN BHD (AEON MIDTOWN).pdf",
    "rb",
).read()
r = extract_walls_from_pdf_bytes(pdf)
print("H", r["height_mm"], "th", r["thickness_mm"], "cluster", r["cluster"], "n", len(r["walls"]))
print("overall", r.get("overall_width_mm"), "scale", r["scale_mm_per_pt"])
for w in sorted(r["walls"], key=lambda z: -z["length_mm"]):
    print(w["length_mm"], (w["start_x"], w["start_y"], w["end_x"], w["end_y"]), "src", w.get("source_length_mm"))

fig, ax = plt.subplots(figsize=(14, 4))
for w in r["walls"]:
    ax.plot([w["start_x"], w["end_x"]], [w["start_y"], w["end_y"]], "-o", ms=2)
    mx = (w["start_x"] + w["end_x"]) / 2
    my = (w["start_y"] + w["end_y"]) / 2
    ax.text(mx, my, str(w["length_mm"]), fontsize=7)
ax.set_aspect("equal")
ax.invert_yaxis()
ax.set_title(f"fixed E import: {len(r['walls'])} walls H={r['height_mm']}")
ax.grid(True, alpha=0.3)
out = r"C:\Users\brian\OneDrive\Desktop\United Panel\UPFYP\Code Clean Trying\Code Clean Try 1\Model-V6\scripts\_pdf_20970_E\imported_walls_fixed.png"
fig.savefig(out, dpi=140, bbox_inches="tight")
print("saved", out)
