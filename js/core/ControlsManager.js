import * as THREE from 'three';
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
    this.signals.emptyScene.add(() => this.orbit.reset());

    this.signals.originFocused.add(() => this.focusOrigin());

    this.signals.objectFocused.add(() => this.focusObjects());

    this.signals.vertexFocused.add(() => this.focusVertices());
  }

  enable() {
    this.orbit.enabled = true;
  }

  disable() {
    this.orbit.enabled = false;
  }

  focusObjects() {
    const objects = this.editor.selection.selectedObjects;
    if (!objects || objects.length === 0) return;
    this.orbit._focusObjects(objects);
  }

  focusVertices() {
    const editSelection = this.editor.editSelection;
    if (!editSelection) return;

    const editedObject = editSelection.editedObject;
    if (!editedObject) return;

    const vertexIds = editSelection.getSelectedVertexIds();
    if (!vertexIds || vertexIds.length === 0) return;

    const meshData = editedObject.userData.meshData;
    if (!meshData) return;

    const worldPos = new THREE.Vector3();
    const center = new THREE.Vector3();

    // Compute center
    vertexIds.forEach(id => {
      const v = meshData.getVertex(id);
      if (!v) return;

      worldPos.copy(v.position).applyMatrix4(editedObject.matrixWorld);
      center.add(worldPos);
    });

    center.divideScalar(vertexIds.length);

    // Compute radius
    let maxDistSq = 0;

    vertexIds.forEach(id => {
      const v = meshData.getVertex(id);
      if (!v) return;

      worldPos.copy(v.position).applyMatrix4(editedObject.matrixWorld);
      maxDistSq = Math.max(
        maxDistSq,
        center.distanceToSquared(worldPos)
      );
    });

    const radius = Math.sqrt(maxDistSq);

    const distance = Math.max(radius * 4, 0.2);

    this.orbit._focusPoint(center, distance);
  }

  focusOrigin() {
    this.orbit._focusOrigin();
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