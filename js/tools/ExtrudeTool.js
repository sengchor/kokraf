import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { calculateVertexIdsNormal, getCentroidFromVertices, getEdgeMidpoint } from '../utils/AlignedNormalUtils.js';
import { ExtrudeCommand } from '../commands/ExtrudeCommand.js';

export class ExtrudeTool {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.vertexEditor = editor.vertexEditor;
    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.sceneEditorHelpers = editor.sceneManager.sceneEditorHelpers;
    this.controls = editor.controlsManager;
    this._worldPosHelper = new THREE.Vector3();
    this.editSelection = editor.editSelection;
    this.snapManager = editor.snapManager;
    this.viewportControls = editor.viewportControls;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode('translate');
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
    this.setupListeners();
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

  setupListeners() {
    this.signals.transformOrientationChanged.add((orientation) => {
      this.applyTransformOrientation(orientation);
    });
  }

  setupTransformListeners() {
    this.transformControls.addEventListener('mouseDown', () => {
      const handle = this.transformControls.object;
      if (!handle) return;
      this.startPivotPosition = handle.getWorldPosition(this._worldPosHelper).clone();

      const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
      const editedObject = this.editSelection.editedObject;
      this.vertexEditor.setObject(editedObject);
      this.oldPositions = this.vertexEditor.transform.getVertexPositions(selectedVertexIds);

      this.extrudeStarted = false;
    });

    this.transformControls.addEventListener('change', () => {
      const handle = this.transformControls.object;
      if (!handle || !this.startPivotPosition) return;

      if (!this.extrudeStarted) {
        this.startExtrude();
        this.extrudeStarted = true;
      }

      this.updateExtrude();
    });

    this.transformControls.addEventListener('mouseUp', () => {
      this.startPivotPosition = null;
      this.extrudeStarted = false;
      this.oldPositions = null;

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
    });
  }

  enableFor(object) {
    if (!object) return;
    this.transformControls.attach(object);
    this.transformControls.visible = true;

    this.applyTransformOrientation(this.viewportControls.transformOrientation);
  }

  disable() {
    this.transformControls.detach();
    this.transformControls.visible = false;
  }

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
    const handle = this.transformControls.object;
    const editedObject = this.editSelection.editedObject;
    this.vertexEditor.setObject(editedObject);

    const currentPivotPosition = handle.getWorldPosition(this._worldPosHelper);
    let offset = new THREE.Vector3().subVectors(currentPivotPosition, this.startPivotPosition);

    const snapTarget = this.snapManager.snapEditPosition(this.event, this.newVertexIds, editedObject);
    
    if (snapTarget) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(this.oldPositions, snapTarget);
      offset.subVectors(snapTarget, nearestWorldPos);
      offset = this.snapManager.constrainTranslationOffset(offset, this.transformControls.axis, this.transformControls.space, editedObject);

      handle.position.copy(this.startPivotPosition).add(offset);
      this.transformControls.update();
    }

    // Move duplicated vertices
    const newPositions = this.initialDuplicatedPositions.map(pos => pos.clone().add(offset));
    this.vertexEditor.transform.setVerticesWorldPositions(this.newVertexIds, newPositions);
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