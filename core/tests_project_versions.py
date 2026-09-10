from django.contrib.auth.models import User
from django.test import TestCase

from core.models import Intersection, Project, ProjectComment, ProjectVersion, Room, Storey, Wall
from core.project_versions import (
    MAX_PROJECT_VERSIONS,
    build_version_preview,
    capture_original_edits_if_live_is_original,
    copy_project_version,
    create_project_version,
    delete_project_version,
    ensure_live_is_original,
    ensure_project_baseline,
    original_layout_snapshot,
    prepare_project_original_on_open,
    restore_project_version,
)
from core.role_utils import ROLE_ADMIN, ensure_user_profile


class ProjectVersionTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='drafter', password='pass')
        ensure_user_profile(self.user, ROLE_ADMIN)
        self.project = Project.objects.create(
            name='Versioned Store',
            width=10000,
            length=8000,
            height=3000,
            wall_thickness=100,
            created_by=self.user,
            last_edited_by=self.user,
        )
        self.storey = Storey.objects.create(
            project=self.project,
            name='Ground Floor',
            elevation_mm=0,
            default_room_height_mm=3000,
            order=0,
        )
        self.wall = Wall.objects.create(
            project=self.project,
            storey=self.storey,
            start_x=0,
            start_y=0,
            end_x=4000,
            end_y=0,
            is_default=False,
        )
        self.room = Room.objects.create(
            project=self.project,
            storey=self.storey,
            room_name='Cold Room',
            floor_type='Panel',
            floor_thickness=100,
        )
        self.room.walls.add(self.wall)
        ProjectComment.objects.create(
            project=self.project,
            author=self.user,
            body='Keep this comment',
        )

    def test_save_restore_keeps_comments_and_project_id(self):
        ensure_project_baseline(self.project)
        version = create_project_version(self.project, label='Walls complete', user=self.user)
        self.assertEqual(version.number, 1)
        self.assertEqual(version.label, 'Walls complete')

        live_wall = Wall.objects.get(project=self.project)
        live_wall.end_x = 9000
        live_wall.save()
        Room.objects.create(
            project=self.project,
            storey=Storey.objects.get(project=self.project),
            room_name='Extra Room',
            floor_type='Panel',
            floor_thickness=50,
        )

        restore_project_version(self.project, version, user=self.user)
        self.project.refresh_from_db()

        self.assertEqual(self.project.pk, version.project_id)
        self.assertEqual(self.project.name, 'Versioned Store')
        self.assertEqual(Wall.objects.filter(project=self.project).count(), 1)
        restored_wall = Wall.objects.get(project=self.project)
        self.assertEqual(restored_wall.end_x, 4000)
        self.assertEqual(Room.objects.filter(project=self.project).count(), 1)
        self.assertEqual(Room.objects.get(project=self.project).room_name, 'Cold Room')
        self.assertEqual(ProjectComment.objects.filter(project=self.project).count(), 1)
        self.assertEqual(ProjectComment.objects.get(project=self.project).body, 'Keep this comment')
        baseline_preview = build_version_preview(self.project, self.project.baseline_snapshot)
        self.assertEqual(baseline_preview['walls'][0]['end_x'], 4000)

    def test_save_version_leaves_original_unchanged(self):
        ensure_project_baseline(self.project)
        live_wall = Wall.objects.get(project=self.project)
        live_wall.end_x = 9000
        live_wall.save()
        Room.objects.create(
            project=self.project,
            storey=Storey.objects.get(project=self.project),
            room_name='Extra Room',
            floor_type='Panel',
            floor_thickness=50,
        )

        version = create_project_version(self.project, label='Option A', user=self.user)
        self.project.refresh_from_db()

        self.assertEqual(version.number, 1)
        self.assertEqual(Wall.objects.filter(project=self.project).count(), 1)
        original_wall = Wall.objects.get(project=self.project)
        self.assertEqual(original_wall.end_x, 4000)
        self.assertEqual(Room.objects.filter(project=self.project).count(), 1)
        self.assertEqual(Room.objects.get(project=self.project).room_name, 'Cold Room')

        preview = build_version_preview(self.project, version.snapshot)
        self.assertEqual(preview['walls'][0]['end_x'], 9000)
        self.assertEqual(len(preview['rooms']), 2)

        baseline_preview = build_version_preview(self.project, self.project.baseline_snapshot)
        self.assertEqual(baseline_preview['walls'][0]['end_x'], 4000)

    def test_wall_edit_freezes_original_before_save_version(self):
        Room.objects.filter(project=self.project).delete()
        self.project.baseline_snapshot = None
        self.project.save(update_fields=['baseline_snapshot'])
        live_wall = Wall.objects.get(project=self.project)

        live_wall.end_x = 9000
        live_wall.save()
        self.project.refresh_from_db()

        baseline_preview = build_version_preview(self.project, self.project.baseline_snapshot)
        self.assertEqual(baseline_preview['walls'][0]['end_x'], 4000)
        self.assertEqual(Wall.objects.get(project=self.project).end_x, 9000)

        version = create_project_version(self.project, label='After edit', user=self.user)
        self.project.refresh_from_db()

        self.assertEqual(version.number, 1)
        self.assertEqual(Wall.objects.get(project=self.project).end_x, 4000)
        self.assertEqual(build_version_preview(self.project, version.snapshot)['walls'][0]['end_x'], 9000)

    def test_copy_creates_new_project_without_comments(self):
        version = create_project_version(self.project, label='Milestone', user=self.user)
        copied = copy_project_version(self.project, version, user=self.user)

        self.assertNotEqual(copied.pk, self.project.pk)
        self.assertTrue(copied.hidden_from_list)
        self.assertTrue(copied.name.startswith('Versioned Store (v1'))
        self.assertEqual(Wall.objects.filter(project=copied).count(), 1)
        self.assertEqual(Room.objects.filter(project=copied).count(), 1)
        self.assertEqual(ProjectComment.objects.filter(project=copied).count(), 0)
        self.assertEqual(Project.objects.filter(pk=self.project.pk).count(), 1)

    def test_preview_uses_snapshot_layout_without_new_project(self):
        ensure_project_baseline(self.project)
        live_wall = Wall.objects.get(project=self.project)
        live_wall.end_x = 9000
        live_wall.save()
        version = create_project_version(self.project, label='Walls complete', user=self.user)

        preview = build_version_preview(self.project, version.snapshot)
        self.assertEqual(preview['project']['id'], self.project.pk)
        self.assertEqual(preview['project']['name'], 'Versioned Store')
        self.assertEqual(len(preview['walls']), 1)
        self.assertEqual(preview['walls'][0]['end_x'], 9000)
        self.assertEqual(Wall.objects.get(project=self.project).end_x, 4000)
        self.assertEqual(Project.objects.filter(hidden_from_list=False).count(), 1)

    def test_preview_includes_snapshot_ceiling_and_floor(self):
        from core.models import CeilingPanel, CeilingPlan, FloorPanel, FloorPlan

        ensure_project_baseline(self.project)
        CeilingPlan.objects.create(
            room=self.room,
            total_area=1000000,
            total_panels=1,
            full_panels=1,
            cut_panels=0,
            ceiling_thickness=150,
            orientation_strategy='horizontal',
            panel_width=1150,
        )
        CeilingPanel.objects.create(
            room=self.room,
            panel_id='C1',
            start_x=0,
            start_y=0,
            end_x=1150,
            end_y=4000,
            width=1150,
            length=4000,
        )
        FloorPlan.objects.create(
            room=self.room,
            total_area=1000000,
            total_panels=1,
            full_panels=1,
            cut_panels=0,
            orientation_strategy='vertical',
            panel_width=1150,
        )
        FloorPanel.objects.create(
            room=self.room,
            panel_id='F1',
            start_x=0,
            start_y=0,
            end_x=1150,
            end_y=3000,
            width=1150,
            length=3000,
        )
        version = create_project_version(self.project, label='Ceiling done', user=self.user)

        preview = build_version_preview(self.project, version.snapshot)
        room_preview = preview['rooms'][0]
        self.assertEqual(room_preview['ceiling_plan']['orientation_strategy'], 'horizontal')
        self.assertEqual(len(preview['ceiling_panels']), 1)
        self.assertEqual(preview['ceiling_panels'][0]['length'], 4000)
        self.assertEqual(preview['ceiling_panels'][0]['room_id'], self.room.pk)
        self.assertFalse(preview['ceiling_panels'][0]['is_cut'])
        self.assertEqual(room_preview['floor_plan']['orientation_strategy'], 'vertical')
        self.assertEqual(len(preview['floor_panels']), 1)
        self.assertEqual(preview['floor_panels'][0]['length'], 3000)

    def test_version_cap_keeps_latest(self):
        for index in range(MAX_PROJECT_VERSIONS + 3):
            create_project_version(self.project, label=f'v{index}', user=self.user)

        numbers = list(
            ProjectVersion.objects.filter(project=self.project)
            .order_by('number')
            .values_list('number', flat=True)
        )
        self.assertEqual(len(numbers), MAX_PROJECT_VERSIONS)
        self.assertEqual(numbers[0], 4)
        self.assertEqual(numbers[-1], MAX_PROJECT_VERSIONS + 3)

    def test_delete_version_leaves_original(self):
        ensure_project_baseline(self.project)
        live_wall = Wall.objects.get(project=self.project)
        live_wall.end_x = 9000
        live_wall.save()
        version = create_project_version(self.project, label='Option A', user=self.user)
        original_end = Wall.objects.get(project=self.project).end_x

        delete_project_version(self.project, version)
        self.project.refresh_from_db()

        self.assertFalse(ProjectVersion.objects.filter(pk=version.pk).exists())
        self.assertEqual(Wall.objects.get(project=self.project).end_x, original_end)
        self.assertEqual(original_end, 4000)
        self.assertIsNotNone(self.project.baseline_snapshot)

    def test_open_shows_original_when_live_diverged(self):
        ensure_project_baseline(self.project)
        live_wall = Wall.objects.get(project=self.project)
        live_wall.end_x = 9000
        live_wall.save()
        create_project_version(self.project, label='Option A', user=self.user)

        live_wall = Wall.objects.get(project=self.project)
        live_wall.end_x = 7000
        live_wall.save()

        ensure_live_is_original(self.project)
        self.assertEqual(Wall.objects.get(project=self.project).end_x, 4000)
        self.assertEqual(ProjectVersion.objects.filter(project=self.project).count(), 1)

    def test_open_without_versions_keeps_frozen_original(self):
        ensure_project_baseline(self.project)
        live_wall = Wall.objects.get(project=self.project)
        live_wall.end_x = 9000
        live_wall.save()

        prepare_project_original_on_open(self.project)
        self.project.refresh_from_db()

        preview = build_version_preview(self.project, self.project.baseline_snapshot)
        self.assertEqual(preview['walls'][0]['end_x'], 4000)
        self.assertEqual(Wall.objects.get(project=self.project).end_x, 9000)

    def test_restore_then_edit_leaves_original(self):
        ensure_project_baseline(self.project)
        live_wall = Wall.objects.get(project=self.project)
        live_wall.end_x = 9000
        live_wall.save()
        version_one = create_project_version(self.project, label='Option A', user=self.user)
        self.assertEqual(Wall.objects.get(project=self.project).end_x, 4000)

        restore_project_version(self.project, version_one, user=self.user)
        restored_wall = Wall.objects.get(project=self.project)
        self.assertEqual(restored_wall.end_x, 9000)
        self.project.refresh_from_db()
        baseline_preview = build_version_preview(self.project, self.project.baseline_snapshot)
        self.assertEqual(baseline_preview['walls'][0]['end_x'], 4000)

        restored_wall.end_x = 11000
        restored_wall.save()
        version_two = create_project_version(self.project, label='Option B', user=self.user)
        self.project.refresh_from_db()

        self.assertEqual(version_two.number, 2)
        self.assertEqual(Wall.objects.get(project=self.project).end_x, 4000)
        self.assertEqual(
            build_version_preview(self.project, version_one.snapshot)['walls'][0]['end_x'],
            9000,
        )
        self.assertEqual(
            build_version_preview(self.project, version_two.snapshot)['walls'][0]['end_x'],
            11000,
        )
        self.assertEqual(
            build_version_preview(self.project, self.project.baseline_snapshot)['walls'][0]['end_x'],
            4000,
        )

        prepare_project_original_on_open(self.project)
        self.assertEqual(Wall.objects.get(project=self.project).end_x, 4000)

    def test_ensure_after_restore_does_not_replace_original(self):
        ensure_project_baseline(self.project)
        live_wall = Wall.objects.get(project=self.project)
        live_wall.end_x = 9000
        live_wall.save()
        version_one = create_project_version(self.project, label='Option A', user=self.user)

        restore_project_version(self.project, version_one, user=self.user)
        ensure_project_baseline(self.project)
        self.project.refresh_from_db()

        self.assertEqual(Wall.objects.get(project=self.project).end_x, 9000)
        self.assertEqual(
            build_version_preview(self.project, self.project.baseline_snapshot)['walls'][0]['end_x'],
            4000,
        )

    def test_corrupted_baseline_recovers_original_on_open(self):
        ensure_project_baseline(self.project)
        live_wall = Wall.objects.get(project=self.project)
        live_wall.end_x = 9000
        live_wall.save()
        version_one = create_project_version(self.project, label='Option A', user=self.user)
        restore_project_version(self.project, version_one, user=self.user)
        restored_wall = Wall.objects.get(project=self.project)
        restored_wall.end_x = 11000
        restored_wall.save()
        version_two = create_project_version(self.project, label='Option B', user=self.user)
        version_two.refresh_from_db()

        self.project.baseline_snapshot = version_two.snapshot
        self.project.save(update_fields=['baseline_snapshot'])

        prepare_project_original_on_open(self.project)
        self.project.refresh_from_db()

        self.assertEqual(Wall.objects.get(project=self.project).end_x, 4000)
        self.assertEqual(
            build_version_preview(self.project, self.project.baseline_snapshot)['walls'][0]['end_x'],
            4000,
        )

    def test_open_with_versions_always_restores_original(self):
        ensure_project_baseline(self.project)
        live_wall = Wall.objects.get(project=self.project)
        live_wall.end_x = 9000
        live_wall.save()
        create_project_version(self.project, label='Option A', user=self.user)

        live_wall = Wall.objects.get(project=self.project)
        live_wall.end_x = 7000
        live_wall.save()

        prepare_project_original_on_open(self.project)
        self.assertEqual(Wall.objects.get(project=self.project).end_x, 4000)

    def test_original_preview_uses_frozen_layout(self):
        ensure_project_baseline(self.project)
        live_wall = Wall.objects.get(project=self.project)
        live_wall.end_x = 9000
        live_wall.save()
        create_project_version(self.project, label='Option A', user=self.user)

        preview = build_version_preview(self.project, original_layout_snapshot(self.project))
        self.assertEqual(preview['walls'][0]['end_x'], 4000)
        self.assertEqual(Wall.objects.get(project=self.project).end_x, 4000)

    def test_joint_edit_on_original_survives_restore_roundtrip(self):
        wall_b = Wall.objects.create(
            project=self.project,
            storey=self.storey,
            start_x=4000,
            start_y=0,
            end_x=4000,
            end_y=3000,
            is_default=False,
        )
        Intersection.objects.create(
            project=self.project,
            wall_1=self.wall,
            wall_2=wall_b,
            joining_method='none',
        )
        ensure_project_baseline(self.project)

        live_wall = Wall.objects.get(pk=self.wall.pk)
        live_wall.end_x = 9000
        live_wall.save()
        version_one = create_project_version(self.project, label='Longer wall', user=self.user)

        joint = Intersection.objects.get(project=self.project)
        joint.joining_method = '45_cut'
        joint.save()
        capture_original_edits_if_live_is_original(self.project)

        restore_project_version(self.project, version_one, user=self.user)
        self.assertEqual(Intersection.objects.get(project=self.project).joining_method, 'none')

        ensure_live_is_original(self.project)
        self.project.refresh_from_db()
        self.assertEqual(Intersection.objects.get(project=self.project).joining_method, '45_cut')
        preview = build_version_preview(self.project, original_layout_snapshot(self.project))
        self.assertEqual(preview['intersections'][0]['joining_method'], '45_cut')
