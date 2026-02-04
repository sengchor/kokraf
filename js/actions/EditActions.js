import * as THREE from 'three';
import { getSortedVertexIds } from '../utils/SortUtils.js';
import { getNeighborFaces, shouldFlipNormal } from '../utils/AlignedNormalUtils.js';
import { CreateFaceCommand } from '../commands/CreateFaceCommand.js';
import { DeleteSelectionCommand } from '../commands/DeleteSelectionCommand.js';
import { SeparateSelectionCommand } from '../commands/SeparateSelectionCommand.js';

export class EditActions {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.meshEditor = editor.meshEditor;
    this.vertexEditor = editor.vertexEditor;
    this.editSelection = editor.editSelection;

    this.setupListeners();
  }

  handleAction(action) {
    if (action === 'create-edge-face') {
      this.signals.createElementFromVertices.dispatch();
      return;
    }

    if (action === 'separate-selection') {
      this.signals.separateSelection.dispatch();
      return;
    }

    if (action.startsWith('delete-') || action.startsWith('dissolve-')) {
      this.signals.deleteSelectedFaces.dispatch(action);
      return;
    }

    console.log('Invalid action:', action);
  }

  setupListeners() {
    this.signals.createElementFromVertices.add(() => this.createElementFromVertices());
    this.signals.deleteSelectedFaces.add((action) => this.deleteSelected(action));
    this.signals.separateSelection.add(() => this.separateSelection());
  }

  createElementFromVertices() {
    const editedObject = this.editSelection.editedObject;
    const mode = this.editSelection.subSelectionMode;
    if (mode === 'face') return null;

    const meshData = editedObject.userData.meshData;
    if (!editedObject || !meshData) return null;
    this.beforeMeshData = structuredClone(meshData);

    const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
    const selectedEdgeIds = Array.from(this.editSelection.selectedEdgeIds);
    const selectedFaceIds = Array.from(this.editSelection.selectedFaceIds);
    if (!selectedVertexIds || selectedVertexIds.length < 2) return null;

    // Prevent creating a face identical to the selected face
    if (selectedFaceIds.length === 1) {
      const face = meshData.faces.get(selectedFaceIds[0]);
      if (face && selectedVertexIds.length === face.vertexIds.length) {
        return null;
      }
    }
    this.vertexEditor.setObject(editedObject);
    
    const { sortedVertexIds, normal } = getSortedVertexIds(meshData, selectedVertexIds);
    const neighbors = getNeighborFaces(meshData, selectedEdgeIds);
    const shouldFlip = shouldFlipNormal(meshData, sortedVertexIds, normal, neighbors);

    if (shouldFlip) {
      sortedVertexIds.reverse();
    }

    const result = this.vertexEditor.topology.createEdgeFaceFromVertices(sortedVertexIds);
    if (!result) return;

    const { edgeId, faceId } = result;
    
    let newVertices = [];
    let newEdges = [];

    if (faceId !== null) {
      const newFace = meshData.faces.get(faceId);
      if (!newFace) return;

      newVertices = [...newFace.vertexIds];
      newEdges = [...newFace.edgeIds];
    }

    if (edgeId !== null) {
      const newEdge = meshData.edges.get(edgeId);
      if (!newEdge) return;

      newVertices = [newEdge.v1Id, newEdge.v2Id];
      newEdges = [edgeId];
    }

    this.afterMeshData = structuredClone(meshData);
    this.editor.execute(new CreateFaceCommand(this.editor, editedObject, this.beforeMeshData, this.afterMeshData));

    if (mode === 'vertex') {
      this.editSelection.selectVertices(newVertices);
    } else if (mode === 'edge') {
      this.editSelection.selectEdges(newEdges);
    }
  }

  deleteSelected(action) {
    const editedObject = this.editSelection.editedObject;

    const selectedVertexIds = this.editSelection.selectedVertexIds;
    const selectedEdgeIds = this.editSelection.selectedEdgeIds;
    const selectedFaceIds = this.editSelection.selectedFaceIds;

    if (
      selectedVertexIds.size === 0 && selectedEdgeIds.size === 0 && selectedFaceIds.size === 0
    ) return;


    const meshData = editedObject.userData.meshData;
    this.beforeMeshData = structuredClone(meshData);

    this.vertexEditor.setObject(editedObject);
    if (action === 'delete-vertices') {
      this.vertexEditor.delete.deleteVertices(selectedVertexIds);
    } else if (action === 'delete-edges') {
      this.vertexEditor.delete.deleteEdges(selectedEdgeIds);
    } else if (action === 'delete-faces') {
      this.vertexEditor.delete.deleteFaces(selectedFaceIds);
    } else if (action === 'delete-only-edges-faces') {
      this.vertexEditor.delete.deleteEdgesAndFacesOnly(selectedEdgeIds);
    } else if (action === 'delete-only-faces') {
      this.vertexEditor.delete.deleteFacesOnly(selectedFaceIds);
    } else if (action === 'dissolve-vertices') {
      this.vertexEditor.dissolve.dissolveVertices(selectedVertexIds);
    } else if (action === 'dissolve-edges') {
      this.vertexEditor.dissolve.dissolveEdges(selectedEdgeIds);
    } else if (action === 'dissolve-faces') {
      this.vertexEditor.dissolve.dissolveFaces(selectedFaceIds);
    }

    this.afterMeshData = structuredClone(meshData);
    this.editor.execute(new DeleteSelectionCommand(this.editor, editedObject, this.beforeMeshData, this.afterMeshData));
  }

  separateSelection() {
    const editedObject = this.editSelection.editedObject;
    const mode = this.editSelection.subSelectionMode;

    const selectedVertexIds = this.editSelection.selectedVertexIds;
    const selectedEdgeIds = this.editSelection.selectedEdgeIds;
    const selectedFaceIds = this.editSelection.selectedFaceIds;

    if (
      (mode === 'vertex' && selectedVertexIds.size === 0) ||
      (mode === 'edge' && selectedEdgeIds.size === 0) ||
      (mode === 'face' && selectedFaceIds.size === 0)
    ) return;

    const meshData = editedObject.userData.meshData;
    const beforeMeshData = structuredClone(meshData);

    const newMeshData = this.meshEditor.extractMeshData(meshData, mode, this.editSelection);

    this.vertexEditor.setObject(editedObject);
    if (mode === 'vertex') {
      this.vertexEditor.delete.deleteSelectionVertices(selectedVertexIds);
    } else if (mode === 'edge') {
      this.vertexEditor.delete.deleteSelectionEdges(selectedEdgeIds);
    } else if (mode === 'face') {
      this.vertexEditor.delete.deleteSelectionFaces(selectedFaceIds);
    }

    const afterMeshData = structuredClone(meshData);
    this.editor.execute(new SeparateSelectionCommand(this.editor, editedObject, beforeMeshData, afterMeshData, newMeshData));
  }
}