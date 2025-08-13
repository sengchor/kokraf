import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { SetPositionCommand } from "../commands/SetPositionCommand.js";
import { SetRotationCommand } from "../commands/SetRotationCommand.js";
import { SetScaleCommand } from '../commands/SetScaleCommand.js';
import { VertexEditor } from './VertexEditor.js';
import { SetVertexPositionCommand } from '../commands/SetVertexPositionCommand.js';

export class TransformTool {
  constructor(mode, editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.mode = mode; // 'translate', 'rotate', or 'scale'
    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.sceneEditorHelpers = editor.sceneManager.sceneEditorHelpers;
    this.controls = editor.controlsManager;
    this.interactionMode = 'object';
    this._worldPosHelper = new THREE.Vector3();
    this.editSelection = editor.editSelection;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode(this.mode);
    this.transformControls.visible = false;

    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
      if (this.controls.enabled) {
        this.signals.objectChanged.dispatch();
      }
    });
    this.transformControls.addEventListener('change', () => {
      if (this.transformControls.dragging) {
        this.signals.objectChanged.dispatch();
      }
    });

    this.sceneEditorHelpers.add(this.transformControls.getHelper());

    this.changeTransformControlsColor();

    this.setupListeners();
    this.setupTransformListeners();
  }

  setupListeners() {
    this.signals.modeChanged.add((newMode) => {
      this.interactionMode = newMode;
    });
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

      if (this.interactionMode === 'object') {
        this.objectPositionOnDown = object.position.clone();
        this.objectRotationOnDown = object.rotation.clone();
        this.objectScaleOnDown = object.scale.clone();
      } else if (this.interactionMode === 'edit') {
        this.objectPositionOnDown = object.getWorldPosition(this._worldPosHelper).clone();
      }
    });

    this.transformControls.addEventListener('change', () => {
      const handle = this.transformControls.object;
      if (!handle) return;

      if (this.interactionMode === 'edit' && this.transformControls.dragging) {
        const vertexIndex = handle.userData.vertexIndex;
        if (vertexIndex === undefined) return;

        const newWorldPos = handle.getWorldPosition(new THREE.Vector3());
        const localPos = newWorldPos.clone().applyMatrix4(
          new THREE.Matrix4().copy(this.editSelection.editedObject.matrixWorld).invert()
        );

        // Update buffer geometry via VertexEditor
        if (!this.vertexEditor) this.vertexEditor = new VertexEditor(this.editSelection.editedObject);
        this.vertexEditor.setVertexWorldPosition(vertexIndex, newWorldPos);

        // Update the logical Vertex in meshData
        const meshData = this.editSelection.editedObject.userData.meshData;
        if (meshData && meshData.vertices.has(vertexIndex)) {
          const vertex = meshData.vertices.get(vertexIndex);
          vertex.position = { x: localPos.x, y: localPos.y, z: localPos.z };
        }

        // Update point cloud of editedObject
        const pointCloud = this.editSelection.editedObject.getObjectByName('__VertexPoints');
        if (pointCloud) {
          const posAttr = pointCloud.geometry.getAttribute('position');
          posAttr.setXYZ(vertexIndex, localPos.x, localPos.y, localPos.z);
          posAttr.needsUpdate = true;
        }
      }
    });

    this.transformControls.addEventListener('mouseUp', () => {
      const object = this.transformControls.object;
      if (!object) return;

      if (this.interactionMode === 'object') {
        switch (this.mode) {
          case 'translate':
            if (!object.position.equals(this.objectPositionOnDown)) {
              this.editor.execute(new SetPositionCommand(this.editor, object, object.position, this.objectPositionOnDown));
              break;
            }
          case 'rotate':
            if (!object.rotation.equals(this.objectRotationOnDown)) {
              this.editor.execute(new SetRotationCommand(this.editor, object, object.rotation, this.objectRotationOnDown));
              break;
            }
          case 'scale':
            if (!object.scale.equals(this.objectScaleOnDown)) {
              this.editor.execute(new SetScaleCommand(this.editor, object, object.scale, this.objectScaleOnDown));
              break;
            }
        }
      } else if (this.interactionMode === 'edit') {
        switch (this.mode) {
          case 'translate':
            const index = object.userData.vertexIndex;
            const objectPosition = object.getWorldPosition(this._worldPosHelper).clone();
            if (!objectPosition.equals(this.objectPositionOnDown)) {
              this.editor.execute(new SetVertexPositionCommand(this.editor, this.editSelection.editedObject, index, objectPosition, this.objectPositionOnDown));
              break;
            }
        }
        this.vertexEditor = null;
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
