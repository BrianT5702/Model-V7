"""Inspect right-end / niche geometry in PDF points."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fitz
from core import pdf_wall_import as pwi

pdf_path = r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh\UPS 20970 E- RETAIL SOLUTIONS SDN BHD (AEON MIDTOWN).pdf"
page = fitz.open(pdf_path)[0]

# ALL green including short
segs = []
for d in page.get_drawings():
    if not pwi._is_wall_green(d.get("color")):
        continue
    for item in d.get("items", []):
        if item[0] != "l":
            continue
        p1, p2 = item[1], item[2]
        length = ((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2) ** 0.5
        mx, my = (p1.x + p2.x) / 2, (p1.y + p2.y) / 2
        if not (350 <= mx <= 540):
            continue
        segs.append(
            {
                "x1": p1.x,
                "y1": p1.y,
                "x2": p2.x,
                "y2": p2.y,
                "len": length,
                "mx": mx,
                "my": my,
            }
        )

print("right-ish all lengths incl short", len(segs))
# bottom end region y>550
print("\n=== y>550 ===")
for s in sorted([s for s in segs if max(s["y1"], s["y2"]) > 550], key=lambda z: z["my"]):
    print(
        f"  len={s['len']:.2f} ({s['x1']:.1f},{s['y1']:.1f})->({s['x2']:.1f},{s['y2']:.1f})"
    )

# niche 1 region
print("\n=== niche1 y=90-140 x>480 ===")
for s in sorted(
    [s for s in segs if 90 < s["my"] < 140 and s["mx"] > 480],
    key=lambda z: (z["my"], z["mx"]),
):
    print(
        f"  len={s['len']:.2f} ({s['x1']:.1f},{s['y1']:.1f})->({s['x2']:.1f},{s['y2']:.1f})"
    )

# top-left of plan (start of top wall) y~44
print("\n=== top edge y<50 ===")
for s in sorted([s for s in segs if min(s["y1"], s["y2"]) < 50], key=lambda z: z["mx"]):
    print(
        f"  len={s['len']:.2f} ({s['x1']:.1f},{s['y1']:.1f})->({s['x2']:.1f},{s['y2']:.1f})"
    )

# After current import, compute expected mm for niche from pt
scale = 36.5312
print("\nscale", scale)
print("niche back faces ~26pt ->", 26 * scale)
print("niche side faces ~28.8pt ->", 28.8 * scale)
print("paired niche back 24pt ->", 24 * scale)
print("top H face 112pt ->", 112 * scale, "vs 117.5 outer", 117.5 * scale)
print("outer top span 117.5 vs paired 112: missing", (117.5 - 112) * scale, "mm")
