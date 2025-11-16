#!/usr/bin/env python3
"""
Test the universal grid-based algorithm with all rooms
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

def is_point_in_polygon(x, y, polygon_points):
    """Check if a point is inside a polygon using ray casting algorithm"""
    n = len(polygon_points)
    inside = False
    p1x, p1y = polygon_points[0]['x'], polygon_points[0]['y']
    for i in range(n + 1):
        p2x, p2y = polygon_points[i % n]['x'], polygon_points[i % n]['y']
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    return inside

def create_universal_grid_regions(points, room_points_dict):
    """Simulate the universal grid-based region creation"""
    x_coords = [p[0] for p in points]
    y_coords = [p[1] for p in points]
    min_x, max_x = min(x_coords), max(x_coords)
    min_y, max_y = min(y_coords), max(y_coords)
    
    unique_x = sorted(set(x_coords))
    unique_y = sorted(set(y_coords))
    
    # Filter coordinates (1% threshold)
    significant_x = [unique_x[0]]
    for i in range(1, len(unique_x) - 1):
        if unique_x[i] - significant_x[-1] >= (max_x - min_x) * 0.01:
            significant_x.append(unique_x[i])
    significant_x.append(unique_x[-1])
    
    significant_y = [unique_y[0]]
    for i in range(1, len(unique_y) - 1):
        if unique_y[i] - significant_y[-1] >= (max_y - min_y) * 0.01:
            significant_y.append(unique_y[i])
    significant_y.append(unique_y[-1])
    
    regions = []
    for i in range(len(significant_x) - 1):
        for j in range(len(significant_y) - 1):
            cell_min_x = significant_x[i]
            cell_max_x = significant_x[i + 1]
            cell_min_y = significant_y[j]
            cell_max_y = significant_y[j + 1]
            
            test_points = [
                ((cell_min_x + cell_max_x) / 2, (cell_min_y + cell_max_y) / 2),
                (cell_min_x, cell_min_y),
                (cell_max_x, cell_min_y),
                (cell_max_x, cell_max_y),
                (cell_min_x, cell_max_y),
                ((cell_min_x + cell_max_x) / 2, cell_min_y),
                ((cell_min_x + cell_max_x) / 2, cell_max_y),
                (cell_min_x, (cell_min_y + cell_max_y) / 2),
                (cell_max_x, (cell_min_y + cell_max_y) / 2),
            ]
            
            # Check center and corners
            center_x = (cell_min_x + cell_max_x) / 2
            center_y = (cell_min_y + cell_max_y) / 2
            center_inside = is_point_in_polygon(center_x, center_y, room_points_dict)
            
            corners = [
                (cell_min_x, cell_min_y),
                (cell_max_x, cell_min_y),
                (cell_max_x, cell_max_y),
                (cell_min_x, cell_max_y)
            ]
            corners_inside = sum(1 for cx, cy in corners 
                                if is_point_in_polygon(cx, cy, room_points_dict))
            
            if center_inside or corners_inside >= 3:
                regions.append({
                    'min_x': cell_min_x,
                    'max_x': cell_max_x,
                    'min_y': cell_min_y,
                    'max_y': cell_max_y,
                    'width': cell_max_x - cell_min_x,
                    'height': cell_max_y - cell_min_y
                })
    
    return regions

def main():
    print("="*80)
    print("UNIVERSAL GRID-BASED ALGORITHM TEST - ALL ROOMS")
    print("="*80)
    
    all_passed = True
    
    for room in rooms:
        print(f"\n{'='*80}")
        print(f"Room {room['id']}: {room['name']}")
        print(f"{'='*80}")
        
        points = room['room_points']
        point_tuples = [(p['x'], p['y']) for p in points]
        
        # Calculate actual area
        actual_area = calculate_polygon_area(point_tuples)
        print(f"Actual Room Area: {actual_area:,.0f} mm²")
        
        # Create regions using universal grid approach
        regions = create_universal_grid_regions(point_tuples, points)
        print(f"Number of Regions Created: {len(regions)}")
        
        # Calculate total region area
        total_region_area = sum(r['width'] * r['height'] for r in regions)
        print(f"Total Region Area: {total_region_area:,.0f} mm²")
        
        # Check coverage
        coverage_ratio = total_region_area / actual_area if actual_area > 0 else 0
        difference = abs(total_region_area - actual_area)
        difference_percent = (difference / actual_area * 100) if actual_area > 0 else 0
        
        print(f"Coverage Ratio: {coverage_ratio:.4f} ({coverage_ratio*100:.2f}%)")
        print(f"Difference: {difference:,.0f} mm² ({difference_percent:.2f}%)")
        
        # Verify coverage is acceptable (within 5%)
        if 0.95 <= coverage_ratio <= 1.05:
            print(f"[OK] Coverage is acceptable (95-105%)")
        else:
            print(f"[ERROR] Coverage is outside acceptable range!")
            all_passed = False
        
        # Show region details
        if len(regions) <= 10:
            print(f"\nRegions:")
            for i, r in enumerate(regions, 1):
                print(f"  Region {i}: X={r['min_x']:.1f}-{r['max_x']:.1f}, Y={r['min_y']:.1f}-{r['max_y']:.1f}, Area={r['width']*r['height']:,.0f} mm²")
        else:
            print(f"\n[INFO] Too many regions ({len(regions)}) to display individually")
    
    print(f"\n{'='*80}")
    print("FINAL VERIFICATION")
    print(f"{'='*80}")
    if all_passed:
        print("[SUCCESS] All rooms passed coverage verification!")
    else:
        print("[FAILURE] Some rooms failed coverage verification!")
    print(f"{'='*80}")

if __name__ == "__main__":
    main()

