import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { TransformCommandSolver } from './TransformCommandSolver.js';
import { TransformNumericInput } from './TransformNumericInput.js';
import { EditTransformOps } from '../operations/EditTransformOps.js';

export class EditTransformTool {
  constructor(editor, mode = 'translate') {
    this.editor = editor;
    this.signals = editor.signals;
    this.mode = mode;

    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.controls = editor.controlsManager;
    this.editSelection = editor.editSelection;
    this.sceneEditorHelpers = editor.sceneManager.sceneEditorHelpers;
    this.viewportControls = editor.viewportControls;

    this.activeTransformSource = null;
    this.event = null;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode(this.mode);
    this.transformControls.visible = false;

    this.renderer.domElement.addEventListener('pointermove', (e) => this.event = e);
    this.sceneEditorHelpers.add(this.transformControls.getHelper());

    this.ops = new EditTransformOps(editor, this.transformControls);
    this.transformSolver = new TransformCommandSolver(this.camera, this.renderer, this.transformControls);
    this.transformNumericInput = new TransformNumericInput(this);

    this.transformSolver.changeTransformControlsColor();
    this.setupTransformListeners();
    this.setupListeners();

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);
  }

  // Read-only session accessors used by TransformNumericInput
  get startPivotPosition() {
    return this.ops.session?.pivotPosition ?? null;
  }

  get startPivotQuaternion() {
    return this.ops.session?.pivotQuaternion ?? null;
  }

  get startPivotScale() {
    return this.ops.session?.pivotScale ?? null;
  }

  get currentScaleFactor() {
    return this.ops.currentScaleFactor;
  }

  enableFor(object) {
    if (!object) return;
    this.transformControls.attach(object);
    this.transformControls.visible = true;
    this.handle = this.transformControls.object;

    this.applyTransformOrientation(this.viewportControls.transformOrientation);

    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this._onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('keydown', this._onKeyDown);
  }

  disable() {
    this.transformControls.detach();
    this.transformControls.visible = false;
  }

  setEnabled(state) {
    this.transformControls.enabled = state;
  }

  isTransforming() {
    return this.transformControls.dragging;
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

    this.signals.transformOrientationChanged.add((orientation) => {
      this.applyTransformOrientation(orientation);
    });

    this.signals.editTransformStart.add((transformMode) => {
      if (this.mode !== transformMode) return;

      if (!this.editSelection.editedObject || !this.handle) return;
      if (this.activeTransformSource !== null) return;

      if (this.handle && this.transformControls.worldPositionStart) {
        this.handle.getWorldPosition(this.transformControls.worldPositionStart);
      }

      this.activeTransformSource = 'command';
      this.startTransformSession();

      this.transformSolver.updateHandleFromCommandInput(this.mode, this.event);
      this.applyTransformSession();

      this.signals.transformDragStarted.dispatch('edit');
    });

    this.signals.editCancelTransform.add(() => {
      this.cancelTransformSession();

      this.activeTransformSource = null;

      this.transformSolver.clear();
      this.transformSolver.clearGizmoActiveVisualState();
      this.signals.transformDragEnded.dispatch('edit');

      this.transformNumericInput.reset();
    });
  }

  // Gizmo Control
  setupTransformListeners() {
    this.transformControls.addEventListener('mouseDown', () => {
      if (this.activeTransformSource !== null) return;

      this.activeTransformSource = 'gizmo';
      this.startTransformSession();
    });

    this.transformControls.addEventListener('change', () => {
      if (!this.transformControls.dragging) return;
      if (this.activeTransformSource !== 'gizmo') return;

      this.applyTransformSession();
    });

    this.transformControls.addEventListener('mouseUp', () => {
      if (this.activeTransformSource !== 'gizmo') return;

      this.commitTransformSession();
      this.clearCommandTransformState();
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
        this.signals.transformDragEnded.dispatch('edit');
      });
    });
  }

  // Command Control
  onPointerMove() {
    if (this.activeTransformSource !== 'command' || this.transformNumericInput.active) return;
    this.transformSolver.updateHandleFromCommandInput(this.mode, this.event);
    this.applyTransformSession();
    this.signals.objectChanged.dispatch();
  }

  onPointerDown() {
    if (this.activeTransformSource !== 'command') return;
    this.commitTransformSession();
    this.transformSolver.clearGizmoActiveVisualState();
    this.transformSolver.clear();
  }

  onPointerUp() {
    if (this.activeTransformSource !== 'command') return;
    this.clearCommandTransformState();
    this.transformNumericInput.reset();
  }

  onKeyDown(event) {
    if (this.activeTransformSource !== 'command') return;

    const key = event.key.toLowerCase();
    if (key === 'x' || key === 'y' || key === 'z') {
      this.transformNumericInput.reset();

      if (event.shiftKey && this.mode !== 'rotate') {
        this.transformSolver.setPlaneConstraintFromKey(key);
      } else {
        this.transformSolver.setAxisConstraintFromKey(key);
      }

      this.transformSolver.updateHandleFromCommandInput(this.mode, this.event);
      this.applyTransformSession();
      return;
    }

    if (this.transformNumericInput.handleKey(event, this.mode)) {
      return;
    }

    if (event.key === 'Escape') {
      this.cancelTransformSession();
      this.clearCommandTransformState();
      this.transformNumericInput.reset();
    }

    if (event.key === 'Enter') {
      this.commitTransformSession();
      this.clearCommandTransformState();
      this.transformNumericInput.reset();
    }
  }

  // Transform session
  startTransformSession() {
    const session = this.ops.beginSession(this.editSelection.editedObject, this.handle);
    if (!session) return;

    this.transformSolver.beginSession(session.pivotPosition, session.pivotQuaternion, session.pivotScale);
    this.signals.onToolStarted.dispatch(this.transformNumericInput.getTransformDisplayText(this.mode));
  }

  applyTransformSession() {
    if (!this.ops.hasSession() || !this.handle) return;

    this.ops.apply(this.mode, this.handle, this.event, this.transformNumericInput.active);
    this.signals.onToolUpdated.dispatch(this.transformNumericInput.getTransformDisplayText(this.mode));
  }

  commitTransformSession() {
    this.ops.commit(this.mode);
  }

  cancelTransformSession() {
    this.ops.cancel(this.handle);
  }

  clearCommandTransformState() {
    this.activeTransformSource = null;

    this.transformSolver.clear();
    this.transformSolver.clearGizmoActiveVisualState();

    requestAnimationFrame(() => {
      this.signals.transformDragEnded.dispatch('edit');
      this.signals.onToolEnded.dispatch();
    });
  }

  applyTransformOrientation(orientation) {
    if (!this.transformControls) return;

    if (orientation === 'global') {
      this.editSelection.vertexHandle.quaternion.identity();
      this.transformControls.setSpace('world');
    } else {
      const object = this.editSelection.editedObject;
      if (!object) return;

      this.editSelection.vertexHandle.quaternion.copy(
        object.getWorldQuaternion(new THREE.Quaternion())
      );
      this.transformControls.setSpace('local');
    }
  }

  // Numeric input (called by TransformNumericInput)
  applyNumericTranslation(value) {
    if (!this.ops.numericTranslate(value, this.handle)) return;
    this.transformControls.update();
    this.applyTransformSession();
  }

  applyNumericRotation(value) {
    if (!this.ops.numericRotate(value, this.handle, this.camera)) return;
    this.transformControls.update();
    this.applyTransformSession();
  }

  applyNumericScale(value) {
    if (!this.ops.numericScale(value, this.handle)) return;
    this.transformControls.update();
    this.applyTransformSession();
  }
}