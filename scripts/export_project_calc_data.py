"""Export walls + merged intersections for panel calc analysis (stdout JSON only)."""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'model_builder.settings')
django.setup()

from core.models import Intersection, Project, Wall  # noqa: E402


def wall_length(wall):
    return round(math.hypot(wall.end_x - wall.start_x, wall.end_y - wall.start_y))


def find_intersections(walls):
    """Match frontend findIntersectionPointsBetweenWalls (endpoint + crossing)."""
    points = {}

    def add_pair(x, y, w1, w2):
        key = (round(x), round(y))
        if key not in points:
            points[key] = {'x': key[0], 'y': key[1], 'pairs': []}
        pairs = points[key]['pairs']
        if not any(
            (p['wall1']['id'] == w1.id and p['wall2']['id'] == w2.id)
            or (p['wall1']['id'] == w2.id and p['wall2']['id'] == w1.id)
            for p in pairs
        ):
            pairs.append({'wall1': {'id': w1.id}, 'wall2': {'id': w2.id}, 'joining_method': 'butt_in'})

    for i, w1 in enumerate(walls):
        for w2 in walls[i + 1:]:
            # shared endpoints
            ends1 = [(w1.start_x, w1.start_y), (w1.end_x, w1.end_y)]
            ends2 = [(w2.start_x, w2.start_y), (w2.end_x, w2.end_y)]
            for x1, y1 in ends1:
                for x2, y2 in ends2:
                    if abs(x1 - x2) < 1 and abs(y1 - y2) < 1:
                        add_pair(x1, y1, w1, w2)

            # proper segment intersection (non-parallel)
            x1, y1, x2, y2 = w1.start_x, w1.start_y, w1.end_x, w1.end_y
            x3, y3, x4, y4 = w2.start_x, w2.start_y, w2.end_x, w2.end_y
            denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
            if abs(denom) < 1e-9:
                continue
            t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
            u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom
            if 0 <= t <= 1 and 0 <= u <= 1:
                ix = x1 + t * (x2 - x1)
                iy = y1 + t * (y2 - y1)
                add_pair(ix, iy, w1, w2)

    return list(points.values())


def merge_joints(intersections, joints):
    joint_map = {}
    for joint in joints:
        key = tuple(sorted((joint.wall_1_id, joint.wall_2_id)))
        joint_map[key] = joint.joining_method or 'butt_in'

    for inter in intersections:
        for pair in inter['pairs']:
            w1 = pair['wall1']['id']
            w2 = pair['wall2']['id']
            method = joint_map.get(tuple(sorted((w1, w2))), 'butt_in')
            pair['joining_method'] = method
    return intersections


def serialize_wall(wall):
    return {
        'id': wall.id,
        'start_x': float(wall.start_x),
        'start_y': float(wall.start_y),
        'end_x': float(wall.end_x),
        'end_y': float(wall.end_y),
        'height': float(wall.height),
        'thickness': float(wall.thickness),
        'application_type': wall.application_type,
        'fill_gap_mode': wall.fill_gap_mode,
        'gap_fill_height': wall.gap_fill_height,
        'inner_face_material': wall.inner_face_material,
        'inner_face_thickness': wall.inner_face_thickness,
        'outer_face_material': wall.outer_face_material,
        'outer_face_thickness': wall.outer_face_thickness,
    }


def main():
    project_id = int(sys.argv[1]) if len(sys.argv) > 1 else 520
    project = Project.objects.get(pk=project_id)
    walls = list(Wall.objects.filter(project_id=project.id))
    joints = list(Intersection.objects.filter(project_id=project.id))
    intersections = merge_joints(find_intersections(walls), joints)
    payload = {
        'project': {'id': project.id, 'name': project.name},
        'walls': [serialize_wall(w) for w in walls],
        'intersections': intersections,
    }
    json.dump(payload, sys.stdout)


if __name__ == '__main__':
    main()
