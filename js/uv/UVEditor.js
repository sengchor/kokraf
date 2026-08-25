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
        this.uvSelection.setMode(this.editSelection.subSelectionMode);
        this.uvSelection.applyMeshSelection(this.editSelection.selectionState);
        this.resetView();
        this.resizeCanvas();
        this.render();
      } else {
        this.canvas.parentElement.classList.add('hidden');
        resizerEl?.classList.add('hidden');
        this.uvSelection.clear();
      }
    });

    this.signals.layoutChanged?.add(() => {
      if (this.active) {
        this.resetCenterView();
        this.resizeCanvas();
        this.render();
      }
    });

    this.signals.subSelectionModeChanged.add((newMode) => {
      if (!this.uvSelection.setMode(newMode)) return;

      if (this.syncSelection) {
        this.uvSelection.applyMeshSelection(this.editSelection.selectionState);
      }
      this.render();
    });

    this.signals.editSelectionChanged.add((state) => {
      if (!this.active || !this.syncSelection) return;
      this.uvSelection.applyMeshSelection(state);
      this.render();
    });

    this.signals.editSelectionCleared.add(() => {
      if (!this.active) return;
      this.uvSelection.clear();
      this.render();
    });

    this.signals.uvSyncSelectionChanged.add((enabled) => {
      this.syncSelection = enabled;
      if (!this.active) return;

      if (enabled) {
        this.uvSelection.applyMeshSelection(this.editSelection.selectionState);
      } else {
        this.uvSelection.clear();
      }
      this.render();
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

  // Rendering
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

    const sel = this.uvSelection;
    const topo = sel.buildTopology();

     const highlight = sel.getHighlight()

    // Faces: highlighted when selected in edge mode.
    for (const face of meshData.faces.values()) {
      const faceUVs = meshData.uvs.get(face.id);
      if (!sel.isFaceUVComplete(face, faceUVs)) continue;

      const screenPoints = faceUVs.map(uv => this.uvToScreen(uv.u, uv.v));
      const isSelected = highlight.faces.has(face.id);

      this.ctx.beginPath();
      this.ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
      for (let i = 1; i < screenPoints.length; i++) {
        this.ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
      }
      this.ctx.closePath();

      this.ctx.fillStyle = isSelected ? 'rgba(255, 255, 150, 0.35)' : 'rgba(255, 255, 255, 0.15)';
      this.ctx.fill();
    }

    // Edges: highlighted when selected in edge mode.
    for (const edge of topo.edges) {
      const a = topo.pointsByKey.get(edge.aKey);
      const b = topo.pointsByKey.get(edge.bKey);
      if (!a || !b) continue;

      const pa = this.uvToScreen(a.u, a.v);
      const pb = this.uvToScreen(b.u, b.v);
      const isSelected = highlight.edges.has(edge.key);

      this.ctx.beginPath();
      this.ctx.moveTo(pa.x, pa.y);
      this.ctx.lineTo(pb.x, pb.y);
      this.ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(200, 200, 200, 0.7)';
      this.ctx.stroke();
    }

    // Points: highlighted when selected in vertex mode.
    if (sel.mode === 'vertex') {
      for (const point of topo.points) {
        const p = this.uvToScreen(point.u, point.v);
        const isSelected = highlight.points.has(point.key);

        this.ctx.fillStyle = isSelected ? '#ffffff' : '#a1a1a1';
        this.ctx.fillRect(p.x - 5 / 2, p.y - 5 / 2, 5, 5);
      }
    }
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
  _getMousePosition(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  onMouseDown(e) {
    if (!this.active) return;

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
      this.render();
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
      this.render();
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
      if (this.syncSelection) {
        this.signals.uvSelectionChanged.dispatch(this.uvSelection);
      }
    }

    this.isPanning = false;
    this.dragging = false;
    this.isBoxSelecting = false;
    this.mouseDownPos = null;

    this.render();
  }

  onWheel(e) {
    if (!this.active || this.isPanning) return;
    e.preventDefault();

    const { x: mouseX, y: mouseY } = this._getMousePosition(e);

    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;

    this.pan.x = mouseX - (mouseX - this.pan.x) * zoomFactor;
    this.pan.y = mouseY - (mouseY - this.pan.y) * zoomFactor;
    this.zoom *= zoomFactor;

    this.render();
  }
}