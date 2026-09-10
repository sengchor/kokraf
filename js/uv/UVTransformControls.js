const AXIS_START = 12;
const AXIS_LENGTH = 68;
const HEAD_LENGTH = 12;
const HEAD_WIDTH = 9;
const SHAFT_WIDTH = 2;
const CENTER_SIZE = 12;
const PICK_PAD = 5;

const COLORS = {
  u: [0.949, 0.133, 0.125, 1],
  v: [0.188, 0.996, 0.278, 1.0],
  xy: [0.850, 0.850, 0.850, 0.850],
  hot: [1.0, 0.847, 0.0, 1.0]
};

export class UVTransformControls {
  constructor(uvEditor, transformTool) {
    this.uvEditor = uvEditor;
    this.tool = transformTool;
    this.uvSelection = uvEditor.uvSelection;

    this.enabled = true;
    this.hovered = null;
    this.dragHandle = null;

    this._base = null;
    this._pivotVersion = undefined;
    this._sawSession = false;
  }

  getPivot() {
    const sel = this.uvSelection;
    const session = this.tool.session;

    if (session) this._sawSession = true;
    else if (this._sawSession) {
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

    const half = CENTER_SIZE / 2 + PICK_PAD;
    if (Math.abs(dx) <= half && Math.abs(dy) <= half) return 'xy';

    const band = HEAD_WIDTH / 2 + PICK_PAD;

    if (dx >= AXIS_START - PICK_PAD && dx <= AXIS_LENGTH + PICK_PAD && Math.abs(dy) <= band) {
      return 'u';
    }

    if (-dy >= AXIS_START - PICK_PAD && -dy <= AXIS_LENGTH + PICK_PAD && Math.abs(dx) <= band) {
      return 'v';
    }

    return null;
  }

  onPointerDown(screenX, screenY) {
    if (!this.enabled || this.tool.transforming) return false;

    const handle = this.hitTest(screenX, screenY);
    if (!handle) return false;

    if (!this.tool.begin(screenX, screenY)) return false;

    if (handle === 'u' || handle === 'v') this.tool.setAxis(handle);

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
    this.uvEditor.canvas.style.cursor = handle ? 'move' : '';
    return true;
  }

  onPointerUp() {
    this.dragHandle = null;
  }

  _hotHandle() {
    if (!this.tool.transforming) return this.hovered;
 
    if (this.tool.axis === 'u') return 'u';
    if (this.tool.axis === 'v') return 'v';
    return this.dragHandle || 'xy';
  }

  draw() {
    if (!this.enabled) return;
    if (!this.tool.transforming) this.dragHandle = null;

    const pivot = this.getPivot();
    if (!pivot) return;

    const renderer = this.uvEditor.renderer;
    const o = this.uvEditor.uvToScreen(pivot.u, pivot.v);
    const hot = this._hotHandle();

    const colorFor = (handle) => (handle === hot ? COLORS.hot : COLORS[handle]);

    const dim = this.tool.transforming ? this.tool.axis : null;
    const fade = (color, handle) => {
      if (!dim) return color;
      const key = handle === 'xy' ? null : handle;
      if (key === dim) return color;
      return [color[0], color[1], color[2], color[3] * 0.25]
    };

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
 
    const h = CENTER_SIZE / 2;
    renderer.drawScreenTriangles(
      new Float32Array([
        o.x - h, o.y - h, o.x + h, o.y - h, o.x - h, o.y + h,
        o.x + h, o.y - h, o.x + h, o.y + h, o.x - h, o.y + h
      ]),
      fade(colorFor('xy'), 'xy')
    );
  }

  dispose() {
    this.enabled = false;
    this.dragHandle = null;
    this.hovered = null;
  }
}