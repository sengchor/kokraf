import * as THREE from 'three';
import { calculateFaceNormal, getCentroidFromVertices, calculateVertexNormal } from '../utils/AlignedNormalUtils.js';
import { BevelCommand } from '../commands/BevelCommand.js';
import { MeshDataRegion } from '../core/MeshDataRegion.js';
import { MeshRendererAdapter } from '../geometry/MeshRendererAdapter.js';

export const BevelCommitResult = Object.freeze({
  COMMITTED: 'committed',
  CANCELLED: 'cancelled',
  INVALID: 'invalid',
  EMPTY: 'empty',
});

export class BevelOps {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.vertexEditor = editor.vertexEditor;
    this.editSelection = editor.editSelection;

    this.segments = 1;
    this.session = null;
  }

  get width() {
    return this.session?.width ?? null;
  }

  // Session
  beginSession(object, handle) {
    const meshData = object?.userData?.meshData;
    if (!meshData || !handle) return null;

    this.vertexEditor.setObject(object);

    const edgeIds = BevelOps.filterValidEdges(meshData, Array.from(this.editSelection.selectedEdgeIds));

    this.session = {
      object,
      edgeIds,
      pivotPosition: handle.getWorldPosition(new THREE.Vector3()),
      width: 0,
      builder: null, // built lazily on the first apply
    };

    return this.session;
  }

  hasSession() {
    return this.session !== null;
  }

  isValid() {
    return !!this.session && this.session.edgeIds.length > 0;
  }

  isBuilt() {
    return !!this.session?.builder;
  }

  endSession() {
    this.session = null;
  }

  // Builds the bevel topology once per session (or again after a segment change).
  build(handle) {
    const s = this.session;
    if (!s || !this.isValid()) return null;
    if (s.builder) return s.builder;

    return this.rebuild(handle, handle.position.clone());
  }

  rebuild(handle, keepHandlePosition) {
    const s = this.session;

    const builder = new BevelBuilder(this.vertexEditor, s.object, this.segments).build(s.edgeIds);
    s.builder = builder;

    this.signals.editSelectionRefresh.dispatch();

    // Selecting the new faces re-centres the handle; put it back where the input left it.
    this.editSelection.selectFaces(builder.newFaceIds);
    handle.position.copy(keepHandlePosition);

    return builder;
  }

  setWidth(value) {
    const s = this.session;
    if (!s?.builder) return false;

    s.width = value || 0;
    s.builder.applyWidth(s.width);
    return true;
  }

  // Changes the segment count; mid-session this restores the mesh and rebuilds at the current width.
  setSegments(segments, handle) {
    this.segments = Math.max(1, segments);

    const s = this.session;
    if (!s?.builder || !handle) return this.segments;

    const keepHandlePosition = handle.position.clone();

    s.builder.restore();
    s.builder = null;

    this.rebuild(handle, keepHandlePosition).applyWidth(s.width);
    return this.segments;
  }

  commit(handle) {
    const s = this.session;
    if (!s) return null;

    if (!this.isValid()) {
      this.endSession();
      return BevelCommitResult.INVALID;
    }

    if (!s.builder) {
      this.endSession();
      return BevelCommitResult.EMPTY;
    }

    if (!s.width) {
      this.cancel(handle);
      return BevelCommitResult.CANCELLED;
    }

    const { object, builder } = s;
    this.vertexEditor.setObject(object);

    this.editor.add(BevelOps.createCommand(this.editor, object, builder));
    this.signals.editSelectionRefresh.dispatch();
    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();

    BevelOps.selectResult(this.editSelection, builder);

    this.endSession();
    return BevelCommitResult.COMMITTED;
  }

  // Restores the mesh, handle and original edge selection, then ends the session.
  cancel(handle) {
    const s = this.session;
    if (!s) return;

    if (s.builder) {
      s.builder.restore();
      this.editSelection.selectEdges(s.edgeIds);
    }

    if (handle) {
      handle.position.copy(s.pivotPosition);
      handle.updateMatrixWorld(true);
    }

    this.endSession();
  }

  // Non-interactive API (no gizmo, no session).

  // Only manifold edges (exactly two faces) can be beveled.
  static filterValidEdges(meshData, edgeIds) {
    const valid = [];

    for (const edgeId of edgeIds) {
      const edge = meshData.edges.get(edgeId);
      if (edge?.faceIds && edge.faceIds.size === 2) valid.push(edgeId);
    }

    return valid;
  }

  /**
   * Build the undo command for a bevel that is already applied to meshData.
   * Mutates builder.beforeSnapshot (captures new element ids), so call it once per builder.
   */
  static createCommand(editor, object, builder) {
    const meshData = object.userData.meshData;

    MeshDataRegion.captureNewElements(meshData, builder.startElements, builder.beforeSnapshot);
    const afterRegionIds = MeshDataRegion.idsOf(builder.beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    return new BevelCommand(editor, object, builder.beforeSnapshot, afterSnapshot);
  }

  static selectResult(editSelection, builder) {
    const mode = editSelection.subSelectionMode;

    editSelection.clearSelection();

    if (mode === 'vertex') editSelection.selectVertices(builder.newVertexIds);
    else if (mode === 'edge') editSelection.selectEdges(builder.newEdgeIds);
    else if (mode === 'face') editSelection.selectFaces(builder.newFaceIds);
  }
}

/**
 * The bevel algorithm. One builder = one bevel of a fixed set of edges at a fixed segment count.
 * build() creates the topology at zero width, applyWidth() moves the new vertices,
 * restore() rolls the mesh back to before build(). Discard the builder after restore().
 */
export class BevelBuilder {
  constructor(vertexEditor, object, segments = 1) {
    this.vertexEditor = vertexEditor;
    this.object = object;
    this.meshData = object.userData.meshData;
    this.segments = Math.max(1, segments);

    this.edgeIds = [];
    this.beforeSnapshot = null;
    this.startElements = null;

    this.newVertexIds = [];
    this.newEdgeIds = [];
    this.newFaceIds = [];
    this.cornerPatches = [];
    this.neighborFaceIds = new Set();
    this.bevelMoveData = new Map();
    this.segmentMoveData = new Map();
    this.segmentEdgeMap = new Map();
  }

  toWorld(position) {
    return new THREE.Vector3().copy(position).applyMatrix4(this.object.matrixWorld);
  }

  toLocal(worldPosition) {
    return worldPosition.clone().applyMatrix4(new THREE.Matrix4().copy(this.object.matrixWorld).invert());
  }

  // Lifecycle
  build(edgeIds) {
    const meshData = this.meshData;
    this.vertexEditor.setObject(this.object);
    this.edgeIds = edgeIds;

    const vertexIds = this.getVertexIdsFromEdges(meshData, edgeIds);
    const beforeRegionIds = MeshDataRegion.expand(meshData, { vertexIds, edgeIds, faceIds: [] }, 2);
    this.beforeSnapshot = MeshDataRegion.snapshot(meshData, beforeRegionIds);

    this.startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };

    const edgeGroups = this.vertexEditor.topology.groupConnectedEdges(meshData, edgeIds);

    for (const edgeGroup of edgeGroups) {
      const groupNeighborFaceIds = this.getFacesAdjacentToEdgeVertices(meshData, edgeGroup);
      for (const faceId of groupNeighborFaceIds) this.neighborFaceIds.add(faceId);

      const vertexGraph = this.vertexEditor.topology.buildSelectedVertexGraph(meshData, edgeGroup);
      const bevelResults = new Map();

      for (const [vId, vertexInfo] of vertexGraph) {
        let result;
        if (vertexInfo.valence === 1) result = this.bevelEndVertex(meshData, vertexInfo);
        else if (vertexInfo.valence === 2) result = this.bevelCornerVertex(meshData, vertexInfo);
        else result = this.bevelJunctionVertex(meshData, vertexInfo);

        if (result) bevelResults.set(vId, result);
      }

      const splitFaces = this.applyBevelFaceSubstitutions(meshData, bevelResults);
      const bridgeFaceIds = this.createBridgeFaces(meshData, edgeGroup, bevelResults);

      this.insertFaceSegments(meshData, splitFaces);

      for (const faceId of groupNeighborFaceIds) {
        const face = meshData.faces.get(faceId);
        if (!face) continue;

        this.rebuildFaceTopology(meshData, face);
      }

      const fillFaceIds = this.fillBevelCornerFaces(meshData, bevelResults);

      this.deleteOldEdgeVertices(meshData, edgeGroup);

      const groupFaceIds = [...bridgeFaceIds, ...fillFaceIds];
      this.newVertexIds.push(...this.getVertexIdsFromFaces(meshData, groupFaceIds));
      this.newEdgeIds.push(...this.getEdgeIdsFromFaces(meshData, groupFaceIds));
      this.newFaceIds.push(...groupFaceIds);
    }

    // Recomputes every vertex from scratch, so one pass after all groups is enough.
    this.solveBevelScales();

    return this;
  }

  restore() {
    this.vertexEditor.setObject(this.object);
    MeshDataRegion.captureNewElements(this.meshData, this.startElements, this.beforeSnapshot);
    this.vertexEditor.applyDelta(this.beforeSnapshot);
  }

  applyWidth(width) {
    const meshData = this.meshData;
    this.vertexEditor.setObject(this.object);

    // Move boundary bevel vertices
    const boundaryIds = [];
    const boundaryPositions = [];

    for (const moveData of this.bevelMoveData.values()) {
      const newPosition = moveData.basePosition.clone().add(
        moveData.direction.clone().multiplyScalar(width * moveData.scaleFactor)
      );

      boundaryIds.push(moveData.vertexId);
      boundaryPositions.push(newPosition);
    }

    this.vertexEditor.transform.setVertexPositions(boundaryIds, boundaryPositions);

    // Move segment vertices
    const segmentIds = [];
    const segmentPositions = [];

    for (const segData of this.segmentMoveData.values()) {
      const { vertexId, endVertexIds, segmentIndex, edgeDirection } = segData;

      const startVertexPos = this.toWorld(meshData.getVertex(endVertexIds[0]).position);
      const endVertexPos = this.toWorld(meshData.getVertex(endVertexIds[1]).position);
      const midVertexPos = startVertexPos.clone().add(endVertexPos).multiplyScalar(0.5);

      const moveData = this.bevelMoveData.get(endVertexIds[0]);
      const basePosition = moveData.basePosition.clone();

      const offset = midVertexPos.clone().sub(basePosition).dot(edgeDirection);
      const controlPoint = basePosition.clone();
      if (moveData.valence > 2) {
        controlPoint.add(edgeDirection.clone().multiplyScalar(offset));
      }

      const t = segmentIndex / this.segments;
      segmentIds.push(vertexId);
      segmentPositions.push(this.quadraticBezierPoint(startVertexPos, controlPoint, endVertexPos, t));
    }

    this.vertexEditor.transform.setVertexPositions(segmentIds, segmentPositions);

    // Move corner patch vertices
    const cornerIds = [];
    const cornerPositions = [];

    for (const patch of this.cornerPatches) {
      const result = this.vertexEditor.subdivide.updateInsetSubdivideVertices(
        patch.vertexOrderPerLayer,
        this.segments,
        patch.targetPosition
      );

      cornerIds.push(...result.vertexIds);
      cornerPositions.push(...result.vertexPositions);
    }

    this.vertexEditor.transform.setVertexPositions(cornerIds, cornerPositions);

    for (const faceId of this.neighborFaceIds) {
      const face = meshData.faces.get(faceId);
      if (!face) continue;

      this.rebuildFaceTopology(meshData, face);
    }
  }

  // Scale solving
  solveBevelScales() {
    const MITER_LIMIT = 5.0;
    const EPS = 1e-6;

    // Pre-calculate efficiency for each constrained edge
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

    // Global harmonization
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

            accumulatedScale += neighborData.scaleFactor * (neighborEff / myEff);
            weightSum++;
          }
        }

        nextScales.set(vertexId, accumulatedScale / weightSum);
      }

      for (const [vertexId, newScale] of nextScales) {
        this.bevelMoveData.get(vertexId).scaleFactor = Math.min(newScale, MITER_LIMIT);
      }
    }
  }

  calculateScaleFactor(dir1, dir2) {
    const EPS = 0.001;
    const dot = THREE.MathUtils.clamp(dir1.dot(dir2), -1, 1);
    const sin = Math.sqrt(1 - dot * dot);
    return sin > EPS ? 1 / sin : 1;
  }

  // Face substitution
  applyBevelFaceSubstitutions(meshData, bevelResults) {
    const pendingFaceUpdates = new Map();
    const splitFaces = new Set();

    for (const [originalVertexId, result] of bevelResults) {
      const { faceVertexMap, edgeVertexMap } = result;

      for (const [faceId, newVertexIds] of faceVertexMap) {
        if (!pendingFaceUpdates.has(faceId)) {
          pendingFaceUpdates.set(faceId, new Map());
        }

        let orderedSplit;
        if (newVertexIds.length >= 2) {
          orderedSplit = this.getOrderedSplit(meshData, faceId, originalVertexId, edgeVertexMap);
          splitFaces.add(faceId);
        } else {
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
          const oldVertex = meshData.getVertex(oldVId);
          if (oldVertex) oldVertex.faceIds.delete(faceId);

          finalVertexIds.push(...substitutions.get(oldVId));
        } else {
          finalVertexIds.push(oldVId);
        }
      }

      face.vertexIds = finalVertexIds;
    }

    return splitFaces;
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

    const vPos = this.toWorld(vertex.position);
    const oPos = this.toWorld(otherEdgeV.position);
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

      const p1 = this.toWorld(vertex.position);
      const p2 = this.toWorld(otherV.position);

      const basePosition = p1.clone();
      let direction = p2.clone().sub(p1).normalize();

      const newVertex = this.vertexEditor.addVertex(this.toLocal(basePosition));
      newVertexIds.push(newVertex.id);

      if (Math.abs(direction.dot(edgeDirection)) === 1) {
        const sharedFaceIds = [...connectedEdge.faceIds].filter(fid => edge.faceIds.has(fid));

        if (sharedFaceIds.length > 0) {
          const face = meshData.faces.get(sharedFaceIds[0]);
          const faceNormal = calculateFaceNormal(meshData, face);

          direction = new THREE.Vector3().crossVectors(faceNormal, direction).normalize();

          const centroid = getCentroidFromVertices(face.vertexIds, meshData).applyMatrix4(this.object.matrixWorld);
          const inwardGuide = new THREE.Vector3().subVectors(centroid, p1);
          if (direction.dot(inwardGuide) < 0) {
            direction.negate();
          }
        }
      }

      const edgeScaleConstraints = new Map();
      edgeScaleConstraints.set(selectedEdgeId, this.calculateScaleFactor(direction, edgeDirection));

      this.bevelMoveData.set(newVertex.id, {
        originalVertexId: vertexId,
        vertexId: newVertex.id,
        basePosition,
        direction: direction.clone(),
        scaleFactor: 1,
        edgeScaleConstraints,
        neighborNewVertexIds: [],
        edgeDirections: [edgeDirection],
        valence,
      });

      for (const faceId of connectedEdge.faceIds) {
        const face = meshData.faces.get(faceId);
        if (!face) continue;
        if (!face.vertexIds.includes(vertexId)) continue;

        if (!faceVertexMap.has(faceId)) faceVertexMap.set(faceId, []);

        const vertices = faceVertexMap.get(faceId);
        if (!vertices.includes(newVertex.id)) vertices.push(newVertex.id);
      }

      edgeVertexMap.set(connectedEdge.id, newVertex.id);
    }

    return {
      valence,
      originalVertexId: vertexId,
      newVertexIds,
      selectedEdgeId,
      faceVertexMap,
      edgeVertexMap,
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

    const p0 = this.toWorld(vertex.position);
    const dir1 = this.toWorld(v1.position).sub(p0).normalize();
    const dir2 = this.toWorld(v2.position).sub(p0).normalize();

    const cornerNormal = new THREE.Vector3().crossVectors(dir1, dir2).normalize();

    const newVertexIds = [];
    const faceVertexMap = new Map();
    const edgeVertexMap = new Map();

    // Faces shared by BOTH selected edges
    const sharedFaceIds = [...edge1.faceIds].filter(fid => edge2.faceIds.has(fid));

    const connectedEdges = Array.from(vertex.edgeIds)
      .filter(edgeId => edgeId !== edgeId1 && edgeId !== edgeId2)
      .map(edgeId => meshData.edges.get(edgeId));

    if (sharedFaceIds.length > 0) {
      let bisector = dir1.clone().add(dir2).normalize();

      for (const faceId of sharedFaceIds) {
        const basePosition = p0.clone();
        const newVertex = this.vertexEditor.addVertex(this.toLocal(basePosition));
        newVertexIds.push(newVertex.id);

        const face = meshData.faces.get(faceId);
        const EPS = 1e-8;
        if (dir1.clone().add(dir2).lengthSq() < EPS) {
          const faceNormal = calculateFaceNormal(meshData, face);
          bisector = new THREE.Vector3().crossVectors(faceNormal, dir1).normalize();
        }

        const centroid = getCentroidFromVertices(face.vertexIds, meshData).applyMatrix4(this.object.matrixWorld);
        const inwardGuide = new THREE.Vector3().subVectors(centroid, p0);
        if (bisector.dot(inwardGuide) < 0) {
          bisector.negate();
        }

        const edgeScaleConstraints = new Map();
        edgeScaleConstraints.set(edgeId1, this.calculateScaleFactor(bisector, dir1));
        edgeScaleConstraints.set(edgeId2, this.calculateScaleFactor(bisector, dir2));

        this.bevelMoveData.set(newVertex.id, {
          originalVertexId: vertexId,
          vertexId: newVertex.id,
          basePosition,
          direction: bisector.clone(),
          scaleFactor: 1,
          edgeScaleConstraints,
          neighborNewVertexIds: [],
          edgeDirections: [dir1, dir2],
          valence,
        });

        if (!faceVertexMap.has(faceId)) faceVertexMap.set(faceId, []);
        faceVertexMap.get(faceId).push(newVertex.id);
      }
    }

    const edgeGroups = this.vertexEditor.topology.groupEdgesBySharedFace(connectedEdges);

    // Slide along unselected connected edges
    for (const group of edgeGroups) {
      const bestEdgeId = this.selectMostAlignedEdge(meshData, group, cornerNormal);
      const bestEdge = meshData.edges.get(bestEdgeId);

      const otherId = bestEdge.v1Id === vertexId ? bestEdge.v2Id : bestEdge.v1Id;
      const otherV = meshData.getVertex(otherId);

      const p1 = this.toWorld(vertex.position);
      const p2 = this.toWorld(otherV.position);

      const basePosition = p1.clone();
      let direction = p2.clone().sub(p1).normalize();
      const bisector = dir1.clone().add(dir2).normalize();
      const alignedBisector = this.computeAlignedBisector(meshData, vertexId, group, bisector);
      if (alignedBisector) {
        direction = alignedBisector;
      }

      const newVertex = this.vertexEditor.addVertex(this.toLocal(basePosition));
      newVertexIds.push(newVertex.id);

      const edgeScaleConstraints = new Map();
      edgeScaleConstraints.set(edgeId1, this.calculateScaleFactor(direction, dir1));
      edgeScaleConstraints.set(edgeId2, this.calculateScaleFactor(direction, dir2));

      this.bevelMoveData.set(newVertex.id, {
        originalVertexId: vertexId,
        vertexId: newVertex.id,
        basePosition,
        direction: direction.clone(),
        scaleFactor: 1,
        edgeScaleConstraints,
        neighborNewVertexIds: [],
        edgeDirections: [dir1, dir2],
        valence,
      });

      // Map to all faces of that edge that include the vertex
      this.mapGroupFacesToVertex(meshData, group, vertexId, newVertex.id, faceVertexMap);

      edgeVertexMap.set(bestEdge.id, newVertex.id);
    }

    return {
      valence,
      originalVertexId: vertexId,
      newVertexIds,
      selectedEdgeIds,
      faceVertexMap,
      edgeVertexMap,
    };
  }

  // Junction Vertex (3+ selected edges)
  bevelJunctionVertex(meshData, info) {
    const { vertexId, selectedEdgeIds, valence } = info;
    if (valence <= 2) return null;

    const vertex = meshData.getVertex(vertexId);
    if (!vertex) return null;

    const p0 = this.toWorld(vertex.position);

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

        const sharedFaceIds = [...edgeA.faceIds].filter(fid => edgeB.faceIds.has(fid));

        for (const faceId of sharedFaceIds) {
          if (processedFaceIds.has(faceId)) continue;
          processedFaceIds.add(faceId);

          const vAId = edgeA.v1Id === vertexId ? edgeA.v2Id : edgeA.v1Id;
          const vBId = edgeB.v1Id === vertexId ? edgeB.v2Id : edgeB.v1Id;

          const vA = meshData.getVertex(vAId);
          const vB = meshData.getVertex(vBId);
          if (!vA || !vB) continue;

          const dirA = this.toWorld(vA.position).sub(p0).normalize();
          const dirB = this.toWorld(vB.position).sub(p0).normalize();

          let direction = dirA.clone().add(dirB).normalize();

          const basePosition = p0.clone();
          const newVertex = this.vertexEditor.addVertex(this.toLocal(basePosition));
          newVertexIds.push(newVertex.id);

          const EPS = 1e-8;
          if (dirA.clone().add(dirB).lengthSq() < EPS) {
            const face = meshData.faces.get(faceId);
            const faceNormal = calculateFaceNormal(meshData, face);

            direction = new THREE.Vector3().crossVectors(faceNormal, dirA).normalize();

            const centroid = getCentroidFromVertices(face.vertexIds, meshData).applyMatrix4(this.object.matrixWorld);
            const inwardGuide = new THREE.Vector3().subVectors(centroid, p0);
            if (direction.dot(inwardGuide) < 0) {
              direction.negate();
            }
          }

          const edgeScaleConstraints = new Map();
          edgeScaleConstraints.set(edgeA.id, this.calculateScaleFactor(direction, dirA));
          edgeScaleConstraints.set(edgeB.id, this.calculateScaleFactor(direction, dirB));

          this.bevelMoveData.set(newVertex.id, {
            originalVertexId: vertexId,
            vertexId: newVertex.id,
            basePosition,
            direction: direction.clone(),
            scaleFactor: 1,
            edgeScaleConstraints,
            neighborNewVertexIds: [],
            edgeDirections: [dirA, dirB],
            valence,
          });

          if (!faceVertexMap.has(faceId)) faceVertexMap.set(faceId, []);
          faceVertexMap.get(faceId).push(newVertex.id);
        }
      }
    }

    const vertexNormal = calculateVertexNormal(meshData, vertexId);
    const edgeGroups = this.vertexEditor.topology.groupEdgesBySharedFace(connectedEdges);

    // Slide along unselected connected edges
    for (const group of edgeGroups) {
      const bestEdgeId = this.selectMostAlignedEdge(meshData, group, vertexNormal);
      const bestEdge = meshData.edges.get(bestEdgeId);

      const otherId = bestEdge.v1Id === vertexId ? bestEdge.v2Id : bestEdge.v1Id;
      const otherV = meshData.getVertex(otherId);

      const p1 = this.toWorld(vertex.position);
      const p2 = this.toWorld(otherV.position);

      let direction = p2.clone().sub(p1).normalize();
      const connectedSelectedEdges = this.findConnectedEdgesWithGroupEdges(meshData, group, selectedEdgeIds);
      const bisector = this.calculateAverageGroupDirection(meshData, connectedSelectedEdges, vertexId);

      const alignedBisector = this.computeAlignedBisector(meshData, vertexId, group, bisector);
      if (alignedBisector) {
        direction = alignedBisector;
      }

      const basePosition = p1.clone();
      const newVertex = this.vertexEditor.addVertex(this.toLocal(basePosition));
      newVertexIds.push(newVertex.id);

      const edgeScaleConstraints = new Map();
      const edgeDirections = [];
      for (const selEdge of selectedEdges) {
        const otherSelId = selEdge.v1Id === vertexId ? selEdge.v2Id : selEdge.v1Id;
        const otherSelV = meshData.getVertex(otherSelId);
        if (!otherSelV) continue;

        const dirSel = this.toWorld(otherSelV.position).sub(p0).normalize();
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
        valence,
      });

      // Map to all faces of that edge that include the vertex
      this.mapGroupFacesToVertex(meshData, group, vertexId, newVertex.id, faceVertexMap);

      edgeVertexMap.set(bestEdge.id, newVertex.id);
    }

    return {
      valence,
      originalVertexId: vertexId,
      newVertexIds,
      selectedEdgeIds,
      faceVertexMap,
      edgeVertexMap,
    };
  }

  mapGroupFacesToVertex(meshData, group, vertexId, newVertexId, faceVertexMap) {
    for (const edgeId of group) {
      const edge = meshData.edges.get(edgeId);
      for (const faceId of edge.faceIds) {
        const face = meshData.faces.get(faceId);
        if (!face) continue;
        if (!face.vertexIds.includes(vertexId)) continue;

        if (!faceVertexMap.has(faceId)) faceVertexMap.set(faceId, []);

        const vertices = faceVertexMap.get(faceId);
        if (!vertices.includes(newVertexId)) vertices.push(newVertexId);
      }
    }
  }

  // Topology
  rebuildFaceTopology(meshData, face) {
    const renderBuffer = this.vertexEditor.renderBuffer;
    const geometry = this.vertexEditor.geometry;

    MeshRendererAdapter.deleteFace(meshData, renderBuffer, geometry, face.id);

    // Remove this face from all old edges
    for (const edgeId of face.edgeIds) {
      const edge = meshData.edges.get(edgeId);
      if (edge) edge.faceIds.delete(face.id);
    }

    // Remove this face from old vertices
    for (const vertexId of face.vertexIds) {
      const vertex = meshData.getVertex(vertexId);
      if (vertex) vertex.faceIds.delete(face.id);
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
      if (!edge) edge = this.vertexEditor.addEdge(v1, v2);

      face.edgeIds.add(edge.id);
      edge.faceIds.add(face.id);

      v1.faceIds.add(face.id);
      v2.faceIds.add(face.id);
    }

    MeshRendererAdapter.addFace(meshData, renderBuffer, geometry, face.id);
  }

  getFacesAdjacentToEdgeVertices(meshData, edgeIds) {
    const adjacentFaceIds = new Set();

    for (const edgeId of edgeIds) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      for (const vId of [edge.v1Id, edge.v2Id]) {
        const vertex = meshData.getVertex(vId);
        if (!vertex) continue;

        for (const faceId of vertex.faceIds) adjacentFaceIds.add(faceId);
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

      const { chain1, chain2 } = this.buildSegmentChains(
        meshData,
        { nv1Face1, nv1Face2, nv2Face1, nv2Face2 },
        edge
      );

      // Determine direction of edge in face1 loop
      const loop = face1.vertexIds;
      const i1 = loop.indexOf(nv1Face1);
      const i2 = loop.indexOf(nv2Face1);
      if (i1 === -1 || i2 === -1) continue;
      const isForward = (i1 + 1) % loop.length === i2;

      for (let i = 0; i < chain1.length - 1; i++) {
        const quadIds = isForward
          ? [chain2[i], chain1[i], chain1[i + 1], chain2[i + 1]]
          : [chain1[i], chain2[i], chain2[i + 1], chain1[i + 1]];

        const vertices = quadIds.map(id => meshData.getVertex(id));
        const newFace = this.vertexEditor.addFace(vertices);
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

      this.alignLoopWindingWithTopology(meshData, orderedVertexIds);

      const vertex = meshData.getVertex(vertexId);
      const targetPosition = new THREE.Vector3().copy(vertex.position);

      if (orderedVertexIds.length === 3 && valence === 1) {
        const edgeChains = this.insertSegmentChainsPerEdge(orderedVertexIds);
        newFaceIds.push(...this.triangulateEdgesCorner(meshData, edgeChains));
        continue;
      } else if (orderedVertexIds.length > 3 && valence === 1) {
        const { newLoop } = this.insertSegmentsIntoLoop(orderedVertexIds);
        const newFace = this.vertexEditor.addFace(newLoop.map(id => meshData.getVertex(id)));
        newFaceIds.push(newFace.id);
        continue;
      }

      const { newOrderVertexIds } = this.insertSegmentsIntoLoop(orderedVertexIds);
      const { vertexOrderPerLayer, newFaces } = this.vertexEditor.subdivide.createInsetSubdivideVertices(
        newOrderVertexIds,
        this.segments,
        targetPosition
      );

      this.cornerPatches.push({ vertexOrderPerLayer, targetPosition });

      if (newFaces) newFaceIds.push(...newFaces.map(face => face.id));
    }

    return newFaceIds;
  }

  triangulateEdgesCorner(meshData, edgeChains) {
    const newFaceIds = [];

    // Flatten the chains into a single ordered loop without duplicates
    const loop = [];
    for (const chain of edgeChains) {
      for (let i = 0; i < chain.length - 1; i++) loop.push(chain[i]);
    }

    // Find the origin vertex (shared by two non-segmented edges)
    let originIndex = 0;
    const numChains = edgeChains.length;

    for (let i = 0; i < numChains; i++) {
      const currentChain = edgeChains[i];
      const nextChain = edgeChains[(i + 1) % numChains];

      if (currentChain.length === 2 && nextChain.length === 2) {
        originIndex = loop.indexOf(currentChain[1]);
        break;
      }
    }

    // Rotate so the origin vertex is at index 0, then fan
    const rotatedLoop = [...loop.slice(originIndex), ...loop.slice(0, originIndex)];
    const originId = rotatedLoop[0];

    for (let i = 1; i < rotatedLoop.length - 1; i++) {
      const vertices = [originId, rotatedLoop[i], rotatedLoop[i + 1]].map(id => meshData.getVertex(id));
      const newFace = this.vertexEditor.addFace(vertices);
      if (newFace) newFaceIds.push(newFace.id);
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
      if (vertex) this.vertexEditor.deleteVertex(vertex);
    }
  }

  linkVertexNeighbors(a, b) {
    const mA = this.bevelMoveData.get(a);
    const mB = this.bevelMoveData.get(b);
    if (!mA || !mB) return;

    if (!mA.neighborNewVertexIds.includes(b)) mA.neighborNewVertexIds.push(b);
    if (!mB.neighborNewVertexIds.includes(a)) mB.neighborNewVertexIds.push(a);
  }

  buildOrderedVertexLoop(meshData, newVertexIds) {
    if (!newVertexIds || newVertexIds.length === 0) return [];

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

  alignLoopWindingWithTopology(meshData, orderedVertexIds) {
    for (let i = 0; i < orderedVertexIds.length; i++) {
      const vAId = orderedVertexIds[i];
      const vBId = orderedVertexIds[(i + 1) % orderedVertexIds.length];

      const vertexA = meshData.getVertex(vAId);
      const vertexB = meshData.getVertex(vBId);
      if (!vertexA || !vertexB) continue;

      let sharedFaceId = null;
      for (const faceId of vertexA.faceIds) {
        if (vertexB.faceIds.has(faceId)) {
          sharedFaceId = faceId;
          break;
        }
      }

      if (!sharedFaceId) continue;

      const sharedFace = meshData.faces.get(sharedFaceId);
      if (!sharedFace) continue;

      const vIds = sharedFace.vertexIds;
      const idxA = vIds.indexOf(vAId);
      const idxB = vIds.indexOf(vBId);
      if (idxA === -1 || idxB === -1) continue;

      if ((idxA + 1) % vIds.length === idxB) {
        orderedVertexIds.reverse();
      }
      return;
    }
  }

  // Segments
  findExistingSegmentVertex(startId, endId, segmentIndex) {
    for (const segData of this.segmentMoveData.values()) {
      const [a, b] = segData.endVertexIds;

      if (a === startId && b === endId && segData.segmentIndex === segmentIndex) {
        return segData.vertexId;
      }

      if (a === endId && b === startId && segData.segmentIndex === this.segments - segmentIndex) {
        return segData.vertexId;
      }
    }

    return null;
  }

  insertFaceSegments(meshData, splitFaces) {
    for (const faceId of splitFaces) {
      const face = meshData.faces.get(faceId);
      if (!face) continue;

      face.vertexIds = this.insertSegmentsIntoLoop(face.vertexIds).newLoop;
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

      const chain = this.segmentEdgeMap.get(this.getEdgeKey(v1, v2));
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

      if (edgeVertices.length > 0) newOrderVertexIds.push(edgeVertices);
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
      const chain = this.segmentEdgeMap.get(this.getEdgeKey(v1, v2));

      if (chain) {
        if (v1 === chain[0] && v2 === chain[chain.length - 1]) {
          for (let j = 1; j < chain.length - 1; j++) edgeChain.push(chain[j]);
        } else if (v2 === chain[0] && v1 === chain[chain.length - 1]) {
          for (let j = chain.length - 2; j > 0; j--) edgeChain.push(chain[j]);
        }
      }

      edgeChain.push(v2);
      edgeChains.push(edgeChain);
    }

    return edgeChains;
  }

  buildSegmentChains(meshData, verts, edge) {
    const { nv1Face1, nv1Face2, nv2Face1, nv2Face2 } = verts;

    const vPos = new THREE.Vector3().copy(meshData.getVertex(edge.v1Id).position);
    const oPos = new THREE.Vector3().copy(meshData.getVertex(edge.v2Id).position);

    const edgeDirection = new THREE.Vector3().subVectors(oPos, vPos).normalize();
    edgeDirection.transformDirection(this.object.matrixWorld);

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
        const sv1 = this.vertexEditor.addVertex(p1);
        this.segmentMoveData.set(sv1.id, {
          vertexId: sv1.id,
          endVertexIds: [v1a.id, v1b.id],
          segmentIndex: i,
          edgeDirection: edgeDirection.clone(),
        });
        sv1Id = sv1.id;
      }

      if (!sv2Id) {
        const sv2 = this.vertexEditor.addVertex(p2);
        this.segmentMoveData.set(sv2.id, {
          vertexId: sv2.id,
          endVertexIds: [v2a.id, v2b.id],
          segmentIndex: i,
          edgeDirection: edgeDirection.clone().negate(),
        });
        sv2Id = sv2.id;
      }

      chain1.push(sv1Id);
      chain2.push(sv2Id);
    }

    chain1.push(nv1Face2);
    chain2.push(nv2Face2);

    this.segmentEdgeMap.set(this.getEdgeKey(nv1Face1, nv1Face2), [...chain1]);
    this.segmentEdgeMap.set(this.getEdgeKey(nv2Face1, nv2Face2), [...chain2]);

    return { chain1, chain2 };
  }

  getEdgeKey(a, b) {
    return a < b ? `${a}_${b}` : `${b}_${a}`;
  }

  quadraticBezierPoint(v0, v1, v2, t) {
    const invT = 1 - t;

    return v0.clone().multiplyScalar(invT * invT)
      .addScaledVector(v1, 2 * invT * t)
      .addScaledVector(v2, t * t);
  }

  // Direction helpers
  selectMostAlignedEdge(meshData, group, normal) {
    let bestEdgeId = null;
    let bestDot = -Infinity;

    for (const edgeId of group) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      const vA = meshData.getVertex(edge.v1Id);
      const vB = meshData.getVertex(edge.v2Id);
      if (!vA || !vB) continue;

      const posA = new THREE.Vector3(vA.position.x, vA.position.y, vA.position.z);
      const posB = new THREE.Vector3(vB.position.x, vB.position.y, vB.position.z);
      const dot = Math.abs(posB.sub(posA).normalize().dot(normal));

      if (dot > bestDot) {
        bestDot = dot;
        bestEdgeId = edgeId;
      }
    }

    return bestEdgeId;
  }

  computeAlignedBisector(meshData, vertexId, group, bisector) {
    const faceCountMap = new Map();
    for (const edgeId of group) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;
      for (const fid of edge.faceIds) {
        faceCountMap.set(fid, (faceCountMap.get(fid) || 0) + 1);
      }
    }

    const groupSurfaceNormal = new THREE.Vector3();
    let faceCount = 0;

    for (const [fid, count] of faceCountMap) {
      if (count < 2) continue;

      const face = meshData.faces.get(fid);
      if (face && face.vertexIds.includes(vertexId)) {
        groupSurfaceNormal.add(calculateFaceNormal(meshData, face));
        faceCount++;
      }
    }

    if (faceCount === 0) return null;
    groupSurfaceNormal.normalize();

    // Slide along the surface
    const direction = bisector.clone().projectOnPlane(groupSurfaceNormal).normalize();

    const avgGroupDir = this.calculateAverageGroupDirection(meshData, group, vertexId);
    if (direction.dot(avgGroupDir) >= 0) return null;

    return direction.negate();
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
          if (selectedSet.has(fEdgeId)) connectedSelectedEdgeIds.add(fEdgeId);
        }
      }
    }

    return Array.from(connectedSelectedEdgeIds);
  }

  calculateAverageGroupDirection(meshData, edgeIds, centralVertexId) {
    const centralVertex = meshData.getVertex(centralVertexId);
    if (!centralVertex || edgeIds.length === 0) return new THREE.Vector3();

    const p0 = this.toWorld(centralVertex.position);
    const groupDirection = new THREE.Vector3();

    for (const edgeId of edgeIds) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      const neighborId = edge.v1Id === centralVertexId ? edge.v2Id : edge.v1Id;
      const neighbor = meshData.getVertex(neighborId);
      if (!neighbor) continue;

      groupDirection.add(this.toWorld(neighbor.position).sub(p0).normalize());
    }

    if (groupDirection.lengthSq() === 0) return groupDirection;

    return groupDirection.divideScalar(edgeIds.length).normalize();
  }

  // Id helpers
  getVertexIdsFromEdges(meshData, edgeIds) {
    const vertexIds = new Set();
    for (const edgeId of edgeIds) {
      const edge = meshData.edges.get(edgeId);
      vertexIds.add(edge.v1Id);
      vertexIds.add(edge.v2Id);
    }
    return Array.from(vertexIds);
  }

  getVertexIdsFromFaces(meshData, faceIds) {
    const vertexIds = new Set();
    for (const faceId of faceIds) {
      const face = meshData.faces.get(faceId);
      if (!face) continue;
      for (const vertexId of face.vertexIds) vertexIds.add(vertexId);
    }
    return Array.from(vertexIds);
  }

  getEdgeIdsFromFaces(meshData, faceIds) {
    const edgeIds = new Set();
    for (const faceId of faceIds) {
      const face = meshData.faces.get(faceId);
      if (!face) continue;
      for (const edgeId of face.edgeIds) edgeIds.add(edgeId);
    }
    return Array.from(edgeIds);
  }
}