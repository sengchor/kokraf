import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { SetVertexPositionCommand } from '../commands/SetVertexPositionCommand.js';
import { ShadingUtils } from '../utils/ShadingUtils.js';

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
    this.commandAxisConstraint = null;
    this.event = null;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode(this.mode);
    this.transformControls.visible = false;

    this.renderer.domElement.addEventListener('pointermove', (e) => this.event = e);
    this.sceneEditorHelpers.add(this.transformControls.getHelper());

    this.changeTransformControlsColor();
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

      this.applyTransformSession();
      this.setGizmoActiveVisualState();

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
    this.updateHandleFromCommandInput();
    this.applyTransformSession();
    this.signals.objectChanged.dispatch();
  }

  onPointerDown() {
    if (this.activeTransformSource !== 'command') return;
    this.commitTransformSession();
    this.clearGizmoActiveVisualState();
  }

  onPointerUp() {
    if (this.activeTransformSource !== 'command') return;
    this.clearCommandTransformState();
  }

  onKeyDown(event) {
    if (this.activeTransformSource !== 'command') return;

    const key = event.key.toLowerCase();
    if (key === 'x' || key === 'y' || key === 'z') {
      this.commandAxisConstraint = this.getThreeAxisName(key);
      this.commandAxisConstraint = this.commandAxisConstraint.toUpperCase();
      this.transformControls.axis = this.commandAxisConstraint;
      this.startTranslateVector = null;
      this.startRotateVector = null;
      this.startScaleVector = null;

      this.updateHandleFromCommandInput();
      this.applyTransformSession();

      this.setGizmoActiveVisualState();
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
    this.commandAxisConstraint = null;
    this.clearGizmoActiveVisualState();
    this.activeTransformSource = null;
    this.startTranslateVector = null;
    this.startRotateVector = null;
    this.startScaleVector = null;

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

  // Gizmo visual state
  changeTransformControlsColor() {
    const xColor = new THREE.Color(0xff0000);
    const yColor = new THREE.Color(0x00ff00);
    const zColor = new THREE.Color(0x0000ff);

    const helper = this.transformControls.getHelper();

    helper.traverse(child => {
      if (!child.isMesh || !child.name) return;
      if (child.name === 'Z' || child.name === 'XY') {
        child.material.color.set(xColor);
      } else if (child.name === 'Y' || child.name === 'XZ') {
        child.material.color.set(zColor);
      } else if (child.name === 'X' || child.name === 'YZ') {
        child.material.color.set(yColor);
      }
    });
  }

  setGizmoActiveVisualState() {
    this.transformControls.dragging = true;
    this.transformControls.axis = this.commandAxisConstraint ?? 'XYZ';
  }

  clearGizmoActiveVisualState() {
    this.transformControls.dragging = false;
    this.transformControls.axis = null;
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
      offset = this.snapManager.constrainTranslationOffset(offset, this.transformControls.axis, this.transformControls.space, editedObject);

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

  getAxisVector(axis) {
    switch (axis) {
      case 'X': return new THREE.Vector3(1, 0, 0);
      case 'Y': return new THREE.Vector3(0, 1, 0);
      case 'Z': return new THREE.Vector3(0, 0, 1);
    }
  }

  getThreeAxisName(editorAxis) {
    switch (editorAxis) {
      case 'x': return 'z';
      case 'y': return 'x';
      case 'z': return 'y';
    }
  }

  updateHandleFromCommandInput() {
    if (!this.startPivotPosition) return;

    switch (this.mode) {
      case 'translate':
        this.updateHandleTranslation();
        break;
      case 'rotate':
        this.updateHandleRotation();
        break;
      case 'scale':
        this.updateHandleScale();
        break;
    }
  }

  updateHandleTranslation() {
    if (!this.startPivotPosition) return;

    const raycaster = this.getMouseRaycaster();

    const newPosition = new THREE.Vector3();

    if (this.commandAxisConstraint) {
      const axis = this.getAxisVector(this.commandAxisConstraint).clone();

      if (this.transformControls.space === 'local') {
        axis.applyQuaternion(this.startPivotQuaternion);
      }
      axis.normalize();

      newPosition.copy(this.closestPointOnLineToRay(this.startPivotPosition, axis, raycaster.ray));
    } else {
      // Free plane movement
      const axis = this.camera.getWorldDirection(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, this.startPivotPosition);
      if (!raycaster.ray.intersectPlane(plane, newPosition)) return;
    }

    if (!this.startTranslateVector) {
      this.startTranslateVector = newPosition.clone();
    }

    const delta = newPosition.clone().sub(this.startTranslateVector);

    this.handle.position.copy(this.startPivotPosition).add(delta);
    this.handle.updateMatrixWorld(true);
  }

  updateHandleRotation() {
    if (!this.startPivotPosition || !this.startPivotQuaternion) return;

    const raycaster = this.getMouseRaycaster();

    // Determine rotation axis
    const axis = new THREE.Vector3();
    if (this.commandAxisConstraint) {
      axis.copy(this.getAxisVector(this.commandAxisConstraint));
      if (this.transformControls.space === 'local') axis.applyQuaternion(this.startPivotQuaternion);
    } else {
      axis.copy(this.camera.getWorldDirection(new THREE.Vector3()));
    }
    axis.normalize();

    // Project mouse ray onto plane perpendicular to rotation axis
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, this.startPivotPosition);
    const hitPoint = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hitPoint)) return;

    const newVector = hitPoint.clone().sub(this.startPivotPosition).projectOnPlane(axis).normalize();
    if (!newVector) return;

    if (!this.startRotateVector) {
      this.startRotateVector = newVector.clone();
    }

    const cross = this.startRotateVector.clone().cross(newVector);
    const angle = Math.atan2(axis.dot(cross), this.startRotateVector.dot(newVector));
    const deltaQuat = new THREE.Quaternion().setFromAxisAngle(axis, angle);

    this.handle.quaternion.copy(deltaQuat).multiply(this.startPivotQuaternion);
    this.handle.updateMatrixWorld(true);
  }

  updateHandleScale() {
    if (!this.startPivotPosition || !this.startPivotScale) return;

    const raycaster = this.getMouseRaycaster();
    if (!raycaster) return;

    const newPosition = new THREE.Vector3();
    if (this.commandAxisConstraint) {
      const axis = this.getAxisVector(this.commandAxisConstraint).clone();

      if (this.transformControls.space === 'local') {
        axis.applyQuaternion(this.startPivotQuaternion);
      }
      axis.normalize();

      newPosition.copy(this.closestPointOnLineToRay(this.startPivotPosition, axis, raycaster.ray));
    } else {
      // Free plane movement
      const axis = this.camera.getWorldDirection(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, this.startPivotPosition);
      if (!raycaster.ray.intersectPlane(plane, newPosition)) return;
    }

    const rawVector = newPosition.clone().sub(this.startPivotPosition);
    if (!rawVector) return;

    // Initialize reference once
    if (!this.startScaleVector) {
      this.startScaleVector = rawVector.clone();
    }

    const scaleFactor = rawVector.length() / this.startScaleVector.length();

    let scaleVector;
    if (this.commandAxisConstraint) {
      scaleVector = new THREE.Vector3(1, 1, 1);
      if (this.commandAxisConstraint === 'X') scaleVector.x = scaleFactor;
      if (this.commandAxisConstraint === 'Y') scaleVector.y = scaleFactor;
      if (this.commandAxisConstraint === 'Z') scaleVector.z = scaleFactor;
    } else {
      scaleVector = new THREE.Vector3(scaleFactor, scaleFactor, scaleFactor);
    }

    this.handle.scale.copy(this.startPivotScale).multiply(scaleVector);
    this.handle.updateMatrixWorld(true);
  }

  closestPointOnLineToRay(linePoint, lineDir, ray) {
    const p = linePoint.clone();
    const d = lineDir.clone();
    const o = ray.origin.clone();
    const r = ray.direction.clone();

    const w0 = p.clone().sub(o);
    const a = d.dot(d);
    const b = d.dot(r);
    const c = r.dot(r);
    const d0 = d.dot(w0);
    const e = r.dot(w0);

    const denom = a*c - b*b;
    const t = denom !== 0 ? (b*e - c*d0) / denom : 0;

    return p.clone().add(d.clone().multiplyScalar(t));
  }

  getMouseRaycaster() {
    if (!this.event) return null;

    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((this.event.clientX - rect.left) / rect.width) * 2 - 1,
      -((this.event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    return raycaster;
  }
}