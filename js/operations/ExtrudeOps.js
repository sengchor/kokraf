import * as THREE from 'three';
import {
  calculateVertexIdsNormal,
  getCentroidFromVertices,
  getEdgeMidpoint,
  computeFacesAverageNormal,
} from '../utils/AlignedNormalUtils.js';
import { ExtrudeCommand } from '../commands/ExtrudeCommand.js';
import { MeshDataRegion } from '../core/MeshDataRegion.js';

const UP = new THREE.Vector3(0, 1, 0);
const EXTRUDE_MODES = new Set(['vertex', 'edge', 'face']);

export class ExtrudeOps {
  constructor(editor, transformControls) {
    this.editor = editor;
    this.signals = editor.signals;
    this.transformControls = transformControls;
    this.vertexEditor = editor.vertexEditor;
    this.editSelection = editor.editSelection;
    this.snapManager = editor.snapManager;

    this.session = null;
  }

  get axis() { return this.transformControls.axis; }
  get space() { return this.transformControls.space; }

  // Session
  beginSession(object, handle) {
    if (!object || !handle) return null;

    const selection = ExtrudeOps.readSelection(this.editSelection);
    this.vertexEditor.setObject(object);

    this.session = {
      object,
      mode: this.editSelection.subSelectionMode,
      selection,
      pivotPosition: handle.getWorldPosition(new THREE.Vector3()),
      pivotQuaternion: handle.getWorldQuaternion(new THREE.Quaternion()),
      pivotScale: handle.getWorldScale(new THREE.Vector3()),
      oldPositions: this.vertexEditor.transform.getVertexPositions(selection.vertexIds),
      extrusion: null,
    };

    return this.session;
  }

  hasSession() {
    return this.session !== null;
  }

  isExtruded() {
    return !!this.session?.extrusion;
  }

  endSession() {
    this.session = null;
  }

  // Re-bases numeric/axis input when the user switches axis constraint mid-session.
  setPivotQuaternion(quaternion) {
    if (this.session) this.session.pivotQuaternion = quaternion;
  }

  // Builds the extruded topology once per session. Returns the extrusion or null.
  extrude() {
    const s = this.session;
    if (!s) return null;
    if (s.extrusion) return s.extrusion;

    this.vertexEditor.setObject(s.object);
    const extrusion = ExtrudeOps.buildExtrusion(
      this.vertexEditor,
      s.object.userData.meshData,
      s.mode,
      s.selection
    );
    if (!extrusion) return null;

    s.extrusion = extrusion;
    ExtrudeOps.selectExtruded(this.editSelection, s.mode, extrusion);
    this.signals.editSelectionRefresh.dispatch();

    return extrusion;
  }

  apply(handle, event, numericActive) {
    const s = this.session;
    if (!s?.extrusion || !handle) return;

    const { object, extrusion } = s;
    this.vertexEditor.setObject(object);

    let offset = handle.getWorldPosition(new THREE.Vector3()).sub(s.pivotPosition);

    const snapTarget = this.snapManager.snapEditPosition(event, extrusion.newVertexIds, object);
    if (snapTarget && !numericActive) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(s.oldPositions, snapTarget);

      if (nearestWorldPos) {
        offset.subVectors(snapTarget, nearestWorldPos);
        offset = this.snapManager.constrainTranslationOffset(offset, this.axis, this.space, s.pivotQuaternion);

        handle.position.copy(s.pivotPosition).add(offset);
        this.transformControls.update();
      }
    }

    const newPositions = extrusion.initialPositions.map(pos => pos.clone().add(offset));
    this.vertexEditor.transform.setVertexPositions(extrusion.newVertexIds, newPositions);
  }

  // Records the (already applied) extrusion on the history stack. Returns true if a command was added.
  commit() {
    const s = this.session;
    if (!s) return false;

    // Session started but nothing was extruded (e.g. gizmo click without drag).
    if (!s.extrusion) {
      this.endSession();
      return false;
    }

    const { object, mode, extrusion } = s;
    this.vertexEditor.setObject(object);

    this.editor.add(ExtrudeOps.createCommand(this.editor, object, extrusion));
    this.signals.editSelectionRefresh.dispatch();
    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();

    ExtrudeOps.selectExtruded(this.editSelection, mode, extrusion);

    this.endSession();
    return true;
  }

  // Moves the new geometry back to zero offset. Topology stays; call commit() afterwards to record it.
  cancel(handle) {
    const s = this.session;
    if (!s?.extrusion) return;

    this.vertexEditor.setObject(s.object);
    this.vertexEditor.transform.setVertexPositions(s.extrusion.newVertexIds, s.extrusion.initialPositions);

    if (handle) {
      handle.position.copy(s.pivotPosition);
      handle.quaternion.copy(s.pivotQuaternion);
      handle.scale.copy(s.pivotScale);
      handle.updateMatrixWorld(true);
    }
  }

  // Numeric input (updates the handle only; caller re-applies the session).
  // Pass a normal to extrude along it; otherwise the gizmo axis/space is used.
  numericTranslate(value, handle, normal = null) {
    const s = this.session;
    if (!s || !handle) return false;

    const offset = new THREE.Vector3();

    if (normal) {
      offset.copy(normal).multiplyScalar(value);
    } else {
      const axis = this.axis;
      if (axis === 'XYZ') offset.set(value, value, value);
      else if (axis === 'X') offset.x = value;
      else if (axis === 'Y') offset.y = value;
      else if (axis === 'Z') offset.z = value;
      else return false;

      if (this.space === 'local') offset.applyQuaternion(s.pivotQuaternion);
    }

    handle.position.copy(s.pivotPosition).add(offset);
    return true;
  }

  // Non-interactive API (no gizmo, no session).

  static readSelection(editSelection) {
    return {
      vertexIds: Array.from(editSelection.selectedVertexIds),
      edgeIds: Array.from(editSelection.selectedEdgeIds),
      faceIds: Array.from(editSelection.selectedFaceIds),
    };
  }

  /**
   * Duplicate the selection, build side faces, and delete the originals.
   * ids should be a consistent selection (faces + their edges + vertices), as editSelection holds.
   * vertexEditor must already be set to the object owning meshData.
   * Returns the extrusion record consumed by createCommand, or null for an unknown mode.
   */
  static buildExtrusion(vertexEditor, meshData, mode, { vertexIds, edgeIds, faceIds }) {
    if (!EXTRUDE_MODES.has(mode)) return null;

    const regionIds = MeshDataRegion.expand(meshData, { vertexIds, edgeIds, faceIds }, 2);
    const beforeSnapshot = MeshDataRegion.snapshot(meshData, regionIds);

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };

    const duplicate = vertexEditor.duplicate;
    const { mappedVertexIds, newVertexIds, newEdgeIds, newFaceIds } =
      mode === 'vertex' ? duplicate.duplicateSelectionVertices(vertexIds)
      : mode === 'edge' ? duplicate.duplicateSelectionEdges(edgeIds)
      : duplicate.duplicateSelectionFaces(faceIds);

    const initialPositions = vertexEditor.transform.getVertexPositions(newVertexIds);
    const boundaryEdges = vertexEditor.selection.getBoundaryEdges(vertexIds, edgeIds, faceIds);

    const hasReferenceFace = ExtrudeOps.createSideFaces(vertexEditor, meshData, boundaryEdges, mappedVertexIds);
    ExtrudeOps.connectIsolatedVertices(vertexEditor, meshData, vertexIds, edgeIds, mappedVertexIds);
    ExtrudeOps.deleteOriginal(vertexEditor, mode, { vertexIds, edgeIds, faceIds });

    return {
      mode,
      beforeSnapshot,
      startElements,
      mappedVertexIds,
      newVertexIds,
      newEdgeIds,
      newFaceIds,
      initialPositions,
      hasReferenceFace, // true when side faces were wound against an adjacent face → extrude along normal
    };
  }

  static createSideFaces(vertexEditor, meshData, boundaryEdges, mappedVertexIds) {
    let hasReferenceFace = false;

    for (const edge of boundaryEdges) {
      const newV1Id = mappedVertexIds.get(edge.v1Id);
      const newV2Id = mappedVertexIds.get(edge.v2Id);
      const newEdge = meshData.getEdge(newV1Id, newV2Id);

      const sideFaceVertexIds = [edge.v1Id, edge.v2Id, newV2Id, newV1Id];

      let referenceFace = null;
      if (newEdge && newEdge.faceIds.size > 0) {
        const [faceId] = newEdge.faceIds;
        referenceFace = meshData.faces.get(faceId);
      }

      if (referenceFace) {
        hasReferenceFace = true;
        if (ExtrudeOps.shouldFlipSideFace(meshData, edge, newEdge, referenceFace)) {
          sideFaceVertexIds.reverse();
        }
      }

      vertexEditor.topology.createFaceFromVertices(sideFaceVertexIds);
    }

    return hasReferenceFace;
  }

  static shouldFlipSideFace(meshData, edge, newEdge, referenceFace) {
    const faceCentroid = getCentroidFromVertices(referenceFace.vertexIds, meshData);
    const newEdgeMidpoint = getEdgeMidpoint(newEdge, meshData);
    const outward = new THREE.Vector3().subVectors(newEdgeMidpoint, faceCentroid).normalize();

    const faceNormal = calculateVertexIdsNormal(meshData, referenceFace.vertexIds);
    const edgeDir = new THREE.Vector3()
      .subVectors(meshData.getVertex(edge.v2Id).position, meshData.getVertex(edge.v1Id).position)
      .normalize();

    const winding = new THREE.Vector3().crossVectors(edgeDir, faceNormal).normalize();
    return winding.dot(outward) < 0;
  }

  // Selected vertices not touched by a selected edge get an edge to their duplicate.
  static connectIsolatedVertices(vertexEditor, meshData, vertexIds, edgeIds, mappedVertexIds) {
    const connected = new Set();
    for (const edgeId of edgeIds) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;
      connected.add(edge.v1Id);
      connected.add(edge.v2Id);
    }

    for (const vId of vertexIds) {
      if (connected.has(vId)) continue;

      const vertexA = meshData.getVertex(vId);
      const vertexB = meshData.getVertex(mappedVertexIds.get(vId));
      if (vertexA && vertexB) vertexEditor.addEdge(vertexA, vertexB);
    }
  }

  static deleteOriginal(vertexEditor, mode, { vertexIds, edgeIds, faceIds }) {
    const del = vertexEditor.delete;
    if (mode === 'vertex') del.deleteSelectionVertices(vertexIds);
    else if (mode === 'edge') del.deleteSelectionEdges(edgeIds);
    else if (mode === 'face') del.deleteSelectionFaces(faceIds);
  }

  static selectExtruded(editSelection, mode, extrusion) {
    if (mode === 'vertex') editSelection.selectVertices(extrusion.newVertexIds);
    else if (mode === 'edge') editSelection.selectEdges(extrusion.newEdgeIds);
    else if (mode === 'face') editSelection.selectFaces(extrusion.newFaceIds);
  }

  /**
   * Build the undo command for an extrusion that is already applied to meshData.
   * Mutates extrusion.beforeSnapshot (captures new element ids), so call it once per extrusion.
   */
  static createCommand(editor, object, extrusion) {
    const meshData = object.userData.meshData;

    MeshDataRegion.captureNewElements(meshData, extrusion.startElements, extrusion.beforeSnapshot);
    const afterRegionIds = MeshDataRegion.idsOf(extrusion.beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    return new ExtrudeCommand(editor, object, extrusion.beforeSnapshot, afterSnapshot);
  }

  // World-space average normal of the faces and a pivot orientation whose +Y follows it.
  static computeFaceNormalOrientation(object, faceIds) {
    const meshData = object?.userData?.meshData;
    if (!meshData) return null;

    const faceNormal = computeFacesAverageNormal(meshData, faceIds);
    if (!faceNormal) return null;

    const objectQuaternion = object.getWorldQuaternion(new THREE.Quaternion());
    const worldNormal = faceNormal.clone().applyQuaternion(objectQuaternion).normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, worldNormal);

    return { worldNormal, quaternion };
  }
}