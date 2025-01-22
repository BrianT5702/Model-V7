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
