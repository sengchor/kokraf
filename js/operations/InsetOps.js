import * as THREE from 'three';
import { computeFacesAverageNormal } from '../utils/AlignedNormalUtils.js';
import { InsetCommand } from '../commands/InsetCommand.js';
import { MeshDataRegion } from '../core/MeshDataRegion.js';

export const InsetCommitResult = Object.freeze({
  COMMITTED: 'committed',
  CANCELLED: 'cancelled',
  INVALID: 'invalid',
  EMPTY: 'empty',
});

export class InsetOps {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.vertexEditor = editor.vertexEditor;
    this.editSelection = editor.editSelection;

    this.session = null;
  }

  get width() {
    return this.session?.width ?? null;
  }

  // Session
  beginSession(object, handle) {
    if (!object?.userData?.meshData || !handle) return null;

    this.vertexEditor.setObject(object);

    this.session = {
      object,
      faceIds: Array.from(this.editSelection.selectedFaceIds),
      pivotPosition: handle.getWorldPosition(new THREE.Vector3()),
      width: 0,
      inset: null, // built lazily on the first apply
    };

    return this.session;
  }

  hasSession() {
    return this.session !== null;
  }

  isValid() {
    return !!this.session && this.session.faceIds.length > 0;
  }

  isBuilt() {
    return !!this.session?.inset;
  }

  endSession() {
    this.session = null;
  }

  // Builds the inset topology (at zero width) once per session.
  build(handle) {
    const s = this.session;
    if (!s || !this.isValid()) return null;
    if (s.inset) return s.inset;

    s.inset = InsetOps.buildInset(this.vertexEditor, this.editSelection, s.object, s.faceIds);
    this.signals.editSelectionRefresh.dispatch();

    // Selecting the new faces re-centres the handle; put it back on the pivot.
    this.editSelection.selectFaces(Array.from(s.inset.newFaceIds));
    handle.position.copy(s.pivotPosition);

    return s.inset;
  }

  setWidth(value) {
    const s = this.session;
    if (!s?.inset) return false;

    s.width = value || 0;

    const { vertexIds, positions } = InsetOps.computeWidthPositions(s.inset, s.width);
    this.vertexEditor.setObject(s.object);
    this.vertexEditor.transform.setVertexPositions(vertexIds, positions);
    return true;
  }

  commit(handle) {
    const s = this.session;
    if (!s) return null;

    if (!this.isValid()) {
      this.endSession();
      return InsetCommitResult.INVALID;
    }

    if (!s.inset) {
      this.endSession();
      return InsetCommitResult.EMPTY;
    }

    if (!s.width) {
      this.cancel(handle);
      return InsetCommitResult.CANCELLED;
    }

    const { object, inset } = s;
    this.vertexEditor.setObject(object);

    this.editor.add(InsetOps.createCommand(this.editor, object, inset));
    this.signals.editSelectionRefresh.dispatch();
    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();

    InsetOps.selectResult(this.editSelection, inset);

    this.endSession();
    return InsetCommitResult.COMMITTED;
  }

  // Restores the mesh, handle and original face selection, then ends the session.
  cancel(handle) {
    const s = this.session;
    if (!s) return;

    if (s.inset) {
      InsetOps.restore(this.vertexEditor, s.object, s.inset);
      this.editSelection.selectFaces(s.faceIds);
    }

    if (handle && this.isValid()) {
      handle.position.copy(s.pivotPosition);
      handle.updateMatrixWorld(true);
    }

    this.endSession();
  }

  // Non-interactive API (no gizmo, no session).

  /**
   * Inset the given faces at zero width: duplicate each face island, bridge its boundary
   * with side faces, delete the originals, and record how each boundary vertex moves with width.
   * Returns the inset record consumed by computeWidthPositions / createCommand / restore.
   */
  static buildInset(vertexEditor, editSelection, object, faceIds) {
    const meshData = object.userData.meshData;
    const matrixWorld = object.matrixWorld;
    vertexEditor.setObject(object);

    const beforeRegionIds = MeshDataRegion.expand(meshData, { vertexIds: [], edgeIds: [], faceIds }, 2);

    const inset = {
      beforeSnapshot: MeshDataRegion.snapshot(meshData, beforeRegionIds),
      startElements: {
        startVertexId: meshData.nextVertexId,
        startEdgeId: meshData.nextEdgeId,
        startFaceId: meshData.nextFaceId,
      },
      boundaryVertexIds: new Set(),
      moveData: new Map(),
      newVertexIds: new Set(),
      newEdgeIds: new Set(),
      newFaceIds: new Set(),
    };

    const faceIslands = vertexEditor.dissolve.splitFaceIslands(faceIds);

    for (const faceIsland of faceIslands) {
      const islandFaceIdSet = new Set(faceIsland);

      const { vertexSet, edgeSet } = editSelection.resolveSelectionGraphFromFaces(islandFaceIdSet);
      const islandVertexIds = Array.from(vertexSet);
      const islandEdgeIds = Array.from(edgeSet);
      const islandFaceIds = Array.from(islandFaceIdSet);

      const boundaryEdges = vertexEditor.selection.getBoundaryEdges(islandVertexIds, islandEdgeIds, islandFaceIds);
      if (!boundaryEdges) continue;

      const duplication = vertexEditor.duplicate.duplicateSelectionFaces(islandFaceIds);
      const mappedVertexIds = duplication.mappedVertexIds;
      duplication.newVertexIds.forEach(id => inset.newVertexIds.add(id));
      duplication.newEdgeIds.forEach(id => inset.newEdgeIds.add(id));
      duplication.newFaceIds.forEach(id => inset.newFaceIds.add(id));

      for (const edge of boundaryEdges) {
        for (const vId of [edge.v1Id, edge.v2Id]) {
          const newId = mappedVertexIds.get(vId);
          if (newId !== undefined) inset.boundaryVertexIds.add(newId);
        }
      }

      for (const [originalVertexId, newVertexId] of mappedVertexIds) {
        if (!inset.boundaryVertexIds.has(newVertexId)) continue;

        const move = InsetOps.computeVertexMove(meshData, matrixWorld, originalVertexId, boundaryEdges, islandFaceIdSet);
        if (move) inset.moveData.set(newVertexId, move);
      }

      InsetOps.bridgeBoundary(vertexEditor, meshData, matrixWorld, boundaryEdges, mappedVertexIds, inset.moveData, islandFaceIdSet);
    }

    vertexEditor.delete.deleteSelectionFaces(faceIds);

    return inset;
  }

  // World-space inset direction and miter scale for one boundary vertex, or null if it
  // doesn't have exactly two boundary neighbours.
  static computeVertexMove(meshData, matrixWorld, vertexId, boundaryEdges, islandFaceIdSet) {
    const vertex = meshData.getVertex(vertexId);
    const basePosition = new THREE.Vector3().copy(vertex.position).applyMatrix4(matrixWorld);

    const neighbors = InsetOps.getConnectedVertices(vertexId, boundaryEdges);
    if (neighbors.length !== 2) return null;

    // Order neighbours by the island face winding
    let prevId = null;
    let nextId = null;

    for (const neighborId of neighbors) {
      const edge = meshData.getEdge(vertexId, neighborId);
      const sharedFaceId = [...edge.faceIds].find(fid => islandFaceIdSet.has(fid));
      const face = meshData.faces.get(sharedFaceId);

      const vIndex = face.vertexIds.indexOf(vertexId);
      const nIndex = face.vertexIds.indexOf(neighborId);
      const len = face.vertexIds.length;

      if ((nIndex + 1) % len === vIndex) prevId = neighborId;
      else if ((vIndex + 1) % len === nIndex) nextId = neighborId;
    }

    if (prevId === null || nextId === null) {
      [prevId, nextId] = neighbors;
    }

    const prev = meshData.getVertex(prevId);
    const next = meshData.getVertex(nextId);

    const e1 = new THREE.Vector3().subVectors(vertex.position, prev.position).normalize();
    const e2 = new THREE.Vector3().subVectors(next.position, vertex.position).normalize();

    const faceNormal = computeFacesAverageNormal(
      meshData,
      InsetOps.getConnectedFaces(meshData, vertexId, islandFaceIdSet)
    );

    const n1 = new THREE.Vector3().crossVectors(faceNormal, e1).normalize();
    const n2 = new THREE.Vector3().crossVectors(faceNormal, e2).normalize();

    const direction = new THREE.Vector3().addVectors(n1, n2);
    if (direction.lengthSq() < 1e-6) direction.copy(n1);
    else direction.normalize();

    const miterScale = 1.0 / Math.max(direction.dot(n1), 0.1);

    direction.transformDirection(matrixWorld).normalize();

    return { originalVertexId: vertexId, basePosition, direction, scale: miterScale };
  }

  // One quad per boundary edge between the original and duplicated vertices, wound to match the island.
  static bridgeBoundary(vertexEditor, meshData, matrixWorld, boundaryEdges, mappedVertexIds, moveData, islandFaceIdSet) {
    const inverseWorldMatrix = matrixWorld.clone().invert();
    const toLocalDir = (id) => {
      const move = moveData.get(id);
      return move
        ? move.direction.clone().transformDirection(inverseWorldMatrix).normalize()
        : new THREE.Vector3();
    };

    for (const edge of boundaryEdges) {
      const nv1Id = mappedVertexIds.get(edge.v1Id);
      const nv2Id = mappedVertexIds.get(edge.v2Id);

      const sideFaceVertexIds = [edge.v1Id, edge.v2Id, nv2Id, nv1Id];

      const dir1 = toLocalDir(nv1Id);
      const dir2 = toLocalDir(nv2Id);

      const normal = new THREE.Vector3().crossVectors(dir1, dir2).normalize();

      if (normal.lengthSq() < 1e-8) {
        const v1 = meshData.getVertex(edge.v1Id).position;
        const v2 = meshData.getVertex(edge.v2Id).position;
        const v3 = new THREE.Vector3().copy(meshData.getVertex(nv2Id).position).addScaledVector(dir2, 1);

        normal.crossVectors(
          new THREE.Vector3().subVectors(v2, v1),
          new THREE.Vector3().subVectors(v3, v1)
        ).normalize();
      }

      const sharedFaceIds = [...edge.faceIds].filter(fid => islandFaceIdSet.has(fid));
      const faceNormal = computeFacesAverageNormal(meshData, sharedFaceIds);

      if (normal.dot(faceNormal) < 0) sideFaceVertexIds.reverse();

      vertexEditor.topology.createFaceFromVertices(sideFaceVertexIds);
    }
  }

  // World-space positions of the boundary vertices at a given width.
  static computeWidthPositions(inset, width) {
    const vertexIds = [];
    const positions = [];

    for (const vId of inset.boundaryVertexIds) {
      const move = inset.moveData.get(vId);
      if (!move) continue;

      vertexIds.push(vId);
      positions.push(move.basePosition.clone().addScaledVector(move.direction, width * move.scale));
    }

    return { vertexIds, positions };
  }

  // Roll the mesh back to before buildInset(). Discard the inset record afterwards.
  static restore(vertexEditor, object, inset) {
    vertexEditor.setObject(object);
    MeshDataRegion.captureNewElements(object.userData.meshData, inset.startElements, inset.beforeSnapshot);
    vertexEditor.applyDelta(inset.beforeSnapshot);
  }

  /**
   * Build the undo command for an inset that is already applied to meshData.
   * Mutates inset.beforeSnapshot (captures new element ids), so call it once per inset.
   */
  static createCommand(editor, object, inset) {
    const meshData = object.userData.meshData;

    MeshDataRegion.captureNewElements(meshData, inset.startElements, inset.beforeSnapshot);
    const afterRegionIds = MeshDataRegion.idsOf(inset.beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    return new InsetCommand(editor, object, inset.beforeSnapshot, afterSnapshot);
  }

  static selectResult(editSelection, inset) {
    const mode = editSelection.subSelectionMode;

    editSelection.clearSelection();

    if (mode === 'vertex') editSelection.selectVertices(Array.from(inset.newVertexIds));
    else if (mode === 'edge') editSelection.selectEdges(Array.from(inset.newEdgeIds));
    else if (mode === 'face') editSelection.selectFaces(Array.from(inset.newFaceIds));
  }

  static getConnectedVertices(vertexId, edges) {
    const connected = [];

    for (const edge of edges) {
      if (edge.v1Id === vertexId) connected.push(edge.v2Id);
      else if (edge.v2Id === vertexId) connected.push(edge.v1Id);
    }

    return connected;
  }

  static getConnectedFaces(meshData, vertexId, faceIdSet) {
    const vertex = meshData.getVertex(vertexId);
    return Array.from(vertex.faceIds).filter(faceId => faceIdSet.has(faceId));
  }
}