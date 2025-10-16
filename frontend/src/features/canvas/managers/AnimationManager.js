// Animation management module for Three.js 3D system
import { THREE_CONFIG } from '../threeConfig';

export class AnimationManager {
  constructor(instance) {
    this.instance = instance;
    this.activeAnimations = new Set();
    this.gsap = instance.gsap || window.gsap;
  }

  // Animate camera to interior view
  animateToInteriorView(modelCenter) {
    if (!this.gsap) return;

    const duration = THREE_CONFIG.ANIMATION.CAMERA_DURATION;
    const ease = THREE_CONFIG.ANIMATION.EASE;

    // Kill existing camera animations
    this.killCameraAnimations();

    // Animate camera position
    const interiorAnimation = this.gsap.to(this.instance.camera.position, {
      x: modelCenter.x + 50,
      y: 250,
      z: modelCenter.z + 50,
      duration,
      ease,
      onComplete: () => this.activeAnimations.delete(interiorAnimation)
    });

    this.activeAnimations.add(interiorAnimation);

    // Animate camera target
    const targetAnimation = this.gsap.to(this.instance.controls.target, {
      x: modelCenter.x,
      y: 0,
      z: modelCenter.z,
      duration,
      ease,
      onComplete: () => this.activeAnimations.delete(targetAnimation)
    });

    this.activeAnimations.add(targetAnimation);

    return { interiorAnimation, targetAnimation };
  }

  // Animate camera to exterior view
  animateToExteriorView(modelCenter) {
    if (!this.gsap) return;

    const duration = THREE_CONFIG.ANIMATION.CAMERA_DURATION;
    const ease = THREE_CONFIG.ANIMATION.EASE;

    // Kill existing camera animations
    this.killCameraAnimations();

    // Animate camera position
    const exteriorAnimation = this.gsap.to(this.instance.camera.position, {
      x: modelCenter.x + 200,
      y: 200,
      z: modelCenter.z + 200,
      duration,
      ease,
      onComplete: () => this.activeAnimations.delete(exteriorAnimation)
    });

    this.activeAnimations.add(exteriorAnimation);

    // Animate camera target
    const targetAnimation = this.gsap.to(this.instance.controls.target, {
      x: modelCenter.x,
      y: 0,
      z: modelCenter.z,
      duration,
      ease,
      onComplete: () => this.activeAnimations.delete(targetAnimation)
    });

    this.activeAnimations.add(targetAnimation);

    return { exteriorAnimation, targetAnimation };
  }

  // Animate door opening/closing
  animateDoor(doorMesh, isOpening) {
    if (!this.gsap) return;

    const duration = THREE_CONFIG.ANIMATION.DOOR_DURATION;
    const ease = THREE_CONFIG.ANIMATION.EASE;

    const doorFrame = doorMesh.children.find(child => child.userData.isDoorFrame);
    const doorPanel = doorMesh.children.find(child => child.userData.isDoorPanel);

    if (doorFrame && doorPanel) {
      // Kill existing door animations
      this.gsap.killTweensOf(doorPanel.rotation);

      if (isOpening) {
        // Open door
        const openAnimation = this.gsap.to(doorPanel.rotation, {
          y: doorPanel.userData.openAngle || Math.PI / 2,
          duration,
          ease,
          onComplete: () => this.activeAnimations.delete(openAnimation)
        });
        this.activeAnimations.add(openAnimation);
      } else {
        // Close door
        const closeAnimation = this.gsap.to(doorPanel.rotation, {
          y: 0,
          duration,
          ease,
          onComplete: () => this.activeAnimations.delete(closeAnimation)
        });
        this.activeAnimations.add(closeAnimation);
      }
    }
  }

  // Animate object visibility
  animateVisibility(objects, visible, duration = 0.5) {
    if (!this.gsap) return;

    objects.forEach(obj => {
      if (obj) {
        const visibilityAnimation = this.gsap.to(obj, {
          visible,
          duration,
          ease: THREE_CONFIG.ANIMATION.EASE,
          onComplete: () => this.activeAnimations.delete(visibilityAnimation)
        });
        this.activeAnimations.add(visibilityAnimation);
      }
    });
  }

  // Animate object position
  animatePosition(object, targetPosition, duration = 1.0) {
    if (!this.gsap || !object) return;

    const positionAnimation = this.gsap.to(object.position, {
      x: targetPosition.x,
      y: targetPosition.y,
      z: targetPosition.z,
      duration,
      ease: THREE_CONFIG.ANIMATION.EASE,
      onComplete: () => this.activeAnimations.delete(positionAnimation)
    });

    this.activeAnimations.add(positionAnimation);
    return positionAnimation;
  }

  // Animate object rotation
  animateRotation(object, targetRotation, duration = 1.0) {
    if (!this.gsap || !object) return;

    const rotationAnimation = this.gsap.to(object.rotation, {
      x: targetRotation.x,
      y: targetRotation.y,
      z: targetRotation.z,
      duration,
      ease: THREE_CONFIG.ANIMATION.EASE,
      onComplete: () => this.activeAnimations.delete(rotationAnimation)
    });

    this.activeAnimations.add(rotationAnimation);
    return rotationAnimation;
  }

  // Animate object scale
  animateScale(object, targetScale, duration = 1.0) {
    if (!this.gsap || !object) return;

    const scaleAnimation = this.gsap.to(object.scale, {
      x: targetScale.x,
      y: targetScale.y,
      z: targetScale.z,
      duration,
      ease: THREE_CONFIG.ANIMATION.EASE,
      onComplete: () => this.activeAnimations.delete(scaleAnimation)
    });

    this.activeAnimations.add(scaleAnimation);
    return scaleAnimation;
  }

  // Kill all active animations
  killAllAnimations() {
    this.activeAnimations.forEach(animation => {
      if (animation.kill) {
        animation.kill();
      }
    });
    this.activeAnimations.clear();
  }

  // Kill camera animations specifically
  killCameraAnimations() {
    if (this.gsap) {
      this.gsap.killTweensOf(this.instance.camera.position);
      this.gsap.killTweensOf(this.instance.controls.target);
    }
  }

  // Kill door animations specifically
  killDoorAnimations() {
    if (this.gsap) {
      // Kill all door rotation animations
      this.instance.scene.traverse((child) => {
        if (child.userData && child.userData.isDoor) {
          this.gsap.killTweensOf(child.rotation);
        }
      });
    }
  }

  // Get active animation count
  getActiveAnimationCount() {
    return this.activeAnimations.size;
  }

  // Check if any animations are running
  hasActiveAnimations() {
    return this.activeAnimations.size > 0;
  }

  // Create a sequence of animations
  createSequence(animations, onComplete) {
    if (!this.gsap) return;

    const timeline = this.gsap.timeline({
      onComplete: () => {
        this.activeAnimations.delete(timeline);
        if (onComplete) onComplete();
      }
    });

    animations.forEach(animation => {
      timeline.add(animation);
    });

    this.activeAnimations.add(timeline);
    return timeline;
  }

  // Animate multiple objects in parallel
  animateParallel(objects, animationConfig, onComplete) {
    if (!this.gsap) return;

    const animations = objects.map(obj => {
      return this.gsap.to(obj, {
        ...animationConfig,
        onComplete: () => this.activeAnimations.delete(animations)
      });
    });

    animations.forEach(animation => this.activeAnimations.add(animation));

    if (onComplete) {
      this.gsap.delayedCall(
        animationConfig.duration || 1.0,
        onComplete
      );
    }

    return animations;
  }
}

export default AnimationManager;
