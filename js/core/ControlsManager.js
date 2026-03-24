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
    this.signals.switchCameraView.add((view) => {
      this.toggleProjection(view);
    });

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

  toggleProjection(view) {
    const target = this.orbit.target.clone();

    let direction = this.orbit.camera.getWorldDirection(new THREE.Vector3());
    const distance = this.orbit.camera.position.distanceTo(target);

    if (view === 'ORTHOGRAPHIC') {
      const ortho = this.cameraManager.orthoViewportCamera;

      const fixedDistance = 10;
      ortho.position.copy(target).add(direction.clone().multiplyScalar(-fixedDistance));

      const eyeNorm = direction.clone().negate().normalize();
      ortho.up.copy(this.safeUp(eyeNorm));
      ortho.lookAt(target);

      const frustumSize = ortho.userData.frustumSize || 2;
      ortho.zoom = frustumSize / distance;
      ortho.updateProjectionMatrix();

      this.orbit.camera = ortho;
    } else if (view === 'PERSPECTIVE') {
      const persp = this.cameraManager.viewportCamera;

      const frustumSize = this.orbit.camera.userData.frustumSize || 2;
      const zoom = this.orbit.camera.zoom;
      const newDistance = frustumSize / zoom;

      direction = this.orbit.camera.getWorldDirection(new THREE.Vector3());
      persp.position.copy(target).add(direction.multiplyScalar(-newDistance));

      const eyeNorm = direction.clone().negate().normalize();
      persp.up.copy(this.safeUp(eyeNorm));
      persp.lookAt(target);

      this.orbit.camera = persp;
    }

    this.orbit.eye.subVectors(this.orbit.camera.position, target);

    this.signals.viewportCameraChanged.dispatch(this.orbit.camera);
  }

  safeUp(eyeDir) {
    const up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(up.dot(eyeDir)) > 0.99) {
      up.set(0, 0, eyeDir.y);
    }
    return up;
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

    const vertexIds = Array.from(editSelection.selectedVertexIds);
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