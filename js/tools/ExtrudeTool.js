import * as THREE from 'three';
import { TransformControls } from 'jsm/controls/TransformControls.js';
import { VertexEditor } from './VertexEditor.js';

export class ExtrudeTool {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.camera = editor.cameraManager.camera;
    this.renderer = editor.renderer;
    this.sceneEditorHelpers = editor.sceneManager.sceneEditorHelpers;
    this.controls = editor.controlsManager;
    this._worldPosHelper = new THREE.Vector3();
    this.editSelection = editor.editSelection;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode('translate');
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
    this.transformControls.addEventListener('mouseDown', () => {
      const object = this.transformControls.object;
      if (!object) return;
      this.objectPositionOnDown = object.getWorldPosition(this._worldPosHelper).clone();

      // Save old vertex positions
      const indices = object.userData.vertexIndices || [];
      const editedObject = this.editSelection.editedObject;
      if (editedObject) {
        const vertexEditor = new VertexEditor(this.editor, editedObject);
        this.oldPositions = vertexEditor.getVertexPositions(indices);
      }
    });

    this.transformControls.addEventListener('mouseUp', () => {
      const object = this.transformControls.object;
      const selectedVertexIds = object.userData.vertexIndices;
      const editedObject = this.editSelection.editedObject;

      const vertexEditor = new VertexEditor(this.editor, editedObject);
      const { newVertexIds, newEdgeIds, newFaceIds} = vertexEditor.duplicateSelection(selectedVertexIds);
      this.duplicatedVertices = vertexEditor.getVertexPositions(newVertexIds);

      const currentPosition = object.getWorldPosition(this._worldPosHelper).clone();
      const offset = new THREE.Vector3().subVectors(currentPosition, this.objectPositionOnDown);
      
      if (!offset.equals(new THREE.Vector3(0, 0, 0))) {
        const newPositions = this.duplicatedVertices.map(pos => pos.clone().add(offset));
        vertexEditor.setVerticesWorldPositions(newVertexIds, newPositions);
      }

      // Select the new duplicated vertices
      this.editSelection.selectVertices(newVertexIds);

      vertexEditor.deleteSelection(selectedVertexIds);
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
}