const JOYSTICK_RADIUS = 64;
const DEAD_ZONE = 0.1;
const TOUCH_LOOK_SCALE = 2.1;
const LOOK_ZONE_WIDTH_RATIO = 0.52;

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
    this.lookZone = null;
    this.joystickBase = null;
    this.joystickStick = null;
    this.stick = { x: 0, y: 0 };
    this.upPressed = false;
    this.downPressed = false;
    this.sprintPressed = false;
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
    this.handleSprintPointerDown = this.handleSprintPointerDown.bind(this);
    this.handleSprintPointerEnd = this.handleSprintPointerEnd.bind(this);
    this.handleLookTouchStart = this.handleLookTouchStart.bind(this);
    this.handleLookTouchMove = this.handleLookTouchMove.bind(this);
    this.handleLookTouchEnd = this.handleLookTouchEnd.bind(this);
    this.handleDoorInteractClick = this.handleDoorInteractClick.bind(this);
  }

  isActive() {
    return this.enabled && shouldUseTourMobileControls();
  }

  buildDom() {
    if (this.root) {
      return;
    }

    const root = document.createElement('div');
    root.className = 'tour-mobile-controls tour-mobile-controls--pubg';
    root.innerHTML = `
      <div class="tour-look-zone" aria-hidden="true"></div>
      <div class="tour-joystick" aria-hidden="true">
        <div class="tour-joystick__ring"></div>
        <div class="tour-joystick__stick"></div>
      </div>
      <button type="button" class="tour-pad-btn tour-pad-btn--sprint" aria-label="Sprint">RUN</button>
      <div class="tour-action-cluster" aria-hidden="true">
        <button type="button" class="tour-pad-btn tour-pad-btn--up" aria-label="Fly up">▲</button>
        <button type="button" class="tour-pad-btn tour-pad-btn--down" aria-label="Fly down">▼</button>
        <button type="button" class="tour-pad-btn tour-pad-btn--door" aria-label="Use door" style="display:none;">USE</button>
      </div>
    `;

    this.controller.instance.uiContainer.appendChild(root);
    this.root = root;
    this.lookZone = root.querySelector('.tour-look-zone');
    this.joystickBase = root.querySelector('.tour-joystick');
    this.joystickStick = root.querySelector('.tour-joystick__stick');
    const upBtn = root.querySelector('.tour-pad-btn--up');
    const downBtn = root.querySelector('.tour-pad-btn--down');
    const sprintBtn = root.querySelector('.tour-pad-btn--sprint');
    this.doorBtn = root.querySelector('.tour-pad-btn--door');

    this.joystickBase.addEventListener('pointerdown', this.handleJoystickPointerDown);
    sprintBtn.addEventListener('pointerdown', this.handleSprintPointerDown);
    sprintBtn.addEventListener('pointerup', this.handleSprintPointerEnd);
    sprintBtn.addEventListener('pointercancel', this.handleSprintPointerEnd);
    sprintBtn.addEventListener('pointerleave', this.handleSprintPointerEnd);
    upBtn.addEventListener('pointerdown', this.handleUpDownPointerDown);
    downBtn.addEventListener('pointerdown', this.handleUpDownPointerDown);
    upBtn.addEventListener('pointerup', this.handleUpDownPointerEnd);
    downBtn.addEventListener('pointerup', this.handleUpDownPointerEnd);
    upBtn.addEventListener('pointercancel', this.handleUpDownPointerEnd);
    downBtn.addEventListener('pointercancel', this.handleUpDownPointerEnd);
    upBtn.addEventListener('pointerleave', this.handleUpDownPointerEnd);
    downBtn.addEventListener('pointerleave', this.handleUpDownPointerEnd);
    this.doorBtn.addEventListener('click', this.handleDoorInteractClick);
  }

  handleDoorInteractClick(event) {
    if (!this.isActive()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.controller.interactWithFacingDoor();
  }

  setDoorInteractVisible(visible, label = 'USE') {
    if (!this.doorBtn) {
      return;
    }
    const shortLabel = label.toLowerCase().includes('close') ? 'CLOSE'
      : label.toLowerCase().includes('open') ? 'OPEN'
        : 'USE';
    this.doorBtn.style.display = visible ? 'flex' : 'none';
    if (visible) {
      this.doorBtn.textContent = shortLabel;
      this.doorBtn.setAttribute('aria-label', label);
    }
  }

  attachLookListeners() {
    if (!this.lookZone) {
      return;
    }
    this.lookZone.addEventListener('touchstart', this.handleLookTouchStart, { passive: false });
    this.lookZone.addEventListener('touchmove', this.handleLookTouchMove, { passive: false });
    this.lookZone.addEventListener('touchend', this.handleLookTouchEnd);
    this.lookZone.addEventListener('touchcancel', this.handleLookTouchEnd);
  }

  detachLookListeners() {
    if (!this.lookZone) {
      return;
    }
    this.lookZone.removeEventListener('touchstart', this.handleLookTouchStart);
    this.lookZone.removeEventListener('touchmove', this.handleLookTouchMove);
    this.lookZone.removeEventListener('touchend', this.handleLookTouchEnd);
    this.lookZone.removeEventListener('touchcancel', this.handleLookTouchEnd);
  }

  isPointOnControls(clientX, clientY) {
    if (!this.root) {
      return false;
    }
    const targets = this.root.querySelectorAll(
      '.tour-joystick, .tour-action-cluster, .tour-pad-btn--sprint'
    );
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

  isInLookZone(clientX) {
    if (typeof window === 'undefined') {
      return false;
    }
    const width = window.innerWidth || document.documentElement.clientWidth;
    return clientX >= width * (1 - LOOK_ZONE_WIDTH_RATIO);
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

  handleSprintPointerDown(event) {
    if (!this.isActive()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.sprintPressed = true;
    event.currentTarget.classList.add('is-pressed');
  }

  handleSprintPointerEnd(event) {
    this.sprintPressed = false;
    event.currentTarget.classList.remove('is-pressed');
  }

  handleUpDownPointerDown(event) {
    if (!this.isActive()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.classList.contains('tour-pad-btn--up')) {
      this.upPressed = true;
    } else {
      this.downPressed = true;
    }
    event.currentTarget.classList.add('is-pressed');
  }

  handleUpDownPointerEnd(event) {
    if (event.currentTarget.classList.contains('tour-pad-btn--up')) {
      this.upPressed = false;
    } else {
      this.downPressed = false;
    }
    event.currentTarget.classList.remove('is-pressed');
  }

  handleLookTouchStart(event) {
    if (!this.isActive() || !this.controller.active || event.touches.length !== 1) {
      return;
    }
    const touch = event.touches[0];
    if (!this.isInLookZone(touch.clientX) || this.isPointOnControls(touch.clientX, touch.clientY)) {
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

  isSprintPressed() {
    return this.sprintPressed;
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
    this.sprintPressed = false;
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
