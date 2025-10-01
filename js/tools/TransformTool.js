import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { SetPositionCommand } from "../commands/SetPositionCommand.js";
import { SetRotationCommand } from "../commands/SetRotationCommand.js";
import { SetScaleCommand } from '../commands/SetScaleCommand.js';
import { VertexEditor } from './VertexEditor.js';
import { SetVertexPositionCommand } from '../commands/SetVertexPositionCommand.js';
import { ShadingUtils } from '../utils/ShadingUtils.js';

export class TransformTool {
  constructor(mode, editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.mode = mode; // 'translate', 'rotate', or 'scale'
    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.sceneManager = editor.sceneManager;
    this.sceneEditorHelpers = this.sceneManager.sceneEditorHelpers;
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

        // Save old vertex positions
        const indices = object.userData.vertexIndices || [];
        const editedObject = this.editSelection.editedObject;
        if (editedObject) {
          const vertexEditor = new VertexEditor(this.editor, editedObject);
          this.oldPositions = vertexEditor.getVertexPositions(indices);
        }
      }
    });

    this.transformControls.addEventListener('change', () => {
      const handle = this.transformControls.object;
      if (!handle) return;

      if (this.interactionMode === 'edit' && this.transformControls.dragging) {
        const indices = handle.userData.vertexIndices;
        if (!indices || indices.length === 0) return;
        if (!this.objectPositionOnDown || !this.oldPositions) return;

        const currentPosition = handle.getWorldPosition(new THREE.Vector3());
        const offset = new THREE.Vector3().subVectors(currentPosition, this.objectPositionOnDown);
        
        if (!this.vertexEditor) {
          this.vertexEditor = new VertexEditor(this.editor, this.editSelection.editedObject);
        }

        const newPositions = this.oldPositions.map(pos => pos.clone().add(offset));
        this.vertexEditor.setVerticesWorldPositions(indices, newPositions);
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
            const indices = object.userData.vertexIndices;
            const editedObject = this.editSelection.editedObject;
            if (editedObject.userData.shading === 'auto') {
              ShadingUtils.applyShading(editedObject, 'auto');
            }
            
            const currentPosition = object.getWorldPosition(this._worldPosHelper).clone();
            const offset = new THREE.Vector3().subVectors(currentPosition, this.objectPositionOnDown);
            
            if (!offset.equals(new THREE.Vector3(0, 0, 0))) {
              const newPositions = this.oldPositions.map(pos => pos.clone().add(offset));

              this.editor.execute(new SetVertexPositionCommand(this.editor, editedObject, indices, newPositions, this.oldPositions));
              this.editSelection.selectVertices(indices);
            }
            break;
        }
        this.vertexEditor = null;
        this.oldPositions = null;
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
