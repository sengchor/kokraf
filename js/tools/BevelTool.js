import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { TransformCommandSolver } from './shared/TransformCommandSolver.js';
import { ToolNumericInput } from './shared/ToolNumericInput.js';
import { BevelOps, BevelCommitResult } from '../operations/BevelOps.js';
import { projectToScreen, pixelsToWorldUnits } from '../utils/ScreenUtils.js';

export class BevelTool {
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
    this.startScreen = null;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode('translate');
    this.transformControls.visible = false;

    this.renderer.domElement.addEventListener('pointermove', (e) => this.event = e);
    this.sceneEditorHelpers.add(this.transformControls.getHelper());

    this.ops = new BevelOps(editor);
    this.transformSolver = new TransformCommandSolver(this.camera, this.renderer, this.transformControls);
    this.toolNumericInput = new ToolNumericInput({
      tool: this,
      label: 'Width',
      getter: () => this.width,
      setter: (v) => this.applyBevelWidth(v),
      unit: 'm'
    });

    this.setupTransformListeners();
    this.setupListeners();

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);
    this._onMouseWheel = this.onMouseWheel.bind(this);
  }

  // Read-only accessors (numeric input / UI)
  get width() {
    return this.ops.width;
  }

  get segments() {
    return this.ops.segments;
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
    this.renderer.domElement.addEventListener('wheel', this._onMouseWheel, { passive: false, capture: true });
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

    this.signals.editBevelStart.add(() => {
      if (!this.editSelection.editedObject || !this.handle) return;
      if (this.activeTransformSource !== null) return;

      if (this.handle && this.transformControls.worldPositionStart) {
        this.handle.getWorldPosition(this.transformControls.worldPositionStart);
      }

      this.activeTransformSource = 'command';
      this.startBevelSession();

      this.transformSolver.updateHandleFromCommandInput('translate', this.event);
      this.applyBevelSession();

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
      this.startBevelSession();
    });

    this.transformControls.addEventListener('change', () => {
      if (!this.transformControls.dragging) return;
      if (this.activeTransformSource !== 'gizmo') return;

      this.applyBevelSession();
    });

    this.transformControls.addEventListener('mouseUp', () => {
      if (this.activeTransformSource !== 'gizmo') return;

      this.commitBevelSession();
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
        this.signals.onToolEnded.dispatch();
      });
    });
  }

  // Command Control
  onPointerMove() {
    if (this.activeTransformSource !== 'command' || this.toolNumericInput.active) return;
    this.transformSolver.updateHandleFromCommandInput('translate', this.event);
    this.applyBevelSession();
    this.signals.objectChanged.dispatch();
  }

  onPointerDown() {
    if (this.activeTransformSource !== 'command') return;
    this.commitBevelSession();
    this.transformSolver.clearGizmoActiveVisualState();
    this.transformSolver.clear();
  }

  onPointerUp() {
    if (this.activeTransformSource !== 'command') return;
    this.clearCommandBevelState();
    this.toolNumericInput.reset();
  }

  onMouseWheel(event) {
    if (!this.activeTransformSource) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const step = event.deltaY < 0 ? 1 : -1;
    this.ops.setSegments(this.ops.segments + step, this.handle);
  }

  onKeyDown(event) {
    if (this.activeTransformSource !== 'command') return;

    if (this.toolNumericInput.handleKey(event)) {
      return;
    }

    if (event.key === 'Escape') {
      this.cancelBevelSession();
      this.clearCommandBevelState();
      this.toolNumericInput.reset();
    }

    if (event.key === 'Enter') {
      this.commitBevelSession();
      this.clearCommandBevelState();
      this.toolNumericInput.reset();
    }
  }

  // Bevel session
  startBevelSession() {
    const session = this.ops.beginSession(this.editSelection.editedObject, this.handle);
    if (!session || !this.ops.isValid()) return;

    this.transformSolver.beginSession(session.pivotPosition, null, null);
    this.startScreen = projectToScreen(session.pivotPosition, this.camera, this.renderer.domElement);

    this.signals.onToolStarted.dispatch(this.toolNumericInput.getDisplayText());
  }

  applyBevelSession() {
    if (!this.ops.isValid()) return;

    if (!this.ops.isBuilt()) this.ops.build(this.handle);
    this.updateWidthFromHandle();

    this.signals.onToolUpdated.dispatch(this.toolNumericInput.getDisplayText());
  }

  // Maps the handle's on-screen distance from the start point to a world-space width.
  updateWidthFromHandle() {
    const session = this.ops.session;
    if (!session || !this.startScreen) return;

    const currentWorld = this.handle.getWorldPosition(new THREE.Vector3());
    const currentScreen = projectToScreen(currentWorld, this.camera, this.renderer.domElement);

    const pixelDistance = currentScreen.clone().sub(this.startScreen).length();
    if (pixelDistance <= 1) return;

    const depth = session.pivotPosition.distanceTo(this.camera.position);
    this.ops.setWidth(pixelsToWorldUnits(pixelDistance, this.camera, depth, this.renderer));
  }

  commitBevelSession() {
    const result = this.ops.commit(this.handle);
    this.startScreen = null;

    if (result === BevelCommitResult.INVALID) {
      this.editSelection.clearSelection();
      this.disable();
    } else if (result === BevelCommitResult.CANCELLED) {
      this.toolNumericInput.reset();
    }
  }

  cancelBevelSession() {
    this.ops.cancel(this.handle);
    this.startScreen = null;
  }

  clearCommandBevelState() {
    this.activeTransformSource = null;

    this.transformSolver.clear();
    this.transformSolver.clearGizmoActiveVisualState();

    requestAnimationFrame(() => {
      this.signals.transformDragEnded.dispatch('edit');
      this.signals.onToolEnded.dispatch();
    });
  }

  // Numeric input (called by ToolNumericInput)
  applyBevelWidth(value) {
    this.ops.setWidth(value);
  }
}