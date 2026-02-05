import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { TransformCommandSolver } from './TransformCommandSolver.js';
import { DuplicateSelectionCommand } from '../commands/DuplicateSelectionCommand.js';

export class DuplicateTool {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;

    this.vertexEditor = editor.vertexEditor;
    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.editSelection = editor.editSelection;
    this.snapManager = editor.snapManager;
    this.sceneEditorHelpers = editor.sceneManager.sceneEditorHelpers;
    this.viewportControls = editor.viewportControls;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode('translate');
    this.transformControls.visible = false;

    this.activeTransformSource = null;
    this.event = null;

    this.renderer.domElement.addEventListener('pointermove', (e) => this.event = e);
    this.sceneEditorHelpers.add(this.transformControls.getHelper());

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

  setupListeners() {
    this.signals.duplicateSelection.add(() => {
      const editedObject = this.editSelection.editedObject;
      if (!editedObject) return;

      const selectedVertexIds = this.editSelection.selectedVertexIds;
      const selectedEdgeIds = this.editSelection.selectedEdgeIds;
      const selectedFaceIds = this.editSelection.selectedFaceIds;

      if (
        selectedVertexIds.size === 0 && selectedEdgeIds.size === 0 && selectedFaceIds.size === 0
      ) return;

      const attachObject = this.editSelection.vertexHandle;
      this.enableFor(attachObject);

      if (!this.handle) return;
      if (this.activeTransformSource !== null) return;

      if (this.handle && this.transformControls.worldPositionStart) {
        this.handle.getWorldPosition(this.transformControls.worldPositionStart);
      }

      this.activeTransformSource = 'command';
      this.startDuplicateSession();

      this.transformSolver.updateHandleFromCommandInput('translate', this.event);
      this.applyDuplicateSession();

      this.signals.transformDragStarted.dispatch('edit');
    });
  }

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
      this.cancelDuplicateSession();
      this.clearCommandDuplicateState();
      this.commitDuplicateSession();
    }

    if (event.key === 'Enter') {
      this.commitDuplicateSession();
      this.clearCommandDuplicateState();
    }
  }

  startDuplicateSession() {
    const editedObject = this.editSelection.editedObject;
    if (!editedObject || !this.handle) return;

    this.startPivotPosition = this.handle.getWorldPosition(new THREE.Vector3());
    this.startPivotQuaternion = this.handle.getWorldQuaternion(new THREE.Quaternion());
    this.startPivotScale = this.handle.getWorldScale(new THREE.Vector3());

    const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
    if (!selectedVertexIds.length) return;

    this.transformSolver.beginSession(this.startPivotPosition, this.startPivotQuaternion, this.startPivotScale);

    this.vertexEditor.setObject(editedObject);
    this.oldPositions = this.vertexEditor.transform.getVertexPositions(selectedVertexIds);
    const meshData = editedObject.userData.meshData;
    this.beforeMeshData = structuredClone(meshData);

    this.duplicateSelection();
  }

  applyDuplicateSession() {
    if (!this.startPivotPosition) return;

    const editedObject = this.editSelection.editedObject;
    if (!editedObject || !this.handle) return;

    const currentPivotPosition = this.handle.getWorldPosition(new THREE.Vector3());
    let offset = new THREE.Vector3().subVectors(currentPivotPosition, this.startPivotPosition);

    const snapTarget = this.snapManager.snapEditPosition(this.event, this.newVertexIds, editedObject);
    
    if (snapTarget) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(this.oldPositions, snapTarget);
      offset.subVectors(snapTarget, nearestWorldPos);
      offset = this.snapManager.constrainTranslationOffset(offset, this.transformControls.axis, this.transformControls.space, this.startPivotQuaternion);

      this.handle.position.copy(this.startPivotPosition).add(offset);
      this.transformControls.update();
    }

    // Move duplicated vertices
    const newPositions = this.initialDuplicatedPositions.map(pos => pos.clone().add(offset));
    this.vertexEditor.transform.setVerticesWorldPositions(this.newVertexIds, newPositions);
  }

  commitDuplicateSession() {
    const editedObject = this.editSelection.editedObject;
    if (!editedObject || !this.handle) return;

    const mode = this.editSelection.subSelectionMode;

    this.vertexEditor.setObject(editedObject);
    this.vertexEditor.transform.updateGeometryAndHelpers();
    const meshData = editedObject.userData.meshData;
    this.afterMeshData = structuredClone(meshData);

    this.editor.execute(new DuplicateSelectionCommand(this.editor, editedObject, this.beforeMeshData, this.afterMeshData));

    if (mode === 'vertex') {
      this.editSelection.selectVertices(this.newVertexIds);
    } else if (mode === 'edge') {
      this.editSelection.selectEdges(this.newEdgeIds);
    } else if (mode === 'face') {
      this.editSelection.selectFaces(this.newFaceIds);
    }

    this.clearStartData();
  }

  cancelDuplicateSession() {
    const editedObject = this.editSelection.editedObject;
    if (!editedObject) return;

    if (!this.newVertexIds || !this.initialDuplicatedPositions) return;

    if (!this.vertexEditor.object) {
      this.vertexEditor.setObject(editedObject);
    }

    // Restore duplicated vertices
    this.vertexEditor.transform.setVerticesWorldPositions(
      this.newVertexIds,
      this.initialDuplicatedPositions
    );

    // restore pivot / handle
    this.handle.position.copy(this.startPivotPosition);
    this.handle.quaternion.copy(this.startPivotQuaternion);
    this.handle.scale.copy(this.startPivotScale);
    this.handle.updateMatrixWorld(true);
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

  clearStartData() {
    this.vertexEditor.object = null;
    this.startPivotPosition = null;
    this.startPivotQuaternion = null;
    this.startPivotScale = null;

    this.oldPositions = null;
    this.initialDuplicatedPositions = null;
    this.newVertexIds = null;
    this.newEdgeIds = null;
    this.newFaceIds = null;
  }

  duplicateSelection() {
    const mode = this.editSelection.subSelectionMode;
    const selectedVertexIds = this.editSelection.selectedVertexIds;
    const selectedEdgeIds = this.editSelection.selectedEdgeIds;
    const selectedFaceIds = this.editSelection.selectedFaceIds;

    let duplicationResult;
    if (mode === 'vertex') {
      duplicationResult = this.vertexEditor.duplicate.duplicateSelectionVertices(selectedVertexIds);
    } else if (mode === 'edge') {
      duplicationResult = this.vertexEditor.duplicate.duplicateSelectionEdges(selectedEdgeIds);
    } else if (mode === 'face') {
      duplicationResult = this.vertexEditor.duplicate.duplicateSelectionFaces(selectedFaceIds);
    }

    this.newVertexIds = duplicationResult.newVertexIds;
    this.newEdgeIds = duplicationResult.newEdgeIds;
    this.newFaceIds = duplicationResult.newFaceIds;

    this.vertexEditor.transform.updateGeometryAndHelpers();
    this.editSelection.clearSelection();
    this.initialDuplicatedPositions = this.vertexEditor.transform.getVertexPositions(this.newVertexIds);

    if (mode === 'vertex') {
      this.editSelection.selectVertices(this.newVertexIds);
    } else if (mode === 'edge') {
      this.editSelection.selectEdges(this.newEdgeIds);
    } else if (mode === 'face') {
      this.editSelection.selectFaces(this.newFaceIds);
    }
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