import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fitz
from core import pdf_wall_import as pwi

for label, path in [
    (
        "C",
        r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh\UPS 20970 C (R1) - RETAIL SOLUTIONS SDN BHD (AEON MIDTOWN).pdf",
    ),
    (
        "E",
        r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh\UPS 20970 E- RETAIL SOLUTIONS SDN BHD (AEON MIDTOWN).pdf",
    ),
]:
    page = fitz.open(path)[0]
    segs = pwi._extract_green_segments(page)
    right = [s for s in segs if 350 <= s["mx"] <= 540 and 40 <= s["my"] <= 520]
    left = [s for s in segs if 140 <= s["mx"] <= 330 and 40 <= s["my"] <= 520]
    for name, cluster in [("left", left), ("right", right), ("all", segs)]:
        if len(cluster) < 5:
            continue
        xs = [c for s in cluster for c in (s["x1"], s["x2"])]
        ys = [c for s in cluster for c in (s["y1"], s["y2"])]
        print(
            f"{label} {name}: n={len(cluster)} span=({max(xs)-min(xs):.1f} x {max(ys)-min(ys):.1f}) "
            f"bbox=({min(xs):.0f},{min(ys):.0f})-({max(xs):.0f},{max(ys):.0f})"
        )
    r = pwi.extract_walls_from_pdf_bytes(open(path, "rb").read())
    print(
        f"{label} import: cluster={r['cluster']} n={len(r['walls'])} "
        f"H={r['height_mm']} overall={r.get('overall_width_mm')} "
        f"W={max(max(w['start_x'],w['end_x']) for w in r['walls'])} "
        f"L={max(max(w['start_y'],w['end_y']) for w in r['walls'])}"
    )
    print("  top lengths", sorted((w["length_mm"] for w in r["walls"]), reverse=True)[:10])
    print()
