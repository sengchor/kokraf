import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { getEdgeMidpoint, calculateFaceNormal } from '../utils/AlignedNormalUtils.js';

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

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode('translate');
    this.transformControls.visible = false;

    this.renderer.domElement.addEventListener('pointermove', (e) => this.event = e);
    this.sceneEditorHelpers.add(this.transformControls.getHelper());

    this.setupTransformListeners();
  }

  enableFor(object) {
    if (!object) return;

    this.transformControls.attach(object);
    this.transformControls.visible = true;

    this.showCenterOnly();
    this.handle = this.transformControls.object;
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
      this.startBevelSession();
    });

    this.transformControls.addEventListener('change', () => {
      if (!this.transformControls.dragging) return;
      this.applyBevelSession();
    });

    this.transformControls.addEventListener('mouseUp', () => {
      this.commitBevelSession();
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

  // Bevel session
  startBevelSession() {
    const editedObject = this.editSelection.editedObject;
    if (!editedObject || !this.handle) return;

    this.startPivotPosition = this.handle.getWorldPosition(new THREE.Vector3());
    this.extrudeStarted = false;
  }

  applyBevelSession() {
    if (!this.startPivotPosition) return;

    if (!this.extrudeStarted) {
      this.startBevel();
      this.extrudeStarted = true;
    }
    // this.updateBevel();
  }

  commitBevelSession() {
    const editedObject = this.editSelection.editedObject;
    this.vertexEditor.setObject(editedObject);
    this.vertexEditor.transform.updateGeometryAndHelpers();

  }

  startBevel() {
    this.editedObject = this.editSelection.editedObject;
    if (!this.editedObject) return;

    const meshData = this.editedObject.userData.meshData;
    if (!meshData) return;

    const selectedEdgeIds = Array.from(this.editSelection.selectedEdgeIds);
    if (selectedEdgeIds.length <= 0) return;
    const edgeGroups = this.groupConnectedSelectedEdges(meshData, selectedEdgeIds);

    const distance = 0.2;
    for (const edgeGroup of edgeGroups) {
      const adjacentFaceIds = this.getFacesAdjacentToEdges(meshData, edgeGroup);
      const vertexNeighborFaceIds = this.getFacesAdjacentToEdgeVertices(meshData, edgeGroup);

      for (const edgeId of edgeGroup) {
        const edge = meshData.edges.get(edgeId);
        if (!edge) continue;

        const vertexIds = [edge.v1Id, edge.v2Id];

        for (const vId of vertexIds) {
          const vertex = meshData.getVertex(vId);
          if (!vertex) continue;

          for (const faceId of vertex.faceIds) {
            vertexNeighborFaceIds.add(faceId);
          }
        }
      }

      const graph = this.buildSelectedEdgeGraph(meshData, edgeGroup);
      const bevelResults = new Map();

      let result = null;
      for (const [vId, info] of graph.vertexInfo) {
        if (info.valence === 1) {
          result = this.bevelEndVertex(meshData, info, distance);
        }
        else if (info.valence === 2) {
          result = this.bevelCornerVertex(meshData, info, distance);
        }
        else {
          result = this.bevelJunctionVertex(meshData, info, distance);
        }
        console.log(result);
        if (result) bevelResults.set(vId, result);
      }

      for (const [originalVertexId, result] of bevelResults) {
        const { faceVertexMap } = result;

        for (const [faceId, newVertexIds] of faceVertexMap) {

          if (!adjacentFaceIds.has(faceId)) {
            this.splitVertexInFace(meshData, faceId, originalVertexId, newVertexIds[0], newVertexIds[1]);
          }
          else {
            this.replaceVertexInFace(meshData, faceId, originalVertexId, newVertexIds[0]);
          }
        }
      }

      for (const faceId of vertexNeighborFaceIds) {
        const face = meshData.faces.get(faceId);
        if (!face) continue;

        this.rebuildFaceTopology(meshData, face);
      }

      // Delete all old vertices
      const oldVertices = []; 
      for (const edgeId of edgeGroup) {
        const edge = meshData.edges.get(edgeId);
        if (!edge) return;

        const vertex1 = meshData.getVertex(edge.v1Id);
        const vertex2 = meshData.getVertex(edge.v2Id);
        oldVertices.push(vertex1);
        oldVertices.push(vertex2);
      }

      for (const oldVertice of oldVertices) {
        meshData.deleteVertex(oldVertice);
      }
    }
  }

  updateBevel() {
    // Compute drag distance
    const currentPos = this.handle.getWorldPosition(new THREE.Vector3());
    const delta = currentPos.clone().sub(this.startPivotPosition);
    this.distance = delta.length();

    if (this.distance === 0) return;
  }

  commitBevel() {

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

  bevelEndVertex(meshData, info, distance) {
    const { vertexId, selectedEdgeIds, valence } = info;
    if (valence !== 1) return null;

    const vertex = meshData.getVertex(vertexId);
    if (!vertex) return null;

    const selectedEdgeId = selectedEdgeIds[0];
    const edge = meshData.edges.get(selectedEdgeId);
    if (!edge) return null;

    const connectedEdges = Array.from(vertex.edgeIds).map(edgeId => meshData.edges.get(edgeId));

    const newVertexIds = [];
    const faceVertexMap = new Map();
    for (const connectedEdge of connectedEdges) {
      if (connectedEdge === edge) continue;

      const otherId = connectedEdge.v1Id === vertexId ? connectedEdge.v2Id : connectedEdge.v1Id;
      const otherV = meshData.getVertex(otherId);

      const p1 = new THREE.Vector3().copy(vertex.position);
      const p2 = new THREE.Vector3().copy(otherV.position);

      const dir = p2.clone().sub(p1).normalize();
      const newPos = p1.add(dir.multiplyScalar(distance));

      const newVertex = meshData.addVertex(newPos);
      newVertexIds.push(newVertex.id);

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
    }
  }

  bevelCornerVertex(meshData, info, distance) {
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

    const p0 = new THREE.Vector3().copy(vertex.position);
    const p1 = new THREE.Vector3().copy(v1.position);
    const p2 = new THREE.Vector3().copy(v2.position);

    const dir1 = p1.sub(p0).normalize();
    const dir2 = p2.sub(p0).normalize();

    const newVertexIds = [];
    const faceVertexMap = new Map();

    // Faces shared by BOTH selected edges
    const sharedFaceIds = [...edge1.faceIds].filter(fid =>
      edge2.faceIds.has(fid)
    );

    const connectedEdges = Array.from(vertex.edgeIds).map(edgeId => meshData.edges.get(edgeId));

    if (sharedFaceIds.length > 0) {
      for (const faceId of sharedFaceIds) {
        const slide1 = dir1.clone().multiplyScalar(distance);
        const slide2 = dir2.clone().multiplyScalar(distance);

        const newPos = p0.clone().add(slide1).add(slide2);
        const newVertex = meshData.addVertex(newPos);
        newVertexIds.push(newVertex.id);

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

      const p1 = new THREE.Vector3().copy(vertex.position);
      const p2 = new THREE.Vector3().copy(otherV.position);

      const dir = p2.clone().sub(p1).normalize();
      const newPos = p1.add(dir.multiplyScalar(distance));

      const newVertex = meshData.addVertex(newPos);
      newVertexIds.push(newVertex.id);

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

  bevelJunctionVertex(meshData, info, distance) {
    const { vertexId, selectedEdgeIds, valence } = info;
    if (valence <= 2) return null;

    const vertex = meshData.getVertex(vertexId);
    if (!vertex) return null;

    const p0 = new THREE.Vector3().copy(vertex.position);
    const newVertexIds = [];
    const faceVertexMap = new Map();
    const selectedEdges = selectedEdgeIds.map(id => meshData.edges.get(id));
    const processedFaceIds = new Set();

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

          const pA = new THREE.Vector3().copy(vA.position);
          const pB = new THREE.Vector3().copy(vB.position);

          const dirA = pA.sub(p0).normalize();
          const dirB = pB.sub(p0).normalize();

          const slideA = dirA.multiplyScalar(distance);
          const slideB = dirB.multiplyScalar(distance);

          const newPos = p0.clone().add(slideA).add(slideB);
          const newVertex = meshData.addVertex(newPos);
          newVertexIds.push(newVertex.id);

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

      const p1 = new THREE.Vector3().copy(vertex.position);
      const p2 = new THREE.Vector3().copy(otherV.position);

      const dir = p2.clone().sub(p1).normalize();
      const newPos = p1.clone().add(dir.multiplyScalar(distance));

      const newVertex = meshData.addVertex(newPos);
      newVertexIds.push(newVertex.id);

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
    const nvA = meshData.getVertex(nvAId);
    const nvB = meshData.getVertex(nvBId);

    const vIds = face.vertexIds;
    const oldIdx = vIds.indexOf(oldVertexId);
    if (oldIdx === -1) return false;

    const prevV = meshData.getVertex(vIds[(oldIdx - 1 + vIds.length) % vIds.length]);
    
    const dirToPrev = new THREE.Vector3().subVectors(prevV.position, oldVertex.position).normalize();
    const dirToA = new THREE.Vector3().subVectors(nvA.position, oldVertex.position).normalize();
    const dirToB = new THREE.Vector3().subVectors(nvB.position, oldVertex.position).normalize();

    // The new vertex that aligns better with the "previous" vertex comes first
    const dotA = dirToPrev.dot(dirToA);
    const dotB = dirToPrev.dot(dirToB);

    const [first, second] = (dotA > dotB) ? [nvA, nvB] : [nvB, nvA];

    const newIds = [...vIds];
    newIds.splice(oldIdx, 1, first.id, second.id);

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
}