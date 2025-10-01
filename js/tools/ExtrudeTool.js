import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { VertexEditor } from './VertexEditor.js';
import { getSortedVertexIds } from '../utils/SortUtils.js';
import { getNeighborFaces, shouldFlipNormal } from '../utils/AlignedNormalUtils.js';

export class ExtrudeTool {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.sceneEditorHelpers = editor.sceneManager.sceneEditorHelpers;
    this.controls = editor.controlsManager;
    this._worldPosHelper = new THREE.Vector3();
    this.editSelection = editor.editSelection;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode('translate');
    this.transformControls.visible = false;

    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
      if (this.controls.enabled) {
        this.signals.objectChanged.dispatch();
      }
    });
    this.transformControls.addEventListener('change', () => {
      if (this.transformControls.dragging) {
        this.signals.objectChanged.dispatch();
      }
    });

    this.sceneEditorHelpers.add(this.transformControls.getHelper());

    this.changeTransformControlsColor();

    this.setupTransformListeners();
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

  setupTransformListeners() {
    this.transformControls.addEventListener('mouseDown', () => {
      const object = this.transformControls.object;
      if (!object) return;
      this.objectPositionOnDown = object.getWorldPosition(this._worldPosHelper).clone();
      this.extrudeStarted = false;

      // Save old vertex positions for undo
      const indices = object.userData.vertexIndices || [];
      const editedObject = this.editSelection.editedObject;
      if (editedObject) {
        const vertexEditor = new VertexEditor(this.editor, editedObject);
        this.oldPositions = vertexEditor.getVertexPositions(indices);
      }
    });

    this.transformControls.addEventListener('change', () => {
      const object = this.transformControls.object;
      if (!object || !this.objectPositionOnDown) return;

      if (!this.extrudeStarted) {
        this.startExtrude();
        this.extrudeStarted = true;
      }

      this.updateExtrude();
    });

    this.transformControls.addEventListener('mouseUp', () => {
      this.objectPositionOnDown = null;
      this.extrudeStarted = false;

      const editedObject = this.editSelection.editedObject;
      const vertexEditor = new VertexEditor(this.editor, editedObject);

      // Recreate side faces
      for (let i = 0; i < this.boundaryEdges.length; i++) {
        const edge = this.boundaryEdges[i];
        const newEdge = this.newBoundaryEdges[i];

        const sideFaceVertexIds = [edge.v1Id, edge.v2Id, newEdge.v1Id, newEdge.v2Id];
        const { sortedVertexIds, normal } = getSortedVertexIds(editedObject.userData.meshData, sideFaceVertexIds);
        const neighbors = getNeighborFaces(editedObject.userData.meshData, [edge.id, newEdge.id]);
        const shouldFlip = shouldFlipNormal(editedObject.userData.meshData, sortedVertexIds, normal, neighbors);

        if (shouldFlip) sortedVertexIds.reverse();
        vertexEditor.createFaceFromVertices(sortedVertexIds);
      }
      vertexEditor.updateGeometryAndHelpers();
    });
  }

  enableFor(object) {
    if (!object) return;
    this.transformControls.attach(object);
    this.transformControls.visible = true;
  }

  disable() {
    this.transformControls.detach();
    this.transformControls.visible = false;
  }

  startExtrude() {
    const editedObject = this.editSelection.editedObject;
    const vertexEditor = new VertexEditor(this.editor, editedObject);
    const meshData = editedObject.userData.meshData;

    const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
    const selectedEdgeIds = Array.from(this.editSelection.selectedEdgeIds);
    const selectedFaceIds = Array.from(this.editSelection.selectedFaceIds);

    const { newVertexIds, newEdgeIds, newFaceIds } = vertexEditor.duplicateSelection(selectedVertexIds);
    this.newVertexIds = newVertexIds;

    this.initialDuplicatedPositions = newVertexIds.map(id => {
      const pos = meshData.getVertex(id).position;
      return new THREE.Vector3(pos.x, pos.y, pos.z);
    });

    this.boundaryEdges = vertexEditor.getBoundaryEdges(meshData, selectedVertexIds, selectedEdgeIds, selectedFaceIds);
    this.newBoundaryEdges = vertexEditor.getBoundaryEdges(meshData, newVertexIds, newEdgeIds, newFaceIds);

    // Delete old selection
    vertexEditor.deleteSelection(selectedVertexIds);

    vertexEditor.updateGeometryAndHelpers();
  }

  updateExtrude() {
    const object = this.transformControls.object;
    const editedObject = this.editSelection.editedObject;
    const vertexEditor = new VertexEditor(this.editor, editedObject);

    const currentPos = object.getWorldPosition(this._worldPosHelper);
    const offset = new THREE.Vector3().subVectors(currentPos, this.objectPositionOnDown);

    // Move duplicated vertices
    const newPositions = this.initialDuplicatedPositions.map(pos => pos.clone().add(offset));
    vertexEditor.setVerticesWorldPositions(this.newVertexIds, newPositions);

    // Keep selection on the new vertices
    this.editSelection.selectVertices(this.newVertexIds);
  }
}