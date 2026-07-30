"""Trace panel calculation for 10000x5000 room with correct 公/母 by wall position.

Rules:
- Full panel factory ends: left = 公, right = 母
- Full panels on a wall chain: 公-母-公-母-... so wall left end = 公, wall right end = 母
- Left side panel mates with leftmost full panel's 公 → needs 母 → cut from RIGHT of stock
- Right side panel mates with rightmost full panel's 母 → needs 公 → cut from LEFT of stock
- Leftover with both ends consumed (no 公/母) cannot be reused
"""
import math
from collections import Counter

MAX_PANEL_WIDTH = 1150
WALL_THICKNESS = 100
HEIGHT = 3000

walls = [
    {'id': 1, 'name': 'Bottom', 'start_x': 0, 'start_y': 0, 'end_x': 10000, 'end_y': 0,
     'height': HEIGHT, 'thickness': WALL_THICKNESS},
    {'id': 2, 'name': 'Right', 'start_x': 10000, 'start_y': 0, 'end_x': 10000, 'end_y': 5000,
     'height': HEIGHT, 'thickness': WALL_THICKNESS},
    {'id': 3, 'name': 'Top', 'start_x': 10000, 'start_y': 5000, 'end_x': 0, 'end_y': 5000,
     'height': HEIGHT, 'thickness': WALL_THICKNESS},
    {'id': 4, 'name': 'Left', 'start_x': 0, 'start_y': 5000, 'end_x': 0, 'end_y': 0,
     'height': HEIGHT, 'thickness': WALL_THICKNESS},
]

corners = [(0, 0), (10000, 0), (10000, 5000), (0, 5000)]
intersections = []
for x, y in corners:
    pairs = []
    for w in walls:
        at = (w['start_x'] == x and w['start_y'] == y) or (w['end_x'] == x and w['end_y'] == y)
        if not at:
            continue
        for w2 in walls:
            if w2['id'] == w['id']:
                continue
            at2 = (w2['start_x'] == x and w2['start_y'] == y) or (w2['end_x'] == x and w2['end_y'] == y)
            if at2:
                pairs.append({
                    'wall1': {'id': min(w['id'], w2['id'])},
                    'wall2': {'id': max(w['id'], w2['id'])},
                    'joining_method': '45_cut',
                })
    intersections.append({'x': x, 'y': y, 'pairs': pairs})

FACE_INFO = {
    'innerFaceMaterial': 'PPGI',
    'innerFaceThickness': 0.5,
    'outerFaceMaterial': 'PPGI',
    'outerFaceThickness': 0.5,
}


def wall_length(w):
    return round(math.hypot(w['end_x'] - w['start_x'], w['end_y'] - w['start_y']))


def get_wall_joint_types(wall, intersections):
    left_joint = right_joint = 'butt_in'
    is_h = abs(wall['end_y'] - wall['start_y']) < abs(wall['end_x'] - wall['start_x'])
    l2r = wall['end_x'] > wall['start_x']
    b2t = wall['end_y'] > wall['start_y']
    left_ends, right_ends = [], []
    for inter in intersections:
        for pair in inter.get('pairs', []):
            w1 = pair.get('wall1', {}).get('id')
            w2 = pair.get('wall2', {}).get('id')
            if wall['id'] not in (w1, w2):
                continue
            m = pair.get('joining_method') or 'butt_in'
            if is_h:
                if l2r:
                    if inter['x'] == wall['start_x']:
                        left_ends.append(m)
                    elif inter['x'] == wall['end_x']:
                        right_ends.append(m)
                else:
                    if inter['x'] == wall['start_x']:
                        right_ends.append(m)
                    elif inter['x'] == wall['end_x']:
                        left_ends.append(m)
            elif b2t:
                if inter['y'] == wall['start_y']:
                    left_ends.append(m)
                elif inter['y'] == wall['end_y']:
                    right_ends.append(m)
            else:
                if inter['y'] == wall['start_y']:
                    right_ends.append(m)
                elif inter['y'] == wall['end_y']:
                    left_ends.append(m)
    if '45_cut' in left_ends:
        left_joint = '45_cut'
    if '45_cut' in right_ends:
        right_joint = '45_cut'
    return {'left': left_joint, 'right': right_joint}


class TracedCalculator:
    def __init__(self):
        self.leftovers = []
        self.log = []
        self.wall_results = []
        self._next_id = 1
        self.full_panels_used_for_cutting = 0
        self.leftover_reused = 0

    def cleanup_leftovers(self):
        self.leftovers = [
            lo for lo in self.leftovers
            if lo['longer_face'] > 0 and lo['shorter_face'] > 0
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
            return True
        return (
            leftover.get('innerFaceMaterial') == face_info.get('outerFaceMaterial')
            and leftover.get('innerFaceThickness') == face_info.get('outerFaceThickness')
            and leftover.get('outerFaceMaterial') == face_info.get('innerFaceMaterial')
            and leftover.get('outerFaceThickness') == face_info.get('innerFaceThickness')
        )

    def wall_allows_side_flip(self, face_info):
        return (
            face_info.get('innerFaceMaterial') is not None
            and face_info.get('innerFaceMaterial') == face_info.get('outerFaceMaterial')
            and face_info.get('innerFaceThickness') == face_info.get('outerFaceThickness')
        )

    def choose_side_panel_position(self, remaining, wall_thickness, joints, panel_length, face_info, default_side):
        if joints['left'] != joints['right'] or not self.wall_allows_side_flip(face_info):
            return default_side
        left_match = self.find_compatible_leftover(
            remaining, wall_thickness, joints['left'], panel_length, face_info, position='left'
        )
        right_match = self.find_compatible_leftover(
            remaining, wall_thickness, joints['right'], panel_length, face_info, position='right'
        )
        if right_match and not left_match:
            return 'right'
        if left_match and not right_match:
            return 'left'
        return default_side

    def find_compatible_leftover(self, needed_width, wall_thickness, joint_type, panel_length, face_info, end_index=None, position=None):
        end = len(self.leftovers) if end_index is None else end_index
        needs_mother = position == 'left'
        needs_male = position == 'right'
        for leftover in self.leftovers[:end]:
            if leftover['wallThickness'] != wall_thickness:
                continue
            if leftover['panelLength'] < panel_length:
                continue
            if not self.faces_match_with_optional_flip(leftover, face_info):
                continue
            if needs_mother and leftover.get('rightJointConsumed'):
                continue
            if needs_male and leftover.get('leftJointConsumed'):
                continue
            if joint_type == '45_cut':
                if leftover['longer_face'] < needed_width:
                    continue
                return leftover
            if leftover.get('rightEdgeType') == 'straight' and leftover['shorter_face'] >= needed_width:
                return leftover
        return None

    def update_leftover_after_cut(self, leftover, cut_width, wall_thickness, joint_type, position=None):
        if position == 'left':
            leftover['rightJointConsumed'] = True
        elif position == 'right':
            leftover['leftJointConsumed'] = True
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

    def create_side_panel_with_cut(self, width, wall_thickness, joint_type, panel_length, face_info, end_index=None, position=None):
        width = round(width)
        factory_needed = '母' if position == 'left' else '公'
        cut_from = 'RIGHT of stock' if position == 'left' else 'LEFT of stock'
        compatible = self.find_compatible_leftover(
            width, wall_thickness, joint_type, panel_length, face_info, end_index, position
        )
        if compatible:
            self.leftover_reused += 1
            self.log.append(
                f'  REUSE leftover #{compatible["id"]} for {width}mm {position} side '
                f'(needs {factory_needed}, cut from {cut_from}, corner={joint_type})'
            )
            self.update_leftover_after_cut(compatible, width, wall_thickness, joint_type, position)
            return {
                'type': 'side (reused)',
                'width': width,
                'joint': joint_type,
                'position': position,
                'factory': factory_needed,
                'from_leftover': compatible['id'],
            }

        self.full_panels_used_for_cutting += 1
        needs_mother = position == 'left'
        needs_male = position == 'right'
        leftover = {
            'id': self._next_id,
            'wallThickness': wall_thickness,
            'leftEdgeType': '45_cut' if joint_type == '45_cut' else 'straight',
            'rightEdgeType': 'straight',
            'panelLength': panel_length,
            'leftJointConsumed': needs_male,
            'rightJointConsumed': needs_mother,
            **face_info,
        }
        self._next_id += 1
        if joint_type == '45_cut':
            leftover['longer_face'] = MAX_PANEL_WIDTH - width + wall_thickness
            leftover['shorter_face'] = leftover['longer_face'] - wall_thickness
        else:
            leftover['longer_face'] = MAX_PANEL_WIDTH - width
            leftover['shorter_face'] = leftover['longer_face']
        self.leftovers.append(leftover)

        kept = '公' if needs_mother else '母'
        self.log.append(
            f'  NEW full panel: take {width}mm {position} side needing {factory_needed} '
            f'(cut from {cut_from}, corner={joint_type}) '
            f'-> leftover #{leftover["id"]}: {leftover["longer_face"]}mm still has {kept} '
            f'(公_consumed={leftover["leftJointConsumed"]}, 母_consumed={leftover["rightJointConsumed"]})'
        )
        return {
            'type': 'side (new cut)',
            'width': width,
            'joint': joint_type,
            'position': position,
            'factory': factory_needed,
        }

    def calculate_wall(self, wall, intersections):
        length = wall_length(wall)
        joints = get_wall_joint_types(wall, intersections)
        panel_length = wall['height']
        wall_thickness = wall['thickness']
        threshold = 600 if panel_length < 5000 else 1000
        min_panel_width = 300 if panel_length < 5000 else 500

        self.log.append(f'\n=== Wall: {wall["name"]} ({length}mm) corner joints={joints} ===')
        panels = []
        remaining = length
        full_count = remaining // MAX_PANEL_WIDTH
        remaining -= full_count * MAX_PANEL_WIDTH

        for i in range(full_count):
            panels.append({'type': 'full', 'width': MAX_PANEL_WIDTH, 'index': i + 1})

        if full_count > 0:
            self.log.append(
                f'  {full_count} full panels chained: '
                f'[公]panel1[母]-[公]panel2[母]-...-[公]panel{full_count}[母]'
            )
            self.log.append(
                f'  Wall full-run ends: LEFT={{"公"}}, RIGHT={{"母"}} | remaining after fulls = {remaining}mm'
            )

        if remaining <= 0:
            self.wall_results.append({'wall': wall['name'], 'length': length, 'joints': joints, 'panels': panels})
            return panels

        if remaining < min_panel_width and full_count > 0:
            total = MAX_PANEL_WIDTH + remaining
            a, b = self.split_length_pair(total)
            self.log.append(f'  Remaining < {min_panel_width}mm: split last full + remainder -> {a}+{b}mm')
            panels.append(self.create_side_panel_with_cut(a, wall_thickness, joints['left'], panel_length, FACE_INFO, None, 'left'))
            panels.append(self.create_side_panel_with_cut(b, wall_thickness, joints['right'], panel_length, FACE_INFO, None, 'right'))
        elif remaining <= threshold:
            side = 'left' if joints['left'] == '45_cut' else 'right'
            tentative = remaining + 20 if full_count > 0 else remaining
            chosen = self.choose_side_panel_position(
                tentative, wall_thickness, joints, panel_length, FACE_INFO, side
            )
            if chosen != side:
                self.log.append(
                    f'  Face flip allowed (same material both sides): move SP from {side} to {chosen} '
                    f'to reuse leftover needing {"公" if chosen == "right" else "母"}'
                )
            side = chosen
            if full_count > 0:
                panels[-1 if side == 'left' else 0]['width'] = 1130
                panels[-1 if side == 'left' else 0]['actualWidth'] = 1130
                remaining += 20
                self.log.append(
                    f'  rem <= {threshold}mm: 1130 optimization on opposite end, '
                    f'single side panel = {remaining}mm on {side}'
                )
            joint = joints[side]
            panels.append(self.create_side_panel_with_cut(remaining, wall_thickness, joint, panel_length, FACE_INFO, None, side))
        else:
            a, b = self.split_length_pair(remaining)
            self.log.append(
                f'  rem > {threshold}mm: split into left {a}mm (needs 母) + right {b}mm (needs 公)'
            )
            self.log.append('  Prefer 1 full panel for both: left takes 母, right reuses leftover 公')
            panels.append(self.create_side_panel_with_cut(a, wall_thickness, joints['left'], panel_length, FACE_INFO, None, 'left'))
            panels.append(self.create_side_panel_with_cut(b, wall_thickness, joints['right'], panel_length, FACE_INFO, None, 'right'))

        self.wall_results.append({'wall': wall['name'], 'length': length, 'joints': joints, 'panels': panels})
        return panels


def main():
    calc = TracedCalculator()
    for wall in walls:
        calc.calculate_wall(wall, intersections)

    print('ROOM: 10000 x 5000, height 3000mm, wall thickness 100mm')
    print('Faces: PPGI both sides | All corner joints: 45_cut')
    print('Factory rule: full panel left=公, right=母; 公 clips into 母')
    print('WALL ORDER: Bottom -> Right -> Top -> Left')
    print('\n--- CALCULATION PROCESS ---')
    print('\n'.join(calc.log))

    print('\n--- PANELS PER WALL ---')
    all_panels = []
    for wr in calc.wall_results:
        parts = []
        for p in wr['panels']:
            w = p.get('actualWidth', p.get('width'))
            if p['type'] == 'full':
                label = f'full {w}mm [公..母]'
            else:
                label = f'{p["type"]} {w}mm ({p["position"]}, needs {p["factory"]}, corner {p["joint"]})'
            parts.append(label)
            all_panels.append({**p, 'wall': wr['wall'], 'actual_width': w})
        print(f'{wr["wall"]} ({wr["length"]}mm):')
        print(f'  {" | ".join(parts)}')

    print('\n--- TOTAL PANEL SUMMARY ---')
    counts = Counter()
    for p in all_panels:
        key = (p['type'], p['actual_width'], p.get('factory'), p.get('position'))
        counts[key] += 1
    for (ptype, width, factory, position), qty in sorted(counts.items(), key=lambda x: (-x[1], x[0][1])):
        extra = f', {position} needs {factory}' if factory else ', 公..母'
        print(f'  {qty}x {ptype} @ {width}mm x {HEIGHT}mm{extra}')

    print(f'\nTotal panels installed: {len(all_panels)}')
    print(f'New full panels cut for side pieces: {calc.full_panels_used_for_cutting}')
    print(f'Leftover reused: {calc.leftover_reused}')
    print(f'Total stock full panels: {sum(1 for p in all_panels if p["type"] == "full") + calc.full_panels_used_for_cutting}')

    print('\n--- LEFTOVER POOL ---')
    print(f'Count: {len(calc.leftovers)}')
    for lo in calc.leftovers:
        has_gong = not lo['leftJointConsumed']
        has_mu = not lo['rightJointConsumed']
        status = []
        if has_gong:
            status.append('still has 公')
        if has_mu:
            status.append('still has 母')
        if not has_gong and not has_mu:
            status.append('NO factory joint (scrap)')
        print(
            f'  #{lo["id"]}: {lo["longer_face"]}mm x {lo["panelLength"]}mm | '
            f'公_consumed={lo["leftJointConsumed"]}, 母_consumed={lo["rightJointConsumed"]} | '
            f'{", ".join(status)}'
        )


if __name__ == '__main__':
    main()
