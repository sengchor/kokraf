import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { calculateFaceNormal, getCentroidFromVertices, calculateVertexNormal } from '../utils/AlignedNormalUtils.js';
import { TransformCommandSolver } from './TransformCommandSolver.js';
import { BevelCommand } from '../commands/BevelCommand.js';
import { ToolNumericInput } from './ToolNumericInput.js';

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
    this.segments = 1;

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
      setter: (v) => this.applyBevelWidth(v),
      unit: 'm'
    });

    this.setupTransformListeners();
    this.setupListeners();

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);
    this._onMouseWheel = this.onMouseWheel.bind(this);
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
    this.renderer.domElement.addEventListener('wheel', this._onMouseWheel, { passive: false, capture: true });
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
        this.signals.onToolEnded.dispatch();
      });
    });
  }

  // Command Control
  onPointerMove() {
    if (this.activeTransformSource !== 'command' || this.toolNumericInput.active) return;
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
    this.toolNumericInput.reset();
  }

  onMouseWheel(event) {
    if (!this.activeTransformSource) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.deltaY < 0) this.segments++;
    else this.segments--;

    this.segments = Math.max(1, this.segments);

    this.vertexEditor.transform.applyMeshData(this.beforeMeshData);

    this.newVertexIds = [];
    this.newEdgeIds = [];
    this.newFaceIds = [];
    this.cornerPatches = [];
    this.bevelMoveData = new Map();
    this.segmentMoveData = new Map();
    this.segmentEdgeMap = new Map();

    this.startPivotPosition = this.handle.getWorldPosition(new THREE.Vector3());

    this.startBevel();
    this.editSelection.selectFaces(this.newFaceIds);
    this.handle.position.copy(this.startPivotPosition);

    this.applyBevelWidth(this.width);
  }

  onKeyDown(event) {
    if (this.activeTransformSource !== 'command') return;

    if (this.toolNumericInput.handleKey(event, this.mode)) {
      return;
    }

    if (event.key === 'Escape') {
      this.cancelBevelSession();
      this.clearCommandTransformState();
      this.toolNumericInput.reset();
    }

    if (event.key === 'Enter') {
      this.commitBevelSession();
      this.clearCommandTransformState();
      this.toolNumericInput.reset();
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
    this.cornerPatches = [];
    this.bevelMoveData = new Map();
    this.segmentMoveData = new Map();
    this.segmentEdgeMap = new Map();

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

    this.signals.onToolStarted.dispatch(this.toolNumericInput.getDisplayText());
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

    this.signals.onToolUpdated.dispatch(this.toolNumericInput.getDisplayText());
  }

  commitBevelSession() {
    if (!this.width || this.width === 0) {
      this.cancelBevelSession();
      this.clearCommandTransformState();
      this.toolNumericInput.reset();
    }

    this.vertexEditor.setObject(this.editedObject);
    this.vertexEditor.transform.updateGeometryAndHelpers();

    if (this.selectedEdgeIds.length <= 0) {
      this.editSelection.clearSelection();
      this.disable();
      return;
    }

    const meshData = this.editedObject.userData.meshData;
    this.afterMeshData = structuredClone(meshData);
    this.editor.execute(new BevelCommand(this.editor, this.editedObject, this.beforeMeshData, this.afterMeshData));

    this.updateSelectionAfterBevel();
    this.clearStartData();
  }

  cancelBevelSession() {
    this.editedObject = this.editSelection.editedObject;
    if (!this.editedObject) return;

    this.vertexEditor.setObject(this.editedObject);
    this.vertexEditor.transform.applyMeshData(this.beforeMeshData);
    this.vertexEditor.transform.updateGeometryAndHelpers();

    this.handle.position.copy(this.startPivotPosition);
    this.handle.updateMatrixWorld(true);

    this.editSelection.selectEdges(this.selectedEdgeIds);
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

  clearStartData() {
    this.startPivotPosition = null;

    this.newVertexIds = null;
    this.newEdgeIds = null;
    this.newFaceIds = null;
    this.bevelMoveData = null;
    this.segmentMoveData = null;
    this.segmentEdgeMap = null;
    this.startScreen = null;
    this.width = null;

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
      const vertexNeighborFaceIds = this.getFacesAdjacentToEdgeVertices(meshData, edgeGroup);

      const vertexGraph = this.buildSelectedVertexGraph(meshData, edgeGroup);
      const bevelResults = new Map();

      let result = null;
      for (const [vId, vertexInfo] of vertexGraph) {
        if (vertexInfo.valence === 1) {
          result = this.bevelEndVertex(meshData, vertexInfo);
        }
        else if (vertexInfo.valence === 2) {
          result = this.bevelCornerVertex(meshData, vertexInfo);
        }
        else {
          result = this.bevelJunctionVertex(meshData, vertexInfo);
        }
        if (result) bevelResults.set(vId, result);
      }

      const splitedFaces = this.applyBevelFaceSubstitutions(meshData, bevelResults);
      const bridgeFaceIds = this.createBridgeFaces(meshData, edgeGroup, bevelResults);

      this.insertFaceSegments(meshData, splitedFaces);

      for (const faceId of vertexNeighborFaceIds) {
        const face = meshData.faces.get(faceId);
        if (!face) continue;

        this.rebuildFaceTopology(meshData, face);
      }

      const fillFaceIds = this.fillBevelCornerFaces(meshData, bevelResults);

      this.deleteOldEdgeVertices(meshData, edgeGroup);

      const groupFaceIds = [...bridgeFaceIds, ...fillFaceIds];
      const groupEdgeIds = this.getEdgeIdsFromFaces(meshData, groupFaceIds);
      const groupVertexIds = this.getVertexIdsFromFaces(meshData, groupFaceIds);

      this.newVertexIds.push(...groupVertexIds);
      this.newEdgeIds.push(...groupEdgeIds);
      this.newFaceIds.push(...groupFaceIds);

      this.solveBevelScales(meshData, vertexGraph);
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
    this.width = this.pixelsToWorldUnits(pixelDistance, this.camera, depth, this.renderer);
    this.applyBevelWidth(this.width);
  }

  solveBevelScales() {
    const MITER_LIMIT = 5.0;
    const EPS = 1e-6;

    // Pre-calculate Efficiency for each constrained edge
    for (const moveData of this.bevelMoveData.values()) {
      moveData.efficiencies = new Map();
      const edgeIds = Array.from(moveData.edgeScaleConstraints.keys());

      edgeIds.forEach((edgeId, index) => {
        const edgeDir = moveData.edgeDirections[index];
        if (!edgeDir) return;

        const sinTheta = new THREE.Vector3().crossVectors(moveData.direction, edgeDir).length();
        
        if (Math.abs(sinTheta) < EPS) {
          moveData.efficiencies.set(edgeId, 1);
        } else {
          moveData.efficiencies.set(edgeId, Math.max(sinTheta, 1 / MITER_LIMIT));
        }
      });

      const localScales = Array.from(moveData.efficiencies.values()).map(eff => 1 / eff);
      moveData.scaleFactor = localScales.reduce((a, b) => a + b, 0) / localScales.length;
    }

    // Global Harmonization
    const iterations = 1000; 
    for (let i = 0; i < iterations; i++) {
      const nextScales = new Map();

      for (const [vertexId, moveData] of this.bevelMoveData) {
        let accumulatedScale = moveData.scaleFactor;
        let weightSum = 1;

        for (const neighborId of moveData.neighborNewVertexIds) {
          const neighborData = this.bevelMoveData.get(neighborId);
          if (!neighborData) continue;

          // Find shared beveled edges
          for (const edgeId of moveData.efficiencies.keys()) {
            if (!neighborData.efficiencies.has(edgeId)) continue;

            const myEff = moveData.efficiencies.get(edgeId);
            const neighborEff = neighborData.efficiencies.get(edgeId);
            
            const idealScale = neighborData.scaleFactor * (neighborEff / myEff);
            
            accumulatedScale += idealScale;
            weightSum++;
          }
        }

        nextScales.set(vertexId, accumulatedScale / weightSum);
      }

      for (const [vertexId, newScale] of nextScales) {
        const moveData = this.bevelMoveData.get(vertexId);
        moveData.scaleFactor = Math.min(newScale, MITER_LIMIT);
      }
    }
  }

  applyBevelFaceSubstitutions(meshData, bevelResults) {
    const pendingFaceUpdates = new Map();
    const splitedFaces = new Set();
    for (const [originalVertexId, result] of bevelResults) {
      const { faceVertexMap, edgeVertexMap } = result;

      for (const [faceId, newVertexIds] of faceVertexMap) {
        if (!pendingFaceUpdates.has(faceId)) {
          pendingFaceUpdates.set(faceId, new Map());
        }

        let orderedSplit;
        if (newVertexIds.length >= 2) {
          orderedSplit = this.getOrderedSplit(meshData, faceId, originalVertexId, edgeVertexMap);

          splitedFaces.add(faceId);
        }
        else {
          orderedSplit = [newVertexIds[0]];
        }

        pendingFaceUpdates.get(faceId).set(originalVertexId, orderedSplit);
      }
    }

    for (const [faceId, substitutions] of pendingFaceUpdates) {
      const face = meshData.faces.get(faceId);
      const finalVertexIds = [];

      for (const oldVId of face.vertexIds) {
        if (substitutions.has(oldVId)) {
          finalVertexIds.push(...substitutions.get(oldVId));
        } else {
          finalVertexIds.push(oldVId);
        }
      }

      face.vertexIds = finalVertexIds;
    }

    return splitedFaces;
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
          if (!connectedEdges) continue;

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

  buildSelectedVertexGraph(meshData, selectedEdges) {
    const vertexToEdges = new Map();
    const selectedVertices = new Set();

    for (const edgeId of selectedEdges) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      for (const vId of [edge.v1Id, edge.v2Id]) {
        selectedVertices.add(vId);

        if (!vertexToEdges.has(vId)) {
          vertexToEdges.set(vId, new Set());
        }

        vertexToEdges.get(vId).add(edgeId);
      }
    }

    const vertexInfo = new Map();

    for (const vId of selectedVertices) {
      const connectedEdges = vertexToEdges.get(vId) || new Set();

      vertexInfo.set(vId, {
        vertexId: vId,
        valence: connectedEdges.size,
        selectedEdgeIds: [...connectedEdges]
      });
    }

    return vertexInfo;
  }

  // End Vertex (1 selected edge)
  bevelEndVertex(meshData, info) {
    const { vertexId, selectedEdgeIds, valence } = info;
    if (valence !== 1) return null;

    const vertex = meshData.getVertex(vertexId);
    if (!vertex) return null;

    const selectedEdgeId = selectedEdgeIds[0];
    const edge = meshData.edges.get(selectedEdgeId);
    if (!edge) return null;

    const otherVertexId = edge.v1Id === vertexId ? edge.v2Id : edge.v1Id;
    const otherEdgeV = meshData.getVertex(otherVertexId);

    const vPos = new THREE.Vector3().copy(vertex.position).applyMatrix4(this.editedObject.matrixWorld);
    const oPos = new THREE.Vector3().copy(otherEdgeV.position).applyMatrix4(this.editedObject.matrixWorld);

    const edgeDirection = new THREE.Vector3().subVectors(oPos, vPos).normalize();

    const connectedEdges = Array.from(vertex.edgeIds)
      .filter(edgeId => edgeId !== selectedEdgeId)
      .map(edgeId => meshData.edges.get(edgeId));

    const newVertexIds = [];
    const faceVertexMap = new Map();
    const edgeVertexMap = new Map();
    for (const connectedEdge of connectedEdges) {
      const otherId = connectedEdge.v1Id === vertexId ? connectedEdge.v2Id : connectedEdge.v1Id;
      const otherV = meshData.getVertex(otherId);

      const p1 = new THREE.Vector3().copy(vertex.position).applyMatrix4(this.editedObject.matrixWorld);
      const p2 = new THREE.Vector3().copy(otherV.position).applyMatrix4(this.editedObject.matrixWorld);

      const basePosition = p1.clone();
      let direction = p2.clone().sub(p1).normalize();

      const baseLocal = basePosition.clone().applyMatrix4(new THREE.Matrix4().copy(this.editedObject.matrixWorld).invert());
      const newVertex = meshData.addVertex(baseLocal);
      newVertexIds.push(newVertex.id);

      if (Math.abs(direction.dot(edgeDirection)) === 1) {
        const sharedFaceIds = [...connectedEdge.faceIds].filter(fid =>
          edge.faceIds.has(fid)
        );

        if (sharedFaceIds.length > 0) {
          const face = meshData.faces.get(sharedFaceIds[0]);
          const faceNormal = calculateFaceNormal(meshData, face);

          direction = new THREE.Vector3().crossVectors(faceNormal, direction).normalize();

          const centroid = getCentroidFromVertices(face.vertexIds, meshData).applyMatrix4(this.editedObject.matrixWorld);
          const inwardGuide = new THREE.Vector3().subVectors(centroid, p1);
          if (direction.dot(inwardGuide) < 0) {
            direction.negate();
          }
        }
      }

      const scale = this.calculateScaleFactor(direction, edgeDirection);
      const edgeScaleConstraints = new Map();
      edgeScaleConstraints.set(selectedEdgeId, scale);

      this.bevelMoveData.set(newVertex.id, {
        originalVertexId: vertexId,
        vertexId: newVertex.id,
        basePosition,
        direction: direction.clone(),
        scaleFactor: 1,
        edgeScaleConstraints,
        neighborNewVertexIds: [],
        edgeDirections: [edgeDirection],
        valence
      });

      for (const faceId of connectedEdge.faceIds) {
        const face = meshData.faces.get(faceId);
        if (!face) continue;
        if (!face.vertexIds.includes(vertexId)) continue;

        if (!faceVertexMap.has(faceId)) {
          faceVertexMap.set(faceId, []);
        }

        const vertices = faceVertexMap.get(faceId);
        if (!vertices.includes(newVertex.id)) {
          vertices.push(newVertex.id);
        }
      }

      edgeVertexMap.set(connectedEdge.id, newVertex.id);
    }

    return {
      valence,
      originalVertexId: vertexId,
      newVertexIds,
      selectedEdgeId,
      faceVertexMap,
      edgeVertexMap
    };
  }

  // Corner Vertex (2 selected edges)
  bevelCornerVertex(meshData, info) {
    const { vertexId, selectedEdgeIds, valence } = info;
    if (valence !== 2) return null;

    const vertex = meshData.getVertex(vertexId);
    if (!vertex) return null;

    const [edgeId1, edgeId2] = selectedEdgeIds;
    const edge1 = meshData.edges.get(edgeId1);
    const edge2 = meshData.edges.get(edgeId2);
    if (!edge1 || !edge2) return null;

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

    const faceNormal = new THREE.Vector3().crossVectors(dir1, dir2).normalize();

    const newVertexIds = [];
    const faceVertexMap = new Map();
    const edgeVertexMap = new Map();

    // Faces shared by BOTH selected edges
    const sharedFaceIds = [...edge1.faceIds].filter(fid =>
      edge2.faceIds.has(fid)
    );

    const connectedEdges = Array.from(vertex.edgeIds)
      .filter(edgeId => edgeId !== edgeId1 && edgeId !== edgeId2)
      .map(edgeId => meshData.edges.get(edgeId));

    if (sharedFaceIds.length > 0) {
      let bisector = dir1.clone().add(dir2).normalize();

      for (const faceId of sharedFaceIds) {
        const basePosition = p0.clone();
        const baseLocal = basePosition.clone().applyMatrix4(new THREE.Matrix4().copy(this.editedObject.matrixWorld).invert());
        const newVertex = meshData.addVertex(baseLocal);
        newVertexIds.push(newVertex.id);

        const face = meshData.faces.get(faceId);
        const EPS = 1e-8;
        if ((dir1.clone().add(dir2)).lengthSq() < EPS) {
          const faceNormal = calculateFaceNormal(meshData, face);
          bisector = new THREE.Vector3().crossVectors(faceNormal, dir1).normalize();
        }

        const centroid = getCentroidFromVertices(face.vertexIds, meshData).applyMatrix4(this.editedObject.matrixWorld);
        const inwardGuide = new THREE.Vector3().subVectors(centroid, p0);
        if (bisector.dot(inwardGuide) < 0) {
          bisector.negate();
        }

        const scale1 = this.calculateScaleFactor(bisector, dir1);
        const scale2 = this.calculateScaleFactor(bisector, dir2);
        const edgeScaleConstraints = new Map();
        edgeScaleConstraints.set(edgeId1, scale1);
        edgeScaleConstraints.set(edgeId2, scale2);

        this.bevelMoveData.set(newVertex.id, {
          originalVertexId: vertexId,
          vertexId: newVertex.id,
          basePosition,
          direction: bisector.clone(),
          scaleFactor: 1,
          edgeScaleConstraints,
          neighborNewVertexIds: [],
          edgeDirections: [dir1, dir2],
          valence
        });

        if (!faceVertexMap.has(faceId)) {
          faceVertexMap.set(faceId, []);
        }
        faceVertexMap.get(faceId).push(newVertex.id);
      }
    }

    const edgeGroups = this.groupEdgesBySharedFace(connectedEdges);

    // Slide along unselected connected edges
    for (const group of edgeGroups) {
      const bestEdgeId = this.selectMostAlignedEdge(meshData, group, faceNormal);
      const bestEdge = meshData.edges.get(bestEdgeId);

      const otherId = bestEdge.v1Id === vertexId ? bestEdge.v2Id : bestEdge.v1Id;
      const otherV = meshData.getVertex(otherId);

      const p1 = new THREE.Vector3().copy(vertex.position).applyMatrix4(this.editedObject.matrixWorld);
      const p2 = new THREE.Vector3().copy(otherV.position).applyMatrix4(this.editedObject.matrixWorld);

      const basePosition = p1.clone();
      let direction = p2.clone().sub(p1).normalize();
      const bisector = dir1.clone().add(dir2).normalize();
      const alignedBisector = this.computeAlignedBisector(meshData, vertexId, group, bisector);
      if (alignedBisector) {
        direction = alignedBisector;
      }

      const baseLocal = basePosition.clone().applyMatrix4(new THREE.Matrix4().copy(this.editedObject.matrixWorld).invert());
      const newVertex = meshData.addVertex(baseLocal);
      newVertexIds.push(newVertex.id);

      const scale1 = this.calculateScaleFactor(direction, dir1);
      const scale2 = this.calculateScaleFactor(direction, dir2);
      const edgeScaleConstraints = new Map();
      edgeScaleConstraints.set(edgeId1, scale1);
      edgeScaleConstraints.set(edgeId2, scale2);

      this.bevelMoveData.set(newVertex.id, {
        originalVertexId: vertexId,
        vertexId: newVertex.id,
        basePosition,
        direction: direction.clone(),
        scaleFactor: 1,
        edgeScaleConstraints,
        neighborNewVertexIds: [],
        edgeDirections: [dir1, dir2],
        valence
      });

      // Map to all faces of that edge that include the vertex
      for (const edgeId of group) {
        const edge = meshData.edges.get(edgeId);
        for (const faceId of edge.faceIds) {
          const face = meshData.faces.get(faceId);
          if (!face) continue;
          if (!face.vertexIds.includes(vertexId)) continue;

          if (!faceVertexMap.has(faceId)) {
            faceVertexMap.set(faceId, []);
          }

          const vertices = faceVertexMap.get(faceId);
          if (!vertices.includes(newVertex.id)) {
            vertices.push(newVertex.id);
          }
        }
      }

      edgeVertexMap.set(bestEdge.id, newVertex.id);
    }

    return {
      valence,
      originalVertexId: vertexId,
      newVertexIds,
      selectedEdgeIds,
      faceVertexMap,
      edgeVertexMap
    };
  }

  // Junction Vertex (3+ selected edges)
  bevelJunctionVertex(meshData, info) {
    const { vertexId, selectedEdgeIds, valence } = info;
    if (valence <= 2) return null;

    const vertex = meshData.getVertex(vertexId);
    if (!vertex) return null;

    const p0 = new THREE.Vector3().copy(vertex.position).applyMatrix4(this.editedObject.matrixWorld);

    const newVertexIds = [];
    const faceVertexMap = new Map();
    const edgeVertexMap = new Map();
    const selectedEdges = selectedEdgeIds.map(id => meshData.edges.get(id));
    const processedFaceIds = new Set();

    const connectedEdges = Array.from(vertex.edgeIds)
      .filter(edgeId => !selectedEdgeIds.includes(edgeId))
      .map(edgeId => meshData.edges.get(edgeId));

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

          let direction = dirA.clone().add(dirB).normalize();

          const basePosition = p0.clone();
          const baseLocal = basePosition.clone().applyMatrix4(new THREE.Matrix4().copy(this.editedObject.matrixWorld).invert());
          const newVertex = meshData.addVertex(baseLocal);
          newVertexIds.push(newVertex.id);

          const EPS = 1e-8;
          if (dirA.clone().add(dirB).lengthSq() < EPS) {
            const face = meshData.faces.get(faceId);
            const faceNormal = calculateFaceNormal(meshData, face);

            direction = new THREE.Vector3().crossVectors(faceNormal, dirA).normalize();

            const centroid = getCentroidFromVertices(face.vertexIds, meshData).applyMatrix4(this.editedObject.matrixWorld);
            const inwardGuide = new THREE.Vector3().subVectors(centroid, p0);
            if (direction.dot(inwardGuide) < 0) {
              direction.negate();
            }
          }

          const scale1 = this.calculateScaleFactor(direction, dirA);
          const scale2 = this.calculateScaleFactor(direction, dirB);
          const edgeScaleConstraints = new Map();
          edgeScaleConstraints.set(edgeA.id, scale1);
          edgeScaleConstraints.set(edgeB.id, scale2);

          this.bevelMoveData.set(newVertex.id, {
            originalVertexId: vertexId,
            vertexId: newVertex.id,
            basePosition,
            direction: direction.clone(),
            scaleFactor: 1,
            edgeScaleConstraints,
            neighborNewVertexIds: [],
            edgeDirections: [dirA, dirB],
            valence
          });

          if (!faceVertexMap.has(faceId)) {
            faceVertexMap.set(faceId, []);
          }
          faceVertexMap.get(faceId).push(newVertex.id);
        }
      }
    }

    const vertexNormal = calculateVertexNormal(meshData, vertexId);
    const edgeGroups = this.groupEdgesBySharedFace(connectedEdges);

    // Slide along unselected connected edges
     for (const group of edgeGroups) {
      const bestEdgeId = this.selectMostAlignedEdge(meshData, group, vertexNormal);
      const bestEdge = meshData.edges.get(bestEdgeId);

      const otherId = bestEdge.v1Id === vertexId ? bestEdge.v2Id : bestEdge.v1Id;
      const otherV = meshData.getVertex(otherId);

      const p1 = new THREE.Vector3().copy(vertex.position).applyMatrix4(this.editedObject.matrixWorld);
      const p2 = new THREE.Vector3().copy(otherV.position).applyMatrix4(this.editedObject.matrixWorld);

      let direction = p2.clone().sub(p1).normalize();
      const connectedSelectedEdges = this.findConnectedEdgesWithGroupEdges(meshData, group, selectedEdgeIds);
      const bisector = this.calculateAverageGroupDirection(meshData, connectedSelectedEdges, vertexId);

      const alignedBisector = this.computeAlignedBisector(meshData, vertexId, group, bisector);
      if (alignedBisector) {
        direction = alignedBisector;
      }

      const basePosition = p1.clone();
      const baseLocal = basePosition.clone().applyMatrix4(new THREE.Matrix4().copy(this.editedObject.matrixWorld).invert());
      const newVertex = meshData.addVertex(baseLocal);
      newVertexIds.push(newVertex.id);

      const edgeScaleConstraints = new Map();
      const edgeDirections = [];
      for (const selEdge of selectedEdges) {
        const otherSelId = selEdge.v1Id === vertexId ? selEdge.v2Id : selEdge.v1Id;

        const otherSelV = meshData.getVertex(otherSelId);
        if (!otherSelV) continue;

        const pSel = new THREE.Vector3().copy(otherSelV.position).applyMatrix4(this.editedObject.matrixWorld);

        const dirSel = pSel.sub(p0).normalize();
        edgeDirections.push(dirSel);

        edgeScaleConstraints.set(selEdge.id, this.calculateScaleFactor(direction, dirSel));
      }

      this.bevelMoveData.set(newVertex.id, {
        originalVertexId: vertexId,
        vertexId: newVertex.id,
        basePosition,
        direction: direction.clone(),
        scaleFactor: 1,
        edgeScaleConstraints,
        neighborNewVertexIds: [],
        edgeDirections,
        valence
      });

      // Map to all faces of that edge that include the vertex
      for (const edgeId of group) {
        const edge = meshData.edges.get(edgeId);
        for (const faceId of edge.faceIds) {
          const face = meshData.faces.get(faceId);
          if (!face) continue;
          if (!face.vertexIds.includes(vertexId)) continue;

          if (!faceVertexMap.has(faceId)) {
            faceVertexMap.set(faceId, []);
          }

          const vertices = faceVertexMap.get(faceId);
          if (!vertices.includes(newVertex.id)) {
            vertices.push(newVertex.id);
          }
        }
      }

      edgeVertexMap.set(bestEdge.id, newVertex.id);
    }

    return {
      valence,
      originalVertexId: vertexId,
      newVertexIds,
      selectedEdgeIds,
      faceVertexMap,
      edgeVertexMap
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

  getOrderedSplit(meshData, faceId, oldVertexId, edgeVertexMap) {
    const face = meshData.faces.get(faceId);
    const vIds = face.vertexIds;
    const oldIdx = vIds.indexOf(oldVertexId);

    const prevVId = vIds[(oldIdx - 1 + vIds.length) % vIds.length];
    const nextVId = vIds[(oldIdx + 1) % vIds.length];

    const oldVertex = meshData.getVertex(oldVertexId);
    let edgeInId, edgeOutId;

    for (const eId of oldVertex.edgeIds) {
      const edge = meshData.edges.get(eId);
      if (edge.v1Id === prevVId || edge.v2Id === prevVId) edgeInId = eId;
      if (edge.v1Id === nextVId || edge.v2Id === nextVId) edgeOutId = eId;
    }

    return [edgeVertexMap.get(edgeInId), edgeVertexMap.get(edgeOutId)];
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

      const bridgeCorners = { nv1Face1, nv1Face2, nv2Face1, nv2Face2 };
      const { chain1, chain2 } = this.buildSegmentChains(meshData, bridgeCorners, edge);

      // Determine direction of edge in face1 loop
      const loop = face1.vertexIds
      const i1 = loop.indexOf(nv1Face1);
      const i2 = loop.indexOf(nv2Face1);
      if (i1 === -1 || i2 === -1) continue;
      const len = loop.length;
      const isForward = (i1 + 1) % len === i2;

      for (let i = 0; i < chain1.length - 1; i++) {
        let quadIds
        if (isForward) {
          quadIds = [chain2[i], chain1[i], chain1[i + 1], chain2[i + 1]];
        } else {
          quadIds = [chain1[i], chain2[i], chain2[i + 1], chain1[i + 1]];
        }

        const vertices = quadIds.map(id => meshData.getVertex(id));
        const newFace = meshData.addFace(vertices);
        this.rebuildFaceTopology(meshData, newFace);

        newFaceIds.push(newFace.id);
      }

      this.linkVertexNeighbors(nv1Face1, nv2Face1);
      this.linkVertexNeighbors(nv1Face2, nv2Face2);
    }

    return newFaceIds;
  }

  fillBevelCornerFaces(meshData, bevelResults) {
    const newFaceIds = [];

    for (const [vertexId, result] of bevelResults.entries()) {
      const { valence, newVertexIds } = result;
      if (!newVertexIds || newVertexIds.length < 3) continue;

      const orderedVertexIds = this.buildOrderedVertexLoop(meshData, newVertexIds);
      if (orderedVertexIds.length < 3) continue;

      const referenceNormal = calculateVertexNormal(meshData, vertexId);
      const virtualNormal = this.calculateVirtualNormalFromDirections(orderedVertexIds);

      if (virtualNormal.dot(referenceNormal) < 0) {
        orderedVertexIds.reverse();
      }

      const vertex = meshData.getVertex(vertexId);
      const targetPosition = new THREE.Vector3().copy(vertex.position);

      if (orderedVertexIds.length === 3 && valence === 1) {
        const edgeChains = this.insertSegmentChainsPerEdge(orderedVertexIds);
        const faceIds = this.triangulateEdgesCorner(meshData, edgeChains);
        newFaceIds.push(...faceIds);
        continue;
      } else if (orderedVertexIds.length > 3 && valence === 1) {
        const { newLoop } = this.insertSegmentsIntoLoop(orderedVertexIds);
        const vertices = newLoop.map(id => meshData.getVertex(id));
        const newFace = meshData.addFace(vertices);
        newFaceIds.push(newFace.id);
        continue;
      }

      const { newOrderVertexIds } = this.insertSegmentsIntoLoop(orderedVertexIds);
      const { vertexOrderPerLayer, newFaces } = this.vertexEditor.subdivide.createInsetSubdivideVertices(newOrderVertexIds, this.segments, targetPosition);

      this.cornerPatches.push({
        vertexOrderPerLayer: vertexOrderPerLayer,
        targetPosition: targetPosition
      });
      
      if (newFaces) {
        const faceIds = newFaces.map(face => face.id);
        newFaceIds.push(...faceIds);
      }
    }

    return newFaceIds;
  }

  calculateVirtualNormalFromDirections(orderedVertexIds) {
    const moveData0 = this.bevelMoveData.get(orderedVertexIds[0]);
    const moveData1 = this.bevelMoveData.get(orderedVertexIds[1]);
    const moveData2 = this.bevelMoveData.get(orderedVertexIds[2]);

    if (!moveData0 || !moveData1 || !moveData2) return new THREE.Vector3(0, 1, 0);

    const v1 = new THREE.Vector3().subVectors(moveData1.direction, moveData0.direction);
    const v2 = new THREE.Vector3().subVectors(moveData2.direction, moveData0.direction);
    
    return new THREE.Vector3().crossVectors(v1, v2).normalize();
  }

  linkVertexNeighbors(a, b) {
    const mA = this.bevelMoveData.get(a);
    const mB = this.bevelMoveData.get(b);
    if (!mA || !mB) return;

    if (!mA.neighborNewVertexIds.includes(b))
      mA.neighborNewVertexIds.push(b);

    if (!mB.neighborNewVertexIds.includes(a))
      mB.neighborNewVertexIds.push(a);
  }

  calculateScaleFactor(dir1, dir2) {
    const EPS = 0.001;
    const dot = THREE.MathUtils.clamp(dir1.dot(dir2), -1, 1);
    const sin = Math.sqrt(1 - dot * dot);
    const scaleFactor = sin > EPS ? 1 / sin : 1;
    return scaleFactor;
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
      const orderedVertexIds = [];
      return orderedVertexIds;
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

        if (!otherId) continue;

        if (newVertexSet.has(otherId)) {
          adjacency.get(vId).push(otherId);
          continue;
        }

        // Check if this is a segment vertex
        const segData = this.segmentMoveData.get(otherId);
        if (!segData) continue;

        const [a, b] = segData.endVertexIds;
        const nextCorner =
          vId === a ? b :
          vId === b ? a : null;
        
        if (nextCorner && newVertexSet.has(nextCorner)) {
          adjacency.get(vId).push(nextCorner);
        }
      }
    }

    // Walk the loop
    const orderedVertexIds = [];
    const visited = new Set();

    let current = newVertexIds[0];
    let prev = null;

    while (current && !visited.has(current)) {
      orderedVertexIds.push(current);
      visited.add(current);

      const neighbors = adjacency.get(current) || [];
      const next = neighbors.find(n => n !== prev);
      
      prev = current;
      current = next;
    }

    return orderedVertexIds;
  }

  getVertexIdsFromFaces(meshData, faceIds) {
    const vertexIds = new Set();

    for (const faceId of faceIds) {
      const face = meshData.faces.get(faceId);
      if (!face) continue;

      for (const vertexId of face.vertexIds) {
        vertexIds.add(vertexId);
      }
    }

    return Array.from(vertexIds);
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

  groupEdgesBySharedFace(edges) {
    const groups = [];
    const visited = new Set();

    // Build adjacency: edgeId → Set of connected edgeIds
    const adjacency = new Map();

    for (const edge of edges) {
      adjacency.set(edge.id, new Set());
    }

    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const e1 = edges[i];
        const e2 = edges[j];

        // Check if they share a face
        const sharesFace = [...e1.faceIds].some(fid =>
          e2.faceIds.has(fid)
        );

        if (sharesFace) {
          adjacency.get(e1.id).add(e2.id);
          adjacency.get(e2.id).add(e1.id);
        }
      }
    }

    for (const edge of edges) {
      if (visited.has(edge.id)) continue;

      const stack = [edge.id];
      const group = [];

      while (stack.length > 0) {
        const currentId = stack.pop();
        if (visited.has(currentId)) continue;

        visited.add(currentId);
        group.push(currentId);

        for (const neighborId of adjacency.get(currentId)) {
          if (!visited.has(neighborId)) {
            stack.push(neighborId);
          }
        }
      }

      groups.push(group);
    }

    return groups;
  }

  selectMostAlignedEdge(meshData, group, normal) {
    let bestEdgeId = null;
    let bestDot = -Infinity;

    for (const edgeId of group) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      const vA = meshData.getVertex(edge.v1Id);
      const vB = meshData.getVertex(edge.v2Id);
      if (!vA || !vB) continue;

      // Compute edge direction in world space
      const posA = new THREE.Vector3(vA.position.x, vA.position.y, vA.position.z);
      const posB = new THREE.Vector3(vB.position.x, vB.position.y, vB.position.z);

      const dir = posB.clone().sub(posA).normalize();

      // Compute dot with normal
      const dot = dir.dot(normal);

      if (Math.abs(dot) > bestDot) {
        bestDot = Math.abs(dot);
        bestEdgeId = edgeId;
      }
    }

    return bestEdgeId;
  }

  computeAlignedBisector(meshData, vertexId, group, bisector) {
    const groupSurfaceNormal = new THREE.Vector3(0, 0, 0);
    const allFaceIds = [];

    for (const edgeId of group) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;
      for (const fid of edge.faceIds) {
        allFaceIds.push(fid);
      }
    }

    // Count occurrences
    const faceCountMap = new Map();
    for (const fid of allFaceIds) {
      faceCountMap.set(fid, (faceCountMap.get(fid) || 0) + 1);
    }

    const sharedFaceIds = [];
    for (const [fid, count] of faceCountMap) {
      if (count >= 2) {
        sharedFaceIds.push(fid);
      }
    }

    let faceCount = 0;
    for (const fid of sharedFaceIds) {
      const face = meshData.faces.get(fid);
      if (face && face.vertexIds.includes(vertexId)) {
        const normal = calculateFaceNormal(meshData, face);
        groupSurfaceNormal.add(normal);
        faceCount++;
      }
    }

    if (faceCount > 0) {
      groupSurfaceNormal.normalize();
    } else {
      return null;
    }

    // This ensures the direction "slides" along the surface
    const direction = bisector.clone().projectOnPlane(groupSurfaceNormal).normalize();

    const avgGroupDir = this.calculateAverageGroupDirection(meshData, group, vertexId);
    if (direction.dot(avgGroupDir) < 0) {
      direction.negate();
    } else {
      return null;
    }

    return direction;
  }

  findConnectedEdgesWithGroupEdges(meshData, group, selectedEdgeIds) {
    const selectedSet = new Set(selectedEdgeIds);
    const connectedSelectedEdgeIds = new Set();

    for (const edgeId of group) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      for (const faceId of edge.faceIds) {
        const face = meshData.faces.get(faceId);
        if (!face) continue;

        for (const fEdgeId of face.edgeIds) {
          if (selectedSet.has(fEdgeId)) {
            connectedSelectedEdgeIds.add(fEdgeId);
          }
        }
      }
    }
    return Array.from(connectedSelectedEdgeIds);
  }

  calculateAverageGroupDirection(meshData, edgeIds, centralVertexId) {
    const centralVertex = meshData.getVertex(centralVertexId);
    if (!centralVertex || edgeIds.length === 0) return new THREE.Vector3();

    const p0 = new THREE.Vector3().copy(centralVertex.position).applyMatrix4(this.editedObject.matrixWorld);
    const groupDirection = new THREE.Vector3(0, 0, 0);

    for (const edgeId of edgeIds) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      const neighborId = edge.v1Id === centralVertexId ? edge.v2Id : edge.v1Id;
      const neighbor = meshData.getVertex(neighborId);
      if (!neighbor) continue;

      const neighborPos = new THREE.Vector3().copy(neighbor.position).applyMatrix4(this.editedObject.matrixWorld);

      const edgeDir = neighborPos.sub(p0).normalize();
      groupDirection.add(edgeDir);
    }

    if (groupDirection.lengthSq() === 0) {
      return groupDirection;
    }

    return groupDirection.divideScalar(edgeIds.length).normalize();
  }

  findExistingSegmentVertex(startId, endId, segmentIndex) {
    for (const segData of this.segmentMoveData.values()) {

      const a = segData.endVertexIds[0];
      const b = segData.endVertexIds[1];

      if (a === startId && b === endId) {
        if (segData.segmentIndex === segmentIndex) {
          return segData.vertexId;
        }
      }

      if (a === endId && b === startId) {
        const reversedIndex = this.segments - segmentIndex;

        if (segData.segmentIndex === reversedIndex) {
          return segData.vertexId;
        }
      }
    }

    return null;
  }

  insertFaceSegments(meshData, splitedFaces) {
    for (const faceId of splitedFaces) {
      const face = meshData.faces.get(faceId);
      if (!face) continue;
      const { newLoop } = this.insertSegmentsIntoLoop(face.vertexIds);

      face.vertexIds = newLoop;
    }
  }

  insertSegmentsIntoLoop(vertexIds) {
    const newLoop = [];
    const newOrderVertexIds = [];
    const len = vertexIds.length;

    for (let i = 0; i < len; i++) {
      const v1 = vertexIds[i];
      const v2 = vertexIds[(i + 1) % len];

      newLoop.push(v1);
      newOrderVertexIds.push(v1);

      const key = this.getEdgeKey(v1, v2);
      const chain = this.segmentEdgeMap.get(key);

      if (!chain) continue;

      const edgeVertices = [];

      if (v1 === chain[0] && v2 === chain[chain.length - 1]) {
        for (let j = 1; j < chain.length - 1; j++) {
          newLoop.push(chain[j]);
          edgeVertices.push(chain[j]);
        }
      } else if (v2 === chain[0] && v1 === chain[chain.length - 1]) {
        for (let j = chain.length - 2; j > 0; j--) {
          newLoop.push(chain[j]);
          edgeVertices.push(chain[j]);
        }
      }

      if (edgeVertices.length > 0) {
        newOrderVertexIds.push(edgeVertices);
      }
    }

    return { newLoop, newOrderVertexIds };
  }

  insertSegmentChainsPerEdge(vertexIds) {
    const edgeChains = [];
    const len = vertexIds.length;

    for (let i = 0; i < len; i++) {
      const v1 = vertexIds[i];
      const v2 = vertexIds[(i + 1) % len];

      const edgeChain = [v1];

      const key = this.getEdgeKey(v1, v2);
      const chain = this.segmentEdgeMap.get(key);

      if (chain) {
        if (v1 === chain[0] && v2 === chain[chain.length - 1]) {
          for (let j = 1; j < chain.length - 1; j++) {
            edgeChain.push(chain[j]);
          }
        } else if (v2 === chain[0] && v1 === chain[chain.length - 1]) {
          for (let j = chain.length - 2; j > 0; j--) {
            edgeChain.push(chain[j]);
          }
        }
      }

      edgeChain.push(v2);
      edgeChains.push(edgeChain);
    }

    return edgeChains;
  }

  buildSegmentChains(meshData, verts, edge) {
    const { nv1Face1, nv1Face2, nv2Face1, nv2Face2 } = verts;

    const edgeVertex1 = meshData.getVertex(edge.v1Id);
    const edgeVertex2 = meshData.getVertex(edge.v2Id);
    const vPos = new THREE.Vector3().copy(edgeVertex1.position);
    const oPos = new THREE.Vector3().copy(edgeVertex2.position);

    const edgeDirection = new THREE.Vector3().subVectors(oPos, vPos).normalize();
    edgeDirection.transformDirection(this.editedObject.matrixWorld);

    const v1a = meshData.getVertex(nv1Face1);
    const v1b = meshData.getVertex(nv1Face2);
    const v2a = meshData.getVertex(nv2Face1);
    const v2b = meshData.getVertex(nv2Face2);

    const chain1 = [nv1Face1];
    const chain2 = [nv2Face1];

    for (let i = 1; i < this.segments; i++) {
      const p1 = v1a.position.clone().lerp(v1b.position, 0.5);
      const p2 = v2a.position.clone().lerp(v2b.position, 0.5);

      let sv1Id = this.findExistingSegmentVertex(v1a.id, v1b.id, i);
      let sv2Id = this.findExistingSegmentVertex(v2a.id, v2b.id, i);

      if (!sv1Id) {
        const sv1 = meshData.addVertex(p1);

        this.segmentMoveData.set(sv1.id, {
          vertexId: sv1.id,
          endVertexIds: [v1a.id, v1b.id],
          segmentIndex: i,
          edgeDirection: edgeDirection.clone()
        });

        sv1Id = sv1.id;
      }

      if (!sv2Id) {
        const sv2 = meshData.addVertex(p2);

        this.segmentMoveData.set(sv2.id, {
          vertexId: sv2.id,
          endVertexIds: [v2a.id, v2b.id],
          segmentIndex: i,
          edgeDirection: edgeDirection.clone().negate()
        });

        sv2Id = sv2.id;
      }

      chain1.push(sv1Id);
      chain2.push(sv2Id);
    }

    chain1.push(nv1Face2);
    chain2.push(nv2Face2);

    const key1 = this.getEdgeKey(nv1Face1, nv1Face2);
    const key2 = this.getEdgeKey(nv2Face1, nv2Face2);

    this.segmentEdgeMap.set(key1, [...chain1]);
    this.segmentEdgeMap.set(key2, [...chain2]);

    return { chain1, chain2 };
  }

  getEdgeKey(a, b) {
    return a < b ? `${a}_${b}` : `${b}_${a}`;
  }

  applyBevelWidth(value) {
    if (!value) { value = 0 };
    this.width = value;
    const meshData = this.editedObject.userData.meshData;

    const newBoundaryVertexIds = [];
    const newBoundaryPositions = [];

    // move boundary bevel vertices
    for (const moveData of this.bevelMoveData.values()) {
      const scale = moveData.scaleFactor;

      const newPosition = moveData.basePosition.clone().add(
        moveData.direction.clone().multiplyScalar(this.width * scale)
      );

      newBoundaryVertexIds.push(moveData.vertexId);
      newBoundaryPositions.push(newPosition);
    }

    this.vertexEditor.transform.setVerticesWorldPositions(newBoundaryVertexIds, newBoundaryPositions);

    const newSegmentVertexIds = [];
    const newSegmentPositions = [];

    // move segment vertices
    for (const segData of this.segmentMoveData.values()) {
      const { vertexId, endVertexIds, segmentIndex, edgeDirection } = segData;

      const startVertex = meshData.getVertex(endVertexIds[0]);
      const endVertex = meshData.getVertex(endVertexIds[1]);

      const startVertexPos = new THREE.Vector3().copy(startVertex.position).applyMatrix4(this.editedObject.matrixWorld);
      const endVertexPos = new THREE.Vector3().copy(endVertex.position).applyMatrix4(this.editedObject.matrixWorld);
      const midVertexPos = startVertexPos.clone().add(endVertexPos).multiplyScalar(0.5);

      const moveData = this.bevelMoveData.get(endVertexIds[0]);
      const basePosition = moveData.basePosition.clone();

      const width = midVertexPos.clone().sub(basePosition).dot(edgeDirection);
      let controlPoint = basePosition.clone();
      if (moveData.valence > 2) {
        controlPoint.add(edgeDirection.clone().multiplyScalar(width));
      }

      const t = segmentIndex / this.segments;
      // Quadratic Bezier Interpolation
      const pos = this.quadraticBezierPoint(startVertexPos, controlPoint, endVertexPos, t)

      newSegmentVertexIds.push(vertexId);
      newSegmentPositions.push(pos);
    }

    this.vertexEditor.transform.setVerticesWorldPositions(newSegmentVertexIds, newSegmentPositions);

    const newCornerVertexIds = [];
    const newCornerPositions = [];

    for (const patch of this.cornerPatches) {
      const result = this.vertexEditor.subdivide.updateInsetSubdivideVertices(patch.vertexOrderPerLayer, this.segments, patch.targetPosition);

      newCornerVertexIds.push(...result.vertexIds);
      newCornerPositions.push(...result.vertexPositions);
    }

    this.vertexEditor.transform.setVerticesWorldPositions(newCornerVertexIds, newCornerPositions);
  }

  triangulateEdgesCorner(meshData, edgeChains) {
    const newFaceIds = [];

    // Flatten the chains into a single ordered loop without duplicates
    const loop = [];
    for (const chain of edgeChains) {
      for (let i = 0; i < chain.length - 1; i++) {
        loop.push(chain[i]);
      }
    }

    // Find the origin vertex (shared by two non-segmented edges)
    let originIndex = 0;
    const numChains = edgeChains.length;

    for (let i = 0; i < numChains; i++) {
      const currentChain = edgeChains[i];
      const nextChain = edgeChains[(i + 1) % numChains];

      if (currentChain.length === 2 && nextChain.length === 2) {
        const originId = currentChain[1];
        originIndex = loop.indexOf(originId);
        break; 
      }
    }

    // Rotate the array so the origin vertex is at the very beginning (index 0)
    const rotatedLoop = [
      ...loop.slice(originIndex),
      ...loop.slice(0, originIndex)
    ];

    // Generate the triangle fan
    const originId = rotatedLoop[0];
    
    for (let i = 1; i < rotatedLoop.length - 1; i++) {
      const v1Id = rotatedLoop[i];
      const v2Id = rotatedLoop[i + 1];

      const vertices = [originId, v1Id, v2Id].map(id => meshData.getVertex(id));
      const newFace = meshData.addFace(vertices);

      if (newFace) {
        this.rebuildFaceTopology(meshData, newFace);
        newFaceIds.push(newFace.id);
      }
    }

    return newFaceIds;
  }

  quadraticBezierPoint(v0, v1, v2, t) {
    const invT = 1 - t;

    const point = v0.clone().multiplyScalar(invT * invT)
      .addScaledVector(v1, 2 * invT * t)
      .addScaledVector(v2, t * t);

    return point;
  }
}