# Wall Application Types
WALL_APPLICATION_TYPES = [
    ('wall', 'Wall'),
    ('partition', 'Partition'),
]

# Room Floor Types
ROOM_FLOOR_TYPES = [
    ('Slab', 'Slab'),
    ('Panel', 'Panel'),
    ('None', 'None'),
]

# Room Floor Thickness Options (in mm)
ROOM_FLOOR_THICKNESS_CHOICES = [
    (50, '50 mm'),
    (75, '75 mm'),
    (100, '100 mm'),
    (125, '125 mm'),
    (150, '150 mm'),
    (175, '175 mm'),
    (200, '200 mm'),
]

# Door Types
DOOR_TYPES = [
    ('swing', 'Swing Door'),
    ('slide', 'Slide Door'),
]

# Door Configurations
DOOR_CONFIGURATIONS = [
    ('single_sided', 'Single-Sided'),
    ('double_sided', 'Double-Sided'),
]

# Door Sides
DOOR_SIDES = [
    ('interior', 'Interior'),
    ('exterior', 'Exterior'),
]

# Door Swing Directions
DOOR_SWING_DIRECTIONS = [
    ('left', 'Left'),
    ('right', 'Right'),
]

# Door Slide Directions
DOOR_SLIDE_DIRECTIONS = [
    ('left', 'Left'),
    ('right', 'Right'),
]

# Wall Joining Methods
WALL_JOINING_METHODS = [
    ('butt_in', 'Butt-in'),
    ('45_cut', '45° Cut'),
]

# Default Values
DEFAULT_WALL_THICKNESS = 200.0  # mm
DEFAULT_WALL_HEIGHT = 1000.0    # mm
DEFAULT_DOOR_SIDE = 'interior'
DEFAULT_DOOR_SWING_DIRECTION = 'right'
DEFAULT_DOOR_SLIDE_DIRECTION = 'right'
DEFAULT_DOOR_TYPE = 'swing'
DEFAULT_DOOR_CONFIGURATION = 'single_sided'
DEFAULT_ROOM_FLOOR_TYPE = 'None' 