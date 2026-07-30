"""Deep dump of right-cluster paired walls vs unmatched green segs for PDF E."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fitz
from core import pdf_wall_import as pwi

pdf_path = r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh\UPS 20970 E- RETAIL SOLUTIONS SDN BHD (AEON MIDTOWN).pdf"
page = fitz.open(pdf_path)[0]
segs = pwi._extract_green_segments(page)
right = [s for s in segs if 350 <= s["mx"] <= 540 and 40 <= s["my"] <= 520]
print("right segs", len(right))
for i, s in enumerate(sorted(right, key=lambda z: (round(z["mx"]), round(z["my"])))):
    dx = abs(s["x2"] - s["x1"])
    dy = abs(s["y2"] - s["y1"])
    orient = "H" if dx >= dy else "V"
    print(
        f"{i:02d} {orient} len={s['len']:.1f} "
        f"({s['x1']:.1f},{s['y1']:.1f})->({s['x2']:.1f},{s['y2']:.1f}) mid=({s['mx']:.1f},{s['my']:.1f})"
    )

walls_pt = pwi._pair_wall_centerlines(right)
print("\npaired", len(walls_pt))
for w in sorted(walls_pt, key=lambda z: -z["len_pt"]):
    dx = abs(w["x2"] - w["x1"])
    dy = abs(w["y2"] - w["y1"])
    orient = "H" if dx >= dy else "V"
    print(
        f"  {orient} len={w['len_pt']:.1f} thick={w['thick_pt']:.2f} "
        f"({w['x1']:.1f},{w['y1']:.1f})->({w['x2']:.1f},{w['y2']:.1f})"
    )

# Unmatched: segs not used in any pair (approximate by checking midpoint near a wall face)
used = set()
# Re-run pairing logic manually to see unused
used_idx = set()
# monkey: pair returns walls but not used indices — reimplement quick
from core.pdf_wall_import import _unit_dir, _proj_range

used = set()
for i, a in enumerate(right):
    if i in used:
        continue
    aux, auy, a_len = _unit_dir(a["x1"], a["y1"], a["x2"], a["y2"])
    amx, amy = a["mx"], a["my"]
    best = None
    for j, b in enumerate(right):
        if j <= i or j in used:
            continue
        bux, buy, b_len = _unit_dir(b["x1"], b["y1"], b["x2"], b["y2"])
        cross = abs(aux * buy - auy * bux)
        dot = abs(aux * bux + auy * buy)
        if cross > 0.1 or dot < 0.97:
            continue
        bmx, bmy = b["mx"], b["my"]
        perp = abs((bmx - amx) * (-auy) + (bmy - amy) * aux)
        if perp < 0.4 or perp > 2.8:
            continue
        ar = _proj_range(a["x1"], a["y1"], a["x2"], a["y2"], aux, auy)
        br = _proj_range(b["x1"], b["y1"], b["x2"], b["y2"], aux, auy)
        overlap = max(0.0, min(ar[1], br[1]) - max(ar[0], br[0]))
        if overlap < min(a_len, b_len) * 0.5:
            continue
        cand = (perp, -overlap, j)
        if best is None or cand < best:
            best = cand
    if best:
        used.add(i)
        used.add(best[2])

unused = [right[i] for i in range(len(right)) if i not in used]
print("\nunused segs", len(unused))
for s in unused:
    dx = abs(s["x2"] - s["x1"])
    dy = abs(s["y2"] - s["y1"])
    orient = "H" if dx >= dy else "V"
    print(
        f"  {orient} len={s['len']:.1f} "
        f"({s['x1']:.1f},{s['y1']:.1f})->({s['x2']:.1f},{s['y2']:.1f}) mid=({s['mx']:.1f},{s['my']:.1f})"
    )
