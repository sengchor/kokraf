import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { SetPositionCommand } from "../commands/SetPositionCommand.js";
import { SetRotationCommand } from "../commands/SetRotationCommand.js";
import { SetScaleCommand } from '../commands/SetScaleCommand.js';
import { MultiCommand } from '../commands/MultiCommand.js';
import { TransformCommandSolver } from './TransformCommandSolver.js';
import { TransformUtils } from '../utils/TransformUtils.js';
import { TransformNumericInput } from './TransformNumericInput.js';

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
    this.transformNumericInput = new TransformNumericInput(this);

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
      
      const objects = this.selection.getRootSelectedObjects();
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
    if (this.activeTransformSource !== 'command' || this.transformNumericInput.active) return;
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
    this.transformNumericInput.reset();
  }

  onKeyDown(event) {
    if (this.activeTransformSource !== 'command') return;

    const key = event.key.toLowerCase();
    if (key === 'x' || key === 'y' || key === 'z') {
      this.transformNumericInput.reset();
      this.transformSolver.setAxisConstraintFromKey(key);

      this.transformSolver.updateHandleFromCommandInput(this.mode, this.event);
      this.applyTransformSession();
      return;
    }

    if (this.transformNumericInput.handleKey(event, this.mode)) {
      return;
    }

    if (event.key === 'Escape') {
      this.cancelTransformSession();
      this.clearCommandTransformState();
      this.transformNumericInput.reset();
    }

    if (event.key === 'Enter') {
      this.commitTransformSession();
      this.clearCommandTransformState();
      this.transformNumericInput.reset();
    }
  }

  // Transform session
  startTransformSession() {
    const objects = this.selection.getRootSelectedObjects();
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

    this.signals.onToolStarted.dispatch(this.transformNumericInput.getTransformDisplayText(this.mode));
  }

  applyTransformSession() {
    const objects = this.selection.getRootSelectedObjects();
    if (!objects?.length || !this.handle) return;

    if (this.mode === 'translate') this.applyTranslation(objects, this.handle);
    else if (this.mode === 'rotate') this.applyRotation(objects, this.handle);
    else if (this.mode === 'scale') this.applyScale(objects, this.handle);

    this.signals.onToolUpdated.dispatch(this.transformNumericInput.getTransformDisplayText(this.mode));
  }

  commitTransformSession() {
    const objects = this.selection.getRootSelectedObjects();
    if (!objects?.length || !this.handle) return;

    if (this.mode === 'translate') this.commitTranslation(objects, this.handle);
    else if (this.mode === 'rotate') this.commitRotation(objects, this.handle);
    else if (this.mode === 'scale') this.commitScale(objects, this.handle);

    this.clearStartData();

    this.signals.onToolEnded.dispatch();
  }

  cancelTransformSession() {
    const objects = this.selection.getRootSelectedObjects();
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

    this.signals.onToolEnded.dispatch();
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

    const affectedObjects = this.selection.getAffectedObjects();
    let snapTarget = this.snapManager.snapObjectPosition(this.event, affectedObjects);

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
      const worldPos = this.startPositions[i].clone().add(offset);
      TransformUtils.setWorldPosition(objects[i], worldPos);
      objects[i].updateMatrixWorld(true);
    }
  }

  applyRotation(objects, handle) {
    if (!this.startPivotQuaternion || !this.startQuaternions) return;

    const pivot = this.startPivotPosition.clone();
    const currentPivotQuat = handle.getWorldQuaternion(new THREE.Quaternion());
    let deltaQuat = currentPivotQuat.clone().multiply(this.startPivotQuaternion.clone().invert());

    const affectedObjects = this.selection.getAffectedObjects();
    let snapTarget = this.snapManager.snapObjectPosition(this.event, affectedObjects);

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
      const object = objects[0];

      const worldQuat = deltaQuat.clone().multiply(this.startQuaternions[0]);
      TransformUtils.setWorldRotation(object, worldQuat);

      object.updateMatrixWorld(true);
    } else {
      for (let i = 0; i < objects.length; i++) {
        const object = objects[i];

        const worldOffset = this.startPositions[i].clone()
          .sub(this.startPivotPosition)
          .applyQuaternion(deltaQuat);

        const worldPos = this.startPivotPosition.clone().add(worldOffset);
        TransformUtils.setWorldPosition(object, worldPos);

        const worldQuat = deltaQuat.clone().multiply(this.startQuaternions[i]);
        TransformUtils.setWorldRotation(object, worldQuat);

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

    const affectedObjects = this.selection.getAffectedObjects();
    const snapTarget = this.snapManager.snapObjectPosition(this.event, affectedObjects);

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
      const object = objects[i];

      const worldScaleFactor = this.getWorldScaleFactor(object, scaleFactor, this.viewportControls.transformOrientation);
      const worldScale = this.startScales[i].clone().multiply(worldScaleFactor);
      TransformUtils.setWorldScale(objects[i], worldScale);

      if (objects.length > 1) {
        let worldOffset = this.startPositions[i].clone().sub(this.startPivotPosition);
        
        if (this.transformControls.space === 'local') {
          worldOffset.applyQuaternion(invPivotQuat);
          worldOffset.multiply(scaleFactor);
          worldOffset.applyQuaternion(pivotQuat);
        } else {
          worldOffset.multiply(scaleFactor);
        }

        const worldPos = this.startPivotPosition.clone().add(worldOffset);
        TransformUtils.setWorldPosition(object, worldPos);
      }

      object.updateMatrixWorld(true);
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
    const newQuaternions = objects.map(obj => obj.getWorldQuaternion(new THREE.Quaternion()));
    const startQuaternions = this.startQuaternions.map(q => q.clone());

    const currentPivotQuat = handle.getWorldQuaternion(new THREE.Quaternion());
    if (currentPivotQuat.equals(this.startPivotQuaternion)) return;

    if (objects.length === 1) {
      this.editor.execute(new SetRotationCommand(this.editor, objects, newQuaternions, startQuaternions));
    } else {
      const newPositions = objects.map(obj => obj.getWorldPosition(new THREE.Vector3()));
      const posCmd = new SetPositionCommand(this.editor, objects, newPositions, this.startPositions);
      const rotCmd = new SetRotationCommand(this.editor, objects, newQuaternions, startQuaternions);

      const multi = new MultiCommand(this.editor, 'Set Rotation Objects');
      multi.add(posCmd);
      multi.add(rotCmd);
      this.editor.execute(multi);
    }
  }

  commitScale(objects, handle) {
    const newScales = objects.map(obj => obj.getWorldScale(new THREE.Vector3()));
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

  getWorldScaleFactor(object, scaleFactor, orientation) {
    if (orientation === 'global') {
      const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(object.quaternion);
      const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(object.quaternion);
      const localZ = new THREE.Vector3(0, 0, 1).applyQuaternion(object.quaternion);

      return new THREE.Vector3(
        localX.clone().multiply(scaleFactor).length(),
        localY.clone().multiply(scaleFactor).length(),
        localZ.clone().multiply(scaleFactor).length()
      );
    }

    return scaleFactor.clone();
  }

  applyTransformOrientation(orientation) {
    if (!this.transformControls) return;

    if (orientation === 'global') {
      this.selection.pivotHandle.quaternion.identity();
      this.transformControls.setSpace('world');
    } else {
      const objects = this.selection.getRootSelectedObjects();
      const object = objects[objects.length - 1];
      if (!object) return;

      this.selection.pivotHandle.quaternion.copy(
        object.getWorldQuaternion(new THREE.Quaternion())
      );
      this.transformControls.setSpace('local');
    }
  }

  applyNumericTranslation(value) {
    const axis = this.transformControls.axis;
    if (!axis || !this.startPivotPosition || !this.handle) return;

    const offset = new THREE.Vector3();
    
    if (axis === 'XYZ') offset.set(value, value, value);
    else if (axis === 'X') offset.x = value;
    else if (axis === 'Y') offset.y = value;
    else if (axis === 'Z') offset.z = value;
    else { return; }

    if (this.transformControls.space === 'local') {
      offset.applyQuaternion(this.startPivotQuaternion);
    }

    const worldPos = this.startPivotPosition.clone().add(offset);
    this.handle.position.copy(worldPos);

    this.transformControls.update();
    this.applyTransformSession();
  }

  applyNumericRotation(value) {
    const axis = this.transformControls.axis;
    if (!axis || !this.startPivotQuaternion || !this.handle) return;

    const angleRad = THREE.MathUtils.degToRad(value);

    let rotAxis = new THREE.Vector3();

    if (axis === 'XYZ') {
      this.camera.getWorldDirection(rotAxis);
      rotAxis.normalize();
    }
    else if (axis === 'X') rotAxis.set(1, 0, 0);
    else if (axis === 'Y') rotAxis.set(0, 1, 0);
    else if (axis === 'Z') rotAxis.set(0, 0, 1);
    else { return; }

    const deltaQuat = new THREE.Quaternion().setFromAxisAngle(rotAxis, angleRad);

    let resultQuat;

    if (this.transformControls.space === 'local' && axis !== 'XYZ') {
      resultQuat = this.startPivotQuaternion.clone().multiply(deltaQuat);
    } else {
      resultQuat = deltaQuat.clone().multiply(this.startPivotQuaternion);
    }

    this.handle.quaternion.copy(resultQuat);

    this.transformControls.update();
    this.applyTransformSession();
  }

  applyNumericScale(value) {
    const axis = this.transformControls.axis;
    if (!axis || !this.startPivotScale || !this.handle) return;

    const scaleFactor = new THREE.Vector3(1, 1, 1);

    if (axis === 'XYZ') scaleFactor.set(value, value, value);
    else if (axis === 'X') scaleFactor.x = value;
    else if (axis === 'Y') scaleFactor.y = value;
    else if (axis === 'Z') scaleFactor.z = value;
    else { return; }

    const pivotQuat = this.startPivotQuaternion;
    const invPivotQuat = pivotQuat.clone().invert();

    const objects = this.selection.getAffectedObjects();

    for (let i = 0; i < objects.length; i++) {
      const object = objects[i];

      let worldScaleFactor = scaleFactor.clone();
      if (this.transformControls.space === 'local') {
        worldScaleFactor.applyQuaternion(invPivotQuat);
        worldScaleFactor.applyQuaternion(pivotQuat);
      }

      const newWorldScale = this.startScales[i].clone().multiply(worldScaleFactor);
      TransformUtils.setWorldScale(object, newWorldScale);

      if (objects.length > 1) {
        let offset = this.startPositions[i].clone().sub(this.startPivotPosition);

        if (this.transformControls.space === 'local') {
          offset.applyQuaternion(invPivotQuat);
          offset.multiply(scaleFactor);
          offset.applyQuaternion(pivotQuat);
        } else {
          offset.multiply(scaleFactor);
        }

        const worldPos = this.startPivotPosition.clone().add(offset);
        TransformUtils.setWorldPosition(object, worldPos);
      }

      object.updateMatrixWorld(true);
    }

    const newPivotScale = this.startPivotScale.clone().multiply(scaleFactor);
    this.handle.scale.copy(newPivotScale);

    this.transformControls.update();
    this.applyTransformSession();
  }
}