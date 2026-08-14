"""Quick smoke test for DWG/DXF plan import (Jeff BPL sample or local DXF)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core.dwg_plan_import import extract_plan_from_cad_bytes, extract_plan_from_dxf_bytes


def main():
    dxf = ROOT / "scripts" / "_pdf_samples" / "bpl_v04_r2000.dxf"
    dwg = Path(
        r"C:\Users\brian\OneDrive\Desktop\United Panel\Jeff's Project\V04.BPL (Change Height).dwg"
    )
    if dxf.is_file():
        preview = extract_plan_from_dxf_bytes(dxf.read_bytes(), region_index=0)
        print(
            f"DXF: {len(preview['walls'])} walls, "
            f"{preview['thickness_mm']} mm, "
            f"{preview['project_meta']['width']:.0f}x{preview['project_meta']['length']:.0f}"
        )
    if dwg.is_file():
        preview = extract_plan_from_cad_bytes(
            dwg.read_bytes(), filename=dwg.name, region_index=0
        )
        print(
            f"DWG: {len(preview['walls'])} walls, dialect={preview['dialect']}, "
            f"regions={len(preview.get('regions') or [])}"
        )


if __name__ == "__main__":
    main()
