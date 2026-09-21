import * as THREE from 'three';
import { SetPositionCommand } from '../commands/SetPositionCommand.js';
import { SetRotationCommand } from '../commands/SetRotationCommand.js';
import { SetScaleCommand } from '../commands/SetScaleCommand.js';
import { MultiCommand } from '../commands/MultiCommand.js';
import { TransformUtils } from '../utils/TransformUtils.js';

export class ObjectTransformOps {
  constructor(editor, transformControls) {
    this.editor = editor;
    this.transformControls = transformControls;
    this.selection = editor.selection;
    this.snapManager = editor.snapManager;
    this.viewportControls = editor.viewportControls;

    this.session = null;
    this.currentScaleFactor = new THREE.Vector3(1, 1, 1);
  }

  get axis() { return this.transformControls.axis; }
  get space() { return this.transformControls.space; }

  // Session
  beginSession(objects, handle) {
    if (!objects?.length || !handle) return null;

    this.session = {
      pivotPosition: handle.getWorldPosition(new THREE.Vector3()),
      pivotQuaternion: TransformUtils.worldQuaternion(handle),
      pivotScale: handle.scale.clone(),
      positions: objects.map(obj => obj.getWorldPosition(new THREE.Vector3())),
      quaternions: objects.map(obj => TransformUtils.worldQuaternion(obj)),
      scales: objects.map(obj => obj.scale.clone()),
      snapPositions: this.snapManager.enabled
        ? this.snapManager.getBoundingBoxVertexPositions(objects)
        : null,
    };

    return this.session;
  }

  hasSession() {
    return this.session !== null;
  }

  endSession() {
    this.session = null;
  }

  apply(mode, objects, handle, event, numericActive) {
    if (!this.session || !objects?.length || !handle) return;

    if (mode === 'translate') this.applyTranslation(objects, handle, event, numericActive);
    else if (mode === 'rotate') this.applyRotation(objects, handle, event, numericActive);
    else if (mode === 'scale') this.applyScale(objects, handle, event, numericActive);
  }

  commit(mode, objects, handle) {
    if (!this.session || !objects?.length || !handle) return;

    if (mode === 'translate') this.commitTranslation(objects, handle);
    else if (mode === 'rotate') this.commitRotation(objects, handle);
    else if (mode === 'scale') this.commitScale(objects);

    this.endSession();
  }

  cancel(objects, handle) {
    const s = this.session;
    if (!s || !objects?.length) return;

    for (let i = 0; i < objects.length; i++) {
      const object = objects[i];
      TransformUtils.setWorldPosition(object, s.positions[i].clone());
      TransformUtils.setWorldRotation(object, s.quaternions[i].clone());
      object.scale.copy(s.scales[i]);
      object.updateMatrixWorld(true);
    }

    if (handle) {
      handle.position.copy(s.pivotPosition);
      handle.quaternion.copy(s.pivotQuaternion);
      handle.scale.copy(s.pivotScale);
      handle.updateMatrixWorld(true);
    }

    this.endSession();
  }

  // Snapping
  getSnapTarget(event, numericActive) {
    const affectedObjects = this.selection.getAffectedObjects();
    const target = this.snapManager.snapObjectPosition(event, affectedObjects);
    return target && !numericActive ? target : null;
  }

  getNearestSnapSource(snapTarget) {
    return this.snapManager.getNearestPositionToPoint(this.session.snapPositions, snapTarget);
  }

  // Apply transforms
  applyTranslation(objects, handle, event, numericActive) {
    const s = this.session;

    let offset = handle.getWorldPosition(new THREE.Vector3()).sub(s.pivotPosition);

    const snapTarget = this.getSnapTarget(event, numericActive);
    if (snapTarget) {
      const nearestWorldPos = this.getNearestSnapSource(snapTarget);

      if (nearestWorldPos) {
        offset = snapTarget.clone().sub(nearestWorldPos);
        offset = this.snapManager.constrainTranslationOffset(offset, this.axis, this.space, s.pivotQuaternion);

        handle.position.copy(s.pivotPosition).add(offset);
        this.transformControls.update();
      }
    }

    for (let i = 0; i < objects.length; i++) {
      const worldPos = s.positions[i].clone().add(offset);
      TransformUtils.setWorldPosition(objects[i], worldPos);
      objects[i].updateMatrixWorld(true);
    }
  }

  applyRotation(objects, handle, event, numericActive) {
    const s = this.session;
    const pivot = s.pivotPosition;

    const currentPivotQuat = TransformUtils.worldQuaternion(handle);
    let deltaQuat = currentPivotQuat.clone().multiply(s.pivotQuaternion.clone().invert());

    const snapTarget = this.getSnapTarget(event, numericActive);
    const nearestWorldPos = snapTarget ? this.getNearestSnapSource(snapTarget) : null;

    if (snapTarget && nearestWorldPos) {
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

      handle.quaternion.copy(deltaQuat).multiply(s.pivotQuaternion);
      this.transformControls.update();
    }

    const rotateAroundPivot = objects.length > 1;

    for (let i = 0; i < objects.length; i++) {
      const object = objects[i];

      if (rotateAroundPivot) {
        const worldOffset = s.positions[i].clone().sub(pivot).applyQuaternion(deltaQuat);
        TransformUtils.setWorldPosition(object, pivot.clone().add(worldOffset));
      }

      const worldQuat = deltaQuat.clone().multiply(s.quaternions[i]);
      TransformUtils.setWorldRotation(object, worldQuat);

      object.updateMatrixWorld(true);
    }

    handle.scale.set(1, 1, 1);
    handle.updateMatrixWorld(true);
  }

  applyScale(objects, handle, event, numericActive) {
    const s = this.session;
    const pivot = s.pivotPosition;
    const refObject = objects[objects.length - 1];

    let scaleFactor = handle.scale.clone().divide(s.pivotScale);

    const snapTarget = this.getSnapTarget(event, numericActive);
    if (snapTarget) {
      const nearestWorldPos = this.getNearestSnapSource(snapTarget);

      if (nearestWorldPos) {
        const fromOffset = nearestWorldPos.clone().sub(pivot);
        const toOffset = snapTarget.clone().sub(pivot);

        const projectedFrom = this.snapManager.projectOntoTransformAxis(fromOffset, this.axis, this.space, refObject);
        const projectedTo = this.snapManager.projectOntoTransformAxis(toOffset, this.axis, this.space, refObject);

        const fromLength = projectedFrom.length();
        const toLength = projectedTo.length();

        if (fromLength > 1e-6) {
          const uniformScale = toLength / fromLength;
          scaleFactor = this.snapManager.makeScaleVectorFromAxis(uniformScale, this.axis);

          handle.scale.copy(s.pivotScale).multiply(scaleFactor);
          this.transformControls.update();
        } else {
          scaleFactor = new THREE.Vector3(1, 1, 1);
        }
      }
    }

    this.currentScaleFactor = scaleFactor.clone();

    const pivotQuat = s.pivotQuaternion;
    const invPivotQuat = pivotQuat.clone().invert();
    const orientation = this.viewportControls.transformOrientation;

    for (let i = 0; i < objects.length; i++) {
      const object = objects[i];

      const worldScaleFactor = this.getWorldScaleFactor(object, scaleFactor, orientation);
      const worldScale = s.scales[i].clone().multiply(worldScaleFactor);
      TransformUtils.setWorldScale(object, worldScale);

      if (objects.length > 1) {
        const worldOffset = s.positions[i].clone().sub(pivot);

        if (this.space === 'local') {
          worldOffset.applyQuaternion(invPivotQuat);
          worldOffset.multiply(scaleFactor);
          worldOffset.applyQuaternion(pivotQuat);
        } else {
          worldOffset.multiply(scaleFactor);
        }

        TransformUtils.setWorldPosition(object, pivot.clone().add(worldOffset));
      }

      object.updateMatrixWorld(true);
    }

    handle.scale.set(1, 1, 1);
    handle.updateMatrixWorld(true);
  }

  getWorldScaleFactor(object, scaleFactor, orientation) {
    if (orientation !== 'global') return scaleFactor.clone();

    const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(object.quaternion);
    const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(object.quaternion);
    const localZ = new THREE.Vector3(0, 0, 1).applyQuaternion(object.quaternion);

    const scaledX = localX.clone().multiply(scaleFactor);
    const scaledY = localY.clone().multiply(scaleFactor);
    const scaledZ = localZ.clone().multiply(scaleFactor);

    return new THREE.Vector3(
      scaledX.length() * (Math.sign(scaledX.dot(localX)) || 1),
      scaledY.length() * (Math.sign(scaledY.dot(localY)) || 1),
      scaledZ.length() * (Math.sign(scaledZ.dot(localZ)) || 1)
    );
  }

  // Commit transforms
  commitTranslation(objects, handle) {
    const s = this.session;
    const currentPivotPosition = handle.getWorldPosition(new THREE.Vector3());
    if (currentPivotPosition.equals(s.pivotPosition)) return;

    const positions = { from: s.positions, to: objects.map(obj => obj.getWorldPosition(new THREE.Vector3())) };
    this.editor.execute(ObjectTransformOps.createCommand(this.editor, objects, { positions }));
  }

  commitRotation(objects, handle) {
    const s = this.session;

    const currentPivotQuat = handle.getWorldQuaternion(new THREE.Quaternion());
    if (currentPivotQuat.equals(s.pivotQuaternion)) return;

    const changes = {
      quaternions: {
        from: s.quaternions.map(q => q.clone()),
        to: objects.map(obj => TransformUtils.worldQuaternion(obj)),
      },
    };

    // Multi-object rotation orbits the pivot, so positions change too.
    if (objects.length > 1) {
      changes.positions = { from: s.positions, to: objects.map(obj => obj.getWorldPosition(new THREE.Vector3())) };
    }

    this.editor.execute(ObjectTransformOps.createCommand(this.editor, objects, changes, 'Set Rotation Objects'));
  }

  commitScale(objects) {
    const s = this.session;

    const newScales = objects.map(obj => obj.scale.clone());
    const startScales = s.scales.map(sc => sc.clone());

    const hasScaleChanged = newScales.some((newScale, i) => !newScale.equals(startScales[i]));
    if (!hasScaleChanged) return;

    this.currentScaleFactor = new THREE.Vector3(1, 1, 1);

    const changes = { scales: { from: startScales, to: newScales } };

    // Multi-object scale spreads objects from the pivot, so positions change too.
    if (objects.length > 1) {
      changes.positions = { from: s.positions, to: objects.map(obj => obj.getWorldPosition(new THREE.Vector3())) };
    }

    this.editor.execute(ObjectTransformOps.createCommand(this.editor, objects, changes, 'Set Scale Objects'));
  }

  // Non-interactive API (no gizmo, no session).

  static resolvePositions(objects, position, { relative = false, space = 'world' } = {}) {
    const input = position.isVector3 ? position : new THREE.Vector3().fromArray(position);
    const from = objects.map(obj => obj.getWorldPosition(new THREE.Vector3()));

    const to = objects.map((object, i) => {
      if (relative) {
        const delta = input.clone();
        if (space === 'local') delta.applyQuaternion(TransformUtils.worldQuaternion(object));
        return from[i].clone().add(delta);
      }
      if (space === 'local' && object.parent) {
        return input.clone().applyMatrix4(object.parent.matrixWorld);
      }
      return input.clone();
    });

    return { from, to };
  }

  static resolveQuaternions(objects, quaternion, { relative = false, space = 'world' } = {}) {
    const from = objects.map(obj => TransformUtils.worldQuaternion(obj));

    const to = objects.map((object, i) => {
      if (relative) {
        // local: spin about the object's own axes. world: about global axes.
        return space === 'local'
          ? from[i].clone().multiply(quaternion)
          : quaternion.clone().multiply(from[i]);
      }
      if (space === 'local' && object.parent) {
        return TransformUtils.worldQuaternion(object.parent).multiply(quaternion);
      }
      return quaternion.clone();
    });

    return { from, to };
  }

  static resolveScales(objects, factor, { relative = false } = {}) {
    const from = objects.map(obj => obj.scale.clone());
    const to = from.map(scale => (relative ? scale.clone().multiply(factor) : factor.clone()));
    return { from, to };
  }

  /**
   * Build one undoable command from resolved changes.
   * changes: { positions?, quaternions?, scales? }, each { from, to }.
   * Returns a single Set*Command when only one kind changes, a MultiCommand otherwise, or null.
   */
  static createCommand(editor, objects, { positions, quaternions, scales } = {}, name = 'Transform Objects') {
    const commands = [];

    if (positions) commands.push(new SetPositionCommand(editor, objects, positions.to, positions.from));
    if (quaternions) commands.push(new SetRotationCommand(editor, objects, quaternions.to, quaternions.from));
    if (scales) commands.push(new SetScaleCommand(editor, objects, scales.to, scales.from));

    if (commands.length === 0) return null;
    if (commands.length === 1) return commands[0];

    const multi = new MultiCommand(editor, name);
    for (const command of commands) multi.add(command);
    return multi;
  }

  // Numeric input (updates the handle only; caller re-applies the session)
  static axisVector(axis, value, fill) {
    switch (axis) {
      case 'XYZ': return new THREE.Vector3(value, value, value);
      case 'X': return new THREE.Vector3(value, fill, fill);
      case 'Y': return new THREE.Vector3(fill, value, fill);
      case 'Z': return new THREE.Vector3(fill, fill, value);
      case 'YZ': return new THREE.Vector3(fill, value, value);
      case 'XZ': return new THREE.Vector3(value, fill, value);
      case 'XY': return new THREE.Vector3(value, value, fill);
      default: return null;
    }
  }

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
    const resultQuat = useLocal
      ? s.pivotQuaternion.clone().multiply(deltaQuat)
      : deltaQuat.multiply(s.pivotQuaternion);

    handle.quaternion.copy(resultQuat);
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
}