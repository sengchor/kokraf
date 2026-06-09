import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { SetVertexPositionCommand } from '../commands/SetVertexPositionCommand.js';
import { ShadingUtils } from '../utils/ShadingUtils.js';
import { TransformCommandSolver } from './TransformCommandSolver.js';
import { TransformNumericInput } from './TransformNumericInput.js';

const _pivot = new THREE.Vector3();
const _deltaQuat = new THREE.Quaternion();
const _scaleFactor = new THREE.Vector3();
const _vec1 = new THREE.Vector3();
const _vec2 = new THREE.Vector3();
const _quat1 = new THREE.Quaternion();
const _quat2 = new THREE.Quaternion();

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
    this.transformNumericInput = new TransformNumericInput(this);

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

      const editedObject = this.editSelection.editedObject;
      if (!editedObject || !this.handle) return;

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
      this.transformSolver.setAxisConstraintFromKey(key);

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
    const editedObject = this.editSelection.editedObject;
    if (!editedObject || !this.handle) return;

    this.startPivotPosition = this.handle.getWorldPosition(new THREE.Vector3());
    this.startPivotQuaternion = this.handle.getWorldQuaternion(new THREE.Quaternion());
    this.startPivotScale = this.handle.scale.clone();

    this.selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
    if (!this.selectedVertexIds.length) return;

    this.transformSolver.beginSession(this.startPivotPosition, this.startPivotQuaternion, this.startPivotScale);

    this.vertexEditor.setObject(editedObject);
    this.oldPositions = this.vertexEditor.transform.getVertexPositions(this.selectedVertexIds);

    this.newPositionsPool = this.oldPositions.map(() => new THREE.Vector3());

    this.signals.onToolStarted.dispatch(this.transformNumericInput.getTransformDisplayText(this.mode));
  }

  applyTransformSession() {
    const editedObject = this.editSelection.editedObject;
    if (!editedObject || !this.handle || !this.selectedVertexIds) return;

    if (!this.vertexEditor.object) this.vertexEditor.setObject(editedObject);

    if (this.mode === 'translate') this.applyTranslate(this.selectedVertexIds, this.handle);
    else if (this.mode === 'rotate') this.applyRotate(this.selectedVertexIds, this.handle);
    else if (this.mode === 'scale') this.applyScale(this.selectedVertexIds, this.handle);

    this.signals.onToolUpdated.dispatch(this.transformNumericInput.getTransformDisplayText(this.mode));
  }

  commitTransformSession() {
    const editedObject = this.editSelection.editedObject;
    if (!editedObject || !this.handle || !this.selectedVertexIds) return;

    if (this.mode === 'translate') {
      this.commitTranslate(editedObject, this.selectedVertexIds);
    } else if (this.mode === 'rotate') {
      this.commitRotation(editedObject, this.selectedVertexIds);
    } else if (this.mode === 'scale') {
      this.commitScale(editedObject, this.selectedVertexIds);
    }

    if (editedObject.userData.shading === 'auto') {
      ShadingUtils.applyShading(editedObject, 'auto');
    }
    this.clearStartData();
  }

  cancelTransformSession() {
    const editedObject = this.editSelection.editedObject;
    if (!editedObject || !this.selectedVertexIds || !this.oldPositions) return;

    if (!this.vertexEditor.object) {
      this.vertexEditor.setObject(editedObject);
    }

    this.vertexEditor.transform.setVerticesWorldPositions(this.selectedVertexIds, this.oldPositions);

    // restore pivot / handle
    this.handle.position.copy(this.startPivotPosition);
    this.handle.quaternion.copy(this.startPivotQuaternion);
    this.handle.scale.copy(this.startPivotScale);
    this.handle.updateMatrixWorld(true);
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

  clearStartData() {
    this.vertexEditor.object = null;
    this.oldPositions = null;
    this.newPositionsPool = null;
    this.selectedVertexIds = null;
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
    handle.getWorldPosition(_vec1);
    _vec2.subVectors(_vec1, this.startPivotPosition);

    const snapTarget = this.snapManager.snapEditPosition(this.event, vertexIds, editedObject);
    
    if (snapTarget && !this.transformNumericInput.active) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(this.oldPositions, snapTarget);
      _vec2.subVectors(snapTarget, nearestWorldPos);
      _vec2.copy(this.snapManager.constrainTranslationOffset(_vec2, this.transformControls.axis, this.transformControls.space, this.startPivotQuaternion));

      handle.position.copy(this.startPivotPosition).add(_vec2);
      this.transformControls.update();
    }

    if (!this.currentTranslationDelta) this.currentTranslationDelta = new THREE.Vector3();
    this.currentTranslationDelta.copy(_vec2);

    for (let i = 0; i < this.oldPositions.length; i++) {
      this.newPositionsPool[i].copy(this.oldPositions[i]).add(_vec2);
    }

    this.vertexEditor.transform.setVerticesWorldPositions(vertexIds, this.newPositionsPool);
  }

  applyRotate(vertexIds, handle) {
    if (!this.startPivotQuaternion || !this.oldPositions) return;

    _pivot.copy(this.startPivotPosition);
    handle.getWorldQuaternion(_quat1);
    _deltaQuat.copy(_quat1).multiply(_quat2.copy(this.startPivotQuaternion).invert());

    const snapTarget = this.snapManager.snapEditPosition(this.event, vertexIds, this.editSelection.editedObject);

    if (snapTarget && !this.transformNumericInput.active) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(this.oldPositions, snapTarget);

      _vec1.copy(nearestWorldPos).sub(_pivot).normalize();
      _vec2.copy(snapTarget).sub(_pivot).normalize();

      if (_vec1.lengthSq() > 0 && _vec2.lengthSq() > 0) {
        const axis = this.snapManager.getEffectiveRotationAxis(this.transformControls.axis, this.transformControls.space, this.startPivotQuaternion);

        if (axis) {
          const fromProj = _vec1.projectOnPlane(axis).normalize();
          const toProj = _vec2.projectOnPlane(axis).normalize();

          if (fromProj.lengthSq() > 0 && toProj.lengthSq() > 0) {
            const angle = Math.atan2(axis.dot(_vec1.copy(fromProj).cross(toProj)), fromProj.dot(toProj));
            _deltaQuat.setFromAxisAngle(axis, angle);
          }
        } else {
          _deltaQuat.setFromUnitVectors(_vec1, _vec2);
        }
      }
    }

    if (!this.currentRotationDelta) this.currentRotationDelta = new THREE.Quaternion();
    this.currentRotationDelta.copy(_deltaQuat);

    for (let i = 0; i < this.oldPositions.length; i++) {
      const targetVec = this.newPositionsPool[i];
      targetVec.copy(this.oldPositions[i]).sub(_pivot);
      targetVec.applyQuaternion(_deltaQuat);
      targetVec.add(_pivot);
    }

    handle.quaternion.copy(_deltaQuat).multiply(this.startPivotQuaternion);
    this.transformControls.update();

    this.vertexEditor.transform.setVerticesWorldPositions(vertexIds, this.newPositionsPool);
  }

  applyScale(vertexIds, handle) {
    if (!this.startPivotScale || !this.oldPositions) return;

    const editedObject = this.editSelection.editedObject;
    _pivot.copy(this.startPivotPosition);
    _scaleFactor.copy(handle.scale).divide(this.startPivotScale);

    const snapTarget = this.snapManager.snapEditPosition(this.event, vertexIds, editedObject);

    if (snapTarget && !this.transformNumericInput.active) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(this.oldPositions, snapTarget);

      const fromOffset = _vec1.copy(nearestWorldPos).sub(_pivot);
      const toOffset = _vec2.copy(snapTarget).sub(_pivot);

      const projectedFrom = this.snapManager.projectOntoTransformAxis(fromOffset, this.transformControls.axis, this.transformControls.space, editedObject);
      const projectedTo = this.snapManager.projectOntoTransformAxis(toOffset, this.transformControls.axis, this.transformControls.space, editedObject);

      const fromLength = projectedFrom.length();
      const toLength = projectedTo.length();

      if (fromLength > 1e-6) {
        const uniformScale = toLength / fromLength;
        _scaleFactor.copy(this.snapManager.makeScaleVectorFromAxis(uniformScale, this.transformControls.axis));

        handle.scale.copy(this.startPivotScale).multiply(_scaleFactor);
        this.transformControls.update();
      }
    }

    if (!this.currentScaleDelta) this.currentScaleDelta = new THREE.Vector3();
    this.currentScaleDelta.copy(_scaleFactor);
    this.currentScaleFactor = this.currentScaleFactor || new THREE.Vector3();
    this.currentScaleFactor.copy(_scaleFactor);
    
    _quat1.copy(this.startPivotQuaternion);
    _quat2.copy(_quat1).invert();

    for (let i = 0; i < this.oldPositions.length; i++) {
      const targetVec = this.newPositionsPool[i];
      targetVec.copy(this.oldPositions[i]).sub(_pivot);

      if (this.transformControls.space === 'local') {
        targetVec.applyQuaternion(_quat2);
        targetVec.multiply(_scaleFactor);
        targetVec.applyQuaternion(_quat1);
      } else {
        targetVec.multiply(_scaleFactor);
      }

      targetVec.add(_pivot);
    }

    this.vertexEditor.transform.setVerticesWorldPositions(vertexIds, this.newPositionsPool);

    handle.scale.set(1, 1, 1);
    handle.updateMatrixWorld(true);
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

    this.currentScaleFactor = new THREE.Vector3(1, 1, 1);

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

  applyNumericTranslation(value) {
    const axis = this.transformControls.axis;
    if (!axis || !this.startPivotPosition || !this.handle) return;

    const offset = _vec1.set(0, 0, 0);

    if (axis === 'XYZ') offset.set(value, value, value);
    else if (axis === 'X') offset.x = value;
    else if (axis === 'Y') offset.y = value;
    else if (axis === 'Z') offset.z = value;
    else { return; }

    if (this.transformControls.space === 'local') {
      offset.applyQuaternion(this.startPivotQuaternion);
    }

    const worldPosition = this.startPivotPosition.clone().add(offset);
    this.handle.position.copy(worldPosition);

    this.transformControls.update();
    this.applyTransformSession();
  }

  applyNumericRotation(value) {
    const axis = this.transformControls.axis;
    if (!axis || !this.startPivotQuaternion || !this.handle) return;

    const angleRad = THREE.MathUtils.degToRad(value);

    const rotAxis = new THREE.Vector3();

    if (axis === 'XYZ') {
      this.camera.getWorldDirection(rotAxis).normalize();
    } 
    else if (axis === 'X') rotAxis.set(1, 0, 0);
    else if (axis === 'Y') rotAxis.set(0, 1, 0);
    else if (axis === 'Z') rotAxis.set(0, 0, 1);
    else { return; }

    _deltaQuat.setFromAxisAngle(rotAxis, angleRad);

    if (this.transformControls.space === 'local' && axis !== 'XYZ') {
      this.handle.quaternion.copy(this.startPivotQuaternion).multiply(_deltaQuat);
    } else {
      this.handle.quaternion.copy(_deltaQuat).multiply(this.startPivotQuaternion);
    }

    this.transformControls.update();
    this.applyTransformSession();
  }

  applyNumericScale(value) {
    const axis = this.transformControls.axis;
    if (!axis || !this.startPivotScale || !this.handle) return;

    const scaleFactor = _vec1.set(1, 1, 1);

    if (axis === 'XYZ') scaleFactor.set(value, value, value);
    else if (axis === 'X') scaleFactor.x = value;
    else if (axis === 'Y') scaleFactor.y = value;
    else if (axis === 'Z') scaleFactor.z = value;
    else { return; }

    this.handle.scale.copy(this.startPivotScale).multiply(scaleFactor);

    this.transformControls.update();
    this.applyTransformSession();
  }
}