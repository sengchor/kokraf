import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { VertexEditor } from './VertexEditor.js';
import { SetVertexPositionCommand } from '../commands/SetVertexPositionCommand.js';
import { ShadingUtils } from '../utils/ShadingUtils.js';

export class EditTransformTool {
  constructor(editor, mode = 'translate') {
    this.editor = editor;
    this.signals = editor.signals;
    this.mode = mode;
    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.controls = editor.controlsManager;
    this.editSelection = editor.editSelection;
    this.snapManager = editor.snapManager;
    this.sceneEditorHelpers = editor.sceneManager.sceneEditorHelpers;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode(this.mode);
    this.transformControls.visible = false;

    this.event = null;
    this.renderer.domElement.addEventListener('pointermove', (e) => this.event = e);

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

    this.sceneEditorHelpers.add(this.transformControls.getHelper());

    this.changeTransformControlsColor();
    this.setupTransformListeners();
  }

  enableFor(object) {
    if (!object) return;
    this.transformControls.attach(object);
    this.transformControls.visible = true;

    // Keep scale gizmo aligned to world axes
    if (this.transformControls.mode === 'scale') {
      this.editSelection.vertexHandle.rotation.set(0, 0, 0);
    }
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

  setupTransformListeners() {
    this.transformControls.addEventListener('mouseDown', () => {
      const editedObject = this.editSelection.editedObject;
      const handle = this.transformControls.object;
      if (!editedObject) return;

      this.startPivotPosition = handle.getWorldPosition(new THREE.Vector3());
      this.startPivotQuaternion = handle.getWorldQuaternion(new THREE.Quaternion());
      this.startPivotScale = handle.getWorldScale(new THREE.Vector3());

      const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
      if (!selectedVertexIds.length) return;

      this.vertexEditor = new VertexEditor(this.editor, editedObject);
      this.oldPositions = this.vertexEditor.getVertexPositions(selectedVertexIds);
    });

    this.transformControls.addEventListener('change', () => {
      if (!this.transformControls.dragging) return;
      const editedObject = this.editSelection.editedObject;
      const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
      if (!selectedVertexIds.length) return;

      if (!this.vertexEditor) this.vertexEditor = new VertexEditor(this.editor, editedObject);

      const handle = this.transformControls.object;

      if (this.mode === 'translate') this.applyTranslate(selectedVertexIds, handle);
      else if (this.mode === 'rotate') this.applyRotate(selectedVertexIds, handle);
      else if (this.mode === 'scale') this.applyScale(selectedVertexIds, handle);
    });

    this.transformControls.addEventListener('mouseUp', () => {
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
    });
  }

  applyTranslate(vertexIds, handle) {
    if (!this.startPivotPosition || !this.oldPositions) return;

    const currentPivotPosition = handle.getWorldPosition(new THREE.Vector3());
    let offset = new THREE.Vector3().subVectors(currentPivotPosition, this.startPivotPosition);

    const snapTarget = this.snapManager.snapEditPosition(this.event, vertexIds, this.editSelection.editedObject);
    
    if (snapTarget) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(this.oldPositions, snapTarget);
      offset.subVectors(snapTarget, nearestWorldPos);
      offset = this.snapManager.constrainTranslationOffset(offset, this.transformControls.axis);

      handle.position.copy(this.startPivotPosition).add(offset);
      this.transformControls.update();
    }

    this.currentTranslationDelta = offset.clone();
    const newPositions = this.oldPositions.map(pos => pos.clone().add(offset));
    this.vertexEditor.setVerticesWorldPositions(vertexIds, newPositions);
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
        const axis = this.snapManager.getRotationAxis(this.transformControls.axis);

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

      handle.quaternion.copy(this.startPivotQuaternion).multiply(deltaQuat);
      this.transformControls.update();
    }

    this.currentRotationDelta = deltaQuat.clone();
    const newPositions = this.oldPositions.map(pos => {
      const local = pos.clone().sub(pivot);
      local.applyQuaternion(deltaQuat);
      return local.add(pivot);
    });

    this.vertexEditor.setVerticesWorldPositions(vertexIds, newPositions);
  }

  applyScale(vertexIds, handle) {
    if (!this.startPivotScale || !this.oldPositions) return;

    const pivot = this.startPivotPosition.clone();
    const currentPivotScale = handle.getWorldScale(new THREE.Vector3());
    let scaleFactor = currentPivotScale.divide(this.startPivotScale);

    const snapTarget = this.snapManager.snapEditPosition(this.event, vertexIds, this.editSelection.editedObject);

    if (snapTarget) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(this.oldPositions, snapTarget);

      const fromDir = this.snapManager.constrainTranslationOffset(nearestWorldPos.clone().sub(pivot), this.transformControls.axis);

      const toDir = this.snapManager.constrainTranslationOffset(snapTarget.clone().sub(pivot), this.transformControls.axis);

      const fromLength = fromDir.length();
      const toLength = toDir.length();

      if (fromLength > 1e-6) {
        const uniformScale = toLength / fromLength;

        scaleFactor = this.snapManager.makeScaleVectorFromAxis(uniformScale, this.transformControls.axis);

        handle.scale.copy(this.startPivotScale).multiply(scaleFactor);
        this.transformControls.update();
      }
    }

    this.currentScaleDelta = scaleFactor.clone();
    const newPositions = this.oldPositions.map(pos => {
      const local = pos.clone().sub(pivot);
      local.multiply(scaleFactor);
      return local.add(pivot);
    });

    this.vertexEditor.setVerticesWorldPositions(vertexIds, newPositions);
  }

  restoreSubSelection() {
    const mode = this.editSelection.subSelectionMode;
    const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
    const selectedEdgeIds = Array.from(this.editSelection.selectedEdgeIds);
    const selectedFaceIds = Array.from(this.editSelection.selectedFaceIds);

    if (mode === 'vertex') {
      this.editSelection.selectVertices(selectedVertexIds);
    } else if (mode === 'edge') {
      this.editSelection.selectEdges(selectedEdgeIds);
    } else if (mode === 'face') {
      this.editSelection.selectFaces(selectedFaceIds);
    }
  }

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

    if (scaleFactor.equals(new THREE.Vector3(1, 1, 1))) return;

    const newPositions = this.oldPositions.map(pos => {
      const local = pos.clone().sub(pivot);
      local.multiply(scaleFactor);
      return local.add(pivot);
    });

    this.editor.execute(new SetVertexPositionCommand(this.editor, object, vertexIds, newPositions, this.oldPositions));
  }

  clearStartData() {
    this.vertexEditor = null;
    this.oldPositions = null;
    this.startPivotPosition = null;
    this.startPivotQuaternion = null;
    this.startPivotScale = null;

    this.currentTranslationDelta = null;
    this.currentRotationDelta = null;
    this.currentScaleDelta = null;
  }
}