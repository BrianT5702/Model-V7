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



def get_wall_panel_end_points(wall):
    is_horizontal = abs(wall['end_y'] - wall['start_y']) < abs(wall['end_x'] - wall['start_x'])
    start = {'x': wall['start_x'], 'y': wall['start_y']}
    end = {'x': wall['end_x'], 'y': wall['end_y']}
    if is_horizontal:
        return {'left': start, 'right': end} if wall['end_x'] > wall['start_x'] else {'left': end, 'right': start}
    return {'left': start, 'right': end} if wall['end_y'] > wall['start_y'] else {'left': end, 'right': start}


def find_joining_wall_at_end(wall, end_point, walls, intersections):
    by_id = {w['id']: w for w in walls}
    preferred = None
    fallback = None
    max_dist = max(200, (wall.get('thickness') or 0) * 2)
    for inter in intersections:
        dist = math.hypot(inter['x'] - end_point['x'], inter['y'] - end_point['y'])
        if dist > max_dist:
            continue
        for pair in inter.get('pairs', []):
            w1 = pair.get('wall1', {}).get('id')
            w2 = pair.get('wall2', {}).get('id')
            if wall['id'] not in (w1, w2):
                continue
            other_id = w2 if w1 == wall['id'] else w1
            other = by_id.get(other_id)
            if not other:
                continue
            method = pair.get('joining_method') or 'butt_in'
            if method == '45_cut':
                preferred = other
            elif fallback is None:
                fallback = other
    return preferred or fallback


def get_cut_slash_for_end(end_point, other_end_point, joining_wall):
    """Plan coords are Y-down (larger y = visually below). Cross > 0 → '\\' else '/'."""
    if not joining_wall:
        return '/'
    along_x = other_end_point['x'] - end_point['x']
    along_y = other_end_point['y'] - end_point['y']
    mid_j = {
        'x': (joining_wall['start_x'] + joining_wall['end_x']) / 2,
        'y': (joining_wall['start_y'] + joining_wall['end_y']) / 2,
    }
    to_jx = mid_j['x'] - end_point['x']
    to_jy = mid_j['y'] - end_point['y']
    cross = along_x * to_jy - along_y * to_jx
    if abs(cross) < 1e-9:
        # to_jy > 0 = visually below
        if to_jy > 0:
            return '\\' if along_x >= 0 else '/'
        return '/' if along_x >= 0 else '\\'
    return '\\' if cross > 0 else '/'


def get_wall_end_cut_slashes(wall, walls, intersections):
    joints = get_wall_joint_types(wall, intersections)
    ends = get_wall_panel_end_points(wall)
    result = {'left': None, 'right': None}
    if joints['left'] == '45_cut':
        joining = find_joining_wall_at_end(wall, ends['left'], walls, intersections)
        result['left'] = get_cut_slash_for_end(ends['left'], ends['right'], joining)
    if joints['right'] == '45_cut':
        joining = find_joining_wall_at_end(wall, ends['right'], walls, intersections)
        result['right'] = get_cut_slash_for_end(ends['right'], ends['left'], joining)
    return result


class PanelCalculatorPy:
    def __init__(self):
        self.leftovers = []
        self.full_panels_used_for_cutting = 0
        self.leftover_reused = 0
        self._next_id = 1
        self.current_cut_slashes = {'left': None, 'right': None}

    def cleanup_leftovers(self):
        self.leftovers = [
            lo for lo in self.leftovers
            if lo['longer_face'] > 0
            and lo['shorter_face'] > 0
            and lo['longer_face'] >= lo['wallThickness']
            and lo['shorter_face'] >= lo['wallThickness']
        ]

    def split_length_pair(self, total):
        total = round(total)
        first = total // 2
        return first, total - first

    def faces_match_with_optional_flip(self, leftover, face_info):
        exact = (
            leftover.get('innerFaceMaterial') == face_info.get('innerFaceMaterial')
            and leftover.get('innerFaceThickness') == face_info.get('innerFaceThickness')
            and leftover.get('outerFaceMaterial') == face_info.get('outerFaceMaterial')
            and leftover.get('outerFaceThickness') == face_info.get('outerFaceThickness')
        )
        if exact:
            return True, False
        flipped = (
            leftover.get('innerFaceMaterial') == face_info.get('outerFaceMaterial')
            and leftover.get('innerFaceThickness') == face_info.get('outerFaceThickness')
            and leftover.get('outerFaceMaterial') == face_info.get('innerFaceMaterial')
            and leftover.get('outerFaceThickness') == face_info.get('innerFaceThickness')
        )
        if flipped:
            return True, True
        return False, False

    def wall_allows_side_flip(self, face_info):
        return (
            face_info.get('innerFaceMaterial') is not None
            and face_info.get('innerFaceMaterial') == face_info.get('outerFaceMaterial')
            and face_info.get('innerFaceThickness') == face_info.get('outerFaceThickness')
        )

    def choose_side_panel_position(self, remaining, wall_thickness, joint_types, panel_length, face_info, default_side):
        if joint_types['left'] != joint_types['right'] or not self.wall_allows_side_flip(face_info):
            return default_side
        left_match = self.find_compatible_leftover(
            remaining, wall_thickness, joint_types['left'], panel_length, face_info, position='left',
            needed_slash=self.current_cut_slashes.get('left') if joint_types['left'] == '45_cut' else None,
        )
        right_match = self.find_compatible_leftover(
            remaining, wall_thickness, joint_types['right'], panel_length, face_info, position='right',
            needed_slash=self.current_cut_slashes.get('right') if joint_types['right'] == '45_cut' else None,
        )
        if right_match and not left_match:
            return 'right'
        if left_match and not right_match:
            return 'left'
        return default_side

    def find_compatible_leftover(self, needed_width, wall_thickness, joint_type, panel_length, face_info, leftover_search_end_index=None, position=None, needed_slash=None):
        end_index = leftover_search_end_index if leftover_search_end_index is not None else len(self.leftovers)
        needs_mother = position == 'left'
        needs_male = position == 'right'
        cut_on_right = position == 'left'
        for idx in range(0, min(end_index, len(self.leftovers))):
            leftover = self.leftovers[idx]
            if leftover['wallThickness'] != wall_thickness:
                continue
            if leftover['panelLength'] < panel_length:
                continue
            match, face_flipped = self.faces_match_with_optional_flip(leftover, face_info)
            if not match:
                continue
            if needs_mother and leftover.get('rightJointConsumed'):
                continue
            if needs_male and leftover.get('leftJointConsumed'):
                continue
            if joint_type == '45_cut' and needed_slash:
                existing = leftover.get('rightEdgeSlash') if cut_on_right else leftover.get('leftEdgeSlash')
                if existing in ('/', '\\'):
                    flip = (lambda s: '\\' if s == '/' else '/')
                    effective = flip(existing) if face_flipped else existing
                    matches = effective == needed_slash
                    matches_via_flip = (
                        not face_flipped
                        and self.wall_allows_side_flip(face_info)
                        and flip(existing) == needed_slash
                    )
                    if not matches and not matches_via_flip:
                        continue
            if joint_type == '45_cut':
                if leftover['shorter_face'] >= needed_width:
                    return leftover
                can_use_longer = (
                    leftover['longer_face'] >= needed_width
                    and (face_flipped or self.wall_allows_side_flip(face_info))
                )
                if can_use_longer:
                    return leftover
            elif leftover['shorter_face'] >= needed_width:
                return leftover
        return None

    def update_leftover_after_cut(self, leftover, cut_width, wall_thickness, joint_type, position=None, needed_slash=None):
        if position == 'left':
            leftover['rightJointConsumed'] = True  # took 母 — shop cut on RIGHT
        elif position == 'right':
            leftover['leftJointConsumed'] = True   # took 公 — shop cut on LEFT

        cut_on_right = position == 'left'
        cut_edge_key = 'rightEdgeType' if cut_on_right else 'leftEdgeType'
        cut_slash_key = 'rightEdgeSlash' if cut_on_right else 'leftEdgeSlash'
        other_edge_key = 'leftEdgeType' if cut_on_right else 'rightEdgeType'
        other_is_45 = leftover.get(other_edge_key) == '45_cut'
        slash = needed_slash if joint_type == '45_cut' else None

        if joint_type == '45_cut':
            if other_is_45:
                other_slash_key = 'leftEdgeSlash' if cut_on_right else 'rightEdgeSlash'
                other_slash = leftover.get(other_slash_key)
                # Same slash both ends → parallelogram (LF = SF).
                # Opposite slashes → trapezoid (LF − SF = 2 × thickness).
                if other_slash and slash and other_slash == slash:
                    # Parallel 45° ends → parallelogram.
                    # Each face loses `width` on one end and `width − T` on the other:
                    # remaining = LF − width = SF − (width − T).
                    face = leftover['longer_face'] - cut_width
                    leftover['longer_face'] = face
                    leftover['shorter_face'] = face
                else:
                    leftover['longer_face'] = leftover['longer_face'] - cut_width + wall_thickness
                    leftover['shorter_face'] = leftover['shorter_face'] - cut_width
            else:
                leftover['longer_face'] = leftover['longer_face'] - cut_width + wall_thickness
                leftover['shorter_face'] = leftover['longer_face'] - wall_thickness
            leftover[cut_edge_key] = '45_cut'
            leftover[cut_slash_key] = slash or '/'
        else:
            leftover['longer_face'] -= cut_width
            if other_is_45:
                leftover['shorter_face'] = leftover['longer_face'] - wall_thickness
            else:
                leftover['shorter_face'] = leftover['longer_face']
            leftover[cut_edge_key] = 'straight'
            leftover[cut_slash_key] = None
        self.cleanup_leftovers()

    def create_side_panel_with_cut(self, width, wall_thickness, joint_type, panel_length, face_info, leftover_search_end_index=None, position=None):
        width = round(width)
        needed_slash = self.current_cut_slashes.get(position) if joint_type == '45_cut' else None
        if joint_type == '45_cut' and needed_slash is None:
            needed_slash = '/'
        compatible = self.find_compatible_leftover(
            width,
            wall_thickness,
            joint_type,
            panel_length,
            face_info,
            leftover_search_end_index=leftover_search_end_index,
            position=position,
            needed_slash=needed_slash,
        )
        if compatible:
            self.leftover_reused += 1
            self.update_leftover_after_cut(compatible, width, wall_thickness, joint_type, position=position, needed_slash=needed_slash)
            return

        self.full_panels_used_for_cutting += 1
        needs_mother = position == 'left'
        needs_male = position == 'right'
        leftover = {
            'id': self._next_id,
            'wallThickness': wall_thickness,
            'leftEdgeType': ('45_cut' if joint_type == '45_cut' else 'straight') if needs_male else 'straight',
            'rightEdgeType': ('45_cut' if joint_type == '45_cut' else 'straight') if needs_mother else 'straight',
            'leftEdgeSlash': needed_slash if needs_male else None,
            'rightEdgeSlash': needed_slash if needs_mother else None,
            'panelLength': panel_length,
            'leftJointConsumed': needs_male,
            'rightJointConsumed': needs_mother,
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

    def calculate_panels(self, length, wall_thickness, joint_types, panel_length, face_info, cut_slashes=None):
        self.current_cut_slashes = cut_slashes or {'left': None, 'right': None}
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
            # Left needs 母, right needs 公 — second cut may reuse leftover from first.
            self.create_side_panel_with_cut(
                a, wall_thickness, joint_types['left'], panel_length, face_info, position='left'
            )
            self.create_side_panel_with_cut(
                b, wall_thickness, joint_types['right'], panel_length, face_info, position='right'
            )
            return

        if remaining <= threshold:
            side = 'left' if joint_types['left'] == '45_cut' else 'right'
            tentative = remaining + 20 if full_count > 0 else remaining
            side = self.choose_side_panel_position(
                tentative, wall_thickness, joint_types, panel_length, face_info, side
            )
            if full_count > 0:
                remaining += 20
            joint = joint_types[side]
            self.create_side_panel_with_cut(
                remaining, wall_thickness, joint, panel_length, face_info, position=side
            )
            return

        a, b = self.split_length_pair(remaining)
        # Left needs 母, right needs 公 — second cut may reuse leftover from first.
        self.create_side_panel_with_cut(
            a, wall_thickness, joint_types['left'], panel_length, face_info, position='left'
        )
        self.create_side_panel_with_cut(
            b, wall_thickness, joint_types['right'], panel_length, face_info, position='right'
        )


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
        cut_slashes = get_wall_end_cut_slashes(wall, walls, intersections)
        calc.calculate_panels(wall_length(wall), wall['thickness'], joints, height, face_info, cut_slashes)
    return calc


def count_45_cut_ends(wall, intersections):
    joints = get_wall_joint_types(wall, intersections)
    return (1 if joints['left'] == '45_cut' else 0) + (1 if joints['right'] == '45_cut' else 0)


def has_mixed_joints(wall, intersections):
    joints = get_wall_joint_types(wall, intersections)
    return joints['left'] != joints['right']


def get_optimization_score(calc):
    leftover_area = sum(
        max(lo.get('longer_face') or 0, lo.get('shorter_face') or 0) * (lo.get('panelLength') or 0)
        for lo in calc.leftovers
    )
    usable_leftover_count = sum(
        1 for lo in calc.leftovers
        if (lo.get('longer_face') or 0) >= 50 and (lo.get('shorter_face') or 0) >= 50
    )
    return {
        'fullPanelsUsedForCutting': calc.full_panels_used_for_cutting,
        'leftoverReused': calc.leftover_reused,
        'leftoverArea': leftover_area,
        'usableLeftoverCount': usable_leftover_count,
        'totalPanels': calc.full_panels_used_for_cutting + calc.leftover_reused,
    }


def compare_scores(a, b):
    """Lower is better — same priority as wallPanelOptimizer.js."""
    if a is None and b is None:
        return 0
    if a is None:
        return 1
    if b is None:
        return -1
    if a['fullPanelsUsedForCutting'] != b['fullPanelsUsedForCutting']:
        return a['fullPanelsUsedForCutting'] - b['fullPanelsUsedForCutting']
    if a['leftoverReused'] != b['leftoverReused']:
        return b['leftoverReused'] - a['leftoverReused']
    if a['leftoverArea'] != b['leftoverArea']:
        return a['leftoverArea'] - b['leftoverArea']
    if a['usableLeftoverCount'] != b['usableLeftoverCount']:
        return a['usableLeftoverCount'] - b['usableLeftoverCount']
    return a['totalPanels'] - b['totalPanels']


def _order_key(order):
    return tuple(w['id'] for w in order)


def _seed_orders(walls, intersections):
    seeds = []
    seen = set()

    def push(order):
        key = _order_key(order)
        if key in seen:
            return
        seen.add(key)
        seeds.append(list(order))

    push(walls)
    push(list(reversed(walls)))
    push(sorted(walls, key=lambda w: wall_length(w), reverse=True))
    push(sorted(walls, key=wall_length))
    push(sorted(walls, key=lambda w: count_45_cut_ends(w, intersections), reverse=True))
    push(sorted(
        walls,
        key=lambda w: (
            int(has_mixed_joints(w, intersections)),
            count_45_cut_ends(w, intersections),
        ),
        reverse=True,
    ))
    return seeds, seen


def optimize_wall_panel_calculation(walls, intersections, random_samples=2000):
    """
    Find the best wall processing order for leftover reuse.
    Mirrors frontend wallPanelOptimizer.js (exhaustive ≤8 walls).
    """
    valid = [
        w for w in (walls or [])
        if w and isinstance(w.get('start_x'), (int, float)) and isinstance(w.get('end_y'), (int, float))
    ]
    if not valid:
        return {
            'calc': None,
            'wallOrder': [],
            'score': None,
            'combinationsTested': 0,
            'optimizationMode': 'none',
        }
    if len(valid) == 1:
        calc = run_project(valid, intersections, valid)
        return {
            'calc': calc,
            'wallOrder': [valid[0]['id']],
            'score': get_optimization_score(calc),
            'combinationsTested': 1,
            'optimizationMode': 'single_wall',
        }

    from itertools import permutations
    import random

    if len(valid) <= 8:
        orders = [list(p) for p in permutations(valid)]
        mode = 'exhaustive'
    else:
        orders, seen = _seed_orders(valid, intersections)
        for _ in range(random_samples):
            shuffled = valid[:]
            random.shuffle(shuffled)
            key = _order_key(shuffled)
            if key in seen:
                continue
            seen.add(key)
            orders.append(shuffled)
        mode = 'heuristic'

    best_calc = None
    best_order = None
    best_score = None
    for order in orders:
        calc = run_project(valid, intersections, order)
        score = get_optimization_score(calc)
        if best_score is None or compare_scores(score, best_score) < 0:
            best_calc = calc
            best_order = [w['id'] for w in order]
            best_score = score

    return {
        'calc': best_calc,
        'wallOrder': best_order,
        'score': best_score,
        'combinationsTested': len(orders),
        'optimizationMode': mode,
    }


def main():
    project_id = int(sys.argv[1]) if len(sys.argv) > 1 else 520
    project = Project.objects.get(pk=project_id)
    walls = [serialize_wall(w) for w in Wall.objects.filter(project_id=project.id)]
    joints = list(Intersection.objects.filter(project_id=project.id))
    intersections = merge_joints(find_intersections(Wall.objects.filter(project_id=project.id)), joints)

    opt = optimize_wall_panel_calculation(walls, intersections)
    calc = opt['calc']
    by_id = {w['id']: w for w in walls}
    ordered_walls = [by_id[i] for i in opt['wallOrder'] if i in by_id]

    widths = Counter(round(lo['longer_face']) for lo in calc.leftovers)
    heights = Counter(lo['panelLength'] for lo in calc.leftovers)
    thicknesses = Counter(lo['wallThickness'] for lo in calc.leftovers)
    edges = Counter(f"{lo['leftEdgeType']}/{lo['rightEdgeType']}" for lo in calc.leftovers)

    lengths = Counter(wall_length(w) for w in walls)
    walls_needing_cut = sum(1 for w in walls if wall_length(w) % MAX_PANEL_WIDTH != 0)

    # Why leftovers don't match later walls
    needed_cuts = []
    for wall in ordered_walls:
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
        'optimizationMode': opt['optimizationMode'],
        'combinationsTested': opt['combinationsTested'],
        'wallOrder': opt['wallOrder'],
        'score': opt['score'],
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
