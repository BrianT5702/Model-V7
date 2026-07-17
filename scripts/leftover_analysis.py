"""Analyze wall panel leftovers for a project using the same rules as PanelCalculator."""
import json
import math
import os
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'model_builder.settings')
import django  # noqa: E402

django.setup()

from scripts.export_project_calc_data import find_intersections, merge_joints, serialize_wall  # noqa: E402
from core.models import Intersection, Project, Wall  # noqa: E402

MAX_PANEL_WIDTH = 1150


def wall_length(wall):
    return round(math.hypot(wall['end_x'] - wall['start_x'], wall['end_y'] - wall['start_y']))


def get_wall_joint_types(wall, intersections):
    left_joint = 'butt_in'
    right_joint = 'butt_in'
    is_horizontal = abs(wall['end_y'] - wall['start_y']) < abs(wall['end_x'] - wall['start_x'])
    is_left_to_right = wall['end_x'] > wall['start_x']
    is_bottom_to_top = wall['end_y'] > wall['start_y']

    left_ends = []
    right_ends = []
    for inter in intersections:
        for pair in inter.get('pairs', []):
            w1 = pair.get('wall1', {}).get('id')
            w2 = pair.get('wall2', {}).get('id')
            if wall['id'] not in (w1, w2):
                continue
            method = pair.get('joining_method') or 'butt_in'
            if is_horizontal:
                if is_left_to_right:
                    if inter['x'] == wall['start_x']:
                        left_ends.append(method)
                    elif inter['x'] == wall['end_x']:
                        right_ends.append(method)
                else:
                    if inter['x'] == wall['start_x']:
                        right_ends.append(method)
                    elif inter['x'] == wall['end_x']:
                        left_ends.append(method)
            elif is_bottom_to_top:
                if inter['y'] == wall['start_y']:
                    left_ends.append(method)
                elif inter['y'] == wall['end_y']:
                    right_ends.append(method)
            else:
                if inter['y'] == wall['start_y']:
                    right_ends.append(method)
                elif inter['y'] == wall['end_y']:
                    left_ends.append(method)

    if '45_cut' in left_ends:
        left_joint = '45_cut'
    if '45_cut' in right_ends:
        right_joint = '45_cut'
    return {'left': left_joint, 'right': right_joint}


class PanelCalculatorPy:
    def __init__(self):
        self.leftovers = []
        self.full_panels_used_for_cutting = 0
        self.leftover_reused = 0
        self._next_id = 1

    def cleanup_leftovers(self):
        self.leftovers = [
            lo for lo in self.leftovers
            if lo['longer_face'] > 0
            and lo['shorter_face'] > 0
            and lo['longer_face'] >= lo['wallThickness']
        ]

    def split_length_pair(self, total):
        total = round(total)
        first = total // 2
        return first, total - first

    def find_compatible_leftover(self, needed_width, wall_thickness, joint_type, panel_length, face_info):
        for leftover in self.leftovers:
            if leftover['wallThickness'] != wall_thickness:
                continue
            if leftover['panelLength'] < panel_length:
                continue
            if (
                leftover.get('innerFaceMaterial') != face_info.get('innerFaceMaterial')
                or leftover.get('innerFaceThickness') != face_info.get('innerFaceThickness')
                or leftover.get('outerFaceMaterial') != face_info.get('outerFaceMaterial')
                or leftover.get('outerFaceThickness') != face_info.get('outerFaceThickness')
            ):
                continue
            if joint_type == '45_cut':
                if leftover['longer_face'] < needed_width:
                    continue
                return leftover
            if leftover.get('rightEdgeType') == 'straight' and leftover['shorter_face'] >= needed_width:
                return leftover
        return None

    def update_leftover_after_cut(self, leftover, cut_width, wall_thickness, joint_type):
        if joint_type == '45_cut':
            if leftover['leftEdgeType'] == '45_cut':
                leftover['longer_face'] -= cut_width
                leftover['shorter_face'] = leftover['longer_face']
                leftover['leftEdgeType'] = 'straight'
            else:
                leftover['longer_face'] = leftover['longer_face'] - cut_width + wall_thickness
                leftover['shorter_face'] = leftover['longer_face'] - wall_thickness
                leftover['leftEdgeType'] = '45_cut'
        else:
            leftover['longer_face'] -= cut_width
            leftover['shorter_face'] = leftover['longer_face']
            leftover['rightEdgeType'] = 'straight'
        self.cleanup_leftovers()

    def create_side_panel_with_cut(self, width, wall_thickness, joint_type, panel_length, face_info):
        width = round(width)
        compatible = self.find_compatible_leftover(width, wall_thickness, joint_type, panel_length, face_info)
        if compatible:
            self.leftover_reused += 1
            self.update_leftover_after_cut(compatible, width, wall_thickness, joint_type)
            return

        self.full_panels_used_for_cutting += 1
        leftover = {
            'id': self._next_id,
            'wallThickness': wall_thickness,
            'leftEdgeType': '45_cut' if joint_type == '45_cut' else 'straight',
            'rightEdgeType': 'straight',
            'panelLength': panel_length,
            'innerFaceMaterial': face_info.get('innerFaceMaterial'),
            'innerFaceThickness': face_info.get('innerFaceThickness'),
            'outerFaceMaterial': face_info.get('outerFaceMaterial'),
            'outerFaceThickness': face_info.get('outerFaceThickness'),
        }
        self._next_id += 1
        if joint_type == '45_cut':
            leftover['longer_face'] = MAX_PANEL_WIDTH - width + wall_thickness
            leftover['shorter_face'] = leftover['longer_face'] - wall_thickness
        else:
            leftover['longer_face'] = MAX_PANEL_WIDTH - width
            leftover['shorter_face'] = leftover['longer_face']
        self.leftovers.append(leftover)

    def calculate_panels(self, length, wall_thickness, joint_types, panel_length, face_info):
        length = round(length)
        remaining = length
        threshold = 600 if panel_length < 5000 else 1000
        min_panel_width = 300 if panel_length < 5000 else 500
        full_count = remaining // MAX_PANEL_WIDTH
        remaining -= full_count * MAX_PANEL_WIDTH

        if remaining <= 0:
            return

        if remaining < min_panel_width and full_count > 0:
            total = MAX_PANEL_WIDTH + remaining
            a, b = self.split_length_pair(total)
            self.create_side_panel_with_cut(a, wall_thickness, joint_types['left'], panel_length, face_info)
            self.create_side_panel_with_cut(b, wall_thickness, joint_types['right'], panel_length, face_info)
            return

        if remaining <= threshold:
            side = 'left' if joint_types['left'] == '45_cut' else 'right'
            if full_count > 0:
                remaining += 20
            joint = joint_types[side]
            self.create_side_panel_with_cut(remaining, wall_thickness, joint, panel_length, face_info)
            return

        a, b = self.split_length_pair(remaining)
        self.create_side_panel_with_cut(a, wall_thickness, joint_types['left'], panel_length, face_info)
        self.create_side_panel_with_cut(b, wall_thickness, joint_types['right'], panel_length, face_info)


def run_project(walls, intersections, wall_order=None):
    calc = PanelCalculatorPy()
    ordered = wall_order or walls
    for wall in ordered:
        height = wall['gap_fill_height'] if wall.get('fill_gap_mode') and wall.get('gap_fill_height') is not None else wall['height']
        face_info = {
            'innerFaceMaterial': wall.get('inner_face_material'),
            'innerFaceThickness': wall.get('inner_face_thickness'),
            'outerFaceMaterial': wall.get('outer_face_material'),
            'outerFaceThickness': wall.get('outer_face_thickness'),
        }
        joints = get_wall_joint_types(wall, intersections)
        calc.calculate_panels(wall_length(wall), wall['thickness'], joints, height, face_info)
    return calc


def main():
    project_id = int(sys.argv[1]) if len(sys.argv) > 1 else 520
    project = Project.objects.get(pk=project_id)
    walls = [serialize_wall(w) for w in Wall.objects.filter(project_id=project.id)]
    joints = list(Intersection.objects.filter(project_id=project.id))
    intersections = merge_joints(find_intersections(Wall.objects.filter(project_id=project.id)), joints)

    calc = run_project(walls, intersections)
    widths = Counter(round(lo['longer_face']) for lo in calc.leftovers)
    heights = Counter(lo['panelLength'] for lo in calc.leftovers)
    thicknesses = Counter(lo['wallThickness'] for lo in calc.leftovers)
    edges = Counter(f"{lo['leftEdgeType']}/{lo['rightEdgeType']}" for lo in calc.leftovers)

    lengths = Counter(wall_length(w) for w in walls)
    walls_needing_cut = sum(1 for w in walls if wall_length(w) % MAX_PANEL_WIDTH != 0)

    # Why leftovers don't match later walls
    needed_cuts = []
    for wall in walls:
        L = wall_length(wall)
        rem = L % MAX_PANEL_WIDTH
        if rem == 0:
            continue
        height = wall['gap_fill_height'] if wall.get('fill_gap_mode') and wall.get('gap_fill_height') is not None else wall['height']
        joints = get_wall_joint_types(wall, intersections)
        threshold = 600 if height < 5000 else 1000
        if rem <= threshold:
            side = 'left' if joints['left'] == '45_cut' else 'right'
            needed_cuts.append((round(rem + (20 if L // MAX_PANEL_WIDTH > 0 else 0)), height, wall['thickness'], joints[side]))
        else:
            a, b = calc.split_length_pair(rem)
            needed_cuts.append((a, height, wall['thickness'], joints['left']))
            needed_cuts.append((b, height, wall['thickness'], joints['right']))

    needed_counter = Counter(needed_cuts)
    leftover_signatures = Counter(
        (round(lo['longer_face']), lo['panelLength'], lo['wallThickness'], lo['leftEdgeType'])
        for lo in calc.leftovers
    )

    print(json.dumps({
        'project': project.name,
        'walls': len(walls),
        'wallsNeedingCut': walls_needing_cut,
        'topWallLengths': lengths.most_common(8),
        'newStockCuts': calc.full_panels_used_for_cutting,
        'leftoverReused': calc.leftover_reused,
        'leftoverCount': len(calc.leftovers),
        'leftoverByWidthTop': widths.most_common(12),
        'leftoverByHeight': dict(heights),
        'leftoverByThickness': dict(thicknesses),
        'leftoverByEdge': dict(edges),
        'uniqueNeededCutSignatures': len(needed_counter),
        'topNeededCuts': [
            {'width': w, 'height': h, 'thickness': t, 'joint': j, 'count': c}
            for (w, h, t, j), c in needed_counter.most_common(12)
        ],
        'topUnmatchedLeftoverSignatures': [
            {'width': w, 'height': h, 'thickness': t, 'edge': e, 'count': c}
            for (w, h, t, e), c in leftover_signatures.most_common(12)
        ],
        'smallLeftoversUnder200': sum(1 for lo in calc.leftovers if lo['longer_face'] < 200),
    }, indent=2))


if __name__ == '__main__':
    main()
