import { SetUVPositionCommand } from "../commands/SetUVPositionCommand.js";

const NO_SLOT = 0xFFFFFFFF;
const TAU = Math.PI * 2;
const ROTATE_SNAP = Math.PI / 12;
const ROTATE_DEAD_ZONE = 4;
const SCALE_SNAP = 0.1;
const SCALE_MIN_REF_PX = 40;
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

  beginScale(screenX, screenY, pivot, { modal = false } = {}) {
    if (this.session) return false;

    const data = this._capture();
    if (!data) return false;

    const p = pivot ? { u: pivot.u, v: pivot.v } : this._boundsCenter(data.points);
    const start = this.uvEditor.screenToUV(screenX, screenY);

    this._start({
      ...data,
      mode: 'scale',
      pivot: p,
      startU: start.u,
      startV: start.v,
      lastX: screenX,
      lastY: screenY,
      snap: false,
      su: 1,
      sv: 1,
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

    if (this.session.mode === 'translate') this._updateTranslate(screenX, screenY);
    else if (this.session.mode === 'rotate') this._updateRotate(screenX, screenY, snap);
    else if (this.session.mode === 'scale') this._updateScale(screenX, screenY, snap);
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

  _updateScale(screenX, screenY, snap) {
    const s = this.session;
    s.lastX = screenX;
    s.lastY = screenY;
    s.snap = snap;
 
    const cur = this.uvEditor.screenToUV(screenX, screenY);
    const minRef = SCALE_MIN_REF_PX / this.uvEditor.zoom;
 
    const cu = cur.u - s.pivot.u;
    const cv = cur.v - s.pivot.v;
    const su0 = s.startU - s.pivot.u;
    const sv0 = s.startV - s.pivot.v;
 
    let f;
    if (this.axis === 'u' || this.axis === 'v') {
      const p0 = this.axis === 'u' ? su0 : sv0;
      const p = this.axis === 'u' ? cu : cv;
      const ref = p0 >= 0 ? Math.max(p0, minRef) : Math.min(p0, -minRef);
      f = 1 + (p - p0) / ref;
    } else {
      const d0 = Math.hypot(su0, sv0);
      const d = Math.hypot(cu, cv);
      f = 1 + (d - d0) / Math.max(d0, minRef);
      if (d0 >= minRef && cu * su0 + cv * sv0 < 0) f = -f;
    }
 
    if (snap) f = Math.round(f / SCALE_SNAP) * SCALE_SNAP;
 
    this._applyScale(
      this.axis === 'v' ? 1 : f,
      this.axis === 'u' ? 1 : f
    );
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

  setScale(su, sv = su) {
    if (this.session?.mode !== 'scale') return;
    this._applyScale(su, sv);
  }

  setAxis(axis) {
    const s = this.session;
    if (!s || s.mode === 'rotate') return;
 
    const next = axis === 'x' || axis === 'u' ? 'u'
      : axis === 'y' || axis === 'v' ? 'v' : null;
 
    this.axis = this.axis === next ? null : next;
 
    if (s.mode === 'scale') {
      this._updateScale(s.lastX, s.lastY, s.snap);
      return;
    }
 
    let { du, dv } = s;
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

  _applyScale(su, sv) {
    const s = this.session;
    s.su = su;
    s.sv = sv;
 
    const { u: pu, v: pv } = s.pivot;
 
    for (const c of s.corners) {
      c.uv.u = pu + (c.u0 - pu) * su;
      c.uv.v = pv + (c.v0 - pv) * sv;
    }
    for (const p of s.points) {
      p.point.u = pu + (p.u0 - pu) * su;
      p.point.v = pv + (p.v0 - pv) * sv;
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

    let result = null;
    if (moved) {
      if (s.mode === 'rotate') result = { mode: 'rotate', angle: s.angle, pivot: s.pivot };
      else if (s.mode === 'scale') result = { mode: 'scale', su: s.su, sv: s.sv, pivot: s.pivot };
      else result = { mode: 'translate', du: s.du, dv: s.dv };
    }

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
    s.su = 1;
    s.sv = 1;

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

    if ((key === 'x' || key === 'y') && this.session.mode !== 'rotate') {
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

    if (s.mode === 'translate') {
      if (this.axis === 'u') return `Dx: ${s.du.toFixed(4)}`;
      if (this.axis === 'v') return `Dy: ${s.dv.toFixed(4)}`;
      return `Dx: ${s.du.toFixed(4)} Dy: ${s.dv.toFixed(4)}`;
    }

    if (s.mode === 'rotate') {
      return `R: ${(s.angle * 180 / Math.PI).toFixed(2)}°`;
    }

    if (s.mode === 'scale') {
      if (this.axis === 'u') return `Sx: ${s.su.toFixed(3)}`;
      if (this.axis === 'v') return `Sy: ${s.sv.toFixed(3)}`;
      if (s.su === s.sv) return `S: ${s.su.toFixed(3)}`;
      return `Su: ${s.su.toFixed(3)} Sv: ${s.sv.toFixed(3)}`;
    }
  }
}