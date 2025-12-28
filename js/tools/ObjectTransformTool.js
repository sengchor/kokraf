import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { SetPositionCommand } from "../commands/SetPositionCommand.js";
import { SetRotationCommand } from "../commands/SetRotationCommand.js";
import { SetScaleCommand } from '../commands/SetScaleCommand.js';
import { MultiCommand } from '../commands/MultiCommand.js';

export class ObjectTransformTool {
  constructor(editor, mode = 'translate') {
    this.editor = editor;
    this.signals = editor.signals;
    this.mode = mode;
    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.controls = editor.controlsManager;
    this.selection = editor.selection;
    this.snapManager = editor.snapManager;
    this.sceneEditorHelpers = editor.sceneManager.sceneEditorHelpers;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode(this.mode);
    this.transformControls.visible = false;

    this.event = null;
    this.renderer.domElement.addEventListener('pointermove', (e) => this.event = e);

    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
      if (!event.value) this.signals.objectChanged.dispatch();
    });

    this.transformControls.addEventListener('mouseDown', () => {
      this.signals.transformDragStarted.dispatch('object');
    });

    this.transformControls.addEventListener('mouseUp', () => {
      requestAnimationFrame(() => {
        this.signals.transformDragEnded.dispatch('object');
      });
    });

    this.sceneEditorHelpers.add(this.transformControls.getHelper());

    this.changeTransformControlsColor();
    this.setupTransformListeners();
    this.setupListeners();
  }

  enableFor(object) {
    if (!object) return;
    this.transformControls.attach(object);
    this.transformControls.visible = true;

    this.applyTransformOrientation(this.transformControls.space);
  }

  disable() {
    this.transformControls.detach();
    this.transformControls.visible = false;
  }

  setEnabled(state) {
    this.transformControls.enabled = state;
  }

  isTransforming() {
    return this.transformControls.dragging;
  }

  changeTransformControlsColor() {
    const xColor = new THREE.Color(0xff0000);
    const yColor = new THREE.Color(0x00ff00);
    const zColor = new THREE.Color(0x0000ff);

    const helper = this.transformControls.getHelper();

    helper.traverse(child => {
      if (!child.isMesh || !child.name) return;
      if (child.name === 'Z' || child.name === 'XY') {
        child.material.color.set(xColor);
      } else if (child.name === 'Y' || child.name === 'XZ') {
        child.material.color.set(zColor);
      } else if (child.name === 'X' || child.name === 'YZ') {
        child.material.color.set(yColor);
      }
    });
  }

  setupListeners() {
    this.signals.transformOrientationChanged.add((orientation) => {
      this.applyTransformOrientation(orientation);
    });
  }

  setupTransformListeners() {
    this.transformControls.addEventListener('mouseDown', () => {
      const objects = this.selection.selectedObjects;
      if (!objects || objects.length === 0) return;

      const handle = this.transformControls.object;
      if (!handle) return;

      this.startPivotPosition = handle.getWorldPosition(new THREE.Vector3());
      this.startPivotQuaternion = handle.getWorldQuaternion(new THREE.Quaternion());
      this.startPivotScale = handle.getWorldScale(new THREE.Vector3());
      
      this.startPositions = objects.map(obj => obj.getWorldPosition(new THREE.Vector3()));
      this.startQuaternions = objects.map(obj => obj.getWorldQuaternion(new THREE.Quaternion()));
      this.startScales = objects.map(obj => obj.getWorldScale(new THREE.Vector3()));

      if (this.snapManager.enabled) {
        this.oldPositions = this.snapManager.getBoundingBoxVertexPositions(objects);
      }
    });

    this.transformControls.addEventListener('change', () => {
      if (!this.transformControls.dragging) return;
      const objects = this.selection.selectedObjects;
      if (!objects || objects.length === 0) return;

      const handle = this.transformControls.object;
      if (!handle) return;

      if (this.mode === 'translate') this.applyTranslation(objects, handle);
      else if (this.mode === 'rotate') this.applyRotation(objects, handle);
      else if (this.mode === 'scale') this.applyScale(objects, handle);
    });

    this.transformControls.addEventListener('mouseUp', () => {
      const objects = this.selection.selectedObjects;
      if (!objects || objects.length === 0) return;

      const handle = this.transformControls.object;
      if (!handle) return;

      if (this.mode === 'translate') this.commitTranslation(objects, handle);
      else if (this.mode === 'rotate') this.commitRotation(objects, handle);
      else if (this.mode === 'scale') this.commitScale(objects, handle);

      this.clearStartData();
    });
  }

  applyTranslation(objects, handle) {
    if (!this.startPivotPosition || !this.startPositions) return;

    const object = objects[objects.length - 1];
    const currentPivotPosition = handle.getWorldPosition(new THREE.Vector3());
    let offset = new THREE.Vector3().subVectors(currentPivotPosition, this.startPivotPosition);

    let snapTarget = this.snapManager.snapObjectPosition(this.event, objects);

    if (snapTarget) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(this.oldPositions, snapTarget);

      if (nearestWorldPos) {
        offset = new THREE.Vector3().subVectors(snapTarget, nearestWorldPos);
        offset = this.snapManager.constrainTranslationOffset(offset, this.transformControls.axis, this.transformControls.space, object);

        handle.position.copy(this.startPivotPosition).add(offset);
        this.transformControls.update();
      }
    }

    for (let i = 0; i < objects.length; i++) {
      objects[i].position.copy(this.startPositions[i]).add(offset);
      objects[i].updateMatrixWorld(true);
    }
  }

  applyRotation(objects, handle) {
    if (!this.startPivotQuaternion || !this.startQuaternions) return;

    const pivot = this.startPivotPosition.clone();
    const currentPivotQuat = handle.getWorldQuaternion(new THREE.Quaternion());
    let deltaQuat = currentPivotQuat.clone().multiply(this.startPivotQuaternion.clone().invert());

    let snapTarget = this.snapManager.snapObjectPosition(this.event, objects);

    if (snapTarget) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(this.oldPositions, snapTarget);

      const fromDir = nearestWorldPos.clone().sub(pivot).normalize();
      const toDir = snapTarget.clone().sub(pivot).normalize();

      if (fromDir.lengthSq() > 0 && toDir.lengthSq() > 0) {
        const axis = this.snapManager.getEffectiveRotationAxis(this.transformControls.axis, this.transformControls.space, this.startPivotQuaternion);

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

      handle.quaternion.copy(deltaQuat).multiply(this.startPivotQuaternion);
      this.transformControls.update();
    }

    if (objects.length === 1) {
      objects[0].quaternion.copy(deltaQuat).multiply(this.startQuaternions[0]);
      objects[0].updateMatrixWorld(true);
    } else {
      for (let i = 0; i < objects.length; i++) {
        const offset = this.startPositions[i].clone().sub(this.startPivotPosition);
        offset.applyQuaternion(deltaQuat);

        objects[i].position.copy(this.startPivotPosition).add(offset);
        objects[i].quaternion.copy(deltaQuat).multiply(this.startQuaternions[i]);
        objects[i].updateMatrixWorld(true);
      }
    }
  }

  applyScale(objects, handle) {
    if (!this.startPivotScale || !this.startScales) return;

    const object = objects[objects.length - 1];
    const pivot = this.startPivotPosition.clone();
    const currentPivotScale = handle.getWorldScale(new THREE.Vector3());
    let scaleFactor = currentPivotScale.divide(this.startPivotScale);

    const snapTarget = this.snapManager.snapObjectPosition(this.event, objects);

    if (snapTarget) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(this.oldPositions, snapTarget);

      const fromOffset = nearestWorldPos.clone().sub(pivot);
      const toOffset = snapTarget.clone().sub(pivot);

      const projectedFrom = this.snapManager.projectOntoTransformAxis(fromOffset, this.transformControls.axis, this.transformControls.space, object);
      const projectedTo = this.snapManager.projectOntoTransformAxis(toOffset, this.transformControls.axis, this.transformControls.space, object);

      const fromLength = projectedFrom.length();
      const toLength = projectedTo.length();

      if (fromLength > 1e-6) {
        const uniformScale = toLength / fromLength;

        scaleFactor = this.snapManager.makeScaleVectorFromAxis(uniformScale, this.transformControls.axis);

        handle.scale.copy(this.startPivotScale).multiply(scaleFactor);
        this.transformControls.update();
      } else {
        scaleFactor = new THREE.Vector3(1, 1, 1);
      }
    }

    const pivotQuat = this.startPivotQuaternion;
    const invPivotQuat = pivotQuat.clone().invert();
    for (let i = 0; i < objects.length; i++) {
      this.applyScaleToObject(objects[i], scaleFactor, this.startScales[i], this.transformControls.space);

      if (objects.length > 1) {
        let offset = this.startPositions[i].clone().sub(this.startPivotPosition);
        
        if (this.transformControls.space === 'local') {
          offset.applyQuaternion(invPivotQuat);
          offset.multiply(scaleFactor);
          offset.applyQuaternion(pivotQuat);
        } else {
          offset.multiply(scaleFactor);
        }

        objects[i].position.copy(this.startPivotPosition).add(offset);
      }

      objects[i].updateMatrixWorld(true);
    }
  }

  commitTranslation(objects, handle) {
    const currentPivotPosition = handle.getWorldPosition(new THREE.Vector3());

    if (!currentPivotPosition.equals(this.startPivotPosition)) {
      const newPositions = objects.map(obj => obj.getWorldPosition(new THREE.Vector3()));
      this.editor.execute(new SetPositionCommand(this.editor, objects, newPositions, this.startPositions));
    }
  }

  commitRotation(objects, handle) {
    const newRotations = objects.map(obj => obj.rotation.clone());
    const startRotations = this.startQuaternions.map(q => new THREE.Euler().setFromQuaternion(q));

    const currentPivotQuat = handle.getWorldQuaternion(new THREE.Quaternion());
    if (currentPivotQuat.equals(this.startPivotQuaternion)) return;

    if (objects.length === 1) {
      this.editor.execute(new SetRotationCommand(this.editor, objects, newRotations, startRotations));
    } else {
      const newPositions = objects.map(obj => obj.getWorldPosition(new THREE.Vector3()));
      const posCmd = new SetPositionCommand(this.editor, objects, newPositions, this.startPositions);
      const rotCmd = new SetRotationCommand(this.editor, objects, newRotations, startRotations);

      const multi = new MultiCommand(this.editor, 'Set Rotation Objects');
      multi.add(posCmd);
      multi.add(rotCmd);
      this.editor.execute(multi);
    }
  }

  commitScale(objects, handle) {
    const newScales = objects.map(obj => obj.scale.clone());
    const startScales = this.startScales.map(s => s.clone());

    const currentPivotScale = handle.getWorldScale(new THREE.Vector3());
    if (currentPivotScale.equals(this.startPivotScale)) return;

    if (objects.length === 1) {
      this.editor.execute(new SetScaleCommand(this.editor, objects, newScales, startScales));
    } else {
      const newPositions = objects.map(obj => obj.getWorldPosition(new THREE.Vector3()));
      const posCmd = new SetPositionCommand(this.editor, objects, newPositions, this.startPositions);
      const scaleCmd = new SetScaleCommand(this.editor, objects, newScales, startScales);

      const multi = new MultiCommand(this.editor, 'Set Scale Objects');
      multi.add(posCmd);
      multi.add(scaleCmd);
      this.editor.execute(multi);
    }
  }

  clearStartData() {
    this.startPositions = null;
    this.startQuaternions = null;
    this.startScales = null;
    this.startPivotPosition = null;
    this.startPivotQuaternion = null;
    this.startPivotScale = null;

    this.oldPositions = null;
  }

  applyScaleToObject(object, scaleFactor, startScale, orientation) {
    if (orientation === 'world') {
      const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(object.quaternion);
      const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(object.quaternion);
      const localZ = new THREE.Vector3(0, 0, 1).applyQuaternion(object.quaternion);

      const newScaleX = localX.clone().multiply(scaleFactor).length();
      const newScaleY = localY.clone().multiply(scaleFactor).length();
      const newScaleZ = localZ.clone().multiply(scaleFactor).length();

      object.scale.set(
        startScale.x * newScaleX,
        startScale.y * newScaleY,
        startScale.z * newScaleZ
      );
    } else {
      object.scale.set(
        startScale.x * scaleFactor.x,
        startScale.y * scaleFactor.y,
        startScale.z * scaleFactor.z
      );
    }
  }

  applyTransformOrientation(orientation) {
    if (!this.transformControls) return;

    if (orientation === 'world') {
      this.selection.pivotHandle.quaternion.identity();
      this.transformControls.setSpace('world');
    } else {
      const objects = this.selection.selectedObjects;
      const object = objects[objects.length - 1];
      if (!object) return;

      this.selection.pivotHandle.quaternion.copy(
        object.getWorldQuaternion(new THREE.Quaternion())
      );
      this.transformControls.setSpace('local');
    }
  }
}