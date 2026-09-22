import * as THREE from 'three';
import { SetVertexPositionCommand } from '../commands/SetVertexPositionCommand.js';
import { ObjectTransformOps } from './ObjectTransformOps.js';
import { TransformUtils } from '../utils/TransformUtils.js';

const IDENTITY_QUAT = new THREE.Quaternion();
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

export class EditTransformOps {
  constructor(editor, transformControls) {
    this.editor = editor;
    this.transformControls = transformControls;
    this.vertexEditor = editor.vertexEditor;
    this.editSelection = editor.editSelection;
    this.snapManager = editor.snapManager;

    this.session = null;
    this.currentScaleFactor = new THREE.Vector3(1, 1, 1);
  }

  get axis() { return this.transformControls.axis; }
  get space() { return this.transformControls.space; }

  // Session
  beginSession(object, handle) {
    if (!object || !handle) return null;

    const vertexIds = Array.from(this.editSelection.selectedVertexIds);
    if (!vertexIds.length) return null;

    this.vertexEditor.setObject(object);
    const oldPositions = this.vertexEditor.transform.getVertexPositions(vertexIds);

    this.session = {
      object,
      vertexIds,
      pivotPosition: handle.getWorldPosition(new THREE.Vector3()),
      pivotQuaternion: handle.getWorldQuaternion(new THREE.Quaternion()),
      pivotScale: handle.scale.clone(),
      oldPositions,
      pool: oldPositions.map(() => new THREE.Vector3()), // reused every apply
      delta: null, // Vector3 (translate/scale) or Quaternion (rotate)
    };

    return this.session;
  }

  hasSession() {
    return this.session !== null;
  }

  endSession() {
    this.session = null;
  }

  apply(mode, handle, event, numericActive) {
    const s = this.session;
    if (!s || !handle) return;

    let delta;
    if (mode === 'translate') delta = this.resolveTranslation(handle, event, numericActive);
    else if (mode === 'rotate') delta = this.resolveRotation(handle, event, numericActive);
    else if (mode === 'scale') delta = this.resolveScale(handle, event, numericActive);
    else return;

    s.delta = delta;

    EditTransformOps.transformPositions(mode, s.oldPositions, s.pool, {
      pivot: s.pivotPosition,
      pivotQuaternion: s.pivotQuaternion,
      delta,
      space: this.space,
    });

    this.vertexEditor.setObject(s.object);
    this.vertexEditor.transform.setVertexPositions(s.vertexIds, s.pool);

    if (mode === 'rotate') {
      handle.quaternion.copy(delta).multiply(s.pivotQuaternion);
      this.transformControls.update();
    } else if (mode === 'scale') {
      handle.scale.set(1, 1, 1);
      handle.updateMatrixWorld(true);
    }
  }

  // Returns true if an undoable command was executed.
  commit(mode) {
    const s = this.session;
    if (!s) return false;

    if (mode === 'scale') this.currentScaleFactor.set(1, 1, 1);

    const { object, vertexIds, oldPositions, delta } = s;
    if (!delta || EditTransformOps.isIdentity(mode, delta)) {
      this.endSession();
      return false;
    }

    const newPositions = EditTransformOps.transformPositions(
      mode,
      oldPositions,
      oldPositions.map(() => new THREE.Vector3()),
      { pivot: s.pivotPosition, pivotQuaternion: s.pivotQuaternion, delta, space: this.space }
    );

    const positions = { from: oldPositions, to: newPositions };
    this.editor.execute(EditTransformOps.createCommand(this.editor, object, vertexIds, { positions }));
    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();

    this.endSession();
    return true;
  }

  // Restores the vertices and handle, then ends the session.
  cancel(handle) {
    const s = this.session;
    if (!s) return;

    this.vertexEditor.setObject(s.object);
    this.vertexEditor.transform.setVertexPositions(s.vertexIds, s.oldPositions, true);

    if (handle) {
      handle.position.copy(s.pivotPosition);
      handle.quaternion.copy(s.pivotQuaternion);
      handle.scale.copy(s.pivotScale);
      handle.updateMatrixWorld(true);
    }

    this.currentScaleFactor.set(1, 1, 1);
    this.endSession();
  }

  // Delta resolution (handle state + snapping → delta)
  resolveTranslation(handle, event, numericActive) {
    const s = this.session;
    const offset = handle.getWorldPosition(new THREE.Vector3()).sub(s.pivotPosition);

    const snapTarget = this.snapManager.snapEditPosition(event, s.vertexIds, s.object);
    if (snapTarget && !numericActive) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(s.oldPositions, snapTarget);

      if (nearestWorldPos) {
        offset.subVectors(snapTarget, nearestWorldPos);
        offset.copy(this.snapManager.constrainTranslationOffset(offset, this.axis, this.space, s.pivotQuaternion));

        handle.position.copy(s.pivotPosition).add(offset);
        this.transformControls.update();
      }
    }

    return offset;
  }

  resolveRotation(handle, event, numericActive) {
    const s = this.session;
    const pivot = s.pivotPosition;

    let deltaQuat = handle.getWorldQuaternion(new THREE.Quaternion())
      .multiply(s.pivotQuaternion.clone().invert());

    const snapTarget = this.snapManager.snapEditPosition(event, s.vertexIds, s.object);
    if (snapTarget && !numericActive) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(s.oldPositions, snapTarget);

      if (nearestWorldPos) {
        const fromDir = nearestWorldPos.clone().sub(pivot).normalize();
        const toDir = snapTarget.clone().sub(pivot).normalize();

        if (fromDir.lengthSq() > 0 && toDir.lengthSq() > 0) {
          const axis = this.snapManager.getEffectiveRotationAxis(this.axis, this.space, s.pivotQuaternion);

          if (axis) {
            const fromProj = fromDir.clone().projectOnPlane(axis).normalize();
            const toProj = toDir.clone().projectOnPlane(axis).normalize();

            if (fromProj.lengthSq() > 0 && toProj.lengthSq() > 0) {
              const angle = Math.atan2(axis.dot(fromProj.clone().cross(toProj)), fromProj.dot(toProj));
              deltaQuat = new THREE.Quaternion().setFromAxisAngle(axis, angle);
            }
          } else {
            deltaQuat = new THREE.Quaternion().setFromUnitVectors(fromDir, toDir);
          }
        }
      }
    }

    return deltaQuat;
  }

  resolveScale(handle, event, numericActive) {
    const s = this.session;
    const pivot = s.pivotPosition;

    const scaleFactor = handle.scale.clone().divide(s.pivotScale);

    const snapTarget = this.snapManager.snapEditPosition(event, s.vertexIds, s.object);
    if (snapTarget && !numericActive) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(s.oldPositions, snapTarget);

      if (nearestWorldPos) {
        const fromOffset = nearestWorldPos.clone().sub(pivot);
        const toOffset = snapTarget.clone().sub(pivot);

        const fromLength = this.snapManager.projectOntoTransformAxis(fromOffset, this.axis, this.space, s.object).length();
        const toLength = this.snapManager.projectOntoTransformAxis(toOffset, this.axis, this.space, s.object).length();

        if (fromLength > 1e-6) {
          scaleFactor.copy(this.snapManager.makeScaleVectorFromAxis(toLength / fromLength, this.axis));

          handle.scale.copy(s.pivotScale).multiply(scaleFactor);
          this.transformControls.update();
        }
      }
    }

    this.currentScaleFactor.copy(scaleFactor);
    return scaleFactor;
  }

  // Numeric input (updates the handle only; caller re-applies the session)
  numericTranslate(value, handle) {
    const s = this.session;
    if (!s || !handle) return false;

    const offset = ObjectTransformOps.axisVector(this.axis, value, 0);
    if (!offset) return false;

    if (this.space === 'local') offset.applyQuaternion(s.pivotQuaternion);

    handle.position.copy(s.pivotPosition).add(offset);
    return true;
  }

  numericRotate(value, handle, camera) {
    const s = this.session;
    const axis = this.axis;
    if (!s || !handle || !axis) return false;

    const rotAxis = new THREE.Vector3();
    if (axis === 'XYZ') camera.getWorldDirection(rotAxis).normalize();
    else if (axis === 'X') rotAxis.set(1, 0, 0);
    else if (axis === 'Y') rotAxis.set(0, 1, 0);
    else if (axis === 'Z') rotAxis.set(0, 0, 1);
    else return false;

    const deltaQuat = new THREE.Quaternion().setFromAxisAngle(rotAxis, THREE.MathUtils.degToRad(value));

    const useLocal = this.space === 'local' && axis !== 'XYZ';
    handle.quaternion.copy(useLocal
      ? s.pivotQuaternion.clone().multiply(deltaQuat)
      : deltaQuat.multiply(s.pivotQuaternion));

    return true;
  }

  numericScale(value, handle) {
    const s = this.session;
    if (!s || !handle) return false;

    const scaleFactor = ObjectTransformOps.axisVector(this.axis, value, 1);
    if (!scaleFactor) return false;

    handle.scale.copy(s.pivotScale).multiply(scaleFactor);
    return true;
  }

  // Non-interactive API (no gizmo, no session).

  static getPositions(editor, object, vertexIds) {
    editor.vertexEditor.setObject(object);
    return editor.vertexEditor.transform.getVertexPositions(vertexIds);
  }

  static resolvePivot(pivot, object, positions) {
    if (pivot?.isVector3) return pivot.clone();
    if (Array.isArray(pivot)) return new THREE.Vector3().fromArray(pivot);
    if (pivot === 'origin') return object.getWorldPosition(new THREE.Vector3());
    if (pivot === 'median') {
      const center = new THREE.Vector3();
      for (const p of positions) center.add(p);
      return center.divideScalar(positions.length);
    }
    throw new Error(`Unknown pivot "${pivot}". Use 'median', 'origin' or [x, y, z].`);
  }

  static resolvePositions(object, from, { translate, rotate, scale } = {}, { pivot = 'median', space = 'world' } = {}) {
    const toVec = (v) => (v.isVector3 ? v.clone() : new THREE.Vector3().fromArray(v));

    const frame = space === 'local' ? TransformUtils.worldQuaternion(object) : new THREE.Quaternion();
    const pivotPosition = EditTransformOps.resolvePivot(pivot, object, from);
    const opts = { pivot: pivotPosition, pivotQuaternion: frame, space };
    const to = from.map((p) => p.clone());

    if (scale) {
      EditTransformOps.transformPositions('scale', to, to, { ...opts, delta: toVec(scale) });
    }

    if (rotate) {
      const worldQuat = frame.clone().multiply(rotate).multiply(frame.clone().invert());
      EditTransformOps.transformPositions('rotate', to, to, { ...opts, delta: worldQuat });
    }

    if (translate) {
      const offset = toVec(translate).applyQuaternion(frame);
      EditTransformOps.transformPositions('translate', to, to, { ...opts, delta: offset });
    }

    return { from, to, pivot: pivotPosition };
  }

  static transformPositions(mode, from, out, { pivot, pivotQuaternion, delta, space = 'world' }) {
    const invPivotQuat = mode === 'scale' && space === 'local'
      ? pivotQuaternion.clone().invert()
      : null;

    for (let i = 0; i < from.length; i++) {
      const target = out[i].copy(from[i]);

      if (mode === 'translate') {
        target.add(delta);
      } else if (mode === 'rotate') {
        target.sub(pivot).applyQuaternion(delta).add(pivot);
      } else if (mode === 'scale') {
        target.sub(pivot);

        if (invPivotQuat) {
          target.applyQuaternion(invPivotQuat).multiply(delta).applyQuaternion(pivotQuaternion);
        } else {
          target.multiply(delta);
        }

        target.add(pivot);
      }
    }

    return out;
  }

  static isIdentity(mode, delta) {
    if (mode === 'translate') return delta.lengthSq() === 0;
    if (mode === 'rotate') return delta.equals(IDENTITY_QUAT);
    if (mode === 'scale') return delta.equals(UNIT_SCALE);
    return true;
  }

  static createCommand(editor, object, vertexIds, { positions } = {}) {
    if (!positions) return null;
    return new SetVertexPositionCommand(editor, object, vertexIds, positions.to, positions.from);
  }
}