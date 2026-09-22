import { TransformControls } from 'jsm/controls/TransformControls.js';
import { TransformCommandSolver } from './TransformCommandSolver.js';
import { ToolNumericInput } from './ToolNumericInput.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { EdgeSlideOps, EdgeSlideCommitResult } from '../operations/EdgeSlideOps.js';
import { projectToScreen } from '../utils/ScreenUtils.js';

export class EdgeSlideTool {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;

    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.controls = editor.controlsManager;
    this.editSelection = editor.editSelection;
    this.sceneEditorHelpers = editor.sceneManager.sceneEditorHelpers;

    this.activeTransformSource = null;
    this.event = null;
    this.slideLine = null;
    this.lineMaterial = null;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode('translate');
    this.transformControls.visible = false;

    this.renderer.domElement.addEventListener('pointermove', (e) => this.event = e);
    this.sceneEditorHelpers.add(this.transformControls.getHelper());

    this.ops = new EdgeSlideOps(editor);
    this.transformSolver = new TransformCommandSolver(this.camera, this.renderer, this.transformControls);
    this.toolNumericInput = new ToolNumericInput({
      tool: this,
      label: 'Edge Slide',
      getter: () => this.slideFactor,
      setter: (v) => this.applyEdgeSlideFactor(v),
      allowNegative: true,
    });

    this.setupTransformListeners();
    this.setupListeners();

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);
  }

  // Read-only accessor (numeric input / UI)
  get slideFactor() {
    return this.ops.factor;
  }

  enableFor(object) {
    if (!object) return;

    this.transformControls.attach(object);
    this.transformControls.visible = true;

    this.showCenterOnly();
    this.handle = this.transformControls.object;

    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this._onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('keydown', this._onKeyDown);
  }

  disable() {
    this.transformControls.detach();
    this.transformControls.visible = false;
  }

  // Signals & Listeners
  setupListeners() {
    this.signals.viewportCameraChanged.add((camera) => {
      if (camera.isDefault) {
        this.camera = camera;
        this.transformControls.camera = camera;
        this.transformSolver.camera = camera;
      }
    });

    this.signals.editEdgeSlideStart.add(() => {
      if (!this.editSelection.editedObject || !this.handle) return;
      if (this.activeTransformSource !== null) return;

      if (this.handle && this.transformControls.worldPositionStart) {
        this.handle.getWorldPosition(this.transformControls.worldPositionStart);
      }

      this.activeTransformSource = 'command';
      this.startEdgeSlideSession();

      this.transformSolver.updateHandleFromCommandInput('translate', this.event);
      this.applyEdgeSlideSession();

      this.signals.transformDragStarted.dispatch('edit');
    });
  }

  showCenterOnly() {
    const helper = this.transformControls.getHelper();
    helper.traverse(child => {
      if (!child.isMesh || !child.name) return;
      if (child.name === 'Z' || child.name === 'Y' || child.name === 'X') {
        child.material.visible = false;
      }
      if (child.name === 'XY' || child.name === 'XZ' || child.name === 'YZ') {
        child.material.visible = false;
      }
    });

    const picker = this.transformControls._gizmo.picker.translate;
    for (let i = picker.children.length - 1; i >= 0; i--) {
      const child = picker.children[i];
      if (child.name !== 'XYZ') {
        picker.remove(child);
      }
    }
  }

  // Gizmo Control
  setupTransformListeners() {
    this.transformControls.addEventListener('mouseDown', () => {
      if (this.activeTransformSource !== null) return;

      this.activeTransformSource = 'gizmo';
      this.startEdgeSlideSession();
    });

    this.transformControls.addEventListener('change', () => {
      if (!this.transformControls.dragging) return;
      if (this.activeTransformSource !== 'gizmo') return;

      this.applyEdgeSlideSession();
    });

    this.transformControls.addEventListener('mouseUp', () => {
      if (this.activeTransformSource !== 'gizmo') return;

      this.commitEdgeSlideSession();
      this.clearCommandEdgeSlideState();
      this.activeTransformSource = null;
    });

    // Signal dispatch
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
      if (!event.value) this.signals.objectChanged.dispatch();
    });

    this.transformControls.addEventListener('mouseDown', () => {
      this.signals.transformDragStarted.dispatch('edit');
    });

    this.transformControls.addEventListener('mouseUp', () => {
      requestAnimationFrame(() => {
        this.editSelection.updateVertexHandle();
        this.signals.transformDragEnded.dispatch('edit');
      });
    });
  }

  // Command Control
  onPointerMove() {
    if (this.activeTransformSource !== 'command' || this.toolNumericInput.active) return;
    this.transformSolver.updateHandleFromCommandInput('translate', this.event);
    this.applyEdgeSlideSession();
    this.signals.objectChanged.dispatch();
  }

  onPointerDown() {
    if (this.activeTransformSource !== 'command') return;
    this.commitEdgeSlideSession();
    this.transformSolver.clearGizmoActiveVisualState();
    this.transformSolver.clear();
  }

  onPointerUp() {
    if (this.activeTransformSource !== 'command') return;
    this.clearCommandEdgeSlideState();
    this.toolNumericInput.reset();
  }

  onKeyDown(event) {
    if (this.activeTransformSource !== 'command') return;

    if (this.toolNumericInput.handleKey(event)) {
      return;
    }

    if (event.key === 'Escape') {
      this.cancelEdgeSlideSession();
      this.clearCommandEdgeSlideState();
      this.toolNumericInput.reset();
    }

    if (event.key === 'Enter') {
      this.commitEdgeSlideSession();
      this.clearCommandEdgeSlideState();
      this.toolNumericInput.reset();
    }
  }

  // Edge Slide Session
  startEdgeSlideSession() {
    const session = this.ops.beginSession(this.editSelection.editedObject, this.handle);
    if (!session) return;

    this.transformSolver.beginSession(session.pivotPosition, null, null);
    this.signals.onToolStarted.dispatch(this.toolNumericInput.getDisplayText());
  }

  applyEdgeSlideSession() {
    if (!this.ops.hasSession()) return;

    if (!this.ops.isBuilt()) {
      const slide = this.ops.build(this.handle);
      if (slide?.mode === 'edge') {
        this.ops.setReferenceVertex(this.findClosestSlideVertexOnMouse(slide.slideData));
      }
    }

    const preview = this.ops.apply(this.handle, this.event, this.toolNumericInput.active);
    if (preview) this.updateSlidePreview(preview.vertexData, preview.rail);

    this.signals.onToolUpdated.dispatch(this.toolNumericInput.getDisplayText());
  }

  commitEdgeSlideSession() {
    const result = this.ops.commit(this.handle);
    this.removeSlidePreview();

    if (result === EdgeSlideCommitResult.CANCELLED) {
      this.toolNumericInput.reset();
    }
  }

  cancelEdgeSlideSession() {
    this.ops.cancel(this.handle);
    this.removeSlidePreview();
  }

  clearCommandEdgeSlideState() {
    this.activeTransformSource = null;

    this.transformSolver.clear();
    this.transformSolver.clearGizmoActiveVisualState();

    requestAnimationFrame(() => {
      this.signals.transformDragEnded.dispatch('edit');
      this.signals.onToolEnded.dispatch();
    });
  }

  // Numeric input (called by ToolNumericInput)
  applyEdgeSlideFactor(value) {
    this.ops.setFactor(value);
  }

  // Reference vertex: the slide vertex closest to the cursor drives the rails.
  findClosestSlideVertexOnMouse(slideData) {
    if (!slideData || !this.event) return null;

    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouseX = this.event.clientX - rect.left;
    const mouseY = this.event.clientY - rect.top;

    let closestId = null;
    let minDistSq = Infinity;

    for (const [vId, data] of slideData) {
      const screen = projectToScreen(data.origin, this.camera, this.renderer.domElement);

      const dx = screen.x - mouseX;
      const dy = screen.y - mouseY;
      const distSq = dx * dx + dy * dy;

      if (distSq < minDistSq) {
        minDistSq = distSq;
        closestId = vId;
      }
    }

    return closestId;
  }

  // Preview line
  createSlidePreview() {
    if (!this.lineMaterial) {
      this.lineMaterial = new LineMaterial({
        color: 0x00ffff,
        linewidth: 1.0,
        dashed: false,
        worldUnits: false,
        depthTest: false,
      });
    }

    const geometry = new LineGeometry();
    geometry.setPositions([0, 0, 0, 0, 0, 0]);

    this.slideLine = new Line2(geometry, this.lineMaterial);
    this.slideLine.visible = false;
    this.sceneEditorHelpers.add(this.slideLine);
  }

  updateSlidePreview(vertexData, rail) {
    if (!this.slideLine) this.createSlidePreview();

    if (!vertexData || !rail) {
      this.slideLine.visible = false;
      return;
    }

    const origin = vertexData.origin.clone();
    const end = origin.clone().add(rail.normalized.clone().multiplyScalar(rail.length));

    this.slideLine.geometry.setPositions([
      origin.x, origin.y, origin.z,
      end.x, end.y, end.z,
    ]);
    this.slideLine.computeLineDistances();
    this.slideLine.visible = true;
  }

  removeSlidePreview() {
    if (!this.slideLine) return;

    this.sceneEditorHelpers.remove(this.slideLine);
    this.slideLine.geometry.dispose();
    this.slideLine = null;
  }
}