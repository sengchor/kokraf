const NO_SLOT = 0xFFFFFFFF;

export class UVTransformTool {
  constructor(uvEditor, mode = 'translate') {
    this.uvEditor = uvEditor;
    this.editor = uvEditor.editor;
    this.signals = this.editor.signals;
    this.uvSelection = uvEditor.uvSelection;
    this.mode = mode;

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

  begin(screenX, screenY, { modal = false } = {}) {
    if (this.session) return false;

    const meshData = this.uvEditor.getMeshData();
    const geom = this.uvEditor.getGeometry();
    if (!meshData || !geom) return false;

    const topo = this.uvSelection.buildTopology();
    const keys = this.uvSelection.vertices;
    if (keys.size === 0) return false;

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
        const uvs = meshData.uvs.get(corner.faceId);
        const uv = uvs?.[corner.corner];
        if (!uv) continue;
        corners.push({ uv, u0: uv.u, v0: uv.v });
      }
    }

    if (corners.length === 0) return false;

    const start = this.uvEditor.screenToUV(screenX, screenY);

    this.session = {
      startU: start.u,
      startV: start.v,
      corners,
      points,
      edges: this._collectEdges(geom, topo, keys),
      faceVertices: this._collectFaceVertices(geom, slotSet),
      du: 0,
      dv: 0
    };

    this.modal = modal;
    this.axis = null;

    this.signals.onToolStarted?.dispatch(this._displayText());
    return true;
  }

  update(screenX, screenY) {
    if (!this.session) return;

    const cur = this.uvEditor.screenToUV(screenX, screenY);
    let du = cur.u - this.session.startU;
    let dv = cur.v - this.session.startV;

    if (this.axis === 'u') dv = 0;
    if (this.axis === 'v') du = 0;

    this._apply(du, dv);
  }

  setDelta(du, dv) {
    if (!this.session) return;
    this._apply(du, dv);
  }

  setAxis(axis) {
    if (!this.session) return;
    const next = axis === 'x' || axis === 'u' ? 'u'
      : axis === 'y' || axis === 'v' ? 'v' : null;

    this.axis = this.axis === next ? null : next;

    this._apply(this.session.du, this.session.dv);
  }

  commit() {
    if (!this.session) return null;

    const { du, dv } = this.session;
    const moved = du !== 0 || dv !== 0;

    this._end();

    if (!moved) return null;

    this._syncObject();

    return{ du, dv };
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

    if (key === 'x' || key === 'y') {
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

  _apply(du, dv) {
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

    this._writeBuffers();
    this._syncObject();

    this.signals.onToolUpdated?.dispatch(this._displayText());
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

    if (this.axis === 'u') return `Du: ${s.du.toFixed(4)}`;
    if (this.axis === 'v') return `Dv: ${s.dv.toFixed(4)}`;
    return `Du: ${s.du.toFixed(4)} Dv: ${s.dv.toFixed(4)}`;
  }
}