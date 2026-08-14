"""List wall-panel calculation for a project (check sheet)."""
import math
import os
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, 'scripts'))

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'model_builder.settings')
import django  # noqa: E402

django.setup()

from leftover_analysis import (  # noqa: E402
    MAX_BOTH_ENDS_CUT_WIDTH,
    MAX_PANEL_WIDTH,
    PanelCalculatorPy,
    get_wall_end_cut_slashes,
    get_wall_joint_types,
    wall_length,
)
from export_project_calc_data import find_intersections, merge_joints, serialize_wall  # noqa: E402
from core.models import Intersection, Project, Wall  # noqa: E402


class ListingCalc(PanelCalculatorPy):
    def calculate_panels(self, length, wall_thickness, joint_types, panel_length, face_info, cut_slashes=None):
        self.current_cut_slashes = cut_slashes or {'left': None, 'right': None}
        length = round(length)
        remaining = length
        threshold = 600 if panel_length < 5000 else 1000
        min_panel_width = 300 if panel_length < 5000 else 500
        full_count = remaining // MAX_PANEL_WIDTH
        remaining -= full_count * MAX_PANEL_WIDTH
        panels = [
            {'type': 'full', 'width': MAX_PANEL_WIDTH, 'actualWidth': MAX_PANEL_WIDTH, 'fromLeftover': False}
            for _ in range(full_count)
        ]

        def record_cut(width, position, joint, both_ends=False):
            reused_before = self.leftover_reused
            cuts_before = self.full_panels_used_for_cutting
            if both_ends:
                self.create_both_ends_cut_panel(width, wall_thickness, joint_types, panel_length, face_info)
            else:
                self.create_side_panel_with_cut(
                    width, wall_thickness, joint, panel_length, face_info, position=position
                )
            return {
                'type': 'side',
                'width': round(width),
                'actualWidth': round(width),
                'position': position,
                'joint': joint if not both_ends else f"{joint_types['left']}+{joint_types['right']}",
                'bothEndsCut': both_ends,
                'fromLeftover': self.leftover_reused > reused_before,
                'newStock': self.full_panels_used_for_cutting > cuts_before,
            }

        if remaining <= 0:
            return panels

        if full_count == 0 and remaining <= MAX_BOTH_ENDS_CUT_WIDTH:
            panels.append(record_cut(remaining, 'center', None, both_ends=True))
            return panels

        if remaining < min_panel_width and full_count > 0:
            total = MAX_PANEL_WIDTH + remaining
            a, b = self.split_length_pair(total)
            panels.pop()
            panels.append(record_cut(a, 'left', joint_types['left']))
            panels.append(record_cut(b, 'right', joint_types['right']))
            return panels

        if remaining <= threshold:
            side = 'left' if joint_types['left'] == '45_cut' else 'right'
            tentative = remaining + 20 if full_count > 0 else remaining
            side = self.choose_side_panel_position(
                tentative, wall_thickness, joint_types, panel_length, face_info, side
            )
            if full_count > 0:
                idx = -1 if side == 'left' else 0
                panels[idx]['actualWidth'] = MAX_PANEL_WIDTH - 20
                panels[idx]['opt1130'] = True
                remaining += 20
            panels.append(record_cut(remaining, side, joint_types[side]))
            return panels

        a, b = self.split_length_pair(remaining)
        panels.append(record_cut(a, 'left', joint_types['left']))
        panels.append(record_cut(b, 'right', joint_types['right']))
        return panels


def panel_label(p):
    w = p.get('actualWidth') or p['width']
    if p['type'] == 'full':
        note = ' (1130 opt)' if p.get('opt1130') else ''
        return f'FULL {w}{note}'
    src = 'reuse leftover' if p.get('fromLeftover') else 'new stock cut'
    if p.get('bothEndsCut'):
        return f'SINGLE {w} both-ends-cut [{src}]'
    pos = p.get('position') or '?'
    joint = p.get('joint') or ''
    need = 'needs MU' if pos == 'left' else 'needs GONG' if pos == 'right' else ''
    return f'SP {w} {pos} {need} {joint} [{src}]'.strip()


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else 'UPS/0726/20970/C/R1'
    qs = Project.objects.filter(name__icontains=name).order_by('-id')
    if not qs.exists():
        qs = Project.objects.filter(name__icontains='20970/C').order_by('-id')
    if not qs.exists():
        print('Project not found. Nearby:')
        for p in Project.objects.order_by('-id')[:20]:
            print(f'  id={p.id} {p.name}')
        return

    project = qs.first()
    walls_qs = list(Wall.objects.filter(project_id=project.id).order_by('id'))
    walls = [serialize_wall(w) for w in walls_qs]
    joints = list(Intersection.objects.filter(project_id=project.id))
    intersections = merge_joints(find_intersections(walls_qs), joints)

    calc = ListingCalc()
    by_id = {w['id']: w for w in walls}
    saved = getattr(project, 'panel_optimization', None) or {}
    saved_order = saved.get('wallOrder') if isinstance(saved, dict) else None
    if saved_order and len(saved_order) == len(walls) and all(i in by_id for i in saved_order):
        ordered = [by_id[i] for i in saved_order]
        order_note = 'saved optimized wall order (what the app uses now)'
    else:
        ordered = walls
        order_note = 'wall id (default)'
    rows = []
    for wall in ordered:
        height = (
            wall['gap_fill_height']
            if wall.get('fill_gap_mode') and wall.get('gap_fill_height') is not None
            else wall['height']
        )
        face_info = {
            'innerFaceMaterial': wall.get('inner_face_material'),
            'innerFaceThickness': wall.get('inner_face_thickness'),
            'outerFaceMaterial': wall.get('outer_face_material'),
            'outerFaceThickness': wall.get('outer_face_thickness'),
        }
        joints_w = get_wall_joint_types(wall, intersections)
        slashes = get_wall_end_cut_slashes(wall, walls, intersections)
        length = wall_length(wall)
        panels = calc.calculate_panels(length, wall['thickness'], joints_w, height, face_info, slashes)
        cover = sum(p.get('actualWidth') or p['width'] for p in panels)
        rows.append({
            'wall': wall,
            'length': length,
            'height': height,
            'joints': joints_w,
            'slashes': slashes,
            'panels': panels,
            'cover': cover,
        })

    print('=' * 88)
    print(f'PROJECT  {project.name}  (id={project.id})')
    saved = getattr(project, 'panel_optimization', None)
    print(f'Walls: {len(walls)}   Joints: {len(joints)}')
    print(f'Order: {order_note}')
    if saved:
        print(f'Saved optimization present (old score panels={saved.get("score", {}).get("totalPanels")})')
    print(f'New stock cuts: {calc.full_panels_used_for_cutting}   Leftover reused: {calc.leftover_reused}')
    print(f'Leftovers remaining: {len(calc.leftovers)}')
    print('=' * 88)

    full_n = 0
    side_n = 0
    single_n = 0
    reuse_n = 0
    grouped = Counter()

    for i, row in enumerate(rows, 1):
        w = row['wall']
        j = row['joints']
        s = row['slashes']
        left_s = s.get('left') or '-'
        right_s = s.get('right') or '-'
        print()
        print(f'{i:02d}. Wall {w["id"]}  L={row["length"]}  H={row["height"]}  T={w["thickness"]}')
        print(
            f'    ({round(w["start_x"])},{round(w["start_y"])}) -> '
            f'({round(w["end_x"])},{round(w["end_y"])})'
        )
        print(
            f'    joints L={j["left"]} ({left_s})  R={j["right"]} ({right_s})'
            f'   faces {w.get("inner_face_material")}/{w.get("outer_face_material")}'
        )
        for p in row['panels']:
            print(f'      - {panel_label(p)}')
            aw = p.get('actualWidth') or p['width']
            h = row['height']
            t = w['thickness']
            kind = 'full' if p['type'] == 'full' else ('single' if p.get('bothEndsCut') else 'side')
            grouped[(kind, aw, h, t)] += 1
            if p['type'] == 'full':
                full_n += 1
            elif p.get('bothEndsCut'):
                single_n += 1
            else:
                side_n += 1
            if p.get('fromLeftover'):
                reuse_n += 1
        diff = row['length'] - row['cover']
        flag = '  OK' if diff == 0 else f'  LENGTH MISMATCH {diff:+d}mm'
        print(f'    cover {row["cover"]} / wall {row["length"]}{flag}')

    print()
    print('=' * 88)
    print('MATERIAL GROUP (type × width × height × thickness)')
    print('=' * 88)
    for (kind, aw, h, t), qty in sorted(grouped.items(), key=lambda x: (x[0][0], -x[0][1], -x[0][2], x[0][3])):
        print(f'  {qty:3d} ×  {kind:7s}  {aw:5d} × {int(h):5d} × {int(t):3d} mm')

    print()
    print(f'Totals: {full_n} full  +  {side_n} side  +  {single_n} short-wall single  = {full_n+side_n+single_n} panels')
    print(f'        {reuse_n} cut from leftover   {calc.full_panels_used_for_cutting} cut from new stock')

    print()
    print('=' * 88)
    print('LEFTOVERS AFTER ALL WALLS')
    print('=' * 88)
    if not calc.leftovers:
        print('  (none)')
    for n, lo in enumerate(calc.leftovers, 1):
        gong = 'GONG' if not lo.get('leftJointConsumed') else '-'
        mu = 'MU' if not lo.get('rightJointConsumed') else '-'
        use = []
        if gong == '公':
            use.append('Right SP')
        if mu == '母':
            use.append('Left SP')
        use.append('Short wall')
        print(
            f'  {n:02d}. LF={lo["longer_face"]:.0f}  SF={lo["shorter_face"]:.0f}  '
            f'H={lo["panelLength"]:.0f}  T={lo["wallThickness"]:.0f}  '
            f'factory {gong}/{mu}  usable: {", ".join(use)}'
        )


if __name__ == '__main__':
    main()
