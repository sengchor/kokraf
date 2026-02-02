import { QuaternionOrbitControls } from '../controls/QuaternionOrbitControls.js';

export default class ControlsManager {
  constructor(editor) {
    this.editor = editor;
    this.cameraManager = editor.cameraManager;
    this.renderer = editor.renderer;
    this.orbit = new QuaternionOrbitControls(this.editor, this.cameraManager.camera, this.renderer.domElement);
  }

  enable() {
    this.orbit.enabled = true;
  }

  disable() {
    this.orbit.enabled = false;
  }

  focus(objects) {
    this.orbit._focus(objects);
  }
}