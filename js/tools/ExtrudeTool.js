import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { calculateVertexIdsNormal, getCentroidFromVertices, getEdgeMidpoint } from '../utils/AlignedNormalUtils.js';
import { ExtrudeCommand } from '../commands/ExtrudeCommand.js';
import { TransformCommandSolver } from './TransformCommandSolver.js';

export class ExtrudeTool {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;

    this.vertexEditor = editor.vertexEditor;
    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.sceneEditorHelpers = editor.sceneManager.sceneEditorHelpers;
    this.controls = editor.controlsManager;
    this.editSelection = editor.editSelection;
    this.snapManager = editor.snapManager;
    this.viewportControls = editor.viewportControls;

    this.activeTransformSource = null;
    this.event = null;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode('translate');
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

  // Signals & Listeners
  setupListeners() {
    this.signals.transformOrientationChanged.add((orientation) => {
      this.applyTransformOrientation(orientation);
    });

    this.signals.editExtrudeStart.add(() => {
      const editedObject = this.editSelection.editedObject;
      if (!editedObject) return;

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
  }

  onKeyDown(event) {
    if (this.activeTransformSource !== 'command') return;

    const key = event.key.toLowerCase();
    if (key === 'x' || key === 'y' || key === 'z') {
      this.transformSolver.setAxisConstraintFromKey(key);

      this.transformSolver.updateHandleFromCommandInput('translate', this.event);
      this.applyExtrudeSession();
      return;
    }

    if (event.key === 'Escape') {
      this.cancelExtrudeSession();
      this.clearCommandExtrudeState();
      this.commitExtrudeSession();
    }

    if (event.key === 'Enter') {
      this.commitExtrudeSession();
      this.clearCommandExtrudeState();
    }
  }

  // Transform session
  startExtrudeSession() {
    this.startPivotPosition = this.handle.getWorldPosition(new THREE.Vector3()).clone();
    this.startPivotQuaternion = this.handle.getWorldQuaternion(new THREE.Quaternion()).clone();
    this.startPivotScale = this.handle.getWorldScale(new THREE.Vector3()).clone();

    const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
    const editedObject = this.editSelection.editedObject;
    this.vertexEditor.setObject(editedObject);
    this.oldPositions = this.vertexEditor.transform.getVertexPositions(selectedVertexIds);

    this.transformSolver.beginSession(this.startPivotPosition, this.startPivotQuaternion, this.startPivotScale);

    this.extrudeStarted = false;
  }

  applyExtrudeSession() {
    if (!this.startPivotPosition) return;

    if (!this.extrudeStarted) {
      this.startExtrude();
      this.extrudeStarted = true;
    }

    this.updateExtrude();
  }

  commitExtrudeSession() {
    const mode = this.editSelection.subSelectionMode;
    const editedObject = this.editSelection.editedObject;
    this.vertexEditor.setObject(editedObject);
    this.vertexEditor.transform.updateGeometryAndHelpers();
    const meshData = editedObject.userData.meshData;
    this.afterMeshData = structuredClone(meshData);

    this.editor.execute(new ExtrudeCommand(this.editor, editedObject, this.beforeMeshData, this.afterMeshData));

    // Keep selection on the new vertices
    if (mode === 'vertex') {
      this.editSelection.selectVertices(this.newVertexIds);
    } else if (mode === 'edge') {
      this.editSelection.selectEdges(this.newEdgeIds);
    } else if (mode === 'face') {
      this.editSelection.selectFaces(this.newFaceIds);
    }

    this.clearStartData();
  }

  cancelExtrudeSession() {
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

  clearCommandExtrudeState() {
    this.activeTransformSource = null;

    this.transformSolver.clear();
    this.transformSolver.clearGizmoActiveVisualState();

    requestAnimationFrame(() => {
      this.signals.transformDragEnded.dispatch('edit');
    });
  }

  clearStartData() {
    this.startPivotPosition = null;
    this.startPivotQuaternion = null;
    this.startPivotScale = null;

    this.oldPositions = null;
    this.initialDuplicatedPositions = null;
    this.mappedVertexIds = null;
    this.newVertexIds = null;
    this.newEdgeIds = null;
    this.newFaceIds = null;
    this.boundaryEdges = null;
    this.extrudeStarted = false;
  }

  // Extrude
  startExtrude() {
    const editedObject = this.editSelection.editedObject;
    this.vertexEditor.setObject(editedObject);
    const meshData = editedObject.userData.meshData;
    this.beforeMeshData = structuredClone(meshData);

    const mode = this.editSelection.subSelectionMode;
    const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
    const selectedEdgeIds = Array.from(this.editSelection.selectedEdgeIds);
    const selectedFaceIds = Array.from(this.editSelection.selectedFaceIds);

    // Duplicate the selected vertices
    let duplicationResult;
    if (mode === 'vertex') {
      duplicationResult = this.vertexEditor.duplicate.duplicateSelectionVertices(selectedVertexIds);
    } else if (mode === 'edge') {
      duplicationResult = this.vertexEditor.duplicate.duplicateSelectionEdges(selectedEdgeIds);
    } else if (mode === 'face') {
      duplicationResult = this.vertexEditor.duplicate.duplicateSelectionFaces(selectedFaceIds);
    }
    this.mappedVertexIds = duplicationResult.mappedVertexIds;
    this.newVertexIds = duplicationResult.newVertexIds;
    this.newEdgeIds = duplicationResult.newEdgeIds;
    this.newFaceIds = duplicationResult.newFaceIds;

    this.vertexEditor.transform.updateGeometryAndHelpers();
    this.initialDuplicatedPositions = this.vertexEditor.transform.getVertexPositions(this.newVertexIds);

    this.boundaryEdges = this.vertexEditor.topology.getBoundaryEdges(selectedVertexIds, selectedEdgeIds, selectedFaceIds);

    // Recreate side faces
    for (let i = 0; i < this.boundaryEdges.length; i++) {
      const edge = this.boundaryEdges[i];
      const newEdge = meshData.getEdge(this.mappedVertexIds[edge.v1Id], this.mappedVertexIds[edge.v2Id]);

      const sideFaceVertexIds = [edge.v1Id, edge.v2Id, this.mappedVertexIds[edge.v2Id], this.mappedVertexIds[edge.v1Id]];

      const faceId = Array.from(newEdge.faceIds)[0];

      if (faceId !== undefined) {
        const face = meshData.faces.get(faceId);
        const faceCentroid = getCentroidFromVertices(face.vertexIds, meshData);
        const newEdgeMidpoint = getEdgeMidpoint(newEdge, meshData);

        const sideFaceNormal = new THREE.Vector3().subVectors(newEdgeMidpoint, faceCentroid).normalize();
        const faceNormal = calculateVertexIdsNormal(meshData, face.vertexIds);
        const edgeVector = new THREE.Vector3().subVectors(meshData.getVertex(edge.v2Id).position, meshData.getVertex(edge.v1Id).position).normalize();

        const testNormal = new THREE.Vector3().crossVectors(edgeVector, faceNormal).normalize();

        if (testNormal.dot(sideFaceNormal) < 0) {
          sideFaceVertexIds.reverse();
        }
      }

      this.vertexEditor.topology.createFaceFromVertices(sideFaceVertexIds);
    }

    // Handle isolated vertices
    const connectedVertexIds = new Set();
    for (let edgeId of selectedEdgeIds) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;
      connectedVertexIds.add(edge.v1Id);
      connectedVertexIds.add(edge.v2Id);
    }
    const leftoverVertexIds = selectedVertexIds.filter(vId => !connectedVertexIds.has(vId));

    for (let vId of leftoverVertexIds) {
      const newVId = this.mappedVertexIds[vId];
      meshData.addEdge(meshData.getVertex(vId), meshData.getVertex(newVId));
    }

    // Delete old selection
    if (mode === 'vertex') {
      this.vertexEditor.delete.deleteSelectionVertices(selectedVertexIds);
      this.vertexEditor.transform.updateGeometryAndHelpers(false);
      this.editSelection.selectVertices(this.newVertexIds);
    } else if (mode === 'edge') {
      this.vertexEditor.delete.deleteSelectionEdges(selectedEdgeIds);
      this.vertexEditor.transform.updateGeometryAndHelpers(false);
      this.editSelection.selectEdges(this.newEdgeIds);
    } else if (mode === 'face') {
      this.vertexEditor.delete.deleteSelectionFaces(selectedFaceIds);
      this.vertexEditor.transform.updateGeometryAndHelpers(false);
      this.editSelection.selectFaces(this.newFaceIds);
    }
  }

  updateExtrude() {
    const editedObject = this.editSelection.editedObject;
    this.vertexEditor.setObject(editedObject);

    const currentPivotPosition = this.handle.getWorldPosition(new THREE.Vector3());
    let offset = new THREE.Vector3().subVectors(currentPivotPosition, this.startPivotPosition);

    const snapTarget = this.snapManager.snapEditPosition(this.event, this.newVertexIds, editedObject);
    
    if (snapTarget) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(this.oldPositions, snapTarget);
      offset.subVectors(snapTarget, nearestWorldPos);
      offset = this.snapManager.constrainTranslationOffset(offset, this.transformControls.axis, this.transformControls.space, editedObject);

      this.handle.position.copy(this.startPivotPosition).add(offset);
      this.transformControls.update();
    }

    // Move duplicated vertices
    const newPositions = this.initialDuplicatedPositions.map(pos => pos.clone().add(offset));
    this.vertexEditor.transform.setVerticesWorldPositions(this.newVertexIds, newPositions);
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