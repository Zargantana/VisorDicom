/** Lo que el visor hace con cada gesto (doc 06 V3). Los desplazamientos van desde el inicio del gesto. */
export interface TouchGestureHandlers {
  /** true si la imagen está ampliada: entonces un dedo la desplaza en vez de pasar de imagen. */
  zoomed(): boolean;
  /** Un dedo: siguiente (+1) o anterior (-1) imagen o frame. */
  step(delta: 1 | -1): void;
  /** Un dedo con la imagen ampliada. */
  panStart(): void;
  pan(dx: number, dy: number): void;
  /** Dos dedos que se separan o se juntan: proporción de la distancia y desplazamiento del punto medio. */
  pinchStart(): void;
  pinch(ratio: number, dx: number, dy: number): void;
  /** Dos dedos que se mueven juntos: contraste. false si la imagen no lo admite (color): entonces es un pellizco. */
  contrastStart(): boolean;
  contrast(dx: number, dy: number): void;
  tap(): void;
  doubleTap(): void;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Gestos táctiles sobre la imagen con Pointer Events (el contenedor lleva `touch-action: none`: la página no se
 * desplaza ni hace zoom al tocar la imagen).
 *  - Un dedo: arrastrar pasa de imagen (o de frame) cada STEP_PX, en el eje dominante (a la derecha o hacia abajo, la
 *    siguiente). Con la imagen ampliada, la desplaza.
 *  - Dos dedos: si cambia la distancia entre ellos, pellizco (zoom y desplazamiento); si se mueven juntos, contraste
 *    (horizontal, anchura; vertical, centro, como con el ratón). Se decide al empezar y no cambia durante el gesto.
 *  - Toque: el clic de siempre (cine, frame siguiente, ajustar), con DOUBLE_TAP_MS de espera para distinguirlo del
 *    doble toque, que vuelve a ajustar la imagen.
 * Sin Angular ni DOM: el componente le pasa las coordenadas y el tiempo, y así se puede probar en Node.
 */
export class TouchGestures {
  public static readonly STEP_PX = 30;
  public static readonly DOUBLE_TAP_MS = 300;
  private static readonly TAP_MOVE_PX = 10;
  private static readonly TAP_MS = 350;
  private static readonly PINCH_PX = 20;
  private static readonly CONTRAST_PX = 15;

  private points = new Map<number, Point>();
  private mode: 'idle' | 'one' | 'two' | 'done' = 'idle';
  private start: Point & { t: number } = { x: 0, y: 0, t: 0 };
  private moved = false;
  private panning = false;
  private steps = 0;
  private twoMode: 'pinch' | 'contrast' | null = null;
  private startDistance = 1;
  private startMid: Point = { x: 0, y: 0 };
  private lastTap: (Point & { t: number }) | null = null;
  private tapTimer: any = null;

  constructor(private handlers: TouchGestureHandlers) { }

  /** true mientras haya algún dedo sobre la imagen. */
  public get active(): boolean {
    return this.points.size > 0;
  }

  public down(id: number, x: number, y: number, t: number): void {
    this.points.set(id, { x, y });
    if (this.points.size == 1 && this.mode == 'idle') {
      this.mode = 'one';
      this.start = { x, y, t };
      this.moved = false;
      this.panning = false;
      this.steps = 0;
    } else if (this.points.size == 2 && this.mode == 'one') {
      this.mode = 'two';
      this.twoMode = null;
      const [a, b] = [...this.points.values()];
      this.startDistance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      this.startMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.cancelTap();
    } else {
      this.mode = 'done'; // tres dedos o más, o un dedo nuevo tras levantar otro: nada hasta soltarlos todos
    }
  }

  public move(id: number, x: number, y: number): void {
    if (!this.points.has(id)) {
      return;
    }
    this.points.set(id, { x, y });
    if (this.mode == 'one') {
      this.moveOne(x - this.start.x, y - this.start.y);
    } else if (this.mode == 'two' && this.points.size == 2) {
      this.moveTwo();
    }
  }

  public up(id: number, x: number, y: number, t: number): void {
    if (!this.points.delete(id)) {
      return;
    }
    if (this.mode == 'one' && this.points.size == 0 && !this.moved && t - this.start.t < TouchGestures.TAP_MS) {
      this.onTap({ x, y, t });
    }
    if (this.points.size == 0) {
      this.mode = 'idle';
    } else if (this.mode == 'two') {
      this.mode = 'done';
    }
  }

  public cancel(id: number): void {
    this.points.delete(id);
    if (this.points.size == 0) {
      this.mode = 'idle';
    } else {
      this.mode = 'done';
    }
  }

  /** Para no dejar un toque pendiente si el componente desaparece. */
  public dispose(): void {
    this.cancelTap();
  }

  private moveOne(dx: number, dy: number): void {
    if (!this.moved) {
      if (Math.hypot(dx, dy) < TouchGestures.TAP_MOVE_PX) {
        return;
      }
      this.moved = true;
      this.panning = this.handlers.zoomed();
      if (this.panning) {
        this.handlers.panStart();
      }
    }
    if (this.panning) {
      this.handlers.pan(dx, dy);
      return;
    }
    const along = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    const target = Math.trunc(along / TouchGestures.STEP_PX);
    while (this.steps < target) {
      this.steps++;
      this.handlers.step(1);
    }
    while (this.steps > target) {
      this.steps--;
      this.handlers.step(-1);
    }
  }

  private moveTwo(): void {
    const [a, b] = [...this.points.values()];
    const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dx = mid.x - this.startMid.x, dy = mid.y - this.startMid.y;
    if (!this.twoMode) {
      if (Math.abs(distance - this.startDistance) > TouchGestures.PINCH_PX) {
        this.twoMode = 'pinch';
        this.handlers.pinchStart();
      } else if (Math.hypot(dx, dy) > TouchGestures.CONTRAST_PX) {
        this.twoMode = this.handlers.contrastStart() ? 'contrast' : 'pinch';
        if (this.twoMode == 'pinch') {
          this.handlers.pinchStart();
        }
      } else {
        return;
      }
    }
    if (this.twoMode == 'pinch') {
      this.handlers.pinch(distance / this.startDistance, dx, dy);
    } else {
      this.handlers.contrast(dx, dy);
    }
  }

  private onTap(p: Point & { t: number }): void {
    const last = this.lastTap;
    if (last && p.t - last.t < TouchGestures.DOUBLE_TAP_MS && Math.hypot(p.x - last.x, p.y - last.y) < 30) {
      this.cancelTap();
      this.lastTap = null;
      this.handlers.doubleTap();
      return;
    }
    this.lastTap = p;
    this.cancelTap();
    this.tapTimer = setTimeout(() => {
      this.tapTimer = null;
      this.handlers.tap();
    }, TouchGestures.DOUBLE_TAP_MS);
  }

  private cancelTap(): void {
    if (this.tapTimer) {
      clearTimeout(this.tapTimer);
      this.tapTimer = null;
    }
  }
}
