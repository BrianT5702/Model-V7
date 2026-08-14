"""Re-import the TY PDF into project 543 (Testing for Import)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "model_builder.settings")

import django

django.setup()

from core.models import Project, Storey
from core.pdf_plan_import import extract_plan_from_pdf_bytes, persist_plan_import

PDF = Path(
    r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh"
    r"\022. TY INNOVATIONS PTE LTD (YEO SENG HENG @ PPWC BLK12 #01-598) - 27.07.2026.pdf"
)


def main() -> None:
    project = Project.objects.get(pk=543)
    storey = project.storeys.order_by("id").first()
    preview = extract_plan_from_pdf_bytes(PDF.read_bytes(), page_index=0)
    created = persist_plan_import(
        project=project,
        storey=storey,
        preview=preview,
        replace_existing=True,
    )
    walls = created["walls"]
    max_x = max(max(w.start_x, w.end_x) for w in walls)
    max_y = max(max(w.start_y, w.end_y) for w in walls)
    meta = preview.get("project_meta") or {}
    project.width = max(float(meta.get("width") or max_x), 100)
    project.length = max(float(meta.get("length") or max_y), 100)
    project.height = float(preview.get("height_mm") or project.height or 6000)
    project.wall_thickness = float(preview.get("thickness_mm") or 150)
    project.save(update_fields=["width", "length", "height", "wall_thickness"])
    print(
        f"updated #{project.id} {project.width}x{project.length}x{project.height} "
        f"t={project.wall_thickness} walls={len(walls)} "
        f"doors={len(created['doors'])} rooms={len(created['rooms'])} "
        f"joints={len(created['intersections'])}"
    )
    for r in created["rooms"]:
        print(f"  room {r.room_name!r} h={r.height}")


if __name__ == "__main__":
    main()
