#!/usr/bin/env python3
"""
Test script to analyze all rooms in the project dataset
"""

# All rooms from the project
rooms = [
    {
        "id": 233,
        "name": "PRODUCTION ROOM",
        "room_points": [
            {"x": 6000.0, "y": 0.0},
            {"x": 45315.0, "y": 0.0},
            {"x": 45315.0, "y": 10250.0},
            {"x": 53265.0, "y": 10250.0},
            {"x": 53265.0, "y": 20750.0},
            {"x": 6000.0, "y": 20750.0}
        ]
    },
    {
        "id": 234,
        "name": "ASRS 1",
        "room_points": [
            {"x": 0.0, "y": 20750.0},
            {"x": 31189.0, "y": 20750.0},
            {"x": 31189.0, "y": 53807.0},
            {"x": 19702.0, "y": 53807.0},
            {"x": 19702.0, "y": 52219.0},
            {"x": 11953.0, "y": 52219.0},
            {"x": 11953.0, "y": 53807.0},
            {"x": 0.0, "y": 53807.0}
        ]
    },
    {
        "id": 235,
        "name": "ANTE ROOM 2",
        "room_points": [
            {"x": 43059.0, "y": 20750.0},
            {"x": 50808.0, "y": 20750.0},
            {"x": 50808.0, "y": 22336.0},
            {"x": 43059.0, "y": 22336.0}
        ]
    },
    {
        "id": 232,
        "name": "ASRS 2",
        "room_points": [
            {"x": 31189.0, "y": 20750.0},
            {"x": 43059.0, "y": 20750.0},
            {"x": 43059.0, "y": 22336.0},
            {"x": 50808.0, "y": 22336.0},
            {"x": 50808.0, "y": 20750.0},
            {"x": 62378.0, "y": 20750.0},
            {"x": 62378.0, "y": 53807.0},
            {"x": 50847.0, "y": 53807.0},
            {"x": 50847.0, "y": 52222.0},
            {"x": 43142.0, "y": 52222.0},
            {"x": 43142.0, "y": 53807.0},
            {"x": 31189.0, "y": 53807.0}
        ]
    }
]

def calculate_polygon_area(points):
    """Calculate polygon area using shoelace formula"""
    n = len(points)
    if n < 3:
        return 0
    area = 0
    for i in range(n):
        j = (i + 1) % n
        area += points[i][0] * points[j][1]
        area -= points[j][0] * points[i][1]
    return abs(area) / 2

def count_concave_corners(points):
    """Count concave (inner) corners"""
    try:
        if len(points) < 3:
            return 0
        concave_count = 0
        n = len(points)
        for i in range(n):
            prev_i = (i - 1) % n
            next_i = (i + 1) % n
            v1 = (points[prev_i][0] - points[i][0], points[prev_i][1] - points[i][1])
            v2 = (points[next_i][0] - points[i][0], points[next_i][1] - points[i][1])
            cross_product = v1[0] * v2[1] - v1[1] * v2[0]
            if abs(cross_product) > 1e-6:
                signed_area = 0
                for j in range(n):
                    k = (j + 1) % n
                    signed_area += (points[j][0] * points[k][1] - points[k][0] * points[j][1])
                is_concave = (signed_area > 0 and cross_product < 0) or (signed_area < 0 and cross_product > 0)
                if is_concave:
                    concave_count += 1
        return concave_count
    except:
        return 0

def classify_room_shape(points):
    """Classify room shape: Rectangle, L, U, H, or Complex"""
    point_tuples = [(p['x'], p['y']) for p in points]
    n = len(point_tuples)
    
    if n == 4:
        # Check if it's a rectangle
        x_coords = [p[0] for p in point_tuples]
        y_coords = [p[1] for p in point_tuples]
        min_x, max_x = min(x_coords), max(x_coords)
        min_y, max_y = min(y_coords), max(y_coords)
        bbox_area = (max_x - min_x) * (max_y - min_y)
        actual_area = calculate_polygon_area(point_tuples)
        if abs(bbox_area - actual_area) < 100:  # Very close to rectangle
            return "Rectangle"
    
    concave_count = count_concave_corners(point_tuples)
    
    if concave_count == 0:
        return "Rectangle" if n == 4 else "Simple"
    elif concave_count == 1:
        return "L"
    elif concave_count == 2:
        return "U"
    elif concave_count == 3:
        return "H"
    else:
        return "Complex"

def main():
    print("="*80)
    print("COMPREHENSIVE ROOM SHAPE ANALYSIS - ALL ROOMS IN PROJECT")
    print("="*80)
    
    for room in rooms:
        print(f"\n{'='*80}")
        print(f"Room {room['id']}: {room['name']}")
        print(f"{'='*80}")
        
        points = room['room_points']
        point_tuples = [(p['x'], p['y']) for p in points]
        
        x_coords = [p[0] for p in point_tuples]
        y_coords = [p[1] for p in point_tuples]
        min_x, max_x = min(x_coords), max(x_coords)
        min_y, max_y = min(y_coords), max(y_coords)
        
        bbox_area = (max_x - min_x) * (max_y - min_y)
        actual_area = calculate_polygon_area(point_tuples)
        area_ratio = actual_area / bbox_area if bbox_area > 0 else 0
        concave_count = count_concave_corners(point_tuples)
        shape_type = classify_room_shape(points)
        
        print(f"  Points: {len(points)}")
        print(f"  Bounding Box: {min_x:.1f} to {max_x:.1f} (width: {max_x - min_x:.1f} mm)")
        print(f"                {min_y:.1f} to {max_y:.1f} (height: {max_y - min_y:.1f} mm)")
        print(f"  Bounding Box Area: {bbox_area:,.0f} mm²")
        print(f"  Actual Area: {actual_area:,.0f} mm²")
        print(f"  Area Ratio: {area_ratio:.4f} ({area_ratio*100:.2f}%)")
        print(f"  Concave Corners: {concave_count}")
        print(f"  Classified Shape: {shape_type}")
        
        if shape_type == "Rectangle":
            print(f"  [OK] Simple rectangular room")
        elif shape_type == "L":
            print(f"  [OK] L-shaped room detected")
        elif shape_type == "U":
            print(f"  [OK] U-shaped room detected")
        elif shape_type == "H":
            print(f"  [OK] H-shaped room detected")
        else:
            print(f"  [INFO] Complex room with {concave_count} concave corners")
    
    print(f"\n{'='*80}")
    print("SUMMARY")
    print(f"{'='*80}")
    print(f"Total Rooms: {len(rooms)}")
    for room in rooms:
        shape = classify_room_shape(room['room_points'])
        print(f"  Room {room['id']} ({room['name']}): {shape}")

if __name__ == "__main__":
    main()


