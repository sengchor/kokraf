import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { SetPositionCommand } from "../commands/SetPositionCommand.js";
import { SetRotationCommand } from "../commands/SetRotationCommand.js";
import { SetScaleCommand } from '../commands/SetScaleCommand.js';

export class TransformTool {
  constructor(mode, editor) {
    this.editor = editor;
    this.mode = mode; // 'translate', 'rotate', or 'scale'
    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.sceneEditorHelpers = editor.sceneManager.sceneEditorHelpers;
    this.controls = editor.controlsManager;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode(this.mode);
    this.transformControls.visible = false;

    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
    });

    this.sceneEditorHelpers.add(this.transformControls.getHelper());

    this.changeTransformControlsColor();

    this.setupTransformListeners();
  }

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

  setupTransformListeners() {
    this.objectPositionOnDown = null;
    this.objectRotationOnDown = null;
    this.objectScaleOnDown = null;

    this.transformControls.addEventListener('mouseDown', () => {
      const object = this.transformControls.object;
      if (!object) return;

      this.objectPositionOnDown = object.position.clone();
      this.objectRotationOnDown = object.rotation.clone();
      this.objectScaleOnDown = object.scale.clone();
    });

    this.transformControls.addEventListener('mouseUp', () => {
      const object = this.transformControls.object;
      if (!object) return;

      switch (this.mode) {
        case 'translate':
          if (!object.position.equals(this.objectPositionOnDown)) {
            this.editor.execute(new SetPositionCommand(this.editor, object, null, object.position, this.objectPositionOnDown));
            break;
          }
        case 'rotate':
          if (!object.rotation.equals(this.objectRotationOnDown)) {
            this.editor.execute(new SetRotationCommand(this.editor, object, null, object.rotation, this.objectRotationOnDown));
            break;
          }
        case 'scale':
          if (!object.scale.equals(this.objectScaleOnDown)) {
            this.editor.execute(new SetScaleCommand(this.editor, object, null, object.scale, this.objectScaleOnDown));
            break;
          }
      }
    });
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
