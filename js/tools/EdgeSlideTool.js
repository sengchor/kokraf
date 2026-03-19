import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { TransformCommandSolver } from './TransformCommandSolver.js';

export class EdgeSlideTool {
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
      this.startEdgeSlideSession();
    });

    this.transformControls.addEventListener('change', () => {
      if (!this.transformControls.dragging) return;
      if (this.activeTransformSource !== 'gizmo') return;

      this.applyEdgeSlideSession();
    });

    this.transformControls.addEventListener('mouseUp', () => {
      if (this.activeTransformSource !== 'gizmo') return;

      this.commitEdgeSlideSession();
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

  // Edge Slide Session
  startEdgeSlideSession() {
    this.editedObject = this.editSelection.editedObject;
    if (!this.editedObject || !this.handle) return;
    this.vertexEditor.setObject(this.editedObject);

    this.startPivotPosition = this.handle.getWorldPosition(new THREE.Vector3());
    this.slideData = new Map();
    this.selectedEdgeIds = Array.from(this.editSelection.selectedEdgeIds);

    this.transformSolver.beginSession(this.startPivotPosition, null, null);

    this.edgeSlideStarted = false;
  }

  applyEdgeSlideSession() {
    if (!this.startPivotPosition) return;

    if (!this.edgeSlideStarted) {
      this.startEdgeSlide();
      this.handle.position.copy(this.startPivotPosition);
      this.edgeSlideStarted = true;
    }
    this.updateEdgeSlide();
  }

  commitEdgeSlideSession() {

  }

  startEdgeSlide() {
    const meshData = this.editedObject.userData.meshData;

    const selectedEdges = this.selectedEdgeIds.map(id => meshData.edges.get(id));
    const selectedEdgeSet = new Set(selectedEdges);

    const vertices = new Set();
    for (const edge of selectedEdges) {
      vertices.add(meshData.getVertex(edge.v1Id));
      vertices.add(meshData.getVertex(edge.v2Id));
    }

    for (const vertex of vertices) {
      const connectedEdges = Array.from(vertex.edgeIds).map(id => meshData.edges.get(id));

      const candidateEdges = [];
      for (const edge of connectedEdges) {
        if (!selectedEdgeSet.has(edge)) {
          candidateEdges.push(edge);
        }
      }

      if (candidateEdges.length < 1) continue;

      const slideEdges = [];
      for (const edge of selectedEdges) {
        for (const candidateEdge of candidateEdges) {
          let sharesFace = false;
          for (const fid of edge.faceIds) {
            if (candidateEdge.faceIds.has(fid)) {
              sharesFace = true;
              break;
            }
          }
          if (!sharesFace) continue;

          slideEdges.push(candidateEdge);
        }
      }

      const directions = [];
      for (const edge of slideEdges) {
        const otherVertexId = edge.v1Id === vertex.id ? edge.v2Id : edge.v1Id;
        const otherVertex = meshData.getVertex(otherVertexId);

        const direction = new THREE.Vector3().subVectors(otherVertex.position, vertex.position);
        const length = direction.length();

        directions.push({direction, length});
      }

      this.slideData.set(vertex.id, {
        origin: new THREE.Vector3().copy(vertex.position),
        directions
      });
    }
  }

  updateEdgeSlide() {
    const meshData = this.editedObject.userData.meshData;
    if (!meshData) return;
    if (!this.selectedEdgeIds.length || !this.slideData) return;

    const currentPivotPosition = this.handle.getWorldPosition(new THREE.Vector3());
    const offset = new THREE.Vector3().subVectors(
      currentPivotPosition,
      this.startPivotPosition
    );

    const vertexIds = [];
    const newPositions = [];

    const first = this.slideData.values().next().value;
    if (!first) return;

    const alignedDir = this.getMostAlignedDirection(offset, first.directions);
    if (!alignedDir) return;

    const globalDirNorm = alignedDir.direction.clone().normalize();

    let t = offset.dot(globalDirNorm) / alignedDir.length;
    t = Math.max(0, Math.min(1, t));

    for (const [vertexId, data] of this.slideData.entries()) {
      const best = this.getMostAlignedDirection(globalDirNorm, data.directions);
      if (!best) continue;

      const position = data.origin.clone().add(
        best.direction.clone().multiplyScalar(t)
      );

      vertexIds.push(vertexId);
      newPositions.push(position);
    }

    this.vertexEditor.transform.setVerticesWorldPositions(vertexIds, newPositions);
  }

  getMostAlignedDirection(offset, directions) {
    let bestDir = null;
    let bestScore = -Infinity;

    const offsetNormal = offset.clone().normalize();

    for (const dir of directions) {
      const dirNorm = dir.direction.clone().normalize();
      const score = offsetNormal.dot(dirNorm);

      if (score > bestScore) {
        bestScore = score;
        bestDir = dir;
      }
    }

    return bestDir;
  }
}