import * as THREE from 'three';
import { DuplicateSelectionCommand } from '../commands/DuplicateSelectionCommand.js';
import { MeshDataRegion } from '../core/MeshDataRegion.js';

const DUPLICATE_MODES = new Set(['vertex', 'edge', 'face']);

export class DuplicateOps {
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
  // Duplicates the current selection immediately and selects the copy.
  beginSession(object, handle) {
    const meshData = object?.userData?.meshData;
    if (!meshData || !handle) return null;

    const mode = this.editSelection.subSelectionMode;
    if (!DUPLICATE_MODES.has(mode)) return null;

    const ids = {
      vertexIds: Array.from(this.editSelection.selectedVertexIds),
      edgeIds: Array.from(this.editSelection.selectedEdgeIds),
      faceIds: Array.from(this.editSelection.selectedFaceIds),
    };
    if (!ids.vertexIds.length) return null;

    this.vertexEditor.setObject(object);

    const oldPositions = this.vertexEditor.transform.getVertexPositions(ids.vertexIds);
    const beforeRegionIds = MeshDataRegion.expand(meshData, ids, 1);

    this.session = {
      object,
      mode,
      pivotPosition: handle.getWorldPosition(new THREE.Vector3()),
      pivotQuaternion: handle.getWorldQuaternion(new THREE.Quaternion()),
      pivotScale: handle.getWorldScale(new THREE.Vector3()),
      oldPositions,
      beforeSnapshot: MeshDataRegion.snapshot(meshData, beforeRegionIds),
      startElements: {
        startVertexId: meshData.nextVertexId,
        startEdgeId: meshData.nextEdgeId,
        startFaceId: meshData.nextFaceId,
      },
      duplicate: DuplicateOps.duplicate(this.vertexEditor, mode, ids),
    };

    this.signals.editSelectionRefresh.dispatch();
    this.editSelection.clearSelection();
    DuplicateOps.selectDuplicated(this.editSelection, mode, this.session.duplicate);

    return this.session;
  }

  hasSession() {
    return this.session !== null;
  }

  endSession() {
    this.session = null;
  }

  // Moves the copy by the handle offset (snapped if a snap target is under the cursor).
  apply(handle, event) {
    const s = this.session;
    if (!s || !handle) return;

    const { object, duplicate } = s;
    this.vertexEditor.setObject(object);

    let offset = handle.getWorldPosition(new THREE.Vector3()).sub(s.pivotPosition);

    const snapTarget = this.snapManager.snapEditPosition(event, duplicate.newVertexIds, object);
    if (snapTarget) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(s.oldPositions, snapTarget);

      if (nearestWorldPos) {
        offset.subVectors(snapTarget, nearestWorldPos);
        offset = this.snapManager.constrainTranslationOffset(offset, this.axis, this.space, s.pivotQuaternion);

        handle.position.copy(s.pivotPosition).add(offset);
        this.transformControls.update();
      }
    }

    const newPositions = duplicate.initialPositions.map(pos => pos.clone().add(offset));
    this.vertexEditor.transform.setVertexPositions(duplicate.newVertexIds, newPositions);
  }

  // Records the duplicate on the history stack. Returns true if a command was executed.
  commit() {
    const s = this.session;
    if (!s) return false;

    const { object, mode, duplicate } = s;
    this.vertexEditor.setObject(object);

    this.editor.execute(DuplicateOps.createCommand(this.editor, object, s.beforeSnapshot, s.startElements));
    DuplicateOps.selectDuplicated(this.editSelection, mode, duplicate);

    this.endSession();
    return true;
  }

  // Moves the copy back onto the original. The copy stays; call commit() afterwards to record it.
  cancel(handle) {
    const s = this.session;
    if (!s) return;

    this.vertexEditor.setObject(s.object);
    this.vertexEditor.transform.setVertexPositions(s.duplicate.newVertexIds, s.duplicate.initialPositions);

    if (handle) {
      handle.position.copy(s.pivotPosition);
      handle.quaternion.copy(s.pivotQuaternion);
      handle.scale.copy(s.pivotScale);
      handle.updateMatrixWorld(true);
    }
  }

  // Non-interactive API (no gizmo, no session).

  /**
   * Duplicate the given elements in place. vertexEditor must be set to the object.
   * Returns { newVertexIds, newEdgeIds, newFaceIds, initialPositions }.
   */
  static duplicate(vertexEditor, mode, { vertexIds, edgeIds, faceIds }) {
    const duplicate = vertexEditor.duplicate;

    const result =
      mode === 'vertex' ? duplicate.duplicateSelectionVertices(vertexIds)
      : mode === 'edge' ? duplicate.duplicateSelectionEdges(edgeIds)
      : duplicate.duplicateSelectionFaces(faceIds);

    return {
      newVertexIds: result.newVertexIds,
      newEdgeIds: result.newEdgeIds,
      newFaceIds: result.newFaceIds,
      initialPositions: vertexEditor.transform.getVertexPositions(result.newVertexIds),
    };
  }

  static selectDuplicated(editSelection, mode, duplicate) {
    if (mode === 'vertex') editSelection.selectVertices(duplicate.newVertexIds);
    else if (mode === 'edge') editSelection.selectEdges(duplicate.newEdgeIds);
    else if (mode === 'face') editSelection.selectFaces(duplicate.newFaceIds);
  }

  /**
   * Build the undo command for a duplicate that is already applied to meshData.
   * Mutates beforeSnapshot (captures new element ids), so call it once.
   */
  static createCommand(editor, object, beforeSnapshot, startElements) {
    const meshData = object.userData.meshData;

    MeshDataRegion.captureNewElements(meshData, startElements, beforeSnapshot);
    const afterRegionIds = MeshDataRegion.idsOf(beforeSnapshot);
    const afterSnapshot = MeshDataRegion.snapshot(meshData, afterRegionIds);

    return new DuplicateSelectionCommand(editor, object, beforeSnapshot, afterSnapshot);
  }
}