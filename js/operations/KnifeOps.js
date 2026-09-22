import * as THREE from 'three';
import { KnifeCommand } from '../commands/KnifeCommand.js';
import { MeshDataRegion } from '../core/MeshDataRegion.js';

export class KnifeOps {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.vertexEditor = editor.vertexEditor;
    this.editSelection = editor.editSelection;
  }

  /**
   * Apply a cut plan to the object as one undoable step and select the result.
   * Returns { newVertexIds, newEdgeIds }, or null if the plan has nothing to cut.
   */
  cut(object, plan) {
    const meshData = object?.userData?.meshData;
    if (!meshData || !plan?.points.length) return null;

    this.vertexEditor.setObject(object);

    const seedEdgeIds = plan.points.filter(p => p.edge).map(p => p.edge.id);
    const seedVertexIds = plan.points.filter(p => !p.edge && p.snapVertexId !== null).map(p => p.snapVertexId);

    const beforeRegionIds = MeshDataRegion.expand(meshData, { edgeIds: seedEdgeIds, vertexIds: seedVertexIds }, 2);
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };

    const result = KnifeOps.applyCut(this.vertexEditor, object, plan);

    this.editor.add(KnifeOps.createCommand(this.editor, object, beforeSnapshot, startElements));
    this.signals.editSelectionRefresh.dispatch();
    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();

    KnifeOps.selectResult(this.editSelection, result);

    return result;
  }

  // Non-interactive API (no pointer, no preview).

  /**
   * Intersect the cut with candidate edges. The cut surface is the plane through a and b that
   * contains the view direction, so the cut follows what the camera sees; intersections are kept
   * only if they fall between a and b on screen.
   * candidateEdgeIds narrows the search (the tool uses the GPU edge picker); pass all edge ids otherwise.
   */
  static computeCutPlan(meshData, matrixWorld, camera, aCut, bCut, candidateEdgeIds) {
    const aPos = aCut.position;
    const bPos = bCut.position;
    const points = [];

    if (aCut.snapVertexId !== null) {
      points.push({ position: aPos.clone(), edge: null, snapVertexId: aCut.snapVertexId });
    }

    const midPoint = new THREE.Vector3().addVectors(aPos, bPos).multiplyScalar(0.5);

    let cameraDir;
    if (camera.isPerspectiveCamera) {
      cameraDir = new THREE.Vector3().subVectors(camera.position, midPoint).normalize();
    } else if (camera.isOrthographicCamera) {
      cameraDir = new THREE.Vector3();
      camera.getWorldDirection(cameraDir).normalize().negate();
    }

    const segmentDir = new THREE.Vector3().subVectors(bPos, aPos).normalize();
    const planeNormal = new THREE.Vector3().crossVectors(segmentDir, cameraDir).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, aPos);

    const skipVIdA = aCut.snapVertexId;
    const skipVIdB = bCut.snapVertexId;

    for (const edgeId of candidateEdgeIds) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      // Skip edges touching snapped endpoints
      if (skipVIdA !== null && (edge.v1Id === skipVIdA || edge.v2Id === skipVIdA)) continue;
      if (skipVIdB !== null && (edge.v1Id === skipVIdB || edge.v2Id === skipVIdB)) continue;

      const p1 = new THREE.Vector3().copy(meshData.getVertex(edge.v1Id).position).applyMatrix4(matrixWorld);
      const p2 = new THREE.Vector3().copy(meshData.getVertex(edge.v2Id).position).applyMatrix4(matrixWorld);

      const intersection = plane.intersectLine(new THREE.Line3(p1, p2), new THREE.Vector3());
      if (!intersection) continue;

      if (!KnifeOps.isIntersectionWithinScreenSegment(aPos, bPos, intersection, camera)) continue;

      points.push({ position: intersection, edge, snapVertexId: null });
    }

    if (bCut.snapVertexId !== null) {
      points.push({ position: bPos.clone(), edge: null, snapVertexId: bCut.snapVertexId });
    }

    return { a: aCut, b: bCut, points: KnifeOps.dedupePoints(points, aPos) };
  }

  static isIntersectionWithinScreenSegment(a, b, intersection, camera) {
    const ndcA = a.clone().project(camera);
    const ndcB = b.clone().project(camera);
    const ndcI = intersection.clone().project(camera);

    const ab = new THREE.Vector2(ndcB.x - ndcA.x, ndcB.y - ndcA.y);
    const ai = new THREE.Vector2(ndcI.x - ndcA.x, ndcI.y - ndcA.y);

    const abLen = ab.length();
    if (abLen === 0) return false;

    const projLen = ai.dot(ab.normalize());
    return projLen >= 0 && projLen <= abLen;
  }

  // Sort along the cut (distance from aPos) and drop near-coincident points, keeping the first.
  static dedupePoints(points, aPos, eps = 1e-4) {
    const sorted = [...points].sort((p, q) => p.position.distanceTo(aPos) - q.position.distanceTo(aPos));
    const unique = [];

    for (const point of sorted) {
      const prev = unique[unique.length - 1];
      if (!prev || prev.position.distanceTo(point.position) > eps) unique.push(point);
    }

    return unique;
  }

  // True if the cut would only retrace existing vertices and edges (so there's nothing to cut).
  static matchesExistingPolyline(meshData, matrixWorld, plan) {
    const { a, b, points } = plan;

    if (a.snapVertexId !== null && a.snapVertexId === b.snapVertexId) return true;

    const invMatrix = new THREE.Matrix4().copy(matrixWorld).invert();
    const vertexIds = [];

    for (const point of points) {
      let vId = null;

      if (point.edge) {
        const localPoint = point.position.clone().applyMatrix4(invMatrix);
        const v1Pos = new THREE.Vector3().copy(meshData.getVertex(point.edge.v1Id).position);
        const v2Pos = new THREE.Vector3().copy(meshData.getVertex(point.edge.v2Id).position);

        if (localPoint.distanceTo(v1Pos) < 1e-4) vId = point.edge.v1Id;
        else if (localPoint.distanceTo(v2Pos) < 1e-4) vId = point.edge.v2Id;
      } else {
        vId = point.snapVertexId;
      }

      if (vId === null) return false;
      vertexIds.push(vId);
    }

    for (let i = 0; i < vertexIds.length - 1; i++) {
      if (!meshData.getEdge(vertexIds[i], vertexIds[i + 1])) return false;
    }

    return true;
  }

  /**
   * Split every face crossed by the plan. Faces cut once get the new vertex inserted into their loop;
   * faces cut twice are split in two along the new edge. Crossed edges are removed afterwards.
   * vertexEditor must be set to the object. Returns { newVertexIds, newEdgeIds }.
   */
  static applyCut(vertexEditor, object, plan) {
    const meshData = object.userData.meshData;
    const worldToLocal = new THREE.Matrix4().copy(object.matrixWorld).invert();
    const { points } = plan;

    // One vertex per point: a new one on crossed edges, the existing one for snaps
    const newVertices = points.map(point => {
      if (!point.edge) return meshData.getVertex(point.snapVertexId);

      const localPos = point.position.clone().applyMatrix4(worldToLocal);
      return vertexEditor.addVertex({ x: localPos.x, y: localPos.y, z: localPos.z });
    });

    const pointIndexByEdgeId = new Map();
    points.forEach((point, i) => {
      if (point.edge && !pointIndexByEdgeId.has(point.edge.id)) pointIndexByEdgeId.set(point.edge.id, i);
    });

    const snapVertexIds = new Set(
      [plan.a.snapVertexId, plan.b.snapVertexId].filter(id => id !== null && id !== undefined)
    );

    // Collect affected faces
    const affectedFaces = new Set();
    for (let i = 0; i < points.length; i++) {
      const edge = points[i].edge;

      if (edge) {
        for (const faceId of edge.faceIds) {
          const face = meshData.faces.get(faceId);
          if (face) affectedFaces.add(face);
        }
      } else {
        KnifeOps.collectSnapAffectedFaces(meshData, points, i, affectedFaces);
      }
    }

    const newEdgeIds = [];

    for (const face of affectedFaces) {
      const vertexIds = face.vertexIds;
      const faceCuts = [];

      // Find the cuts on this face's loop
      for (let i = 0; i < vertexIds.length; i++) {
        const v1 = vertexIds[i];
        const v2 = vertexIds[(i + 1) % vertexIds.length];
        const edge = meshData.getEdge(v1, v2);

        const pointIndex = edge ? pointIndexByEdgeId.get(edge.id) : undefined;
        if (pointIndex !== undefined) {
          faceCuts.push({ edgeIndex: i, newVertex: newVertices[pointIndex] });
        }

        if (snapVertexIds.has(v1)) {
          faceCuts.push({ edgeIndex: i, newVertex: meshData.getVertex(v1) });
        }
      }

      if (faceCuts.length === 0) continue;

      vertexEditor.deleteFace(face);

      if (faceCuts.length === 1) {
        const { edgeIndex, newVertex } = faceCuts[0];
        const newFaceVerts = [];

        for (let i = 0; i < vertexIds.length; i++) {
          const v = meshData.getVertex(vertexIds[i]);
          newFaceVerts.push(v);
          if (i === edgeIndex && v !== newVertex) newFaceVerts.push(newVertex);
        }

        vertexEditor.addFace(newFaceVerts);
      } else if (faceCuts.length === 2) {
        const [cutA, cutB] = faceCuts;

        vertexEditor.addFace(KnifeOps.buildFaceFromCuts(vertexIds, meshData, cutA, cutB));
        vertexEditor.addFace(KnifeOps.buildFaceFromCuts(vertexIds, meshData, cutB, cutA));

        const newEdge = meshData.getEdge(cutA.newVertex.id, cutB.newVertex.id);
        if (newEdge) newEdgeIds.push(newEdge.id);
      }
    }

    // Remove all crossed edges (snap points have no edge)
    for (const point of points) {
      if (point.edge) vertexEditor.deleteEdge(point.edge);
    }

    return {
      newVertexIds: newVertices.filter(Boolean).map(v => v.id),
      newEdgeIds,
    };
  }

  // Faces a snapped endpoint cuts through, inferred from the neighbouring point along the cut.
  static collectSnapAffectedFaces(meshData, points, index, affectedFaces) {
    const point = points[index];
    if (point.snapVertexId === null) return;

    const snapVertex = meshData.getVertex(point.snapVertexId);
    if (!snapVertex) return;

    const prev = points[index - 1] ?? null;
    const next = points[index + 1] ?? null;

    const sourceEdge = prev?.edge || next?.edge || null;

    // Edge-based face inference
    if (sourceEdge) {
      for (const faceId of sourceEdge.faceIds) {
        if (!snapVertex.faceIds.has(faceId)) continue;

        const face = meshData.faces.get(faceId);
        if (face) affectedFaces.add(face);
      }
      return;
    }

    // No edges → pure snap-to-snap segment
    const snapNeighbor = [prev, next].find(p => p && !p.edge && p.snapVertexId !== null);
    const sourceSnapVertex = snapNeighbor ? meshData.getVertex(snapNeighbor.snapVertexId) : null;
    if (!sourceSnapVertex) return;

    for (const faceId of snapVertex.faceIds) {
      if (!sourceSnapVertex.faceIds.has(faceId)) continue;

      const face = meshData.faces.get(faceId);
      if (face) affectedFaces.add(face);
    }
  }

  // Walk the face loop from startCut to endCut, producing one half of a split face.
  static buildFaceFromCuts(vertexIds, meshData, startCut, endCut) {
    const verts = [startCut.newVertex];
    const len = vertexIds.length;

    let i = (startCut.edgeIndex + 1) % len;
    const stop = (endCut.edgeIndex + 1) % len;

    while (i !== stop) {
      const v = meshData.getVertex(vertexIds[i]);
      if (v !== startCut.newVertex && v !== endCut.newVertex) verts.push(v);
      i = (i + 1) % len;
    }

    if (verts[verts.length - 1] !== endCut.newVertex) verts.push(endCut.newVertex);
    return verts;
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

    return new KnifeCommand(editor, object, beforeSnapshot, afterSnapshot);
  }

  static selectResult(editSelection, { newVertexIds, newEdgeIds }) {
    const mode = editSelection.subSelectionMode;

    if (mode === 'vertex') editSelection.selectVertices(newVertexIds);
    else if (mode === 'edge') editSelection.selectEdges(newEdgeIds);
    else if (mode === 'face') editSelection.clearSelection();
  }
}