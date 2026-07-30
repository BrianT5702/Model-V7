"""Extract walls for project 'Test Updated Calculation' and run panel calc."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'model_builder.settings')

import django
django.setup()

from scripts.export_project_calc_data import find_intersections, merge_joints, serialize_wall
from scripts.leftover_analysis import (
    MAX_PANEL_WIDTH,
    PanelCalculatorPy,
    get_wall_end_cut_slashes,
    get_wall_joint_types,
    optimize_wall_panel_calculation,
    wall_length,
)
from core.models import Intersection, Project, Wall


class TracedCalculator(PanelCalculatorPy):
    def __init__(self):
        super().__init__()
        self.log = []
        self.wall_results = []

    def create_side_panel_with_cut(
        self, width, wall_thickness, joint_type, panel_length, face_info,
        leftover_search_end_index=None, position=None,
    ):
        width = round(width)
        factory = 'MU' if position == 'left' else 'GONG'
        needed_slash = self.current_cut_slashes.get(position) if joint_type == '45_cut' else None
        if joint_type == '45_cut' and needed_slash is None:
            needed_slash = '/'
        compatible = self.find_compatible_leftover(
            width, wall_thickness, joint_type, panel_length, face_info,
            leftover_search_end_index=leftover_search_end_index, position=position,
            needed_slash=needed_slash,
        )
        if compatible:
            self.leftover_reused += 1
            before = (
                compatible['longer_face'],
                compatible.get('leftJointConsumed'),
                compatible.get('rightJointConsumed'),
            )
            self.update_leftover_after_cut(
                compatible, width, wall_thickness, joint_type, position=position,
                needed_slash=needed_slash,
            )
            after = (
                compatible.get('longer_face'),
                compatible.get('leftJointConsumed'),
                compatible.get('rightJointConsumed'),
            )
            self.log.append(
                f'  REUSE LO#{compatible["id"]} for {width}mm {position} '
                f'(needs {factory}, corner={joint_type}, slash={needed_slash}) '
                f'before_longer/gong/mu={before} after={after}'
            )
            return {
                'type': 'side-reused',
                'width': width,
                'position': position,
                'factory': factory,
                'joint': joint_type,
                'cutSlash': needed_slash,
                'from': compatible['id'],
            }

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
        kept = 'GONG' if needs_mother else 'MU'
        self.log.append(
            f'  NEW cut {width}mm {position} needs {factory} corner={joint_type} slash={needed_slash} '
            f'-> LO#{leftover["id"]} longer={leftover["longer_face"]} '
            f'shorter={leftover["shorter_face"]} still_has={kept}'
        )
        return {
            'type': 'side-new',
            'width': width,
            'position': position,
            'factory': factory,
            'joint': joint_type,
            'cutSlash': needed_slash,
        }

    def calculate_panels(self, length, wall_thickness, joint_types, panel_length, face_info, cut_slashes=None):
        self.current_cut_slashes = cut_slashes or {'left': None, 'right': None}
        length = round(length)
        remaining = length
        threshold = 600 if panel_length < 5000 else 1000
        min_panel_width = 300 if panel_length < 5000 else 500
        full_count = remaining // MAX_PANEL_WIDTH
        remaining -= full_count * MAX_PANEL_WIDTH
        panels = [{'type': 'full', 'width': MAX_PANEL_WIDTH} for _ in range(full_count)]
        self.log.append(f'  fulls={full_count} rem={remaining} threshold={threshold}')

        if remaining <= 0:
            self.wall_results.append(panels)
            return panels

        if remaining < min_panel_width and full_count > 0:
            total = MAX_PANEL_WIDTH + remaining
            a, b = self.split_length_pair(total)
            panels.pop()
            self.log.append(f'  rem < min: split last full+rem -> {a}+{b}')
            panels.append(self.create_side_panel_with_cut(
                a, wall_thickness, joint_types['left'], panel_length, face_info, position='left'
            ))
            panels.append(self.create_side_panel_with_cut(
                b, wall_thickness, joint_types['right'], panel_length, face_info, position='right'
            ))
        elif remaining <= threshold:
            side = 'left' if joint_types['left'] == '45_cut' else 'right'
            tentative = remaining + 20 if full_count > 0 else remaining
            chosen = self.choose_side_panel_position(
                tentative, wall_thickness, joint_types, panel_length, face_info, side
            )
            if chosen != side:
                self.log.append(
                    f'  flip/side opt: move SP {side} -> {chosen} '
                    f'(needs {"GONG" if chosen == "right" else "MU"})'
                )
            side = chosen
            if full_count > 0:
                idx = -1 if side == 'left' else 0
                panels[idx] = {'type': 'full', 'width': 1130, 'actualWidth': 1130}
                remaining += 20
                self.log.append(f'  1130 opt, SP={remaining}mm on {side}')
            panels.append(self.create_side_panel_with_cut(
                remaining, wall_thickness, joint_types[side], panel_length, face_info, position=side
            ))
        else:
            a, b = self.split_length_pair(remaining)
            self.log.append(f'  rem > threshold: left {a}(MU) + right {b}(GONG)')
            panels.append(self.create_side_panel_with_cut(
                a, wall_thickness, joint_types['left'], panel_length, face_info, position='left'
            ))
            panels.append(self.create_side_panel_with_cut(
                b, wall_thickness, joint_types['right'], panel_length, face_info, position='right'
            ))

        self.wall_results.append(panels)
        return panels


def main():
    project = Project.objects.get(name='Test Updated Calculation')
    walls_qs = Wall.objects.filter(project_id=project.id).order_by('id')
    walls = [serialize_wall(w) for w in walls_qs]
    joints = list(Intersection.objects.filter(project_id=project.id))
    intersections = merge_joints(find_intersections(walls_qs), joints)

    print('=' * 70)
    print(f'PROJECT: {project.id} | {project.name}')
    print(f'project.wall_thickness = {project.wall_thickness}')
    print(f'walls = {len(walls)} | joint records = {len(joints)}')
    print('=' * 70)

    print('\n--- WALL DATA ---')
    for w in walls:
        length = wall_length(w)
        height = (
            w['gap_fill_height']
            if w.get('fill_gap_mode') and w.get('gap_fill_height') is not None
            else w['height']
        )
        jtypes = get_wall_joint_types(w, intersections)
        print(json.dumps({
            'id': w['id'],
            'length_mm': length,
            'height_mm': height,
            'thickness_mm': w['thickness'],
            'start': [w['start_x'], w['start_y']],
            'end': [w['end_x'], w['end_y']],
            'joints': jtypes,
            'inner_face': [w.get('inner_face_material'), w.get('inner_face_thickness')],
            'outer_face': [w.get('outer_face_material'), w.get('outer_face_thickness')],
            'fill_gap_mode': w.get('fill_gap_mode'),
        }, ensure_ascii=False))

    print('\n--- INTERSECTIONS / JOINING METHODS ---')
    for inter in intersections:
        for pair in inter.get('pairs', []):
            print(json.dumps({
                'point': [inter.get('x'), inter.get('y')],
                'wall1': pair.get('wall1', {}).get('id'),
                'wall2': pair.get('wall2', {}).get('id'),
                'joining_method': pair.get('joining_method'),
            }))

    opt = optimize_wall_panel_calculation(walls, intersections)
    by_id = {w['id']: w for w in walls}
    ordered_walls = [by_id[wid] for wid in opt['wallOrder'] if wid in by_id]

    calc = TracedCalculator()
    print('\n--- CALCULATION (optimized wall order) ---')
    print(f"mode={opt['optimizationMode']} tested={opt['combinationsTested']}")
    print(f"bestOrder={opt['wallOrder']}")
    print(f"score={opt['score']}")
    for w in ordered_walls:
        length = wall_length(w)
        height = (
            w['gap_fill_height']
            if w.get('fill_gap_mode') and w.get('gap_fill_height') is not None
            else w['height']
        )
        face_info = {
            'innerFaceMaterial': w.get('inner_face_material'),
            'innerFaceThickness': w.get('inner_face_thickness'),
            'outerFaceMaterial': w.get('outer_face_material'),
            'outerFaceThickness': w.get('outer_face_thickness'),
        }
        jtypes = get_wall_joint_types(w, intersections)
        cut_slashes = get_wall_end_cut_slashes(w, walls, intersections)
        print(f"\nWall id={w['id']} L={length} H={height} T={w['thickness']} joints={jtypes} slashes={cut_slashes}")
        calc.calculate_panels(length, w['thickness'], jtypes, height, face_info, cut_slashes)
        for line in calc.log:
            print(line)
        calc.log.clear()
        panels = calc.wall_results[-1]
        parts = []
        for p in panels:
            if p['type'] == 'full':
                width = p.get('actualWidth', p['width'])
                parts.append(f'full {width}')
            else:
                parts.append(
                    f"{p['type']} {p['width']}({p['position']}/{p['factory']})"
                )
        print('  SEQUENCE:', ' | '.join(parts))

    print('\n--- SUMMARY ---')
    print(f'newStockCutsForSides: {calc.full_panels_used_for_cutting}')
    print(f'leftoverReused: {calc.leftover_reused}')
    print(f'leftoverPoolCount: {len(calc.leftovers)}')
    installed = sum(len(wr) for wr in calc.wall_results)
    fulls_on_walls = sum(
        1 for wr in calc.wall_results for p in wr if p['type'] == 'full'
    )
    print(f'installedPanels: {installed}')
    print(f'fullPanelsOnWalls: {fulls_on_walls}')
    print(f'totalStockFullPanels: {fulls_on_walls + calc.full_panels_used_for_cutting}')
    print('\n--- LEFTOVER POOL (classified) ---')
    print(f'Count: {len(calc.leftovers)}')
    scrap = []
    reusable = []
    for lo in calc.leftovers:
        has_gong = not lo.get('leftJointConsumed')
        has_mu = not lo.get('rightJointConsumed')
        remaining_joints = []
        if has_gong:
            remaining_joints.append('公(GONG/left)')
        if has_mu:
            remaining_joints.append('母(MU/right)')

        if has_gong or has_mu:
            status = 'REUSABLE'
            usable_for = []
            if has_gong:
                usable_for.append('right side panel (needs 公)')
            if has_mu:
                usable_for.append('left side panel (needs 母)')
            entry = {
                'id': lo['id'],
                'status': status,
                'longer_face': lo['longer_face'],
                'shorter_face': lo['shorter_face'],
                'panelLength': lo['panelLength'],
                'factory_joint_remaining': remaining_joints,
                'usable_for': usable_for,
                'faces': f"{lo.get('innerFaceMaterial')}/{lo.get('outerFaceMaterial')}",
                'gong_consumed': lo.get('leftJointConsumed'),
                'mu_consumed': lo.get('rightJointConsumed'),
            }
            reusable.append(entry)
        else:
            status = 'SCRAP'
            entry = {
                'id': lo['id'],
                'status': status,
                'longer_face': lo['longer_face'],
                'shorter_face': lo['shorter_face'],
                'panelLength': lo['panelLength'],
                'factory_joint_remaining': [],
                'usable_for': [],
                'faces': f"{lo.get('innerFaceMaterial')}/{lo.get('outerFaceMaterial')}",
                'gong_consumed': lo.get('leftJointConsumed'),
                'mu_consumed': lo.get('rightJointConsumed'),
                'reason': 'Both 公 and 母 consumed — no factory joint left',
            }
            scrap.append(entry)

    print(f'\nREUSABLE leftovers: {len(reusable)}')
    for e in reusable:
        print(
            f"  LO#{e['id']} [{e['status']}] "
            f"size={e['longer_face']}/{e['shorter_face']} x {e['panelLength']}mm | "
            f"FACTORY JOINT REMAINING: {', '.join(e['factory_joint_remaining'])} | "
            f"usable for: {', '.join(e['usable_for'])} | "
            f"faces={e['faces']}"
        )

    print(f'\nSCRAP leftovers: {len(scrap)}')
    for e in scrap:
        print(
            f"  LO#{e['id']} [{e['status']}] "
            f"size={e['longer_face']}/{e['shorter_face']} x {e['panelLength']}mm | "
            f"FACTORY JOINT REMAINING: none | "
            f"{e['reason']} | faces={e['faces']}"
        )


if __name__ == '__main__':
    main()
