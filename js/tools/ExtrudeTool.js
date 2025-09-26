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

    this.setupTransformListeners();
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
      const selectedFaceIds = this.editSelection.getSelectedFacesFromVertices(selectedVertexIds);

      const vertexEditor = new VertexEditor(this.editor, editedObject);
      const newVertexIds = vertexEditor.duplicateFace(selectedFaceIds[0]);
      this.duplicatedVertices = vertexEditor.getVertexPositions(newVertexIds);

      const currentPosition = object.getWorldPosition(this._worldPosHelper).clone();
      const offset = new THREE.Vector3().subVectors(currentPosition, this.objectPositionOnDown);
      
      if (!offset.equals(new THREE.Vector3(0, 0, 0))) {
        const newPositions = this.duplicatedVertices.map(pos => pos.clone().add(offset));
        vertexEditor.setVerticesWorldPositions(newVertexIds, newPositions);
      }

      // Select the new duplicated vertices
      this.editSelection.selectVertices(newVertexIds);
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