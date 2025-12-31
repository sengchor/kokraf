import * as THREE from 'three';
import { VertexEditor } from './VertexEditor.js';
import { getSortedVertexIds } from '../utils/SortUtils.js';
import { getNeighborFaces, shouldFlipNormal } from '../utils/AlignedNormalUtils.js';
import { CreateFaceCommand } from '../commands/CreateFaceCommand.js';
import { DeleteSelectionCommand } from '../commands/DeleteSelectionCommand.js';
import { SeparateSelectionCommand } from '../commands/SeparateSelectionCommand.js';

export class MeshEditDispatcher {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.editSelection = editor.editSelection;

    this.setupListeners();
  }

  setupListeners() {
    this.signals.createFaceFromVertices.add(() => {
      const editedObject = this.editSelection.editedObject;
      const mode = this.editSelection.subSelectionMode;
      if (mode === 'face') return null;

      const meshData = editedObject.userData.meshData;
      if (!editedObject || !meshData) return null;
      this.beforeMeshData = structuredClone(meshData);

      const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
      const selectedEdgeIds = Array.from(this.editSelection.selectedEdgeIds);
      const selectedFaceIds = Array.from(this.editSelection.selectedFaceIds);
      if (!selectedVertexIds || selectedVertexIds.length < 3) return null;

      // Prevent creating a face identical to the selected face
      if (selectedFaceIds.length === 1) {
        const face = meshData.faces.get(selectedFaceIds[0]);
        if (face && selectedVertexIds.length === face.vertexIds.length) {
          return null;
        }
      }
      
      const vertexEditor = new VertexEditor(this.editor, editedObject);
      
      const { sortedVertexIds, normal } = getSortedVertexIds(meshData, selectedVertexIds);
      const neighbors = getNeighborFaces(meshData, selectedEdgeIds);
      const shouldFlip = shouldFlipNormal(meshData, sortedVertexIds, normal, neighbors);

      if (shouldFlip) {
        sortedVertexIds.reverse();
      }

      const newFaceId = vertexEditor.createFaceFromVertices(sortedVertexIds);
      const newFace = meshData.faces.get(newFaceId);
      const newVertices = [...newFace.vertexIds];
      const newEdges = [...newFace.edgeIds];

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

      const vertexEditor = new VertexEditor(this.editor, editedObject);
      if (action === 'delete-vertices') {
        vertexEditor.deleteVertices(selectedVertexIds);
      } else if (action === 'delete-edges') {
        vertexEditor.deleteEdges(selectedEdgeIds);
      } else if (action === 'delete-faces') {
        vertexEditor.deleteFaces(selectedFaceIds);
      } else if (action === 'delete-only-edges-faces') {
        vertexEditor.deleteEdgesAndFacesOnly(selectedEdgeIds);
      } else if (action === 'delete-only-faces') {
        vertexEditor.deleteFacesOnly(selectedFaceIds);
      } else if (action === 'dissolve-vertices') {
        vertexEditor.dissolveVertices(selectedVertexIds);
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

      const vertexEditor = new VertexEditor(this.editor, editedObject);
      if (mode === 'vertex') {
        ({ newVertexIds } = vertexEditor.duplicateSelectionVertices(selectedVertexIds));
        vertexEditor.deleteSelectionVertices(selectedVertexIds);
      } else if (mode === 'edge') {
        ({ newEdgeIds } = vertexEditor.duplicateSelectionEdges(selectedEdgeIds));
        vertexEditor.deleteSelectionEdges(selectedEdgeIds);
      } else if (mode === 'face') {
        ({ newFaceIds } = vertexEditor.duplicateSelectionFaces(selectedFaceIds));
        vertexEditor.deleteSelectionFaces(selectedFaceIds);
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