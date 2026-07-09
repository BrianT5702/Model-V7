const JOYSTICK_RADIUS = 52;
const DEAD_ZONE = 0.12;
const TOUCH_LOOK_SCALE = 1.6;

export function shouldUseTourMobileControls() {
  if (typeof window === 'undefined') {
    return false;
  }
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const narrow = window.matchMedia('(max-width: 900px)').matches;
  const touch = navigator.maxTouchPoints > 0;
  return coarse || (touch && narrow);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export default class TourMobileControls {
  constructor(controller) {
    this.controller = controller;
    this.enabled = false;
    this.root = null;
    this.joystickBase = null;
    this.joystickStick = null;
    this.stick = { x: 0, y: 0 };
    this.upPressed = false;
    this.downPressed = false;
    this.joystickPointerId = null;
    this.joystickCenter = { x: 0, y: 0 };
    this.lookTouchId = null;
    this.lastLookX = 0;
    this.lastLookY = 0;

    this.handleJoystickPointerDown = this.handleJoystickPointerDown.bind(this);
    this.handleJoystickPointerMove = this.handleJoystickPointerMove.bind(this);
    this.handleJoystickPointerEnd = this.handleJoystickPointerEnd.bind(this);
    this.handleUpDownPointerDown = this.handleUpDownPointerDown.bind(this);
    this.handleUpDownPointerEnd = this.handleUpDownPointerEnd.bind(this);
    this.handleLookTouchStart = this.handleLookTouchStart.bind(this);
    this.handleLookTouchMove = this.handleLookTouchMove.bind(this);
    this.handleLookTouchEnd = this.handleLookTouchEnd.bind(this);
  }

  isActive() {
    return this.enabled && shouldUseTourMobileControls();
  }

  buildDom() {
    if (this.root) {
      return;
    }

    const root = document.createElement('div');
    root.className = 'tour-mobile-controls';
    root.innerHTML = `
      <div class="tour-joystick" aria-hidden="true">
        <div class="tour-joystick__ring"></div>
        <div class="tour-joystick__stick"></div>
      </div>
      <div class="tour-vertical-pad" aria-hidden="true">
        <button type="button" class="tour-pad-btn tour-pad-btn--up" aria-label="Move up">▲</button>
        <button type="button" class="tour-pad-btn tour-pad-btn--down" aria-label="Move down">▼</button>
      </div>
    `;

    this.controller.instance.uiContainer.appendChild(root);
    this.root = root;
    this.joystickBase = root.querySelector('.tour-joystick');
    this.joystickStick = root.querySelector('.tour-joystick__stick');
    const upBtn = root.querySelector('.tour-pad-btn--up');
    const downBtn = root.querySelector('.tour-pad-btn--down');

    this.joystickBase.addEventListener('pointerdown', this.handleJoystickPointerDown);
    upBtn.addEventListener('pointerdown', this.handleUpDownPointerDown);
    downBtn.addEventListener('pointerdown', this.handleUpDownPointerDown);
    upBtn.addEventListener('pointerup', this.handleUpDownPointerEnd);
    downBtn.addEventListener('pointerup', this.handleUpDownPointerEnd);
    upBtn.addEventListener('pointercancel', this.handleUpDownPointerEnd);
    downBtn.addEventListener('pointercancel', this.handleUpDownPointerEnd);
    upBtn.addEventListener('pointerleave', this.handleUpDownPointerEnd);
    downBtn.addEventListener('pointerleave', this.handleUpDownPointerEnd);
  }

  attachLookListeners() {
    const canvas = this.controller.instance.renderer.domElement;
    canvas.addEventListener('touchstart', this.handleLookTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this.handleLookTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.handleLookTouchEnd);
    canvas.addEventListener('touchcancel', this.handleLookTouchEnd);
  }

  detachLookListeners() {
    const canvas = this.controller.instance.renderer.domElement;
    canvas.removeEventListener('touchstart', this.handleLookTouchStart);
    canvas.removeEventListener('touchmove', this.handleLookTouchMove);
    canvas.removeEventListener('touchend', this.handleLookTouchEnd);
    canvas.removeEventListener('touchcancel', this.handleLookTouchEnd);
  }

  isPointOnControls(clientX, clientY) {
    if (!this.root) {
      return false;
    }
    const targets = this.root.querySelectorAll('.tour-joystick, .tour-vertical-pad');
    for (const el of targets) {
      const rect = el.getBoundingClientRect();
      if (
        clientX >= rect.left
        && clientX <= rect.right
        && clientY >= rect.top
        && clientY <= rect.bottom
      ) {
        return true;
      }
    }
    return false;
  }

  resetJoystick() {
    this.stick = { x: 0, y: 0 };
    this.joystickPointerId = null;
    if (this.joystickStick) {
      this.joystickStick.style.transform = 'translate(-50%, -50%)';
    }
  }

  updateJoystickStick(clientX, clientY) {
    const dx = clientX - this.joystickCenter.x;
    const dy = clientY - this.joystickCenter.y;
    const dist = Math.hypot(dx, dy) || 1;
    const clampedDist = Math.min(dist, JOYSTICK_RADIUS);
    const nx = (dx / dist) * (clampedDist / JOYSTICK_RADIUS);
    const ny = (dy / dist) * (clampedDist / JOYSTICK_RADIUS);

    this.stick.x = Math.abs(nx) < DEAD_ZONE ? 0 : nx;
    this.stick.y = Math.abs(ny) < DEAD_ZONE ? 0 : ny;

    if (this.joystickStick) {
      const offsetX = (dx / dist) * clampedDist;
      const offsetY = (dy / dist) * clampedDist;
      this.joystickStick.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;
    }
  }

  handleJoystickPointerDown(event) {
    if (!this.isActive()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.joystickPointerId = event.pointerId;
    this.joystickBase.setPointerCapture(event.pointerId);
    const rect = this.joystickBase.getBoundingClientRect();
    this.joystickCenter = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    this.updateJoystickStick(event.clientX, event.clientY);
  }

  handleJoystickPointerMove(event) {
    if (!this.isActive() || event.pointerId !== this.joystickPointerId) {
      return;
    }
    event.preventDefault();
    this.updateJoystickStick(event.clientX, event.clientY);
  }

  handleJoystickPointerEnd(event) {
    if (event.pointerId !== this.joystickPointerId) {
      return;
    }
    if (this.joystickBase?.hasPointerCapture(event.pointerId)) {
      this.joystickBase.releasePointerCapture(event.pointerId);
    }
    this.resetJoystick();
  }

  handleUpDownPointerDown(event) {
    if (!this.isActive()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.classList.contains('tour-pad-btn--up')) {
      this.upPressed = true;
      event.currentTarget.classList.add('is-pressed');
    } else {
      this.downPressed = true;
      event.currentTarget.classList.add('is-pressed');
    }
  }

  handleUpDownPointerEnd(event) {
    if (event.currentTarget.classList.contains('tour-pad-btn--up')) {
      this.upPressed = false;
      event.currentTarget.classList.remove('is-pressed');
    } else {
      this.downPressed = false;
      event.currentTarget.classList.remove('is-pressed');
    }
  }

  handleLookTouchStart(event) {
    if (!this.isActive() || !this.controller.active || event.touches.length !== 1) {
      return;
    }
    const touch = event.touches[0];
    if (this.isPointOnControls(touch.clientX, touch.clientY)) {
      return;
    }
    this.lookTouchId = touch.identifier;
    this.lastLookX = touch.clientX;
    this.lastLookY = touch.clientY;
    event.preventDefault();
  }

  handleLookTouchMove(event) {
    if (!this.isActive() || !this.controller.active || this.lookTouchId == null) {
      return;
    }
    const touch = Array.from(event.touches).find((t) => t.identifier === this.lookTouchId);
    if (!touch) {
      return;
    }
    const dx = touch.clientX - this.lastLookX;
    const dy = touch.clientY - this.lastLookY;
    this.lastLookX = touch.clientX;
    this.lastLookY = touch.clientY;
    if (dx !== 0 || dy !== 0) {
      this.applyLookDelta(dx, dy);
    }
    event.preventDefault();
  }

  handleLookTouchEnd(event) {
    if (this.lookTouchId == null) {
      return;
    }
    const stillActive = Array.from(event.touches).some((t) => t.identifier === this.lookTouchId);
    if (!stillActive) {
      this.lookTouchId = null;
    }
  }

  applyLookDelta(dx, dy) {
    const sensitivity = 0.0022 * TOUCH_LOOK_SCALE;
    this.controller.yaw -= dx * sensitivity;
    this.controller.pitch -= dy * sensitivity;
    this.controller.pitch = clamp(this.controller.pitch, -1.15, 1.05);
  }

  getStick() {
    return this.stick;
  }

  isUpPressed() {
    return this.upPressed;
  }

  isDownPressed() {
    return this.downPressed;
  }

  enable() {
    if (!shouldUseTourMobileControls()) {
      return;
    }
    this.buildDom();
    this.enabled = true;
    this.root.style.display = 'block';
    this.attachLookListeners();
    document.addEventListener('pointermove', this.handleJoystickPointerMove);
    document.addEventListener('pointerup', this.handleJoystickPointerEnd);
    document.addEventListener('pointercancel', this.handleJoystickPointerEnd);
  }

  disable() {
    this.enabled = false;
    this.upPressed = false;
    this.downPressed = false;
    this.lookTouchId = null;
    this.resetJoystick();
    if (this.root) {
      this.root.style.display = 'none';
      this.root.querySelectorAll('.tour-pad-btn').forEach((btn) => {
        btn.classList.remove('is-pressed');
      });
    }
    this.detachLookListeners();
    document.removeEventListener('pointermove', this.handleJoystickPointerMove);
    document.removeEventListener('pointerup', this.handleJoystickPointerEnd);
    document.removeEventListener('pointercancel', this.handleJoystickPointerEnd);
  }

  dispose() {
    this.disable();
    if (this.root?.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
    this.root = null;
  }
}
