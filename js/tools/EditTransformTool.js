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

      const handle = this.transformControls.object;

      if (this.mode === 'translate') {
        this.commitTranslate(editedObject, handle, selectedVertexIds);
      } else if (this.mode === 'rotate') {
        this.commitRotation(editedObject, handle, selectedVertexIds);
      } else if (this.mode === 'scale') {
        this.commitScale(editedObject, handle, selectedVertexIds);
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

    const snapTarget = this.snapManager.snapPosition(this.event, vertexIds, this.editSelection.editedObject);
    if (snapTarget !== null) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(this.oldPositions, snapTarget);
      offset.subVectors(snapTarget, nearestWorldPos);
      offset = this.snapManager.applyTranslationAxisConstraint(offset, this.transformControls.axis);

      this.transformControls.object.position.copy(this.startPivotPosition).add(offset);
      this.transformControls.update();
    }

    const newPositions = this.oldPositions.map(pos => pos.clone().add(offset));
    this.vertexEditor.setVerticesWorldPositions(vertexIds, newPositions);
  }

  applyRotate(vertexIds, handle) {
    if (!this.startPivotQuaternion || !this.oldPositions) return;

    const pivot = this.startPivotPosition.clone();
    const currentPivotQuat = handle.getWorldQuaternion(new THREE.Quaternion());
    const deltaQuat = currentPivotQuat.clone().multiply(this.startPivotQuaternion.clone().invert());

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
    const scaleFactor = new THREE.Vector3(
      currentPivotScale.x / this.startPivotScale.x,
      currentPivotScale.y / this.startPivotScale.y,
      currentPivotScale.z / this.startPivotScale.z
    );

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

  commitTranslate(object, handle, vertexIds) {
    const currentPivotPosition = handle.getWorldPosition(new THREE.Vector3());
    const offset = currentPivotPosition.clone().sub(this.startPivotPosition);

    if (offset.lengthSq() === 0) return;

    const newPositions = this.oldPositions.map(p => p.clone().add(offset));

    this.editor.execute(new SetVertexPositionCommand(this.editor, object, vertexIds, newPositions, this.oldPositions));
  }

  commitRotation(object, handle, vertexIds) {
    const currentPivotQuat = handle.getWorldQuaternion(new THREE.Quaternion());
    if (currentPivotQuat.equals(this.startPivotQuaternion)) return;

    const deltaQuat = currentPivotQuat.clone().multiply(this.startPivotQuaternion.clone().invert());
    const pivot = this.startPivotPosition.clone();

    const newPositions = this.oldPositions.map(pos => {
      const local = pos.clone().sub(pivot);
      local.applyQuaternion(deltaQuat);
      return local.add(pivot);
    });

    this.editor.execute(new SetVertexPositionCommand(this.editor, object, vertexIds, newPositions, this.oldPositions));
  }

  commitScale(object, handle, vertexIds) {
    const currentPivotScale = handle.getWorldScale(new THREE.Vector3());
    const scaleFactor = new THREE.Vector3(
      currentPivotScale.x / this.startPivotScale.x,
      currentPivotScale.y / this.startPivotScale.y,
      currentPivotScale.z / this.startPivotScale.z
    );

    if (scaleFactor.equals(new THREE.Vector3(1, 1, 1))) return;

    const pivot = this.startPivotPosition.clone();

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
  }
}