import * as THREE from 'three';
import { VertexEditor } from './VertexEditor.js';
import { getSortedVertexIds } from '../utils/SortUtils.js';
import { getNeighborFaces, shouldFlipNormal } from '../utils/AlignedNormalUtils.js';

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
      vertexEditor.updateGeometryAndHelpers();
      this.editSelection.selectVertices(sortedVertexIds);
    });

    this.signals.deleteSelectedFaces.add(() => {
      const editedObject = this.editSelection.editedObject;
      const selectedVertexIds = this.editSelection.selectedVertexIds;

      const vertexEditor = new VertexEditor(this.editor, editedObject);
      vertexEditor.deleteSelection(selectedVertexIds);
      vertexEditor.updateGeometryAndHelpers();
    });

    this.signals.separateSelection.add(() => {
      const editedObject = this.editSelection.editedObject;
      const selectedVertexIds = this.editSelection.selectedVertexIds;

      const vertexEditor = new VertexEditor(this.editor, editedObject);
      const { newVertexIds } = vertexEditor.duplicateSelection(selectedVertexIds);
      vertexEditor.deleteSelection(selectedVertexIds);
      vertexEditor.updateGeometryAndHelpers();

      this.editSelection.selectVertices(newVertexIds);
    })
  }
}