import { SetUVPositionCommand } from "../commands/SetUVPositionCommand.js";

const NO_SLOT = 0xFFFFFFFF;
const TAU = Math.PI * 2;
const ROTATE_SNAP = Math.PI / 12;
const ROTATE_DEAD_ZONE = 4;
const EPS = 1e-9;

export class UVTransformTool {
  constructor(uvEditor) {
    this.uvEditor = uvEditor;
    this.editor = uvEditor.editor;
    this.signals = this.editor.signals;
    this.uvSelection = uvEditor.uvSelection;

    this.session = null;
    this.modal = false;
    this.axis = null;
  }

  get transforming() {
    return this.session !== null;
  }

  hasSelection() {
    return this.uvSelection.vertices.size > 0;
  }

  // Start
  beginTranslate(screenX, screenY, { modal = false } = {}) {
    if (this.session) return false;

    const data = this._capture();
    if (!data) return false;

    const start = this.uvEditor.screenToUV(screenX, screenY);

    this._start({
      ...data,
      mode: 'translate',
      startU: start.u,
      startV: start.v,
      du: 0,
      dv: 0
    }, modal);
    return true;
  }

  beginRotate(screenX, screenY, pivot, { modal = false } = {}) {
    if (this.session) return false;

    const data = this._capture();
    if (!data) return false;

    const p = pivot ? { u: pivot.u, v: pivot.v } : this._boundsCenter(data.points);
    const o = this.uvEditor.uvToScreen(p.u, p.v);
    const a = Math.atan2(screenY - o.y, screenX - o.x);

    this._start({
      ...data,
      mode: 'rotate',
      pivot: p,
      startAngle: a,
      lastAngle: a,
      rawAngle: 0,
      angle: 0,
      du: 0,
      dv: 0
    }, modal);
    return true;
  }

  _start(session, modal) {
    this.session = session;
    this.modal = modal;
    this.axis = null;

    this.signals.onToolStarted?.dispatch(this._displayText());
    this.uvEditor.requestRender();
  }

  _capture() {
    const meshData = this.uvEditor.getMeshData();
    const geom = this.uvEditor.getGeometry();
    if (!meshData || !geom) return null;

    const topo = this.uvSelection.buildTopology();
    const keys = this.uvSelection.vertices;
    if (keys.size === 0) return null;

    const corners = [];
    const points = [];
    const slotSet = new Set();

    for (const key of keys) {
      const point = topo.pointsByKey.get(key);
      if (!point) continue;

      const slot = geom.pointSlots.get(key);
      if (slot !== undefined) slotSet.add(slot);

      points.push({ point, slot, u0: point.u, v0: point.v });

      for (const corner of point.corners) {
        const uv = meshData.uvs.get(corner.faceId)?.[corner.corner];
        if (!uv) continue;

        corners.push({
          uv,
          faceId: corner.faceId,
          corner: corner.corner,
          u0: uv.u,
          v0: uv.v
        });
      }
    }

    if (corners.length === 0) return null;

    return {
      corners,
      points,
      edges: this._collectEdges(geom, topo, keys),
      faceVertices: this._collectFaceVertices(geom, slotSet)
    };
  }

  _boundsCenter(points) {
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const { u0, v0 } of points) {
      if (u0 < minU) minU = u0;
      if (u0 > maxU) maxU = u0;
      if (v0 < minV) minV = v0;
      if (v0 > maxV) maxV = v0;
    }
    return { u: (minU + maxU) / 2, v: (minV + maxV) / 2 };
  }

  // Update
  update(screenX, screenY, { snap = false } = {}) {
    if (!this.session) return;

    if (this.session.mode === 'rotate') this._updateRotate(screenX, screenY, snap);
    else this._updateTranslate(screenX, screenY);
  }

  _updateTranslate(screenX, screenY) {
    const s = this.session;
    const cur = this.uvEditor.screenToUV(screenX, screenY);

    let du = cur.u - s.startU;
    let dv = cur.v - s.startV;

    if (this.axis === 'u') dv = 0;
    if (this.axis === 'v') du = 0;

    this._applyTranslate(du, dv);
  }

  _updateRotate(screenX, screenY, snap) {
    const s = this.session;
    const o = this.uvEditor.uvToScreen(s.pivot.u, s.pivot.v);
    const dx = screenX - o.x;
    const dy = screenY - o.y;
    if (dx * dx + dy * dy < ROTATE_DEAD_ZONE * ROTATE_DEAD_ZONE) return;

    const a = Math.atan2(dy, dx);
    let d = a - s.lastAngle;
    if (d > Math.PI) d -= TAU;
    else if (d < -Math.PI) d += TAU;
    s.lastAngle = a;

    s.rawAngle -= d;

    const angle = snap ? Math.round(s.rawAngle / ROTATE_SNAP) * ROTATE_SNAP : s.rawAngle;
    this._applyRotate(angle);
  }

  setDelta(du, dv) {
    if (this.session?.mode !== 'translate') return;
    this._applyTranslate(du, dv);
  }

  setAngle(radians) {
    if (this.session?.mode !== 'rotate') return;
    this.session.rawAngle = radians;
    this._applyRotate(radians);
  }

  setAxis(axis) {
    if (this.session?.mode !== 'translate') return;

    const next = axis === 'x' || axis === 'u' ? 'u'
      : axis === 'y' || axis === 'v' ? 'v' : null;

    this.axis = this.axis === next ? null : next;

    let { du, dv } = this.session;
    if (this.axis === 'u') dv = 0;
    if (this.axis === 'v') du = 0;
    this._applyTranslate(du, dv);
  }

  _applyTranslate(du, dv) {
    const s = this.session;
    s.du = du;
    s.dv = dv;

    for (const c of s.corners) {
      c.uv.u = c.u0 + du;
      c.uv.v = c.v0 + dv;
    }
    for (const p of s.points) {
      p.point.u = p.u0 + du;
      p.point.v = p.v0 + dv;
    }

    this._refresh();
  }

  _applyRotate(angle) {
    const s = this.session;
    s.angle = angle;

    const { u: pu, v: pv } = s.pivot;
    const c = Math.cos(angle);
    const sn = Math.sin(angle);

    for (const k of s.corners) {
      const du = k.u0 - pu, dv = k.v0 - pv;
      k.uv.u = pu + du * c - dv * sn;
      k.uv.v = pv + du * sn + dv * c;
    }
    for (const p of s.points) {
      const du = p.u0 - pu, dv = p.v0 - pv;
      p.point.u = pu + du * c - dv * sn;
      p.point.v = pv + du * sn + dv * c;
    }

    this._refresh();
  }

  _refresh() {
    this._writeBuffers();
    this._syncObject();

    this.signals.onToolUpdated?.dispatch(this._displayText());
    this.uvEditor.requestRender();
  }

  commit() {
    if (!this.session) return null;

    const s = this.session;
    const object = this.uvEditor.editedObject;
    const moved = s.corners.some(c =>
      Math.abs(c.uv.u - c.u0) > EPS || Math.abs(c.uv.v - c.v0) > EPS
    );

    if (moved && object) {
      const targets = s.corners.map(c => ({ faceId: c.faceId, corner: c.corner }));
      const oldUVs = s.corners.map(c => ({ u: c.u0, v: c.v0 }));
      const newUVs = s.corners.map(c => ({ u: c.uv.u, v: c.uv.v }));

      this.editor.execute(new SetUVPositionCommand(this.editor, object, targets, newUVs, oldUVs));
    }

    const result = !moved ? null
      : s.mode === 'rotate' ? { mode: 'rotate', angle: s.angle, pivot: s.pivot }
      : { mode: 'translate', du: s.du, dv: s.dv };

    this._end();
    return result;
  }

  cancel() {
    if (!this.session) return;

    const s = this.session;
    for (const c of s.corners) {
      c.uv.u = c.u0;
      c.uv.v = c.v0;
    }
    for (const p of s.points) {
      p.point.u = p.u0;
      p.point.v = p.v0;
    }

    s.du = 0;
    s.dv = 0;
    s.angle = 0;

    this._writeBuffers();
    this._syncObject();
    this._end();
  }

  handleKey(event) {
    if (!this.session) return false;

    const key = event.key.toLowerCase();

    if (key === 'escape') {
      this.cancel();
      return true;
    }

    if (key === 'enter' || key === 'return') {
      this.commit();
      return true;
    }

    if (key === 'x' || key === 'y' && this.session.mode === 'translate') {
      this.setAxis(key);
      return true;
    }

    return false;
  }

  _end() {
    this.session = null;
    this.modal = false;
    this.axis = null;

    this.signals.onToolEnded?.dispatch();
    this.uvEditor.requestRender();
  }

  _writeBuffers() {
    const geom = this.uvEditor.getGeometry();
    if (!geom) return;

    const s = this.session;
    const { points, edges, faces } = geom;

    for (const p of s.points) {
      if (p.slot === undefined) continue;
      points[p.slot * 2] = p.point.u;
      points[p.slot * 2 + 1] = p.point.v;
    }

    for (const e of s.edges) {
      const o = e.slot * 4;

      edges[o] = e.a.u;
      edges[o + 1] = e.a.v;
      edges[o + 2] = e.b.u;
      edges[o + 3] = e.b.v;
    }

    const { indices, slots } = s.faceVertices;
    for (let i = 0; i < indices.length; i++) {
      const fv = indices[i];
      const slot = slots[i];
      faces[fv * 2] = points[slot * 2];
      faces[fv * 2 + 1] = points[slot * 2 + 1];
    }

    this.uvEditor.renderer.updatePositions({ points, edges, faces });
  }

  _syncObject() {
    this.uvEditor.syncObjectUVs?.();
  }

  _collectEdges(geom, topo, keys) {
    const out = [];
 
    for (const edge of topo.edges) {
      if (!keys.has(edge.aKey) && !keys.has(edge.bKey)) continue;
 
      const slot = geom.edgeSlots.get(edge.key);
      if (slot === undefined) continue;
 
      const a = topo.pointsByKey.get(edge.aKey);
      const b = topo.pointsByKey.get(edge.bKey);
      if (!a || !b) continue;
 
      out.push({ slot, a, b });
    }
    return out;
  }

  _collectFaceVertices(geom, slots) {
    const map = geom.faceVertexSlots;
    const indices = [];
    const slotList = [];

    for (let i = 0; i < map.length; i++) {
      const slot = map[i];
      if (slot !== NO_SLOT && slots.has(slot)) {
        indices.push(i);
        slotList.push(slot);
      }
    }
    return { indices: Uint32Array.from(indices), slots: Uint32Array.from(slotList) };
  }

  _displayText() {
    const s = this.session;
    if (!s) return '';

    if (s.mode === 'rotate') {
      return `R: ${(s.angle * 180 / Math.PI).toFixed(2)}°`;
    }

    if (this.axis === 'u') return `Du: ${s.du.toFixed(4)}`;
    if (this.axis === 'v') return `Dv: ${s.dv.toFixed(4)}`;
    return `Du: ${s.du.toFixed(4)} Dv: ${s.dv.toFixed(4)}`;
  }
}