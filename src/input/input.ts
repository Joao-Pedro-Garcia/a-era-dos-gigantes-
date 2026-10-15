/**
 * Unified input: keyboard/mouse, touch (virtual joystick + look area +
 * buttons) and gamepad. Tracks the last-used modality so the touch UI only
 * shows when the player is actually using touch.
 */
export type InputMode = 'keyboard' | 'touch' | 'gamepad';

export type Action =
  | 'jump' | 'sprint' | 'crouch' | 'interact' | 'attack' | 'inventory' | 'build' | 'camera' | 'pause'
  | 'rotateLeft' | 'rotateRight' | 'snapToggle' | 'map' | 'hot1' | 'hot2' | 'hot3' | 'hot4' | 'hot5' | 'hot6' | 'demolish' | 'eat';

export const DEFAULT_KEYS: Record<Action, string[]> = {
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['KeyC', 'ControlLeft'],
  interact: ['KeyE'],
  attack: ['Mouse0'],
  inventory: ['Tab', 'KeyI'],
  build: ['KeyB'],
  camera: ['KeyV'],
  pause: ['Escape', 'KeyP'],
  rotateLeft: ['KeyQ'],
  rotateRight: ['KeyR'],
  snapToggle: ['KeyG'],
  map: ['KeyM'],
  hot1: ['Digit1'],
  hot2: ['Digit2'],
  hot3: ['Digit3'],
  hot4: ['Digit4'],
  hot5: ['Digit5'],
  hot6: ['Digit6'],
  demolish: ['KeyX'],
  eat: ['KeyF'],
};

const KEYMAP_KEY = 'edg.keys.v1';

export class Input {
  mode: InputMode = matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard';
  keys: Record<Action, string[]>;
  /** Movement vector: x = strafe right, y = forward. */
  move = { x: 0, y: 0 };
  /** Accumulated look delta in pixels (consumed each frame). */
  look = { x: 0, y: 0 };
  private down = new Set<string>();
  private pressed = new Set<Action>();
  private touchHeld = new Set<Action>();
  private sprintToggle = false;
  private crouchToggle = false;
  pointerLocked = false;
  wheel = 0;
  onModeChange: (m: InputMode) => void = () => {};
  /** UI open: gameplay input is ignored but key presses for toggles still register. */
  uiCapture = false;

  constructor(canvas: HTMLCanvasElement) {
    this.keys = this.loadKeys();
    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    canvas.addEventListener('mousedown', (e) => {
      this.setMode('keyboard');
      if (!this.pointerLocked && !this.uiCapture) {
        canvas.requestPointerLock?.();
        return;
      }
      this.code(`Mouse${e.button}`, true);
    });
    addEventListener('mouseup', (e) => this.code(`Mouse${e.button}`, false));
    addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.look.x += e.movementX;
        this.look.y += e.movementY;
      }
    });
    addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
    document.addEventListener('pointerlockchange', () => (this.pointerLocked = document.pointerLockElement === canvas));
    addEventListener('touchstart', () => this.setMode('touch'), { passive: true });
    addEventListener('blur', () => {
      this.down.clear();
      this.touchHeld.clear();
    });
  }

  private loadKeys(): Record<Action, string[]> {
    try {
      const raw = localStorage.getItem(KEYMAP_KEY);
      if (raw) return { ...DEFAULT_KEYS, ...JSON.parse(raw) };
    } catch {
      /* defaults */
    }
    return { ...DEFAULT_KEYS };
  }

  rebind(action: Action, code: string): void {
    for (const a of Object.keys(this.keys) as Action[]) this.keys[a] = this.keys[a].filter((k) => k !== code);
    this.keys[action] = [code];
    try {
      localStorage.setItem(KEYMAP_KEY, JSON.stringify(this.keys));
    } catch {
      /* ignore */
    }
  }

  resetKeys(): void {
    this.keys = { ...DEFAULT_KEYS };
    try {
      localStorage.removeItem(KEYMAP_KEY);
    } catch {
      /* ignore */
    }
  }

  setMode(m: InputMode): void {
    if (m !== this.mode) {
      this.mode = m;
      this.onModeChange(m);
    }
  }

  private onKey(e: KeyboardEvent, isDown: boolean): void {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    this.setMode('keyboard');
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (!e.repeat || !isDown) this.code(e.code, isDown);
  }

  private code(code: string, isDown: boolean): void {
    if (isDown) {
      if (!this.down.has(code)) {
        for (const a of Object.keys(this.keys) as Action[]) if (this.keys[a].includes(code)) this.pressed.add(a);
      }
      this.down.add(code);
    } else this.down.delete(code);
  }

  /** Called by touch UI buttons. */
  touchPress(a: Action): void {
    this.pressed.add(a);
    if (a === 'sprint') this.sprintToggle = !this.sprintToggle;
    if (a === 'crouch') this.crouchToggle = !this.crouchToggle;
  }
  touchHold(a: Action, held: boolean): void {
    if (held) this.touchHeld.add(a);
    else this.touchHeld.delete(a);
  }

  held(a: Action): boolean {
    if (a === 'sprint' && this.mode === 'touch') return this.sprintToggle;
    if (a === 'crouch' && this.mode === 'touch') return this.crouchToggle;
    if (this.touchHeld.has(a)) return true;
    return this.keys[a].some((k) => this.down.has(k));
  }

  /** True once per press. */
  consume(a: Action): boolean {
    if (this.pressed.has(a)) {
      this.pressed.delete(a);
      return true;
    }
    return false;
  }

  /** Polls keyboard axes and gamepads; call once per frame before reading move/look. */
  poll(dt: number): void {
    let x = 0;
    let y = 0;
    if (this.mode !== 'touch') {
      if (this.down.has('KeyW') || this.down.has('ArrowUp')) y += 1;
      if (this.down.has('KeyS') || this.down.has('ArrowDown')) y -= 1;
      if (this.down.has('KeyD') || this.down.has('ArrowRight')) x += 1;
      if (this.down.has('KeyA') || this.down.has('ArrowLeft')) x -= 1;
      const l = Math.hypot(x, y);
      if (l > 1) {
        x /= l;
        y /= l;
      }
      this.move.x = x;
      this.move.y = y;
    }
    const pads = navigator.getGamepads?.() ?? [];
    for (const gp of pads) {
      if (!gp) continue;
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      const lx = dz(gp.axes[0] ?? 0);
      const ly = dz(gp.axes[1] ?? 0);
      const rx = dz(gp.axes[2] ?? 0);
      const ry = dz(gp.axes[3] ?? 0);
      const anyButton = gp.buttons.some((b) => b.pressed);
      if (lx || ly || rx || ry || anyButton) this.setMode('gamepad');
      if (this.mode !== 'gamepad') continue;
      this.move.x = lx;
      this.move.y = -ly;
      this.look.x += rx * 900 * dt;
      this.look.y += ry * 600 * dt;
      const map: [number, Action][] = [[0, 'jump'], [1, 'crouch'], [2, 'interact'], [3, 'inventory'], [7, 'attack'], [6, 'build'], [9, 'pause'], [8, 'camera'], [4, 'rotateLeft'], [5, 'rotateRight']];
      for (const [i, a] of map) {
        const pressed = gp.buttons[i]?.pressed ?? false;
        const key = `Pad${i}`;
        if (pressed && !this.down.has(key)) this.pressed.add(a);
        if (pressed) this.down.add(key);
        else this.down.delete(key);
      }
      if (gp.buttons[10]?.pressed) this.touchHeld.add('sprint');
      else this.touchHeld.delete('sprint');
      break;
    }
  }

  consumeLook(): { x: number; y: number } {
    const l = { ...this.look };
    this.look.x = 0;
    this.look.y = 0;
    return l;
  }

  clearPresses(): void {
    this.pressed.clear();
  }
}
