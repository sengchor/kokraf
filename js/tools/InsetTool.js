import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { TransformCommandSolver } from './TransformCommandSolver.js';
import { computeFacesAverageNormal } from '../utils/AlignedNormalUtils.js';
import { InsetCommand } from '../commands/InsetCommand.js';
import { ToolNumericInput } from './ToolNumericInput.js';

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
    this.toolNumericInput = new ToolNumericInput({
      tool: this,
      label: 'Width',
      getter: () => this.width,
      setter: (v) => this.applyInsetWidth(v),
      unit: 'm'
    });

    this.setupTransformListeners();
    this.setupListeners();

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);
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

  setupListeners() {
    this.signals.viewportCameraChanged.add((camera) => {
      if (camera.isDefault) {
        this.camera = camera;
        this.transformControls.camera = camera;
        this.transformSolver.camera = camera;
      }
    });

    this.signals.editInsetStart.add(() => {
      this.editedObject = this.editSelection.editedObject;
      if (!this.editedObject || !this.handle) return;

      if (this.activeTransformSource !== null) return;

      if (this.handle && this.transformControls.worldPositionStart) {
        this.handle.getWorldPosition(this.transformControls.worldPositionStart);
      }

      this.activeTransformSource = 'command';
      this.startInsetSession();

      this.transformSolver.updateHandleFromCommandInput('translate', this.event);
      this.applyInsetSession();

      this.signals.transformDragStarted.dispatch('edit');
    });
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

  // Command Control
  onPointerMove() {
    if (this.activeTransformSource !== 'command' || this.toolNumericInput.active) return;
    this.transformSolver.updateHandleFromCommandInput('translate', this.event);
    this.applyInsetSession();
    this.signals.objectChanged.dispatch();
  }

  onPointerDown() {
    if (this.activeTransformSource !== 'command') return;
    this.commitInsetSession();
    this.transformSolver.clearGizmoActiveVisualState();
    this.transformSolver.clear();
  }

  onPointerUp() {
    if (this.activeTransformSource !== 'command') return;
    this.clearCommandTransformState();
    this.toolNumericInput.reset();
  }

  onKeyDown(event) {
    if (this.activeTransformSource !== 'command') return;

    if (this.toolNumericInput.handleKey(event, this.mode)) {
      return;
    }

    if (event.key === 'Escape') {
      this.cancelInsetSession();
      this.clearCommandTransformState();
      this.toolNumericInput.reset();
    }

    if (event.key === 'Enter') {
      this.commitInsetSession();
      this.clearCommandTransformState();
      this.toolNumericInput.reset();
    }
  }

  // Inset Session
  startInsetSession() {
    this.editedObject = this.editSelection.editedObject;
    if (!this.editedObject || !this.handle) return;
    this.vertexEditor.setObject(this.editedObject);

    this.startPivotPosition = this.handle.getWorldPosition(new THREE.Vector3());
    
    this.newVertexIds = [];
    this.newEdgeIds = [];
    this.newFaceIds = [];
    this.insetMoveData = new Map();

    const meshData = this.editedObject.userData.meshData;
    this.beforeMeshData = structuredClone(meshData);

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

    this.signals.onToolStarted.dispatch(this.toolNumericInput.getDisplayText());
  }

  applyInsetSession() {
    if (!this.startPivotPosition) return;

    if (!this.insetStarted) {
      this.startInset();
      this.editSelection.selectFaces(Array.from(this.newFaceIds));
      this.handle.position.copy(this.startPivotPosition);
      this.insetStarted = true;
    }
    this.updateInset();

    this.signals.onToolUpdated.dispatch(this.toolNumericInput.getDisplayText());
  }

  commitInsetSession() {
    if (!this.width || this.width === 0) {
      this.cancelInsetSession();
      this.clearCommandTransformState();
      this.clearStartData();
      this.toolNumericInput.reset();
      return;
    }

    this.vertexEditor.setObject(this.editedObject);
    this.vertexEditor.transform.updateGeometryAndHelpers();

    if (this.selectedFaceIds.length <= 0) {
      this.editSelection.clearSelection();
      this.disable();
      return;
    }

    const meshData = this.editedObject.userData.meshData;
    this.afterMeshData = structuredClone(meshData);
    this.editor.execute(new InsetCommand(this.editor, this.editedObject, this.beforeMeshData, this.afterMeshData));

    this.updateSelectionAfterInset();
    this.clearStartData();
  }

  cancelInsetSession() {
    this.editedObject = this.editSelection.editedObject;
    if (!this.editedObject || !this.startPivotPosition) return;

    this.vertexEditor.setObject(this.editedObject);
    this.vertexEditor.transform.applyMeshData(this.beforeMeshData);
    this.vertexEditor.transform.updateGeometryAndHelpers();

    this.handle.position.copy(this.startPivotPosition);
    this.handle.updateMatrixWorld(true);

    this.editSelection.selectFaces(this.selectedFaceIds);
  }

  clearCommandTransformState() {
    this.activeTransformSource = null;

    this.transformSolver.clear();
    this.transformSolver.clearGizmoActiveVisualState();

    requestAnimationFrame(() => {
      this.signals.transformDragEnded.dispatch('edit');
      this.signals.onToolEnded.dispatch();
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
    const selectedFaceIds = Array.from(faceSet);
    
    const faceIslands = this.vertexEditor.dissolve.splitFaceIslands(selectedFaceIds);
    this.boundaryVertexIdsSet = new Set();
    this.newVertexIds = new Set();
    this.newEdgeIds = new Set();
    this.newFaceIds = new Set();

    for (const faceIsland of faceIslands) {
      const groupFaceIdsSet = new Set(faceIsland);

      const { vertexSet, edgeSet } = this.editSelection.resolveSelectionGraphFromFaces(groupFaceIdsSet);
      const groupVertexIds = Array.from(vertexSet);
      const groupEdgeIds = Array.from(edgeSet);
      const groupFaceIds = Array.from(groupFaceIdsSet);

      this.boundaryEdges = this.vertexEditor.selection.getBoundaryEdges(groupVertexIds, groupEdgeIds, groupFaceIds);
      if (!this.boundaryEdges) return;

      const selectedEdges = groupEdgeIds.map(edgeId => meshData.edges.get(edgeId));

      const duplicationResult = this.vertexEditor.duplicate.duplicateSelectionFaces(groupFaceIds);
      const mappedVertexIds = duplicationResult.mappedVertexIds;
      duplicationResult.newVertexIds.forEach(id => this.newVertexIds.add(id));
      duplicationResult.newEdgeIds.forEach(id => this.newEdgeIds.add(id));
      duplicationResult.newFaceIds.forEach(id => this.newFaceIds.add(id));

      for (const edge of this.boundaryEdges) {
        for (const vId of [edge.v1Id, edge.v2Id]) {
          const newId = mappedVertexIds.get(vId);
          if (newId !== undefined) this.boundaryVertexIdsSet.add(newId);
        }
      }

      for (const [originalVertexId, newVertexId] of mappedVertexIds) {
        if (!this.boundaryVertexIdsSet.has(newVertexId)) continue;

        let insetDir = new THREE.Vector3();

        const vertex = meshData.getVertex(originalVertexId);
        const basePosition = new THREE.Vector3().copy(vertex.position).applyMatrix4(this.editedObject.matrixWorld);

        const faceIds = this.getConnectedFaces(meshData, originalVertexId, groupFaceIdsSet);

        const neighbors = this.getConnectedVertices(originalVertexId, this.boundaryEdges);
        const selectedNeighbors = this.getConnectedVertices(originalVertexId, selectedEdges);
        const unselectedNeighbors = selectedNeighbors.filter(vId => !neighbors.includes(vId));

        let toCenter = new THREE.Vector3();
        const insideNeighbors = selectedNeighbors.filter(vId => !neighbors.includes(vId));
        if (insideNeighbors.length > 0) {
          const center = this.computeAverageMidpoint(meshData, originalVertexId, insideNeighbors);
          center.applyMatrix4(this.editedObject.matrixWorld);
          toCenter = new THREE.Vector3().subVectors(center, basePosition).normalize();
        } else {
          const center = this.computeFacesCenter(meshData, faceIds);
          center.applyMatrix4(this.editedObject.matrixWorld);
          toCenter = new THREE.Vector3().subVectors(center, basePosition).normalize();
        }

        if (neighbors.length !== 2) continue;

        const prev = meshData.getVertex(neighbors[0]);
        const next = meshData.getVertex(neighbors[1]);

        const e1 = new THREE.Vector3().subVectors(vertex.position, prev.position).normalize();
        const e2 = new THREE.Vector3().subVectors(next.position, vertex.position).normalize();

        const edge1 = meshData.getEdge(vertex.id, prev.id);
        const edge2 = meshData.getEdge(next.id, vertex.id);

        const sharedFaceIds = [...edge1.faceIds].filter(fid =>
          (edge2.faceIds.has(fid) && !groupFaceIdsSet.has(fid))
        );

        const sharedFaceNormal = computeFacesAverageNormal(meshData, sharedFaceIds);
        const faceNormal = computeFacesAverageNormal(meshData, faceIds);

        const crossDirection = new THREE.Vector3().crossVectors(e1, e2).normalize();

        const n1 = new THREE.Vector3().crossVectors(faceNormal, e1).normalize();
        const n2 = new THREE.Vector3().crossVectors(faceNormal, e2).normalize();

        let bisector = new THREE.Vector3().addVectors(n1, n2).normalize();

        if (bisector.lengthSq() < 1e-6) {
          bisector.copy(n1);
        } else {
          bisector.normalize();
        }

        insetDir.copy(bisector);

        // choose a more stable inset direction
        const dotNormal = insetDir.dot(faceNormal);
        const dotCross = insetDir.dot(crossDirection);

        if (selectedNeighbors.length > 2 && (Math.abs(dotNormal) > 1e-4 || Math.abs(dotCross) > 1e-4)) {
          
          if (unselectedNeighbors.length > 0) {
            const slideDir = new THREE.Vector3();
            for (const vId of unselectedNeighbors) {
              const anchorVertex = meshData.getVertex(vId);
              const direction = new THREE.Vector3().subVectors(anchorVertex.position, vertex.position).normalize();
              slideDir.add(direction);
            }
            slideDir.divideScalar(unselectedNeighbors.length);
            slideDir.normalize();
            
            const projectionDot = slideDir.dot(bisector);
            if (Math.abs(projectionDot) > 0.01) {
              insetDir.copy(slideDir);
            }
          } else if (sharedFaceIds.length > 0 && Math.abs(sharedFaceNormal.clone().dot(faceNormal)) < 0.9) {
            insetDir.copy(sharedFaceNormal);
          }
        }

        if (insetDir.dot(toCenter) < 0) {
          insetDir.negate();
        }

        const miterScale = (this.calculateScaleFactor(insetDir, e1) + this.calculateScaleFactor(insetDir, e2)) * 0.5;
        insetDir.transformDirection(this.editedObject.matrixWorld).normalize();

        this.insetMoveData.set(newVertexId, {
          originalVertexId,
          basePosition: basePosition.clone(),
          direction: insetDir,
          scale: miterScale
        });
      }

      // Bridge boundary edges
      for (const edge of this.boundaryEdges) {
        const nv1Id = mappedVertexIds.get(edge.v1Id);
        const nv2Id = mappedVertexIds.get(edge.v2Id);

        const sideFaceVertexIds = [edge.v1Id, edge.v2Id, nv2Id, nv1Id];

        const dir1 = this.insetMoveData.get(nv1Id).direction;
        const dir2 = this.insetMoveData.get(nv2Id).direction;
        const normal = new THREE.Vector3().crossVectors(dir1, dir2).normalize();

        if (normal.lengthSq() < 1e-8) {
          const v1 = meshData.getVertex(edge.v1Id).position;
          const v2 = meshData.getVertex(edge.v2Id).position;
          const v3 = new THREE.Vector3()
            .copy(meshData.getVertex(nv2Id).position)
            .addScaledVector(dir2, 1);

          normal.crossVectors(
            new THREE.Vector3().subVectors(v2, v1),
            new THREE.Vector3().subVectors(v3, v1)
          );
          normal.normalize();
        }

        const sharedFaceIds = [...edge.faceIds].filter(fid =>
          groupFaceIdsSet.has(fid)
        );

        const faceNormal = computeFacesAverageNormal(meshData, sharedFaceIds);
        
        if (normal.dot(faceNormal) < 0) {
          sideFaceVertexIds.reverse();
        }

        this.vertexEditor.topology.createFaceFromVertices(sideFaceVertexIds);
      }
    };

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
    this.applyInsetWidth(this.width);
  }

  projectToScreen(worldPosition, camera, domElement) {
    const projected = worldPosition.clone().project(camera);

    return new THREE.Vector2(
      (projected.x + 1) * 0.5 * domElement.clientWidth,
      (-projected.y + 1) * 0.5 * domElement.clientHeight
    );
  }

  pixelsToWorldUnits(pixelDistance, camera, depth, renderer) {
    const viewportHeightPx = renderer.domElement.clientHeight;

    let worldPerPixel;

    if (camera.isPerspectiveCamera) {
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const viewportHeight = 2 * Math.tan(vFov / 2) * depth;
      worldPerPixel = viewportHeight / viewportHeightPx;
    } else if (camera.isOrthographicCamera) {
      const worldHeight = (camera.top - camera.bottom) / camera.zoom;
      worldPerPixel = worldHeight / viewportHeightPx;
    }

    return pixelDistance * worldPerPixel;
  }

  updateSelectionAfterInset() {
    const mode = this.editSelection.subSelectionMode;

    this.editSelection.clearSelection();

    if (mode === 'vertex') {
      this.editSelection.selectVertices(Array.from(this.newVertexIds));
    } 
    else if (mode === 'edge') {
      this.editSelection.selectEdges(Array.from(this.newEdgeIds));
    } 
    else if (mode === 'face') {
      this.editSelection.selectFaces(Array.from(this.newFaceIds));
    }
  }

  clearStartData() {
    this.startPivotPosition = null;

    this.newVertexIds = null;
    this.newEdgeIds = null;
    this.newFaceIds = null;
    this.startScreen = null;
    this.insetMoveData = null;
    this.width = null;

    this.insetStarted = false;
  }

  getConnectedVertices(vertexId, edges) {
    const connected = [];

    for (const edge of edges) {
      if (edge.v1Id === vertexId) {
        connected.push(edge.v2Id);
      } 
      else if (edge.v2Id === vertexId) {
        connected.push(edge.v1Id);
      }
    }

    return connected;
  }

  getConnectedFaces(meshData, vertexId, selectedFaceIds) {
    const vertex = meshData.getVertex(vertexId);

    const faceIds = [];
    for (const faceId of vertex.faceIds) {
      if (selectedFaceIds.has(faceId)) {
        faceIds.push(faceId);
      }
    }

    return faceIds;
  }

  calculateScaleFactor(dir1, dir2) {
    const EPS = 0.001;
    const dot = THREE.MathUtils.clamp(dir1.dot(dir2), -1, 1);
    const sin = Math.sqrt(1 - dot * dot);
    const scaleFactor = sin > EPS ? 1 / sin : 1;
    return scaleFactor;
  }

  computeFacesCenter(meshData, faceIds) {
    const vertexSet = new Set();
    for (const faceId of faceIds) {
      const face = meshData.faces.get(faceId);

      for (const vId of face.vertexIds) {
        vertexSet.add(vId);
      }
    }

    const center = new THREE.Vector3();
    for (const vId of vertexSet) {
      const v = meshData.getVertex(vId);
      center.add(v.position);
    }

    center.divideScalar(vertexSet.size);

    return center;
  }

  computeAverageMidpoint(meshData, vertexId, neighborIds) {
    const vertex = meshData.getVertex(vertexId);
    const center = new THREE.Vector3();

    for (const nId of neighborIds) {
      const neighbor = meshData.getVertex(nId);

      const mid = new THREE.Vector3()
        .addVectors(neighbor.position, vertex.position)
        .multiplyScalar(0.5);

      center.add(mid);
    }

    center.divideScalar(neighborIds.length);

    return center;
  }

  applyInsetWidth(value) {
    if (!value) { value = 0 };
    this.width = value;

    const newPositions = [];
    const newBoundaryVertexIds = Array.from(this.boundaryVertexIdsSet);
    for (const vId of newBoundaryVertexIds) {
      const moveData = this.insetMoveData.get(vId);
      if (!moveData) continue;

      const basePosition = moveData.basePosition;
      const direction = moveData.direction;
      const newPos = basePosition.clone().addScaledVector(direction, this.width * moveData.scale);

      newPositions.push(newPos);
    }

    this.vertexEditor.transform.setVerticesWorldPositions(newBoundaryVertexIds, newPositions);
  }
}