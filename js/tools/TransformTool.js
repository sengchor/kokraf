import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { SetPositionCommand } from "../commands/SetPositionCommand.js";
import { SetRotationCommand } from "../commands/SetRotationCommand.js";
import { SetScaleCommand } from '../commands/SetScaleCommand.js';
import { VertexEditor } from './VertexEditor.js';
import { SetVertexPositionCommand } from '../commands/SetVertexPositionCommand.js';
import { ShadingUtils } from '../utils/ShadingUtils.js';
import { MultiCommand } from '../commands/MultiCommand.js';

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
    this.selection = editor.selection;
    this.editSelection = editor.editSelection;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode(this.mode);
    this.transformControls.visible = false;

    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
      if (!event.value) this.signals.objectChanged.dispatch();
    });

    this.transformControls.addEventListener('mouseDown', () => {
      this.signals.transformDragStarted.dispatch();
    });

    this.transformControls.addEventListener('mouseUp', () => {
      requestAnimationFrame(() => {
        this.signals.transformDragEnded.dispatch();
      });
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
    this.transformControls.addEventListener('mouseDown', () => {
      const handle = this.transformControls.object;
      if (!handle) return;

      this.startPivotPosition = handle.getWorldPosition(new THREE.Vector3());
      this.startPivotQuaternion = handle.getWorldQuaternion(new THREE.Quaternion());
      this.startPivotScale = handle.getWorldScale(new THREE.Quaternion());

      if (this.interactionMode === 'object') {
        const objects = this.selection.selectedObjects;
        if (!objects || objects.length === 0) return;

        this.startPositions = objects.map(obj => obj.getWorldPosition(new THREE.Vector3()));
        this.startQuaternions = objects.map(obj => obj.getWorldQuaternion(new THREE.Quaternion()));
        this.startScales = objects.map(obj => obj.getWorldScale(new THREE.Vector3()));
      } else if (this.interactionMode === 'edit') {
        // Save old vertex positions
        const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
        const editedObject = this.editSelection.editedObject;
        if (editedObject) {
          const vertexEditor = new VertexEditor(this.editor, editedObject);
          this.oldPositions = vertexEditor.getVertexPositions(selectedVertexIds);
        }
      }
    });

    this.transformControls.addEventListener('change', () => {
      const handle = this.transformControls.object;
      if (!handle) return;

      if (this.interactionMode === 'object' && this.transformControls.dragging)  {
        const objects = this.selection.selectedObjects;

        if (this.mode === 'translate') {
          if (!this.startPivotPosition || !this.startPositions) return;

          const currentPivotPosition = handle.getWorldPosition(new THREE.Vector3());
          const offset = new THREE.Vector3().subVectors(currentPivotPosition, this.startPivotPosition);

          for (let i = 0; i < objects.length; i++) {
            objects[i].position.copy(this.startPositions[i]).add(offset);
            objects[i].updateMatrixWorld(true);
          }
        } else if (this.mode === 'rotate') {
          if (!this.startPivotQuaternion || !this.startQuaternions) return;

          const currentPivotQuaternion = handle.getWorldQuaternion(new THREE.Quaternion());
          const deltaQuat = new THREE.Quaternion().copy(currentPivotQuaternion).multiply(this.startPivotQuaternion.clone().invert());

          if (objects.length === 1) {
            // Single Object
            objects[0].quaternion.copy(deltaQuat).multiply(this.startQuaternions[0]);
            objects[0].updateMatrixWorld(true);
          } else {
            // Multiple Objects
            for (let i = 0; i < objects.length; i++) {
              const offset = this.startPositions[i].clone().sub(this.startPivotPosition);
              offset.applyQuaternion(deltaQuat);

              objects[i].position.copy(this.startPivotPosition).add(offset);
              objects[i].quaternion.copy(deltaQuat).multiply(this.startQuaternions[i]);

              objects[i].updateMatrixWorld(true);
            }
          }
        } else if (this.mode === 'scale') {
          if (!this.startPivotScale || !this.startScales) return;

          const currentPivotScale = handle.getWorldScale(new THREE.Vector3());
          const scaleFactor = new THREE.Vector3(
            currentPivotScale.x / this.startPivotScale.x,
            currentPivotScale.y / this.startPivotScale.y,
            currentPivotScale.z / this.startPivotScale.z
          );

          if (objects.length === 1) {
            this.applyWorldScaleToObject(objects[0], scaleFactor, this.startScales[0]);

            objects[0].updateMatrixWorld(true);
          } else {
            for (let i = 0; i < objects.length; i++) {
              const { newScaleX, newScaleY, newScaleZ } =
                this.applyWorldScaleToObject(objects[i], scaleFactor, this.startScales[i]);

              // Scale position offset relative to pivot
              const offset = this.startPositions[i].clone().sub(this.startPivotPosition);
              offset.multiply(new THREE.Vector3(newScaleX, newScaleY, newScaleZ));
              objects[i].position.copy(this.startPivotPosition).add(offset);

              objects[i].updateMatrixWorld(true);
            }
          }
        }
      }

      if (this.interactionMode === 'edit' && this.transformControls.dragging) {
        const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
        if (!selectedVertexIds || selectedVertexIds.length === 0) return;
        if (!this.startPivotPosition || !this.oldPositions) return;

        if (!this.vertexEditor) {
          this.vertexEditor = new VertexEditor(this.editor, this.editSelection.editedObject);
        }

        if (this.mode === 'translate') {
          const currentPivotPosition = handle.getWorldPosition(new THREE.Vector3());
          const offset = new THREE.Vector3().subVectors(currentPivotPosition, this.startPivotPosition);

          const newPositions = this.oldPositions.map(pos => pos.clone().add(offset));
          this.vertexEditor.setVerticesWorldPositions(selectedVertexIds, newPositions);
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

          this.vertexEditor.setVerticesWorldPositions(selectedVertexIds, newPositions);
        }

        if (this.mode === 'scale') {
          const pivot = this.startPivotPosition.clone();
          const currentScale = handle.getWorldScale(new THREE.Vector3());
          const scaleFactor = new THREE.Vector3(
            currentScale.x / this.startPivotScale.x,
            currentScale.y / this.startPivotScale.y,
            currentScale.z / this.startPivotScale.z
          );

          const newPositions = this.oldPositions.map(pos => {
            const local = pos.clone().sub(pivot);
            local.multiply(scaleFactor);
            return local.add(pivot);
          });

          this.vertexEditor.setVerticesWorldPositions(selectedVertexIds, newPositions);
        }
      }
    });

    this.transformControls.addEventListener('mouseUp', () => {
      const handle = this.transformControls.object;
      if (!handle) return;

      if (this.interactionMode === 'object') {
        const objects = this.selection.selectedObjects;

        if (this.mode === 'translate') {
          if (!this.startPositions) return;

          const newPositions = objects.map(obj => obj.getWorldPosition(new THREE.Vector3()));

          const currentPivotPosition = handle.getWorldPosition(new THREE.Vector3());
          if (!currentPivotPosition.equals(this.startPivotPosition)) {
            this.editor.execute(new SetPositionCommand(this.editor, objects, newPositions, this.startPositions));
          }

          this.startPositions = null;
          this.startPivotPosition = null;
        } else if (this.mode === 'rotate') {
          if (!this.startQuaternions) return;

          const newRotations = objects.map(obj => obj.rotation.clone());
          const startRotations = this.startQuaternions.map(q => new THREE.Euler().setFromQuaternion(q));

          const currentPivotQuaternion = handle.getWorldQuaternion(new THREE.Quaternion());
          if (currentPivotQuaternion.equals(this.startPivotQuaternion)) return;

          if (objects.length === 1) {
            // Single Object
            this.editor.execute(new SetRotationCommand(this.editor, objects, newRotations, startRotations));
          } else {
            // Multiple Objects
            const newPositions = objects.map(obj => obj.getWorldPosition(new THREE.Vector3()));
            const startPositions = this.startPositions.map(p => p.clone());

            const posCmd = new SetPositionCommand(this.editor, objects, newPositions, startPositions);
            const rotCmd = new SetRotationCommand(this.editor, objects, newRotations, startRotations);

            const multi = new MultiCommand(this.editor, 'Set Rotation Objects');
            multi.add(posCmd);
            multi.add(rotCmd);

            this.editor.execute(multi);
          }

          this.startPivotQuaternion = null;
          this.startPivotPosition = null;
          this.startQuaternions = null;
          this.startPositions = null;
        } else if (this.mode === 'scale') {
          if (!this.startScales) return;

          const newScales = objects.map(obj => obj.scale.clone());
          const startScales = this.startScales.map(s => s.clone());

          const currentPivotScale = handle.getWorldScale(new THREE.Vector3());
          if (currentPivotScale.equals(this.startPivotScale));

          if (objects.length === 1) {
            // Single Object
            this.editor.execute(new SetScaleCommand(this.editor, objects, newScales, startScales));
          } else {
            // Multiple Objects
            const newPositions = objects.map(obj => obj.getWorldPosition(new THREE.Vector3()));
            const startPositions = this.startPositions.map(p => p.clone());

            const posCmd = new SetPositionCommand(this.editor, objects, newPositions, startPositions);
            const scaleCmd = new SetScaleCommand(this.editor, objects, newScales, startScales);

            const multi = new MultiCommand(this.editor, 'Set Scale Objects');
            multi.add(posCmd);
            multi.add(scaleCmd);

            this.editor.execute(multi);
          }

          this.startPivotPosition = null;
          this.startPivotScale = null;
          this.startPositions = null;
          this.startScales = null;
        }
      } else if (this.interactionMode === 'edit') {
        const editedObject = this.editSelection.editedObject;
        const selectedVertexIds = Array.from(this.editSelection.selectedVertexIds);
        const selectedEdgeIds = Array.from(this.editSelection.selectedEdgeIds);
        const selectedFaceIds = Array.from(this.editSelection.selectedFaceIds);

        if (this.mode === 'translate') {
          if (editedObject.userData.shading === 'auto') {
            ShadingUtils.applyShading(editedObject, 'auto');
          }
          
          const currentPivotPosition = handle.getWorldPosition(new THREE.Vector3());
          const offset = new THREE.Vector3().subVectors(currentPivotPosition, this.startPivotPosition);

          if (offset.equals(new THREE.Vector3(0, 0, 0))) return;
          
          const newPositions = this.oldPositions.map(pos => pos.clone().add(offset));

          this.editor.execute(new SetVertexPositionCommand(this.editor, editedObject, selectedVertexIds, newPositions, this.oldPositions));

          if (this.editSelection.subSelectionMode === 'vertex') {
            this.editSelection.selectVertices(selectedVertexIds);
          } else if (this.editSelection.subSelectionMode === 'edge') {
            this.editSelection.selectEdges(selectedEdgeIds);
          } else if (this.editSelection.subSelectionMode === 'face') {
            this.editSelection.selectFaces(selectedFaceIds);
          }
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

          this.editor.execute(new SetVertexPositionCommand(this.editor, editedObject, selectedVertexIds, newPositions, this.oldPositions));

          if (this.editSelection.subSelectionMode === 'vertex') {
            this.editSelection.selectVertices(selectedVertexIds);
          } else if (this.editSelection.subSelectionMode === 'edge') {
            this.editSelection.selectEdges(selectedEdgeIds);
          } else if (this.editSelection.subSelectionMode === 'face') {
            this.editSelection.selectFaces(selectedFaceIds);
          }
        }
        else if (this.mode === 'scale') {
          const pivot = this.startPivotPosition.clone();
          const currentScale = handle.getWorldScale(new THREE.Vector3());
          const scaleFactor = new THREE.Vector3(
            currentScale.x / this.startPivotScale.x,
            currentScale.y / this.startPivotScale.y,
            currentScale.z / this.startPivotScale.z
          );

          if (scaleFactor.equals(new THREE.Vector3(1, 1, 1))) return;

          const newPositions = this.oldPositions.map(pos => {
            const local = pos.clone().sub(pivot);
            local.multiply(scaleFactor);
            return local.add(pivot);
          });

          this.editor.execute(new SetVertexPositionCommand(this.editor, editedObject, selectedVertexIds, newPositions, this.oldPositions));

          if (this.editSelection.subSelectionMode === 'vertex') {
            this.editSelection.selectVertices(selectedVertexIds);
          } else if (this.editSelection.subSelectionMode === 'edge') {
            this.editSelection.selectEdges(selectedEdgeIds);
          } else if (this.editSelection.subSelectionMode === 'face') {
            this.editSelection.selectFaces(selectedFaceIds);
          }
        }

        if (editedObject.userData.shading === 'auto') {
          ShadingUtils.applyShading(editedObject, 'auto');
        }

        this.vertexEditor = null;
        this.oldPositions = null;
      }
    });
  }

  applyWorldScaleToObject(object, scaleFactor, startScale) {
    // Local axes in world space
    const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(object.quaternion);
    const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(object.quaternion);
    const localZ = new THREE.Vector3(0, 0, 1).applyQuaternion(object.quaternion);

    // Compute local scales from world space scale
    const newScaleX = Math.sqrt(
      Math.pow(scaleFactor.x * localX.x, 2) +
      Math.pow(scaleFactor.y * localX.y, 2) +
      Math.pow(scaleFactor.z * localX.z, 2)
    );

    const newScaleY = Math.sqrt(
      Math.pow(scaleFactor.x * localY.x, 2) +
      Math.pow(scaleFactor.y * localY.y, 2) +
      Math.pow(scaleFactor.z * localY.z, 2)
    );

    const newScaleZ = Math.sqrt(
      Math.pow(scaleFactor.x * localZ.x, 2) +
      Math.pow(scaleFactor.y * localZ.y, 2) +
      Math.pow(scaleFactor.z * localZ.z, 2)
    );

    // Apply final scale
    object.scale.set(
      startScale.x * newScaleX,
      startScale.y * newScaleY,
      startScale.z * newScaleZ
    );

    return { newScaleX, newScaleY, newScaleZ };
  }

  enableFor(object) {
    if (!object) return;
    this.transformControls.attach(object);
    this.transformControls.visible = true;

    // Keep scale gizmo aligned to world axes
    if (this.transformControls.mode === 'scale') {
      this.selection.pivotHandle.rotation.set(0, 0, 0);
      this.editSelection.vertexHandle.rotation.set(0, 0, 0);
    }
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
