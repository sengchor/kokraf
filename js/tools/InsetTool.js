import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { TransformCommandSolver } from './shared/TransformCommandSolver.js';
import { ToolNumericInput } from './shared/ToolNumericInput.js';
import { InsetOps, InsetCommitResult } from '../operations/InsetOps.js';
import { projectToScreen, pixelsToWorldUnits } from '../utils/ScreenUtils.js';

export class InsetTool {
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

    this.ops = new InsetOps(editor);
    this.transformSolver = new TransformCommandSolver(this.camera, this.renderer, this.transformControls);
    this.toolNumericInput = new ToolNumericInput({
      tool: this,
      label: 'Width',
      getter: () => this.width,
      setter: (v) => this.applyInsetWidth(v),
      unit: 'm'
    });

    this.setupTransformListeners();
    this.setupListeners();

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);
  }

  // Read-only accessor (numeric input / UI)
  get width() {
    return this.ops.width;
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

    this.signals.editInsetStart.add(() => {
      if (!this.editSelection.editedObject || !this.handle) return;
      if (this.activeTransformSource !== null) return;

      if (this.handle && this.transformControls.worldPositionStart) {
        this.handle.getWorldPosition(this.transformControls.worldPositionStart);
      }

      this.activeTransformSource = 'command';
      this.startInsetSession();

      this.transformSolver.updateHandleFromCommandInput('translate', this.event);
      this.applyInsetSession();

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
      this.startInsetSession();
    });

    this.transformControls.addEventListener('change', () => {
      if (!this.transformControls.dragging) return;
      if (this.activeTransformSource !== 'gizmo') return;

      this.applyInsetSession();
    });

    this.transformControls.addEventListener('mouseUp', () => {
      if (this.activeTransformSource !== 'gizmo') return;

      this.commitInsetSession();
      this.clearCommandInsetState();
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
    this.applyInsetSession();
    this.signals.objectChanged.dispatch();
  }

  onPointerDown() {
    if (this.activeTransformSource !== 'command') return;
    this.commitInsetSession();
    this.transformSolver.clearGizmoActiveVisualState();
    this.transformSolver.clear();
  }

  onPointerUp() {
    if (this.activeTransformSource !== 'command') return;
    this.clearCommandInsetState();
    this.toolNumericInput.reset();
  }

  onKeyDown(event) {
    if (this.activeTransformSource !== 'command') return;

    if (this.toolNumericInput.handleKey(event)) {
      return;
    }

    if (event.key === 'Escape') {
      this.cancelInsetSession();
      this.clearCommandInsetState();
      this.toolNumericInput.reset();
    }

    if (event.key === 'Enter') {
      this.commitInsetSession();
      this.clearCommandInsetState();
      this.toolNumericInput.reset();
    }
  }

  // Inset Session
  startInsetSession() {
    const session = this.ops.beginSession(this.editSelection.editedObject, this.handle);
    if (!session || !this.ops.isValid()) return;

    this.transformSolver.beginSession(session.pivotPosition, null, null);
    this.startScreen = projectToScreen(session.pivotPosition, this.camera, this.renderer.domElement);

    this.signals.onToolStarted.dispatch(this.toolNumericInput.getDisplayText());
  }

  applyInsetSession() {
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

  commitInsetSession() {
    const result = this.ops.commit(this.handle);
    this.startScreen = null;

    if (result === InsetCommitResult.CANCELLED) {
      this.toolNumericInput.reset();
    }
  }

  cancelInsetSession() {
    this.ops.cancel(this.handle);
    this.startScreen = null;
  }

  clearCommandInsetState() {
    this.activeTransformSource = null;

    this.transformSolver.clear();
    this.transformSolver.clearGizmoActiveVisualState();

    requestAnimationFrame(() => {
      this.signals.transformDragEnded.dispatch('edit');
      this.signals.onToolEnded.dispatch();
    });
  }

  // Numeric input (called by ToolNumericInput)
  applyInsetWidth(value) {
    this.ops.setWidth(value);
  }
}