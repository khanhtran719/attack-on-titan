export interface InputState {
  moveForward: number; // -1 to +1 (W/S)
  moveRight: number;   // -1 to +1 (D/A)
  jumpPressed: boolean;
  jumpHeld: boolean;
  leftGrappleHeld: boolean;
  leftGrappleJustPressed: boolean;
  rightGrappleHeld: boolean;
  rightGrappleJustPressed: boolean;
  boostHeld: boolean;
  attackJustPressed: boolean;
  dodgeJustPressed: boolean;
  lockTargetJustPressed: boolean;
  cycleZoneDelta: number;
  resupplyJustPressed: boolean;
  interactJustPressed: boolean;
  pauseJustPressed: boolean;
  mouseDeltaX: number;
  mouseDeltaY: number;
  pointerLocked: boolean;
}

export class InputManager {
  private keysDown: Set<string> = new Set();
  private keysJustPressed: Set<string> = new Set();
  private leftMouseDown = false;
  private leftMouseJustPressed = false;
  private rightMouseDown = false;
  private rightMouseJustPressed = false;
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private wheelDelta = 0;
  private canvas: HTMLCanvasElement;
  private enabled = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.bindEvents();
  }

  private bindEvents(): void {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' && this.enabled) {
        e.preventDefault();
      }
      if (!this.keysDown.has(e.code)) {
        this.keysJustPressed.add(e.code);
      }
      this.keysDown.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keysDown.clear();
      this.leftMouseDown = false;
      this.rightMouseDown = false;
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== this.canvas) {
        this.requestPointerLock();
      }
      if (e.button === 0) {
        if (!this.leftMouseDown) this.leftMouseJustPressed = true;
        this.leftMouseDown = true;
      } else if (e.button === 2) {
        if (!this.rightMouseDown) this.rightMouseJustPressed = true;
        this.rightMouseDown = true;
      } else if (e.button === 1) {
        e.preventDefault();
        this.keysJustPressed.add('Tab');
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.leftMouseDown = false;
      } else if (e.button === 2) {
        this.rightMouseDown = false;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement === this.canvas) {
        this.mouseDeltaX += e.movementX;
        this.mouseDeltaY += e.movementY;
      }
    });

    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        this.wheelDelta += Math.sign(e.deltaY);
      },
      { passive: true }
    );
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.keysDown.clear();
      this.keysJustPressed.clear();
      this.leftMouseDown = false;
      this.rightMouseDown = false;
      this.mouseDeltaX = 0;
      this.mouseDeltaY = 0;
      if (document.pointerLockElement === this.canvas) {
        document.exitPointerLock();
      }
    }
  }

  public requestPointerLock(): void {
    try {
      this.canvas.requestPointerLock();
    } catch {
      // Ignore browser gesture requirement errors in automated environments
    }
  }

  public sampleState(): InputState {
    const forward =
      (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp') ? 1 : 0) -
      (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown') ? 1 : 0);
    const right =
      (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight') ? 1 : 0) -
      (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft') ? 1 : 0);

    const cycleKeyDelta = this.keysJustPressed.has('KeyC') ? 1 : 0;

    const state: InputState = {
      moveForward: forward,
      moveRight: right,
      jumpPressed: this.keysJustPressed.has('Space'),
      jumpHeld: this.keysDown.has('Space'),
      leftGrappleHeld: this.leftMouseDown || this.keysDown.has('KeyZ'),
      leftGrappleJustPressed:
        this.leftMouseJustPressed || this.keysJustPressed.has('KeyZ'),
      rightGrappleHeld: this.rightMouseDown || this.keysDown.has('KeyX'),
      rightGrappleJustPressed:
        this.rightMouseJustPressed || this.keysJustPressed.has('KeyX'),
      boostHeld:
        this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight'),
      attackJustPressed: this.keysJustPressed.has('KeyF'),
      dodgeJustPressed: this.keysJustPressed.has('KeyQ'),
      lockTargetJustPressed: this.keysJustPressed.has('Tab'),
      cycleZoneDelta: this.wheelDelta + cycleKeyDelta,
      resupplyJustPressed: this.keysJustPressed.has('KeyR'),
      interactJustPressed: this.keysJustPressed.has('KeyE'),
      pauseJustPressed:
        this.keysJustPressed.has('Escape') || this.keysJustPressed.has('KeyP'),
      mouseDeltaX: this.mouseDeltaX,
      mouseDeltaY: this.mouseDeltaY,
      pointerLocked: document.pointerLockElement === this.canvas,
    };

    // Reset per-frame edges
    this.keysJustPressed.clear();
    this.leftMouseJustPressed = false;
    this.rightMouseJustPressed = false;
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.wheelDelta = 0;

    return state;
  }

  /**
   * Helper for automated testing or training simulation to inject synthetic inputs.
   */
  public simulateKey(code: string, down: boolean): void {
    if (down) {
      if (!this.keysDown.has(code)) this.keysJustPressed.add(code);
      this.keysDown.add(code);
    } else {
      this.keysDown.delete(code);
    }
  }

  public simulateMouseButton(button: 0 | 2, down: boolean): void {
    if (button === 0) {
      if (down && !this.leftMouseDown) this.leftMouseJustPressed = true;
      this.leftMouseDown = down;
    } else {
      if (down && !this.rightMouseDown) this.rightMouseJustPressed = true;
      this.rightMouseDown = down;
    }
  }

  public simulateMouseDelta(dx: number, dy: number): void {
    this.mouseDeltaX += dx;
    this.mouseDeltaY += dy;
  }
}
