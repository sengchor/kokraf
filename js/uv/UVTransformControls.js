const AXIS_START = 5;
const AXIS_LENGTH = 80;
const HEAD_LENGTH = 12;
const HEAD_WIDTH = 9;
const SHAFT_WIDTH = 2;
const CENTER_SIZE = 12;
const PICK_PAD = 5;

const RING_RADIUS = 80;
const RING_WIDTH = 2;
const RING_SEGMENTS = 72;
const TAU = Math.PI * 2;

const SCALE_AXIS_START = 0;
const SCALE_AXIS_LENGTH = 68;
const SCALE_BOX_SIZE = 9;
const SCALE_RING_RADIUS = RING_RADIUS;

const COLORS = {
  u: [0.949, 0.133, 0.125, 1],
  v: [0.188, 0.996, 0.278, 1.0],
  xy: [0.850, 0.850, 0.850, 0.850],
  uniform: [0.850, 0.850, 0.850, 0.850],
  rotate: [0.330, 0.620, 1.0, 1.0],
  hot: [1.0, 0.847, 0.0, 1.0],
  sweep: [1.0, 0.847, 0.0, 0.18],
  guide: [1.0, 1.0, 1.0, 0.5]
};

const UNIT_CIRCLE = (() => {
  const pts = new Float32Array((RING_SEGMENTS + 1) * 2);
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const a = (i / RING_SEGMENTS) * TAU;
    pts[i * 2] = Math.cos(a);
    pts[i * 2 + 1] = Math.sin(a);
  }
  return pts;
})();

export class UVTransformControls {
  constructor(uvEditor, transformTool) {
    this.uvEditor = uvEditor;
    this.tool = transformTool;
    this.uvSelection = uvEditor.uvSelection;

    this.enabled = true;
    this.mode = null;
    this.hovered = null;
    this.dragHandle = null;

    this._base = null;
    this._pivotVersion = undefined;
    this._sawSession = false;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.hovered = null;
    this.dragHandle = null;
    this.uvEditor.canvas.style.cursor = '';
  }

  _session() {
    return this.tool.transforming ? this.tool.session : null;
  }

  _drawMode() {
    return this._session()?.mode ?? this.mode;
  }

  getPivot() {
    const sel = this.uvSelection;
    const session = this.tool.session;

    if (session) {
      this._sawSession = true;
      if (session.mode === 'rotate' || session.mode === 'scale') return session.pivot;
    } else if (this._sawSession) {
      this._sawSession = false;
      this._base = null;
    }

    if (this._base === null || this._pivotVersion !== sel.version) {
      this._base = this._computePivot();
      this._pivotVersion = sel.version;
    }

    if (!this._base) return null;
    if (!session) return this._base;

    return { u: this._base.u + session.du, v: this._base.v + session.dv };
  }

  invalidatePivot() {
    this._base = null;
  }

  _computePivot() {
    const sel = this.uvSelection;
    if (sel.vertices.size === 0) return null;

    const topo = sel.buildTopology();
    let minU = Infinity, minV = Infinity;
    let maxU = -Infinity, maxV = -Infinity;
    let found = false;

    for (const key of sel.vertices) {
      const point = topo.pointsByKey.get(key);
      if (!point) continue;

      if (point.u < minU) minU = point.u;
      if (point.u > maxU) maxU = point.u;
      if (point.v < minV) minV = point.v;
      if (point.v > maxV) maxV = point.v;
      found = true;
    }

    if (!found) return null;
    return { u: (minU + maxU) / 2, v: (minV + maxV) / 2 };
  }

  hitTest(screenX, screenY) {
    if (!this.enabled) return null;

    const pivot = this.getPivot();
    if (!pivot) return null;

    const o = this.uvEditor.uvToScreen(pivot.u, pivot.v);
    const dx = screenX - o.x;
    const dy = screenY - o.y;

    if (this.mode === 'translate') {
      const half = CENTER_SIZE / 2 + PICK_PAD;
      if (Math.abs(dx) <= half && Math.abs(dy) <= half) return 'xy';

      const band = HEAD_WIDTH / 2 + PICK_PAD;
      if (dx >= AXIS_START - PICK_PAD && dx <= AXIS_LENGTH + PICK_PAD && Math.abs(dy) <= band) return 'u';
      if (-dy >= AXIS_START - PICK_PAD && -dy <= AXIS_LENGTH + PICK_PAD && Math.abs(dx) <= band) return 'v';
      return null;
    }

    if (this.mode === 'rotate') {
      const dist = Math.hypot(dx, dy);
      return Math.abs(dist - RING_RADIUS) <= RING_WIDTH / 2 + PICK_PAD ? 'rotate' : null;
    }

    if (this.mode === 'scale') {
      const dist = Math.hypot(dx, dy);
      if (Math.abs(dist - SCALE_RING_RADIUS) <= RING_WIDTH / 2 + PICK_PAD) return 'uniform';

      const band = SCALE_BOX_SIZE / 2 + PICK_PAD;
      const reach = SCALE_AXIS_LENGTH + SCALE_BOX_SIZE / 2 + PICK_PAD;
      if (dx >= SCALE_AXIS_START - PICK_PAD && dx <= reach && Math.abs(dy) <= band) return 'u';
      if (-dy >= SCALE_AXIS_START - PICK_PAD && -dy <= reach && Math.abs(dx) <= band) return 'v';
      return null;
    }
  }

  onPointerDown(screenX, screenY) {
    if (!this.enabled || this.tool.transforming) return false;

    const handle = this.hitTest(screenX, screenY);
    if (!handle) return false;

    if (this.mode === 'translate') {
      if (!this.tool.beginTranslate(screenX, screenY)) return false;
      if (handle !== 'xy') this.tool.setAxis(handle);
    } else if (this.mode === 'rotate') {
      if (!this.tool.beginRotate(screenX, screenY, this.getPivot())) return false;
    } else if (this.mode === 'scale') {
      if (!this.tool.beginScale(screenX, screenY, this.getPivot())) return false;
      if (handle === 'u' || handle === 'v') this.tool.setAxis(handle);
    }

    this.dragHandle = handle;
    this.hovered = handle;
    this.uvEditor.requestRender();
    return true;
  }

  onPointerMove(screenX, screenY) {
    if (!this.enabled || this.tool.transforming) return false;

    const handle = this.hitTest(screenX, screenY);
    if (handle === this.hovered) return false;

    this.hovered = handle;
    this.uvEditor.canvas.style.cursor = this._cursorFor(handle);
    return true;
  }
  
  _cursorFor(handle) {
    if (!handle) return '';
    if (this.mode === 'translate') return 'move';
    if (this.mode === 'rotate') return 'grab';
    if (this.mode === 'scale') {
      const cursors = {
        u: 'ew-resize',
        v: 'ns-resize',
        uniform: 'grab'
      };
      return cursors[handle] ?? '';
    }
    return '';
  }

  onPointerUp() {
    this.dragHandle = null;
  }

  _hotHandle() {
    const session = this._session();
    if (!session) return this.hovered;
    if (session.mode === 'rotate') return 'rotate';
    if (session.mode === 'scale') return 'uniform';

    const axis = this.tool.axis;
    if (axis === 'u' || axis === 'v') return axis;
    return this.dragHandle || 'xy';
  }

  _isActive(handle) {
    const session = this._session();
    if (!session) return true;
    if (session.mode === 'rotate') return handle === 'rotate';

    const axis = this.tool.axis;
    if (axis === 'u' || axis === 'v') return handle === axis;
    return true;
  }

  draw() {
    if (!this.enabled) return;
    if (!this.tool.transforming) this.dragHandle = null;

    const mode = this._drawMode();
    if (!mode) return;

    const pivot = this.getPivot();
    if (!pivot) return;

    const renderer = this.uvEditor.renderer;
    const o = this.uvEditor.uvToScreen(pivot.u, pivot.v);
    const hot = this._hotHandle();

    const colorFor = (handle) => (handle === hot ? COLORS.hot : COLORS[handle]);

    const fade = (color, handle) => {
      if (this._isActive(handle)) return color;
      return [color[0], color[1], color[2], color[3] * 0.25];
    };

    if (mode === 'translate') {
      this._drawTranslate(renderer, o, colorFor, fade);
    }

    if (mode === 'rotate') {
      this._drawRotation(renderer, o, this._session(), colorFor, fade);
    }

    if (mode === 'scale') {
      this._drawScale(renderer, o, this._session(), colorFor, fade);
    }
  }

  _ringLines(o, r) {
    const out = new Float32Array(RING_SEGMENTS * 4);
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const j = i * 2, k = j + 2, w = i * 4;
      out[w] = o.x + UNIT_CIRCLE[j] * r;
      out[w + 1] = o.y + UNIT_CIRCLE[j + 1] * r;
      out[w + 2] = o.x + UNIT_CIRCLE[k] * r;
      out[w + 3] = o.y + UNIT_CIRCLE[k + 1] * r;
    }
    return out;
  }

  _sectorTriangles(o, r, a0, sweep) {
    const steps = Math.max(1, Math.ceil((Math.abs(sweep) / TAU) * RING_SEGMENTS));
    const out = new Float32Array(steps * 6);
    for (let i = 0; i < steps; i++) {
      const t0 = a0 + sweep * (i / steps);
      const t1 = a0 + sweep * ((i + 1) / steps);
      const w = i * 6;
      out[w]     = o.x;                    out[w + 1] = o.y;
      out[w + 2] = o.x + Math.cos(t0) * r; out[w + 3] = o.y + Math.sin(t0) * r;
      out[w + 4] = o.x + Math.cos(t1) * r; out[w + 5] = o.y + Math.sin(t1) * r;
    }
    return out;
  }

  _square(o, h) {
    return new Float32Array([
      o.x - h, o.y - h, o.x + h, o.y - h, o.x - h, o.y + h,
      o.x + h, o.y - h, o.x + h, o.y + h, o.x - h, o.y + h
    ]);
  }

  _drawTranslate(renderer, o, colorFor, fade) {
    renderer.drawScreenLines(
      new Float32Array([
        o.x + AXIS_START, o.y,
        o.x + AXIS_LENGTH - HEAD_LENGTH, o.y
      ]),
      SHAFT_WIDTH,
      fade(colorFor('u'), 'u')
    );
 
    renderer.drawScreenTriangles(
      new Float32Array([
        o.x + AXIS_LENGTH, o.y,
        o.x + AXIS_LENGTH - HEAD_LENGTH, o.y - HEAD_WIDTH / 2,
        o.x + AXIS_LENGTH - HEAD_LENGTH, o.y + HEAD_WIDTH / 2
      ]),
      fade(colorFor('u'), 'u')
    );
 
    renderer.drawScreenLines(
      new Float32Array([
        o.x, o.y - AXIS_START,
        o.x, o.y - (AXIS_LENGTH - HEAD_LENGTH)
      ]),
      SHAFT_WIDTH,
      fade(colorFor('v'), 'v')
    );
 
    renderer.drawScreenTriangles(
      new Float32Array([
        o.x, o.y - AXIS_LENGTH,
        o.x - HEAD_WIDTH / 2, o.y - (AXIS_LENGTH - HEAD_LENGTH),
        o.x + HEAD_WIDTH / 2, o.y - (AXIS_LENGTH - HEAD_LENGTH)
      ]),
      fade(colorFor('v'), 'v')
    );
 
    renderer.drawScreenTriangles(
      this._square(o, CENTER_SIZE / 2),
      fade(colorFor('xy'), 'xy')
    );
  }

  _drawRotation(renderer, o, session, colorFor, fade) {
    if (session && session.angle !== 0) {
      const sweep = -Math.max(-TAU, Math.min(TAU, session.angle));
      renderer.drawScreenTriangles(
        this._sectorTriangles(o, RING_RADIUS, session.startAngle, sweep),
        COLORS.sweep
      );
    }

    renderer.drawScreenLines(
      this._ringLines(o, RING_RADIUS),
      RING_WIDTH,
      fade(colorFor('rotate'), 'rotate')
    );

    if (session) {
      const cur = session.startAngle - session.angle;
      renderer.drawScreenLines(
        new Float32Array([
          o.x, o.y,
          o.x + Math.cos(session.startAngle) * RING_RADIUS,
          o.y + Math.sin(session.startAngle) * RING_RADIUS,
          o.x, o.y,
          o.x + Math.cos(cur) * RING_RADIUS,
          o.y + Math.sin(cur) * RING_RADIUS
        ]),
        1,
        COLORS.guide
      );
    }
  }

  _drawScale(renderer, o, session, colorFor, fade) {
    const h = SCALE_BOX_SIZE / 2;
    const L = SCALE_AXIS_LENGTH;
 
    if (session) {
      const m = this.uvEditor._lastMouse;
      renderer.drawScreenLines(
        new Float32Array([o.x, o.y, m.x, m.y]),
        1,
        COLORS.guide
      );
    }
 
    renderer.drawScreenLines(
      this._ringLines(o, SCALE_RING_RADIUS),
      RING_WIDTH,
      fade(colorFor('uniform'), 'uniform')
    );
 
    const uColor = fade(colorFor('u'), 'u');
    renderer.drawScreenLines(
      new Float32Array([o.x + SCALE_AXIS_START, o.y, o.x + L - h, o.y]),
      SHAFT_WIDTH,
      uColor
    );
    renderer.drawScreenTriangles(this._square({ x: o.x + L, y: o.y }, h), uColor);
 
    const vColor = fade(colorFor('v'), 'v');
    renderer.drawScreenLines(
      new Float32Array([o.x, o.y - SCALE_AXIS_START, o.x, o.y - (L - h)]),
      SHAFT_WIDTH,
      vColor
    );
    renderer.drawScreenTriangles(this._square({ x: o.x, y: o.y - L }, h), vColor);
  }

  dispose() {
    this.enabled = false;
    this.dragHandle = null;
    this.hovered = null;
  }
}