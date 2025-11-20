// Event handler utilities for ThreeCanvas3D.js

// Helper function to get coordinates from event (works for both mouse and touch)
function getEventCoordinates(event) {
  if (event.touches && event.touches.length > 0) {
    return { clientX: event.touches[0].clientX, clientY: event.touches[0].clientY };
  }
  return { clientX: event.clientX, clientY: event.clientY };
}

export function onMouseMoveHandler(instance, event) {
  // Calculate mouse position in normalized device coordinates
  const rect = instance.renderer.domElement.getBoundingClientRect();
  const coords = getEventCoordinates(event);
  instance.mouse.x = ((coords.clientX - rect.left) / rect.width) * 2 - 1;
  instance.mouse.y = -((coords.clientY - rect.top) / rect.height) * 2 + 1;

  // Update the raycaster
  instance.raycaster.setFromCamera(instance.mouse, instance.camera);

  // Find intersections with door objects
  const intersects = instance.raycaster.intersectObjects(instance.doorObjects, true);

  // Add a subtle hover effect for doors
  if (intersects.length > 0) {
    let doorObj = intersects[0].object;
    while (doorObj && !doorObj.userData.doorId) {
      doorObj = doorObj.parent;
    }
    if (doorObj && doorObj.material) {
      document.body.style.cursor = 'pointer';
    }
  } else {
    document.body.style.cursor = 'default';
  }
}

// Touch move handler (for mobile hover effect)
// Note: We don't preventDefault here to allow OrbitControls to handle camera rotation/pan
export function onTouchMoveHandler(instance, event) {
  // Only update hover if it's a single touch (multi-touch is for camera control)
  if (event.touches.length === 1) {
    onMouseMoveHandler(instance, event);
  }
}

export function onCanvasClickHandler(instance, event) {
  const rect = instance.renderer.domElement.getBoundingClientRect();
  const coords = getEventCoordinates(event);
  instance.mouse.x = ((coords.clientX - rect.left) / rect.width) * 2 - 1;
  instance.mouse.y = -((coords.clientY - rect.top) / rect.height) * 2 + 1;

  instance.raycaster.setFromCamera(instance.mouse, instance.camera);
  const intersects = instance.raycaster.intersectObjects(instance.doorObjects, true);

  if (intersects.length > 0) {
    let doorObj = intersects[0].object;
    while (doorObj && !doorObj.userData.doorId) {
      doorObj = doorObj.parent;
    }
    if (doorObj && doorObj.userData.doorId) {
      instance.activeDoor = doorObj;
      const isOpen = instance.doorStates.get(doorObj.userData.doorId) || false;
      instance.doorButton.textContent = isOpen ? 'Close Door' : 'Open Door';
      instance.doorButton.disabled = false;
      instance.doorButton.style.opacity = '1';
      instance.doorButton.style.backgroundColor = '#4CAF50';
      if (doorObj.material) {
        const originalColor = doorObj.material.color.clone();
        doorObj.material.color.set(0xffcc00);
        setTimeout(() => {
          doorObj.material.color.copy(originalColor);
        }, 500);
      }
      // Visual feedback
      if (window.gsap) {
        window.gsap.to(instance.doorButton, {
          scale: 1.2,
          duration: 0.2,
          yoyo: true,
          repeat: 1,
          ease: 'power1.inOut'
        });
      }
      return;
    }
  }
  if (instance.activeDoor) {
    instance.activeDoor = null;
    instance.doorButton.textContent = 'No Door Selected';
    instance.doorButton.disabled = true;
    instance.doorButton.style.opacity = '0.7';
    instance.doorButton.style.backgroundColor = '#999999';
  }
}

// Touch start handler (for mobile tap)
// Store touch data per instance to avoid conflicts
const touchData = new WeakMap();

function getTouchData(instance) {
  if (!touchData.has(instance)) {
    touchData.set(instance, {
      touchStartTime: 0,
      touchStartPos: { x: 0, y: 0 }
    });
  }
  return touchData.get(instance);
}

const TAP_THRESHOLD = 300; // milliseconds
const TAP_DISTANCE_THRESHOLD = 10; // pixels

export function onTouchStartHandler(instance, event) {
  // Only track single touch (multi-touch is for camera zoom/pan)
  if (event.touches.length === 1) {
    const data = getTouchData(instance);
    data.touchStartTime = Date.now();
    data.touchStartPos = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }
}

// Touch end handler (for mobile tap to select door)
export function onTouchEndHandler(instance, event) {
  // Only handle single touch end (not multi-touch gestures)
  if (event.touches.length === 0 && event.changedTouches.length === 1) {
    const data = getTouchData(instance);
    const touchEndTime = Date.now();
    const touchEndPos = { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
    const timeDiff = touchEndTime - data.touchStartTime;
    const distance = Math.sqrt(
      Math.pow(touchEndPos.x - data.touchStartPos.x, 2) + 
      Math.pow(touchEndPos.y - data.touchStartPos.y, 2)
    );
    
    // Only treat as tap if it was quick and didn't move much
    // This prevents triggering door selection when user is rotating/panning the camera
    if (timeDiff < TAP_THRESHOLD && distance < TAP_DISTANCE_THRESHOLD) {
      // Create a synthetic event for the click handler
      const syntheticEvent = {
        touches: [{ clientX: touchEndPos.x, clientY: touchEndPos.y }],
        clientX: touchEndPos.x,
        clientY: touchEndPos.y
      };
      onCanvasClickHandler(instance, syntheticEvent);
    }
  }
}

export function toggleDoorHandler(instance) {
  if (!instance.activeDoor) {
    console.log('No door selected to toggle');
    return;
  }
  const doorId = instance.activeDoor.userData.doorId;
  const isCurrentlyOpen = instance.doorStates.get(doorId) || false;
  const newState = !isCurrentlyOpen;
  instance.doorStates.set(doorId, newState);
  const doorInfo = instance.activeDoor.userData.doorInfo;

  // Handle animation based on door type
  if (doorInfo.door_type === 'swing') {
    // Double-sided swing door
    if (doorInfo.configuration === 'double_sided') {
      const doorContainer = instance.activeDoor;
      if (doorContainer.children.length >= 2) {
        const leftPivot = doorContainer.children[0];
        const rightPivot = doorContainer.children[1];
        const leftPanel = leftPivot.children[0];
        const rightPanel = rightPivot.children[0];
        const mountedInside = (doorInfo.adjustedSide || doorInfo.side) === 'interior';
        
        // Debug logging for double swing door toggle
        console.log('[Double Swing Door Toggle] Using properties:', {
          doorId: doorInfo.id,
          originalSide: doorInfo.side,
          adjustedSide: doorInfo.adjustedSide || doorInfo.side,
          mountedInside: mountedInside,
          newState: newState
        });
        const leftAngle = newState ? Math.PI / 2 * (mountedInside ? -1 : 1) : 0;
        const rightAngle = newState ? Math.PI / 2 * (mountedInside ? 1 : -1) : 0;
        if (window.gsap) {
          window.gsap.to(leftPanel.rotation, {
            y: leftAngle,
            duration: 1,
            ease: 'power2.inOut'
          });
          window.gsap.to(rightPanel.rotation, {
            y: rightAngle,
            duration: 1,
            ease: 'power2.inOut'
          });
        }
      }
    } else {
      // Single swing door
      const doorContainer = instance.activeDoor;
      const pivot = doorContainer.children[0];
      const doorPanel = pivot.children[0];
      const mountedInside = (doorInfo.adjustedSide || doorInfo.side) === 'interior';
      const hingeOnRight = (doorInfo.adjustedSwingDirection || doorInfo.swing_direction) === 'right';
      
      // Use stored effectiveHingeOnRight if available, otherwise calculate it
      const effectiveHingeOnRight = doorInfo.effectiveHingeOnRight !== undefined ? 
        doorInfo.effectiveHingeOnRight : (mountedInside ? !hingeOnRight : hingeOnRight);
      
      // Debug logging for swing door toggle
      console.log('[Swing Door Toggle] Using properties:', {
        doorId: doorInfo.id,
        originalSwingDirection: doorInfo.swing_direction,
        adjustedSwingDirection: doorInfo.adjustedSwingDirection || doorInfo.swing_direction,
        originalSide: doorInfo.side,
        adjustedSide: doorInfo.adjustedSide || doorInfo.side,
        mountedInside: mountedInside,
        hingeOnRight: hingeOnRight,
        effectiveHingeOnRight: effectiveHingeOnRight,
        newState: newState
      });
      let baseDir = 0;
      if (mountedInside) {
        baseDir = effectiveHingeOnRight ? 1 : -1;
      } else {
        baseDir = effectiveHingeOnRight ? -1 : 1;
      }
      const targetAngle = newState ? Math.PI / 2 * baseDir : 0;
      if (window.gsap) {
        window.gsap.to(doorPanel.rotation, {
          y: targetAngle,
          duration: 1,
          ease: 'power2.inOut'
        });
      }
    }
  } else if (doorInfo.door_type === 'slide') {
    // Double-sided sliding door
    if (doorInfo.configuration === 'double_sided') {
      const doorContainer = instance.activeDoor;
      if (doorContainer.children.length >= 2) {
        const leftDoor = doorContainer.children[0];
        const rightDoor = doorContainer.children[1];
        const origLeftPos = leftDoor.userData.origPosition || { x: leftDoor.position.x, z: leftDoor.position.z };
        const origRightPos = rightDoor.userData.origPosition || { x: rightDoor.position.x, z: rightDoor.position.z };
        if (!leftDoor.userData.origPosition) {
          leftDoor.userData.origPosition = { ...origLeftPos };
          rightDoor.userData.origPosition = { ...origRightPos };
        }
        const doorWidth = doorInfo.width * instance.scalingFactor;
        const slideDistance = doorWidth * 0.48 * 0.9;
        if (window.gsap) {
          if (newState) {
            window.gsap.to(leftDoor.position, {
              x: origLeftPos.x - slideDistance,
              duration: 1,
              ease: 'power2.inOut'
            });
            window.gsap.to(rightDoor.position, {
              x: origRightPos.x + slideDistance,
              duration: 1,
              ease: 'power2.inOut'
            });
          } else {
            window.gsap.to(leftDoor.position, {
              x: origLeftPos.x,
              duration: 1,
              ease: 'power2.inOut'
            });
            window.gsap.to(rightDoor.position, {
              x: origRightPos.x,
              duration: 1,
              ease: 'power2.inOut'
            });
          }
        }
      }
    } else {
      // Single sliding door
      const doorContainer = instance.activeDoor;
      const doorPanel = doorContainer.children[0];
      const origPos = doorPanel.userData.origPosition || { x: doorPanel.position.x, z: doorPanel.position.z };
      if (!doorPanel.userData.origPosition) {
        doorPanel.userData.origPosition = { ...origPos };
      }
      
      // Use adjusted properties for wall flipping
      const adjustedSlideDirection = doorInfo.adjustedSlideDirection || doorInfo.slide_direction;
      const adjustedSide = doorInfo.adjustedSide || doorInfo.side;
      
      // Debug logging for sliding door toggle
      console.log('[Slide Door Toggle] Using properties:', {
        doorId: doorInfo.id,
        originalSlideDirection: doorInfo.slide_direction,
        adjustedSlideDirection: adjustedSlideDirection,
        originalSide: doorInfo.side,
        adjustedSide: adjustedSide,
        newState: newState
      });
      
      const slideDirection = adjustedSlideDirection === 'right' ? -1 : 1;
      const sideCoefficient = adjustedSide === 'exterior' ? -1 : 1;
      const effectiveDirection = slideDirection * sideCoefficient;
      const slideDistance = doorInfo.width * instance.scalingFactor * 0.9;
      
      if (window.gsap) {
        if (newState) {
          window.gsap.to(doorPanel.position, {
            x: origPos.x + slideDistance * effectiveDirection,
            duration: 1,
            ease: 'power2.inOut'
          });
        } else {
          window.gsap.to(doorPanel.position, {
            x: origPos.x,
            duration: 1,
            ease: 'power2.inOut'
          });
        }
      }
    }
  }
  // Update button text and style
  instance.doorButton.textContent = newState ? 'Close Door' : 'Open Door';
  instance.doorButton.disabled = false;
  instance.doorButton.style.opacity = '1';
  instance.doorButton.style.backgroundColor = '#4CAF50';
} 