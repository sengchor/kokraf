import * as THREE from 'three';
import { UVSelection } from './UVSelection.js';
import { UVViewportControls } from '../ui/UVViewport.Controls.js';

export class UVEditor {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.selection = editor.selection;
    this.editSelection = editor.editSelection;

    this.active = false;
    this.editedObject = null;

    this.uvSelection = new UVSelection({
      getMeshData: () => this.getMeshData(),
      uvToScreen: (u, v) => this.uvToScreen(u, v)
    });

    this.canvas = document.getElementById('uv-canvas');
    if (!this.canvas) {
      console.warn('UVEditor: #uv-canvas element not found.');
      return;
    }
    this.ctx = this.canvas.getContext('2d');

    this.uvViewportControls = new UVViewportControls(editor);
    this.syncSelection = false;

    this.zoom = 1.0;
    this.pan = { x: 0, y: 0 };
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };

    this._gesture = null;
    this._lastTrackpadTime = 0;
    this._gestureLockTimeout = 150;

    this.isBoxSelecting = false;
    this.boxStart = { x: 0, y: 0 };
    this.boxEnd = { x: 0, y: 0 };
    this.initialUVState = [];

    // Cached geometry paths, built in UV space and reused across pan/zoom.
    this._paths = null;

    // Cached layout metrics, so no frame reads geometry off the DOM.
    this._width = 0;
    this._height = 0;
    this._dpr = window.devicePixelRatio;
    this._canvasRect = null;
    this._rectDirty = true;

    this._renderScheduled = false;

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
        this.invalidateAll();

        this.uvSelection.setMode(this.editSelection.subSelectionMode);
        this.uvSelection.applyMeshSelection(this.editSelection.selectionState);
        this.resetView();
        this.resizeCanvas();
        this.render();
      } else {
        this.canvas.parentElement.classList.add('hidden');
        resizerEl?.classList.add('hidden');
        this.uvSelection.clear();
        this.invalidatePaths();
      }
    });

    this.signals.layoutChanged?.add(() => {
      if (this.active) {
        this.resetCenterView();
        this.resizeCanvas();
        this.render();
      } else {
        this._rectDirty = true;
      }
    });

    this.signals.subSelectionModeChanged.add((newMode) => {
      if (!this.uvSelection.setMode(newMode)) return;

      if (this.syncSelection) {
        this.uvSelection.applyMeshSelection(this.editSelection.selectionState);
      }
      this.invalidatePaths();
      this.requestRender();
    });

    this.signals.editSelectionChanged.add((state) => {
      if (!this.active || !this.syncSelection) return;
      this.uvSelection.applyMeshSelection(state);
      this.invalidatePaths();
      this.requestRender();
    });

    this.signals.editSelectionCleared.add(() => {
      if (!this.active) return;
      this.uvSelection.clear();
      this.invalidatePaths();
      this.requestRender();
    });

    this.signals.uvSyncSelectionChanged.add((enabled) => {
      this.syncSelection = enabled;
      if (!this.active) return;

      if (enabled) {
        this.uvSelection.applyMeshSelection(this.editSelection.selectionState);
      } else {
        this.uvSelection.clear();
      }
      this.invalidatePaths();
      this.requestRender();
    });

    this.signals.uvsChanged.add((object) => {
      if (!this.active) return;
      if (object && object !== this.editSelection.editedObject) return;
      this.refresh({ resetView: true });
    });

    this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    window.addEventListener('mousemove', this.onMouseMove.bind(this));
    window.addEventListener('mouseup', this.onMouseUp.bind(this));
    this.canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });

    // The cached canvas rect goes stale whenever the page moves under it.
    window.addEventListener('resize', () => { this._rectDirty = true; });
    window.addEventListener('scroll', () => { this._rectDirty = true; }, true);
  }

  invalidatePaths() {
    this._paths = null;
  }

  invalidateAll() {
    this.uvSelection.invalidateTopology();
    this._paths = null;
  }

  requestRender() {
    if (this._renderScheduled) return;
    this._renderScheduled = true;
    requestAnimationFrame(() => {
      this._renderScheduled = false;
      this.render();
    });
  }

  resizeCanvas() {
    if (!this.canvas.parentElement) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio;

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this._width = rect.width;
    this._height = rect.height;
    this._dpr = dpr;
    this._rectDirty = true;
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

    const oldWidth = this._width || parseFloat(this.canvas.style.width) || parent.clientWidth;
    const oldHeight = this._height || parseFloat(this.canvas.style.height) || parent.clientHeight;

    const newWidth = parent.clientWidth;
    const newHeight = parent.clientHeight;
    if (newWidth === 0 || newHeight === 0) return;

    const centerUV = this.screenToUV(oldWidth / 2, oldHeight / 2);

    this.pan.x = newWidth / 2 - centerUV.u * this.zoom;
    this.pan.y = newHeight / 2 + centerUV.v * this.zoom;
  }

  refresh({ resetView = false } = {}) {
    if (!this.active) return;

    this.editedObject = this.editSelection.editedObject;
    this.invalidateAll();

    this.uvSelection.clear();
    this.uvSelection.setMode(this.editSelection.subSelectionMode);
    if (this.syncSelection) {
      this.uvSelection.applyMeshSelection(this.editSelection.selectionState);
    }

    if (resetView) this.resetView();
    this.render();
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

  // Rendering
  render() {
    if (!this.active) return;

    const width = this._width;
    const height = this._height;
    if (width === 0 || height === 0) return;

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

  _buildPaths() {
    const meshData = this.getMeshData();
    const sel = this.uvSelection;
    if (!meshData) { this._paths = null; return; }

    const topo = sel.buildTopology();
    const hl = sel.getHighlight();

    const faceBase = new Path2D(), faceSel = new Path2D();
    const edgeBase = new Path2D(), edgeSel = new Path2D();

    for (const face of meshData.faces.values()) {
      const uvs = meshData.uvs.get(face.id);
      if (!sel.isFaceUVComplete(face, uvs)) continue;

      const p = hl.faces.has(face.id) ? faceSel : faceBase;
      p.moveTo(uvs[0].u, uvs[0].v);
      for (let i = 1; i < uvs.length; i++) p.lineTo(uvs[i].u, uvs[i].v);
      p.closePath();
    }

    for (const edge of topo.edges) {
      const a = topo.pointsByKey.get(edge.aKey);
      const b = topo.pointsByKey.get(edge.bKey);
      if (!a || !b) continue;

      const p = hl.edges.has(edge.key) ? edgeSel : edgeBase;
      p.moveTo(a.u, a.v);
      p.lineTo(b.u, b.v);
    }

    this._paths = { faceBase, faceSel, edgeBase, edgeSel, points: topo.points };
  }

  drawUVWireframe() {
    if (!this._paths) this._buildPaths();
    const paths = this._paths;
    if (!paths) return;

    const ctx = this.ctx;
    const dpr = this._dpr;
    const z = this.zoom;

    ctx.save();
    // UV space -> device pixels. V is flipped, matching uvToScreen.
    ctx.setTransform(z * dpr, 0, 0, -z * dpr, this.pan.x * dpr, this.pan.y * dpr);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fill(paths.faceBase);
    ctx.fillStyle = 'rgba(255, 255, 150, 0.35)';
    ctx.fill(paths.faceSel);

    ctx.lineWidth = 1 / z; // keeps strokes at 1px on screen
    ctx.strokeStyle = 'rgba(200, 200, 200, 0.7)';
    ctx.stroke(paths.edgeBase);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke(paths.edgeSel);

    ctx.restore();

    if (this.uvSelection.mode === 'vertex') this._drawPoints(paths.points);
  }

  _drawPoints(points) {
    const ctx = this.ctx;
    const hl = this.uvSelection.getHighlight();
    const px = this.pan.x, py = this.pan.y, z = this.zoom;
    const w = this._width, h = this._height;
    const s = 5, half = s / 2;

    const base = new Path2D(), sel = new Path2D();
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const x = px + p.u * z;
      if (x < -s || x > w + s) continue;
      const y = py - p.v * z;
      if (y < -s || y > h + s) continue;

      (hl.points.has(p.key) ? sel : base).rect(x - half, y - half, s, s);
    }

    ctx.fillStyle = '#a1a1a1'; ctx.fill(base);
    ctx.fillStyle = '#ffffff'; ctx.fill(sel);
  }

  drawSelectionBox() {
    const { minX, minY, maxX, maxY } = this._getBoxBounds();

    this.ctx.strokeStyle = '#FFD800';
    this.ctx.fillStyle = 'rgba(255, 216, 0, 0.18)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
    this.ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
    this.ctx.setLineDash([]);
  }

  _getBoxBounds() {
    return {
      minX: Math.min(this.boxStart.x, this.boxEnd.x),
      minY: Math.min(this.boxStart.y, this.boxEnd.y),
      maxX: Math.max(this.boxStart.x, this.boxEnd.x),
      maxY: Math.max(this.boxStart.y, this.boxEnd.y)
    };
  }

  // Interaction
  _getCanvasRect() {
    if (this._rectDirty || !this._canvasRect) {
      this._canvasRect = this.canvas.getBoundingClientRect();
      this._rectDirty = false;
    }
    return this._canvasRect;
  }

  _getMousePosition(e) {
    const rect = this._getCanvasRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  onMouseDown(e) {
    if (!this.active) return;

    // Re-read once per gesture; the rect cannot move mid-drag.
    this._rectDirty = true;
    const { x: mouseX, y: mouseY } = this._getMousePosition(e);

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this.isPanning = true;
      this.panStart = { x: mouseX - this.pan.x, y: mouseY - this.pan.y };
      return;
    }

    if (e.button === 0) {
      this.dragging = false;
      this.mouseDownPos = { x: e.clientX, y: e.clientY };
      this.boxStart = { x: mouseX, y: mouseY };
    }
  }

  onMouseMove(e) {
    if (!this.active || (!this.mouseDownPos && !this.isPanning)) return;

    const { x: mouseX, y: mouseY } = this._getMousePosition(e);

    if (this.isPanning) {
      this.pan.x = mouseX - this.panStart.x;
      this.pan.y = mouseY - this.panStart.y;
      this.requestRender();
      return;
    }

    const dx = e.clientX - this.mouseDownPos.x;
    const dy = e.clientY - this.mouseDownPos.y;
    const dragThreshold = 5;

    if (!this.dragging && Math.hypot(dx, dy) > dragThreshold) {
      this.dragging = true;
    }

    if (this.dragging) {
      this.isBoxSelecting = true;
      this.boxEnd = { x: mouseX, y: mouseY };
      this.requestRender();
    }
  }

  onMouseUp(e) {
    if (!this.mouseDownPos && !this.isPanning) return;

    const { x: mouseX, y: mouseY } = this._getMousePosition(e);

    if (!this.isPanning) {
      if (this.dragging) {
        const { minX, minY, maxX, maxY } = this._getBoxBounds();
        this.uvSelection.boxSelect(minX, minY, maxX, maxY, e.shiftKey);
      } else {
        this.uvSelection.selectAt(mouseX, mouseY, e.shiftKey);
      }

      this.invalidatePaths();

      if (this.syncSelection) {
        this.signals.uvSelectionChanged.dispatch(this.uvSelection);
      }
    }

    this.isPanning = false;
    this.dragging = false;
    this.isBoxSelecting = false;
    this.mouseDownPos = null;

    this.requestRender();
  }

  onWheel(e) {
    if (!this.active || this.isPanning) return;
    if (e.defaultPrevented) return;

    let deltaX = e.deltaX;
    let deltaY = e.deltaY;

    if (e.deltaMode === 1) {
      deltaX *= 16;
      deltaY *= 16;
    }

    const isTrackpad = (Math.abs(deltaX) + Math.abs(deltaY)) < 100;

    if (isTrackpad) {
      e.preventDefault();
      const now = performance.now();

      if (now - this._lastTrackpadTime > this._gestureLockTimeout) {
        this._gesture = (e.ctrlKey || e.metaKey) ? 'zoom' : 'pan';
      }

      this._lastTrackpadTime = now;

      if (this._gesture === 'zoom') {
        this._zoomAt(e, deltaY, 0.005);
      } else {
        this.pan.x -= deltaX;
        this.pan.y -= deltaY;
      }

      this.requestRender();
      return;
    }

    e.preventDefault();
    this._zoomAt(e, deltaY, 0.001);
    this.requestRender();
  }

  _zoomAt(e, delta, scaleFactor) {
    const { x: mouseX, y: mouseY } = this._getMousePosition(e);
    const zoomFactor = Math.exp(-delta * scaleFactor);

    this.pan.x = mouseX - (mouseX - this.pan.x) * zoomFactor;
    this.pan.y = mouseY - (mouseY - this.pan.y) * zoomFactor;
    this.zoom *= zoomFactor;
  }
}