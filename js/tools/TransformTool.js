import { TransformControls } from 'jsm/controls/TransformControls.js';

export class TransformTool {
  constructor(mode, camera, renderer, scene, controls) {
    this.mode = mode; // 'translate', 'rotate', or 'scale'
    this.camera = camera;
    this.renderer = renderer;
    this.scene = scene;
    this.controls = controls;

    this.transformControls = new TransformControls(camera, renderer.domElement);
    this.transformControls.setMode(mode);
    this.transformControls.visible = false;

    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
    });

    this.scene.add(this.transformControls.getHelper());
  }

  enableFor(object) {
    if (!object) return;

    this.transformControls.attach(object);
    this.transformControls.visible = true;
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

  get modeName() {
    return this.mode;
  }
}
