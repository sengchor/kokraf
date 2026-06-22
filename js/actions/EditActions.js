import * as THREE from 'three';
import { getSortedVertexIds } from '../utils/SortUtils.js';
import { getNeighborFaces, shouldFlipNormal } from '../utils/AlignedNormalUtils.js';
import { CreateFaceCommand } from '../commands/CreateFaceCommand.js';
import { DeleteSelectionCommand } from '../commands/DeleteSelectionCommand.js';
import { SeparateSelectionCommand } from '../commands/SeparateSelectionCommand.js';
import { MergeSelectionCommand } from '../commands/MergeSelectionCommand.js';
import { SplitSelectionCommand } from '../commands/SplitSelectionCommand.js';
import { FlipNormalsCommand } from '../commands/FlipNormalsCommand.js';
import { SubdivideSelectionCommand } from '../commands/SubdivideSelectionCommand.js';
import { MeshDataRegion } from '../core/MeshDataRegion.js';

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
    if (!action) return;
    
    if (action === 'subdivide-selection') {
      this.signals.subdivideSelection.dispatch();
      return;
    }

    if (action === 'duplicate-selection') {
      this.editor.toolbar.setActiveTool('select');
      this.signals.duplicateSelection.dispatch();
      return;
    }

    if (action === 'create-edge-face') {
      this.signals.createElementFromVertices.dispatch();
      return;
    }

    if (action === 'merge-selection') {
      this.signals.mergeSelection.dispatch();
      return;
    }

    if (action === 'split-selection') {
      this.signals.splitSelection.dispatch();
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

    if (action === 'select-all') {
      this.signals.editSelectAll.dispatch();
      return;
    }

    if (action === 'select-none') {
      this.signals.editSelectNone.dispatch();
      return;
    }

    if (action === 'select-linked') {
      this.signals.editSelectLinked.dispatch();
      return;
    }

    if (action === 'select-rings') {
      this.signals.editSelectRings.dispatch();
      return;
    }

    if (action === 'select-loops') {
      this.signals.editSelectLoops.dispatch();
      return;
    }

    if (action === 'flip-normals') {
      this.signals.editFlipNormals.dispatch();
      return;
    }

    console.log('Invalid action:', action);
  }

  setupListeners() {
    this.signals.createElementFromVertices.add(() => this.createElementFromVertices());
    this.signals.deleteSelectedFaces.add((action) => this.deleteSelected(action));
    this.signals.separateSelection.add(() => this.separateSelection());
    this.signals.mergeSelection.add(() => this.mergeSelection());
    this.signals.splitSelection.add(() => this.splitSelection());
    this.signals.editFlipNormals.add(() => this.flipSelectedFacesNormal());
    this.signals.subdivideSelection.add(() => this.subdivideSelection());
  }

  createElementFromVertices() {
    const editedObject = this.editSelection.editedObject;
    const mode = this.editSelection.subSelectionMode;
    if (mode === 'face') return null;

    const meshData = editedObject.userData.meshData;
    if (!editedObject || !meshData) return null;

    const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
    const selectedEdgeIds = Array.from(this.editSelection.selectedEdgeIds);
    const selectedFaceIds = Array.from(this.editSelection.selectedFaceIds);
    if (!selectedVertexIds || selectedVertexIds.length < 1) return null;

    // Prevent creating a face identical to the selected face
    if (selectedFaceIds.length === 1) {
      const face = meshData.faces.get(selectedFaceIds[0]);
      if (face && selectedVertexIds.length === face.vertexIds.length) {
        return null;
      }
    }
    this.vertexEditor.setObject(editedObject);

    const beforeRegionIds = MeshDataRegion.expand(
      meshData,
      { vertexIds: selectedVertexIds, edgeIds: selectedEdgeIds },
      1
    );
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };
    
    let result;
    let createdFromSingleVertex = false;
    let newVertexId = null;

    if (selectedVertexIds.length > 1) {
      const { sortedVertexIds, normal } = getSortedVertexIds(meshData, selectedVertexIds);
      const neighbors = getNeighborFaces(meshData, selectedEdgeIds);
      const shouldFlip = shouldFlipNormal(meshData, sortedVertexIds, normal, neighbors);

      if (shouldFlip) {
        sortedVertexIds.reverse();
      }

      result = this.vertexEditor.topology.createEdgeFaceFromVertices(sortedVertexIds);
      if (!result) return;
    } else {
      const v0 = meshData.getVertex(selectedVertexIds[0]);
      if (!v0) return;

      const resultQuad = this.vertexEditor.topology.computeQuadFromVertex(v0);
      if (!resultQuad) return;

      const { quadVertexIds, openEdgeIds } = resultQuad;

      newVertexId = quadVertexIds[3];
      createdFromSingleVertex = true;

      const { sortedVertexIds, normal } = getSortedVertexIds(meshData, quadVertexIds);
      const neighbors = getNeighborFaces(meshData, openEdgeIds);
      const shouldFlip = shouldFlipNormal(meshData, sortedVertexIds, normal, neighbors);

      if (shouldFlip) {
        sortedVertexIds.reverse();
      }

      result = this.vertexEditor.topology.createEdgeFaceFromVertices(sortedVertexIds);
      if (!result) return;
    }

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

    MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);
    const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    this.editor.execute(new CreateFaceCommand(this.editor, editedObject, beforeSnapshot, afterSnapshot));

    if (mode === 'vertex') {
      if (createdFromSingleVertex && newVertexId !== null) {
        this.editSelection.selectVertices([newVertexId]);
      } else {
        this.editSelection.selectVertices(newVertices);
      }
    } else if (mode === 'edge') {
      this.editSelection.selectEdges(newEdges);
    }
  }

  deleteSelected(action) {
    const editedObject = this.editSelection.editedObject;

    const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
    const selectedEdgeIds = Array.from(this.editSelection.selectedEdgeIds);
    const selectedFaceIds = Array.from(this.editSelection.selectedFaceIds);

    if (
      selectedVertexIds.length === 0 && selectedEdgeIds.length === 0 && selectedFaceIds.length === 0
    ) return;

    const meshData = editedObject.userData.meshData;

    const beforeRegionIds = MeshDataRegion.expand(
      meshData,
      { vertexIds: selectedVertexIds, edgeIds: selectedEdgeIds, faceIds: selectedFaceIds },
      2
    );
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };

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

    MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);
    const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    this.editor.execute(new DeleteSelectionCommand(this.editor, editedObject, beforeSnapshot, afterSnapshot));
  }

  separateSelection() {
    const editedObject = this.editSelection.editedObject;
    const mode = this.editSelection.subSelectionMode;

    const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
    const selectedEdgeIds = Array.from(this.editSelection.selectedEdgeIds);
    const selectedFaceIds = Array.from(this.editSelection.selectedFaceIds);

    if (
      (mode === 'vertex' && selectedVertexIds.length === 0) ||
      (mode === 'edge' && selectedEdgeIds.length === 0) ||
      (mode === 'face' && selectedFaceIds.length === 0)
    ) return;

    const meshData = editedObject.userData.meshData;
    const beforeRegionIds = MeshDataRegion.expand(
      meshData,
      { vertexIds: selectedVertexIds, edgeIds: selectedEdgeIds, faceIds: selectedFaceIds },
      1
    );
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    }

    const newMeshData = this.meshEditor.extractMeshData(meshData, mode, this.editSelection);

    this.vertexEditor.setObject(editedObject);
    if (mode === 'vertex') {
      this.vertexEditor.delete.deleteSelectionVertices(selectedVertexIds);
    } else if (mode === 'edge') {
      this.vertexEditor.delete.deleteSelectionEdges(selectedEdgeIds);
    } else if (mode === 'face') {
      this.vertexEditor.delete.deleteSelectionFaces(selectedFaceIds);
    }

    MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);
    const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    this.editor.execute(new SeparateSelectionCommand(this.editor, editedObject, beforeSnapshot, afterSnapshot, newMeshData));
  }

  mergeSelection() {
    const editedObject = this.editSelection.editedObject
    const meshData = editedObject.userData.meshData;
    
    const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
    if (!selectedVertexIds || selectedVertexIds.length < 2) return;

    this.vertexEditor.setObject(editedObject);

    const beforeRegionIds = MeshDataRegion.expand(
      meshData,
      { vertexIds: selectedVertexIds },
      1
    );
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    }

    const targetVertexId = this.vertexEditor.topology.mergeVertices(selectedVertexIds);

    MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);
    const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    this.editor.execute(new MergeSelectionCommand(this.editor, editedObject, beforeSnapshot, afterSnapshot));

    this.editSelection.selectVertices(targetVertexId);
  }

  splitSelection() {
    const editedObject = this.editSelection.editedObject;
    const mode = this.editSelection.subSelectionMode;

    const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
    const selectedEdgeIds = Array.from(this.editSelection.selectedEdgeIds);
    const selectedFaceIds = Array.from(this.editSelection.selectedFaceIds);

    if (
      (mode === 'vertex' && selectedVertexIds.length === 0) ||
      (mode === 'edge' && selectedEdgeIds.length === 0) ||
      (mode === 'face' && selectedFaceIds.length === 0)
    ) return;

    const meshData = editedObject.userData.meshData;
    this.vertexEditor.setObject(editedObject);

    const beforeRegionIds = MeshDataRegion.expand(
      meshData,
      { vertexIds: selectedVertexIds, edgeIds: selectedEdgeIds, faceIds: selectedFaceIds },
      1
    );
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };

    let duplicationResult;
    if (mode === 'vertex') {
      duplicationResult = this.vertexEditor.duplicate.duplicateSelectionVertices(selectedVertexIds);
    } else if (mode === 'edge') {
      duplicationResult = this.vertexEditor.duplicate.duplicateSelectionEdges(selectedEdgeIds);
    } else if (mode === 'face') {
      duplicationResult = this.vertexEditor.duplicate.duplicateSelectionFaces(selectedFaceIds);
    }

    const { newVertexIds, newEdgeIds, newFaceIds } = duplicationResult;

    if (mode === 'vertex') {
      this.vertexEditor.delete.deleteSelectionVertices(selectedVertexIds);
    } else if (mode === 'edge') {
      this.vertexEditor.delete.deleteSelectionEdges(selectedEdgeIds);
    } else if (mode === 'face') {
      this.vertexEditor.delete.deleteSelectionFaces(selectedFaceIds);
    }

    MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);
    const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    this.editor.execute(new SplitSelectionCommand(this.editor, editedObject, beforeSnapshot, afterSnapshot));

    if (mode === 'vertex') {
      this.editSelection.selectVertices(newVertexIds);
    } else if (mode === 'edge') {
      this.editSelection.selectEdges(newEdgeIds);
    } else if (mode === 'face') {
      this.editSelection.selectFaces(newFaceIds)
    }
  }

  flipSelectedFacesNormal() {
    const editedObject = this.editSelection.editedObject;
    const meshData = editedObject.userData.meshData;

    const selectedFaceIds = Array.from(this.editSelection.selectedFaceIds);
    if (selectedFaceIds.length === 0) return;

    this.vertexEditor.setObject(editedObject);

    const beforeRegionIds = MeshDataRegion.expand(
      meshData,
      { faceIds: selectedFaceIds },
      1
    );
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };

    this.meshEditor.flipNormals(meshData, selectedFaceIds);

    MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);
    const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    this.editor.execute(new FlipNormalsCommand(this.editor, editedObject, beforeSnapshot, afterSnapshot));
  }

  subdivideSelection() {
    const editedObject = this.editSelection.editedObject;
    const selectedEdgeIds = Array.from(this.editSelection.selectedEdgeIds);
    const meshData = editedObject.userData.meshData;
    
    this.vertexEditor.setObject(editedObject);

    const beforeRegionIds = MeshDataRegion.expand(
      meshData,
      { edgeIds: selectedEdgeIds },
      1
    );
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };

    const { newVertexIds } = this.vertexEditor.subdivide.subdivideEdges(selectedEdgeIds);

    MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);
    const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    this.editor.execute(new SubdivideSelectionCommand(this.editor, editedObject, beforeSnapshot, afterSnapshot));

    this.editSelection.selectVertices(newVertexIds);
  }
}