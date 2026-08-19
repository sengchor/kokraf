import * as THREE from 'three';

export class UVEditor {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.selection = editor.selection;
    this.editSelection = editor.editSelection;

    this.canvas = document.getElementById('uv-canvas');
    if (!this.canvas) {
      console.warn('UVEditor: #uv-canvas element not found.');
      return;
    }
    this.ctx = this.canvas.getContext('2d');

    this.zoom = 1.0;
    this.pan = { x: 0, y: 0 };
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };

    this.active = false;
    this.editedObject = null;

    this.selectMode = 'vertex';
    this.selectedVertices = new Set();
    this.selectedEdges = new Set();
    this.selectedFaces = new Set();

    this.isBoxSelecting = false;
    this.boxStart = { x: 0, y: 0 };
    this.boxEnd = { x: 0, y: 0 };
    this.initialUVState = [];

    this.init();
  }

  init() {
    this.setupListeners();
    this.resizeCanvas();
  }

  setupListeners() {
    this.signals.modeChanged.add((mode) => {
      this.active = (mode === 'uv');

      const resizerEl = document.getElementById('viewport-split-resizer');

      if (this.active) {
        this.canvas.parentElement.classList.remove('hidden');
        resizerEl?.classList.remove('hidden');

        this.editedObject = this.editSelection.editedObject;
        this.clearSelection();
        this.resetView();
        this.resizeCanvas();
        this.render();
      } else {
        this.canvas.parentElement.classList.add('hidden');
        resizerEl?.classList.add('hidden');
        this.clearSelection();
      }
    });

    this.signals.layoutChanged?.add(() => {
      if (this.active) {
        this.resetCenterView();
        this.resizeCanvas();
        this.render();
      }
    });

    this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    window.addEventListener('mousemove', this.onMouseMove.bind(this));
    window.addEventListener('mouseup', this.onMouseUp.bind(this));
    this.canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
  }

  resizeCanvas() {
    if (!this.canvas.parentElement) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  resetView() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const width = parent.clientWidth;
    const height = parent.clientHeight;
    const margin = 70;

    const size = Math.min(width, height) - margin * 2;
    this.zoom = size;

    this.pan.x = width / 2 - 0.5 * this.zoom;
    this.pan.y = height / 2 + 0.5 * this.zoom;
  }

  resetCenterView() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const oldWidth = parseFloat(this.canvas.style.width) || parent.clientWidth;
    const oldHeight = parseFloat(this.canvas.style.height) || parent.clientHeight;

    const newWidth = parent.clientWidth;
    const newHeight = parent.clientHeight;
    if (newWidth === 0 || newHeight === 0) return;

    const centerUV = this.screenToUV(oldWidth / 2, oldHeight / 2);

    this.pan.x = newWidth / 2 - centerUV.u * this.zoom;
    this.pan.y = newHeight / 2 + centerUV.v * this.zoom;
  }

  uvToScreen(u, v) {
    return {
      x: this.pan.x + u * this.zoom,
      y: this.pan.y - v * this.zoom
    };
  }

  screenToUV(x, y) {
    return {
      u: (x - this.pan.x) / this.zoom,
      v: (this.pan.y - y) / this.zoom
    };
  }

  getMeshData() {
    return this.editedObject?.userData?.meshData || null;
  }

  _isFaceUVComplete(face, faceUVs) {
    if (!faceUVs || faceUVs.length !== face.vertexIds.length) return false;
    for (const uv of faceUVs) {
      if (!uv || !Number.isFinite(uv.u) || !Number.isFinite(uv.v)) return false;
    }
    return true;
  }

  // Selection state

  setSelectMode(mode) {
    if (!['vertex', 'edge', 'face'].includes(mode) || mode === this.selectMode) return;
    this.selectMode = mode;
    this.render();
  }

  clearSelection() {
    this.selectedVertices.clear();
    this.selectedEdges.clear();
    this.selectedFaces.clear();
  }

  getActiveSelectionSet() {
    if (this.selectMode === 'edge') return this.selectedEdges;
    if (this.selectMode === 'face') return this.selectedFaces;
    return this.selectedVertices;
  }

  // UV topology
  _buildUVTopology(epsilon = 1e-5) {
    const meshData = this.getMeshData();
    const empty = { points: [], pointsByKey: new Map(), cornerToPointKey: new Map(), edges: [], edgesByKey: new Map() };
    if (!meshData) return empty;

    const byVertex = new Map();
    for (const face of meshData.faces.values()) {
      const faceUVs = meshData.uvs.get(face.id);
      if (!this._isFaceUVComplete(face, faceUVs)) continue;

      for (let i = 0; i < faceUVs.length; i++) {
        const vertexId = face.vertexIds[i];
        if (!byVertex.has(vertexId)) byVertex.set(vertexId, []);
        byVertex.get(vertexId).push({ faceId: face.id, corner: i, u: faceUVs[i].u, v: faceUVs[i].v });
      }
    }

    const points = [];
    const cornerToPointKey = new Map();

    for (const [vertexId, corners] of byVertex) {
      const clusters = [];

      for (const c of corners) {
        let cluster = clusters.find(
          cl => Math.abs(cl.u - c.u) <= epsilon && Math.abs(cl.v - c.v) <= epsilon
        );
        if (!cluster) {
          cluster = { u: c.u, v: c.v, corners: [] };
          clusters.push(cluster);
        }
        cluster.corners.push(c);
      }

      for (const cluster of clusters) {
        const key = `${vertexId}_${cluster.u.toFixed(5)}_${cluster.v.toFixed(5)}`;
        points.push({ key, vertexId, u: cluster.u, v: cluster.v, corners: cluster.corners });
        for (const c of cluster.corners) {
          cornerToPointKey.set(`${c.faceId}_${c.corner}`, key);
        }
      }
    }

    const pointsByKey = new Map(points.map(p => [p.key, p]));

    const edgesByKey = new Map();
    for (const face of meshData.faces.values()) {
      const faceUVs = meshData.uvs.get(face.id);
      if (!this._isFaceUVComplete(face, faceUVs)) continue;

      const n = face.vertexIds.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const keyA = cornerToPointKey.get(`${face.id}_${i}`);
        const keyB = cornerToPointKey.get(`${face.id}_${j}`);
        if (!keyA || !keyB) continue;

        const edgeKey = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
        let edge = edgesByKey.get(edgeKey);
        if (!edge) {
          edge = { key: edgeKey, aKey: keyA, bKey: keyB, faceIds: new Set() };
          edgesByKey.set(edgeKey, edge);
        }
        edge.faceIds.add(face.id);
      }
    }

    return { points, pointsByKey, cornerToPointKey, edges: Array.from(edgesByKey.values()), edgesByKey };
  }

  getUVPoints() {
    return this._buildUVTopology().points;
  }

  getUVEdges() {
    return this._buildUVTopology().edges;
  }

  render() {
    if (!this.active) return;

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;

    this.ctx.fillStyle = '#3f3f3f';
    this.ctx.fillRect(0, 0, width, height);

    this.drawGrid();

    if (this.getMeshData()) {
      this.drawUVWireframe();
    }

    if (this.isBoxSelecting) {
      this.drawSelectionBox();
    }
  }

  drawGrid() {
    this.ctx.lineWidth = 1;

    const p0 = this.uvToScreen(0, 0);
    const p1 = this.uvToScreen(1, 1);

    this.ctx.fillStyle = '#343434';
    this.ctx.fillRect(p0.x, p1.y, this.zoom, this.zoom);

    this.ctx.beginPath();
    this.ctx.strokeStyle = '#4a4a4a';
    for (let i = 1; i < 10; i++) {
      const stepU = this.uvToScreen(i / 10, 0).x;
      const stepV = this.uvToScreen(0, i / 10).y;

      this.ctx.moveTo(stepU, p0.y);
      this.ctx.lineTo(stepU, p1.y);

      this.ctx.moveTo(p0.x, stepV);
      this.ctx.lineTo(p1.x, stepV);
    }
    this.ctx.stroke();

    this.ctx.strokeStyle = '#666666';
    this.ctx.strokeRect(p0.x, p1.y, this.zoom, this.zoom);
  }

  drawUVWireframe() {
    const meshData = this.getMeshData();
    if (!meshData) return;

    const topo = this._buildUVTopology();

    // Faces: highlighted when selected in edge mode.
    for (const face of meshData.faces.values()) {
      const faceUVs = meshData.uvs.get(face.id);
      if (!this._isFaceUVComplete(face, faceUVs)) continue;

      const screenPoints = faceUVs.map(uv => this.uvToScreen(uv.u, uv.v));
      const isSelected = this.selectMode === 'face' && this.selectedFaces.has(face.id);

      this.ctx.beginPath();
      this.ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
      for (let i = 1; i < screenPoints.length; i++) {
        this.ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
      }
      this.ctx.closePath();

      this.ctx.fillStyle = isSelected ? 'rgba(255, 165, 0, 0.35)' : 'rgba(255, 255, 255, 0.12)';
      this.ctx.fill();
    }

    // Edges: highlighted when selected in edge mode.
    for (const edge of topo.edges) {
      const a = topo.pointsByKey.get(edge.aKey);
      const b = topo.pointsByKey.get(edge.bKey);
      if (!a || !b) continue;

      const pa = this.uvToScreen(a.u, a.v);
      const pb = this.uvToScreen(b.u, b.v);
      const isSelected = this.selectMode === 'edge' && this.selectedEdges.has(edge.key);

      this.ctx.beginPath();
      this.ctx.moveTo(pa.x, pa.y);
      this.ctx.lineTo(pb.x, pb.y);
      this.ctx.strokeStyle = isSelected ? '#FFD800' : 'rgba(200, 200, 200, 0.7)';
      this.ctx.lineWidth = isSelected ? 2.5 : 1.5;
      this.ctx.stroke();
    }

    // Points: highlighted when selected in vertex mode.
    for (const point of topo.points) {
      const p = this.uvToScreen(point.u, point.v);
      const isSelected = this.selectMode === 'vertex' && this.selectedVertices.has(point.key);

      this.ctx.fillStyle = isSelected ? '#ffffff' : '#a1a1a1';
      this.ctx.fillRect(p.x - 5 / 2, p.y - 5 / 2, 5, 5);
    }
  }

  drawSelectionBox() {
    const x = Math.min(this.boxStart.x, this.boxEnd.x);
    const y = Math.min(this.boxStart.y, this.boxEnd.y);
    const w = Math.abs(this.boxEnd.x - this.boxStart.x);
    const h = Math.abs(this.boxEnd.y - this.boxStart.y);

    this.ctx.strokeStyle = '#FFD800';
    this.ctx.fillStyle = 'rgba(255, 216, 0, 0.18)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x, y, w, h);
    this.ctx.fillRect(x, y, w, h);
    this.ctx.setLineDash([]);
  }

  // Hit testing
  hitTestPoint(x, y, points, radius = 8) {
    for (const point of points) {
      const p = this.uvToScreen(point.u, point.v);
      const dx = x - p.x;
      const dy = y - p.y;
      if (dx * dx + dy * dy <= radius * radius) return point.key;
    }
    return null;
  }

  _distanceToSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay;
    const apx = px - ax, apy = py - ay;
    const abLenSq = abx * abx + aby * aby;
    let t = abLenSq > 0 ? (apx * abx + apy * aby) / abLenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * abx, cy = ay + t * aby;
    const dx = px - cx, dy = py - cy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  hitTestEdge(x, y, edges, pointsByKey, radius = 6) {
    let closestKey = null;
    let closestDist = radius;

    for (const edge of edges) {
      const a = pointsByKey.get(edge.aKey);
      const b = pointsByKey.get(edge.bKey);
      if (!a || !b) continue;

      const pa = this.uvToScreen(a.u, a.v);
      const pb = this.uvToScreen(b.u, b.v);
      const dist = this._distanceToSegment(x, y, pa.x, pa.y, pb.x, pb.y);

      if (dist <= closestDist) {
        closestDist = dist;
        closestKey = edge.key;
      }
    }
    return closestKey;
  }

  _pointInPolygon(x, y, screenPoints) {
    let inside = false;
    for (let i = 0, j = screenPoints.length - 1; i < screenPoints.length; j = i++) {
      const xi = screenPoints[i].x, yi = screenPoints[i].y;
      const xj = screenPoints[j].x, yj = screenPoints[j].y;
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  hitTestFace(x, y) {
    const meshData = this.getMeshData();
    if (!meshData) return null;

    for (const face of meshData.faces.values()) {
      const faceUVs = meshData.uvs.get(face.id);
      if (!this._isFaceUVComplete(face, faceUVs)) continue;

      const screenPoints = faceUVs.map(uv => this.uvToScreen(uv.u, uv.v));
      if (this._pointInPolygon(x, y, screenPoints)) return face.id;
    }
    return null;
  }

  hitTestActive(x, y) {
    const topo = this._buildUVTopology();

    if (this.selectMode === 'edge') return this.hitTestEdge(x, y, topo.edges, topo.pointsByKey);
    if (this.selectMode === 'face') return this.hitTestFace(x, y);
    return this.hitTestPoint(x, y, topo.points);
  }

  // Interaction & Event Handling
  onMouseDown(e) {
    if (!this.active) return;

    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this.isPanning = true;
      this.panStart = { x: mouseX - this.pan.x, y: mouseY - this.pan.y };
      return;
    }

    if (e.button === 0) {
      const hitKey = this.hitTestActive(mouseX, mouseY);
      const selection = this.getActiveSelectionSet();

      if (hitKey !== null) {
        if (!e.shiftKey && !selection.has(hitKey)) {
          selection.clear();
        }
        selection.add(hitKey);
      } else {
        if (!e.shiftKey) selection.clear();
        this.isBoxSelecting = true;
        this.boxStart = { x: mouseX, y: mouseY };
        this.boxEnd = { x: mouseX, y: mouseY };
      }

      this.render();
    }
  }

  onMouseMove(e) {
    if (!this.active) return;

    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (this.isPanning) {
      this.pan.x = mouseX - this.panStart.x;
      this.pan.y = mouseY - this.panStart.y;
      this.render();
      return;
    }

    if (this.isBoxSelecting) {
      this.boxEnd = { x: mouseX, y: mouseY };
      this.updateBoxSelection();
      this.render();
    }
  }

  onMouseUp() {
    this.isPanning = false;
    this.isBoxSelecting = false;
    this.render();
  }

  onWheel(e) {
    if (!this.active) return;
    e.preventDefault();

    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;

    this.pan.x = mouseX - (mouseX - this.pan.x) * zoomFactor;
    this.pan.y = mouseY - (mouseY - this.pan.y) * zoomFactor;
    this.zoom *= zoomFactor;

    this.render();
  }

  updateBoxSelection() {
    const minX = Math.min(this.boxStart.x, this.boxEnd.x);
    const maxX = Math.max(this.boxStart.x, this.boxEnd.x);
    const minY = Math.min(this.boxStart.y, this.boxEnd.y);
    const maxY = Math.max(this.boxStart.y, this.boxEnd.y);
    const inBox = (p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;

    if (this.selectMode === 'vertex') {
      const topo = this._buildUVTopology();
      for (const point of topo.points) {
        if (inBox(this.uvToScreen(point.u, point.v))) this.selectedVertices.add(point.key);
      }
    } else if (this.selectMode === 'edge') {
      const topo = this._buildUVTopology();
      for (const edge of topo.edges) {
        const a = topo.pointsByKey.get(edge.aKey);
        const b = topo.pointsByKey.get(edge.bKey);
        if (!a || !b) continue;
        const pa = this.uvToScreen(a.u, a.v);
        const pb = this.uvToScreen(b.u, b.v);
        if (inBox(pa) && inBox(pb)) this.selectedEdges.add(edge.key);
      }
    } else if (this.selectMode === 'face') {
      const meshData = this.getMeshData();
      if (!meshData) return;
      for (const face of meshData.faces.values()) {
        const faceUVs = meshData.uvs.get(face.id);
        if (!this._isFaceUVComplete(face, faceUVs)) continue;
        const screenPoints = faceUVs.map(uv => this.uvToScreen(uv.u, uv.v));
        if (screenPoints.every(inBox)) this.selectedFaces.add(face.id);
      }
    }
  }
}