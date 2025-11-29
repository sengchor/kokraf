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
      const meshData = editedObject.userData.meshData;
      if (!editedObject || !meshData) return null;
      this.beforeMeshData = structuredClone(meshData);

      const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
      const selectedEdgeIds = Array.from(this.editSelection.selectedEdgeIds);
      if (!selectedVertexIds) return null;
      
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

      const mode = this.editSelection.subSelectionMode;
      if (mode === 'vertex') {
        this.editSelection.selectVertices(newVertices);
      } else if (mode === 'edge') {
        this.editSelection.selectEdges(newEdges);
      }
    });

    this.signals.deleteSelectedFaces.add(() => {
      const editedObject = this.editSelection.editedObject;
      const mode = this.editSelection.subSelectionMode;

      const selectedVertexIds = this.editSelection.selectedVertexIds;
      const selectedEdgeIds = this.editSelection.selectedEdgeIds;
      const meshData = editedObject.userData.meshData;
      this.beforeMeshData = structuredClone(meshData);

      const vertexEditor = new VertexEditor(this.editor, editedObject);
      if (mode === 'vertex') {
        vertexEditor.deleteSelectionVertices(selectedVertexIds);
      } else if (mode === 'edge') {
        vertexEditor.deleteSelectionEdges(selectedEdgeIds);
      }

      this.afterMeshData = structuredClone(meshData);
      this.editor.execute(new DeleteSelectionCommand(this.editor, editedObject, this.beforeMeshData, this.afterMeshData));
    });

    this.signals.separateSelection.add(() => {
      const editedObject = this.editSelection.editedObject;
      const mode = this.editSelection.subSelectionMode;

      const selectedVertexIds = this.editSelection.selectedVertexIds;
      const selectedEdgeIds = this.editSelection.selectedEdgeIds;
      const meshData = editedObject.userData.meshData;
      this.beforeMeshData = structuredClone(meshData);

      let newVertexIds = [];
      let newEdgeIds = [];

      const vertexEditor = new VertexEditor(this.editor, editedObject);
      if (mode === 'vertex') {
        ({ newVertexIds, newEdgeIds } = vertexEditor.duplicateSelectionVertices(selectedVertexIds));
        vertexEditor.deleteSelectionVertices(selectedVertexIds);
      } else if (mode === 'edge') {
        ({ newVertexIds, newEdgeIds } = vertexEditor.duplicateSelectionEdges(selectedEdgeIds));
        vertexEditor.deleteSelectionEdges(selectedEdgeIds);
      }

      this.afterMeshData = structuredClone(meshData);
      this.editor.execute(new SeparateSelectionCommand(this.editor, editedObject, this.afterMeshData, this.afterMeshData));

      if (mode === 'vertex') {
        this.editSelection.selectVertices(newVertexIds);
      } else if (mode === 'edge') {
        this.editSelection.selectEdges(newEdgeIds);
      }
    })
  }
}