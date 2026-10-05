from django.test import TestCase
from .models import Project, Wall, Room

class RoomModelTest(TestCase):
    def setUp(self):
        # Setup test data
        self.project = Project.objects.create(name="Sample Project", width=500, length=500, height=300)
        self.wall1 = Wall.objects.create(project=self.project, start_x=0, start_y=0, end_x=0, end_y=100)
        self.wall2 = Wall.objects.create(project=self.project, start_x=0, start_y=100, end_x=100, end_y=100)
        self.room = Room.objects.create(project=self.project, room_name="Test Room", floor_type="Wood", floor_thickness=12.5)

    def test_room_creation(self):
        # Test room creation
        self.assertEqual(self.room.room_name, "Test Room")
        self.assertEqual(self.room.floor_type, "Wood")
        self.assertEqual(float(self.room.floor_thickness), 12.5)
        self.assertEqual(self.room.project, self.project)

    def test_add_wall_to_room(self):
        # Test adding walls to a room
        self.room.walls.add(self.wall1, self.wall2)
        self.assertEqual(self.room.walls.count(), 2)

# API Tests
from rest_framework.test import APIClient
from rest_framework import status

class RoomViewSetTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.project = Project.objects.create(name="Sample Project", width=500, length=500, height=300)
        self.room_data = {
            'project': self.project.id,
            'room_name': 'Test Room',
            'floor_type': 'Wood',
            'floor_thickness': '12.5'
        }

    def test_create_room(self):
        response = self.client.post('/rooms/', self.room_data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['room_name'], 'Test Room')

    def test_get_room(self):
        # Assume room_id is 1
        response = self.client.get('/rooms/1/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['room_name'], 'Test Room')


class RoomSpecificCeilingConfigTest(TestCase):
    """Editing one room must not rewrite every other room to the global ceiling settings."""

    def setUp(self):
        from .models import CeilingPanel, CeilingPlan

        self.project = Project.objects.create(name="Ceiling Config", width=20000, length=20000, height=3000)
        self.room_a = Room.objects.create(
            project=self.project,
            room_name="Room A",
            floor_type="None",
            floor_thickness=100,
            room_points=[
                {'x': 0, 'y': 0},
                {'x': 3000, 'y': 0},
                {'x': 3000, 'y': 3000},
                {'x': 0, 'y': 3000},
            ],
        )
        self.room_b = Room.objects.create(
            project=self.project,
            room_name="Room B",
            floor_type="None",
            floor_thickness=100,
            room_points=[
                {'x': 5000, 'y': 0},
                {'x': 9000, 'y': 0},
                {'x': 9000, 'y': 4000},
                {'x': 5000, 'y': 4000},
            ],
        )
        CeilingPlan.objects.create(
            room=self.room_a,
            total_area=1,
            ceiling_thickness=150,
            orientation_strategy='all_vertical',
            panel_width=1150,
            panel_length='auto',
        )
        CeilingPlan.objects.create(
            room=self.room_b,
            total_area=1,
            ceiling_thickness=80,
            orientation_strategy='all_horizontal',
            panel_width=600,
            panel_length='5000',
            custom_panel_length=5000,
            support_type='alu',
            support_config={'enableAluSuspension': True},
        )
        CeilingPanel.objects.create(
            room=self.room_b,
            panel_id='B-OLD',
            start_x=5000,
            start_y=0,
            end_x=5600,
            end_y=4000,
            width=600,
            length=4000,
            thickness=999,
            inner_face_material='S/Steel',
            inner_face_thickness=0.8,
            outer_face_material='PVC',
            outer_face_thickness=1.0,
        )

    def test_editing_one_room_keeps_other_room_configuration(self):
        from .models import CeilingPanel, CeilingPlan
        from .services import CeilingService

        result = CeilingService.generate_enhanced_ceiling_plan(
            self.project.id,
            orientation_strategy='auto',
            panel_width=1150,
            panel_length='auto',
            ceiling_thickness=150,
            custom_panel_length=None,
            room_specific_config={
                'room_id': self.room_a.id,
                'panel_width': 900,
                'panel_length': 4000,
                'custom_panel_length': 4000,
                'ceiling_thickness': 200,
                'orientation_strategy': 'all_horizontal',
                'support_type': 'nylon',
                'support_config': {'enableNylonHangers': True},
                'inner_face_material': 'PPGI',
                'inner_face_thickness': 0.5,
                'outer_face_material': 'PPGI',
                'outer_face_thickness': 0.5,
            },
        )

        self.assertNotIn('error', result)

        plan_a = CeilingPlan.objects.get(room=self.room_a)
        self.assertEqual(plan_a.ceiling_thickness, 200)
        self.assertEqual(plan_a.panel_width, 900)
        self.assertEqual(plan_a.orientation_strategy, 'all_horizontal')

        plan_b = CeilingPlan.objects.get(room=self.room_b)
        self.assertEqual(plan_b.ceiling_thickness, 80)
        self.assertEqual(plan_b.panel_width, 600)
        self.assertEqual(plan_b.panel_length, '5000')
        self.assertEqual(plan_b.custom_panel_length, 5000)
        self.assertEqual(plan_b.orientation_strategy, 'all_horizontal')
        self.assertEqual(plan_b.support_type, 'alu')

        room_b_panels = list(CeilingPanel.objects.filter(room=self.room_b))
        self.assertTrue(room_b_panels)
        self.assertTrue(all(panel.thickness == 80 for panel in room_b_panels))
        # Horizontal strips use the saved 600mm panel width, not the global 1150mm.
        self.assertTrue(all(panel.length <= 600 for panel in room_b_panels))
        self.assertTrue(any(panel.length == 600 for panel in room_b_panels))
        self.assertEqual(room_b_panels[0].inner_face_material, 'S/Steel')
        self.assertEqual(room_b_panels[0].outer_face_material, 'PVC')
        self.assertFalse(CeilingPanel.objects.filter(room=self.room_b, panel_id='B-OLD').exists())
