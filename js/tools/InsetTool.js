import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { TransformCommandSolver } from './TransformCommandSolver.js';

export class InsetTool {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;

    this.vertexEditor = editor.vertexEditor;
    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.controls = editor.controlsManager;
    this.editSelection = editor.editSelection;
    this.sceneEditorHelpers = editor.sceneManager.sceneEditorHelpers;

    this.activeTransformSource = null;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode('translate');
    this.transformControls.visible = false;

    this.renderer.domElement.addEventListener('pointermove', (e) => this.event = e);
    this.sceneEditorHelpers.add(this.transformControls.getHelper());

    this.transformSolver = new TransformCommandSolver(this.camera, this.renderer, this.transformControls);

    this.setupTransformListeners();
  }

  enableFor(object) {
    if (!object) return;

    this.transformControls.attach(object);
    this.transformControls.visible = true;

    this.showCenterOnly();
    this.handle = this.transformControls.object;

    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this._onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('keydown', this._onKeyDown);
  }

  disable() {
    this.transformControls.detach();
    this.transformControls.visible = false;
  }

  showCenterOnly() {
    const helper = this.transformControls.getHelper();
    helper.traverse(child => {
      if (!child.isMesh || !child.name) return;
      if (child.name === 'Z' || child.name === 'Y' || child.name === 'X') {
        child.material.visible = false;
      }
      if (child.name === 'XY' || child.name === 'XZ' || child.name === 'YZ') {
        child.material.visible = false;
      }
    });

    const picker = this.transformControls._gizmo.picker.translate;
    for (let i = picker.children.length - 1; i >= 0; i--) {
      const child = picker.children[i];
      if (child.name !== 'XYZ') {
          picker.remove(child);
      }
    }
  }

  setupTransformListeners() {
    this.transformControls.addEventListener('mouseDown', () => {
      if (this.activeTransformSource !== null) return;

      this.activeTransformSource = 'gizmo';
      this.startInsetSession();
    });

    this.transformControls.addEventListener('change', () => {
      if (!this.transformControls.dragging) return;
      if (this.activeTransformSource !== 'gizmo') return;

      this.applyInsetSession();
    });

    this.transformControls.addEventListener('mouseUp', () => {
      if (this.activeTransformSource !== 'gizmo') return;

      this.commitInsetSession();
      this.activeTransformSource = null;
    });

    // Signal dispatch
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
      if (!event.value) this.signals.objectChanged.dispatch();
    });

    this.transformControls.addEventListener('mouseDown', () => {
      this.signals.transformDragStarted.dispatch('edit');
    });

    this.transformControls.addEventListener('mouseUp', () => {
      requestAnimationFrame(() => {
        this.editSelection.updateVertexHandle();
        this.signals.transformDragEnded.dispatch('edit');
      });
    });
  }

  startInsetSession() {
    this.editedObject = this.editSelection.editedObject;
    if (!this.editedObject || !this.handle) return;
    this.vertexEditor.setObject(this.editedObject);

    this.startPivotPosition = this.handle.getWorldPosition(new THREE.Vector3());
    
    this.newVertexIds = [];
    this.newEdgeIds = [];
    this.newFaceIds = [];
    this.insetMoveData = new Map();

    this.selectedFaceIds = Array.from(this.editSelection.selectedFaceIds);
    if (this.selectedFaceIds.length <= 0) {
      this.clearStartData();
      return;
    }
    
    this.transformSolver.beginSession(this.startPivotPosition, null, null);

    this.startScreen = this.projectToScreen(
      this.startPivotPosition,
      this.camera,
      this.renderer.domElement
    );

    this.insetStarted = false;
  }

  applyInsetSession() {
    if (!this.startPivotPosition) return;

    if (!this.insetStarted) {
      this.startInset();
      this.editSelection.selectFaces(this.newFaceIds);
      this.handle.position.copy(this.startPivotPosition);
      this.insetStarted = true;
    }
    this.updateInset();
  }

  commitInsetSession() {
    this.clearCommandTransformState();

    this.vertexEditor.setObject(this.editedObject);
    this.vertexEditor.transform.updateGeometryAndHelpers();

    if (this.selectedFaceIds.length <= 0) {
      this.editSelection.clearSelection();
      this.disable();
      return;
    }

    this.updateSelectionAfterInset();
    this.clearStartData();
  }

  clearCommandTransformState() {
    this.activeTransformSource = null;

    this.transformSolver.clear();
    this.transformSolver.clearGizmoActiveVisualState();
    this.transformControls;

    requestAnimationFrame(() => {
      this.signals.transformDragEnded.dispatch('edit');
    });
  }

  projectToScreen(worldPosition, camera, domElement) {
    const projected = worldPosition.clone().project(camera);

    return new THREE.Vector2(
      (projected.x + 1) * 0.5 * domElement.clientWidth,
      (-projected.y + 1) * 0.5 * domElement.clientHeight
    );
  }

  startInset() {
    const meshData = this.editedObject.userData.meshData;

    const faceSet = this.editSelection.selectedFaceIds;
    const { vertexSet, edgeSet } = this.editSelection.resolveSelectionGraphFromFaces(faceSet);
    const selectedVertexIds = Array.from(vertexSet);
    const selectedEdgeIds = Array.from(edgeSet);
    const selectedFaceIds = Array.from(faceSet);

    const duplicationResult = this.vertexEditor.duplicate.duplicateSelectionFaces(selectedFaceIds);
    const mappedVertexIds = duplicationResult.mappedVertexIds;
    this.newVertexIds = duplicationResult.newVertexIds;
    this.newEdgeIds = duplicationResult.newEdgeIds;
    this.newFaceIds = duplicationResult.newFaceIds;

    const boundaryEdges = this.vertexEditor.topology.getBoundaryEdges(selectedVertexIds, selectedEdgeIds, selectedFaceIds);

    for (const [originalVertexId, newVertexId] of mappedVertexIds) {
      const newVertex = meshData.getVertex(newVertexId);
      const basePosition = new THREE.Vector3().copy(newVertex.position);

      this.insetMoveData.set(newVertexId, {
        originalVertexId,
        basePosition,
      });
    }

    // Bridge boundary edges
    for (const edge of boundaryEdges) {
      const nv1Id = mappedVertexIds.get(edge.v1Id);
      const nv2Id = mappedVertexIds.get(edge.v2Id);

      const sideFaceVertexIds = [edge.v1Id, edge.v2Id, nv2Id, nv1Id];

      this.vertexEditor.topology.createFaceFromVertices(sideFaceVertexIds);
    }

    this.vertexEditor.delete.deleteSelectionFaces(selectedFaceIds);
    this.vertexEditor.transform.updateGeometryAndHelpers(false);
  }

  updateInset() {
    const meshData = this.editedObject.userData.meshData;
    if (!meshData) return;
    if (this.selectedFaceIds.length <= 0) return;

    const currentWorld = this.handle.getWorldPosition(new THREE.Vector3());

    const currentScreen = this.projectToScreen(
      currentWorld,
      this.camera,
      this.renderer.domElement
    );

    const delta2D = currentScreen.clone().sub(this.startScreen);
    const pixelDistance = delta2D.length();
    if (pixelDistance <= 1) return;

    const depth = this.startPivotPosition.distanceTo(this.camera.position);
    this.width = this.pixelsToWorldUnits(pixelDistance, this.camera, depth, this.renderer);

    // Compute island center
    const center = new THREE.Vector3();
    for (const vId of this.newVertexIds) {
      const v = meshData.getVertex(vId);
      center.add(v.position);
    }
    center.divideScalar(this.newVertexIds.length);

    const newPositions = [];
    for (const vId of this.newVertexIds) {
      const vertex = meshData.getVertex(vId);

      const dir = new THREE.Vector3().subVectors(center, vertex.position).normalize();
      const moveData = this.insetMoveData.get(vId);
      const basePosition = moveData.basePosition;
      const newPos = new THREE.Vector3().copy(basePosition).addScaledVector(dir, this.width);

      newPositions.push(newPos);
    }

    this.vertexEditor.transform.setVerticesWorldPositions(this.newVertexIds, newPositions);
  }

  projectToScreen(worldPosition, camera, domElement) {
    const projected = worldPosition.clone().project(camera);

    return new THREE.Vector2(
      (projected.x + 1) * 0.5 * domElement.clientWidth,
      (-projected.y + 1) * 0.5 * domElement.clientHeight
    );
  }

  pixelsToWorldUnits(pixelDistance, camera, depth, renderer) {
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const viewportHeight = 2 * Math.tan(vFov / 2) * depth;
    const worldPerPixel = viewportHeight / renderer.domElement.clientHeight;
    return pixelDistance * worldPerPixel;
  }

  updateSelectionAfterInset() {
    const mode = this.editSelection.subSelectionMode;

    this.editSelection.clearSelection();

    if (mode === 'vertex') {
      this.editSelection.selectVertices(this.newVertexIds);
    } 
    else if (mode === 'edge') {
      this.editSelection.selectEdges(this.newEdgeIds);
    } 
    else if (mode === 'face') {
      this.editSelection.selectFaces(this.newFaceIds);
    }
  }

  clearStartData() {
    this.startPivotPosition = null;

    this.newVertexIds = null;
    this.newEdgeIds = null;
    this.newFaceIds = null;
    this.startScreen = null;
    this.insetMoveData = null;

    this.insetStarted = false;
  }
}