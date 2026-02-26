import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { getNeighborFaces, shouldFlipNormal, calculateVertexIdsNormal } from '../utils/AlignedNormalUtils.js';
import { TransformCommandSolver } from './TransformCommandSolver.js';

export class BevelTool {
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
    this.signals.editBevelStart.add(() => {
      this.editedObject = this.editSelection.editedObject;
      if (!this.editedObject || !this.handle) return;

      if (this.activeTransformSource !== null) return;

      if (this.handle && this.transformControls.worldPositionStart) {
        this.handle.getWorldPosition(this.transformControls.worldPositionStart);
      }

      this.activeTransformSource = 'command';
      this.startBevelSession();

      this.transformSolver.updateHandleFromCommandInput('translate', this.event);
      this.applyBevelSession();

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
      this.startBevelSession();
    });

    this.transformControls.addEventListener('change', () => {
      if (!this.transformControls.dragging) return;
      if (this.activeTransformSource !== 'gizmo') return;

      this.applyBevelSession();
    });

    this.transformControls.addEventListener('mouseUp', () => {
      if (this.activeTransformSource !== 'gizmo') return;

      this.commitBevelSession();
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
    if (this.activeTransformSource !== 'command') return;
    this.transformSolver.updateHandleFromCommandInput('translate', this.event);
    this.applyBevelSession();
    this.signals.objectChanged.dispatch();
  }

  onPointerDown() {
    if (this.activeTransformSource !== 'command') return;
    this.commitBevelSession();
    this.transformSolver.clearGizmoActiveVisualState();
    this.transformSolver.clear();
  }

  onPointerUp() {
    if (this.activeTransformSource !== 'command') return;
    this.clearCommandTransformState();
  }

  onKeyDown(event) {
    if (this.activeTransformSource !== 'command') return;

    if (event.key === 'Escape') {
      this.cancelBevelSession();
      this.clearCommandTransformState();
    }

    if (event.key === 'Enter') {
      this.commitBevelSession();
      this.clearCommandTransformState();
    }
  }

  // Bevel session
  startBevelSession() {
    this.editedObject = this.editSelection.editedObject;
    if (!this.editedObject || !this.handle) return;
    this.vertexEditor.setObject(this.editedObject);

    this.startPivotPosition = this.handle.getWorldPosition(new THREE.Vector3());

    this.newVertexIds = [];
    this.newEdgeIds = [];
    this.newFaceIds = [];
    this.bevelMoveData = [];

    const meshData = this.editedObject.userData.meshData;
    this.beforeMeshData = structuredClone(meshData);

    const rawEdgeIds = Array.from(this.editSelection.selectedEdgeIds);
    this.selectedEdgeIds = this.filterValidBevelEdges(meshData, rawEdgeIds);
    if (this.selectedEdgeIds.length <= 0) {
      this.clearStartData();
      return;
    }
    
    this.transformSolver.beginSession(this.startPivotPosition, null, null);

    this.startScreen = this.projectToScreen(
      this.startPivotPosition,
      this.camera,
      this.renderer.domElement
    );

    this.bevelStarted = false;
  }

  applyBevelSession() {
    if (!this.startPivotPosition) return;

    if (!this.bevelStarted) {
      this.startBevel();
      this.editSelection.selectFaces(this.newFaceIds);
      this.handle.position.copy(this.startPivotPosition);
      this.bevelStarted = true;
    }
    this.updateBevel();
  }

  commitBevelSession() {
    this.vertexEditor.setObject(this.editedObject);
    this.vertexEditor.transform.updateGeometryAndHelpers();

    if (this.selectedEdgeIds.length <= 0) {
      this.editSelection.clearSelection();
      this.disable();
      return;
    }

    this.updateSelectionAfterBevel();
    this.clearStartData();
  }

  cancelBevelSession() {
    console.log('cancel');
  }

  clearCommandTransformState() {
    this.activeTransformSource = null;

    this.transformSolver.clear();
    this.transformSolver.clearGizmoActiveVisualState();

    requestAnimationFrame(() => {
      this.signals.transformDragEnded.dispatch('edit');
    });
  }

  clearStartData() {
    this.startPivotPosition = null;

    this.newVertexIds = null;
    this.newEdgeIds = null;
    this.newFaceIds = null;
    this.bevelMoveData = null;
    this.startScreen = null;

    this.bevelStarted = false;
  }

  startBevel() {
    this.editedObject = this.editSelection.editedObject;
    if (!this.editedObject) return;
    if (this.selectedEdgeIds.length <= 0) return;

    const meshData = this.editedObject.userData.meshData;
    if (!meshData) return;

    const edgeGroups = this.groupConnectedSelectedEdges(meshData, this.selectedEdgeIds);

    for (const edgeGroup of edgeGroups) {
      const adjacentFaceIds = this.getFacesAdjacentToEdges(meshData, edgeGroup);
      const vertexNeighborFaceIds = this.getFacesAdjacentToEdgeVertices(meshData, edgeGroup);

      const graph = this.buildSelectedEdgeGraph(meshData, edgeGroup);
      const bevelResults = new Map();

      let result = null;
      for (const [vId, info] of graph.vertexInfo) {
        if (info.valence === 1) {
          result = this.bevelEndVertex(meshData, info);
        }
        else if (info.valence === 2) {
          result = this.bevelCornerVertex(meshData, info);
        }
        else {
          result = this.bevelJunctionVertex(meshData, info);
        }
        if (result) bevelResults.set(vId, result);
      }

      for (const [originalVertexId, result] of bevelResults) {
        const { faceVertexMap } = result;

        for (const [faceId, newVertexIds] of faceVertexMap) {

          if (!adjacentFaceIds.has(faceId) || newVertexIds.length >= 2) {
            this.splitVertexInFace(meshData, faceId, originalVertexId, newVertexIds[0], newVertexIds[1]);
          }
          else {
            this.replaceVertexInFace(meshData, faceId, originalVertexId, newVertexIds[0]);
          }
        }
      }

      const bridgeFaceIds = this.createBridgeFaces(meshData, edgeGroup, bevelResults);

      for (const faceId of vertexNeighborFaceIds) {
        const face = meshData.faces.get(faceId);
        if (!face) continue;

        this.rebuildFaceTopology(meshData, face);
      }

      const fillFaceIds = this.fillBevelCornerFaces(meshData, bevelResults);

      this.deleteOldEdgeVertices(meshData, edgeGroup);

      const groupVertexIds = this.getAllBevelNewVertexIds(bevelResults);
      const groupFaceIds = [...bridgeFaceIds, ...fillFaceIds];
      const groupEdgeIds = this.getEdgeIdsFromFaces(meshData, groupFaceIds);

      this.newVertexIds.push(...groupVertexIds);
      this.newEdgeIds.push(...groupEdgeIds);
      this.newFaceIds.push(...groupFaceIds);
    }

    this.vertexEditor.transform.updateGeometryAndHelpers(false);
  }

  updateBevel() {
    const meshData = this.editedObject.userData.meshData;
    if (!meshData) return;
    if (this.selectedEdgeIds.length <= 0) return;

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
    const distance = this.pixelsToWorldUnits(pixelDistance, this.camera, depth, this.renderer);
    if (distance < 0.01) return;

    const newPositions = this.bevelMoveData.map(moveData => {
      const scale = moveData.scaleFactor;
      return moveData.basePosition.clone().add(
        moveData.direction.clone().multiplyScalar(distance * scale)
      );
    });

    const newVertexIds = this.bevelMoveData.map(moveData => moveData.vertexId);
    this.vertexEditor.transform.setVerticesWorldPositions(newVertexIds, newPositions);
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

  filterValidBevelEdges(meshData, selectedEdgeIds) {
    const valid = [];

    for (const edgeId of selectedEdgeIds) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      if (edge.faceIds && edge.faceIds.size === 2) {
        valid.push(edgeId);
      }
    }

    return valid;
  }

  groupConnectedSelectedEdges(meshData, selectedEdgeIds) {
    const selectedSet = new Set(selectedEdgeIds);
    const visitedEdges = new Set();
    const componentSet = [];

    const vertexToEdges = new Map();

    for (const edgeId of selectedSet) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      for (const vId of [edge.v1Id, edge.v2Id]) {
        if (!vertexToEdges.has(vId)) {
          vertexToEdges.set(vId, new Set());
        }
        vertexToEdges.get(vId).add(edgeId);
      }
    }

    // Traverse connected components
    for (const startEdgeId of selectedSet) {
      if (visitedEdges.has(startEdgeId)) continue;

      const stack = [startEdgeId];
      const componentEdges = new Set();

      while (stack.length > 0) {
        const currentEdgeId = stack.pop();
        if (visitedEdges.has(currentEdgeId)) continue;

        visitedEdges.add(currentEdgeId);
        componentEdges.add(currentEdgeId);

        const edge = meshData.edges.get(currentEdgeId);
        if (!edge) continue;

        for (const vId of [edge.v1Id, edge.v2Id]) {
          const connectedEdges = vertexToEdges.get(vId);
          if (!componentEdges) continue;

          for (const nextEdgeId of connectedEdges) {
            if (!visitedEdges.has(nextEdgeId)) {
              stack.push(nextEdgeId);
            }
          }
        }
      }

      componentSet.push(componentEdges);
    }
    return componentSet;
  }

  buildSelectedEdgeGraph(meshData, selectedSet) {
    const vertexToSelectedEdges = new Map();
    const selectedVertices = new Set();

    for (const edgeId of selectedSet) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      for (const vId of [edge.v1Id, edge.v2Id]) {
        selectedVertices.add(vId);

        if (!vertexToSelectedEdges.has(vId)) {
          vertexToSelectedEdges.set(vId, new Set());
        }

        vertexToSelectedEdges.get(vId).add(edgeId);
      }
    }

    const vertexInfo = new Map();

    for (const vId of selectedVertices) {
      const connectedEdges = vertexToSelectedEdges.get(vId) || new Set();

      vertexInfo.set(vId, {
        vertexId: vId,
        selectedEdgeIds: [...connectedEdges],
        valence: connectedEdges.size
      });
    }

    return {
      selectedEdges: selectedSet,
      selectedVertices,
      vertexInfo
    };
  }

  bevelEndVertex(meshData, info) {
    const { vertexId, selectedEdgeIds, valence } = info;
    if (valence !== 1) return null;

    const vertex = meshData.getVertex(vertexId);
    if (!vertex) return null;

    const selectedEdgeId = selectedEdgeIds[0];
    const edge = meshData.edges.get(selectedEdgeId);
    if (!edge) return null;

    const otherEdgeId = edge.v1Id === vertexId ? edge.v2Id : edge.v1Id;
    const otherEdgeV = meshData.getVertex(otherEdgeId);

    const vPos = new THREE.Vector3().copy(vertex.position).applyMatrix4(this.editedObject.matrixWorld);
    const oPos = new THREE.Vector3().copy(otherEdgeV.position).applyMatrix4(this.editedObject.matrixWorld);

    const edgeDirection = new THREE.Vector3().subVectors(oPos, vPos).normalize();

    const connectedEdges = Array.from(vertex.edgeIds).map(edgeId => meshData.edges.get(edgeId));
    const EPS = 0.001;

    const newVertexIds = [];
    const faceVertexMap = new Map();
    for (const connectedEdge of connectedEdges) {
      if (connectedEdge === edge) continue;

      const otherId = connectedEdge.v1Id === vertexId ? connectedEdge.v2Id : connectedEdge.v1Id;
      const otherV = meshData.getVertex(otherId);

      const p1 = new THREE.Vector3().copy(vertex.position).applyMatrix4(this.editedObject.matrixWorld);
      const p2 = new THREE.Vector3().copy(otherV.position).applyMatrix4(this.editedObject.matrixWorld);

      const basePosition = p1.clone();
      const direction = p2.clone().sub(p1).normalize();

      const dot = THREE.MathUtils.clamp(edgeDirection.dot(direction), -1, 1);
      const sin = Math.sqrt(1 - dot * dot);
      const scaleFactor = sin > EPS ? 1 / sin : 1;

      const baseLocal = basePosition.clone().applyMatrix4(new THREE.Matrix4().copy(this.editedObject.matrixWorld).invert());
      const newVertex = meshData.addVertex(baseLocal);
      newVertexIds.push(newVertex.id);

      this.bevelMoveData.push({
        vertexId: newVertex.id,
        basePosition,
        direction: direction.clone(),
        scaleFactor
      });

      for (const faceId of connectedEdge.faceIds) {
        const face = meshData.faces.get(faceId);
        if (!face) continue;

        if (!face.vertexIds.includes(vertexId)) continue;

        if (!faceVertexMap.has(faceId)) {
          faceVertexMap.set(faceId, []);
        }
        faceVertexMap.get(faceId).push(newVertex.id);
      }
    }

    return {
      type: "end",
      originalVertexId: vertexId,
      newVertexIds,
      selectedEdgeId,
      faceVertexMap
    };
  }

  bevelCornerVertex(meshData, info) {
    const { vertexId, selectedEdgeIds, valence } = info;
    if (valence !== 2) return null;

    const vertex = meshData.getVertex(vertexId);
    if (!vertex) return null;

    const [edgeId1, edgeId2] = selectedEdgeIds;
    const edge1 = meshData.edges.get(edgeId1);
    const edge2 = meshData.edges.get(edgeId2);
    if (!edge1 || !edge2) return null;

    // Find the opposite vertices on the two selected edges
    const v1Id = edge1.v1Id === vertexId ? edge1.v2Id : edge1.v1Id;
    const v2Id = edge2.v1Id === vertexId ? edge2.v2Id : edge2.v1Id;

    const v1 = meshData.getVertex(v1Id);
    const v2 = meshData.getVertex(v2Id);
    if (!v1 || !v2) return null;

    const p0 = new THREE.Vector3().copy(vertex.position).applyMatrix4(this.editedObject.matrixWorld);
    const p1 = new THREE.Vector3().copy(v1.position).applyMatrix4(this.editedObject.matrixWorld);
    const p2 = new THREE.Vector3().copy(v2.position).applyMatrix4(this.editedObject.matrixWorld);

    const dir1 = p1.sub(p0).normalize();
    const dir2 = p2.sub(p0).normalize();

    const newVertexIds = [];
    const faceVertexMap = new Map();

    // Faces shared by BOTH selected edges
    const sharedFaceIds = [...edge1.faceIds].filter(fid =>
      edge2.faceIds.has(fid)
    );

    const connectedEdges = Array.from(vertex.edgeIds).map(edgeId => meshData.edges.get(edgeId));
    const EPS = 0.001;

    if (sharedFaceIds.length > 0) {
      // compute corner bevel position
      const dot = THREE.MathUtils.clamp(dir1.dot(dir2), -1, 1);
      const sinHalf = Math.sqrt((1 - dot) * 0.5);
      const scaleFactor = sinHalf > EPS ? 1 / sinHalf : 1;

      const bisector = dir1.clone().add(dir2).normalize();

      for (const faceId of sharedFaceIds) {
        const basePosition = p0.clone();
        const baseLocal = basePosition.clone().applyMatrix4(new THREE.Matrix4().copy(this.editedObject.matrixWorld).invert());
        const newVertex = meshData.addVertex(baseLocal);
        newVertexIds.push(newVertex.id);

        this.bevelMoveData.push({
          vertexId: newVertex.id,
          basePosition,
          direction: bisector.clone(),
          scaleFactor
        });

        if (!faceVertexMap.has(faceId)) {
          faceVertexMap.set(faceId, []);
        }
        faceVertexMap.get(faceId).push(newVertex.id);
      }
    }

    // Slide along unselected connected edges
    for (const connectedEdge of connectedEdges) {
      if (connectedEdge === edge1 || connectedEdge === edge2) continue;

      const otherId = connectedEdge.v1Id === vertexId ? connectedEdge.v2Id : connectedEdge.v1Id;
      const otherV = meshData.getVertex(otherId);

      const p1 = new THREE.Vector3().copy(vertex.position).applyMatrix4(this.editedObject.matrixWorld);
      const p2 = new THREE.Vector3().copy(otherV.position).applyMatrix4(this.editedObject.matrixWorld);

      const basePosition = p1.clone();
      const direction = p2.clone().sub(p1).normalize();

      const baseLocal = basePosition.clone().applyMatrix4(new THREE.Matrix4().copy(this.editedObject.matrixWorld).invert());
      const newVertex = meshData.addVertex(baseLocal);
      newVertexIds.push(newVertex.id);

      this.bevelMoveData.push({
        vertexId: newVertex.id,
        basePosition,
        direction: direction.clone(),
        scaleFactor: 1
      });

      // Map to all faces of that edge that include the vertex
      for (const faceId of connectedEdge.faceIds) {
        const face = meshData.faces.get(faceId);
        if (!face) continue;
        if (!face.vertexIds.includes(vertexId)) continue;

        if (!faceVertexMap.has(faceId)) {
          faceVertexMap.set(faceId, []);
        }
        faceVertexMap.get(faceId).push(newVertex.id);
      }
    }

    return {
      type: "corner",
      originalVertexId: vertexId,
      newVertexIds,
      selectedEdgeIds,
      faceVertexMap
    };
  }

  bevelJunctionVertex(meshData, info) {
    const { vertexId, selectedEdgeIds, valence } = info;
    if (valence <= 2) return null;

    const vertex = meshData.getVertex(vertexId);
    if (!vertex) return null;

    const p0 = new THREE.Vector3().copy(vertex.position).applyMatrix4(this.editedObject.matrixWorld);
    const newVertexIds = [];
    const faceVertexMap = new Map();
    const selectedEdges = selectedEdgeIds.map(id => meshData.edges.get(id));
    const processedFaceIds = new Set();
    const EPS = 0.001;

    // Check all pairs of selected edges for shared faces
    for (let i = 0; i < selectedEdges.length; i++) {
      for (let j = i + 1; j < selectedEdges.length; j++) {
        const edgeA = selectedEdges[i];
        const edgeB = selectedEdges[j];
        if (!edgeA || !edgeB) continue;

        const sharedFaceIds = [...edgeA.faceIds].filter(fid =>
          edgeB.faceIds.has(fid)
        );

        for (const faceId of sharedFaceIds) {
          if (processedFaceIds.has(faceId)) continue;
          processedFaceIds.add(faceId);

          const vAId =
            edgeA.v1Id === vertexId ? edgeA.v2Id : edgeA.v1Id;
          const vBId =
            edgeB.v1Id === vertexId ? edgeB.v2Id : edgeB.v1Id;

          const vA = meshData.getVertex(vAId);
          const vB = meshData.getVertex(vBId);
          if (!vA || !vB) continue;

          const pA = new THREE.Vector3().copy(vA.position).applyMatrix4(this.editedObject.matrixWorld);
          const pB = new THREE.Vector3().copy(vB.position).applyMatrix4(this.editedObject.matrixWorld);

          const dirA = pA.sub(p0).normalize();
          const dirB = pB.sub(p0).normalize();

          const combined = dirA.clone().add(dirB);

          const dot = THREE.MathUtils.clamp(dirA.dot(dirB), -1, 1);
          const sinHalf = Math.sqrt((1 - dot) * 0.5);
          const scaleFactor = sinHalf > EPS ? 1 / sinHalf : 1;

          const direction = combined.normalize();

          const basePosition = p0.clone();
          const baseLocal = basePosition.clone().applyMatrix4(new THREE.Matrix4().copy(this.editedObject.matrixWorld).invert());
          const newVertex = meshData.addVertex(baseLocal);
          newVertexIds.push(newVertex.id);

          this.bevelMoveData.push({
            vertexId: newVertex.id,
            basePosition,
            direction: direction.clone(),
            scaleFactor
          });

          if (!faceVertexMap.has(faceId)) {
            faceVertexMap.set(faceId, []);
          }
          faceVertexMap.get(faceId).push(newVertex.id);
        }
      }
    }

    // Slide along unselected connected edges
    const connectedEdges = Array.from(vertex.edgeIds).map(edgeId =>
      meshData.edges.get(edgeId)
    );
    const selectedEdgeSet = new Set(selectedEdgeIds);

    for (const connectedEdge of connectedEdges) {
      if (!connectedEdge) continue;
      if (selectedEdgeSet.has(connectedEdge.id)) continue;

      const otherId =
        connectedEdge.v1Id === vertexId
          ? connectedEdge.v2Id
          : connectedEdge.v1Id;

      const otherV = meshData.getVertex(otherId);
      if (!otherV) continue;

      const p1 = new THREE.Vector3().copy(vertex.position).applyMatrix4(this.editedObject.matrixWorld);
      const p2 = new THREE.Vector3().copy(otherV.position).applyMatrix4(this.editedObject.matrixWorld);

      const direction = p2.clone().sub(p1).normalize();

      const basePosition = p1.clone();
      const baseLocal = basePosition.clone().applyMatrix4(new THREE.Matrix4().copy(this.editedObject.matrixWorld).invert());
      const newVertex = meshData.addVertex(baseLocal);
      newVertexIds.push(newVertex.id);

      this.bevelMoveData.push({
        vertexId: newVertex.id,
        basePosition,
        direction: direction.clone(),
        scaleFactor: 1
      });

      // Map to all faces of that edge that include the vertex
      for (const faceId of connectedEdge.faceIds) {
        const face = meshData.faces.get(faceId);
        if (!face) continue;
        if (!face.vertexIds.includes(vertexId)) continue;

        if (!faceVertexMap.has(faceId)) {
          faceVertexMap.set(faceId, []);
        }
        faceVertexMap.get(faceId).push(newVertex.id);
      }
    }

    return {
      type: "junction",
      originalVertexId: vertexId,
      newVertexIds,
      selectedEdgeIds,
      faceVertexMap
    };
  }

  rebuildFaceTopology(meshData, face) {
    // Remove this face from all old edges
    for (const edgeId of face.edgeIds) {
      const edge = meshData.edges.get(edgeId);
      if (edge) {
        edge.faceIds.delete(face.id);
      }
    }

    // Remove this face from old vertices
    for (const vertexId of face.vertexIds) {
      const vertex = meshData.getVertex(vertexId);
      if (vertex) {
        vertex.faceIds.delete(face.id);
      }
    }

    // Clear face.edgeIds
    face.edgeIds.clear();

    const vIds = face.vertexIds;
    const len = vIds.length;

    // Rebuild edges from new vertex loop
    for (let i = 0; i < len; i++) {
      const v1 = meshData.getVertex(vIds[i]);
      const v2 = meshData.getVertex(vIds[(i + 1) % len]);

      if (!v1 || !v2) continue;

      let edge = meshData.getEdge(v1.id, v2.id);

      if (!edge) {
        edge = meshData.addEdge(v1, v2);
      }

      face.edgeIds.add(edge.id);
      edge.faceIds.add(face.id);

      v1.faceIds.add(face.id);
      v2.faceIds.add(face.id);
    }
  }

  replaceVertexInFace(meshData, faceId, oldVertexId, newVertexId) {
    const face = meshData.faces.get(faceId);
    if (!face) return false;

    const index = face.vertexIds.indexOf(oldVertexId);
    if (index === -1) return false;

    face.vertexIds[index] = newVertexId;
    return true;
  }

  splitVertexInFace(meshData, faceId, oldVertexId, nvAId, nvBId) {
    const face = meshData.faces.get(faceId);
    if (!face) return false;

    const oldVertex = meshData.getVertex(oldVertexId);
    
    const vIds = face.vertexIds;
    const oldIdx = vIds.indexOf(oldVertexId);
    if (oldIdx === -1) return false;

    const prevV = meshData.getVertex(vIds[(oldIdx - 1 + vIds.length) % vIds.length]);
    
    const dirToPrev = new THREE.Vector3().subVectors(prevV.position, oldVertex.position).normalize();

    const moveA = this.bevelMoveData.find(m => m.vertexId === nvAId);
    const moveB = this.bevelMoveData.find(m => m.vertexId === nvBId);

    if (!moveA || !moveB) {
      console.warn("Could not find bevel move data for new vertices.");
      return false;
    }

    const dotA = dirToPrev.dot(moveA.direction);
    const dotB = dirToPrev.dot(moveB.direction);

    const [firstId, secondId] = (dotA > dotB) ? [nvAId, nvBId] : [nvBId, nvAId];

    const newIds = [...vIds];
    newIds.splice(oldIdx, 1, firstId, secondId);

    face.vertexIds = newIds;
    return true;
  }

  getFacesAdjacentToEdges(meshData, edges) {
    const adjacentFaceIds = new Set();

    for (const edgeId of edges) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      for (const faceId of edge.faceIds) {
        adjacentFaceIds.add(faceId);
      }
    }

    return adjacentFaceIds;
  }

  getFacesAdjacentToEdgeVertices(meshData, edges) {
    const adjacentFaceIds = new Set();

    for (const edgeId of edges) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      const vertexIds = [edge.v1Id, edge.v2Id];

      for (const vId of vertexIds) {
        const vertex = meshData.getVertex(vId);
        if (!vertex) continue;

        for (const faceId of vertex.faceIds) {
          adjacentFaceIds.add(faceId);
        }
      }
    }

    return adjacentFaceIds;
  }

  createBridgeFaces(meshData, edgeGroup, bevelResults) {
    const newFaceIds = [];

    for (const edgeId of edgeGroup) {
      const edge = meshData.edges.get(edgeId);
      if (!edge || edge.faceIds.size !== 2) continue;

      const [sharedFaceId1, sharedFaceId2] = [...edge.faceIds];
      const face1 = meshData.faces.get(sharedFaceId1);
      const face2 = meshData.faces.get(sharedFaceId2);
      if (!face1 || !face2) continue;

      const v1Result = bevelResults.get(edge.v1Id);
      const v2Result = bevelResults.get(edge.v2Id);
      if (!v1Result || !v2Result) continue;

      // For each vertex, pick the new vertex associated with face1 and face2
      const nv1Face1 = v1Result.faceVertexMap.get(sharedFaceId1)?.[0];
      const nv1Face2 = v1Result.faceVertexMap.get(sharedFaceId2)?.[0];
      const nv2Face1 = v2Result.faceVertexMap.get(sharedFaceId1)?.[0];
      const nv2Face2 = v2Result.faceVertexMap.get(sharedFaceId2)?.[0];

      if (!nv1Face1 || !nv1Face2 || !nv2Face1 || !nv2Face2) continue;

      // Determine direction of edge in face1 loop
      const loop = face1.vertexIds
      const i1 = loop.indexOf(nv1Face1);
      const i2 = loop.indexOf(nv2Face1);
      if (i1 === -1 || i2 === -1) continue;
      const len = loop.length;
      const isForward = (i1 + 1) % len === i2;

      let quadIds;
      if (isForward) {
        quadIds = [nv2Face1, nv1Face1, nv1Face2, nv2Face2];
      } else {
        quadIds = [nv1Face1, nv2Face1, nv2Face2, nv1Face2];
      }

      const vertices = quadIds.map(id => meshData.getVertex(id));
      const newFace = meshData.addFace(vertices);
      this.rebuildFaceTopology(meshData, newFace);

      newFaceIds.push(newFace.id);
    }

    return newFaceIds;
  }

  fillBevelCornerFaces(meshData, bevelResults) {
    const newFaceIds = [];

    for (const [vertexId, result] of bevelResults.entries()) {
      const { newVertexIds } = result;
      if (!newVertexIds || newVertexIds.length < 3) continue;

      const { orderedVertexIds, orderedEdgeIds } = this.buildOrderedVertexLoop(meshData, newVertexIds);

      if (orderedVertexIds.length < 3) continue;

      // winding order check
      const normal = calculateVertexIdsNormal(meshData, orderedVertexIds);
      const neighbors = getNeighborFaces(meshData, orderedEdgeIds);
      const shouldFlip = shouldFlipNormal(meshData, orderedVertexIds, normal, neighbors);
      if (shouldFlip) {
        orderedVertexIds.reverse();
      }

      // create face
      const vertices = orderedVertexIds.map(id => meshData.getVertex(id));
      const newFace = meshData.addFace(vertices);
      this.rebuildFaceTopology(meshData, newFace);

      newFaceIds.push(newFace.id);
    }

    return newFaceIds;
  }

  deleteOldEdgeVertices(meshData, edgeGroup) {
    const vertexIdsToDelete = new Set();

    for (const edgeId of edgeGroup) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      vertexIdsToDelete.add(edge.v1Id);
      vertexIdsToDelete.add(edge.v2Id);
    }

    for (const vertexId of vertexIdsToDelete) {
      const vertex = meshData.getVertex(vertexId);
      if (!vertex) continue;

      meshData.deleteVertex(vertex);
    }
  }

  getAllBevelNewVertexIds(bevelResults) {
    const allNewVertexIds = new Set();

    for (const result of bevelResults.values()) {
      if (!result.newVertexIds) continue;

      for (const id of result.newVertexIds) {
        allNewVertexIds.add(id);
      }
    }

    return Array.from(allNewVertexIds);
  }

  buildOrderedVertexLoop(meshData, newVertexIds) {
    if (!newVertexIds || newVertexIds.length === 0) {
      return { orderedVertexIds: [], edgeIds: [] };
    }

    // Build adjacency map from edges to walk the loop
    const newVertexSet = new Set(newVertexIds);
    const adjacency = new Map();
    
    for (const vId of newVertexIds) {
      const vertex = meshData.getVertex(vId);
      adjacency.set(vId, []);
      for (const edgeId of vertex.edgeIds) {
        const edge = meshData.edges.get(edgeId);
        const otherId =
          edge.v1Id === vId ? edge.v2Id :
          edge.v2Id === vId ? edge.v1Id : null;

        if (newVertexSet.has(otherId)) adjacency.get(vId).push(otherId);
      }
    }

    // Walk the loop
    const orderedVertexIds = [];
    const orderedEdgeIds = [];
    const visited = new Set();

    let current = newVertexIds[0];
    let prev = null;

    while (current && !visited.has(current)) {
      orderedVertexIds.push(current);
      visited.add(current);

      const neighbors = adjacency.get(current) || [];
      const next = neighbors.find(n => n !== prev);
      
      if (next) {
        const edge = meshData.getEdge(current, next);
        if (edge) orderedEdgeIds.push(edge.id);
      }
      
      prev = current;
      current = next;
    }

    return {
      orderedVertexIds,
      orderedEdgeIds
    };
  }

  getEdgeIdsFromFaces(meshData, faceIds) {
    const edgeIds = new Set();

    for (const faceId of faceIds) {
      const face = meshData.faces.get(faceId);
      if (!face) continue;

      for (const edgeId of face.edgeIds) {
        edgeIds.add(edgeId);
      }
    }

    return Array.from(edgeIds);
  }

  updateSelectionAfterBevel() {
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
}