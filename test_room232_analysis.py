#!/usr/bin/env python3
"""
Test script to analyze room shape detection and ceiling plan generation
for ASRS 2 (room 232)
"""

# Room points for ASRS 2 (room 232)
room_points = [
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

def calculate_bounding_box(room_points):
    """Calculate bounding box"""
    x_coords = [p['x'] for p in room_points]
    y_coords = [p['y'] for p in room_points]
    
    return {
        'min_x': min(x_coords),
        'max_x': max(x_coords),
        'min_y': min(y_coords),
        'max_y': max(y_coords),
        'width': max(x_coords) - min(x_coords),
        'height': max(y_coords) - min(y_coords)
    }

def count_concave_corners(points):
    """Count concave (inner) corners in a polygon - indicates L-shape"""
    try:
        if len(points) < 3:
            return 0
        
        concave_count = 0
        n = len(points)
        
        for i in range(n):
            prev_i = (i - 1) % n
            next_i = (i + 1) % n
            
            # Get vectors
            v1 = (points[prev_i][0] - points[i][0], points[prev_i][1] - points[i][1])
            v2 = (points[next_i][0] - points[i][0], points[next_i][1] - points[i][1])
            
            # Calculate cross product to determine if corner is concave
            cross_product = v1[0] * v2[1] - v1[1] * v2[0]
            
            if abs(cross_product) > 1e-6:
                # Determine polygon orientation
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

def detect_l_shape(points):
    """Detect if room is L-shaped (same logic as improved CeilingService._detect_l_shape)"""
    if len(points) < 4:
        return False, 0, 0, 0
    
    # Convert to tuple format
    point_tuples = [(p['x'], p['y']) for p in points]
    
    # Method 1: Check for concave corners
    concave_corners = count_concave_corners(point_tuples)
    
    x_coords = [p[0] for p in point_tuples]
    y_coords = [p[1] for p in point_tuples]
    
    min_x, max_x = min(x_coords), max(x_coords)
    min_y, max_y = min(y_coords), max(y_coords)
    
    room_width = max_x - min_x
    room_height = max_y - min_y
    
    # Calculate bounding box area
    room_area = room_width * room_height
    if room_area == 0:
        return False, 0, 0, 0
    
    # Calculate actual polygon area using shoelace formula
    actual_area = calculate_polygon_area(point_tuples)
    area_ratio = actual_area / room_area
    
    # Method 1: Check for concave corners (inner corners indicate L-shape)
    if concave_corners > 0:
        return True, area_ratio, actual_area, room_area
    
    # Method 3: Check if polygon has more than 4 vertices and area ratio suggests non-rectangular
    if len(point_tuples) > 4 and area_ratio < 0.98:
        # Additional check: see if there's a significant "cutout" area
        missing_area = room_area - actual_area
        missing_ratio = missing_area / room_area
        # If more than 2% of bounding box is missing, it's likely L-shaped
        if missing_ratio > 0.02:
            return True, area_ratio, actual_area, room_area
    
    # Method 4: Original threshold for very obvious L-shapes
    is_l_shaped = area_ratio < 0.8
    
    return is_l_shaped, area_ratio, actual_area, room_area

def find_cutout_point(points):
    """Find the inner corner (cutout point) of L-shaped room"""
    point_tuples = [(p['x'], p['y']) for p in points]
    x_coords = [p[0] for p in point_tuples]
    y_coords = [p[1] for p in point_tuples]
    
    min_x, max_x = min(x_coords), max(x_coords)
    min_y, max_y = min(y_coords), max(y_coords)
    
    cutout_x = None
    cutout_y = None
    
    # Find the inner corner by looking for a point that's not at the extremes
    for point in point_tuples:
        x, y = point
        if (x != min_x and x != max_x and 
            y != min_y and y != max_y):
            if cutout_x is None or (x > cutout_x and y > cutout_y):
                cutout_x = x
                cutout_y = y
    
    return cutout_x, cutout_y

def visualize_room_shape(points):
    """Visualize the room shape"""
    print("\n" + "="*80)
    print("ROOM SHAPE VISUALIZATION")
    print("="*80)
    
    # Find bounds
    x_coords = [p['x'] for p in points]
    y_coords = [p['y'] for p in points]
    min_x, max_x = min(x_coords), max(x_coords)
    min_y, max_y = min(y_coords), max(y_coords)
    
    print(f"\nRoom Points (in order):")
    for i, p in enumerate(points, 1):
        print(f"  Point {i}: ({p['x']:>8.1f}, {p['y']:>8.1f})")
    
    print(f"\nBounding Box:")
    print(f"  X: {min_x:.1f} to {max_x:.1f} (width: {max_x - min_x:.1f} mm)")
    print(f"  Y: {min_y:.1f} to {max_y:.1f} (height: {max_y - min_y:.1f} mm)")

def main():
    print("="*80)
    print("CEILING PLAN GENERATION ANALYSIS - ASRS 2 (Room 232)")
    print("="*80)
    
    # Calculate bounding box
    bounding_box = calculate_bounding_box(room_points)
    
    print(f"\n1. BOUNDING BOX CALCULATION:")
    print(f"   Min X: {bounding_box['min_x']:.1f} mm")
    print(f"   Max X: {bounding_box['max_x']:.1f} mm")
    print(f"   Min Y: {bounding_box['min_y']:.1f} mm")
    print(f"   Max Y: {bounding_box['max_y']:.1f} mm")
    print(f"   Width: {bounding_box['width']:.1f} mm")
    print(f"   Height: {bounding_box['height']:.1f} mm")
    print(f"   Bounding Box Area: {bounding_box['width'] * bounding_box['height']:,.0f} mm²")
    
    # Detect L-shape
    is_l_shaped, area_ratio, actual_area, bbox_area = detect_l_shape(room_points)
    
    print(f"\n2. L-SHAPE DETECTION:")
    print(f"   Actual Polygon Area: {actual_area:,.0f} mm²")
    print(f"   Bounding Box Area: {bbox_area:,.0f} mm²")
    print(f"   Area Ratio: {area_ratio:.4f} ({area_ratio*100:.2f}%)")
    print(f"   Number of Points: {len(room_points)}")
    print(f"   Concave Corners: {count_concave_corners([(p['x'], p['y']) for p in room_points])}")
    print(f"   Is L-Shaped? {is_l_shaped}")
    
    if is_l_shaped:
        print(f"   [OK] CORRECTLY DETECTED AS L-SHAPED")
    else:
        print(f"   [ERROR] INCORRECTLY DETECTED AS RECTANGULAR")
    
    # Find cutout point
    cutout_x, cutout_y = find_cutout_point(room_points)
    
    print(f"\n3. CUTOUT POINT (Inner Corner):")
    if cutout_x and cutout_y:
        print(f"   Cutout Point: ({cutout_x:.1f}, {cutout_y:.1f})")
        print(f"   This is the inner corner where the L-shape bends")
    else:
        print(f"   [WARNING] Could not find cutout point")
        print(f"   [INFO] This might be a U-shaped or more complex room")
    
    # Visualize
    visualize_room_shape(room_points)
    
    # Analyze expected regions - this is a complex room with multiple indentations
    print(f"\n4. EXPECTED REGION SPLIT:")
    print(f"   [INFO] This room has {count_concave_corners([(p['x'], p['y']) for p in room_points])} concave corners")
    print(f"   [INFO] The system will use a grid-based approach for complex rooms")
    print(f"   [INFO] Regions will be created based on significant X and Y coordinates")
    
    x_coords = [p['x'] for p in room_points]
    y_coords = [p['y'] for p in room_points]
    
    # Show significant coordinates that would be used
    x_values = sorted(set(x_coords))
    y_values = sorted(set(y_coords))
    min_x, max_x = min(x_coords), max(x_coords)
    min_y, max_y = min(y_coords), max(y_coords)
    
    print(f"\n   Significant X coordinates: {[f'{x:.0f}' for x in x_values]}")
    print(f"   Significant Y coordinates: {[f'{y:.0f}' for y in y_values]}")
    print(f"\n   [INFO] The grid-based approach will create regions for each")
    print(f"   [INFO] significant coordinate pair that is inside the room polygon")
    
    print(f"\n5. VERIFICATION SUMMARY:")
    print(f"   {'-' * 60}")
    if is_l_shaped:
        print(f"   [OK] Room shape detection: CORRECT (L-shaped detected)")
    else:
        print(f"   [ERROR] Room shape detection: INCORRECT (should be L-shaped)")
        print(f"   [INFO] Area ratio is {area_ratio:.4f} ({area_ratio*100:.2f}%)")
        print(f"   [INFO] The threshold may be too strict for this room shape")
    
    if cutout_x and cutout_y:
        print(f"   [OK] Cutout point found: ({cutout_x:.1f}, {cutout_y:.1f})")
    else:
        print(f"   [WARNING] Cutout point: NOT FOUND")
        print(f"   [INFO] This room has {len(room_points)} points - might be U-shaped or complex")
    
    print(f"   {'-' * 60}")
    print(f"\n" + "="*80)

if __name__ == "__main__":
    main()

