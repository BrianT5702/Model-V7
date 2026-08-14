"""Diagnose TY PDF extract vs reference project 527."""
from __future__ import annotations

import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core.pdf_plan_import import extract_plan_from_pdf_bytes
from core.pdf_wall_import import extract_walls_from_pdf_bytes

PDF = Path(
    r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh"
    r"\022. TY INNOVATIONS PTE LTD (YEO SENG HENG @ PPWC BLK12 #01-598) - 27.07.2026.pdf"
)


def main() -> None:
    data = PDF.read_bytes()
    walls_only = extract_walls_from_pdf_bytes(data, page_index=0)
    print("dialect", walls_only.get("dialect"), "cluster", walls_only.get("cluster"))
    print("clip", walls_only.get("clip_rect"))
    print("scale", walls_only.get("scale_mm_per_pt"), "overall", walls_only.get("overall_width_mm"))
    print("H", walls_only.get("height_mm"), "T", walls_only.get("thickness_mm"))
    print("wall dims", walls_only.get("dimensions", {}).get("wall"))
    print("panel dims", walls_only.get("dimensions", {}).get("panel"))
    print("notes", walls_only.get("notes"))
    print("walls_mm", len(walls_only.get("walls") or []))
    for i, w in enumerate(walls_only.get("walls") or []):
        print(
            f"  {i:02d} ({w['start_x']},{w['start_y']})-({w['end_x']},{w['end_y']}) "
            f"L={w['length_mm']}"
        )

    preview = extract_plan_from_pdf_bytes(data, page_index=0)
    print("\nPLAN doors", preview.get("doors"))
    print("rooms", preview.get("rooms"))
    print("intersections", len(preview.get("intersections") or []))
    print("job", (preview.get("project_meta") or {}).get("job_no"))

    # Compare to reference topology lengths
    ref = [8500, 4600, 2850, 2500, 3250, 1400, 1850, 8500, 4450, 1850, 3200, 6450, 2850]
    got = sorted(w["length_mm"] for w in (walls_only.get("walls") or []))
    print("\ngot lengths", got)
    print("ref lengths", sorted(ref))


if __name__ == "__main__":
    main()
