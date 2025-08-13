import * as THREE from 'three';

export default class EditSelection {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.viewportControls = editor.viewportControls;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.editedObject = null;

    this.vertexHandle = new THREE.Object3D();
    this.vertexHandle.name = '__VertexHandle';
    this.vertexHandle.visible = false;
    this.editor.sceneManager.sceneEditorHelpers.add(this.vertexHandle);
  }

  onMouseSelect(event, renderer, camera) {
    const rect = renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, camera);

    // Intersect only with point cloud, not full mesh
    const vertexPoints = this.editedObject.getObjectByName('__VertexPoints');
    if (!vertexPoints) return;

    this.raycaster.params.Points.threshold = 0.1;

    const intersects = this.raycaster.intersectObject(vertexPoints);
    if (intersects.length === 0) {
      this.clearSelection();
      return;
    }

    const intersect = intersects[0];
    const pointIndex = intersect.index;

    const vertexIdAttr = vertexPoints.geometry.getAttribute('vertexId');
    const logicalVertexId = vertexIdAttr.getX(pointIndex);

    this.highlightSelectedVertex(logicalVertexId);

    this.moveVertexHandle(vertexPoints, pointIndex, logicalVertexId);
  }

  highlightSelectedVertex(vertexId) {
    const vertexPoints = this.editedObject.getObjectByName('__VertexPoints');
    if (!vertexPoints) return;

    const colors = vertexPoints.geometry.getAttribute('color');
    const ids = vertexPoints.geometry.getAttribute('vertexId');

    for (let i = 0; i < colors.count; i++) {
      colors.setXYZ(i, 0, 0, 0);
    }

    for (let i = 0; i < ids.count; i++) {
      if (ids.getX(i) === vertexId) {
        colors.setXYZ(i, 1, 1, 1);
        break;
      }
    }

    colors.needsUpdate = true;
  }

  clearSelection() {
    const vertexPoints = this.editedObject.getObjectByName('__VertexPoints');
    if (!vertexPoints) return;

    const colors = vertexPoints.geometry.attributes.color;
    const count = colors.count;

    for (let i = 0; i < count; i++) {
      colors.setXYZ(i, 0, 0, 0);
    }

    colors.needsUpdate = true;
    this.selectedVertexId = null;
    this.vertexHandle.visible = false;
  }

  moveVertexHandle(vertexPoints, pointIndex, logicalVertexId) {
    if (!this.vertexHandle) return;

    const posAttr = vertexPoints.geometry.getAttribute('position');
    const localPos = new THREE.Vector3(
      posAttr.getX(pointIndex),
      posAttr.getY(pointIndex),
      posAttr.getZ(pointIndex)
    );

    const worldPos = localPos.clone().applyMatrix4(vertexPoints.matrixWorld);

    this.vertexHandle.position.copy(worldPos);
    this.vertexHandle.userData.vertexIndex = logicalVertexId;
    this.vertexHandle.visible = true;
  }
}