import * as THREE from 'three';
import { VertexEditor } from './VertexEditor.js';
import { getSortedVertexIds } from '../utils/SortUtils.js';

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
      const meshData = editedObject?.userData?.meshData;
      if (!editedObject || !meshData) return null;

      const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
      if (!selectedVertexIds) return null;
      
      const vertexEditor = new VertexEditor(this.editor, editedObject);
      const sortedVertexIds = getSortedVertexIds(meshData, selectedVertexIds);

      vertexEditor.createFaceFromVertices(sortedVertexIds);
    });
  }
}