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

    if (mode === 'translate' && !Number.isNaN(value)) {
      this.applyNumericTranslation(value);
    } else {
      this.applyNumericTranslation(0);
    }

    this.signals.onToolUpdated.dispatch(this.getEditTransformDisplayText(mode));
  }

  applyNumericTranslation(value) {
    const axis = this.tool.transformControls.axis;
    if (!axis) return;

    const offset = new THREE.Vector3();
    
    if (axis.includes('XYZ')) offset.set(value, value, value);
    if (axis.includes('X')) offset.x = value;
    if (axis.includes('Y')) offset.y = value;
    if (axis.includes('Z')) offset.z = value;

    if (this.tool.transformControls.space === 'local') {
      offset.applyQuaternion(this.tool.startPivotQuaternion);
    }

    const worldPos = this.tool.startPivotPosition.clone().add(offset);
    this.tool.handle.position.copy(worldPos);
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
    return `Dx: ${delta.z.toFixed(3)} Dy: ${delta.x.toFixed(3)}  Dz: ${delta.y.toFixed(3)}  (${distance.toFixed(3)} m)  ${space}`;
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