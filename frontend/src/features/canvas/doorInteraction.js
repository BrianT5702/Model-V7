/** Shared door open/close state and animation for orbit mode and tour. */

export function isDoorOpen(instance, doorInfo) {
  if (!doorInfo?.id) {
    return true;
  }
  if (doorInfo.door_type === 'swing' && doorInfo.configuration === 'double_sided') {
    const leftOpen = instance.doorStates.get(`door_${doorInfo.id}_left`) || false;
    const rightOpen = instance.doorStates.get(`door_${doorInfo.id}_right`) || false;
    return leftOpen || rightOpen;
  }
  return instance.doorStates.get(`door_${doorInfo.id}`) || false;
}

export function setDoorStateMap(instance, doorInfo, open) {
  if (doorInfo.door_type === 'swing' && doorInfo.configuration === 'double_sided') {
    instance.doorStates.set(`door_${doorInfo.id}_left`, open);
    instance.doorStates.set(`door_${doorInfo.id}_right`, open);
    return;
  }
  instance.doorStates.set(`door_${doorInfo.id}`, open);
}

export function findDoorContainer(instance, doorId) {
  const targetId = String(doorId);
  return (instance.doorObjects || []).find((entry) => {
    const info = entry.userData?.doorInfo;
    return info && String(info.id) === targetId;
  }) || null;
}

export function animateDoorToState(instance, doorContainer, doorInfo, open) {
  if (!doorContainer || !doorInfo) {
    return;
  }

  if (doorInfo.door_type === 'swing') {
    if (doorInfo.configuration === 'double_sided') {
      if (doorContainer.children.length < 2) {
        return;
      }
      const leftPivot = doorContainer.children[0];
      const rightPivot = doorContainer.children[1];
      const leftPanel = leftPivot.children[0];
      const rightPanel = rightPivot.children[0];
      const mountedInside = (doorInfo.adjustedSide || doorInfo.side) === 'interior';
      const leftAngle = open ? Math.PI / 2 * (mountedInside ? -1 : 1) : 0;
      const rightAngle = open ? Math.PI / 2 * (mountedInside ? 1 : -1) : 0;
      if (window.gsap) {
        window.gsap.to(leftPanel.rotation, { y: leftAngle, duration: 0.85, ease: 'power2.inOut' });
        window.gsap.to(rightPanel.rotation, { y: rightAngle, duration: 0.85, ease: 'power2.inOut' });
      } else {
        leftPanel.rotation.y = leftAngle;
        rightPanel.rotation.y = rightAngle;
      }
      return;
    }

    const pivot = doorContainer.children[0];
    const doorPanel = pivot?.children?.[0];
    if (!doorPanel) {
      return;
    }
    const mountedInside = (doorInfo.adjustedSide || doorInfo.side) === 'interior';
    const hingeOnRight = (doorInfo.adjustedSwingDirection || doorInfo.swing_direction) === 'right';
    const effectiveHingeOnRight = doorInfo.effectiveHingeOnRight !== undefined
      ? doorInfo.effectiveHingeOnRight
      : (mountedInside ? !hingeOnRight : hingeOnRight);
    let baseDir = 0;
    if (mountedInside) {
      baseDir = effectiveHingeOnRight ? 1 : -1;
    } else {
      baseDir = effectiveHingeOnRight ? -1 : 1;
    }
    const targetAngle = open ? Math.PI / 2 * baseDir : 0;
    if (window.gsap) {
      window.gsap.to(doorPanel.rotation, { y: targetAngle, duration: 0.85, ease: 'power2.inOut' });
    } else {
      doorPanel.rotation.y = targetAngle;
    }
    return;
  }

  if (doorInfo.door_type === 'slide') {
    if (doorInfo.configuration === 'double_sided') {
      if (doorContainer.children.length < 2) {
        return;
      }
      const leftDoor = doorContainer.children[0];
      const rightDoor = doorContainer.children[1];
      const origLeftPos = leftDoor.userData.origPosition || { x: leftDoor.position.x, z: leftDoor.position.z };
      const origRightPos = rightDoor.userData.origPosition || { x: rightDoor.position.x, z: rightDoor.position.z };
      if (!leftDoor.userData.origPosition) {
        leftDoor.userData.origPosition = { ...origLeftPos };
        rightDoor.userData.origPosition = { ...origRightPos };
      }
      const doorWidth = doorInfo.width * instance.scalingFactor;
      const slideDistance = (doorWidth / 2) * 0.9;
      if (window.gsap) {
        if (open) {
          window.gsap.to(leftDoor.position, { x: origLeftPos.x - slideDistance, duration: 0.85, ease: 'power2.inOut' });
          window.gsap.to(rightDoor.position, { x: origRightPos.x + slideDistance, duration: 0.85, ease: 'power2.inOut' });
        } else {
          window.gsap.to(leftDoor.position, { x: origLeftPos.x, duration: 0.85, ease: 'power2.inOut' });
          window.gsap.to(rightDoor.position, { x: origRightPos.x, duration: 0.85, ease: 'power2.inOut' });
        }
      } else {
        leftDoor.position.x = open ? origLeftPos.x - slideDistance : origLeftPos.x;
        rightDoor.position.x = open ? origRightPos.x + slideDistance : origRightPos.x;
      }
      return;
    }

    const doorPanel = doorContainer.children[0];
    if (!doorPanel) {
      return;
    }
    const origPos = doorPanel.userData.origPosition || { x: doorPanel.position.x, z: doorPanel.position.z };
    if (!doorPanel.userData.origPosition) {
      doorPanel.userData.origPosition = { ...origPos };
    }
    const adjustedSlideDirection = doorInfo.adjustedSlideDirection || doorInfo.slide_direction;
    const adjustedSide = doorInfo.adjustedSide || doorInfo.side;
    const slideDirection = adjustedSlideDirection === 'right' ? -1 : 1;
    const sideCoefficient = adjustedSide === 'exterior' ? -1 : 1;
    const effectiveDirection = slideDirection * sideCoefficient;
    const slideDistance = doorInfo.width * instance.scalingFactor * 0.9;
    if (window.gsap) {
      window.gsap.to(doorPanel.position, {
        x: open ? origPos.x + slideDistance * effectiveDirection : origPos.x,
        duration: 0.85,
        ease: 'power2.inOut',
      });
    } else {
      doorPanel.position.x = open ? origPos.x + slideDistance * effectiveDirection : origPos.x;
    }
    return;
  }

  if (doorInfo.door_type === 'dock') {
    const coverPanel = doorInfo.coverPanel
      || doorContainer.children.find((child) => child.userData?.isCoverPanel);
    if (!coverPanel) {
      return;
    }
    if (window.gsap) {
      window.gsap.to(coverPanel.material, {
        opacity: open ? 0 : 1,
        duration: 0.45,
        ease: 'power2.inOut',
        onComplete: () => {
          coverPanel.visible = !open;
        },
      });
    } else {
      coverPanel.visible = !open;
      if (coverPanel.material) {
        coverPanel.material.opacity = open ? 0 : 1;
      }
    }
  }
}

export function setDoorOpen(instance, doorContainer, open) {
  const doorInfo = doorContainer?.userData?.doorInfo;
  if (!doorInfo) {
    return false;
  }
  if (isDoorOpen(instance, doorInfo) === open) {
    return false;
  }
  setDoorStateMap(instance, doorInfo, open);
  animateDoorToState(instance, doorContainer, doorInfo, open);
  return true;
}

export function toggleDoorContainer(instance, doorContainer) {
  const doorInfo = doorContainer?.userData?.doorInfo;
  if (!doorInfo) {
    return false;
  }
  return setDoorOpen(instance, doorContainer, !isDoorOpen(instance, doorInfo));
}
