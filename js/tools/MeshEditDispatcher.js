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

      vertexEditor.createFaceFromVertices(sortedVertexIds);

      this.afterMeshData = structuredClone(meshData);
      this.editor.execute(new CreateFaceCommand(this.editor, editedObject, this.beforeMeshData, this.afterMeshData));

      this.editSelection.selectVertices(sortedVertexIds);
    });

    this.signals.deleteSelectedFaces.add(() => {
      const editedObject = this.editSelection.editedObject;
      const selectedVertexIds = this.editSelection.selectedVertexIds;
      const meshData = editedObject.userData.meshData;
      this.beforeMeshData = structuredClone(meshData);

      const vertexEditor = new VertexEditor(this.editor, editedObject);
      vertexEditor.deleteSelectionVertices(selectedVertexIds);

      this.afterMeshData = structuredClone(meshData);
      this.editor.execute(new DeleteSelectionCommand(this.editor, editedObject, this.beforeMeshData, this.afterMeshData));
    });

    this.signals.separateSelection.add(() => {
      const editedObject = this.editSelection.editedObject;
      const selectedVertexIds = this.editSelection.selectedVertexIds;
      const meshData = editedObject.userData.meshData;
      this.beforeMeshData = structuredClone(meshData);

      const vertexEditor = new VertexEditor(this.editor, editedObject);
      const { newVertexIds } = vertexEditor.duplicateSelectionVertices(selectedVertexIds);
      vertexEditor.deleteSelectionVertices(selectedVertexIds);

      this.afterMeshData = structuredClone(meshData);
      this.editor.execute(new SeparateSelectionCommand(this.editor, editedObject, this.afterMeshData, this.afterMeshData));
      this.editSelection.selectVertices(newVertexIds);
    })
  }
}