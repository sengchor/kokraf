import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { TransformCommandSolver } from './shared/TransformCommandSolver.js';
import { DuplicateOps } from '../operations/DuplicateOps.js';

export class DuplicateTool {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;

    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.editSelection = editor.editSelection;
    this.sceneEditorHelpers = editor.sceneManager.sceneEditorHelpers;
    this.viewportControls = editor.viewportControls;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode('translate');
    this.transformControls.visible = false;

    this.activeTransformSource = null;
    this.event = null;

    this.renderer.domElement.addEventListener('pointermove', (e) => this.event = e);
    this.sceneEditorHelpers.add(this.transformControls.getHelper());

    this.ops = new DuplicateOps(editor, this.transformControls);
    this.transformSolver = new TransformCommandSolver(this.camera, this.renderer, this.transformControls);

    this.transformSolver.changeTransformControlsColor();
    this.setupListeners();

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);
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

  // Signals & Listeners
  setupListeners() {
    this.signals.viewportCameraChanged.add((camera) => {
      if (camera.isDefault) {
        this.camera = camera;
        this.transformControls.camera = camera;
        this.transformSolver.camera = camera;
      }
    });

    this.signals.duplicateSelection.add(() => {
      if (!this.editSelection.editedObject) return;

      const { selectedVertexIds, selectedEdgeIds, selectedFaceIds } = this.editSelection;
      if (selectedVertexIds.size === 0 && selectedEdgeIds.size === 0 && selectedFaceIds.size === 0) return;

      this.enableFor(this.editSelection.vertexHandle);

      if (!this.handle) return;
      if (this.activeTransformSource !== null) return;

      if (this.transformControls.worldPositionStart) {
        this.handle.getWorldPosition(this.transformControls.worldPositionStart);
      }

      if (!this.startDuplicateSession()) {
        this.disable();
        return;
      }

      this.activeTransformSource = 'command';

      this.transformSolver.updateHandleFromCommandInput('translate', this.event);
      this.applyDuplicateSession();

      this.signals.transformDragStarted.dispatch('edit');
    });
  }

  // Command Control
  onPointerMove() {
    if (this.activeTransformSource !== 'command') return;
    this.transformSolver.updateHandleFromCommandInput('translate', this.event);
    this.applyDuplicateSession();
    this.signals.objectChanged.dispatch();
  }

  onPointerDown() {
    if (this.activeTransformSource !== 'command') return;
    this.commitDuplicateSession();
    this.transformSolver.clearGizmoActiveVisualState();
    this.transformSolver.clear();
  }

  onPointerUp() {
    if (this.activeTransformSource !== 'command') return;
    this.clearCommandDuplicateState();
  }

  onKeyDown(event) {
    if (this.activeTransformSource !== 'command') return;

    const key = event.key.toLowerCase();
    if (key === 'x' || key === 'y' || key === 'z') {
      this.transformSolver.setAxisConstraintFromKey(key);

      this.transformSolver.updateHandleFromCommandInput('translate', this.event);
      this.applyDuplicateSession();
      return;
    }

    if (event.key === 'Escape') {
      // Cancel keeps the copy in place on top of the original, then records it.
      this.cancelDuplicateSession();
      this.clearCommandDuplicateState();
      this.commitDuplicateSession();
    }

    if (event.key === 'Enter') {
      this.commitDuplicateSession();
      this.clearCommandDuplicateState();
    }
  }

  // Duplicate session
  // Returns true if a session started (and the selection was duplicated).
  startDuplicateSession() {
    const session = this.ops.beginSession(this.editSelection.editedObject, this.handle);
    if (!session) return false;

    this.transformSolver.beginSession(session.pivotPosition, session.pivotQuaternion, session.pivotScale);
    return true;
  }

  applyDuplicateSession() {
    if (!this.ops.hasSession() || !this.handle) return;
    this.ops.apply(this.handle, this.event);
  }

  commitDuplicateSession() {
    this.ops.commit();
  }

  cancelDuplicateSession() {
    this.ops.cancel(this.handle);
  }

  clearCommandDuplicateState() {
    this.activeTransformSource = null;

    this.transformSolver.clear();
    this.transformSolver.clearGizmoActiveVisualState();
    this.disable();

    requestAnimationFrame(() => {
      this.signals.transformDragEnded.dispatch('edit');
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
}