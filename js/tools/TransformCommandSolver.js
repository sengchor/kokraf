import * as THREE from 'three';

export class TransformCommandSolver {
  constructor(camera, renderer, transformControls) {
    this.camera = camera;
    this.renderer = renderer;
    this.transformControls = transformControls;

    this.event = null;
    this.commandAxisConstraint = null;
    this.customAxisConstraint = null;

    this.startPivotPosition = new THREE.Vector3();
    this.startPivotQuaternion = new THREE.Quaternion();
    this.startPivotScale = new THREE.Vector3();

    this.startTranslateVector = null;
    this.startRotateVector = null;
    this.startScaleVector = null;
  }

  get handle() {
    return this.transformControls.object;
  }

  beginSession(position, quaternion, scale) {
    this.startPivotPosition = position.clone();
    this.startPivotQuaternion = quaternion.clone();
    this.startPivotScale = scale.clone();

    this.startTranslateVector = null;
    this.startRotateVector = null;
    this.startScaleVector = null;
  }

  clear() {
    this.commandAxisConstraint = null;
    this.customAxisConstraint = null;

    this.startPivotPosition = null;
    this.startPivotQuaternion = null;
    this.startPivotScale = null;

    this.startTranslateVector = null;
    this.startRotateVector = null;
    this.startScaleVector = null;
  }

  setAxisConstraintFromKey(key) {
    const axis = this.getThreeAxisName(key);
    if (!axis) return;

    this.commandAxisConstraint = axis.toUpperCase();
    this.transformControls.axis = this.commandAxisConstraint;

    // Reset start vectors so the next transform begins clean
    this.startTranslateVector = null;
    this.startRotateVector = null;
    this.startScaleVector = null;
  }

  setCustomAxisConstraint(axis) {
    if (!axis || axis.lengthSq() === 0) {
      this.customAxisConstraint = null;
      return;
    }

    this.customAxisConstraint = axis.clone().normalize();

    // Reset session deltas
    this.startTranslateVector = null;
    this.startRotateVector = null;
    this.startScaleVector = null;
  }

  // Update handle
  updateHandleFromCommandInput(mode, event) {
    if (!this.startPivotPosition) return;

    this.event = event;
    switch (mode) {
      case 'translate':
        this.updateHandleTranslation();
        break;
      case 'rotate':
        this.updateHandleRotation();
        break;
      case 'scale':
        this.updateHandleScale();
        break;
    }

    this.setGizmoActiveVisualState();
  }

  updateHandleTranslation() {
    if (!this.startPivotPosition) return;

    const raycaster = this.getMouseRaycaster();

    const newPosition = new THREE.Vector3(); 

    if (this.commandAxisConstraint) {
      const axis = this.getAxisVector(this.commandAxisConstraint).clone();

      if (this.transformControls.space === 'local') {
        axis.applyQuaternion(this.startPivotQuaternion);
      }
      axis.normalize();

      newPosition.copy(this.closestPointOnLineToRay(this.startPivotPosition, axis, raycaster.ray));
    } else if (this.customAxisConstraint) {
      const axis = this.customAxisConstraint.clone();
      
      newPosition.copy(this.closestPointOnLineToRay(this.startPivotPosition, axis, raycaster.ray));
    } else {
      // Free plane movement
      const axis = this.camera.getWorldDirection(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, this.startPivotPosition);
      if (!raycaster.ray.intersectPlane(plane, newPosition)) return;
    }

    if (!this.startTranslateVector) {
      this.startTranslateVector = newPosition.clone();
    }

    const delta = newPosition.clone().sub(this.startTranslateVector);

    this.handle.position.copy(this.startPivotPosition).add(delta);
    this.handle.updateMatrixWorld(true);
  }

  updateHandleRotation() {
    if (!this.startPivotPosition || !this.startPivotQuaternion) return;

    const raycaster = this.getMouseRaycaster();

    // Determine rotation axis
    const axis = new THREE.Vector3();
    if (this.commandAxisConstraint) {
      axis.copy(this.getAxisVector(this.commandAxisConstraint));
      if (this.transformControls.space === 'local') axis.applyQuaternion(this.startPivotQuaternion);
    } else if (this.customAxisConstraint) {
      axis.copy(this.customAxisConstraint);
    } else {
      axis.copy(this.camera.getWorldDirection(new THREE.Vector3()));
    }
    axis.normalize();

    // Project mouse ray onto plane perpendicular to rotation axis
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, this.startPivotPosition);
    const hitPoint = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hitPoint)) return;

    const newVector = hitPoint.clone().sub(this.startPivotPosition).projectOnPlane(axis).normalize();
    if (!newVector) return;

    if (!this.startRotateVector) {
      this.startRotateVector = newVector.clone();
    }

    const cross = this.startRotateVector.clone().cross(newVector);
    const angle = Math.atan2(axis.dot(cross), this.startRotateVector.dot(newVector));
    const deltaQuat = new THREE.Quaternion().setFromAxisAngle(axis, angle);

    this.handle.quaternion.copy(deltaQuat).multiply(this.startPivotQuaternion);
    this.handle.updateMatrixWorld(true);
  }

  updateHandleScale() {
    if (!this.startPivotPosition || !this.startPivotScale) return;

    const raycaster = this.getMouseRaycaster();
    if (!raycaster) return;

    const newPosition = new THREE.Vector3();
    if (this.commandAxisConstraint) {
      const axis = this.getAxisVector(this.commandAxisConstraint).clone();

      if (this.transformControls.space === 'local') {
        axis.applyQuaternion(this.startPivotQuaternion);
      }
      axis.normalize();

      newPosition.copy(this.closestPointOnLineToRay(this.startPivotPosition, axis, raycaster.ray));
    } else if (this.customAxisConstraint) {
      const axis = this.customAxisConstraint.clone();
      
      newPosition.copy(this.closestPointOnLineToRay(this.startPivotPosition, axis, raycaster.ray));
    } else {
      // Free plane movement
      const axis = this.camera.getWorldDirection(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, this.startPivotPosition);
      if (!raycaster.ray.intersectPlane(plane, newPosition)) return;
    }

    const rawVector = newPosition.clone().sub(this.startPivotPosition);
    if (!rawVector) return;

    // Initialize reference once
    if (!this.startScaleVector) {
      this.startScaleVector = rawVector.clone();
    }

    const scaleFactor = rawVector.length() / this.startScaleVector.length();

    let scaleVector;
    if (this.commandAxisConstraint) {
      scaleVector = new THREE.Vector3(1, 1, 1);
      if (this.commandAxisConstraint === 'X') scaleVector.x = scaleFactor;
      if (this.commandAxisConstraint === 'Y') scaleVector.y = scaleFactor;
      if (this.commandAxisConstraint === 'Z') scaleVector.z = scaleFactor;
    } else {
      scaleVector = new THREE.Vector3(scaleFactor, scaleFactor, scaleFactor);
    }

    this.handle.scale.copy(this.startPivotScale).multiply(scaleVector);
    this.handle.updateMatrixWorld(true);
  }

  // Utils
  closestPointOnLineToRay(linePoint, lineDir, ray) {
    const p = linePoint.clone();
    const d = lineDir.clone();
    const o = ray.origin.clone();
    const r = ray.direction.clone();

    const w0 = p.clone().sub(o);
    const a = d.dot(d);
    const b = d.dot(r);
    const c = r.dot(r);
    const d0 = d.dot(w0);
    const e = r.dot(w0);

    const denom = a*c - b*b;
    const t = denom !== 0 ? (b*e - c*d0) / denom : 0;

    return p.clone().add(d.clone().multiplyScalar(t));
  }

  getMouseRaycaster() {
    if (!this.event) return null;

    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((this.event.clientX - rect.left) / rect.width) * 2 - 1,
      -((this.event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    return raycaster;
  }

  getAxisVector(axis) {
    switch (axis) {
      case 'X': return new THREE.Vector3(1, 0, 0);
      case 'Y': return new THREE.Vector3(0, 1, 0);
      case 'Z': return new THREE.Vector3(0, 0, 1);
    }
  }

  getThreeAxisName(editorAxis) {
    switch (editorAxis) {
      case 'x': return 'z';
      case 'y': return 'x';
      case 'z': return 'y';
    }
  }

  // Gizmo visual state
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

  setGizmoActiveVisualState() {
    this.transformControls.dragging = true;
    if (this.customAxisConstraint) {
      this.transformControls.axis = this.commandAxisConstraint ?? 'Y';
    } else {
      this.transformControls.axis = this.commandAxisConstraint ?? 'XYZ';
    }
  }

  clearGizmoActiveVisualState() {
    this.transformControls.dragging = false;
    this.transformControls.axis = null;
  }
}