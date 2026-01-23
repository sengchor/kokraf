import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { SetPositionCommand } from "../commands/SetPositionCommand.js";
import { SetRotationCommand } from "../commands/SetRotationCommand.js";
import { SetScaleCommand } from '../commands/SetScaleCommand.js';
import { MultiCommand } from '../commands/MultiCommand.js';
import { TransformCommandSolver } from './TransformCommandSolver.js';

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
    this.viewportControls = editor.viewportControls;

    this.activeTransformSource = null;
    this.event = null;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode(this.mode);
    this.transformControls.visible = false;

    this.renderer.domElement.addEventListener('pointermove', (e) => this.event = e);
    this.sceneEditorHelpers.add(this.transformControls.getHelper());

    this.transformSolver = new TransformCommandSolver(this.camera, this.renderer, this.transformControls);

    this.transformSolver.changeTransformControlsColor();
    this.setupTransformListeners();
    this.setupListeners();

    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);
  }

  enableFor(object) {
    if (!object) return;

    this.transformControls.attach(object);
    this.transformControls.visible = true;
    this.handle = this.transformControls.object;

    this.applyTransformOrientation(this.viewportControls.transformOrientation);

    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this._onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('keydown', this._onKeyDown);
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

  // Signals & Listeners
  setupListeners() {
    this.signals.transformOrientationChanged.add((orientation) => {
      this.applyTransformOrientation(orientation);
    });

    this.signals.objectTransformStart.add((transformMode) => {
      if (this.mode !== transformMode) return;
      
      const objects = this.selection.selectedObjects;
      if (!objects || objects.length === 0 || !this.handle) return;

      if (this.activeTransformSource !== null) return;

      if (this.handle && this.transformControls.worldPositionStart) {
        this.handle.getWorldPosition(this.transformControls.worldPositionStart);
      }

      this.activeTransformSource = 'command';
      this.startTransformSession();

      this.transformSolver.updateHandleFromCommandInput(this.mode, this.event);
      this.applyTransformSession();

      this.signals.transformDragStarted.dispatch('object');
    });
  }

  // Gizmo Control
  setupTransformListeners() {
    this.transformControls.addEventListener('mouseDown', () => {
      if (this.activeTransformSource !== null) return;

      this.activeTransformSource = 'gizmo';
      this.startTransformSession();
    });

    this.transformControls.addEventListener('change', () => {
      if (!this.transformControls.dragging) return;
      if (this.activeTransformSource !== 'gizmo') return;

      this.applyTransformSession();
    });

    this.transformControls.addEventListener('mouseUp', () => {
      if (this.activeTransformSource !== 'gizmo') return;

      this.commitTransformSession();
      this.activeTransformSource = null;
    });

    // Signal dispatch
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
  }

  // Command Control
  onPointerMove() {
    if (this.activeTransformSource !== 'command') return;
    this.transformSolver.updateHandleFromCommandInput(this.mode, this.event);
    this.applyTransformSession();
    this.signals.objectChanged.dispatch();
  }

  onPointerDown() {
    if (this.activeTransformSource !== 'command') return;
    this.commitTransformSession();
    this.transformSolver.clearGizmoActiveVisualState();
    this.transformSolver.clear();
  }

  onPointerUp() {
    if (this.activeTransformSource !== 'command') return;
    this.clearCommandTransformState();
  }

  onKeyDown(event) {
    if (this.activeTransformSource !== 'command') return;

    const key = event.key.toLowerCase();
    if (key === 'x' || key === 'y' || key === 'z') {
      this.transformSolver.setAxisConstraintFromKey(key);

      this.transformSolver.updateHandleFromCommandInput(this.mode, this.event);
      this.applyTransformSession();
      return;
    }

    if (event.key === 'Escape') {
      this.cancelTransformSession();
      this.clearCommandTransformState();
    }

    if (event.key === 'Enter') {
      this.commitTransformSession();
      this.clearCommandTransformState();
    }
  }

  // Transform session
  startTransformSession() {
    const objects = this.selection.selectedObjects;
    if (!objects?.length || !this.handle) return;

    this.startPivotPosition = this.handle.getWorldPosition(new THREE.Vector3());
    this.startPivotQuaternion = this.handle.getWorldQuaternion(new THREE.Quaternion());
    this.startPivotScale = this.handle.getWorldScale(new THREE.Vector3());

    this.startPositions = objects.map(obj => obj.getWorldPosition(new THREE.Vector3()));
    this.startQuaternions = objects.map(obj => obj.getWorldQuaternion(new THREE.Quaternion()));
    this.startScales = objects.map(obj => obj.getWorldScale(new THREE.Vector3()));

    this.transformSolver.beginSession(this.startPivotPosition, this.startPivotQuaternion, this.startPivotScale);

    if (this.snapManager.enabled) {
      this.oldPositions = this.snapManager.getBoundingBoxVertexPositions(objects);
    }
  }

  applyTransformSession() {
    const objects = this.selection.selectedObjects;
    if (!objects?.length || !this.handle) return;

    if (this.mode === 'translate') this.applyTranslation(objects, this.handle);
    else if (this.mode === 'rotate') this.applyRotation(objects, this.handle);
    else if (this.mode === 'scale') this.applyScale(objects, this.handle);
  }

  commitTransformSession() {
    const objects = this.selection.selectedObjects;
    if (!objects?.length || !this.handle) return;

    if (this.mode === 'translate') this.commitTranslation(objects, this.handle);
    else if (this.mode === 'rotate') this.commitRotation(objects, this.handle);
    else if (this.mode === 'scale') this.commitScale(objects, this.handle);

    this.clearStartData();
  }

  cancelTransformSession() {
    const objects = this.selection.selectedObjects;
    if (!objects || objects.length === 0) return;

    // restore objects
    for (let i = 0; i < objects.length; i++) {
      objects[i].position.copy(this.startPositions[i]);
      objects[i].quaternion.copy(this.startQuaternions[i]);
      objects[i].scale.copy(this.startScales[i]);
      objects[i].updateMatrixWorld(true);
    }

    // restore pivot / handle
    this.handle.position.copy(this.startPivotPosition);
    this.handle.quaternion.copy(this.startPivotQuaternion);
    this.handle.scale.copy(this.startPivotScale);
    this.handle.updateMatrixWorld(true);
  }

  clearCommandTransformState() {
    this.activeTransformSource = null;

    this.transformSolver.clear();
    this.transformSolver.clearGizmoActiveVisualState();

    requestAnimationFrame(() => {
      this.signals.transformDragEnded.dispatch('object');
    });
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

  // Apply transforms
  applyTranslation(objects, handle) {
    if (!this.startPivotPosition || !this.startPositions) return;

    const currentPivotPosition = handle.getWorldPosition(new THREE.Vector3());
    let offset = new THREE.Vector3().subVectors(currentPivotPosition, this.startPivotPosition);

    let snapTarget = this.snapManager.snapObjectPosition(this.event, objects);

    if (snapTarget) {
      const nearestWorldPos = this.snapManager.getNearestPositionToPoint(this.oldPositions, snapTarget);

      if (nearestWorldPos) {
        offset = new THREE.Vector3().subVectors(snapTarget, nearestWorldPos);
        offset = this.snapManager.constrainTranslationOffset(offset, this.transformControls.axis, this.transformControls.space, this.startPivotQuaternion);

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

  // Commit Transforms
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

  // Utilities
  applyScaleToObject(object, scaleFactor, startScale, orientation) {
    if (orientation === 'global') {
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

    if (orientation === 'global') {
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