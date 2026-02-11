import { QuaternionOrbitControls } from '../controls/QuaternionOrbitControls.js';

export default class ControlsManager {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.cameraManager = editor.cameraManager;
    this.renderer = editor.renderer;
    this.orbit = new QuaternionOrbitControls(this.editor, this.cameraManager.viewportCamera, this.renderer.domElement);

    this.setupListeners();
  }

  setupListeners() {
    this.signals.emptyScene.add(() => {
      this.orbit.reset();
    });
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

  toJSON() {
    return {
      orbit: this.orbit.toJSON()
    };
  }

  fromJSON(json) {
    if (json?.orbit) {
      this.orbit.fromJSON(json.orbit);
    }
  }
}