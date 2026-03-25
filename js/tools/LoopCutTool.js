import * as THREE from 'three';
import { getNeighborFaces, calculateFaceNormal, calculateVerticesNormal} from '../utils/AlignedNormalUtils.js';
import { LoopCutCommand } from '../commands/LoopCutCommand.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';

export class LoopCutTool {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;

    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.scene = editor.sceneManager.sceneEditorHelpers;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.active = false;
    this.editSelection = editor.editSelection;
    this.editedObject = null;
    this.previewLines = [];
    this.cutCount = 1;

    this.setupListeners();

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onMouseWheel = this.onMouseWheel.bind(this);
  }

  enable() {
    if (this.active) return;
    this.active = true;
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this._onPointerMove);
    this.renderer.domElement.addEventListener('wheel', this._onMouseWheel, { passive: false, capture: true });
  }

  disable() {
    if (!this.active) return;
    this.active = false;
    this.clearPreview();
  }

  setupListeners() {
    this.signals.viewportCameraChanged.add((camera) => {
      if (camera.isDefault) {
        this.camera = camera;
        this.raycaster.camera = camera;
      }
    });
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    if (!this.active) return;

    this.editedObject = this.editSelection.editedObject;
    if (!this.editedObject) return;
    const meshData = this.editedObject.userData.meshData;
    this.beforeMeshData = structuredClone(meshData);

    const loopEdges = this.getLoopEdgesFromMouse(event, meshData);
    if (!loopEdges) return;

    const isClosedLoop = loopEdges[0].id === loopEdges[loopEdges.length - 1].id;
    const count = isClosedLoop ? loopEdges.length - 1 : loopEdges.length;

    const newVertices = [];
    for (let c = 0; c < this.cutCount; c++) {
      const t = (c + 1) / (this.cutCount + 1);

      const edgeVertices = [];
      let lastVertex = null;
      for (let i = 0; i < count; i++) {
        const edge = loopEdges[i];
        let v1 = meshData.getVertex(edge.v1Id);
        let v2 = meshData.getVertex(edge.v2Id);

        if (lastVertex) {
          const verifyEdge = meshData.getEdge(lastVertex.id, v1.id);

          if (!verifyEdge) {
            [v1, v2] = [v2, v1];
          }
        }

        const pos = new THREE.Vector3().lerpVectors(v1.position, v2.position, t);
        edgeVertices.push(meshData.addVertex(pos));

        lastVertex = v1;
      }
      newVertices.push(edgeVertices);
    }

    const newEdges = this.applyLoopCut(meshData, loopEdges, newVertices, isClosedLoop);

    this.afterMeshData = structuredClone(meshData);
    this.editor.execute(new LoopCutCommand(this.editor, this.editedObject, this.beforeMeshData, this.afterMeshData));
    this.onPointerMove(event);

    const mode = this.editSelection.subSelectionMode;
    if (mode === 'vertex') {
      this.editSelection.selectVertices(newVertices.flat().map(v => v.id));
    } else if (mode === 'edge') {
      this.editSelection.selectEdges(newEdges.map(e => e.id));
    } else if (mode === 'face') {
      this.editSelection.clearSelection();
    }
  }

  onPointerMove(event) {
    if (!this.active) return;

    this.editedObject = this.editSelection.editedObject;
    if (!this.editedObject) return;
    const meshData = this.editedObject.userData.meshData;

    const loopEdges = this.getLoopEdgesFromMouse(event, meshData);
    if (!loopEdges) {
      this.clearPreview();
      return;
    }

    this.showPreview(meshData, loopEdges);
  }

  onMouseWheel(event) {
    if (!this.active) return;

    this.editedObject = this.editSelection.editedObject;
    if (!this.editedObject) return;
    const meshData = this.editedObject.userData.meshData;

    const loopEdges = this.getLoopEdgesFromMouse(event, meshData);
    if (!loopEdges) {
      this.clearPreview();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.deltaY < 0) this.cutCount++;
    else this.cutCount--;

    this.cutCount = Math.max(1, this.cutCount);

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
    const cutCount = newVertices.length;
    const count = isClosedLoop ? loopEdges.length - 1 : loopEdges.length;

    const alignedVertices = this.getAlignedEdgeVertices(meshData, loopEdges);

    for (let i = 0; i < loopEdges.length - 1; i++) {
      const edge = loopEdges[i];
      const nextEdge = loopEdges[i + 1];

      const face = this.findSharedFace(meshData, edge, nextEdge);
      if (!face) continue;
      const originalFaceNormal = calculateFaceNormal(meshData, face);
      meshData.deleteFace(face);

      // Get correctly aligned vertices for this face segment
      const alignA = alignedVertices[i];
      const alignB = (isClosedLoop && i === loopEdges.length - 1) ? alignedVertices[0]
        : alignedVertices[(i + 1) % count];

      const chainA = [alignA.v1];
      const chainB = [alignB.v1];

      // Add cut vertices in correct order
      for (let c = 0; c < cutCount; c++) {
        const vA = newVertices[c][i];
        const vB = (isClosedLoop && i === loopEdges.length - 1) ? newVertices[c][0]
          : newVertices[c][(i + 1) % count];

        chainA.push(vA);
        chainB.push(vB);
      }

      chainA.push(alignA.v2);
      chainB.push(alignB.v2);

      // create quads
      for (let j = 0; j < chainA.length - 1; j++) {
        const quad = [chainA[j], chainB[j], chainB[j + 1], chainA[j + 1]];

        const normal = calculateVerticesNormal(quad);
        if (normal.dot(originalFaceNormal) < 0) {
          quad.reverse();
        }

        meshData.addFace(quad);
      }

      // collect new loop edges
      for (let c = 0; c < cutCount; c++) {
        const a = newVertices[c][i];
        const b = (isClosedLoop && i === loopEdges.length - 1) ? newVertices[c][0]
          : newVertices[c][(i + 1) % count];

        const splitEdge = meshData.getEdge(a.id, b.id);

        if (splitEdge) newEdges.push(splitEdge);
      }
    }

    // Handle the first and last edges for open loops
    if (!isClosedLoop && loopEdges.length > 0) {
      const firstEdge = loopEdges[0];
      const lastEdge = loopEdges[loopEdges.length - 1];

      const firstEdgeVertices = newVertices.map(c => c[0]);
      const lastEdgeVertices = newVertices.map(c => c[loopEdges.length - 1]);

      this.insertEdgeVertices(meshData, firstEdge, firstEdgeVertices, alignedVertices[0]);
      this.insertEdgeVertices(meshData, lastEdge, lastEdgeVertices, alignedVertices[loopEdges.length - 1]);
    }

    for (const edge of loopEdges) {
      meshData.deleteEdge(edge);
    }

    return newEdges;
  }

  getAlignedEdgeVertices(meshData, loopEdges) {
    const alignedVertices = [];
    let lastVertex = null;

    for (let i = 0; i < loopEdges.length; i++) {
      const edge = loopEdges[i];
      let v1 = meshData.getVertex(edge.v1Id);
      let v2 = meshData.getVertex(edge.v2Id);

      if (lastVertex) {
        const verifyEdge = meshData.getEdge(lastVertex.id, v1.id);
        if (!verifyEdge) {
          [v1, v2] = [v2, v1];
        }
      }
      alignedVertices.push({ v1, v2 });
      lastVertex = v1;
    }

    return alignedVertices;
  }

  insertEdgeVertices(meshData, edge, edgeVertices, alignedVertices) {
    const startId = alignedVertices.v1.id;
    const endId = alignedVertices.v2.id;

    const neighbors = getNeighborFaces(meshData, [edge.id]);
    const neighborFaces = neighbors.map(n => n.face);

    for (const face of neighborFaces) {
      if (!face) continue;

      const newVertexIds = [];

      for (let i = 0; i < face.vertexIds.length; i++) {
        newVertexIds.push(face.vertexIds[i]);

        const current = face.vertexIds[i];
        const next = face.vertexIds[(i + 1) % face.vertexIds.length];

        // Insert new vertices between v1 and v2
        if (current === startId && next === endId) {
          for (let j = 0; j < edgeVertices.length; j++) {
            newVertexIds.push(edgeVertices[j].id);
          }
        }
        else if (current === endId && next === startId) {
          for (let j = edgeVertices.length - 1; j >= 0; j--) {
            newVertexIds.push(edgeVertices[j].id);
          }
        }
      }

      meshData.deleteFace(face);
      meshData.addFace(newVertexIds.map(id => meshData.getVertex(id)));
    }
  }

  showPreview(meshData, loopEdges) {
    this.clearPreview();

    for (let c = 0; c < this.cutCount; c++) {
      const t = (c + 1) / (this.cutCount + 1);

      const points = [];

      let lastVertex = null;
      for (const edge of loopEdges) {
        let v1 = meshData.getVertex(edge.v1Id);
        let v2 = meshData.getVertex(edge.v2Id);

        if (lastVertex) {
          const verifyEdge = meshData.getEdge(lastVertex.id, v1.id);

          if (!verifyEdge) {
            [v1, v2] = [v2, v1];
          }
        }

        const p = new THREE.Vector3().lerpVectors(v1.position, v2.position, t);
        points.push(p.x, p.y, p.z);

        lastVertex = v1;
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

      const line = new Line2(geometry, material);
      line.computeLineDistances();

      line.matrix.copy(this.editedObject.matrixWorld);
      line.matrix.decompose(
        line.position,
        line.quaternion,
        line.scale
      );

      this.scene.add(line);
      this.previewLines.push(line);
    }
  }

  clearPreview() {
    if (!this.previewLines || this.previewLines.length === 0) return;

    for (const line of this.previewLines) {
      this.scene.remove(line);
      line.geometry.dispose();
      line.material.dispose();
    }

    this.previewLines = [];
  }

  getLoopEdgesFromMouse(event, meshData) {
    const rect = this.renderer.domElement.getBoundingClientRect();

    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObject(this.editedObject, false);
    if (intersects.length === 0) return null;

    const startEdge = this.getStartEdgeFromIntersect(meshData, intersects[0]);
    if (!startEdge) return null;

    const loopEdges = this.getLoopEdges(meshData, startEdge);
    if (!loopEdges || loopEdges.length < 2) return null;

    return loopEdges;
  }
}