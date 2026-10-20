import * as THREE from 'three';
import { GPUDepthReader } from '../utils/GPUDepthReader.js';

export default class EditPicker {
  constructor(editor) {
    this.sceneManager = editor.sceneManager;
    this.vertexEditor = editor.vertexEditor;
    this.selectionBox = editor.selectionBox;
    this.renderer = editor.renderer;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.depthReader = new GPUDepthReader(
      this.renderer.renderer,
      window.innerWidth,
      window.innerHeight
    );
  }

  get xrayMode() {
    return this.sceneManager.xrayMode;
  }

  getHelper(name) {
    return this.sceneManager.sceneHelpers.getObjectByName(name);
  }

  updateMouse(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return rect;
  }

  // -------------------- Click picking --------------------
  pickNearestVertexOnMouse(event, camera, threshold = 0.2) {
    const rect = this.updateMouse(event);
 
    const vertexPoints = this.getHelper('__VertexPoints');
    if (!vertexPoints) return null;
 
    this.raycaster.setFromCamera(this.mouse, camera);
    this.raycaster.params.Points.threshold = threshold;
 
    const vertexHits = this.raycaster.intersectObject(vertexPoints, false);
    if (vertexHits.length === 0) return null;
 
    const vertexCandidates = this.buildVertexCandidates(vertexHits, vertexPoints);
    const visibleVertices = this.xrayMode ? vertexCandidates : this.filterVisibleVertices(vertexCandidates, camera);
    if (visibleVertices.length === 0) return null;
 
    return this.pickNearestVertex(visibleVertices, camera, rect);
  }
 
  pickNearestEdgeOnMouse(event, camera, threshold = 0.1) {
    const rect = this.updateMouse(event);
 
    const thinLine = this.getHelper('__EdgeLines');
    if (!thinLine) return null;
 
    this.raycaster.setFromCamera(this.mouse, camera);
    this.raycaster.params.Line.threshold = threshold;
 
    const edgeHits = this.raycaster.intersectObjects([thinLine], false);
    if (edgeHits.length === 0) return null;
 
    const edgeCandidates = this.buildEdgeCandidates(edgeHits, thinLine);
    const visibleEdges = this.xrayMode ? edgeCandidates : this.filterVisibleEdges(edgeCandidates, camera);
    if (visibleEdges.length === 0) return null;
 
    return this.pickNearestEdge(visibleEdges, camera, rect);
  }
 
  pickNearestFaceOnMouse(event, camera) {
    this.updateMouse(event);
 
    const faceMesh = this.getHelper('__FacePolygons');
    if (!faceMesh) return null;
 
    this.raycaster.setFromCamera(this.mouse, camera);
 
    const faceHits = this.raycaster.intersectObject(faceMesh);
    if (faceHits.length === 0) return null;
 
    const faceCandidates = this.buildFaceCandidates([faceHits[0]], faceMesh);
    const visibleFaces = this.xrayMode ? faceCandidates : this.filterVisibleFaces(faceCandidates, camera);
    if (visibleFaces.length === 0) return null;
 
    return visibleFaces[0].faceId;
  }

  // -------------------- Box picking --------------------
  getBoxSelectedVertexIds(camera) {
    const frustum = this.selectionBox.computeFrustumFromSelection();
    if (!frustum) return null;
 
    const vertexPoints = this.getHelper('__VertexPoints');
    if (!vertexPoints) return null;
 
    const vertexHits = this.selectionBox.getVerticesInFrustum(vertexPoints, frustum);
    if (vertexHits.length === 0) return null;
 
    const visibleVertices = this.xrayMode ? vertexHits : this.filterVisibleVertices(vertexHits, camera);
    if (visibleVertices.length === 0) return null;
 
    return visibleVertices.map(v => v.vertexId);
  }
 
  getBoxSelectedEdgeIds(camera) {
    const frustum = this.selectionBox.computeFrustumFromSelection();
    if (!frustum) return null;
 
    const thinLine = this.getHelper('__EdgeLines');
    if (!thinLine) return null;
 
    const edgeHits = this.selectionBox.getEdgesInFrustum(thinLine, frustum);
    if (edgeHits.length === 0) return null;
 
    const visibleEdges = this.xrayMode ? edgeHits : this.filterVisibleEdges(edgeHits, camera);
    if (visibleEdges.length === 0) return null;
 
    const insideHits = visibleEdges.filter(e => e.type === "endpoint");
    const clipHits = visibleEdges.filter(e => e.type === "clipping");
 
    // Prefer inside hits; if none exist, use clipping hits.
    const selectedEdges = insideHits.length > 0 ? insideHits : clipHits;
 
    return selectedEdges.map(e => e.edgeId);
  }
 
  getBoxSelectedFaceIds(camera) {
    const frustum = this.selectionBox.computeFrustumFromSelection();
    if (!frustum) return null;
 
    const faceMesh = this.getHelper('__FacePolygons');
    if (!faceMesh) return null;
 
    const faceHits = this.selectionBox.getFacesInFrustum(faceMesh, frustum);
    if (faceHits.length === 0) return null;
 
    const visibleFaces = this.xrayMode ? faceHits : this.filterVisibleFaces(faceHits, camera);
    if (visibleFaces.length === 0) return null;
 
    return visibleFaces.map(f => f.faceId);
  }

  // -------------------- Occlusion filtering --------------------
  filterVisibleVertices(vertexHits, camera) {
    if (!vertexHits || vertexHits.length === 0) return [];
 
    this.depthReader.updateDepthBuffer(this.sceneManager.mainScene, camera);
 
    const visibleVertices = [];
 
    for (const hit of vertexHits) {
      if (!hit.point) continue;
 
      if (this.depthReader.isPointVisible(hit.point, camera)) {
        visibleVertices.push(hit);
      }
    }
 
    return visibleVertices;
  }
 
  filterVisibleEdges(edgeHits, camera) {
    if (!edgeHits || edgeHits.length === 0) return [];
 
    this.depthReader.updateDepthBuffer(this.sceneManager.mainScene, camera);
 
    const visibleEdges = [];
    const BIAS = 0.1;
 
    for (const hit of edgeHits) {
      const midpoint = new THREE.Vector3()
        .addVectors(hit.vA, hit.vB)
        .multiplyScalar(0.5);
 
      const biasedA = hit.vA.clone().lerp(midpoint, BIAS);
      const biasedB = hit.vB.clone().lerp(midpoint, BIAS);
      const testPoints = [midpoint, biasedA, biasedB];
 
      for (const testPoint of testPoints) {
        if (this.depthReader.isPointVisible(testPoint, camera)) {
          visibleEdges.push(hit);
          break;
        }
      }
    }
 
    return visibleEdges;
  }
 
  filterVisibleFaces(faceHits, camera) {
    if (!faceHits || faceHits.length === 0) return [];
 
    this.depthReader.updateDepthBuffer(this.sceneManager.mainScene, camera);
 
    const visibleFaces = [];
    const tempCentroid = new THREE.Vector3();
    const BIAS = 0.1;
 
    for (const hit of faceHits) {
      tempCentroid.set(0, 0, 0);
      for (const vertex of hit.vertices) {
        tempCentroid.add(vertex);
      }
      if (hit.vertices.length > 0) {
        tempCentroid.divideScalar(hit.vertices.length);
      }
 
      const isCentroidVisible = this.depthReader.isPointVisible(tempCentroid, camera);
 
      let isVertexVisible = false;
      for (const vertex of hit.vertices) {
        const biased = vertex.clone().lerp(tempCentroid, BIAS);
        if (this.depthReader.isPointVisible(biased, camera)) {
          isVertexVisible = true;
          break;
        }
      }
 
      if (isVertexVisible || isCentroidVisible) {
        visibleFaces.push(hit);
      }
    }
 
    return visibleFaces;
  }

  // -------------------- Candidate buildings --------------------
  buildVertexCandidates(vertexHits, vertexPoints) {
    const vertexIdAttr = vertexPoints.geometry.getAttribute('vertexId');
 
    return vertexHits.map(hit => {
      const vertexId = vertexIdAttr.getX(hit.index);
      const position = this.vertexEditor.transform.getVertexPosition(vertexId);
 
      return {
        ...hit,
        vertexId,
        point: position,
      };
    });
  }
 
  buildEdgeCandidates(edgeHits, thinLine) {
    const edges = [];
    const pos = thinLine.geometry.getAttribute('position');
    const { edgeIdList } = thinLine.userData;
 
    for (const hit of edgeHits) {
      const edgeIndex = Math.floor(hit.index / 2);
      const edgeId = edgeIdList[edgeIndex];
      if (edgeId === undefined) continue;
 
      const baseIndex = edgeIndex * 2;
 
      const vA = new THREE.Vector3(
        pos.getX(baseIndex),
        pos.getY(baseIndex),
        pos.getZ(baseIndex)
      ).applyMatrix4(thinLine.matrixWorld);
 
      const vB = new THREE.Vector3(
        pos.getX(baseIndex + 1),
        pos.getY(baseIndex + 1),
        pos.getZ(baseIndex + 1)
      ).applyMatrix4(thinLine.matrixWorld);
 
      edges.push({
        ...hit,
        edgeId,
        vA,
        vB
      });
    }
 
    return edges;
  }
 
  buildFaceCandidates(faceHits, faceMesh) {
    if (!faceHits || faceHits.length === 0) return [];
 
    const geom = faceMesh.geometry;
    const pos = geom.attributes.position.array;
    const matrixWorld = faceMesh.matrixWorld;
    const faceIdToRange = faceMesh.userData.faceIdToRange;
 
    const faces = [];
 
    for (const hit of faceHits) {
      const range = this.findRangeFromTriIndex(hit.faceIndex, faceIdToRange);
      const worldPoints = [];
      let faceId = null;
 
      if (range) {
        faceId = range.faceId;
        const startIndex = range.start * 3;
        const endIndex = (range.start + range.count) * 3;
 
        for (let i = startIndex; i < endIndex; i += 3) {
          const v = new THREE.Vector3().fromArray(pos, i).applyMatrix4(matrixWorld);
          worldPoints.push(v);
        }
      }
 
      faces.push({
        ...hit,
        faceId,
        vertices: worldPoints,
      });
    }
 
    return faces;
  }
 
  findRangeFromTriIndex(triIndex, faceIdToRange) {
    for (const fr of faceIdToRange.values()) {
      if (triIndex >= fr.triStart && triIndex < fr.triStart + fr.triCount) {
        return fr;
      }
    }
    return null;
  }

  // -------------------- Nearest-element resolution (screen space) --------------------
  pickNearestVertex(vertexHits, camera, rect) {
    let nearestVertexId = null;
    let minScreenDistSq = Infinity;
 
    const clickX = (this.mouse.x * 0.5 + 0.5) * rect.width;
    const clickY = (-this.mouse.y * 0.5 + 0.5) * rect.height;
 
    const screenPos = new THREE.Vector3();
    vertexHits.forEach(hit => {
      screenPos.copy(hit.point).project(camera);
      const sx = (screenPos.x * 0.5 + 0.5) * rect.width;
      const sy = (-screenPos.y * 0.5 + 0.5) * rect.height;
 
      const dx = sx - clickX;
      const dy = sy - clickY;
      const distPxSq = dx * dx + dy * dy;
 
      if (distPxSq < minScreenDistSq) {
        minScreenDistSq = distPxSq;
        nearestVertexId = hit.vertexId;
      }
    });
 
    return nearestVertexId;
  }
 
  pickNearestEdge(edgeHits, camera, rect) {
    if (!edgeHits || edgeHits.length === 0) return null;
 
    let nearestEdgeId = null;
    let minDistSq = Infinity;
 
    edgeHits.forEach(edgeHit => {
      const result = this.getClosestPointOnScreenLine(edgeHit, camera, rect);
 
      if (result.distSq < minDistSq) {
        minDistSq = result.distSq;
        nearestEdgeId = result.edgeId;
      }
    });
 
    return nearestEdgeId;
  }
 
  getClosestPointOnScreenLine(edgeHit, camera, rect) {
    // Mouse in pixel coordinates
    const clickX = (this.mouse.x * 0.5 + 0.5) * rect.width;
    const clickY = (-this.mouse.y * 0.5 + 0.5) * rect.height;
 
    const pA = new THREE.Vector3();
    const pB = new THREE.Vector3();
 
    // Project both endpoints to NDC → screen
    pA.copy(edgeHit.vA).project(camera);
    pB.copy(edgeHit.vB).project(camera);
 
    const x1 = (pA.x * 0.5 + 0.5) * rect.width;
    const y1 = (-pA.y * 0.5 + 0.5) * rect.height;
 
    const x2 = (pB.x * 0.5 + 0.5) * rect.width;
    const y2 = (-pB.y * 0.5 + 0.5) * rect.height;
 
    // Vector AB and AP
    const ABx = x2 - x1;
    const ABy = y2 - y1;
    const APx = clickX - x1;
    const APy = clickY - y1;
 
    const abLenSq = ABx * ABx + ABy * ABy;
 
    // Handle zero-length (rare but safe)
    let t = 0;
    if (abLenSq > 0) {
      t = (APx * ABx + APy * ABy) / abLenSq;
    }
 
    // Clamp to segment
    t = Math.max(0, Math.min(1, t));
 
    // Closest point
    const cx = x1 + ABx * t;
    const cy = y1 + ABy * t;
 
    const dx = cx - clickX;
    const dy = cy - clickY;
 
    return {
      cx,
      cy,
      distSq: dx * dx + dy * dy,
      t,
      edgeId: edgeHit.edgeId
    };
  }
}