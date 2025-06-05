import { QuaternionOrbitControls } from '../controls/QuaternionOrbitControls.js';

export default class ControlsManager {
  constructor(editor) {
    this.camera = editor.cameraManager.camera;
    this.domElement = editor.renderer.domElement;
    this.instance = new QuaternionOrbitControls(this.camera, this.domElement);
  }

  enable() {
    this.instance.enabled = true;
  }

  disable() {
    this.instance.enabled = false;
  }
}