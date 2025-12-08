import { QuaternionOrbitControls } from '../controls/QuaternionOrbitControls.js';

export default class ControlsManager {
  constructor(editor) {
    this.cameraManager = editor.cameraManager;
    this.renderer = editor.renderer;
    this.instance = new QuaternionOrbitControls(this.cameraManager.camera, this.renderer.domElement);
  }

  enable() {
    this.instance.enabled = true;
  }

  disable() {
    this.instance.enabled = false;
  }

  focus(objects) {
    this.instance._focus(objects);
  }
}