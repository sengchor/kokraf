import * as THREE from 'three';
import { getNeighborFaces, calculateFaceNormal, calculateVerticesNormal} from '../utils/AlignedNormalUtils.js';
import { LoopCutCommand } from '../commands/LoopCutCommand.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';

export class LoopCutTool {
  constructor(editor) {
    this.editor = editor;
    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.scene = editor.sceneManager.sceneEditorHelpers;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.active = false;
    this.editSelection = editor.editSelection;
    this.editedObject = null;

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
  }

  enable() {
    if (this.active) return;
    this.active = true;
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this._onPointerMove);
  }

  disable() {
    if (!this.active) return;
    this.active = false;
    this.clearPreview();
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    if (!this.active) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.editedObject = this.editSelection.editedObject;
    if (!this.editedObject) return;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.editedObject, false);
    if (intersects.length === 0) return;

    const meshData = this.editedObject.userData.meshData;
    this.beforeMeshData = structuredClone(meshData);
    const startEdge = this.getStartEdgeFromIntersect(meshData, intersects[0]);
    const loopEdges = this.getLoopEdges(meshData, startEdge);

    if (!loopEdges || loopEdges.length < 2) return;

    const isClosedLoop = loopEdges[0].id === loopEdges[loopEdges.length - 1].id;
    const count = isClosedLoop ? loopEdges.length - 1 : loopEdges.length;

    const newVertices = [];
    for (let i = 0; i < count; i++) {
      const edge = loopEdges[i];
      const v1 = meshData.getVertex(edge.v1Id).position;
      const v2 = meshData.getVertex(edge.v2Id).position;
      const newPos = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5);
      newVertices.push(meshData.addVertex(newPos));
    }

    const newEdges = this.applyLoopCut(meshData, loopEdges, newVertices, isClosedLoop);

    this.afterMeshData = structuredClone(meshData);
    this.editor.execute(new LoopCutCommand(this.editor, this.editedObject, this.beforeMeshData, this.afterMeshData));
    this.onPointerMove(event);

    const mode = this.editSelection.subSelectionMode;
    if (mode === 'vertex') {
      this.editSelection.selectVertices(newVertices.map(v => v.id));
    } else if (mode === 'edge') {
      this.editSelection.selectEdges(newEdges.map(e => e.id));
    } else if (mode === 'face') {
      this.editSelection.clearSelection();
    }
  }

  onPointerMove(event) {
    if (!this.active) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.editedObject = this.editSelection.editedObject;
    if (!this.editedObject) return;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.editedObject, false);
    if (intersects.length === 0) {
      this.clearPreview();
      return;
    }

    const meshData = this.editedObject.userData.meshData;
    const startEdge = this.getStartEdgeFromIntersect(meshData, intersects[0]);
    if (!startEdge) {
      this.clearPreview();
      return;
    }

    const loopEdges = this.getLoopEdges(meshData, startEdge);
    if (!loopEdges || loopEdges.length < 2) {
      this.clearPreview();
      return;
    }

    this.showPreview(meshData, loopEdges);
  }

  findNearestEdge(meshData, edges, point) {
    let nearestEdge = null;
    let minDistance = Infinity;
    const closestPoint = new THREE.Vector3();

    const edgeStart = new THREE.Vector3();
    const edgeEnd = new THREE.Vector3();
    const worldMatrix = this.editedObject.matrixWorld;
    const line = new THREE.Line3();

    for (const edge of edges) {
      const v1 = meshData.getVertex(edge.v1Id);
      const v2 = meshData.getVertex(edge.v2Id);
      if (!v1 || !v2) continue;

      edgeStart.set(v1.position.x, v1.position.y, v1.position.z)
        .applyMatrix4(worldMatrix);
      edgeEnd.set(v2.position.x, v2.position.y, v2.position.z)
        .applyMatrix4(worldMatrix);

      line.set(edgeStart, edgeEnd);
      line.closestPointToPoint(point, true, closestPoint);
      const dist = closestPoint.distanceTo(point);

      if (dist < minDistance) {
        minDistance = dist;
        nearestEdge = edge;
      }
    }

    return nearestEdge;
  }

  getOppositeEdgeInFace(meshData, face, edge) {
    const targetV1Id = edge.v1Id;
    const targetV2Id = edge.v2Id;

    for (let edgeId of face.edgeIds) {
      const currentEdge  = meshData.edges.get(edgeId);
      if (!currentEdge ) continue;

      const { v1Id, v2Id } = currentEdge ;

      const sharesVertex =
        v1Id === targetV1Id || v1Id === targetV2Id || v2Id === targetV1Id || v2Id === targetV2Id;

      if (!sharesVertex) {
        return currentEdge;
      }
    }

    return null;
  }

  isClosedLoop(leftLoop, rightLoop) {
    if (leftLoop.length !== rightLoop.length) return false;

    for (let i = 0; i < leftLoop.length; i++) {
      if (leftLoop[i].id !== rightLoop[rightLoop.length - 1 - i].id) {
        return false;
      }
    }
    return true;
  }

  traverseEdgeLoop(meshData, startEdge, startFace) {
    const visitedLocal = new Set();
    let closedLoop = false;
    let currentEdge = startEdge;
    let currentFace = startFace;
    let nextFaceData;
    const directionEdges = [];

    while (currentEdge && !visitedLocal.has(currentEdge.id)) {
      visitedLocal.add(currentEdge.id);

      if (currentEdge !== startEdge) {
        directionEdges.push(currentEdge);
      }

      const neighborFaces = getNeighborFaces(meshData, [currentEdge.id]);
      if (neighborFaces.length === 1 && currentEdge === startEdge) {
        nextFaceData = neighborFaces[0];
      } else {
        nextFaceData = neighborFaces.find(n => n.face && n.face.id !== currentFace.id);
      }
      if (!nextFaceData) break;

      const nextFace = nextFaceData.face;
      if (nextFace.vertexIds.length !== 4) break; // only quads

      const oppositeEdge = this.getOppositeEdgeInFace(meshData, nextFace, currentEdge);
      if (!oppositeEdge) break;

      if (visitedLocal.has(oppositeEdge.id)) {
        closedLoop = true;
        break;
      }

      currentEdge = oppositeEdge;
      currentFace = nextFace;
    }

    return { edges: directionEdges, closedLoop };
  }

  getStartEdgeFromIntersect(meshData, intersect) {
    if (!intersect || !intersect.face) return null;

    const { a, b, c } = intersect.face;
    const toVertexId = meshData.bufferIndexToVertexId.get.bind(meshData.bufferIndexToVertexId);

    const v1 = toVertexId(a);
    const v2 = toVertexId(b);
    const v3 = toVertexId(c);

    const edges = [
      meshData.getEdge(v1, v2),
      meshData.getEdge(v2, v3),
      meshData.getEdge(v3, v1)
    ].filter(Boolean);

    return this.findNearestEdge(meshData, edges, intersect.point);
  }

  getLoopEdges(meshData, startEdge) {
    const neighborFaces = getNeighborFaces(meshData, [startEdge.id]);
    if (neighborFaces.length === 0) return [];

    let leftLoop = [];
    let rightLoop = [];
    let closedLoop = false;

    // Traverse left neighbor face
    if (neighborFaces[0]) {
      const { edges, closedLoop: isClosed } = this.traverseEdgeLoop(meshData, startEdge, neighborFaces[0].face);
      leftLoop = edges;
      closedLoop ||= isClosed;
    }

    // Traverse right neighbor face if loop not closed
    if (!closedLoop && neighborFaces[1]) {
      const { edges, closedLoop: isClosed } = this.traverseEdgeLoop(meshData, startEdge, neighborFaces[1].face);
      rightLoop = edges;
      closedLoop ||= isClosed;
    }

    // Combine edges
    return closedLoop
      ? [startEdge, ...leftLoop, startEdge]
      : [...leftLoop.reverse(), startEdge, ...rightLoop];
  }

  findSharedFace(meshData, edgeA, edgeB) {
    for (let fId of edgeA.faceIds) {
      if (edgeB.faceIds.has(fId)) {
        return meshData.faces.get(fId);
      }
    }
    return null;
  }

  applyLoopCut(meshData, loopEdges, newVertices, isClosedLoop) {
    const newEdges = [];
    for (let i = 0; i < loopEdges.length; i++) {
      const edge = loopEdges[i];
      const nextEdge = loopEdges[(i + 1) % loopEdges.length];

      const face = this.findSharedFace(meshData, edge, nextEdge);
      const originalFaceNormal = calculateFaceNormal(meshData, face);

      if (face) {
        meshData.deleteFace(face);
      }

      const midVertex = newVertices[i];
      const nextMidVertex = (isClosedLoop && i === newVertices.length - 1) ? newVertices[0] : newVertices[(i + 1) % loopEdges.length];

      if (!face) continue;
      const sameDirection = !!meshData.getEdge(edge.v1Id, nextEdge.v1Id);

      let quad1, quad2;

      const v1 = meshData.getVertex(edge.v1Id);
      const v2 = meshData.getVertex(edge.v2Id);
      const nextV1 = meshData.getVertex(nextEdge.v1Id);
      const nextV2 = meshData.getVertex(nextEdge.v2Id);

      if (sameDirection) {
        quad1 = [v1, nextV1, nextMidVertex, midVertex];
        quad2 = [v2, nextV2, nextMidVertex, midVertex];
      } else {
        quad1 = [v1, nextV2, nextMidVertex, midVertex];
        quad2 = [v2, nextV1, nextMidVertex, midVertex];
      }

      [quad1, quad2].forEach(quad => {
        const normal = calculateVerticesNormal(quad);
        if (normal.dot(originalFaceNormal) < 0) {
          quad.reverse();
        }
        meshData.addFace(quad);
      });

      const splitEdge = meshData.getEdge(midVertex.id, nextMidVertex.id);
      if (splitEdge) newEdges.push(splitEdge);
    }

    // Handle the first and last edges for open loops
    if (!isClosedLoop) { 
      this.handleEdgeRebuild(meshData, loopEdges[0], newVertices[0]);
      this.handleEdgeRebuild(meshData, loopEdges[loopEdges.length - 1], newVertices[newVertices.length - 1]);
    }

    for (const edge of loopEdges) {
      meshData.deleteEdge(edge);
    }

    return newEdges;
  }

  handleEdgeRebuild(meshData, edge, midVertex) {
    const v1 = meshData.getVertex(edge.v1Id);
    const v2 = meshData.getVertex(edge.v2Id);

    const neighbors = getNeighborFaces(meshData, [edge.id]);
    const neighborFaces = neighbors.map(n => n.face);

    for (const face of neighborFaces) {
      if (!face) continue;

      const newVertexIds = [];

      for (let i = 0; i < face.vertexIds.length; i++) {
        newVertexIds.push(face.vertexIds[i]);

        const current = face.vertexIds[i];
        const next = face.vertexIds[(i + 1) % face.vertexIds.length];

        // Insert midpoint between v1 and v2 (in either direction)
        if (
          (current === v1.id && next === v2.id) ||
          (current === v2.id && next === v1.id)
        ) {
          newVertexIds.push(midVertex.id);
        }
      }

      meshData.deleteFace(face);
      meshData.addFace(newVertexIds.map(id => meshData.getVertex(id)));
    }
  }

  showPreview(meshData, loopEdges) {
    if (this.previewLine) this.scene.remove(this.previewLine);

    const points = [];
    for (const edge of loopEdges) {
      const v1 = meshData.getVertex(edge.v1Id).position;
      const v2 = meshData.getVertex(edge.v2Id).position;
      const mid = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5);
      points.push(mid.x, mid.y, mid.z);
    }

    const geometry = new LineGeometry();
    geometry.setPositions(points);

    const material = new LineMaterial({
      color: 0xffff00,
      linewidth: 1,
      transparent: false,
      opacity: 0.9,
      depthTest: false,
    });
    material.resolution.set(window.innerWidth, window.innerHeight);

    this.previewLine = new Line2(geometry, material);
    this.previewLine.computeLineDistances();
    this.previewLine.matrix.copy(this.editedObject.matrixWorld);
    this.previewLine.matrix.decompose(
      this.previewLine.position,
      this.previewLine.quaternion,
      this.previewLine.scale
    );
    this.scene.add(this.previewLine);
  }

  clearPreview() {
    if (!this.previewLine) return;

    this.scene.remove(this.previewLine);
    this.previewLine.geometry.dispose();
    this.previewLine.material.dispose();
    this.previewLine = null;
  }
}