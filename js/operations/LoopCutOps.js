import * as THREE from 'three';
import { getNeighborFaces, calculateFaceNormal, calculateVerticesNormal } from '../utils/AlignedNormalUtils.js';
import { LoopCutCommand } from '../commands/LoopCutCommand.js';
import { MeshDataRegion } from '../core/MeshDataRegion.js';

export class LoopCutOps {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.vertexEditor = editor.vertexEditor;
    this.editSelection = editor.editSelection;

    this.cutCount = 1; // persists across cuts, like before
  }

  setCutCount(count) {
    this.cutCount = Math.max(1, count);
    return this.cutCount;
  }

  /**
   * Cut the loop as one undoable step and select the result.
   * Returns { newVertexIds, newEdgeIds }, or null if there's nothing to cut.
   */
  cut(object, loopEdges, cutCount = this.cutCount) {
    const meshData = object?.userData?.meshData;
    if (!meshData || !loopEdges || loopEdges.length < 2) return null;

    this.vertexEditor.setObject(object);

    const beforeRegionIds = MeshDataRegion.expand(meshData, { edgeIds: loopEdges.map(e => e.id) }, 2);
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };

    const isClosed = LoopCutOps.isClosedLoop(loopEdges);
    const newVertices = LoopCutOps.createCutVertices(this.vertexEditor, meshData, loopEdges, cutCount);
    const newEdges = LoopCutOps.applyLoopCut(this.vertexEditor, meshData, loopEdges, newVertices, isClosed);

    this.editor.add(LoopCutOps.createCommand(this.editor, object, beforeSnapshot, startElements));
    this.signals.editSelectionRefresh.dispatch();
    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();

    const result = {
      newVertexIds: newVertices.flat().map(v => v.id),
      newEdgeIds: newEdges.map(e => e.id),
    };

    LoopCutOps.selectResult(this.editSelection, result);
    return result;
  }

  // Non-interactive API (no pointer, no preview).

  // Loop through the edge nearest a raycast hit on the object's render mesh, or null.
  static findLoopFromIntersect(meshData, renderBuffer, matrixWorld, intersect) {
    const startEdge = LoopCutOps.getStartEdgeFromIntersect(meshData, renderBuffer, matrixWorld, intersect);
    if (!startEdge) return null;

    const loopEdges = LoopCutOps.getLoopEdges(meshData, startEdge);
    return loopEdges.length >= 2 ? loopEdges : null;
  }

  static getStartEdgeFromIntersect(meshData, renderBuffer, matrixWorld, intersect) {
    if (!intersect?.face) return null;

    const { a, b, c } = intersect.face;
    const bufferIndexToVertexId = renderBuffer.bufferIndexToVertexId;

    const v1 = bufferIndexToVertexId.get(a);
    const v2 = bufferIndexToVertexId.get(b);
    const v3 = bufferIndexToVertexId.get(c);

    const edges = [
      meshData.getEdge(v1, v2),
      meshData.getEdge(v2, v3),
      meshData.getEdge(v3, v1),
    ].filter(Boolean);

    return LoopCutOps.findNearestEdge(meshData, matrixWorld, edges, intersect.point);
  }

  static findNearestEdge(meshData, matrixWorld, edges, worldPoint) {
    let nearestEdge = null;
    let minDistance = Infinity;

    const line = new THREE.Line3();
    const closestPoint = new THREE.Vector3();

    for (const edge of edges) {
      const v1 = meshData.getVertex(edge.v1Id);
      const v2 = meshData.getVertex(edge.v2Id);
      if (!v1 || !v2) continue;

      line.start.copy(v1.position).applyMatrix4(matrixWorld);
      line.end.copy(v2.position).applyMatrix4(matrixWorld);
      line.closestPointToPoint(worldPoint, true, closestPoint);

      const dist = closestPoint.distanceTo(worldPoint);
      if (dist < minDistance) {
        minDistance = dist;
        nearestEdge = edge;
      }
    }

    return nearestEdge;
  }

  // Walk across quads on both sides of startEdge. Closed loops come back as [start, ..., start].
  static getLoopEdges(meshData, startEdge) {
    const neighborFaces = getNeighborFaces(meshData, [startEdge.id]);
    if (neighborFaces.length === 0) return [];

    let leftLoop = [];
    let rightLoop = [];
    let closedLoop = false;

    if (neighborFaces[0]) {
      const result = LoopCutOps.traverseEdgeLoop(meshData, startEdge, neighborFaces[0].face);
      leftLoop = result.edges;
      closedLoop ||= result.closedLoop;
    }

    if (!closedLoop && neighborFaces[1]) {
      const result = LoopCutOps.traverseEdgeLoop(meshData, startEdge, neighborFaces[1].face);
      rightLoop = result.edges;
      closedLoop ||= result.closedLoop;
    }

    return closedLoop
      ? [startEdge, ...leftLoop, startEdge]
      : [...leftLoop.reverse(), startEdge, ...rightLoop];
  }

  static traverseEdgeLoop(meshData, startEdge, startFace) {
    const visited = new Set();
    const directionEdges = [];
    let closedLoop = false;
    let currentEdge = startEdge;
    let currentFace = startFace;

    while (currentEdge && !visited.has(currentEdge.id)) {
      visited.add(currentEdge.id);

      if (currentEdge !== startEdge) directionEdges.push(currentEdge);

      const neighborFaces = getNeighborFaces(meshData, [currentEdge.id]);
      const nextFaceData = neighborFaces.length === 1 && currentEdge === startEdge
        ? neighborFaces[0]
        : neighborFaces.find(n => n.face && n.face.id !== currentFace.id);
      if (!nextFaceData) break;

      const nextFace = nextFaceData.face;
      if (nextFace.vertexIds.length !== 4) break; // only quads

      const oppositeEdge = LoopCutOps.getOppositeEdgeInFace(meshData, nextFace, currentEdge);
      if (!oppositeEdge) break;

      if (visited.has(oppositeEdge.id)) {
        closedLoop = true;
        break;
      }

      currentEdge = oppositeEdge;
      currentFace = nextFace;
    }

    return { edges: directionEdges, closedLoop };
  }

  static getOppositeEdgeInFace(meshData, face, edge) {
    for (const edgeId of face.edgeIds) {
      const candidate = meshData.edges.get(edgeId);
      if (!candidate) continue;

      const { v1Id, v2Id } = candidate;
      const sharesVertex =
        v1Id === edge.v1Id || v1Id === edge.v2Id || v2Id === edge.v1Id || v2Id === edge.v2Id;

      if (!sharesVertex) return candidate;
    }

    return null;
  }

  static findSharedFace(meshData, edgeA, edgeB) {
    for (const fId of edgeA.faceIds) {
      if (edgeB.faceIds.has(fId)) return meshData.faces.get(fId);
    }
    return null;
  }

  static isClosedLoop(loopEdges) {
    return loopEdges.length > 1 && loopEdges[0].id === loopEdges[loopEdges.length - 1].id;
  }

  // Orient every rung so v1 sits on the same side of the loop.
  static getAlignedEdgeVertices(meshData, loopEdges) {
    const aligned = [];
    let lastVertex = null;

    for (const edge of loopEdges) {
      let v1 = meshData.getVertex(edge.v1Id);
      let v2 = meshData.getVertex(edge.v2Id);

      if (lastVertex && !meshData.getEdge(lastVertex.id, v1.id)) {
        [v1, v2] = [v2, v1];
      }

      aligned.push({ v1, v2 });
      lastVertex = v1;
    }

    return aligned;
  }

  // Local-space cut positions: result[c][i] is cut c on rung i, for the first `rungCount` rungs.
  static computeCutPositions(aligned, cutCount, rungCount = aligned.length) {
    const positions = [];

    for (let c = 0; c < cutCount; c++) {
      const t = (c + 1) / (cutCount + 1);
      const row = [];

      for (let i = 0; i < rungCount; i++) {
        row.push(new THREE.Vector3().lerpVectors(aligned[i].v1.position, aligned[i].v2.position, t));
      }

      positions.push(row);
    }

    return positions;
  }

  // World-space polylines (flat xyz arrays, one per cut) for previewing the cut.
  static computePreviewPolylines(meshData, matrixWorld, loopEdges, cutCount) {
    const aligned = LoopCutOps.getAlignedEdgeVertices(meshData, loopEdges);

    return LoopCutOps.computeCutPositions(aligned, cutCount).map(row =>
      row.flatMap(p => {
        p.applyMatrix4(matrixWorld);
        return [p.x, p.y, p.z];
      })
    );
  }

  // newVertices[c][i] is the vertex for cut c on rung i (the closing duplicate of a closed loop is skipped).
  static createCutVertices(vertexEditor, meshData, loopEdges, cutCount) {
    const rungCount = LoopCutOps.isClosedLoop(loopEdges) ? loopEdges.length - 1 : loopEdges.length;
    const aligned = LoopCutOps.getAlignedEdgeVertices(meshData, loopEdges);

    return LoopCutOps.computeCutPositions(aligned, cutCount, rungCount)
      .map(row => row.map(pos => vertexEditor.addVertex(pos)));
  }

  // Replace every quad between consecutive rungs with (cutCount + 1) quads, then remove the old rungs.
  static applyLoopCut(vertexEditor, meshData, loopEdges, newVertices, isClosed) {
    const newEdges = [];
    const cutCount = newVertices.length;
    const rungCount = isClosed ? loopEdges.length - 1 : loopEdges.length;

    const aligned = LoopCutOps.getAlignedEdgeVertices(meshData, loopEdges);

    for (let i = 0; i < loopEdges.length - 1; i++) {
      const face = LoopCutOps.findSharedFace(meshData, loopEdges[i], loopEdges[i + 1]);
      if (!face) continue;

      const originalFaceNormal = calculateFaceNormal(meshData, face);
      vertexEditor.deleteFace(face);

      const next = (i + 1) % rungCount;
      const alignA = aligned[i];
      const alignB = aligned[next];

      const chainA = [alignA.v1];
      const chainB = [alignB.v1];

      for (let c = 0; c < cutCount; c++) {
        chainA.push(newVertices[c][i]);
        chainB.push(newVertices[c][next]);
      }

      chainA.push(alignA.v2);
      chainB.push(alignB.v2);

      // Create quads, wound like the face they replace
      for (let j = 0; j < chainA.length - 1; j++) {
        const quad = [chainA[j], chainB[j], chainB[j + 1], chainA[j + 1]];

        if (calculateVerticesNormal(quad).dot(originalFaceNormal) < 0) quad.reverse();

        vertexEditor.addFace(quad);
      }

      // Collect new loop edges
      for (let c = 0; c < cutCount; c++) {
        const splitEdge = meshData.getEdge(newVertices[c][i].id, newVertices[c][next].id);
        if (splitEdge) newEdges.push(splitEdge);
      }
    }

    // Open loops: splice the cut vertices into the faces beyond the first and last rungs
    if (!isClosed) {
      const last = loopEdges.length - 1;

      LoopCutOps.insertEdgeVertices(vertexEditor, meshData, loopEdges[0], newVertices.map(row => row[0]), aligned[0]);
      LoopCutOps.insertEdgeVertices(vertexEditor, meshData, loopEdges[last], newVertices.map(row => row[last]), aligned[last]);
    }

    for (const edge of loopEdges) {
      vertexEditor.deleteEdge(edge);
    }

    return newEdges;
  }

  static insertEdgeVertices(vertexEditor, meshData, edge, edgeVertices, alignedEdge) {
    const startId = alignedEdge.v1.id;
    const endId = alignedEdge.v2.id;

    const neighborFaces = getNeighborFaces(meshData, [edge.id]).map(n => n.face);

    for (const face of neighborFaces) {
      if (!face) continue;

      const newVertexIds = [];
      const len = face.vertexIds.length;

      for (let i = 0; i < len; i++) {
        const current = face.vertexIds[i];
        const next = face.vertexIds[(i + 1) % len];
        newVertexIds.push(current);

        if (current === startId && next === endId) {
          for (let j = 0; j < edgeVertices.length; j++) newVertexIds.push(edgeVertices[j].id);
        } else if (current === endId && next === startId) {
          for (let j = edgeVertices.length - 1; j >= 0; j--) newVertexIds.push(edgeVertices[j].id);
        }
      }

      vertexEditor.deleteFace(face);
      vertexEditor.addFace(newVertexIds.map(id => meshData.getVertex(id)));
    }
  }

  /**
   * Build the undo command for a cut that is already applied to meshData.
   * Mutates beforeSnapshot (captures new element ids), so call it once.
   */
  static createCommand(editor, object, beforeSnapshot, startElements) {
    const meshData = object.userData.meshData;

    MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);
    const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    return new LoopCutCommand(editor, object, beforeSnapshot, afterSnapshot);
  }

  static selectResult(editSelection, { newVertexIds, newEdgeIds }) {
    const mode = editSelection.subSelectionMode;

    if (mode === 'vertex') editSelection.selectVertices(newVertexIds);
    else if (mode === 'edge') editSelection.selectEdges(newEdgeIds);
    else if (mode === 'face') editSelection.clearSelection();
  }
}