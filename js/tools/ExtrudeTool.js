import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { TransformCommandSolver } from './shared/TransformCommandSolver.js';
import { TransformNumericInput } from './shared/TransformNumericInput.js';
import { ExtrudeOps } from '../operations/ExtrudeOps.js';

export class ExtrudeTool {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;

    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.sceneEditorHelpers = editor.sceneManager.sceneEditorHelpers;
    this.controls = editor.controlsManager;
    this.editSelection = editor.editSelection;
    this.viewportControls = editor.viewportControls;

    this.activeTransformSource = null;
    this.event = null;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode('translate');
    this.transformControls.visible = false;

    this.renderer.domElement.addEventListener('pointermove', (e) => this.event = e);
    this.sceneEditorHelpers.add(this.transformControls.getHelper());

    this.ops = new ExtrudeOps(editor, this.transformControls);
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

  enableFor(object) {
    if (!object) return;
    this.transformControls.attach(object);
    this.transformControls.visible = true;
    this.handle = this.transformControls.object;

    this.refreshOrientation();

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

    this.signals.transformOrientationChanged.add((orientation) => {
      if (!this.applyFaceNormalExtrudeOrientation()) {
        this.applyTransformOrientation(orientation);
      }
    });

    this.signals.editExtrudeStart.add(() => {
      const editedObject = this.editSelection.editedObject;
      if (!editedObject || !this.handle) return;

      if (this.activeTransformSource !== null) return;

      if (this.handle && this.transformControls.worldPositionStart) {
        this.handle.getWorldPosition(this.transformControls.worldPositionStart);
      }

      this.activeTransformSource = 'command';
      this.startExtrudeSession();

      this.transformSolver.updateHandleFromCommandInput('translate', this.event);
      this.applyExtrudeSession();

      this.signals.transformDragStarted.dispatch('edit');
    });
  }

  // Gizmo Control
  setupTransformListeners() {
    this.transformControls.addEventListener('mouseDown', () => {
      if (this.activeTransformSource !== null) return;

      this.activeTransformSource = 'gizmo';
      this.startExtrudeSession();
    });

    this.transformControls.addEventListener('change', () => {
      if (!this.transformControls.dragging) return;
      if (this.activeTransformSource !== 'gizmo') return;

      this.applyExtrudeSession();
    });

    this.transformControls.addEventListener('mouseUp', () => {
      if (this.activeTransformSource !== 'gizmo') return;

      this.commitExtrudeSession();
      this.clearCommandExtrudeState();
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
    this.transformSolver.updateHandleFromCommandInput('translate', this.event);
    this.applyExtrudeSession();
    this.signals.objectChanged.dispatch();
  }

  onPointerDown() {
    if (this.activeTransformSource !== 'command') return;
    this.commitExtrudeSession();
    this.transformSolver.clearGizmoActiveVisualState();
    this.transformSolver.clear();
  }

  onPointerUp() {
    if (this.activeTransformSource !== 'command') return;
    this.clearCommandExtrudeState();
    this.transformNumericInput.reset();
  }

  onKeyDown(event) {
    if (this.activeTransformSource !== 'command') return;

    const key = event.key.toLowerCase();
    if (key === 'x' || key === 'y' || key === 'z') {
      this.transformNumericInput.reset();
      this.transformNumericInput.setTransformType('axis');
      this.applyTransformOrientation(this.viewportControls.transformOrientation);

      const pivotQuaternion = this.handle.getWorldQuaternion(new THREE.Quaternion());
      this.ops.setPivotQuaternion(pivotQuaternion);
      this.transformSolver.startPivotQuaternion = pivotQuaternion;

      this.transformSolver.setAxisConstraintFromKey(key);

      this.transformSolver.updateHandleFromCommandInput('translate', this.event);
      this.applyExtrudeSession();
      return;
    }

    if (this.transformNumericInput.handleKey(event, 'translate')) {
      return;
    }

    if (event.key === 'Escape') {
      // Extrude cancel keeps the new topology at zero offset, then records it.
      this.cancelExtrudeSession();
      this.clearCommandExtrudeState();
      this.commitExtrudeSession();
      this.transformNumericInput.reset();
    }

    if (event.key === 'Enter') {
      this.commitExtrudeSession();
      this.clearCommandExtrudeState();
      this.transformNumericInput.reset();
    }
  }

  // Extrude session
  startExtrudeSession() {
    const session = this.ops.beginSession(this.editSelection.editedObject, this.handle);
    if (!session) return;

    this.transformSolver.beginSession(session.pivotPosition, session.pivotQuaternion, session.pivotScale);
    this.signals.onToolStarted.dispatch(this.transformNumericInput.getTransformDisplayText('translate'));
  }

  applyExtrudeSession() {
    if (!this.ops.hasSession()) return;

    if (!this.ops.isExtruded()) {
      this.transformNumericInput.setTransformType('axis');
      const extrusion = this.ops.extrude();
      if (extrusion?.hasReferenceFace) this.transformNumericInput.setTransformType('normal');
    }

    this.ops.apply(this.handle, this.event, this.transformNumericInput.active);
    this.signals.onToolUpdated.dispatch(this.transformNumericInput.getTransformDisplayText('translate'));
  }

  commitExtrudeSession() {
    this.ops.commit();
    this.refreshOrientation();
  }

  cancelExtrudeSession() {
    this.ops.cancel(this.handle);
  }

  clearCommandExtrudeState() {
    this.activeTransformSource = null;

    this.transformSolver.clear();
    this.transformSolver.clearGizmoActiveVisualState();

    requestAnimationFrame(() => {
      this.signals.transformDragEnded.dispatch('edit');
      this.signals.onToolEnded.dispatch();
    });
  }

  // Orientation
  refreshOrientation() {
    if (!this.applyFaceNormalExtrudeOrientation()) {
      this.applyTransformOrientation(this.viewportControls.transformOrientation);
    }
  }

  applyTransformOrientation(orientation, customQuaternion = null) {
    if (!this.transformControls) return;

    if (orientation === 'global') {
      this.editSelection.vertexHandle.quaternion.identity();
      this.transformControls.setSpace('world');

      this.transformControls.showX = true;
      this.transformControls.showY = true;
      this.transformControls.showZ = true;
    } else if (orientation === 'local') {
      const object = this.editSelection.editedObject;
      if (!object) return;

      this.editSelection.vertexHandle.quaternion.copy(
        object.getWorldQuaternion(new THREE.Quaternion())
      );
      this.transformControls.setSpace('local');

      this.transformControls.showX = true;
      this.transformControls.showY = true;
      this.transformControls.showZ = true;
    } else if (orientation === 'custom') {
      this.editSelection.vertexHandle.quaternion.copy(customQuaternion);
      this.transformControls.setSpace('local');

      this.transformControls.showX = false;
      this.transformControls.showY = true;
      this.transformControls.showZ = false;
    }
  }

  applyFaceNormalExtrudeOrientation() {
    const editedObject = this.editSelection.editedObject;
    if (!editedObject) return false;

    const orientation = ExtrudeOps.computeFaceNormalOrientation(
      editedObject,
      Array.from(this.editSelection.selectedFaceIds)
    );
    if (!orientation) return false;

    // Lock solver to face normal
    this.transformSolver.setCustomAxisConstraint(orientation.worldNormal);
    this.applyTransformOrientation('custom', orientation.quaternion);

    return true;
  }

  // Numeric input (called by TransformNumericInput)
  applyNumericTranslation(value) {
    const normal = this.transformNumericInput.transformType === 'normal'
      ? this.getCustomAxisConstraint()
      : null;

    if (!this.ops.numericTranslate(value, this.handle, normal)) return;

    this.transformControls.update();
    this.applyExtrudeSession();
  }

  getCustomAxisConstraint() {
    if (this.transformSolver.customAxisConstraint) {
      return this.transformSolver.customAxisConstraint.clone().normalize();
    }

    return null;
  }
}