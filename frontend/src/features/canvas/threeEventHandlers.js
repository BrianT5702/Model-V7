// Event handler utilities for ThreeCanvas3D.js

import { isDoorOpen, toggleDoorContainer } from './doorInteraction';

export function onMouseMoveHandler(instance, event) {
  if (instance.isTourEngaged?.()) {
    return;
  }
  // Calculate mouse position in normalized device coordinates
  const rect = instance.renderer.domElement.getBoundingClientRect();
  instance.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  instance.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

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

export function onCanvasClickHandler(instance, event) {
  if (instance.roomTourController?.isPlacing?.()) {
    instance.roomTourController.handlePlacementClick(event);
    return;
  }
  if (instance.isTourActive?.()) {
    return;
  }
  const rect = instance.renderer.domElement.getBoundingClientRect();
  instance.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  instance.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  instance.raycaster.setFromCamera(instance.mouse, instance.camera);
  const intersects = instance.raycaster.intersectObjects(instance.doorObjects, true);

  if (intersects.length > 0) {
    let doorObj = intersects[0].object;
    while (doorObj && !doorObj.userData.doorId) {
      doorObj = doorObj.parent;
    }
    if (doorObj && doorObj.userData.doorId) {
      instance.activeDoor = doorObj;
      const doorInfo = doorObj.userData.doorInfo;
      const isOpen = isDoorOpen(instance, doorInfo);
      
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

export function toggleDoorHandler(instance) {
  if (!instance.activeDoor) {
    console.log('No door selected to toggle');
    return;
  }
  toggleDoorContainer(instance, instance.activeDoor);
  const doorInfo = instance.activeDoor.userData.doorInfo;
  const newState = isDoorOpen(instance, doorInfo);
  instance.doorButton.textContent = newState ? 'Close Door' : 'Open Door';
  instance.doorButton.disabled = false;
  instance.doorButton.style.opacity = '1';
  instance.doorButton.style.backgroundColor = '#4CAF50';
} 