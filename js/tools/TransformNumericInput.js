import * as THREE from 'three';

export class TransformNumericInput {
  constructor(tool) {
    this.tool = tool;
    this.signals = tool.signals;
    this.reset();
  }

  handleKey(event, mode) {
    const key = event.key;

    if (/[0-9.]/.test(key)) {
      if (!this.active) this.begin();
      this.insertChar(key);
      this.applyNumericTransform(mode);
      return true;
    }

    if (key === '-') {
      this.sign *= -1;
      this.applyNumericTransform(mode);
      return true;
    }

    if (key === 'Backspace') {
      this.deleteChar();
      this.applyNumericTransform(mode);
      return true;
    }

    if (key === 'ArrowLeft') {
      this.moveCursorLeft();
      this.applyNumericTransform(mode);
      return true;
    }

    if (key === 'ArrowRight') {
      this.moveCursorRight();
      this.applyNumericTransform(mode);
      return true;
    }

    return false;
  }

  reset() {
    this.active = false;
    this.buffer = '';
    this.sign = 1;
    this.cursor = 0;
  }

  begin() {
    this.buffer = '';
    this.cursor = 0;
    this.active = true;
  }

  insertChar(char) {
    this.buffer = this.buffer.slice(0, this.cursor) +
      char + this.buffer.slice(this.cursor);
    this.cursor += char.length;
  }

  deleteChar() {
    if (this.cursor === 0) return;

    this.buffer = this.buffer.slice(0, this.cursor - 1) +
      this.buffer.slice(this.cursor);

    this.cursor--;
  }

  moveCursorLeft() {
    this.cursor = Math.max(0, this.cursor - 1);
  }

  moveCursorRight() {
    this.cursor = Math.min(this.buffer.length, this.cursor + 1);
  }

  getDisplayBufferWithCaret() {
    return ( this.buffer.slice(0, this.cursor) + '|' +
    this.buffer.slice(this.cursor));
  }

  applyNumericTransform(mode) {
    const value = parseFloat(this.buffer) * this.sign;

    if (mode === 'translate') {
      if (!Number.isNaN(value)) {
        this.applyNumericTranslation(value);
      } else {
        this.applyNumericTranslation(0);
      }
    }

    if (mode === 'rotate') {
      if (!Number.isNaN(value)) {
        this.applyNumericRotation(value);
      } else {
        this.applyNumericRotation(0);
      }
    }

    if (mode === 'scale') {
      if (!Number.isNaN(value)) {
        this.applyNumericScale(value);
      } else {
        this.applyNumericScale(0);
      }
    }

    this.signals.onToolUpdated.dispatch(this.getEditTransformDisplayText(mode));
  }

  applyNumericTranslation(value) {
    const axis = this.tool.transformControls.axis;
    if (!axis) return;

    const offset = new THREE.Vector3();
    
    if (axis.includes('XYZ')) offset.set(value, value, value);
    else if (axis.includes('X')) offset.x = value;
    else if (axis.includes('Y')) offset.y = value;
    else if (axis.includes('Z')) offset.z = value;
    else { return; }

    if (this.tool.transformControls.space === 'local') {
      offset.applyQuaternion(this.tool.startPivotQuaternion);
    }

    const worldPos = this.tool.startPivotPosition.clone().add(offset);
    this.tool.handle.position.copy(worldPos);
    this.tool.transformControls.update();

    this.tool.applyTransformSession();
  }

  applyNumericRotation(value) {
    const axis = this.tool.transformControls.axis;
    if (!axis) return;

    const angleRad = THREE.MathUtils.degToRad(value);

    let rotAxis = new THREE.Vector3();

    if (axis === 'XYZ') {
      this.tool.camera.getWorldDirection(rotAxis);
      rotAxis.normalize();
    }
    else if (axis === 'X') rotAxis.set(1, 0, 0);
    else if (axis === 'Y') rotAxis.set(0, 1, 0);
    else if (axis === 'Z') rotAxis.set(0, 0, 1);
    else { return; }

    const deltaQuat = new THREE.Quaternion().setFromAxisAngle(rotAxis, angleRad);

    let resultQuat;

    if (this.tool.transformControls.space === 'local' && axis !== 'XYZ') {
      resultQuat = this.tool.startPivotQuaternion.clone().multiply(deltaQuat);
    } else {
      resultQuat = deltaQuat.clone().multiply(this.tool.startPivotQuaternion);
    }

    this.tool.handle.quaternion.copy(resultQuat);
    this.tool.transformControls.update();

    this.tool.applyTransformSession();
  }

  applyNumericScale(value) {
    const axis = this.tool.transformControls.axis;
    if (!axis) return;

    const scaleFactor = new THREE.Vector3(1, 1, 1);

    if (axis.includes('XYZ')) scaleFactor.set(value, value, value);
    else if (axis.includes('X')) scaleFactor.x = value;
    else if (axis.includes('Y')) scaleFactor.y = value;
    else if (axis.includes('Z')) scaleFactor.z = value;
    else { return; }

    const pivotQuat = this.tool.startPivotQuaternion;
    const invPivotQuat = pivotQuat.clone().invert();

    const objects = this.tool.selection.getAffectedObjects();

    for (let i = 0; i < objects.length; i++) {
      const object = objects[i];

      // Compute world scale factor
      let worldScaleFactor = scaleFactor.clone();
      if (this.tool.transformControls.space === 'local') {
        // Rotate scale factor into local axes
        worldScaleFactor.applyQuaternion(invPivotQuat);
        worldScaleFactor.applyQuaternion(pivotQuat);
      }

      const newWorldScale = this.tool.startScales[i].clone().multiply(worldScaleFactor);
      TransformUtils.setWorldScale(object, newWorldScale);

      // Adjust object position relative to pivot if multi-object
      if (objects.length > 1) {
        let offset = this.tool.startPositions[i].clone().sub(this.tool.startPivotPosition);

        if (this.tool.transformControls.space === 'local') {
          offset.applyQuaternion(invPivotQuat);
          offset.multiply(scaleFactor);
          offset.applyQuaternion(pivotQuat);
        } else {
          offset.multiply(scaleFactor);
        }

        const worldPos = this.tool.startPivotPosition.clone().add(offset);
        TransformUtils.setWorldPosition(object, worldPos);
      }

      object.updateMatrixWorld(true);
    }

    // Apply scale to handle itself
    const newPivotScale = this.tool.startPivotScale.clone().multiply(scaleFactor);
    this.tool.handle.scale.copy(newPivotScale);
    this.tool.transformControls.update();

    this.tool.applyTransformSession();
  }

  getTransformDisplayText(mode) {
    if (!this.tool.handle) return '';

    if (mode === 'translate') {
      return this.getTranslationDisplayText();
    } else if (mode === 'rotate') {
      return this.getRotationDisplayText();
    } else if (mode === 'scale') {
      return this.getScaleDisplayText();
    }
  }

  getEditTransformDisplayText(mode) {
    if (!this.tool.handle) return '';

    if (mode === 'translate') {
      return this.getEditTranslationDisplayText();
    } else if (mode === 'rotate') {
      return this.getEditRotationDisplayText();
    } else if (mode === 'scale') {
      return this.getEditScaleDisplayText();
    }
  }

  getTranslationDisplayText() {
    const data = this.getTranslationData();
    if (!data) return '';

    const { delta, distance, space, axis } = data;

    if (axis === 'X') {
      return `Dy: ${delta.x.toFixed(3)}  (${distance.toFixed(3)} m)  ${space}`;
    }
    if (axis === 'Y') {
      return `Dz: ${delta.y.toFixed(3)}  (${distance.toFixed(3)} m)  ${space}`;
    }
    if (axis === 'Z') {
      return `Dx: ${delta.z.toFixed(3)}  (${distance.toFixed(3)} m)  ${space}`;
    }
    if (axis === 'XY') {
      return `Dy: ${delta.x.toFixed(3)}  Dz: ${delta.y.toFixed(3)}  (${distance.toFixed(3)} m)  ${space}`;
    }
    if (axis === 'XZ') {
      return `Dx: ${delta.z.toFixed(3)}  Dy: ${delta.x.toFixed(3)}  (${distance.toFixed(3)} m)  ${space}`;
    }
    if (axis === 'YZ') {
      return `Dx: ${delta.z.toFixed(3)}  Dz: ${delta.y.toFixed(3)}  (${distance.toFixed(3)} m)  ${space}`;
    }
    return `Dx: ${delta.z.toFixed(3)}  Dy: ${delta.x.toFixed(3)}  Dz: ${delta.y.toFixed(3)}  (${distance.toFixed(3)} m)  ${space}`;
  }

  getEditTranslationDisplayText() {
    const data = this.getTranslationData();
    if (!data) return '';

    const { delta, distance, space, axis } = data;

    const raw = this.getDisplayBufferWithCaret();
    const displayValue = this.sign === 1 ? raw : `-(${raw})`;

    if (axis === 'X') return `Dy: [${displayValue}] = ${delta.x.toFixed(3)}  (${distance.toFixed(3)} m)  ${space}`;
    if (axis === 'Y') return `Dz: [${displayValue}] = ${delta.y.toFixed(3)}  (${distance.toFixed(3)} m)  ${space}`;
    if (axis === 'Z') return `Dx: [${displayValue}] = ${delta.z.toFixed(3)}  (${distance.toFixed(3)} m)  ${space}`;
    if (axis === 'XY') return `Dy: [${displayValue}] = ${delta.x.toFixed(3)}  Dz: [${displayValue}] = ${delta.y.toFixed(3)}  (${distance.toFixed(3)} m)  ${space}`;
    if (axis === 'XZ') return `Dx: [${displayValue}] = ${delta.z.toFixed(3)}  Dy: [${displayValue}] = ${delta.x.toFixed(3)}  (${distance.toFixed(3)} m)  ${space}`;
    if (axis === 'YZ') return `Dx: [${displayValue}] = ${delta.z.toFixed(3)}  Dz: [${displayValue}] = ${delta.y.toFixed(3)}  (${distance.toFixed(3)} m)  ${space}`;

    return `Dx: [${displayValue}] = ${delta.z.toFixed(3)}  Dy: [${displayValue}] = ${delta.x.toFixed(3)}  Dz: [${displayValue}] = ${delta.y.toFixed(3)}  (${distance.toFixed(3)} m)  ${space}`;
  }

  getRotationDisplayText() {
    const data = this.getRotationData();
    if (!data) return '';

    const { angleDeg, space, axis } = data;

    if (axis === 'X') {
      return `Ry: ${angleDeg.toFixed(2)}°  ${space}`;
    }
    if (axis === 'Y') {
      return `Rz: ${angleDeg.toFixed(2)}°  ${space}`;
    }
    if (axis === 'Z') {
      return `Rx: ${angleDeg.toFixed(2)}°  ${space}`;
    }
    if (axis === 'XY') {
      return `Ryz: ${angleDeg.toFixed(2)}°  ${space}`;
    }
    if (axis === 'XZ') {
      return `Rxy: ${angleDeg.toFixed(2)}°  ${space}`;
    }
    if (axis === 'YZ') {
      return `Rxz: ${angleDeg.toFixed(2)}°  ${space}`;
    }
    return `R: ${angleDeg.toFixed(2)}°  ${space}`;
  }

  getEditRotationDisplayText() {
    const data = this.getRotationData();
    if (!data) return '';

    const { angleDeg, space, axis } = data;

    const raw = this.getDisplayBufferWithCaret();
    const displayValue = this.sign === 1 ? raw : `-(${raw})`;

    if (axis === 'X') {
      return `Ry: [${displayValue}] = ${angleDeg.toFixed(2)}°  ${space}`;
    }
    if (axis === 'Y') {
      return `Rz: [${displayValue}] = ${angleDeg.toFixed(2)}°  ${space}`;
    }
    if (axis === 'Z') {
      return `Rx: [${displayValue}] = ${angleDeg.toFixed(2)}°  ${space}`;
    }
    if (axis === 'XY') {
      return `Ryz: [${displayValue}] = ${angleDeg.toFixed(2)}°  ${space}`;
    }
    if (axis === 'XZ') {
      return `Rxy: [${displayValue}] = ${angleDeg.toFixed(2)}°  ${space}`;
    }
    if (axis === 'YZ') {
      return `Rxz: [${displayValue}] = ${angleDeg.toFixed(2)}°  ${space}`;
    }

    return `R: [${displayValue}] = ${angleDeg.toFixed(2)}°  ${space}`;
  }

  getScaleDisplayText() {
    const data = this.getScaleData();
    if (!data) return '';

    const { scaleDelta, uniform, space, axis } = data;

    if (axis === 'X') {
      return `Sy: ${scaleDelta.x.toFixed(3)}  ${space}`;
    }
    if (axis === 'Y') {
      return `Sz: ${scaleDelta.y.toFixed(3)}  ${space}`;
    }
    if (axis === 'Z') {
      return `Sx: ${scaleDelta.z.toFixed(3)}  ${space}`;
    }
    if (axis === 'XY') {
      return `Sy: ${scaleDelta.x.toFixed(3)}  Sz: ${scaleDelta.y.toFixed(3)}  ${space}`;
    }
    if (axis === 'XZ') {
      return `Sx: ${scaleDelta.z.toFixed(3)}  Sy: ${scaleDelta.x.toFixed(3)}  ${space}`;
    }
    if (axis === 'YZ') {
      return `Sx: ${scaleDelta.z.toFixed(3)}  Sz: ${scaleDelta.y.toFixed(3)}  ${space}`;
    }
    return `S: ${uniform.toFixed(3)}  ${space}`;
  }

  getEditScaleDisplayText() {
    const data = this.getScaleData();
    if (!data) return '';

    const { scaleDelta, uniform, space, axis } = data;

    const raw = this.getDisplayBufferWithCaret();
    const displayValue = this.sign === 1 ? raw : `-(${raw})`;

    if (axis === 'X') {
      return `Sy: [${displayValue}] = ${scaleDelta.x.toFixed(3)}  ${space}`;
    }
    if (axis === 'Y') {
      return `Sz: [${displayValue}] = ${scaleDelta.y.toFixed(3)}  ${space}`;
    }
    if (axis === 'Z') {
      return `Sx: [${displayValue}] = ${scaleDelta.z.toFixed(3)}  ${space}`;
    }
    if (axis === 'XY') {
      return `Sy: [${displayValue}] = ${scaleDelta.x.toFixed(3)}  Sz: [${displayValue}] = ${scaleDelta.y.toFixed(3)}  ${space}`;
    }
    if (axis === 'XZ') {
      return `Sx: [${displayValue}] = ${scaleDelta.z.toFixed(3)}  Sy: [${displayValue}] = ${scaleDelta.x.toFixed(3)}  ${space}`;
    }
    if (axis === 'YZ') {
      return `Sx: [${displayValue}] = ${scaleDelta.z.toFixed(3)}  Sz: [${displayValue}] = ${scaleDelta.y.toFixed(3)}  ${space}`;
    }
    return `S: [${displayValue}] = ${uniform.toFixed(3)}  ${space}`;
  }

  getTranslationData() {
    if (!this.tool.startPivotPosition || !this.tool.handle) return null;

    const currentPivotPosition = this.tool.handle.getWorldPosition(new THREE.Vector3());
    const deltaWorld = currentPivotPosition.clone().sub(this.tool.startPivotPosition);

    const delta = deltaWorld.clone();
    if (this.tool.transformControls.space === 'local') {
      const invQuat = this.tool.startPivotQuaternion.clone().invert();
      delta.applyQuaternion(invQuat);
    }

    const distance = delta.length();
    const space = this.tool.viewportControls.transformOrientation;
    const axis = this.tool.transformControls.axis;

    return { delta, distance, space, axis };
  }

  getRotationData() {
    if (!this.tool.startPivotQuaternion || !this.tool.handle) return null;

    const currentQuat = this.tool.handle.getWorldQuaternion(new THREE.Quaternion());
    const deltaQuat = currentQuat.clone().multiply(this.tool.startPivotQuaternion.clone().invert());

    let angle = 2 * Math.acos(THREE.MathUtils.clamp(deltaQuat.w, -1, 1));
    if (angle < 1e-6) angle = 0;

    const angleDeg = THREE.MathUtils.radToDeg(angle);
    const space = this.tool.viewportControls.transformOrientation;
    const axis = this.tool.transformControls.axis;

    return { angleDeg, space, axis };
  }

  getScaleData() {
    if (!this.tool.startPivotScale || !this.tool.handle) return null;

    const currentScale = this.tool.handle.getWorldScale(new THREE.Vector3());
    const scaleDelta = currentScale.clone().divide(this.tool.startPivotScale);

    const space = this.tool.viewportControls.transformOrientation;
    const axis = this.tool.transformControls.axis;

    const uniform = Math.cbrt(scaleDelta.x * scaleDelta.y * scaleDelta.z);

    return { scaleDelta, uniform, space, axis };
  }
}