// Utility functions for mesh creation in Three.js
// Note: CSG operations are handled via vertex manipulation instead of three-csg-ts

// Calculate intersection point between two line segments
// If allowExtended is true, returns intersection even if outside segments (for extension)
function calculateLineIntersection(x1, y1, x2, y2, x3, y3, x4, y4, allowExtended = false) {
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denominator) < 1e-10) {
    // Lines are parallel or coincident
    return null;
  }
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denominator;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denominator;
  // Calculate intersection point
  const intersectionX = x1 + t * (x2 - x1);
  const intersectionZ = y1 + t * (y2 - y1);
  // If allowExtended, return intersection even if outside segments
  if (allowExtended) {
    return {
      x: intersectionX,
      z: intersectionZ,
      t, // Parameter for first line (0 = start, 1 = end, <0 or >1 = extended)
      u  // Parameter for second line
    };
  }
  // Check if intersection is within both line segments
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: intersectionX,
      z: intersectionZ,
      t,
      u
    };
  }
  return null;
}

export function createWallMesh(instance, wall) {
  // ALWAYS LOG FIRST - This verifies function is called in 3D
  console.log(`[3D Wall Mesh] Creating mesh for Wall ${wall.id}`, {
    wallId: wall.id,
    hasInstance: !!instance,
    hasJoints: !!instance.joints,
    jointsCount: instance.joints?.length || 0,
    hasWalls: !!instance.walls,
    wallsCount: instance.walls?.length || 0
  });

  // The full logic from instance.createWallMesh(wall), using 'instance' for context
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position, windows } = wall;
  const scale = instance.scalingFactor;
  const modelCenter = instance.calculateModelCenter();
  // Snap endpoints to a fixed precision to avoid floating point misalignment
  function snap(val, precision = 0.01) {
    return Math.round(val / precision) * precision;
  }
  let startX = snap(start_x * scale);
  let startZ = snap(start_y * scale);
  let endX = snap(end_x * scale);
  let endZ = snap(end_y * scale);
  // Store original coordinates BEFORE any modifications for tracking extension distances
  const originalStartX = startX;
  const originalStartZ = startZ;
  const originalEndX = endX;
  const originalEndZ = endZ;
  // Calculate the wall's midpoint
  const wallMidX = (startX + endX) / 2;
  const wallMidZ = (startZ + endZ) / 2;
  // Calculate the direction to the model center
  const toCenterX = (modelCenter.x * scale) - wallMidX;
  const toCenterZ = (modelCenter.z * scale) - wallMidZ;

  // Determine if the wall is horizontal, vertical, or diagonal
  const isHorizontal = Math.abs(start_y - end_y) < 1e-6;
  const isVertical = Math.abs(start_x - end_x) < 1e-6;
  // Compute a consistent inward-facing normal based on model center
  // Use the wall direction and choose the perpendicular that points toward model center
  let finalNormX = 0;
  let finalNormZ = 0;
  {
    // Temporary direction using original (pre-flip) coordinates; will be recalculated after any flip as well
    const dirX0 = endX - startX;
    const dirZ0 = endZ - startZ;
    const len0 = Math.hypot(dirX0, dirZ0) || 1;
    const ux0 = dirX0 / len0;
    const uz0 = dirZ0 / len0;
    // Two perpendiculars; pick the one pointing toward model center
    let nx0 = -uz0;
    let nz0 = ux0;
    const dot0 = nx0 * toCenterX + nz0 * toCenterZ;
    if (dot0 < 0) {
      nx0 = -nx0;
      nz0 = -nz0;
    }
    finalNormX = nx0;
    finalNormZ = nz0;
  }
  // Wall thickness positioning logic will be handled here
  // (Joint flipping logic removed for now)

  const wallDoors = instance.doors.filter(d => String(d.wall) === String(id));
  const wallWindows = windows || [];
  // Determine wall height and base position based on gap-fill mode
  let basePositionY = 0;  // Default: floor level
  let wallHeight;
  if (fill_gap_mode && gap_fill_height !== null && gap_base_position !== null) {
    // Gap-fill mode: position wall at gap base, use gap height
    basePositionY = gap_base_position * scale;
    wallHeight = gap_fill_height * scale;
  } else {
    // Normal mode: determine base elevation based on whether it was manually set
    // Use room or wall base elevation directly (absolute values), don't add storey elevation
    // since rooms on the new level might have different elevations
    let wallBaseElevation = 0;
    
    // If base_elevation_manual is true, use wall's base_elevation_mm (manually set, absolute value)
    // Otherwise, use the minimum base_elevation_mm from rooms containing this wall (absolute value)
    if (wall.base_elevation_manual) {
      // Use manually set wall base elevation (absolute value)
      wallBaseElevation = wall.base_elevation_mm ?? 0;
      console.log(`[Wall ${id}] Using wall.base_elevation_mm=${wallBaseElevation}mm (MANUAL - absolute value)`);
    } else {
      // Use room base elevation (minimum of all rooms containing this wall, absolute value)
      const roomsContainingWall = [];
      
      // Get rooms from instance.project.rooms that contain this wall
      if (instance.project && instance.project.rooms) {
        instance.project.rooms.forEach(room => {
          const roomWalls = Array.isArray(room.walls) ? room.walls : [];
          // Check if room.walls contains this wall ID (handle both ID arrays and object arrays)
          const hasWall = roomWalls.some(w => {
            const wallId = typeof w === 'object' ? w.id : w;
            return String(wallId) === String(id);
          });
          
          if (hasWall) {
            roomsContainingWall.push(room);
          }
        });
      }
      
      // Get minimum base_elevation_mm from rooms containing this wall
      if (roomsContainingWall.length > 0) {
        const roomBaseElevations = roomsContainingWall
          .map(room => room.base_elevation_mm)
          .filter(elev => elev !== undefined && elev !== null)
          .map(elev => Number(elev) || 0);
        
        if (roomBaseElevations.length > 0) {
          wallBaseElevation = Math.min(...roomBaseElevations);
          console.log(`[Wall ${id}] Using room base_elevation=${wallBaseElevation}mm (AUTO - minimum from ${roomsContainingWall.length} room(s), absolute value)`);
        } else {
          // Fallback to wall's base_elevation_mm if no room base elevations found
          wallBaseElevation = wall.base_elevation_mm ?? 0;
          console.log(`[Wall ${id}] Fallback to wall.base_elevation_mm=${wallBaseElevation}mm (no room elevations found)`);
        }
      } else {
        // No rooms found, fallback to wall's base_elevation_mm
        wallBaseElevation = wall.base_elevation_mm ?? 0;
        console.log(`[Wall ${id}] Fallback to wall.base_elevation_mm=${wallBaseElevation}mm (no rooms found)`);
      }
    }
    
    // basePositionY is the Y position for the bottom of the wall in 3D space
    // The wall shape is bottom-aligned (Y=0 to Y=wallHeight in local coords)
    // Door holes are created as part of the wall mesh, so they automatically follow the wall's base position
    basePositionY = wallBaseElevation * scale;
    wallHeight = height * scale;
  }
  const wallThickness = thickness * scale;
  // Flip start/end coordinates based on model center position
  let finalStartX = startX;
  let finalStartZ = startZ;
  let finalEndX = endX;
  let finalEndZ = endZ;
  // Apply model center logic for wall orientation
  if (isHorizontal) {
    // For horizontal walls: if model center is at < Z position, flip start X with end X
    if (modelCenter.z * scale < startZ) {
      finalStartX = endX;
      finalEndX = startX;
    }
  } else if (isVertical) {
    // For vertical walls: if model center is at > X position, flip start Y with end Y
    if (modelCenter.x * scale > startX) {
      finalStartZ = endZ;
      finalEndZ = startZ;
    }
  }
  // Recompute inward normal using final coordinates and final midpoint
  {
    const dirX = finalEndX - finalStartX;
    const dirZ = finalEndZ - finalStartZ;
    const len = Math.hypot(dirX, dirZ) || 1;
    const ux = dirX / len;
    const uz = dirZ / len;
    let nx = -uz;
    let nz = ux;
    const midX = (finalStartX + finalEndX) / 2;
    const midZ = (finalStartZ + finalEndZ) / 2;
    const toCenterX2 = (modelCenter.x * scale) - midX;
    const toCenterZ2 = (modelCenter.z * scale) - midZ;
    const dot = nx * toCenterX2 + nz * toCenterZ2;
    if (dot < 0) {
      nx = -nx;
      nz = -nz;
    }
    finalNormX = nx;
    finalNormZ = nz;
  }
  // STEP 1: Extend perpendicular walls to surfaces BEFORE applying joint cuts
  // Simple logic: only extend if walls are perpendicular and not already touching
  if (instance.joints && instance.joints.length > 0) {
    instance.walls.forEach(otherWall => {
      if (String(otherWall.id) === String(id)) return;
      // Check if there's a joint between these walls
      const joint = instance.joints.find(j => 
        (j.wall_1 === id && j.wall_2 === otherWall.id) ||
        (j.wall_2 === id && j.wall_1 === otherWall.id)
      );
      if (!joint) return; // No joint, skip
      // Get other wall coordinates
      const oSX = snap(otherWall.start_x * scale);
      const oSZ = snap(otherWall.start_y * scale);
      const oEX = snap(otherWall.end_x * scale);
      const oEZ = snap(otherWall.end_y * scale);
      const otherThickness = otherWall.thickness * scale;
      // Check if walls are perpendicular
      const otherIsHorizontal = Math.abs(otherWall.start_y - otherWall.end_y) < 1e-6;
      const otherIsVertical = Math.abs(otherWall.start_x - otherWall.end_x) < 1e-6;
      // Calculate other wall's normal
      const otherMidX = (oSX + oEX) / 2;
      const otherMidZ = (oSZ + oEZ) / 2;
      const toOtherCenterX = (modelCenter.x * scale) - otherMidX;
      const toOtherCenterZ = (modelCenter.z * scale) - otherMidZ;
      let otherNormX, otherNormZ;
      if (otherIsHorizontal) {
        otherNormX = 0;
        otherNormZ = toOtherCenterZ < 0 ? -1 : 1;
      } else if (otherIsVertical) {
        otherNormX = toOtherCenterX < 0 ? -1 : 1;
        otherNormZ = 0;
      } else {
        return; // Not perpendicular, skip
      }
      // Calculate other wall's surfaces
      const otherOuterX = oSX; // For vertical wall, X is constant
      const otherOuterZ = oSZ; // For horizontal wall, Z is constant
      const otherInnerX = oSX + otherNormX * otherThickness;
      const otherInnerZ = oSZ + otherNormZ * otherThickness;
      // Case 1: This wall is horizontal, other wall is vertical
      if (isHorizontal && otherIsVertical) {
        const thisZ = finalStartZ;
        const otherX = oSX;
        const rightmostX = Math.max(otherOuterX, otherInnerX);
        const leftmostX = Math.min(otherOuterX, otherInnerX);
        // Check if vertical wall's Z range overlaps with horizontal wall's Z
        const otherMinZ = Math.min(oSZ, oEZ);
        const otherMaxZ = Math.max(oSZ, oEZ);
        if (thisZ < otherMinZ || thisZ > otherMaxZ) return; // No overlap
        // Determine which endpoint to extend - find which is rightmost and leftmost
        const rightEndpointX = Math.max(finalStartX, finalEndX);
        const leftEndpointX = Math.min(finalStartX, finalEndX);
        const thisCenterX = (finalStartX + finalEndX) / 2;
        if (otherX > thisCenterX) {
          // Vertical wall is on RIGHT - extend rightmost endpoint to rightmost surface
          if (rightEndpointX < rightmostX) {
            // Update whichever endpoint is the rightmost one
            if (finalEndX > finalStartX) {
              finalEndX = rightmostX;
            } else {
              finalStartX = rightmostX;
            }
          }
        } else {
          // Vertical wall is on LEFT - extend leftmost endpoint to leftmost surface
          if (leftEndpointX > leftmostX) {
            // Update whichever endpoint is the leftmost one
            if (finalStartX < finalEndX) {
              finalStartX = leftmostX;
            } else {
              finalEndX = leftmostX;
            }
          }
        }
      }
      // Case 2: This wall is vertical, other wall is horizontal
      else if (isVertical && otherIsHorizontal) {
        const thisX = finalStartX;
        const otherZ = oSZ;
        const topmostZ = Math.max(otherOuterZ, otherInnerZ);
        const bottommostZ = Math.min(otherOuterZ, otherInnerZ);
        // Check if horizontal wall's X range overlaps with vertical wall's X
        const otherMinX = Math.min(oSX, oEX);
        const otherMaxX = Math.max(oSX, oEX);
        if (thisX < otherMinX || thisX > otherMaxX) return; // No overlap
        // Determine which endpoint to extend - find which is topmost and bottommost
        const topEndpointZ = Math.max(finalStartZ, finalEndZ);
        const bottomEndpointZ = Math.min(finalStartZ, finalEndZ);
        const thisCenterZ = (finalStartZ + finalEndZ) / 2;
        if (otherZ > thisCenterZ) {
          // Horizontal wall is on TOP - extend topmost endpoint to topmost surface
          if (topEndpointZ < topmostZ) {
            // Update whichever endpoint is the topmost one
            if (finalEndZ > finalStartZ) {
              finalEndZ = topmostZ;
            } else {
              finalStartZ = topmostZ;
            }
          }
        } else {
          // Horizontal wall is on BOTTOM - extend bottommost endpoint to bottommost surface
          if (bottomEndpointZ > bottommostZ) {
            // Update whichever endpoint is the bottommost one
            if (finalStartZ < finalEndZ) {
              finalStartZ = bottommostZ;
            } else {
              finalEndZ = bottommostZ;
            }
          }
        }
      }
    });
  }
  // ============================================================================
  // STEP 1.5: BUTT-IN JOINT SHORTENING
  // ============================================================================
  // After extension, apply butt_in joint shortening
  // For butt_in joints, wall_1 should be shortened by the joining wall's thickness
  // wall_2 should remain extended (already done above)
  // This happens AFTER extension, so the wall first extends to meet, then shortens back
  // ============================================================================
  const wallDx = finalEndX - finalStartX;
  const wallDz = finalEndZ - finalStartZ;
  const wallLength = Math.hypot(wallDx, wallDz);
  const wallDirX = wallLength > 0 ? wallDx / wallLength : 0;
  const wallDirZ = wallLength > 0 ? wallDz / wallLength : 0;
  // Check for butt_in joints at start and end
  // CRITICAL: We need to check ALL butt_in joints and shorten BOTH sides if needed
  // A wall can have multiple butt_in joints - one at start and one at end
  const buttInJoints = instance.joints ? instance.joints.filter(j => 
    j.joining_method === 'butt_in' && (j.wall_1 === id || j.wall_2 === id)
  ) : [];
  // Track which sides need to be shortened
  let shouldShortenStart = false;
  let shouldShortenEnd = false;
  let startShorteningThickness = 0;
  let endShorteningThickness = 0;
  if (buttInJoints.length > 0) {
    buttInJoints.forEach(j => {
      // Find the other wall in this joint
      const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
      const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
      if (!otherWall) return;
      // Check if THIS wall is wall_1 (the one that should be shortened)
      const isWall1 = j.wall_1 === id;
      if (!isWall1) return; // Only shorten wall_1
      // Get the joining wall's thickness
      const joiningWallThickness = (otherWall.thickness || wallThickness) * scale;
      // Get other wall coordinates to find intersection
      let oSX = snap(otherWall.start_x * scale);
      let oSZ = snap(otherWall.start_y * scale);
      let oEX = snap(otherWall.end_x * scale);
      let oEZ = snap(otherWall.end_y * scale);
      // Calculate intersection point
      const intersection = calculateLineIntersection(
        finalStartX, finalStartZ, finalEndX, finalEndZ,
        oSX, oSZ, oEX, oEZ,
        true // allowExtended = true
      );
      if (!intersection) return;
      const jointX = snap(intersection.x);
      const jointZ = snap(intersection.z);
      // Check if joint is at start or end
      const startDist = Math.hypot(jointX - finalStartX, jointZ - finalStartZ);
      const endDist = Math.hypot(jointX - finalEndX, jointZ - finalEndZ);
      const tolerance = 0.1; // 10cm tolerance - more lenient for butt-in joints
      // Mark which side needs shortening (can be both!)
      const isCloserToStart = startDist < endDist;
      if (isCloserToStart && (startDist < tolerance || startDist < endDist * 0.5)) {
        shouldShortenStart = true;
        // Use the maximum thickness if multiple joints at start
        startShorteningThickness = Math.max(startShorteningThickness, joiningWallThickness);
      }
      if (!isCloserToStart && (endDist < tolerance || endDist < startDist * 0.5)) {
        shouldShortenEnd = true;
        // Use the maximum thickness if multiple joints at end
        endShorteningThickness = Math.max(endShorteningThickness, joiningWallThickness);
      }
      // Debug logging for wall 7185
      if (id === 7185) {
        console.log(`[Butt-In Debug] Wall ${id} - Joint ${j.id} with wall ${otherWallId}:`, {
          isWall1,
          intersection: { x: jointX, z: jointZ },
          thisWallStart: { x: finalStartX, z: finalStartZ },
          thisWallEnd: { x: finalEndX, z: finalEndZ },
          startDist,
          endDist,
          tolerance,
          isCloserToStart,
          shouldShortenStart,
          shouldShortenEnd,
          joiningWallThickness
        });
      }
    });
    // Apply shortening to BOTH sides if needed
    if (shouldShortenStart) {
      // Shorten the wall by moving the start point inward along the wall direction
      // Move inward by the joining wall's thickness
      const originalStartX = finalStartX;
      const originalStartZ = finalStartZ;
      finalStartX = finalStartX + wallDirX * startShorteningThickness;
      finalStartZ = finalStartZ + wallDirZ * startShorteningThickness;
      console.log(`[Butt-In Joint] Wall ${id} (wall_1) - START shortened by ${startShorteningThickness}mm:`, {
        wallId: id,
        jointCount: buttInJoints.length,
        startShorteningThickness,
        originalStart: { x: originalStartX, z: originalStartZ },
        shortenedStart: { x: finalStartX, z: finalStartZ }
      });
    }
    if (shouldShortenEnd) {
      // Shorten the wall by moving the end point inward along the wall direction
      // Move inward by the joining wall's thickness
      const originalEndX = finalEndX;
      const originalEndZ = finalEndZ;
      finalEndX = finalEndX - wallDirX * endShorteningThickness;
      finalEndZ = finalEndZ - wallDirZ * endShorteningThickness;
      console.log(`[Butt-In Joint] Wall ${id} (wall_1) - END shortened by ${endShorteningThickness}mm:`, {
        wallId: id,
        jointCount: buttInJoints.length,
        endShorteningThickness,
        originalEnd: { x: originalEndX, z: originalEndZ },
        shortenedEnd: { x: finalEndX, z: finalEndZ }
      });
    }
  }
  // STEP 2: Now detect 45° cut joints using extended coordinates
  // After extension, walls meet at exact intersection points, so we can detect joints accurately
  let hasStart45 = false;
  let hasEnd45 = false;
  let startJointInfo = null;
  let endJointInfo = null;
  // Determine which face to cut from (inner vs outer) at start/end based on joining wall side
  let startCutOnInner = false;
  let endCutOnInner = false;
  // CRITICAL: Use more lenient tolerance for 45_cut joints (10cm instead of 1cm)
  // After extension, walls should meet, but floating point precision might cause slight differences
  const jointTolerance = 0.1; // 10cm tolerance - more lenient for 45_cut joints
  // After extension, check for 45_cut joints at the extended endpoints
  // Use the intersection points that were already calculated during extension
  if (instance.joints && instance.joints.length) {
    instance.joints.forEach(j => {
      if (j.joining_method === '45_cut' && (j.wall_1 === id || j.wall_2 === id)) {
        // Find the other wall in this joint
        const otherWallId = j.wall_1 === id ? j.wall_2 : j.wall_1;
        const otherWall = instance.walls.find(w => String(w.id) === String(otherWallId));
        if (otherWall) {
          // Get other wall coordinates
          let oSX = snap(otherWall.start_x * scale);
          let oSZ = snap(otherWall.start_y * scale);
          let oEX = snap(otherWall.end_x * scale);
          let oEZ = snap(otherWall.end_y * scale);
          // Calculate intersection using extended coordinates of THIS wall
          // and original coordinates of OTHER wall (it will be extended when processed)
          const intersection = calculateLineIntersection(
            finalStartX, finalStartZ, finalEndX, finalEndZ,
            oSX, oSZ, oEX, oEZ,
            true // allowExtended = true for 45_cut to find intersections even if extended
          );
          if (!intersection) {
            // Skip if no intersection found
            return; // Continue to next joint
          }
          // Use the intersection point (snapped for precision)
          const jointX = snap(intersection.x);
          const jointZ = snap(intersection.z);
          // After extension, check if this joint is at start or end of THIS wall
          // Use lenient tolerance to account for floating point precision after extension
          const startDist = Math.hypot(jointX - finalStartX, jointZ - finalStartZ);
          const endDist = Math.hypot(jointX - finalEndX, jointZ - finalEndZ);
          // Determine which endpoint is closer to the intersection
          const isCloserToStart = startDist < endDist;
          // Check if joint is at start endpoint (after extension)
          // Use the closer endpoint if within tolerance, or if significantly closer than the other
          if (isCloserToStart && (startDist < jointTolerance || startDist < endDist * 0.5)) {
            hasStart45 = true;
            startJointInfo = {
              otherWall,
              bisector: null,
              jointPoint: { x: finalStartX, z: finalStartZ }
            };
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            const joinVec = {
              x: oEX - oSX,
              z: oEZ - oSZ
            };
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            if (wallLen > 0 && joinLen > 0) {
              const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
              const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
              // Calculate bisector (average of the two vectors)
              const bisector = {
                x: (wallNorm.x + joinNorm.x) / 2,
                z: (wallNorm.z + joinNorm.z) / 2
              };
              // Normalize bisector
              const bisectorLen = Math.hypot(bisector.x, bisector.z);
              if (bisectorLen > 0) {
                startJointInfo.bisector = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
              }
            }
            // Determine if the joining wall lies on the inner side (along inward normal) or outer side
            const joinMidX = (oSX + oEX) / 2;
            const joinMidZ = (oSZ + oEZ) / 2;
            const toJoinX = joinMidX - finalStartX;
            const toJoinZ = joinMidZ - finalStartZ;
            startCutOnInner = (toJoinX * finalNormX + toJoinZ * finalNormZ) > 0;
            console.log(`[45° Cut Debug] Wall ${id} - START 45_cut detected:`, {
              wallId: id,
              otherWallId: otherWall.id,
              startDist,
              jointTolerance,
              finalStartX,
              finalStartZ,
              jointX,
              jointZ,
              startCutOnInner
            });
          }
          // Check if joint is at end endpoint (after extension)
          // Use the closer endpoint if within tolerance, or if significantly closer than the other
          if (!isCloserToStart && (endDist < jointTolerance || endDist < startDist * 0.5)) {
            hasEnd45 = true;
            endJointInfo = {
              otherWall,
              bisector: null,
              jointPoint: { x: finalEndX, z: finalEndZ }
            };
            // Calculate wall vectors for miter calculation
            const wallVec = {
              x: finalEndX - finalStartX,
              z: finalEndZ - finalStartZ
            };
            const joinVec = {
              x: oEX - oSX,
              z: oEZ - oSZ
            };
            // Normalize vectors
            const wallLen = Math.hypot(wallVec.x, wallVec.z);
            const joinLen = Math.hypot(joinVec.x, joinVec.z);
            if (wallLen > 0 && joinLen > 0) {
              const wallNorm = { x: wallVec.x / wallLen, z: wallVec.z / wallLen };
              const joinNorm = { x: joinVec.x / joinLen, z: joinVec.z / joinLen };
              // Calculate bisector (average of the two vectors)
              const bisector = {
                x: (wallNorm.x + joinNorm.x) / 2,
                z: (wallNorm.z + joinNorm.z) / 2
              };
              // Normalize bisector
              const bisectorLen = Math.hypot(bisector.x, bisector.z);
              if (bisectorLen > 0) {
                endJointInfo.bisector = { x: bisector.x / bisectorLen, z: bisector.z / bisectorLen };
              }
            }
            const joinMidX = (oSX + oEX) / 2;
            const joinMidZ = (oSZ + oEZ) / 2;
            const toJoinX = joinMidX - finalEndX;
            const toJoinZ = joinMidZ - finalEndZ;
            endCutOnInner = (toJoinX * finalNormX + toJoinZ * finalNormZ) > 0;
            console.log(`[45° Cut Debug] Wall ${id} - END 45_cut detected:`, {
              wallId: id,
              otherWallId: otherWall.id,
              endDist,
              jointTolerance,
              finalEndX,
              finalEndZ,
              jointX,
              jointZ,
              endCutOnInner
            });
          }
        }
      }
    });
  }
  // Debug: Log final 45_cut detection results
  if (hasStart45 || hasEnd45) {
    console.log(`[45° Cut Debug] Wall ${id} - FINAL:`, {
      hasStart45,
      hasEnd45,
      startCutOnInner,
      endCutOnInner
    });
  }
  // Extension already happened in STEP 1 above
  // The 45° cut detection in STEP 2 uses the extended coordinates
  // No need to extend again here
  // console.log('[45° Cut Debug] Final result for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Calculate wall length using final coordinates (after extension)
  const finalDx = finalEndX - finalStartX;
  const finalDz = finalEndZ - finalStartZ;
  const finalWallLength = Math.hypot(finalDx, finalDz);
  const wallShape = new instance.THREE.Shape();
  // console.log('[45° Cut Debug] Creating wall shape for wall:', id, 'hasStart45:', hasStart45, 'hasEnd45:', hasEnd45);
  // Always create a pure rectangular face (length X, height Y). Miter is applied in geometry later.
  wallShape.moveTo(0, 0);
  wallShape.lineTo(0, wallHeight);
  wallShape.lineTo(finalWallLength, wallHeight);
  wallShape.lineTo(finalWallLength, 0);
  wallShape.lineTo(0, 0);
  // Add door cutouts
  // IMPORTANT: When wall start/end points are flipped (for joint alignment or model center positioning),
  // door positions must also be flipped to maintain correct visual placement.
  // A door at position 0.3 on the original wall should appear at position 0.7 on the flipped wall.
  const wasWallFlipped = (finalStartX !== startX) || (finalStartZ !== startZ);
  if (wasWallFlipped && wallDoors.length > 0) {
    // Wall was flipped, door positions will be adjusted
  }
  wallDoors.sort((a, b) => a.position_x - b.position_x);
  const cutouts = wallDoors.map(door => {
    const isSlideDoor = (door.door_type === 'slide');
    const isDockDoor = (door.door_type === 'dock');
    const isDoubleSidedSlide = isSlideDoor && door.configuration === 'double_sided';
    const doorWidth = door.width * scale;
    // For double-sided slide doors, use full door width (both panels need to fit)
    // For single slide doors, use 95% (slight gap for sliding)
    // For dock doors, use 100% (exact fit)
    // For swing doors, use 105% (slight overlap for door swing)
    const cutoutWidth = doorWidth * (isDoubleSidedSlide ? 1.0 : isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    
    // Get floor thickness to raise the cutout (matching door mesh positioning)
    // Floors are positioned at baseElevation and extend upward by floorThickness
    // Door cutout should start at floorThickness (top of floor) to match door mesh position
    let floorThickness = 150 * scale; // Default: 150mm
    if (instance.project && instance.project.rooms) {
      // Get room for this door
      const room = instance.project.rooms.find(r => r.id === door.room);
      if (room && room.floor_thickness !== undefined && room.floor_thickness !== null && !isNaN(room.floor_thickness)) {
        floorThickness = Number(room.floor_thickness) * scale;
      } else {
        // Try to find rooms containing this wall
        const roomsContainingWall = [];
        instance.project.rooms.forEach(r => {
          const roomWalls = Array.isArray(r.walls) ? r.walls : [];
          const hasWall = roomWalls.some(w => {
            const wallId = typeof w === 'object' ? w.id : w;
            return String(wallId) === String(id);
          });
          if (hasWall) {
            roomsContainingWall.push(r);
          }
        });
        
        if (roomsContainingWall.length > 0) {
          const floorThicknesses = roomsContainingWall
            .map(r => r.floor_thickness)
            .filter(thickness => thickness !== undefined && thickness !== null && !isNaN(thickness))
            .map(thickness => Number(thickness));
          
          if (floorThicknesses.length > 0) {
            floorThickness = floorThicknesses[0] * scale;
          }
        }
      }
    }
    
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    
    // Calculate cutout bounds
    const cutoutStart = Math.max(0, doorPos - cutoutWidth / 2);
    const cutoutEnd = Math.min(finalWallLength, doorPos + cutoutWidth / 2);
    
    // Debug logging for door cutout positioning
    if (isDoubleSidedSlide) {
      console.log(`[Door Cutout] Door ${door.id} (double-sided slide):`, {
        doorPositionX: door.position_x,
        adjustedPositionX: adjustedPositionX,
        wasWallFlipped: wasWallFlipped,
        finalWallLength: finalWallLength,
        doorPos: doorPos,
        doorWidth: doorWidth,
        cutoutWidth: cutoutWidth,
        cutoutStart: cutoutStart,
        cutoutEnd: cutoutEnd,
        cutoutCenter: (cutoutStart + cutoutEnd) / 2,
        floorThickness: floorThickness,
        doorHeight: doorHeight,
        cutoutBottomY: floorThickness,
        cutoutTopY: floorThickness + doorHeight
      });
    }
    
    return {
      start: cutoutStart,
      end: cutoutEnd,
      height: doorHeight,
      floorThickness: floorThickness, // Store floor thickness for cutout positioning
      doorInfo: door
    };
  });
  
  // Add window cutouts
  const windowCutouts = wallWindows.map(window => {
    const windowWidth = window.width * scale;
    const windowHeight = window.height * scale;
    
    // If wall was flipped, flip the window position
    const adjustedPositionX = wasWallFlipped ? (1 - window.position_x) : window.position_x;
    const windowPos = adjustedPositionX * finalWallLength;
    
    // Calculate window position vertically (position_y is 0-1, where 0 is bottom, 1 is top)
    // Window center Y position relative to wall height
    const windowCenterY = window.position_y * wallHeight;
    const windowBottomY = windowCenterY - windowHeight / 2;
    const windowTopY = windowCenterY + windowHeight / 2;
    
    // Calculate cutout bounds
    const cutoutStart = Math.max(0, windowPos - windowWidth / 2);
    const cutoutEnd = Math.min(finalWallLength, windowPos + windowWidth / 2);
    
    return {
      start: cutoutStart,
      end: cutoutEnd,
      bottomY: Math.max(0, windowBottomY),
      topY: Math.min(wallHeight, windowTopY),
      windowInfo: window
    };
  });
  
  // Combine door and window cutouts
  const allCutouts = [...cutouts, ...windowCutouts];
  
  // Shape already closed above
  for (const cutout of allCutouts) {
    const hole = new instance.THREE.Path();
    // Check if this is a door cutout or window cutout
    if (cutout.doorInfo) {
      // Door cutout starts at floorThickness (top of floor) and extends upward by doorHeight
      const cutoutBottomY = cutout.floorThickness;
      const cutoutTopY = cutout.floorThickness + cutout.height;
      hole.moveTo(cutout.start, cutoutBottomY);
      hole.lineTo(cutout.end, cutoutBottomY);
      hole.lineTo(cutout.end, cutoutTopY);
      hole.lineTo(cutout.start, cutoutTopY);
      hole.lineTo(cutout.start, cutoutBottomY);
    } else if (cutout.windowInfo) {
      // Window cutout
      hole.moveTo(cutout.start, cutout.bottomY);
      hole.lineTo(cutout.end, cutout.bottomY);
      hole.lineTo(cutout.end, cutout.topY);
      hole.lineTo(cutout.start, cutout.topY);
      hole.lineTo(cutout.start, cutout.bottomY);
    }
    wallShape.holes.push(hole);
  }
  const extrudeSettings = {
    depth: wallThickness,
    bevelEnabled: false
  };
  const wallGeometry = new instance.THREE.ExtrudeGeometry(wallShape, extrudeSettings);
  wallGeometry.computeVertexNormals();
  const wallMaterial = new instance.THREE.MeshStandardMaterial({ color: 0xFFFFFFF, roughness: 0.5, metalness: 0.7 });
  let wallMesh = new instance.THREE.Mesh(wallGeometry, wallMaterial);
  // Apply 45° cuts using boolean operations if needed
  if (hasStart45 || hasEnd45) {
    console.log(`[45° Cut Debug] Wall ${id} - Applying 45° cuts:`, {
      hasStart45,
      hasEnd45,
      startCutOnInner,
      endCutOnInner,
      finalWallLength,
      wallHeight,
      wallThickness
    });
    wallMesh = apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, finalWallLength, wallHeight, wallThickness, startCutOnInner, endCutOnInner);
    console.log(`[45° Cut Debug] Wall ${id} - 45° cuts applied successfully`);
    // IMPORTANT: After applying cuts, we need to update the geometry
    // The geometry was modified, so we need to ensure it's properly updated
    wallMesh.geometry.attributes.position.needsUpdate = true;
    wallMesh.geometry.computeBoundingBox();
    wallMesh.geometry.computeVertexNormals();
  } else {
    console.log(`[45° Cut Debug] Wall ${id} - No 45° cuts detected for this wall`);
  }
  wallMesh.userData.isWall = true;
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  wallMesh.rotation.y = -Math.atan2(finalDz, finalDx);
  // Position the mesh so that the database line is one face, and thickness extends toward the model center
  wallMesh.position.set(finalStartX + instance.modelOffset.x, basePositionY, finalStartZ + instance.modelOffset.z);
  // IMPORTANT: Create edges AFTER cuts are applied, so edges reflect the modified geometry
  const edges = new instance.THREE.EdgesGeometry(wallMesh.geometry);
  const edgeLines = new instance.THREE.LineSegments(edges, new instance.THREE.LineBasicMaterial({ color: 0x000000 }));
  wallMesh.add(edgeLines);
  
  // Add black outlines for door and window holes (cutouts)
  // Door holes are in the wall's local coordinate system:
  // - X: along the wall (0 to finalWallLength)
  // - Y: vertical (0 to wallHeight, with cutout at floorThickness to floorThickness + height)
  // - Z: wall thickness (0 to wallThickness, cutout is at z = 0, the outer face)
  for (const cutout of allCutouts) {
    let cutoutBottomY, cutoutTopY;
    if (cutout.doorInfo) {
      cutoutBottomY = cutout.floorThickness;
      cutoutTopY = cutout.floorThickness + cutout.height;
    } else if (cutout.windowInfo) {
      cutoutBottomY = cutout.bottomY;
      cutoutTopY = cutout.topY;
    } else {
      continue;
    }
    
    // Create outline geometry for hole rectangle
    // In wall's local space: X along wall, Y vertical, Z depth
    const outlineGeometry = new instance.THREE.BufferGeometry();
    const vertices = new Float32Array([
      // Bottom edge
      cutout.start, cutoutBottomY, 0,
      cutout.end, cutoutBottomY, 0,
      // Right edge
      cutout.end, cutoutBottomY, 0,
      cutout.end, cutoutTopY, 0,
      // Top edge
      cutout.end, cutoutTopY, 0,
      cutout.start, cutoutTopY, 0,
      // Left edge
      cutout.start, cutoutTopY, 0,
      cutout.start, cutoutBottomY, 0
    ]);
    outlineGeometry.setAttribute('position', new instance.THREE.BufferAttribute(vertices, 3));
    
    // Create line segments for hole outline
    const outlineMaterial = new instance.THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
    const outlineLines = new instance.THREE.LineSegments(outlineGeometry, outlineMaterial);
    
    // Add to wall mesh (already in correct local coordinate system)
    wallMesh.add(outlineLines);
  }
  
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
    
    // Ensure windows are preserved when setting calculatedPosition
    const doorInfo = cutout.doorInfo;
    const isDoubleSidedSlide = doorInfo.door_type === 'slide' && doorInfo.configuration === 'double_sided';
    
    if (!doorInfo.calculatedPosition) {
      doorInfo.calculatedPosition = {};
    }
    doorInfo.calculatedPosition = {
      x: doorX,
      z: doorZ,
      angle: Math.atan2(finalDz, finalDx),
      width: cutout.end - cutout.start,
      height: cutout.height,
      depth: wallThickness,
      wasWallFlipped: wasWallFlipped
    };
    
    // Debug logging for door position calculation
    if (isDoubleSidedSlide) {
      console.log(`[Door Position] Door ${doorInfo.id} (double-sided slide) calculatedPosition:`, {
        cutoutStart: cutout.start,
        cutoutEnd: cutout.end,
        cutoutMid: mid,
        centerX: centerX,
        centerZ: centerZ,
        doorX: doorX,
        doorZ: doorZ,
        cutoutWidth: cutout.end - cutout.start,
        doorWidth: doorInfo.width * instance.scalingFactor
      });
    }
    
    // Debug: Log if door has windows
    if (doorInfo.windows && doorInfo.windows.length > 0) {
      console.log(`[createWallMesh] Door ${doorInfo.id} has ${doorInfo.windows.length} window(s) when setting calculatedPosition`);
    }
  }
  
  // Add window glass panels
  if (wallWindows.length > 0) {
    const glassMaterial = new instance.THREE.MeshStandardMaterial({
      color: 0xADD8E6, // Light blue tint
      roughness: 0.05,
      metalness: 0.1,
      transparent: true,
      opacity: 0.3,
      side: instance.THREE.DoubleSide,
      envMapIntensity: 1.0
    });
    
    const frameMaterial = new instance.THREE.MeshStandardMaterial({
      color: 0x1a1a1a, // Very dark/black for frame
      roughness: 0.8,
      metalness: 0.2
    });
    
    const windowThickness = 3 * scale;
    const frameThickness = 3 * scale;
    
    // Find the corresponding window cutout for each window to get exact positioning
    for (const window of wallWindows) {
      const windowWidth_scaled = window.width * scale;
      const windowHeight_scaled = window.height * scale;
      
      // Find the matching cutout for this window
      const matchingCutout = windowCutouts.find(c => c.windowInfo.id === window.id);
      if (!matchingCutout) continue;
      
      // Calculate window center from cutout bounds
      const windowCenterX_local = (matchingCutout.start + matchingCutout.end) / 2;
      const windowCenterY_local = (matchingCutout.bottomY + matchingCutout.topY) / 2;
      
      // Create glass panel (centered in wall thickness, z=0 is at the outer face)
      const glassGeometry = new instance.THREE.BoxGeometry(windowWidth_scaled, windowHeight_scaled, windowThickness);
      const glassMesh = new instance.THREE.Mesh(glassGeometry, glassMaterial);
      glassMesh.position.set(windowCenterX_local, windowCenterY_local, 0);
      wallMesh.add(glassMesh);
      
      // Create frame (outer border)
      const frameWidth = windowWidth_scaled;
      const frameHeight = windowHeight_scaled;
      
      // Top frame
      const topFrameGeometry = new instance.THREE.BoxGeometry(frameWidth, frameThickness, windowThickness);
      const topFrame = new instance.THREE.Mesh(topFrameGeometry, frameMaterial);
      topFrame.position.set(windowCenterX_local, windowCenterY_local + frameHeight / 2 - frameThickness / 2, 0);
      wallMesh.add(topFrame);
      
      // Bottom frame
      const bottomFrameGeometry = new instance.THREE.BoxGeometry(frameWidth, frameThickness, windowThickness);
      const bottomFrame = new instance.THREE.Mesh(bottomFrameGeometry, frameMaterial);
      bottomFrame.position.set(windowCenterX_local, windowCenterY_local - frameHeight / 2 + frameThickness / 2, 0);
      wallMesh.add(bottomFrame);
      
      // Left frame
      const leftFrameGeometry = new instance.THREE.BoxGeometry(frameThickness, frameHeight - 2 * frameThickness, windowThickness);
      const leftFrame = new instance.THREE.Mesh(leftFrameGeometry, frameMaterial);
      leftFrame.position.set(windowCenterX_local - frameWidth / 2 + frameThickness / 2, windowCenterY_local, 0);
      wallMesh.add(leftFrame);
      
      // Right frame
      const rightFrameGeometry = new instance.THREE.BoxGeometry(frameThickness, frameHeight - 2 * frameThickness, windowThickness);
      const rightFrame = new instance.THREE.Mesh(rightFrameGeometry, frameMaterial);
      rightFrame.position.set(windowCenterX_local + frameWidth / 2 - frameThickness / 2, windowCenterY_local, 0);
      wallMesh.add(rightFrame);
    }
  }
  
  return wallMesh;
}

function apply45DegreeCuts(instance, wallMesh, hasStart45, hasEnd45, wallLength, wallHeight, wallThickness, startCutOnInner = true, endCutOnInner = true) {
  console.log(`[apply45DegreeCuts] Called with:`, {
    hasStart45,
    hasEnd45,
    startCutOnInner,
    endCutOnInner,
    wallLength,
    wallHeight,
    wallThickness
  });
  const pos = wallMesh.geometry.attributes.position;
  const arr = pos.array;
  const vcount = pos.count;

  // Work in local geometry space (before rotation), get actual extents
  wallMesh.geometry.computeBoundingBox();
  const bbox = wallMesh.geometry.boundingBox;
  const minX = bbox.min.x, maxX = bbox.max.x;
  const minZ = bbox.min.z, maxZ = bbox.max.z;

  const lenX = Math.max(1e-8, Math.abs(maxX - minX));
  const thickness = Math.max(1e-8, maxZ - minZ);
  // CRITICAL: Use more lenient tolerance for vertex detection (at least 1cm or 0.1% of wall length)
  // This ensures vertices are detected correctly for extended walls with floating-point inaccuracies
  const epsEndX = Math.max(0.001 * lenX, 0.01);
  console.log(`[apply45DegreeCuts] Geometry bounds:`, {
    minX,
    maxX,
    minZ,
    maxZ,
    lenX,
    thickness,
    epsEndX,
    vcount
  });

  let startCutCount = 0;
  let endCutCount = 0;

  for (let i = 0; i < vcount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const z = arr[ix + 2];

    // t=0 at OUTER face (z≈minZ), t=1 at INNER face (z≈maxZ)
    let t = (z - minZ) / thickness;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    // Choose which face is primarily affected based on which side the joining wall is on
    const wStart = startCutOnInner ? t : (1 - t);
    const wEnd = endCutOnInner ? t : (1 - t);

    // End cut: pull inner back along X up to thickness
    if (hasEnd45 && Math.abs(x - maxX) < epsEndX) {
      const oldX = arr[ix];
      arr[ix] = x - wEnd * thickness;
      endCutCount++;
      if (endCutCount <= 5) {
        console.log(`[apply45DegreeCuts] End cut vertex ${i}: x=${oldX} -> ${arr[ix]}, t=${t}, wEnd=${wEnd}, thickness=${thickness}`);
      }
    }

    // Start cut: push inner forward along X up to thickness
    if (hasStart45 && Math.abs(x - minX) < epsEndX) {
      const oldX = arr[ix];
      arr[ix] = x + wStart * thickness;
      startCutCount++;
      if (startCutCount <= 5) {
        console.log(`[apply45DegreeCuts] Start cut vertex ${i}: x=${oldX} -> ${arr[ix]}, t=${t}, wStart=${wStart}, thickness=${thickness}`);
      }
    }
  }
  console.log(`[apply45DegreeCuts] Applied cuts:`, {
    startCutCount,
    endCutCount,
    totalVertices: vcount
  });

  // CRITICAL: Force complete geometry update
  // For extended walls, recreate the position attribute to ensure Three.js recognizes changes
  pos.needsUpdate = true;
  
  // CRITICAL: Create a new Float32Array copy to ensure Three.js sees the changes
  // This is especially important for extended walls where geometry might be cached
  const modifiedArray = new Float32Array(arr);
  wallMesh.geometry.setAttribute('position', new instance.THREE.BufferAttribute(modifiedArray, 3));
  wallMesh.geometry.attributes.position.needsUpdate = true;
  
  // Recompute bounding box after vertex modifications
  wallMesh.geometry.computeBoundingBox();
  
  // Recompute normals - this is essential for proper rendering
  wallMesh.geometry.computeVertexNormals();
  
  // Force update of all attributes
  if (wallMesh.geometry.attributes.normal) {
    wallMesh.geometry.attributes.normal.needsUpdate = true;
  }
  
  // Force geometry to be marked as changed
  wallMesh.geometry.computeBoundingSphere();
  
  return wallMesh;
}

// Helper function to create a door with window holes
// This creates the door in sections around windows, leaving actual holes
function createDoorWithWindows(instance, doorWidth, doorHeight, doorThickness, doorMaterial, windows, scale, offsetX = 0) {
  // Helper function to add outer frame outline to door
  const addDoorFrameOutline = (doorMeshOrGroup) => {
    // Create outline geometry for outer frame on both sides
    // Door extends from -doorWidth/2 to +doorWidth/2 in X, -doorHeight/2 to +doorHeight/2 in Y
    // Outline should be on both faces: front (z = +doorThickness/2) and back (z = -doorThickness/2)
    const halfWidth = doorWidth / 2;
    const halfHeight = doorHeight / 2;
    const halfThickness = doorThickness / 2;
    
    // Create rectangle outline on the front face (z = +doorThickness/2)
    const frontOutlineGeometry = new instance.THREE.BufferGeometry();
    const frontVertices = new Float32Array([
      // Top edge
      -halfWidth + offsetX, halfHeight, halfThickness,
      halfWidth + offsetX, halfHeight, halfThickness,
      // Right edge
      halfWidth + offsetX, halfHeight, halfThickness,
      halfWidth + offsetX, -halfHeight, halfThickness,
      // Bottom edge
      halfWidth + offsetX, -halfHeight, halfThickness,
      -halfWidth + offsetX, -halfHeight, halfThickness,
      // Left edge
      -halfWidth + offsetX, -halfHeight, halfThickness,
      -halfWidth + offsetX, halfHeight, halfThickness
    ]);
    frontOutlineGeometry.setAttribute('position', new instance.THREE.BufferAttribute(frontVertices, 3));
    
    // Create rectangle outline on the back face (z = -doorThickness/2)
    const backOutlineGeometry = new instance.THREE.BufferGeometry();
    const backVertices = new Float32Array([
      // Top edge
      -halfWidth + offsetX, halfHeight, -halfThickness,
      halfWidth + offsetX, halfHeight, -halfThickness,
      // Right edge
      halfWidth + offsetX, halfHeight, -halfThickness,
      halfWidth + offsetX, -halfHeight, -halfThickness,
      // Bottom edge
      halfWidth + offsetX, -halfHeight, -halfThickness,
      -halfWidth + offsetX, -halfHeight, -halfThickness,
      // Left edge
      -halfWidth + offsetX, -halfHeight, -halfThickness,
      -halfWidth + offsetX, halfHeight, -halfThickness
    ]);
    backOutlineGeometry.setAttribute('position', new instance.THREE.BufferAttribute(backVertices, 3));
    
    // Create outline geometry for thickness edges (connecting front and back faces)
    const thicknessOutlineGeometry = new instance.THREE.BufferGeometry();
    const thicknessVertices = new Float32Array([
      // Top-left edge (front top-left to back top-left)
      -halfWidth + offsetX, halfHeight, halfThickness,
      -halfWidth + offsetX, halfHeight, -halfThickness,
      // Top-right edge (front top-right to back top-right)
      halfWidth + offsetX, halfHeight, halfThickness,
      halfWidth + offsetX, halfHeight, -halfThickness,
      // Bottom-left edge (front bottom-left to back bottom-left)
      -halfWidth + offsetX, -halfHeight, halfThickness,
      -halfWidth + offsetX, -halfHeight, -halfThickness,
      // Bottom-right edge (front bottom-right to back bottom-right)
      halfWidth + offsetX, -halfHeight, halfThickness,
      halfWidth + offsetX, -halfHeight, -halfThickness
    ]);
    thicknessOutlineGeometry.setAttribute('position', new instance.THREE.BufferAttribute(thicknessVertices, 3));
    
    // Create line segments for all door frame outlines
    const outlineMaterial = new instance.THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 });
    const frontOutlineLines = new instance.THREE.LineSegments(frontOutlineGeometry, outlineMaterial);
    const backOutlineLines = new instance.THREE.LineSegments(backOutlineGeometry, outlineMaterial);
    const thicknessOutlineLines = new instance.THREE.LineSegments(thicknessOutlineGeometry, outlineMaterial);
    
    doorMeshOrGroup.add(frontOutlineLines);
    doorMeshOrGroup.add(backOutlineLines);
    doorMeshOrGroup.add(thicknessOutlineLines);
  };
  
  // If no windows, create a simple box door
  if (!windows || windows.length === 0) {
    const doorGeometry = new instance.THREE.BoxGeometry(doorWidth, doorHeight, doorThickness);
    if (offsetX !== 0) {
      doorGeometry.translate(offsetX, 0, 0);
    }
    const doorMesh = new instance.THREE.Mesh(doorGeometry, doorMaterial);
    // Add outer frame outline
    addDoorFrameOutline(doorMesh);
    return doorMesh;
  }
  
  // Create door in sections around windows
  const doorGroup = new instance.THREE.Group();
  
  // Sort windows by position for easier processing
  const sortedWindows = [...windows].sort((a, b) => {
    // Sort by Y position (bottom to top), then by X position (left to right)
    if (Math.abs(a.position_y - b.position_y) > 0.01) {
      return a.position_y - b.position_y;
    }
    return a.position_x - b.position_x;
  });
  
  // Calculate window bounds in door space
  const windowBounds = sortedWindows.map(window => {
    const windowCenterX = (window.position_x - 0.5) * doorWidth;
    const windowCenterY = (window.position_y - 0.5) * doorHeight;
    const windowWidth_scaled = window.width * scale;
    const windowHeight_scaled = window.height * scale;
    
    return {
      window,
      left: windowCenterX - windowWidth_scaled / 2,
      right: windowCenterX + windowWidth_scaled / 2,
      bottom: windowCenterY - windowHeight_scaled / 2,
      top: windowCenterY + windowHeight_scaled / 2,
      centerX: windowCenterX,
      centerY: windowCenterY,
      width: windowWidth_scaled,
      height: windowHeight_scaled
    };
  });
  
  // Create door sections
  // Top section (above all windows)
  const topWindowBound = Math.max(...windowBounds.map(w => w.top));
  if (topWindowBound < doorHeight / 2) {
    const topHeight = doorHeight / 2 - topWindowBound;
    if (topHeight > 0.01) {
      const topGeometry = new instance.THREE.BoxGeometry(doorWidth, topHeight, doorThickness);
      if (offsetX !== 0) {
        topGeometry.translate(offsetX, 0, 0);
      }
      const topMesh = new instance.THREE.Mesh(topGeometry, doorMaterial);
      topMesh.position.y = doorHeight / 2 - topHeight / 2;
      doorGroup.add(topMesh);
    }
  }
  
  // Bottom section (below all windows)
  const bottomWindowBound = Math.min(...windowBounds.map(w => w.bottom));
  if (bottomWindowBound > -doorHeight / 2) {
    const bottomHeight = bottomWindowBound - (-doorHeight / 2);
    if (bottomHeight > 0.01) {
      const bottomGeometry = new instance.THREE.BoxGeometry(doorWidth, bottomHeight, doorThickness);
      if (offsetX !== 0) {
        bottomGeometry.translate(offsetX, 0, 0);
      }
      const bottomMesh = new instance.THREE.Mesh(bottomGeometry, doorMaterial);
      bottomMesh.position.y = -doorHeight / 2 + bottomHeight / 2;
      doorGroup.add(bottomMesh);
    }
  }
  
  // Create sections between windows horizontally
  // Group windows by similar Y positions (same row)
  const windowRows = [];
  windowBounds.forEach(bound => {
    let addedToRow = false;
    for (let row of windowRows) {
      // Check if window is in same row (similar Y position)
      if (Math.abs(row[0].centerY - bound.centerY) < doorHeight * 0.1) {
        row.push(bound);
        addedToRow = true;
        break;
      }
    }
    if (!addedToRow) {
      windowRows.push([bound]);
    }
  });
  
  // For each row, create sections
  windowRows.forEach(row => {
    // Sort row by X position
    row.sort((a, b) => a.left - b.left);
    
    const rowTop = Math.max(...row.map(w => w.top));
    const rowBottom = Math.min(...row.map(w => w.bottom));
    const rowHeight = rowTop - rowBottom;
    const rowCenterY = (rowTop + rowBottom) / 2;
    
    // Left section (before first window)
    if (row[0].left > -doorWidth / 2) {
      const leftWidth = row[0].left - (-doorWidth / 2);
      if (leftWidth > 0.01) {
        const leftGeometry = new instance.THREE.BoxGeometry(leftWidth, rowHeight, doorThickness);
        if (offsetX !== 0) {
          leftGeometry.translate(offsetX, 0, 0);
        }
        const leftMesh = new instance.THREE.Mesh(leftGeometry, doorMaterial);
        leftMesh.position.set((-doorWidth / 2 + leftWidth / 2), rowCenterY, 0);
        doorGroup.add(leftMesh);
      }
    }
    
    // Sections between windows
    for (let i = 0; i < row.length - 1; i++) {
      const gapWidth = row[i + 1].left - row[i].right;
      if (gapWidth > 0.01) {
        const gapGeometry = new instance.THREE.BoxGeometry(gapWidth, rowHeight, doorThickness);
        if (offsetX !== 0) {
          gapGeometry.translate(offsetX, 0, 0);
        }
        const gapMesh = new instance.THREE.Mesh(gapGeometry, doorMaterial);
        gapMesh.position.set((row[i].right + row[i + 1].left) / 2, rowCenterY, 0);
        doorGroup.add(gapMesh);
      }
    }
    
    // Right section (after last window)
    if (row[row.length - 1].right < doorWidth / 2) {
      const rightWidth = doorWidth / 2 - row[row.length - 1].right;
      if (rightWidth > 0.01) {
        const rightGeometry = new instance.THREE.BoxGeometry(rightWidth, rowHeight, doorThickness);
        if (offsetX !== 0) {
          rightGeometry.translate(offsetX, 0, 0);
        }
        const rightMesh = new instance.THREE.Mesh(rightGeometry, doorMaterial);
        rightMesh.position.set((row[row.length - 1].right + doorWidth / 2) / 2, rowCenterY, 0);
        doorGroup.add(rightMesh);
      }
    }
  });
  
  // Add outer frame outline to door group
  addDoorFrameOutline(doorGroup);
  
  return doorGroup;
}

// Helper function to add window glass in the holes
function addWindowGlass(instance, doorMesh, windows, doorWidth, doorHeight, doorThickness, scale, offsetX = 0, zPos = 0) {
  if (!windows || windows.length === 0) return;
  
  const glassMaterial = new instance.THREE.MeshStandardMaterial({
    color: 0xADD8E6, // Light blue tint
    roughness: 0.05,
    metalness: 0.1,
    transparent: true,
    opacity: 0.3,
    side: instance.THREE.DoubleSide,
    envMapIntensity: 1.0
  });
  
  const frameMaterial = new instance.THREE.MeshStandardMaterial({
    color: 0x1a1a1a, // Very dark/black for frame
    roughness: 0.8,
    metalness: 0.2
  });
  
  windows.forEach((window) => {
    // Calculate window position relative to door center
    const windowCenterX = (window.position_x - 0.5) * doorWidth;
    const windowCenterY = (window.position_y - 0.5) * doorHeight;
    const windowWidth_scaled = window.width * scale;
    const windowHeight_scaled = window.height * scale;
    const windowThickness = Math.min(3 * scale, doorThickness * 0.8); // Thin glass, but not thicker than door
    const frameThickness = 3 * scale;
    
    // Create window glass panel
    const windowGeometry = new instance.THREE.BoxGeometry(windowWidth_scaled, windowHeight_scaled, windowThickness);
    const windowGlass = new instance.THREE.Mesh(windowGeometry, glassMaterial);
    // Position glass so its center is at zPos (which should be the center of the door thickness)
    windowGlass.position.set(windowCenterX + offsetX, windowCenterY, zPos);
    doorMesh.add(windowGlass);
    
    // Create frame around window (inside the hole)
    const topFrame = new instance.THREE.Mesh(
      new instance.THREE.BoxGeometry(windowWidth_scaled, frameThickness, doorThickness),
      frameMaterial
    );
    topFrame.position.set(windowCenterX + offsetX, windowCenterY + windowHeight_scaled/2 - frameThickness/2, zPos);
    doorMesh.add(topFrame);
    
    const bottomFrame = new instance.THREE.Mesh(
      new instance.THREE.BoxGeometry(windowWidth_scaled, frameThickness, doorThickness),
      frameMaterial
    );
    bottomFrame.position.set(windowCenterX + offsetX, windowCenterY - windowHeight_scaled/2 + frameThickness/2, zPos);
    doorMesh.add(bottomFrame);
    
    // Left and right frames should not overlap with top/bottom frames
    // Subtract 2 * frameThickness to avoid overlap at corners
    const verticalFrameHeight = windowHeight_scaled - (2 * frameThickness);
    if (verticalFrameHeight > 0) {
      const leftFrame = new instance.THREE.Mesh(
        new instance.THREE.BoxGeometry(frameThickness, verticalFrameHeight, doorThickness),
        frameMaterial
      );
      leftFrame.position.set(windowCenterX + offsetX - windowWidth_scaled/2 + frameThickness/2, windowCenterY, zPos);
      doorMesh.add(leftFrame);
      
      const rightFrame = new instance.THREE.Mesh(
        new instance.THREE.BoxGeometry(frameThickness, verticalFrameHeight, doorThickness),
        frameMaterial
      );
      rightFrame.position.set(windowCenterX + offsetX + windowWidth_scaled/2 - frameThickness/2, windowCenterY, zPos);
      doorMesh.add(rightFrame);
    }
  });
}

export function createDoorMesh(instance, door, wall) {
  if (!door.calculatedPosition) {
    return null;
  }
  
  // Debug: Log door windows
  if (door.windows && door.windows.length > 0) {
    console.log(`[Door ${door.id}] Has ${door.windows.length} window(s):`, door.windows);
  } else {
    console.log(`[Door ${door.id}] No windows found. Door object:`, door);
  }
  
  // IMPORTANT: This function handles door mesh creation with wall flipping adjustments.
  // When walls are flipped (for joint alignment or model center positioning), three things must be adjusted:
  // 1. Door positions - to maintain correct relative placement along the wall
  // 2. Door opening directions - to maintain correct swing/slide behavior
  // 3. Hinge positions - to maintain correct hinge placement relative to the door opening
  //
  // DOOR ELEVATION POSITIONING:
  // - ALL doors (swing/slide/dock) are positioned consistently at: doorBaseElevation + doorHeight/2
  // - This centers the door vertically on the wall opening, regardless of door type, side, or direction
  // - doorBaseElevation matches the wall's base position exactly (using same logic as wall mesh)
  // - The door opening in the wall starts at doorBaseElevation and has height doorHeight
  //
  // BASE ELEVATION NOTE:
  // - If wall has base_elevation_manual=true, use wall's base_elevation_mm (absolute value, no storey)
  // - Otherwise, use minimum room base_elevation_mm from all rooms containing the wall (absolute value, no storey)
  // - This matches exactly how walls are positioned in createWallMesh()
  const { x: doorPosX, z: doorPosZ, angle: wallAngle, width: cutoutWidth, height: doorHeight, depth: wallDepth, wasWallFlipped } = door.calculatedPosition;
  const scale = instance.scalingFactor;
  const { width, thickness, door_type, swing_direction, slide_direction, side, configuration } = door;
  
  // Find the wall data object from the door's wall reference
  // The 'wall' parameter might be null or a Three.js mesh, so we need to look it up from instance.walls
  // Doors can reference walls via: door.wall, door.wall_id, or door.linked_wall
  const wallId = door.wall || door.wall_id || door.linked_wall;
  const wallData = wallId ? instance.walls?.find(w => 
    String(w.id) === String(wallId) || 
    String(w.id) === String(door.wall) || 
    String(w.id) === String(door.wall_id) || 
    String(w.id) === String(door.linked_wall)
  ) : null;
  const hasManualBaseElevation = wallData && wallData.base_elevation_manual;
  
  // Get room data for comparison
  const room = instance.project?.rooms?.find(r => r.id === door.room);
  
  // Helper function to get the correct base elevation for door positioning
  // CRITICAL: Match wall mesh positioning logic exactly (meshUtils.js lines 102-168)
  // Walls use absolute base elevations (no storey elevation added)
  // Doors must use the same logic to align properly with walls
  const getDoorBaseElevation = () => {
    // Check for gap-fill mode first (matches wall mesh logic)
    if (wallData && wallData.fill_gap_mode && wallData.gap_base_position !== null && wallData.gap_base_position !== undefined) {
      // Gap-fill mode: position at gap base (matches wall mesh positioning)
      const gapBasePosition = wallData.gap_base_position * scale;
      console.log(`[Door ${door.id}] Using gap-fill base position: ${gapBasePosition}mm`);
      return gapBasePosition;
    }
    
    // If wall has manual base elevation, use it (ignoring room base elevation)
    if (hasManualBaseElevation && wallData) {
      // Use wall's base_elevation_mm directly (absolute value, no storey elevation)
      // This matches exactly how walls are positioned in createWallMesh
      const wallBaseElevation = wallData.base_elevation_mm ?? 0;
      
      console.log(`[Door ${door.id}] Using wall base elevation (manual): ${wallBaseElevation * scale}mm (absolute value, no storey)`);
      return wallBaseElevation * scale;
    }
    
    // Default: use minimum room base elevation from rooms containing this wall
    // This matches exactly how walls are positioned when not manually set
    let roomBaseElevation = 0;
    let roomsContainingWallCount = 0;
    
    // Try to find rooms containing this wall if wallData exists
    if (instance.project && instance.project.rooms && wallData) {
      const roomsContainingWall = [];
      const targetWallId = String(wallData.id);
      
      // Get rooms from instance.project.rooms that contain this wall
      instance.project.rooms.forEach(r => {
        const roomWalls = Array.isArray(r.walls) ? r.walls : [];
        const hasWall = roomWalls.some(w => {
          const wallId = typeof w === 'object' ? w.id : w;
          return String(wallId) === targetWallId;
        });
        
        if (hasWall) {
          roomsContainingWall.push(r);
        }
      });
      
      roomsContainingWallCount = roomsContainingWall.length;
      
      // Get minimum base_elevation_mm from rooms containing this wall (absolute value)
      if (roomsContainingWall.length > 0) {
        const baseElevations = roomsContainingWall
          .map(r => r.base_elevation_mm)
          .filter(elev => elev !== undefined && elev !== null && !isNaN(elev))
          .map(elev => Number(elev));
        
        if (baseElevations.length > 0) {
          roomBaseElevation = Math.min(...baseElevations);
        } else {
          // Fallback to door's room base_elevation_mm if no room base elevations found
          roomBaseElevation = (room?.base_elevation_mm !== undefined && room?.base_elevation_mm !== null && !isNaN(room.base_elevation_mm)) 
            ? Number(room.base_elevation_mm) 
            : 0;
        }
      } else {
        // No rooms found containing this wall, fallback to door's room base_elevation_mm
        roomBaseElevation = (room?.base_elevation_mm !== undefined && room?.base_elevation_mm !== null && !isNaN(room.base_elevation_mm)) 
          ? Number(room.base_elevation_mm) 
          : 0;
      }
    } else if (room) {
      // If wallData not found but room exists, use room's base elevation
      roomBaseElevation = (room.base_elevation_mm !== undefined && room.base_elevation_mm !== null && !isNaN(room.base_elevation_mm))
        ? Number(room.base_elevation_mm)
        : 0;
    } else {
      // Final fallback: use 0 (floor level)
      // This should only happen if wall and room data are both unavailable
      roomBaseElevation = 0;
      console.warn(`[Door ${door.id}] WARNING: No wall or room data found, using floor level (0mm)`);
    }
    
    console.log(`[Door ${door.id}] Using room base elevation: ${roomBaseElevation * scale}mm (wallData: ${wallData ? 'found' : 'not found'}, room: ${room ? 'found' : 'not found'}, roomsContainingWall: ${roomsContainingWallCount})`);
    return roomBaseElevation * scale;
  };
  
  const doorBaseElevation = getDoorBaseElevation();
  
  // Get floor thickness to raise door above the floor
  // Floors are positioned at baseElevation and extend upward by floorThickness
  // Doors should sit on top of the floor, so we add floorThickness to the base elevation
  // Try to get floor thickness from rooms containing the wall (similar to base elevation logic)
  let floorThickness = 150 * scale; // Default: 150mm
  if (instance.project && instance.project.rooms && wallData) {
    const roomsContainingWall = [];
    const targetWallId = String(wallData.id);
    
    // Get rooms from instance.project.rooms that contain this wall
    instance.project.rooms.forEach(r => {
      const roomWalls = Array.isArray(r.walls) ? r.walls : [];
      const hasWall = roomWalls.some(w => {
        const wallId = typeof w === 'object' ? w.id : w;
        return String(wallId) === targetWallId;
      });
      
      if (hasWall) {
        roomsContainingWall.push(r);
      }
    });
    
    // Get floor thickness from rooms containing this wall (use first available)
    if (roomsContainingWall.length > 0) {
      const floorThicknesses = roomsContainingWall
        .map(r => r.floor_thickness)
        .filter(thickness => thickness !== undefined && thickness !== null && !isNaN(thickness))
        .map(thickness => Number(thickness));
      
      if (floorThicknesses.length > 0) {
        // Use the first available floor thickness (could also use average or max if needed)
        floorThickness = floorThicknesses[0] * scale;
      } else if (room && room.floor_thickness !== undefined && room.floor_thickness !== null && !isNaN(room.floor_thickness)) {
        // Fallback to door's room floor thickness
        floorThickness = Number(room.floor_thickness) * scale;
      }
    } else if (room && room.floor_thickness !== undefined && room.floor_thickness !== null && !isNaN(room.floor_thickness)) {
      // No rooms found containing this wall, fallback to door's room floor thickness
      floorThickness = Number(room.floor_thickness) * scale;
    }
  } else if (room && room.floor_thickness !== undefined && room.floor_thickness !== null && !isNaN(room.floor_thickness)) {
    // If wallData not found but room exists, use room's floor thickness
    floorThickness = Number(room.floor_thickness) * scale;
  }
  
  // CRITICAL: All doors should be positioned consistently at (doorBaseElevation + floorThickness) + doorHeight/2
  // This positions the door on top of the floor and centers it vertically on the wall opening
  // Formula: door sits on floor top, so bottom is at (baseElevation + floorThickness), center is at (baseElevation + floorThickness + doorHeight/2)
  const doorYPosition = doorBaseElevation + floorThickness + (doorHeight / 2);
  
  // Debug logging for door positioning
  console.log(`[Door ${door.id}] Positioning:`, {
    doorBaseElevation: doorBaseElevation,
    floorThickness: floorThickness,
    doorHeight: doorHeight,
    doorYPosition: doorYPosition,
    wallId: wallId,
    wallDataFound: !!wallData,
    hasManualBaseElevation: hasManualBaseElevation,
    roomFound: !!room,
    roomFloorThickness: room?.floor_thickness,
    doorType: door_type,
    side: side
  });
  // IMPORTANT: When wall start/end points are flipped, door properties must be adjusted:
  // 1. Swing doors: flip swing direction to maintain correct visual behavior
  // 2. Slide doors: flip side (interior/exterior) to maintain correct visual behavior
  const adjustedSwingDirection = wasWallFlipped ? (swing_direction === 'right' ? 'left' : 'right') : swing_direction;
  const adjustedSlideDirection = slide_direction; // Keep original slide direction
  const adjustedSide = wasWallFlipped ? (side === 'interior' ? 'exterior' : 'interior') : side;
  if (wasWallFlipped) {
    // Door properties adjusted for flipped wall
  }
  // Calculate door width to match cutout width calculation in createWallMesh
  // For double-sided slide doors: use 100% (1.0) to match cutout
  // For single slide doors: use 95% (0.95) to match cutout
  // For dock doors: use 100% (1.0) to match cutout
  // For swing doors: use 105% (1.05) to match cutout
  const isSlideDoor = (door_type === 'slide');
  const isDockDoor = (door_type === 'dock');
  const isDoubleSidedSlide = isSlideDoor && configuration === 'double_sided';
  const doorWidthMultiplier = isDoubleSidedSlide ? 1.0 : isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05;
  const doorWidth = width * scale * doorWidthMultiplier;
  const doorThickness = thickness * instance.scalingFactor;
  const doorMaterial = new instance.THREE.MeshStandardMaterial({
    color: door_type === 'swing' ? 0xF8F8FF : 0xF8F8FF,
    roughness: 0.5,
    metalness: 0.3,
    transparent: true,
    opacity: 1
  });
  if (door_type === 'slide') {
    if (configuration === 'double_sided') {
      // Create double sliding doors
      // Each panel should be exactly half the door width so they touch edge-to-edge when closed
      const halfWidth = doorWidth / 2; // Exactly half - no gap, no overlap
      // Create a door container
      const doorContainer = new instance.THREE.Object3D();
      // Position door centered vertically on wall opening (consistent for all door types)
      doorContainer.position.set(doorPosX, doorYPosition, doorPosZ);
      doorContainer.rotation.y = -wallAngle;
      
      // Create both door panels with window holes
      // Windows are positioned relative to the full door (position_x: 0 to 1)
      // Left panel covers position_x: 0 to 0.5, right panel covers position_x: 0.5 to 1.0
      // Check if windows span across the center - if so, they need cutouts in both panels
      const fullDoorWidth = doorWidth; // Full door width for window span calculation
      const leftDoorWindows = [];
      const rightDoorWindows = [];
      
      (door.windows || []).forEach(w => {
        // Calculate window bounds in full door coordinate system
        // Full door extends from -fullDoorWidth/2 to +fullDoorWidth/2
        const windowCenterX = (w.position_x - 0.5) * fullDoorWidth;
        const windowWidth_scaled = w.width * scale;
        const windowLeft = windowCenterX - windowWidth_scaled / 2;
        const windowRight = windowCenterX + windowWidth_scaled / 2;
        
        // Left panel extends from -fullDoorWidth/2 to 0
        // Right panel extends from 0 to +fullDoorWidth/2
        const leftPanelLeft = -fullDoorWidth / 2;
        const leftPanelRight = 0;
        const rightPanelLeft = 0;
        const rightPanelRight = fullDoorWidth / 2;
        
        // Check if window overlaps with left panel
        if (windowRight > leftPanelLeft && windowLeft < leftPanelRight) {
          // Calculate the portion of window on left panel
          const leftWindowLeft = Math.max(windowLeft, leftPanelLeft);
          const leftWindowRight = Math.min(windowRight, leftPanelRight);
          const leftWindowWidth = leftWindowRight - leftWindowLeft;
          const leftWindowCenterX = (leftWindowLeft + leftWindowRight) / 2;
          
          // Convert to position_x relative to left panel (0 to 1)
          // Left panel extends from -halfWidth to 0 in full door coordinates
          // In panel coordinates: -halfWidth maps to 0, 0 maps to 1
          // position_x = 0.5 means center of panel, 1.0 means right edge (at center of full door)
          // Formula: position_x = (centerX - leftPanelLeft) / halfWidth
          // Since leftPanelLeft = -halfWidth, this becomes: (centerX + halfWidth) / halfWidth
          const leftPanelPositionX = (leftWindowCenterX - leftPanelLeft) / halfWidth;
          
          // Create partial window for left panel with adjusted width
          leftDoorWindows.push({
            ...w,
            position_x: leftPanelPositionX,
            width: leftWindowWidth / scale  // Convert back to unscaled width
          });
        }
        
        // Check if window overlaps with right panel
        if (windowRight > rightPanelLeft && windowLeft < rightPanelRight) {
          // Calculate the portion of window on right panel
          const rightWindowLeft = Math.max(windowLeft, rightPanelLeft);
          const rightWindowRight = Math.min(windowRight, rightPanelRight);
          const rightWindowWidth = rightWindowRight - rightWindowLeft;
          const rightWindowCenterX = (rightWindowLeft + rightWindowRight) / 2;
          
          // Convert to position_x relative to right panel (0 to 1)
          // Right panel extends from 0 to +halfWidth in full door coordinates
          // In panel coordinates: 0 maps to 0, +halfWidth maps to 1
          // position_x = 0.5 means center of panel, 0.0 means left edge (at center of full door)
          // Formula: position_x = (centerX - rightPanelLeft) / halfWidth
          // Since rightPanelLeft = 0, this becomes: centerX / halfWidth
          const rightPanelPositionX = (rightWindowCenterX - rightPanelLeft) / halfWidth;
          
          // Create partial window for right panel with adjusted width
          rightDoorWindows.push({
            ...w,
            position_x: rightPanelPositionX,
            width: rightWindowWidth / scale  // Convert back to unscaled width
          });
        }
      });
      
      // Windows are already adjusted for each panel with correct width and position
      const adjustedLeftWindows = leftDoorWindows;
      const adjustedRightWindows = rightDoorWindows;
      
      // Create doors without offsetX - we'll position them manually
      // BoxGeometry is centered at origin, so a door of width 'halfWidth' extends from -halfWidth/2 to +halfWidth/2
      const leftDoor = createDoorWithWindows(
        instance,
        halfWidth,
        doorHeight,
        doorThickness,
        doorMaterial,
        adjustedLeftWindows,
        scale,
        0  // No offset - position manually
      );
      const rightDoor = createDoorWithWindows(
        instance,
        halfWidth,
        doorHeight,
        doorThickness,
        doorMaterial,
        adjustedRightWindows,
        scale,
        0  // No offset - position manually
      );
      
      // Position doors within the container so they touch edge-to-edge when closed
      // BoxGeometry is centered at origin, so:
      // - Left door: center at -halfWidth/2, extends from -halfWidth to 0
      // - Right door: center at +halfWidth/2, extends from 0 to +halfWidth
      // They touch perfectly at x=0 (right edge of left door touches left edge of right door)
      // For interior doors: position on inner face (Z = wallThickness, toward model center)
      // For exterior doors: position on outer face (Z = 0, database line face)
      if (adjustedSide === 'interior') {
        leftDoor.position.set(-halfWidth/2, 0, -wallDepth/2);
        rightDoor.position.set(halfWidth/2, 0, -wallDepth/2);
      } else {
        leftDoor.position.set(-halfWidth/2, 0, wallDepth * 1.2);
        rightDoor.position.set(halfWidth/2, 0, wallDepth * 1.2);
      }
      // Store original positions
      leftDoor.userData.origPosition = { x: leftDoor.position.x, z: leftDoor.position.z };
      rightDoor.userData.origPosition = { x: rightDoor.position.x, z: rightDoor.position.z };
      // Add to container
      doorContainer.add(leftDoor);
      doorContainer.add(rightDoor);
      // Register as a door object with metadata
      doorContainer.userData.isDoor = true;
      doorContainer.userData.doorId = `door_${door.id}`;
      doorContainer.userData.doorInfo = {
        ...door,
        adjustedSlideDirection: adjustedSlideDirection,
        adjustedSide: adjustedSide
      };
      instance.doorObjects.push(doorContainer);
      instance.doorStates.set(`door_${door.id}`, true); // Start in open state
      
      // Add window glass to double slide door panels
      // For slide doors, glass should be at z = 0 (center of door thickness)
      // Use adjusted windows (with position_x relative to each panel) for correct positioning
      if (adjustedLeftWindows.length > 0) {
        addWindowGlass(instance, leftDoor, adjustedLeftWindows, halfWidth, doorHeight, doorThickness, scale, 0, 0);
      }
      if (adjustedRightWindows.length > 0) {
        addWindowGlass(instance, rightDoor, adjustedRightWindows, halfWidth, doorHeight, doorThickness, scale, 0, 0);
      }
      
      // Animate doors sliding open
      const slideDistance = halfWidth * 0.9;
      if (typeof window !== 'undefined' && window.gsap) {
        window.gsap.to(leftDoor.position, {
          x: -halfWidth/2 - slideDistance,
          z: leftDoor.position.z,
          duration: 1.5,
          ease: 'power2.inOut'
        });
        window.gsap.to(rightDoor.position, {
          x: halfWidth/2 + slideDistance,
          z: rightDoor.position.z,
          duration: 1.5,
          ease: 'power2.inOut'
        });
      }
      return doorContainer;
    } else {
      // Single sliding door
      // Create door container to handle rotation and position
      const doorContainer = new instance.THREE.Object3D();
      // Position door centered vertically on wall opening (consistent for all door types)
      doorContainer.position.set(doorPosX, doorYPosition, doorPosZ);
      doorContainer.rotation.y = -wallAngle;
      
      // Create door with window holes (like swing doors)
      const doorMesh = createDoorWithWindows(
        instance,
        doorWidth,
        doorHeight,
        doorThickness,
        doorMaterial,
        door.windows || [],
        scale,
        0
      );
      
      // Position door at wall face
      // For interior doors: position on inner face (Z = wallThickness, toward model center)
      // For exterior doors: position on outer face (Z = 0, database line face)
      if (adjustedSide === 'exterior') {
        doorMesh.position.z = wallDepth * 1.2;
      } else {
        doorMesh.position.z = -wallDepth/2;
      }
      doorContainer.add(doorMesh);
      // Store original position
      doorMesh.userData.origPosition = { x: 0, z: doorMesh.position.z };
      // Register as a door object with metadata
      doorContainer.userData.isDoor = true;
      doorContainer.userData.doorId = `door_${door.id}`;
      doorContainer.userData.doorInfo = {
        ...door,
        adjustedSlideDirection: adjustedSlideDirection,
        adjustedSide: adjustedSide
      };
      instance.doorObjects.push(doorContainer);
      instance.doorStates.set(`door_${door.id}`, true); // Start in open state
      
      // Add window glass to single slide door
      // For slide doors, glass should be at z = 0 (center of door thickness) in doorMesh local space
      if (door.windows && door.windows.length > 0) {
        addWindowGlass(instance, doorMesh, door.windows, doorWidth, doorHeight, doorThickness, scale, 0, 0);
      }
      
      // Sliding direction
      const rawDirection = adjustedSlideDirection === 'right' ? -1 : 1;
      const slideDirectionSign = adjustedSide === 'exterior' ? -rawDirection : rawDirection;
      const slideDistance = doorWidth * 0.9;
      // Animate door sliding
      if (typeof window !== 'undefined' && window.gsap) {
        window.gsap.to(doorMesh.position, {
          x: slideDistance * slideDirectionSign,
          duration: 1.5,
          ease: 'power2.inOut'
        });
      }
      return doorContainer;
    }
  }
  // === SWING DOOR IMPLEMENTATION ===
  else if (door_type === 'swing') {
    if (configuration === 'double_sided') {
      const halfWidth = doorWidth * 0.5;
      const doorContainer = new instance.THREE.Object3D();
      // Position door centered vertically on wall opening (consistent for all door types)
      doorContainer.position.set(doorPosX, doorYPosition, doorPosZ);
      doorContainer.rotation.y = -wallAngle;
      const leftPivot = new instance.THREE.Object3D();
      leftPivot.position.set(-cutoutWidth/2 + 0.1, 0, 0);
      doorContainer.add(leftPivot);
      const rightPivot = new instance.THREE.Object3D();
      rightPivot.position.set(cutoutWidth/2 - 0.1, 0, 0);
      doorContainer.add(rightPivot);
      // Create door panels with window holes
      // Left panel: windows on left half of door
      const leftPanelWindows = (door.windows || []).filter(w => (w.position_x - 0.5) * doorWidth < 0);
      const leftPanel = createDoorWithWindows(
        instance,
        halfWidth,
        doorHeight,
        doorThickness,
        doorMaterial,
        leftPanelWindows,
        scale,
        halfWidth / 2 // Offset to align with door center
      );
      // Translate left panel geometry to correct position
      leftPanel.children.forEach(child => {
        if (child.geometry) {
          child.geometry.translate(halfWidth / 2, 0, +(wallDepth / 2));
        }
      });
      leftPanel.position.set(0, 0, 0);
      
      // Right panel: windows on right half of door
      const rightPanelWindows = (door.windows || []).filter(w => (w.position_x - 0.5) * doorWidth >= 0);
      const rightPanel = createDoorWithWindows(
        instance,
        halfWidth,
        doorHeight,
        doorThickness,
        doorMaterial,
        rightPanelWindows,
        scale,
        -halfWidth / 2 // Offset to align with door center
      );
      // Translate right panel geometry to correct position
      rightPanel.children.forEach(child => {
        if (child.geometry) {
          child.geometry.translate(-halfWidth / 2, 0, +(wallDepth / 2));
        }
      });
      rightPanel.position.set(0, 0, 0);
      
      leftPivot.add(leftPanel);
      rightPivot.add(rightPanel);
      
      // Add window glass to panels
      // For double swing doors, the door panel geometry is translated by +(wallDepth / 2) in z
      // So the glass should also be at z = wallDepth/2 in the panel's local space to match
      if (leftPanelWindows.length > 0) {
        addWindowGlass(instance, leftPanel, leftPanelWindows, halfWidth, doorHeight, doorThickness, scale, halfWidth / 2, wallDepth / 2);
      }
      if (rightPanelWindows.length > 0) {
        addWindowGlass(instance, rightPanel, rightPanelWindows, halfWidth, doorHeight, doorThickness, scale, -halfWidth / 2, wallDepth / 2);
      }
      
      doorContainer.userData.isDoor = true;
      doorContainer.userData.doorId = `door_${door.id}`;
      doorContainer.userData.doorInfo = {
        ...door,
        adjustedSwingDirection: adjustedSwingDirection,
        adjustedSide: adjustedSide
      };
      instance.doorObjects.push(doorContainer);
      instance.doorStates.set(`door_${door.id}_left`, true);
      instance.doorStates.set(`door_${door.id}_right`, true);
      
      // For double-sided doors, the swing angles are determined by the side (interior/exterior)
      // When the wall is flipped, the side is adjusted, so the angles are automatically correct
      const leftAngle = Math.PI / 2 * (adjustedSide === 'exterior' ? 1 : -1);
      const rightAngle = Math.PI / 2 * (adjustedSide === 'exterior' ? -1 : 1);
      if (wasWallFlipped) {
        // Double door swing angles calculated with adjusted side
      }
      if (typeof window !== 'undefined' && window.gsap) {
        window.gsap.to(leftPanel.rotation, {
          y: leftAngle,
          duration: 1.5,
          ease: 'power2.inOut'
        });
        window.gsap.to(rightPanel.rotation, {
          y: rightAngle,
          duration: 1.5,
          ease: 'power2.inOut'
        });
      }
      return doorContainer;
    } else {
      const hingeOnRight = adjustedSwingDirection === 'right';
      const mountedInside = adjustedSide === 'interior';
      const doorContainer = new instance.THREE.Object3D();
      // Position door centered vertically on wall opening (consistent for all door types)
      doorContainer.position.set(doorPosX, doorYPosition, doorPosZ);
      doorContainer.rotation.y = -wallAngle;
      // IMPORTANT: When wall is flipped, the hinge position should also be flipped
      // to maintain correct visual behavior. The hinge should stay on the same relative side
      // of the door opening, regardless of wall flipping.
      let effectiveHingeOnRight = mountedInside ? !hingeOnRight : hingeOnRight;
      if (wasWallFlipped) {
        effectiveHingeOnRight = !effectiveHingeOnRight;
        // Hinge position flipped for wall flip
      }
      const pivotX = effectiveHingeOnRight ? cutoutWidth/2 - 0.1 : -cutoutWidth/2 + 0.1;
      const pivot = new instance.THREE.Object3D();
      pivot.position.set(pivotX, 0, 0);
      doorContainer.add(pivot);
      // Create door with window holes
      const offsetX = effectiveHingeOnRight ? -doorWidth/2 : doorWidth/2;
      const doorPanel = createDoorWithWindows(
        instance,
        doorWidth,
        doorHeight,
        doorThickness,
        doorMaterial,
        door.windows || [],
        scale,
        offsetX
      );
      doorPanel.position.set(0, 0, +(wallDepth / 2));
      pivot.add(doorPanel);
      
      // Add window glass in the holes
      // For swing doors, the door panel is positioned at z = wallDepth/2 in pivot's local space
      // But the glass should be at z = 0 in the door panel's local space (centered in door thickness)
      if (door.windows && door.windows.length > 0) {
        addWindowGlass(instance, doorPanel, door.windows, doorWidth, doorHeight, doorThickness, scale, offsetX, 0);
      }
      
      doorContainer.userData.isDoor = true;
      doorContainer.userData.doorId = `door_${door.id}`;
      doorContainer.userData.doorInfo = {
        ...door,
        adjustedSwingDirection: adjustedSwingDirection,
        adjustedSide: adjustedSide,
        effectiveHingeOnRight: effectiveHingeOnRight
      };
      instance.doorObjects.push(doorContainer);
      instance.doorStates.set(`door_${door.id}`, true);
      
      let baseDir = 0;
      if (mountedInside) {
        baseDir = effectiveHingeOnRight ? 1 : -1;
      } else {
        baseDir = effectiveHingeOnRight ? -1 : 1;
      }
      const swingAngle = Math.PI / 2 * baseDir;
      if (typeof window !== 'undefined' && window.gsap) {
        window.gsap.to(doorPanel.rotation, {
          y: swingAngle,
          duration: 1.5,
          ease: 'power2.inOut'
        });
      }
      return doorContainer;
    }
  }
  // === DOCK DOOR IMPLEMENTATION ===
  else if (door_type === 'dock') {
    // Dock door: Just create a cover panel that can be shown/hidden
    // The hole is already created in the wall mesh
    // Dock doors (卷帘门) open upward, so no side or direction settings needed
    const doorContainer = new instance.THREE.Object3D();
    // Position door centered vertically on wall opening (consistent for all door types)
    doorContainer.position.set(doorPosX, doorYPosition, doorPosZ);
    doorContainer.rotation.y = -wallAngle;
    // Create a cover panel (flat rectangle) that covers the door opening
    const coverMaterial = new instance.THREE.MeshStandardMaterial({
      color: 0xCCCCCC, // Gray color for dock door cover
      roughness: 0.7,
      metalness: 0.2,
      transparent: false,
      opacity: 1
    });
    // Create cover panel - positioned at the wall face (exterior side by default)
    const coverPanel = new instance.THREE.Mesh(
      new instance.THREE.BoxGeometry(cutoutWidth, doorHeight, 0.1 * instance.scalingFactor), // Thin cover
      coverMaterial
    );
    // Position cover on exterior side of the wall (dock doors typically face outward)
    coverPanel.position.z = wallDepth * 1.2;
    // Start with cover hidden (door open by default)
    coverPanel.visible = false;
    coverPanel.userData.isCoverPanel = true; // Mark as cover panel for easy lookup
    doorContainer.add(coverPanel);
    // Register as a door object with metadata
    doorContainer.userData.isDoor = true;
    doorContainer.userData.doorId = `door_${door.id}`;
    doorContainer.userData.doorInfo = {
      ...door,
      coverPanel: coverPanel // Store reference to cover panel
    };
    instance.doorObjects.push(doorContainer);
    instance.doorStates.set(`door_${door.id}`, true); // Start open (cover hidden)
    return doorContainer;
  }
  return null;
}