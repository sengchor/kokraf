import { UVSelection } from './UVSelection.js';
import { UVViewportControls } from '../ui/UVViewport.Controls.js';
import { UVRenderer } from './UVRenderer.js';
import { UVTransformTool } from './UVTransformTool.js';
import { UVTransformControls } from './UVTransformControls.js';
import earcut from 'earcut';

const POINT_SIZE = 5;
const EDGE_WIDTH = 1;
const SEL_EDGE_WIDTH = 1.6;
const GIZMO_BY_TOOL = { move: 'translate', rotate: 'rotate' };

export class UVEditor {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.selection = editor.selection;
    this.editSelection = editor.editSelection;

    this.active = false;
    this.editedObject = null;
    this.activeTool = 'select';

    this.uvSelection = new UVSelection({
      getMeshData: () => this.getMeshData(),
      uvToScreen: (u, v) => this.uvToScreen(u, v)
    });

    this.canvas = document.getElementById('uv-canvas');
    if (!this.canvas) {
      console.warn('UVEditor: #uv-canvas element not found.');
      return;
    }

    this.renderer = new UVRenderer(this.canvas);
    if (!this.renderer.supported) {
      console.warn('UVEditor: WebGL renderer unavailable, UV view will not draw.');
    }
    this._contextLost = false;

    this.uvViewportControls = new UVViewportControls(editor);
    this.syncSelection = false;

    this.transformTool = new UVTransformTool(this);
    this.transformControls = new UVTransformControls(this, this.transformTool);
    this.transformControls.setMode(GIZMO_BY_TOOL[this.activeTool] ?? null);
    this._lastMouse = { x: 0, y: 0 };

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

    // One copy of the mesh, built in UV space. Pan/zoom are uniforms and
    // selection is a byte per element, so neither rebuilds a position buffer.
    this._geom = null;
    this._selVersion = undefined;

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
        if (this.transformTool.transforming) this.transformTool.cancel();
        this.invalidateSelection();
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
      this.invalidateSelection();
      this.requestRender();
    });

    this.signals.editSelectionChanged.add((state) => {
      if (!this.active || !this.syncSelection) return;
      this.uvSelection.applyMeshSelection(state);
      this.invalidateSelection();
      this.requestRender();
    });

    this.signals.editSelectionCleared.add(() => {
      if (!this.active) return;
      this.uvSelection.clear();
      this.invalidateSelection();
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
      this.invalidateSelection();
      this.requestRender();
    });

    this.signals.uvsChanged.add((object) => {
      if (!this.active) return;
      if (object && object !== this.editSelection.editedObject) return;
      this.refresh({ resetView: true });
    });

    this.signals.uvToolChanged.add((tool) => {
      if (tool === this.activeTool) return;
      if (this.transformTool.transforming) this.transformTool.cancel();

      this.activeTool = tool;
      this.transformControls.setMode(GIZMO_BY_TOOL[tool] ?? null);
      this.requestRender();
    });

    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.target.matches('input, textarea, [contenteditable]')) return;

      if (this.transformTool.handleKey(e)) {
        e.preventDefault();
        return;
      }

      if (e.key.toLowerCase() === 'g' && this.transformTool.hasSelection()) {
        e.preventDefault();

        if (this.activeTool !== 'move') this.signals.uvToolChanged.dispatch('move');
        this.transformTool.beginTranslate(this._lastMouse.x, this._lastMouse.y, { modal: true });
      }

      if (e.key.toLowerCase() === 'r' && this.transformTool.hasSelection()) {
        e.preventDefault();

        if (this.activeTool !== 'rotate') this.signals.uvToolChanged.dispatch('rotate');
        this.transformTool.beginRotate(
          this._lastMouse.x, this._lastMouse.y,
          this.transformControls.getPivot(),
          { modal: true }
        );
      }
    });

    this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    window.addEventListener('mousemove', this.onMouseMove.bind(this));
    window.addEventListener('mouseup', this.onMouseUp.bind(this));
    this.canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });

    // The cached canvas rect goes stale whenever the page moves under it.
    window.addEventListener('resize', () => { this._rectDirty = true; });
    window.addEventListener('scroll', () => { this._rectDirty = true; }, true);

    // All GPU resources die with the context, so everything is rebuilt on restore.
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this._contextLost = true;
    }, false);

    this.canvas.addEventListener('webglcontextrestored', () => {
      this._contextLost = false;
      if (!this.renderer.restore()) return;
      this.invalidateGeometry();
      this.resizeCanvas();
      this.requestRender();
    }, false);
  }

  invalidateSelection() {
    this._selVersion = undefined;
  }

  invalidateGeometry() {
    this._geom = null;
    this.invalidateSelection();
  }

  invalidatePaths() {
    this.invalidateGeometry();
  }

  invalidateAll() {
    this.uvSelection.invalidateTopology();
    this.invalidateGeometry();
  }

  getGeometry() {
    return this._ensureGeometry() ? this._geom : null;
  }

  syncObjectUVs() {
    const object = this.editSelection.editedObject;
    if (!object) return;
    this.signals.objectChanged.dispatch(object);
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
    if (!this.canvas.parentElement || !this.renderer?.supported) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio;
    this.renderer.resize(rect.width, rect.height, dpr);

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
    if (!this.active || this._contextLost || !this.renderer?.supported) return;

    const width = this._width;
    const height = this._height;
    if (width === 0 || height === 0) return;

    const renderer = this.renderer;
    renderer.setTransform(this.pan.x, this.pan.y, this.zoom);
    renderer.beginFrame();
    renderer.drawGrid();

    if (this.getMeshData() && this._ensureGeometry()) {
      renderer.drawMesh({
        edgeWidth: EDGE_WIDTH,
        selEdgeWidth: SEL_EDGE_WIDTH,
        pointSize: POINT_SIZE,
        showPoints: this.uvSelection.mode === 'vertex'
      });
    }

    this.transformControls.draw();

    if (this.isBoxSelecting) {
      const { minX, minY, maxX, maxY } = this._getBoxBounds();
      renderer.drawBox(minX, minY, maxX, maxY);
    }
  }

  // O(mesh). Rebuilt only when the UVs or the edited object change.
  //
  // Alongside the positions this records where each element lives in its buffer
  // (face -> first triangle vertex, edge key -> instance, point key -> index) so
  // selection changes are a direct write into the flag arrays.
  _buildGeometry() {
    const meshData = this.getMeshData();
    if (!meshData) {
      this._geom = null;
      this.renderer.setGeometry(null, null);
      return;
    }

    const sel = this.uvSelection;
    const topo = sel.buildTopology();

    // Points.
    const points = new Float32Array(topo.points.length * 2);
    const pointSlots = new Map();

    let po = 0;

    for (const point of topo.points) {
      pointSlots.set(point.key, po / 2);

      points[po++] = point.u;
      points[po++] = point.v;
    }

    // Edges, one instance each.
    const edgeData = new Float32Array(topo.edges.length * 4);
    const edgeSlots = new Map();

    let eo = 0;
    let edgeCount = 0;

    for (const edge of topo.edges) {
      const a = topo.pointsByKey.get(edge.aKey);
      const b = topo.pointsByKey.get(edge.bKey);
      if (!a || !b) continue;

      edgeData[eo++] = a.u;
      edgeData[eo++] = a.v;
      edgeData[eo++] = b.u;
      edgeData[eo++] = b.v;

      edgeSlots.set(edge.key, edgeCount++);
    }

    const edges = eo === edgeData.length
      ? edgeData : edgeData.subarray(0, eo);

    // Faces, triangulated with Earcut.
    const kept = [];
    let faceFloats = 0;

    for (const face of meshData.faces.values()) {
      const uvs = meshData.uvs.get(face.id);

      if (!sel.isFaceUVComplete(face, uvs)) continue;
      if (!uvs || uvs.length < 3) continue;
      const flatUVs = new Array(uvs.length * 2);

      for (let i = 0; i < uvs.length; i++) {
        flatUVs[i * 2] = uvs[i].u;
        flatUVs[i * 2 + 1] = uvs[i].v;
      }

      const triangulated = earcut(flatUVs);
      kept.push({ faceId: face.id, flatUVs, triangulated });
      faceFloats += triangulated.length * 2;
    }

    const faces = new Float32Array(faceFloats);
    const faceVertexSlots = new Uint32Array(faceFloats / 2);
    const faceRanges = new Map();

    let fo = 0;

    for (const { faceId, flatUVs, triangulated } of kept) {
      const start = fo / 2;
      const count = triangulated.length;

      faceRanges.set(faceId, { start, count });

      for (let i = 0; i < triangulated.length; i++) {
        const corner = triangulated[i];
        const key = topo.cornerToPointKey.get(`${faceId}_${corner}`);
        const slot = key !== undefined ? pointSlots.get(key) : undefined;

        faceVertexSlots[fo / 2] = slot !== undefined ? slot : 0xFFFFFFFF;

        faces[fo++] = flatUVs[corner * 2];
        faces[fo++] = flatUVs[corner * 2 + 1];
      }
    }

    this._geom = {
      faces, edges, points,
      faceRanges, faceVertexSlots, edgeSlots, pointSlots,
      flags: {
        faces: new Uint8Array(faces.length / 2),
        edges: new Uint8Array(edgeCount),
        points: new Uint8Array(points.length / 2)
      }
    };

    this.renderer.setGeometry(this._geom, this._geom.flags);
  }

  // A memset plus O(selected) writes, then one byte upload per stream.
  _updateFlags() {
    const geom = this._geom;
    if (!geom) return;

    const hl = this.uvSelection.getHighlight();
    const flags = geom.flags;

    flags.faces.fill(0);
    flags.edges.fill(0);
    flags.points.fill(0);

    for (const faceId of hl.faces) {
      const range = geom.faceRanges.get(faceId);
      if (!range) continue;
      flags.faces.fill(1, range.start, range.start + range.count);
    }

    for (const edgeKey of hl.edges) {
      const slot = geom.edgeSlots.get(edgeKey);
      if (slot !== undefined) flags.edges[slot] = 1;
    }

    for (const pointKey of hl.points) {
      const slot = geom.pointSlots.get(pointKey);
      if (slot !== undefined) flags.points[slot] = 1;
    }

    this.renderer.updateFlags(flags);
  }

  _ensureGeometry() {
    if (!this._geom) this._buildGeometry();
    if (!this._geom) return false;

    const version = this.uvSelection.version;
    if (version === undefined || this._selVersion !== version) {
      this._updateFlags();
      this._selVersion = version;
    }
    return true;
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

    if (this.transformTool.transforming) {
      if (e.button === 0) {
        if (GIZMO_BY_TOOL[this.activeTool] &&
          this.transformControls.onPointerDown(mouseX, mouseY)) return;
        this.transformTool.commit();
      }
      else if (e.button === 2) this.transformTool.cancel();
      this.transformControls.onPointerUp();
      return;
    }

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this.isPanning = true;
      this.panStart = { x: mouseX - this.pan.x, y: mouseY - this.pan.y };
      return;
    }

    if (e.button === 0) {
      if (GIZMO_BY_TOOL[this.activeTool] &&
          this.transformControls.onPointerDown(mouseX, mouseY)) return;
      
      this.dragging = false;
      this.mouseDownPos = { x: e.clientX, y: e.clientY };
      this.boxStart = { x: mouseX, y: mouseY };
    }
  }

  onMouseMove(e) {
    if (!this.active) return;

    const { x: mouseX, y: mouseY } = this._getMousePosition(e);
    this._lastMouse = { x: mouseX, y: mouseY };

    if (this.transformTool.transforming) {
      this.transformTool.update(mouseX, mouseY, { snap: e.ctrlKey });
      return;
    }

    if (!this.mouseDownPos && !this.isPanning) {
      if (this.transformControls.onPointerMove(mouseX, mouseY)) {
        this.requestRender();
      }
      return;
    }

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
    this._moveCandidate = false;

    if (this.transformTool.transforming) {
      if (!this.transformTool.modal) {
        this.transformTool.commit();
        this.transformControls.onPointerUp();
      }
      return;
    }

    if (!this.mouseDownPos && !this.isPanning) return;

    const { x: mouseX, y: mouseY } = this._getMousePosition(e);

    if (!this.isPanning) {
      if (this.dragging) {
        const { minX, minY, maxX, maxY } = this._getBoxBounds();
        this.uvSelection.boxSelect(minX, minY, maxX, maxY, e.shiftKey);
      } else {
        this.uvSelection.selectAt(mouseX, mouseY, e.shiftKey);
      }

      this.invalidateSelection();

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

  dispose() {
    this.renderer?.dispose();
  }
}