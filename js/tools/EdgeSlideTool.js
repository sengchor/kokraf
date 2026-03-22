import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { TransformCommandSolver } from './TransformCommandSolver.js';
import { EdgeSlideCommand } from '../commands/EdgeSlideCommand.js';

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
    this.signals.editEdgeSlideStart.add(() => {
      this.editedObject = this.editSelection.editedObject;
      if (!this.editedObject || !this.handle) return;

      if (this.activeTransformSource !== null) return;

      if (this.handle && this.transformControls.worldPositionStart) {
        this.handle.getWorldPosition(this.transformControls.worldPositionStart);
      }

      this.activeTransformSource = 'command';
      this.startEdgeSlideSession();

      this.transformSolver.updateHandleFromCommandInput('translate', this.event);
      this.applyEdgeSlideSession();

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

  // Command Control
  onPointerMove() {
    if (this.activeTransformSource !== 'command') return;
    this.transformSolver.updateHandleFromCommandInput('translate', this.event);
    this.applyEdgeSlideSession();
    this.signals.objectChanged.dispatch();
  }

  onPointerDown() {
    if (this.activeTransformSource !== 'command') return;
    this.commitEdgeSlideSession();
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
      this.cancelEdgeSlideSession();
      this.clearCommandTransformState();
    }

    if (event.key === 'Enter') {
      this.commitEdgeSlideSession();
      this.clearCommandTransformState();
    }
  }

  // Edge Slide Session
  startEdgeSlideSession() {
    this.editedObject = this.editSelection.editedObject;
    if (!this.editedObject || !this.handle) return;
    this.vertexEditor.setObject(this.editedObject);

    this.startPivotPosition = this.handle.getWorldPosition(new THREE.Vector3());
    this.slideData = new Map();

    const meshData = this.editedObject.userData.meshData;
    this.beforeMeshData = structuredClone(meshData);

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
    if (!this.offset || this.offset === 0 || !this.slideData) {
      this.cancelEdgeSlideSession();
      this.clearCommandTransformState();
      this.clearStartData();
      return;
    }

    this.vertexEditor.setObject(this.editedObject);
    this.vertexEditor.transform.updateGeometryAndHelpers();

    const meshData = this.editedObject.userData.meshData;
    this.afterMeshData = structuredClone(meshData);
    this.editor.execute(new EdgeSlideCommand(this.editor, this.editedObject, this.beforeMeshData, this.afterMeshData));

    this.editSelection.clearSelection();
    this.editSelection.selectEdges(this.selectedEdgeIds);
    this.clearStartData();
  }

  cancelEdgeSlideSession() {
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
    });
  }

  clearStartData() {
    this.startPivotPosition = null;
    this.selectedEdgeIds = null;
    this.slideData = null;
    this.offset = null;

    this.edgeSlideStarted = false;
  }

  startEdgeSlide() {
    const meshData = this.editedObject.userData.meshData;
    if (!meshData || !this.selectedEdgeIds.length) return;

    const vertexGraph = this.buildSelectedVertexGraph(meshData, this.selectedEdgeIds);
    for (const [vId, info] of vertexGraph) {
      if (info.valence > 2) {
        this.slideData = null;
        return;
      }
    }

    const selectedEdges = this.selectedEdgeIds.map(id => meshData.edges.get(id));
    const selectedEdgeSet = new Set(selectedEdges);

    const edgeGroups = this.groupConnectedSelectedEdges(meshData, this.selectedEdgeIds);
    
    this.groupVertexIds = [];

    for (const edgeGroup of edgeGroups) {
      const edgesInGroup = [...edgeGroup].map(edgeId => meshData.edges.get(edgeId));
      
      const { vertices, edges, isClosed } = this.orderEdgeChain(edgesInGroup);
      
      this.groupVertexIds.push(vertices);

      this.buildTopologicalSlideData(meshData, vertices, edges, isClosed, selectedEdgeSet);
    }
  }

  buildTopologicalSlideData(meshData, orderedVertices, orderedEdges, isClosed, selectedEdgeSet) {
    let prevFaceA = null;
    let prevFaceB = null;

    for (let i = 0; i < orderedVertices.length; i++) {
      const vId = orderedVertices[i];
      const vertex = meshData.getVertex(vId);

      const referenceEdge = i === 0 ? orderedEdges[0] : orderedEdges[i - 1];
      if (!referenceEdge) continue;

      const faceIds = Array.from(referenceEdge.faceIds);
      if (faceIds.length < 2) continue;

      // --- Consistent face orientation ---
      let faceA, faceB;

      [faceA, faceB] = faceIds;

      if (i === 0) {
        [faceA, faceB] = faceIds;
      } else {
        if (faceIds.includes(prevFaceA)) {
          faceA = prevFaceA;
          faceB = faceIds.find(f => f !== faceA);
        } else if (faceIds.includes(prevFaceB)) {
          faceB = prevFaceB;
          faceA = faceIds.find(f => f !== faceB);
        } else {
          faceA = this.findAdjacentFace(meshData, faceIds, prevFaceA);
          if (faceA) {
            faceB = faceIds.find(f => f !== faceA);
          }

          if (!faceA) {
            faceB = this.findAdjacentFace(meshData, faceIds, prevFaceB);
            if (faceB) {
              faceA = faceIds.find(f => f !== faceB);
            }
          }
          if (!faceA && !faceB) {
            [faceA, faceB] = faceIds; 
          }
        }
      }

      // Classification into two directional groups
      prevFaceA = faceA;
      prevFaceB = faceB;

      const candidates = this.getCandidateEdges(meshData, vertex, selectedEdgeSet);

      const data = { origin: new THREE.Vector3().copy(vertex.position) };

      const prevId = isClosed 
        ? orderedVertices[(i - 1 + orderedVertices.length) % orderedVertices.length] : orderedVertices[i - 1];
      const nextId = isClosed 
        ? orderedVertices[(i + 1) % orderedVertices.length] : orderedVertices[i + 1];

      let candidatesA, candidatesB;
      const groupEdges = this.groupEdgesBySharedFace(candidates);

      if (groupEdges.length === 1) {
        candidatesA = candidates.filter(edge => edge.faceIds.has(faceA));
        candidatesB = candidates.filter(edge => edge.faceIds.has(faceB));
      } else {
        const [ group1, group2 ] = groupEdges;
        const groupEdge1 = group1.map(eId => meshData.edges.get(eId));
        const groupEdge2 = group2.map(eId => meshData.edges.get(eId));

        const group1HasFaceA = groupEdge1.some(edge => edge.faceIds.has(faceA));

        if (group1HasFaceA) {
          candidatesA = groupEdge1;
          candidatesB = groupEdge2;
        } else {
          candidatesA = groupEdge2;
          candidatesB = groupEdge1;
        }
      }

      // --- SIDE A ---
      const edgeA = this.pickBestEdge(meshData, vertex, candidatesA);

      if (edgeA) {
        const other = meshData.getVertex(edgeA.v1Id === vId ? edgeA.v2Id : edgeA.v1Id);
        const dir = new THREE.Vector3().subVectors(other.position, vertex.position);

        if (dir.lengthSq() > 1e-8) {
          data.sideA = {
            direction: dir,
            length: dir.length(),
            normalized: dir.clone().normalize()
          };
        }
      } else if (prevId !== undefined && nextId !== undefined) {
        const prev = meshData.getVertex(prevId);
        const next = meshData.getVertex(nextId);

        const bis = this.computeBisector(prev.position, vertex.position, next.position);

        data.sideA = {
          direction: bis.clone(),
          length: bis.length(),
          normalized: bis.clone().normalize()
        };
      }

      // --- SIDE B ---
      const edgeB = this.pickBestEdge(meshData, vertex, candidatesB);

      if (edgeB) {
        const other = meshData.getVertex(edgeB.v1Id === vId ? edgeB.v2Id : edgeB.v1Id);
        const dir = new THREE.Vector3().subVectors(other.position, vertex.position);

        if (dir.lengthSq() > 1e-8) {
          data.sideB = {
            direction: dir,
            length: dir.length(),
            normalized: dir.clone().normalize()
          };
        }
      } else if (prevId !== undefined && nextId !== undefined) {
        const prev = meshData.getVertex(prevId);
        const next = meshData.getVertex(nextId);

        const bis = this.computeBisector(prev.position, vertex.position, next.position);

        data.sideB = {
          direction: bis.clone(),
          length: bis.length(),
          normalized: bis.clone().normalize()
        };
      }

      this.slideData.set(vId, data);
    }
  }

  updateEdgeSlide() {
    const meshData = this.editedObject.userData.meshData;
    if (!meshData || !this.selectedEdgeIds.length || !this.slideData) return;

    const currentPivotPosition = this.handle.getWorldPosition(new THREE.Vector3());
    this.offset = new THREE.Vector3().subVectors(
      currentPivotPosition,
      this.startPivotPosition
    );

    const vertexIds = [];
    const newPositions = [];

    const first = this.slideData.get(this.groupVertexIds[0][0]);
    if (!first || (!first.sideA && !first.sideB)) return;

    let scoreA = first.sideA ? this.offset.dot(first.sideA.normalized) : -Infinity;
    let scoreB = first.sideB ? this.offset.dot(first.sideB.normalized) : -Infinity;

    const activeSide = scoreA > scoreB ? 'sideA' : 'sideB';
    const activeScore = Math.max(scoreA, scoreB);
    const activeLength = first[activeSide].length;

    let t = activeScore / activeLength;
    t = Math.max(0, Math.min(1, t));

    // Apply uniform sliding to the entire chain
    for (const groupVertex of this.groupVertexIds) {
      for (const vertexId of groupVertex) {
        const data = this.slideData.get(vertexId);
        const activeRail = data[activeSide]; 

        if (!activeRail) {
           vertexIds.push(vertexId);
           newPositions.push(data.origin.clone().applyMatrix4(this.editedObject.matrixWorld));
           continue;
        }

        const newPos = new THREE.Vector3()
          .copy(activeRail.direction)
          .multiplyScalar(t)
          .add(data.origin).applyMatrix4(this.editedObject.matrixWorld);

        vertexIds.push(vertexId);
        newPositions.push(newPos.clone());
      }
    }

    this.vertexEditor.transform.setVerticesWorldPositions(vertexIds, newPositions);
  }

  getCandidateEdges(meshData, vertex, selectedEdgeSet) {
    const connectedEdges = Array.from(vertex.edgeIds).map(id => meshData.edges.get(id));

    return connectedEdges.filter(edge => !selectedEdgeSet.has(edge));
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

  orderEdgeChain(selectedEdges) {
    if (!selectedEdges || selectedEdges.length === 0) {
      return { vertices: [], edges: [], isClosed: false };
    }

    const vertexToEdges = new Map();

    for (const edge of selectedEdges) {
      if (!vertexToEdges.has(edge.v1Id)) vertexToEdges.set(edge.v1Id, []);
      if (!vertexToEdges.has(edge.v2Id)) vertexToEdges.set(edge.v2Id, []);

      vertexToEdges.get(edge.v1Id).push(edge);
      vertexToEdges.get(edge.v2Id).push(edge);
    }

    let endVertices = [];
    for (const [vId, edges] of vertexToEdges) {
      if (edges.length === 1) {
        endVertices.push(vId);
      }
      if (edges.length > 2) {
        console.warn("Invalid chain: branching at vertex", vId);
      }
    }

    const isClosed = endVertices.length === 0;

    // Find start vertex
    let startVertexId = null;

    if (!isClosed) {
      startVertexId = endVertices[0];
    } else {
      startVertexId = selectedEdges[0].v1Id;
    }

    // Walk the chain
    const orderedVertexIds = [];
    const orderedEdges = [];
    const visitedEdges = new Set();

    let currentVertex = startVertexId;

    while (true) {
      orderedVertexIds.push(currentVertex);

      const edges = vertexToEdges.get(currentVertex) || [];

      let nextEdge = null;

      for (const edge of edges) {
        if (!visitedEdges.has(edge.id)) {
          nextEdge = edge;
          break;
        }
      }

      if (!nextEdge) break;

      visitedEdges.add(nextEdge.id);
      orderedEdges.push(nextEdge);

      const nextVertex =
        nextEdge.v1Id === currentVertex
          ? nextEdge.v2Id
          : nextEdge.v1Id;

      if (isClosed && nextVertex === startVertexId) {
        break;
      }

      currentVertex = nextVertex;
    }

    return {
      vertices: orderedVertexIds,
      edges: orderedEdges,
      isClosed
    };
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

  computeBisector(pPrev, p0, pNext) {
    const dir1 = new THREE.Vector3().subVectors(pPrev, p0);
    const dir2 = new THREE.Vector3().subVectors(pNext, p0);

    const bisector = new THREE.Vector3().addVectors(dir1, dir2);

    if (bisector.lengthSq() < 1e-6) {
      return dir1.clone();
    }

    return bisector;
  }

  pickBestEdge(meshData, vertex, candidates) {
    let best = null;
    let bestScore = -Infinity;
    let targetDir = null;

    if (candidates.length > 2) {
      targetDir = new THREE.Vector3();
      for (const edge of candidates) {

        const otherId = edge.v1Id === vertex.id ? edge.v2Id : edge.v1Id;
        const other = meshData.getVertex(otherId);
        const dir = new THREE.Vector3().subVectors(other.position, vertex.position).normalize();

        targetDir.add(dir);
      }
      targetDir.normalize();
    }

    for (const edge of candidates) {

      const otherId = edge.v1Id === vertex.id ? edge.v2Id : edge.v1Id;
      const other = meshData.getVertex(otherId);

      const dir = new THREE.Vector3().subVectors(other.position, vertex.position).normalize();

      let score = 1;

      if (targetDir) {
        score = dir.dot(targetDir); 
      }

      if (score > bestScore) {
        bestScore = score;
        best = edge;
      }
    }

    return best;
  }

  findAdjacentFace(meshData, faceIds, targetFaceId) {
    const targetFace = meshData.faces.get(targetFaceId);
    if (!targetFace) return null;

    const targetEdges = targetFace.edgeIds;

    for (const fId of faceIds) {
      if (fId === targetFaceId) continue;

      const face = meshData.faces.get(fId);
      if (!face) continue;

      for (const edgeId of face.edgeIds) {
        if (targetEdges.has(edgeId)) {
          return fId;
        }
      }
    }

    return null;
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
}