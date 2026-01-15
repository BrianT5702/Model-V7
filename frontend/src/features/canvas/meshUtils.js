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
  const { start_x, start_y, end_x, end_y, height, thickness, id, fill_gap_mode, gap_fill_height, gap_base_position } = wall;
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
  // Store coordinates AFTER flip but BEFORE extension (for accurate extension distance calculation)
  const afterFlipStartX = finalStartX;
  const afterFlipStartZ = finalStartZ;
  const afterFlipEndX = finalEndX;
  const afterFlipEndZ = finalEndZ;
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
  // Track face positions for debugging and verification
  const extensionStartDist = Math.hypot(finalStartX - originalStartX, finalStartZ - originalStartZ);
  const extensionEndDist = Math.hypot(finalEndX - originalEndX, finalEndZ - originalEndZ);
  const wasExtended = extensionStartDist > 0.001 || extensionEndDist > 0.001;
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
  // Calculate inner and outer face positions
  const outerStart = { x: finalStartX, z: finalStartZ };
  const outerEnd = { x: finalEndX, z: finalEndZ };
  const innerStart = {
    x: finalStartX + finalNormX * wallThickness,
    z: finalStartZ + finalNormZ * wallThickness
  };
  const innerEnd = {
    x: finalEndX + finalNormX * wallThickness,
    z: finalEndZ + finalNormZ * wallThickness
  };
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
    const doorWidth = door.width * scale;
    const cutoutWidth = doorWidth * (isSlideDoor ? 0.95 : isDockDoor ? 1.0 : 1.05);
    const doorHeight = door.height * scale * 1.02;
    // If wall was flipped, flip the door position
    const adjustedPositionX = wasWallFlipped ? (1 - door.position_x) : door.position_x;
    const doorPos = adjustedPositionX * finalWallLength;
    if (wasWallFlipped) {
      // Door position adjusted for flipped wall
    }
    return {
      start: Math.max(0, doorPos - cutoutWidth / 2),
      end: Math.min(finalWallLength, doorPos + cutoutWidth / 2),
      height: doorHeight,
      doorInfo: door
    };
  });
  // Shape already closed above
  for (const cutout of cutouts) {
    const doorHole = new instance.THREE.Path();
    doorHole.moveTo(cutout.start, 0);
    doorHole.lineTo(cutout.end, 0);
    doorHole.lineTo(cutout.end, cutout.height);
    doorHole.lineTo(cutout.start, cutout.height);
    doorHole.lineTo(cutout.start, 0);
    wallShape.holes.push(doorHole);
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
  for (const cutout of cutouts) {
    const mid = (cutout.start + cutout.end) / 2;
    const centerX = finalStartX + (finalDx / finalWallLength) * mid;
    const centerZ = finalStartZ + (finalDz / finalWallLength) * mid;
    const doorX = centerX + instance.modelOffset.x;
    const doorZ = centerZ + instance.modelOffset.z;
    
    // Ensure windows are preserved when setting calculatedPosition
    const doorInfo = cutout.doorInfo;
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
    
    // Debug: Log if door has windows
    if (doorInfo.windows && doorInfo.windows.length > 0) {
      console.log(`[createWallMesh] Door ${doorInfo.id} has ${doorInfo.windows.length} window(s) when setting calculatedPosition`);
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
  // If no windows, create a simple box door
  if (!windows || windows.length === 0) {
    const doorGeometry = new instance.THREE.BoxGeometry(doorWidth, doorHeight, doorThickness);
    if (offsetX !== 0) {
      doorGeometry.translate(offsetX, 0, 0);
    }
    return new instance.THREE.Mesh(doorGeometry, doorMaterial);
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
    
    // Position window glass in the center of the door thickness (visible from both sides)
    // zPos defaults to 0 (center), but can be set for swing doors (wallDepth/2)
    // The glass should be centered at zPos, extending from zPos - windowThickness/2 to zPos + windowThickness/2
    
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
  // FLOOR PLACEMENT NOTE: 
  // - Swing doors: Positioned at doorHeight/2 (centered vertically) - working perfectly, DO NOT TOUCH
  // - Slide doors: Positioned at (doorHeight/2) + floorThickness to avoid floor intersection
  // Since floors now extend upward from Y=0 to Y=+thickness, slide doors are explicitly positioned above
  // the floor thickness while swing doors maintain their perfect positioning.
  //
  // BASE ELEVATION NOTE:
  // - If wall has base_elevation_manual=true, use wall's base_elevation_mm (ignoring room base elevation)
  // - Otherwise, use room's base_elevation_mm (default behavior)
  // - Always add storey elevation to the base elevation
  const { x: doorPosX, z: doorPosZ, angle: wallAngle, width: cutoutWidth, height: doorHeight, depth: wallDepth, wasWallFlipped } = door.calculatedPosition;
  const scale = instance.scalingFactor;
  const { width, thickness, door_type, swing_direction, slide_direction, side, configuration } = door;
  
  // Find the wall data object from the door's wall reference
  // The 'wall' parameter might be null or a Three.js mesh, so we need to look it up from instance.walls
  const wallId = door.wall || door.wall_id;
  const wallData = wallId ? instance.walls?.find(w => String(w.id) === String(wallId)) : null;
  const hasManualBaseElevation = wallData && wallData.base_elevation_manual;
  
  // Get room data for comparison
  const room = instance.project?.rooms?.find(r => r.id === door.room);
  
  // Helper function to get the correct base elevation for door positioning
  const getDoorBaseElevation = () => {
    // If wall has manual base elevation, use it (ignoring room base elevation)
    if (hasManualBaseElevation) {
      let wallBaseElevation = wallData.base_elevation_mm ?? 0;
      
      // Add storey elevation if wall has a storey
      if (instance.project && instance.project.storeys && (wallData.storey || wallData.storey_id)) {
        const wallStoreyId = wallData.storey ?? wallData.storey_id;
        const wallStorey = instance.project.storeys.find(s => 
          String(s.id) === String(wallStoreyId)
        );
        const storeyElevation = wallStorey ? (wallStorey.elevation_mm ?? 0) : 0;
        wallBaseElevation = storeyElevation + wallBaseElevation;
      }
      
      console.log(`[Door ${door.id}] Using wall base elevation (manual): ${wallBaseElevation * scale}mm`);
      return wallBaseElevation * scale;
    }
    
    // Default: use room's base elevation
    const roomBaseElevation = (room?.base_elevation_mm ?? 0) * scale;
    console.log(`[Door ${door.id}] Using room base elevation: ${roomBaseElevation}mm`);
    return roomBaseElevation;
  };
  
  const doorBaseElevation = getDoorBaseElevation();
  
  // Helper function to check if wall base elevation matches room base elevation (considering storey)
  const shouldAddFloorThickness = () => {
    // If no manual base elevation, always add floor thickness (normal behavior)
    if (!hasManualBaseElevation) {
      return true;
    }
    
    // If manual base elevation, check if it matches room base elevation
    if (hasManualBaseElevation && wallData && room) {
      // Calculate wall's total base elevation (wall base + storey)
      let wallBaseElevation = wallData.base_elevation_mm ?? 0;
      if (instance.project && instance.project.storeys && (wallData.storey || wallData.storey_id)) {
        const wallStoreyId = wallData.storey ?? wallData.storey_id;
        const wallStorey = instance.project.storeys.find(s => 
          String(s.id) === String(wallStoreyId)
        );
        const storeyElevation = wallStorey ? (wallStorey.elevation_mm ?? 0) : 0;
        wallBaseElevation = storeyElevation + wallBaseElevation;
      }
      
      // Calculate room's total base elevation (room base + storey)
      let roomBaseElevation = room.base_elevation_mm ?? 0;
      if (instance.project && instance.project.storeys && (room.storey || room.storey_id)) {
        const roomStoreyId = room.storey ?? room.storey_id;
        const roomStorey = instance.project.storeys.find(s => 
          String(s.id) === String(roomStoreyId)
        );
        const storeyElevation = roomStorey ? (roomStorey.elevation_mm ?? 0) : 0;
        roomBaseElevation = storeyElevation + roomBaseElevation;
      }
      
      // If wall base elevation equals room base elevation, add floor thickness
      // Otherwise (wall is at different elevation), don't add floor thickness
      const isSameElevation = Math.abs(wallBaseElevation - roomBaseElevation) < 0.1; // Small tolerance for floating point
      console.log(`[Door ${door.id}] Wall base=${wallBaseElevation}mm, Room base=${roomBaseElevation}mm, Same=${isSameElevation}`);
      return isSameElevation;
    }
    
    // Default: don't add floor thickness if manual elevation is set
    return false;
  };
  
  const addFloorThickness = shouldAddFloorThickness();
  // IMPORTANT: When wall start/end points are flipped, door properties must be adjusted:
  // 1. Swing doors: flip swing direction to maintain correct visual behavior
  // 2. Slide doors: flip side (interior/exterior) to maintain correct visual behavior
  const adjustedSwingDirection = wasWallFlipped ? (swing_direction === 'right' ? 'left' : 'right') : swing_direction;
  const adjustedSlideDirection = slide_direction; // Keep original slide direction
  const adjustedSide = wasWallFlipped ? (side === 'interior' ? 'exterior' : 'interior') : side;
  if (wasWallFlipped) {
    // Door properties adjusted for flipped wall
  }
  const doorWidth = width * scale * 1.05;
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
      const halfWidth = doorWidth * 0.48; // Slightly less than half to fit with gap
      // Create a door container
      const doorContainer = new instance.THREE.Object3D();
      // For slide doors: position above floor thickness to avoid intersection
      // If wall has manual base elevation that matches room base elevation, add floor thickness
      // Otherwise, door starts from wall bottom (no floor thickness)
      let adjustedY;
      if (addFloorThickness) {
        // Add floor thickness above base elevation
        const floorThickness = room?.floor_thickness || 150;
        adjustedY = doorBaseElevation + (doorHeight/2) + (floorThickness * instance.scalingFactor);
      } else {
        // Door starts from wall bottom, centered vertically (no floor thickness)
        adjustedY = doorBaseElevation + (doorHeight/2);
      }
      doorContainer.position.set(doorPosX, adjustedY, doorPosZ);
      doorContainer.rotation.y = -wallAngle;
      
      // Create both door panels with window holes
      const leftDoorWindows = (door.windows || []).filter(w => (w.position_x - 0.5) * doorWidth < 0);
      const rightDoorWindows = (door.windows || []).filter(w => (w.position_x - 0.5) * doorWidth >= 0);
      
      const leftDoor = createDoorWithWindows(
        instance,
        halfWidth,
        doorHeight,
        doorThickness,
        doorMaterial,
        leftDoorWindows,
        scale,
        halfWidth / 2
      );
      const rightDoor = createDoorWithWindows(
        instance,
        halfWidth,
        doorHeight,
        doorThickness,
        doorMaterial,
        rightDoorWindows,
        scale,
        -halfWidth / 2
      );
      
      // Position doors within the container, with proper offset for the wall side
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
      if (leftDoorWindows.length > 0) {
        addWindowGlass(instance, leftDoor, leftDoorWindows, halfWidth, doorHeight, doorThickness, scale, halfWidth / 2, 0);
      }
      if (rightDoorWindows.length > 0) {
        addWindowGlass(instance, rightDoor, rightDoorWindows, halfWidth, doorHeight, doorThickness, scale, -halfWidth / 2, 0);
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
      const doorMesh = new instance.THREE.Mesh(
        new instance.THREE.BoxGeometry(doorWidth, doorHeight, doorThickness),
        doorMaterial
      );
      // Create door container to handle rotation and position
      const doorContainer = new instance.THREE.Object3D();
      // For slide doors: position above floor thickness to avoid intersection
      // If wall has manual base elevation that matches room base elevation, add floor thickness
      // Otherwise, door starts from wall bottom (no floor thickness)
      let adjustedY;
      if (addFloorThickness) {
        // Add floor thickness above base elevation
        const floorThickness = room?.floor_thickness || 150;
        adjustedY = doorBaseElevation + (doorHeight/2) + (floorThickness * instance.scalingFactor);
      } else {
        // Door starts from wall bottom, centered vertically (no floor thickness)
        adjustedY = doorBaseElevation + (doorHeight/2);
      }
      doorContainer.position.set(doorPosX, adjustedY, doorPosZ);
      doorContainer.rotation.y = -wallAngle;
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
      if (door.windows && door.windows.length > 0) {
        addWindowGlass(instance, doorMesh, door.windows, doorWidth, doorHeight, doorThickness, scale, 0);
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
      doorContainer.position.set(doorPosX, doorBaseElevation + doorHeight/2, doorPosZ);
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
      doorContainer.position.set(doorPosX, doorBaseElevation + doorHeight/2, doorPosZ);
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
    doorContainer.position.set(doorPosX, doorBaseElevation + doorHeight/2, doorPosZ);
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