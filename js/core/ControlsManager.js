import { QuaternionOrbitControls } from '../controls/QuaternionOrbitControls.js';

export default class ControlsManager {
  constructor({ camera, domElement }) {
    this.instance = new QuaternionOrbitControls(camera, domElement);
  }

  enable() {
    this.instance.enabled = true;
  }

  disable() {
    this.instance.enabled = false;
  }
}