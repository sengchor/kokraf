import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { SetVertexPositionCommand } from '../commands/SetVertexPositionCommand.js';
import { ShadingUtils } from '../utils/ShadingUtils.js';
import { TransformCommandSolver } from './TransformCommandSolver.js';

export class EditTransformTool {
  constructor(editor, mode = 'translate') {
    this.editor = editor;
    this.signals = editor.signals;
    this.mode = mode;

    this.vertexEditor = editor.vertexEditor;
    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.controls = editor.controlsManager;
    this.editSelection = editor.editSelection;
    this.snapManager = editor.snapManager;
    this.sceneEditorHelpers = editor.sceneManager.sceneEditorHelpers;
    this.viewportControls = editor.viewportControls;

    this.activeTransformSource = null;
    this.event = null;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode(this.mode);
    this.transformControls.visible = false;

    this.renderer.domElement.addEventListener('pointermove', (e) => this.event = e);
    this.sceneEditorHelpers.add(this.transformControls.getHelper());

    this.transformSolver = new TransformCommandSolver(this.camera, this.renderer, this.transformControls);

    this.transformSolver.changeTransformControlsColor();
    this.setupTransformListeners();
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

  setEnabled(state) {
    this.transformControls.enabled = state;
  }

  isTransforming() {
    return this.transformControls.dragging;
  }

  // Signals & Listeners
  setupListeners() {
    this.signals.transformOrientationChanged.add((orientation) => {
      this.applyTransformOrientation(orientation);
    });

    this.signals.editTransformStart.add((transformMode) => {
      if (this.mode !== transformMode) return;

      const editedObject = this.editSelection.editedObject;
      if (!editedObject) return;

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
    if (this.activeTransformSource !== 'command') return;
    this.transformSolver.updateHandleFromCommandInput(this.mode, this.event);
    this.applyTransformSession();
    this.signals.objectChanged.dispatch();
  }

  onPointerDown() {
    if (this.activeTransformSource !== 'command') return;
    this.commitTransformSession();
    this.transformSolver.clearGizmoActiveVisualState();
  }

  onPointerUp() {
    if (this.activeTransformSource !== 'command') return;
    this.clearCommandTransformState();
  }

  onKeyDown(event) {
    if (this.activeTransformSource !== 'command') return;

    const key = event.key.toLowerCase();
    if (key === 'x' || key === 'y' || key === 'z') {
      this.transformSolver.setAxisConstraintFromKey(key);

      this.transformSolver.updateHandleFromCommandInput();
      this.applyTransformSession();
      return;
    }

    if (event.key === 'Escape') {
      this.cancelTransformSession();
      this.clearCommandTransformState();
    }

    if (event.key === 'Enter') {
      this.commitTransformSession();
      this.clearCommandTransformState();
    }
  }

  // Transform session
  startTransformSession() {
    const editedObject = this.editSelection.editedObject;
    if (!editedObject) return;

    this.startPivotPosition = this.handle.getWorldPosition(new THREE.Vector3());
    this.startPivotQuaternion = this.handle.getWorldQuaternion(new THREE.Quaternion());
    this.startPivotScale = this.handle.getWorldScale(new THREE.Vector3());

    const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
    if (!selectedVertexIds.length) return;

    this.transformSolver.beginSession(this.startPivotPosition, this.startPivotQuaternion, this.startPivotScale);

    this.vertexEditor.setObject(editedObject);
    this.oldPositions = this.vertexEditor.transform.getVertexPositions(selectedVertexIds);
  }

  applyTransformSession() {
    const editedObject = this.editSelection.editedObject;
    const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
    if (!selectedVertexIds.length) return;

    if (!this.vertexEditor.object) this.vertexEditor.setObject(editedObject);

    if (this.mode === 'translate') this.applyTranslate(selectedVertexIds, this.handle);
    else if (this.mode === 'rotate') this.applyRotate(selectedVertexIds, this.handle);
    else if (this.mode === 'scale') this.applyScale(selectedVertexIds, this.handle);
  }

  commitTransformSession() {
    const editedObject = this.editSelection.editedObject;
    if (!editedObject) return;

    const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
    if (!selectedVertexIds.length) return;

    if (this.mode === 'translate') {
      this.commitTranslate(editedObject, selectedVertexIds);
    } else if (this.mode === 'rotate') {
      this.commitRotation(editedObject, selectedVertexIds);
    } else if (this.mode === 'scale') {
      this.commitScale(editedObject, selectedVertexIds);
    }

    if (editedObject.userData.shading === 'auto') {
      ShadingUtils.applyShading(editedObject, 'auto');
    }
    this.clearStartData();
  }

  cancelTransformSession() {
    const editedObject = this.editSelection.editedObject;
    if (!editedObject) return;

    // restore vertex positions
    const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
    if (!selectedVertexIds.length) return;

    if (!this.oldPositions) return;

    if (!this.vertexEditor.object) {
      this.vertexEditor.setObject(editedObject);
    }

    this.vertexEditor.transform.setVerticesWorldPositions(selectedVertexIds, this.oldPositions);

    // restore pivot / handle
    this.handle.position.copy(this.startPivotPosition);
    this.handle.quaternion.copy(this.startPivotQuaternion);
    this.handle.scale.copy(this.startPivotScale);
    this.handle.updateMatrixWorld(true);
  }

  clearCommandTransformState() {
    this.activeTransformSource = null;
    this.startTranslateVector = null;
    this.startRotateVector = null;
    this.startScaleVector = null;

    this.transformSolver.clear();
    this.transformSolver.clearGizmoActiveVisualState();

    requestAnimationFrame(() => {
      this.signals.transformDragEnded.dispatch('edit');
    });
  }

  clearStartData() {
    this.vertexEditor.object = null;
    this.oldPositions = null;
    this.startPivotPosition = null;
    this.startPivotQuaternion = null;
    this.startPivotScale = null;

    this.currentTranslationDelta = null;
    this.currentRotationDelta = null;
    this.currentScaleDelta = null;
  }

  // Apply transforms
  applyTranslate(vertexIds, handle) {
    if (!this.startPivotPosition || !this.oldPositions) return;

    const editedObject = this.editSelection.editedObject;
    const currentPivotPosition = handle.getWorldPosition(new THREE.Vector3());
    let offset = new THREE.Vector3().subVectors(currentPivotPosition, this.startPivotPosition);

    const snapTarget = this.snapManager.snapEditPosition(this.event, vertexIds, editedObject);
    
    if (snapTarget) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(this.oldPositions, snapTarget);
      offset.subVectors(snapTarget, nearestWorldPos);
      offset = this.snapManager.constrainTranslationOffset(offset, this.transformControls.axis, this.transformControls.space, this.startPivotQuaternion);

      handle.position.copy(this.startPivotPosition).add(offset);
      this.transformControls.update();
    }

    this.currentTranslationDelta = offset.clone();
    const newPositions = this.oldPositions.map(pos => pos.clone().add(offset));
    this.vertexEditor.transform.setVerticesWorldPositions(vertexIds, newPositions);
  }

  applyRotate(vertexIds, handle) {
    if (!this.startPivotQuaternion || !this.oldPositions) return;

    const pivot = this.startPivotPosition.clone();
    const currentPivotQuat = handle.getWorldQuaternion(new THREE.Quaternion());
    let deltaQuat = currentPivotQuat.clone().multiply(this.startPivotQuaternion.clone().invert());

    const snapTarget = this.snapManager.snapEditPosition(this.event, vertexIds, this.editSelection.editedObject);

    if (snapTarget) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(this.oldPositions, snapTarget);

      const fromDir = nearestWorldPos.clone().sub(pivot).normalize();
      const toDir = snapTarget.clone().sub(pivot).normalize();

      if (fromDir.lengthSq() > 0 && toDir.lengthSq() > 0) {
        const axis = this.snapManager.getEffectiveRotationAxis(this.transformControls.axis, this.transformControls.space, this.startPivotQuaternion);

        if (axis) {
          const fromProj = fromDir.clone().projectOnPlane(axis).normalize();
          const toProj = toDir.clone().projectOnPlane(axis).normalize();

          if (fromProj.lengthSq() > 0 && toProj.lengthSq() > 0) {
            const angle = Math.atan2(axis.dot(fromProj.clone().cross(toProj)), fromProj.dot(toProj));

            deltaQuat = new THREE.Quaternion().setFromAxisAngle(axis, angle);
          }
        } else {
          deltaQuat = new THREE.Quaternion().setFromUnitVectors(fromDir, toDir);
        }
      }
    }

    this.currentRotationDelta = deltaQuat.clone();
    const newPositions = this.oldPositions.map(pos => {
      const local = pos.clone().sub(pivot);
      local.applyQuaternion(deltaQuat);
      return local.add(pivot);
    });

    handle.quaternion.copy(this.startPivotQuaternion);
    this.transformControls.update();

    this.vertexEditor.transform.setVerticesWorldPositions(vertexIds, newPositions);
  }

  applyScale(vertexIds, handle) {
    if (!this.startPivotScale || !this.oldPositions) return;

    const editedObject = this.editSelection.editedObject;
    const pivot = this.startPivotPosition.clone();
    const currentPivotScale = handle.getWorldScale(new THREE.Vector3());
    let scaleFactor = currentPivotScale.divide(this.startPivotScale);

    const snapTarget = this.snapManager.snapEditPosition(this.event, vertexIds, editedObject);

    if (snapTarget) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(this.oldPositions, snapTarget);

      const fromOffset = nearestWorldPos.clone().sub(pivot);
      const toOffset = snapTarget.clone().sub(pivot);

      const projectedFrom = this.snapManager.projectOntoTransformAxis(fromOffset, this.transformControls.axis, this.transformControls.space, editedObject);
      const projectedTo = this.snapManager.projectOntoTransformAxis(toOffset, this.transformControls.axis, this.transformControls.space, editedObject);

      const fromLength = projectedFrom.length();
      const toLength = projectedTo.length();

      if (fromLength > 1e-6) {
        const uniformScale = toLength / fromLength;

        scaleFactor = this.snapManager.makeScaleVectorFromAxis(uniformScale, this.transformControls.axis);

        handle.scale.copy(this.startPivotScale).multiply(scaleFactor);
        this.transformControls.update();
      }
    }

    this.currentScaleDelta = scaleFactor.clone();
    const pivotQuat = this.startPivotQuaternion;
    const invPivotQuat = pivotQuat.clone().invert();
    const newPositions = this.oldPositions.map(pos => {
      let offset = pos.clone().sub(pivot);

      if (this.transformControls.space === 'local') {
        offset.applyQuaternion(invPivotQuat);
        offset.multiply(scaleFactor);
        offset.applyQuaternion(pivotQuat);
      } else {
        offset.multiply(scaleFactor);
      }

      return offset.add(pivot);
    });

    this.vertexEditor.transform.setVerticesWorldPositions(vertexIds, newPositions);
  }

  // Commit Transforms
  commitTranslate(object, vertexIds) {
    if (!this.currentTranslationDelta) return;

    const offset = this.currentTranslationDelta;

    if (offset.lengthSq() === 0) return;

    const newPositions = this.oldPositions.map(pos => pos.clone().add(offset));

    this.editor.execute(new SetVertexPositionCommand(this.editor, object, vertexIds, newPositions, this.oldPositions));
  }

  commitRotation(object, vertexIds) {
    if (!this.currentRotationDelta) return;

    const pivot = this.startPivotPosition.clone();
    const deltaQuat = this.currentRotationDelta;

    if (deltaQuat.equals(new THREE.Quaternion())) return;

    const newPositions = this.oldPositions.map(pos => {
      const local = pos.clone().sub(pivot);
      local.applyQuaternion(deltaQuat);
      return local.add(pivot);
    });

    this.editor.execute(new SetVertexPositionCommand(this.editor, object, vertexIds, newPositions, this.oldPositions));
  }

  commitScale(object, vertexIds) {
    if (!this.currentScaleDelta) return;

    const pivot = this.startPivotPosition.clone();
    const scaleFactor = this.currentScaleDelta;
    const pivotQuat = this.startPivotQuaternion;
    const invPivotQuat = pivotQuat.clone().invert();

    if (scaleFactor.equals(new THREE.Vector3(1, 1, 1))) return;

    const newPositions = this.oldPositions.map(pos => {
      let offset = pos.clone().sub(pivot);

      if (this.transformControls.space === 'local') {
        offset.applyQuaternion(invPivotQuat);
        offset.multiply(scaleFactor);
        offset.applyQuaternion(pivotQuat);
      } else {
        offset.multiply(scaleFactor);
      }

      return offset.add(pivot);
    });

    this.editor.execute(new SetVertexPositionCommand(this.editor, object, vertexIds, newPositions, this.oldPositions));
  }

  // Utilities
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