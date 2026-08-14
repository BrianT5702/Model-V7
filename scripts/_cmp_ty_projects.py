"""Compare Testing-for-import (543) vs reference TY project (527)."""
from __future__ import annotations

import math
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "model_builder.settings")

import django

django.setup()

from core.models import Door, Intersection, Project, Room, Wall  # noqa: E402


def dump(pid: int) -> None:
    p = Project.objects.get(pk=pid)
    walls = list(Wall.objects.filter(project=p).order_by("id"))
    doors = list(Door.objects.filter(project=p))
    rooms = list(Room.objects.filter(project=p))
    ixs = list(Intersection.objects.filter(project=p))
    print("=" * 70)
    print(f"#{p.id} {p.name!r} {p.width}x{p.length}x{p.height} t={p.wall_thickness}")
    print(f"walls={len(walls)} doors={len(doors)} rooms={len(rooms)} joints={len(ixs)}")
    for r in rooms:
        nwalls = r.walls.count()
        pts = r.room_points
        print(f"  room {r.room_name!r} h={r.height} nwalls={nwalls} pts={pts}")
    for d in doors:
        print(
            f"  door {d.door_type} {d.width}x{d.height} "
            f"@({d.position_x},{d.position_y}) {d.orientation}"
        )
    print("  walls:")
    for w in walls:
        length = math.hypot(w.end_x - w.start_x, w.end_y - w.start_y)
        print(
            f"    {w.id}: ({w.start_x:.0f},{w.start_y:.0f})-({w.end_x:.0f},{w.end_y:.0f}) "
            f"L={length:.0f} t={w.thickness} h={w.height}"
        )


if __name__ == "__main__":
    dump(543)
    dump(527)
