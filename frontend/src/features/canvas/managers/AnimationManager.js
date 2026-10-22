// Animation management module for Three.js 3D system
import { THREE_CONFIG } from '../threeConfig';
import { getExteriorCameraFrame, getInteriorCameraFrame } from '../sceneUtils';

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

function smoothstep(edge0, edge1, x) {
  const span = edge1 - edge0;
  if (span <= 0) return x >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - edge0) / span));
  return t * t * (3 - 2 * t);
}

function cameraPose(position, target) {
  const dx = position.x - target.x;
  const dy = position.y - target.y;
  const dz = position.z - target.z;
  const radius = Math.hypot(dx, dy, dz) || 1;
  return {
    theta: Math.atan2(dx, dz),
    phi: Math.acos(Math.min(1, Math.max(-1, dy / radius))),
    radius,
    target: { x: target.x, y: target.y, z: target.z },
  };
}

function isCeilingShell(obj) {
  if (!obj || obj.userData?.isWall || obj.userData?.isFloor || obj.userData?.isDoor) return false;
  if (obj.userData?.isCeilingPanelLine) return false;
  const name = (obj.name || '').toLowerCase();
  return Boolean(obj.userData?.isCeiling || name.includes('ceiling'));
}

function isCeilingSeam(obj) {
  return Boolean(obj?.userData?.isCeilingPanelLine);
}

function collectCeilingPresentation(instance) {
  const shellObjects = [];
  const seamObjects = [];
  const seen = new Set();
  const add = (obj, seam) => {
    if (!obj || seen.has(obj.uuid)) return;
    seen.add(obj.uuid);
    (seam ? seamObjects : shellObjects).push(obj);
  };

  instance.scene?.traverse((obj) => {
    if (isCeilingSeam(obj)) add(obj, true);
    else if (isCeilingShell(obj)) add(obj, false);
  });
  (instance.ceilingPanelLines || []).forEach((line) => add(line, true));

  const seamIds = new Set(seamObjects.map((obj) => obj.uuid));
  return {
    shellObjects: shellObjects.filter((obj) => !seamIds.has(obj.uuid)),
    seamObjects,
  };
}

function rememberMaterial(mat) {
  if (!mat.userData) mat.userData = {};
  if (!mat.userData._viewFadeBase) {
    mat.userData._viewFadeBase = {
      opacity: mat.opacity,
      transparent: !!mat.transparent,
      depthWrite: mat.depthWrite !== false,
      alphaToCoverage: mat.alphaToCoverage,
    };
  }
  return mat.userData._viewFadeBase;
}

function applyObjectFade(objects, amount) {
  const clamped = Math.min(1, Math.max(0, amount));
  const atRest = clamped >= 0.999;
  objects.forEach((obj) => {
    obj.visible = clamped > 0.02;
    obj.traverse((child) => {
      if (!child.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((mat) => {
        if (!mat) return;
        const base = rememberMaterial(mat);
        const nextOpacity = atRest ? base.opacity : base.opacity * clamped;
        const nextTransparent = atRest ? base.transparent : true;
        const nextDepthWrite = atRest ? base.depthWrite : false;
        const nextCoverage = atRest ? base.alphaToCoverage : false;
        if (mat.opacity !== nextOpacity) mat.opacity = nextOpacity;
        if (mat.depthWrite !== nextDepthWrite) mat.depthWrite = nextDepthWrite;
        if ('alphaToCoverage' in mat && mat.alphaToCoverage !== nextCoverage) {
          mat.alphaToCoverage = nextCoverage;
          mat.needsUpdate = true;
        }
        if (mat.transparent !== nextTransparent) {
          mat.transparent = nextTransparent;
          mat.needsUpdate = true;
        }
      });
    });
  });
}

function currentObjectFade(objects) {
  let hiddenFallback = null;
  for (let i = 0; i < objects.length; i += 1) {
    const obj = objects[i];
    if (obj.visible === false) {
      if (hiddenFallback == null) hiddenFallback = 0;
      continue;
    }
    let found = null;
    obj.traverse((child) => {
      if (found != null || !child.material) return;
      const mat = Array.isArray(child.material) ? child.material[0] : child.material;
      if (!mat) return;
      const base = mat.userData?._viewFadeBase?.opacity ?? mat.opacity;
      if (!(base > 0.001)) return;
      found = mat.opacity / base;
    });
    if (found != null) return Math.min(1, Math.max(0, found));
  }
  return hiddenFallback == null ? 1 : hiddenFallback;
}

export class AnimationManager {
  constructor(instance) {
    this.instance = instance;
    this.activeAnimations = new Set();
    this.gsap = instance.gsap || window.gsap;
  }

  // Animate camera to interior view
  animateToInteriorView(modelCenter) {
    return this.animateViewTransition('interior', modelCenter);
  }

  // Animate camera to exterior view
  animateToExteriorView(modelCenter) {
    return this.animateViewTransition('exterior', modelCenter);
  }

  // Crane between the fitted exterior and the overhead cutaway.
  // Orbit around the building on the side the user is already viewing,
  // and fade the roof with the move instead of popping it.
  animateViewTransition(mode, modelCenter) {
    if (!this.gsap || !this.instance.camera) return null;

    this.killCameraAnimations();

    const camera = this.instance.camera;
    const controls = this.instance.controls;
    const fromTarget = controls?.target
      ? { x: controls.target.x, y: controls.target.y, z: controls.target.z }
      : { x: modelCenter?.x || 0, y: 0, z: modelCenter?.z || 0 };
    const from = cameraPose(camera.position, fromTarget);
    const center = modelCenter || { x: fromTarget.x, y: 0, z: fromTarget.z };
    const frame = mode === 'interior'
      ? getInteriorCameraFrame(this.instance, from.theta)
      : getExteriorCameraFrame(this.instance, { azimuth: from.theta });
    const toPosition = frame?.position || (mode === 'interior'
      ? { x: center.x + 50, y: 250, z: center.z + 50 }
      : { x: center.x + 200, y: 200, z: center.z + 200 });
    const toTarget = frame?.target || { x: center.x, y: 0, z: center.z };
    const to = cameraPose(toPosition, toTarget);
    const presentation = collectCeilingPresentation(this.instance);
    const startShell = currentObjectFade(presentation.shellObjects);
    const startSeams = currentObjectFade(presentation.seamObjects);
    const endShell = mode === 'interior' ? 0 : 1;
    const endSeams = mode === 'interior' || !this.instance.showCeilingPanelLines ? 0 : 1;
    const bulge = Math.max(from.radius, to.radius) + (frame?.radius || 0) * 0.18;

    if (controls) {
      const reach = Math.max(from.radius, to.radius, bulge, frame?.distance || 0);
      controls.maxDistance = Math.max(controls.maxDistance || 0, reach * 4);
      controls.minDistance = Math.min(controls.minDistance || 10, Math.max(1, Math.min(from.radius, to.radius) * 0.25));
    }
    const farNeeded = Math.max(from.radius, to.radius) + (frame?.radius || 1) * 4;
    if (camera.far < farNeeded) {
      camera.far = farNeeded;
      camera.updateProjectionMatrix();
    }

    this.instance._viewTransitionActive = true;
    if (controls && this._savedControlsEnabled == null) {
      this._savedControlsEnabled = controls.enabled !== false;
      controls.enabled = false;
    }

    const state = { t: 0 };
    const duration = THREE_CONFIG.ANIMATION.CAMERA_DURATION;
    const tween = this.gsap.to(state, {
      t: 1,
      duration,
      ease: 'power2.inOut',
      onUpdate: () => {
        const t = state.t;
        const theta = lerpAngle(from.theta, to.theta, t);
        let phi = lerp(from.phi, to.phi, t) - Math.sin(Math.PI * t) * 0.26;
        if (t <= 0) phi = from.phi;
        else if (t >= 1) phi = to.phi;
        else phi = Math.min(Math.PI - 0.04, Math.max(0.12, phi));
        const radius = Math.max(1, t < 0.5
          ? lerp(from.radius, bulge, t / 0.5)
          : lerp(bulge, to.radius, (t - 0.5) / 0.5));
        const target = {
          x: lerp(from.target.x, to.target.x, t),
          y: lerp(from.target.y, to.target.y, t),
          z: lerp(from.target.z, to.target.z, t),
        };
        const sinPhi = Math.sin(phi);
        camera.position.set(
          target.x + radius * sinPhi * Math.sin(theta),
          target.y + radius * Math.cos(phi),
          target.z + radius * sinPhi * Math.cos(theta)
        );
        if (controls) controls.target.set(target.x, target.y, target.z);
        camera.lookAt(target.x, target.y, target.z);

        const fadeT = mode === 'interior'
          ? smoothstep(0.2, 0.64, t)
          : smoothstep(0.3, 0.84, t);
        applyObjectFade(presentation.shellObjects, lerp(startShell, endShell, fadeT));
        applyObjectFade(presentation.seamObjects, lerp(startSeams, endSeams, fadeT));
      },
      onComplete: () => {
        if (this._cameraTween !== tween) return;
        this._cameraTween = null;
        applyObjectFade(presentation.shellObjects, endShell);
        applyObjectFade(presentation.seamObjects, endSeams);
        this.activeAnimations.delete(tween);
        this.finishViewTransition({ syncControls: true });
      },
    });

    this._cameraTween = tween;
    this.activeAnimations.add(tween);
    return tween;
  }

  // Snap the roof shell. Tour mode uses this when the player walks inside.
  setCeilingPresented(visible) {
    const presentation = collectCeilingPresentation(this.instance);
    applyObjectFade(presentation.shellObjects, visible ? 1 : 0);
    const showSeams = visible && !!this.instance.showCeilingPanelLines;
    applyObjectFade(presentation.seamObjects, showSeams ? 1 : 0);
  }

  finishViewTransition({ syncControls = false } = {}) {
    const controls = this.instance?.controls;
    if (this.instance) this.instance._viewTransitionActive = false;
    if (!controls || this._savedControlsEnabled == null) return;
    controls.enabled = this._savedControlsEnabled;
    this._savedControlsEnabled = null;
    if (syncControls) controls.update();
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
    this.killCameraAnimations();
    this.activeAnimations.forEach(animation => {
      if (animation.kill) {
        animation.kill();
      }
    });
    this.activeAnimations.clear();
  }

  // Kill camera animations specifically
  killCameraAnimations() {
    const hadTween = !!this._cameraTween || !!this.instance?._viewTransitionActive;
    if (this._cameraTween) {
      const tween = this._cameraTween;
      this._cameraTween = null;
      tween.kill();
      this.activeAnimations.delete(tween);
    }
    if (this.gsap && this.instance?.camera) {
      this.gsap.killTweensOf(this.instance.camera.position);
      if (this.instance.controls) this.gsap.killTweensOf(this.instance.controls.target);
    }
    if (hadTween) this.finishViewTransition({ syncControls: false });
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
