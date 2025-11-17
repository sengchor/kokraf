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
    this.startObjectPosition = null;
    this.startObjectRotation = null;
    this.startObjectScale = null;

    this.startPivotPosition = null;
    this.startPivotQuaternion = null;

    this.transformControls.addEventListener('mouseDown', () => {
      const handle = this.transformControls.object;
      if (!handle) return;

      if (this.interactionMode === 'object') {
        this.startObjectPosition = handle.position.clone();
        this.startObjectRotation = handle.rotation.clone();
        this.startObjectScale = handle.scale.clone();
      } else if (this.interactionMode === 'edit') {
        this.startPivotPosition = handle.getWorldPosition(new THREE.Vector3());
        this.startPivotQuaternion = handle.getWorldQuaternion(new THREE.Quaternion());

        // Save old vertex positions
        const indices = handle.userData.vertexIndices || [];
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
        if (!this.startPivotPosition || !this.oldPositions) return;

        if (!this.vertexEditor) {
          this.vertexEditor = new VertexEditor(this.editor, this.editSelection.editedObject);
        }

        if (this.mode === 'translate') {
          const currentPivotPosition = handle.getWorldPosition(new THREE.Vector3());
          const offset = new THREE.Vector3().subVectors(currentPivotPosition, this.startPivotPosition);

          const newPositions = this.oldPositions.map(pos => pos.clone().add(offset));
          this.vertexEditor.setVerticesWorldPositions(indices, newPositions);
        }

        if (this.mode === 'rotate') {
          const pivot = this.startPivotPosition.clone();
          const currentPivotQuaternion = handle.getWorldQuaternion(new THREE.Quaternion());
          const deltaQuat = currentPivotQuaternion.clone().multiply(this.startPivotQuaternion.clone().invert());

          const newPositions = this.oldPositions.map(pos => {
            const local = pos.clone().sub(pivot);
            local.applyQuaternion(deltaQuat);
            return local.add(pivot);
          });

          this.vertexEditor.setVerticesWorldPositions(indices, newPositions);
        }
      }
    });

    this.transformControls.addEventListener('mouseUp', () => {
      const handle = this.transformControls.object;
      if (!handle) return;

      if (this.interactionMode === 'object') {
        if (this.mode === 'translate') {
          if (!handle.position.equals(this.startObjectPosition)) {
            this.editor.execute(new SetPositionCommand(this.editor, handle, handle.position, this.startObjectPosition));
          }
        }
        else if (this.mode === 'rotate') {
          if (!handle.rotation.equals(this.startObjectRotation)) {
            this.editor.execute(new SetRotationCommand(this.editor, handle, handle.rotation, this.startObjectRotation));
          }
        }
        else if (this.mode === 'scale') {
          if (!handle.scale.equals(this.startObjectScale)) {
            this.editor.execute(new SetScaleCommand(this.editor, handle, handle.scale, this.startObjectScale));
          }
        }
      } else if (this.interactionMode === 'edit') {
        const editedObject = this.editSelection.editedObject;
        const indices = handle.userData.vertexIndices;

        if (this.mode === 'translate') {
          if (editedObject.userData.shading === 'auto') {
            ShadingUtils.applyShading(editedObject, 'auto');
          }
          
          const currentPivotPosition = handle.getWorldPosition(new THREE.Vector3());
          const offset = new THREE.Vector3().subVectors(currentPivotPosition, this.startPivotPosition);

          if (offset.equals(new THREE.Vector3(0, 0, 0))) return;
          
          const newPositions = this.oldPositions.map(pos => pos.clone().add(offset));

          this.editor.execute(new SetVertexPositionCommand(this.editor, editedObject, indices, newPositions, this.oldPositions));
          this.editSelection.selectVertices(indices);
        }
        else if (this.mode === 'rotate') {
          const currentPivotQuaternion = handle.getWorldQuaternion(new THREE.Quaternion());
          const deltaQuat = currentPivotQuaternion.clone().multiply(this.startPivotQuaternion.clone().invert());
          const pivot = this.startPivotPosition.clone();

          if (currentPivotQuaternion.equals(this.startPivotQuaternion)) return;

          const newPositions = this.oldPositions.map(pos => {
            const local = pos.clone().sub(pivot);
            local.applyQuaternion(deltaQuat);
            return local.add(pivot);
          });

          this.editor.execute(new SetVertexPositionCommand(this.editor, editedObject, indices, newPositions, this.oldPositions));
          this.editSelection.selectVertices(indices);
        }

        if (editedObject.userData.shading === 'auto') {
          ShadingUtils.applyShading(editedObject, 'auto');
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
