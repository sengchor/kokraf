import * as THREE from 'three';
import { getSortedVertexIds } from '../utils/SortUtils.js';
import { getNeighborFaces, shouldFlipNormal } from '../utils/AlignedNormalUtils.js';
import { CreateFaceCommand } from '../commands/CreateFaceCommand.js';
import { DeleteSelectionCommand } from '../commands/DeleteSelectionCommand.js';
import { SeparateSelectionCommand } from '../commands/SeparateSelectionCommand.js';

export class MeshEditDispatcher {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.vertexEditor = editor.vertexEditor;
    this.editSelection = editor.editSelection;

    this.setupListeners();
  }

  setupListeners() {
    this.signals.createElementFromVertices.add(() => {
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
    });
    
    this.signals.deleteSelectedFaces.add((action) => {
      const editedObject = this.editSelection.editedObject;

      const selectedVertexIds = this.editSelection.selectedVertexIds;
      const selectedEdgeIds = this.editSelection.selectedEdgeIds;
      const selectedFaceIds = this.editSelection.selectedFaceIds;

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
    });

    this.signals.separateSelection.add(() => {
      const editedObject = this.editSelection.editedObject;
      const mode = this.editSelection.subSelectionMode;

      const selectedVertexIds = this.editSelection.selectedVertexIds;
      const selectedEdgeIds = this.editSelection.selectedEdgeIds;
      const selectedFaceIds = this.editSelection.selectedFaceIds;

      const meshData = editedObject.userData.meshData;
      this.beforeMeshData = structuredClone(meshData);

      let newVertexIds = [];
      let newEdgeIds = [];
      let newFaceIds = [];

      this.vertexEditor.setObject(editedObject);
      if (mode === 'vertex') {
        ({ newVertexIds } = this.vertexEditor.duplicate.duplicateSelectionVertices(selectedVertexIds));
        this.vertexEditor.delete.deleteSelectionVertices(selectedVertexIds);
      } else if (mode === 'edge') {
        ({ newEdgeIds } = this.vertexEditor.duplicate.duplicateSelectionEdges(selectedEdgeIds));
        this.vertexEditor.delete.deleteSelectionEdges(selectedEdgeIds);
      } else if (mode === 'face') {
        ({ newFaceIds } = this.vertexEditor.duplicate.duplicateSelectionFaces(selectedFaceIds));
        this.vertexEditor.delete.deleteSelectionFaces(selectedFaceIds);
      }

      this.afterMeshData = structuredClone(meshData);
      this.editor.execute(new SeparateSelectionCommand(this.editor, editedObject, this.beforeMeshData, this.afterMeshData));

      if (mode === 'vertex') {
        this.editSelection.selectVertices(newVertexIds);
      } else if (mode === 'edge') {
        this.editSelection.selectEdges(newEdgeIds);
      } else if (mode === 'face') {
        this.editSelection.selectFaces(newFaceIds);
      }
    });
  }
}