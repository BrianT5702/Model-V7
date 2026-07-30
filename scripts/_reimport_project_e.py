"""Replace walls on project UPS/0726/20970/E with fixed PDF import."""
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "model_builder.settings")
import django

django.setup()

from core.models import Project, Wall, Storey
from core.pdf_wall_import import extract_walls_from_pdf_bytes
from core.services import WallService

pdf_path = r"C:\Users\brian\OneDrive\Desktop\United Panel\Present to MrLoh\UPS 20970 E- RETAIL SOLUTIONS SDN BHD (AEON MIDTOWN).pdf"
preview = extract_walls_from_pdf_bytes(open(pdf_path, "rb").read())
p = Project.objects.filter(name__icontains="20970/E").first()
if not p:
    raise SystemExit("project E not found")

print("Updating", p.id, p.name)
storey = Storey.objects.filter(project=p).order_by("id").first()
Wall.objects.filter(project=p).delete()

height = float(preview["height_mm"])
thickness = float(preview["thickness_mm"])
xs, ys = [], []
for w in preview["walls"]:
    xs += [w["start_x"], w["end_x"]]
    ys += [w["start_y"], w["end_y"]]
p.height = height
p.wall_thickness = max(thickness, 25)
p.width = float(max(xs) - min(xs))
p.length = float(max(ys) - min(ys))
p.save()

created = []
for w in preview["walls"]:
    obj = Wall.objects.create(
        project=p,
        storey=storey,
        start_x=w["start_x"],
        start_y=w["start_y"],
        end_x=w["end_x"],
        end_y=w["end_y"],
        height=height,
        thickness=p.wall_thickness,
        application_type="wall",
        is_default=False,
        inner_face_material="PPGI",
        outer_face_material="PPGI",
        inner_face_thickness=0.5,
        outer_face_thickness=0.5,
    )
    created.append(obj)

if created:
    WallService.update_wall_base_elevations([w.id for w in created])

print(f"created {len(created)} walls W={p.width} L={p.length} H={p.height}")
for w in sorted(created, key=lambda z: -math.hypot(z.end_x - z.start_x, z.end_y - z.start_y)):
    L = math.hypot(w.end_x - w.start_x, w.end_y - w.start_y)
    print(f"  ({w.start_x},{w.start_y})->({w.end_x},{w.end_y}) L={L:.0f}")
