"""
Regression smoke test for United Panel PDF plan import.

Uses the MrLoh presentation PDFs when present (paths documented; binaries not committed).

Run:
  py scripts/_test_pdf_plan_import.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core.pdf_plan_import import extract_plan_from_pdf_bytes

SAMPLE_DIR = Path(r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh")

SAMPLES = [
    ("AEON_C", "UPS 20970 C (R1) - RETAIL SOLUTIONS SDN BHD (AEON MIDTOWN).pdf", "ups_a3"),
    ("AEON_D", "UPS 20970 D - RETAIL SOLUTIONS SDN BHD (AEON MIDTOWN).pdf", "ups_a3"),
    ("TY", "022. TY INNOVATIONS PTE LTD (YEO SENG HENG @ PPWC BLK12 #01-598) - 27.07.2026.pdf", "ups_a3_ty"),
    ("SWIFT", "V05 Swift Logistic-A.pdf", "ups_cad_multi"),
]


def main() -> int:
    failed = 0
    for key, name, expected_dialect in SAMPLES:
        path = SAMPLE_DIR / name
        print("=" * 72)
        print(key, name)
        if not path.exists():
            print("  SKIP missing file")
            continue
        try:
            preview = extract_plan_from_pdf_bytes(path.read_bytes(), page_index=0)
        except Exception as exc:
            print(f"  FAIL {type(exc).__name__}: {exc}")
            failed += 1
            continue

        walls = preview.get("walls") or []
        doors = preview.get("doors") or []
        rooms = preview.get("rooms") or []
        ixs = preview.get("intersections") or []
        hints = preview.get("panel_hints") or []
        dialect = preview.get("dialect")
        print(
            f"  dialect={dialect} walls={len(walls)} doors={len(doors)} "
            f"rooms={len(rooms)} joints={len(ixs)} panel_hints={len(hints)} "
            f"H={preview.get('height_mm')} T={preview.get('thickness_mm')}"
        )
        if walls:
            xs = [c for w in walls for c in (w["start_x"], w["end_x"])]
            ys = [c for w in walls for c in (w["start_y"], w["end_y"])]
            print(f"  footprint=({min(xs):.0f},{min(ys):.0f})-({max(xs):.0f},{max(ys):.0f})")
        if dialect != expected_dialect:
            print(f"  WARN expected dialect {expected_dialect}")
        if len(walls) < 4:
            print("  FAIL too few walls")
            failed += 1
        if key == "SWIFT":
            if not walls:
                print("  FAIL Swift produced no walls")
                failed += 1
            else:
                span_x = max(xs) - min(xs)
                span_y = max(ys) - min(ys)
                # Must read WALL LAYOUT (~79800 mm wide), not elevation stacks
                if span_x < 70000 or span_x > 90000:
                    print(f"  FAIL Swift width {span_x:.0f} not near overall ~79800")
                    failed += 1
                if span_y > 90000:
                    print(f"  FAIL Swift depth {span_y:.0f} looks like elevations")
                    failed += 1
                if preview.get("cluster") != "wall_layout_raster":
                    print(f"  WARN expected wall_layout_raster cluster, got {preview.get('cluster')}")
        if key.startswith("AEON") and len(walls) < 8:
            print("  FAIL AEON wall count low")
            failed += 1

    print("=" * 72)
    if failed:
        print(f"FAILED checks: {failed}")
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
