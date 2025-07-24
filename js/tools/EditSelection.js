import * as THREE from 'three';

export default class EditSelection {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.viewportControls = editor.viewportControls;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.selectedPoint = null;
    this.editedObject = null;
  }

  onMouseSelect(event, renderer, camera) {

    const rect = renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, camera);

    const position = this.editedObject.geometry.attributes.position;
    const objectMatrixWorld = this.editedObject.matrixWorld;
    
    const threshold = 0.2;
    const localRay = this.raycaster.ray.clone().applyMatrix4(
      new THREE.Matrix4().copy(objectMatrixWorld).invert()
    );

    let closestIndex = -1;
    let closestDistance = Infinity;
    
    for (let i = 0; i < position.count; i++) {
      const vertex = new THREE.Vector3().fromBufferAttribute(position, i);
      const distance = localRay.distanceToPoint(vertex);
      if (distance < threshold && distance < closestDistance) {
        closestDistance = distance;
        closestIndex = i;
      }
    }

    if (closestIndex === -1) {
      this.clearSelection();
    }

    this.selectedPoint = this.highlightSelectedVertex(closestIndex);
  }

  highlightSelectedVertex(index) {
    const basePosition = this.editedObject.geometry.attributes.position;

    if (index === -1 || index == null || index < 0 || index >= basePosition.count) {
      return;
    }

    this.clearSelection();
    const vertex = new THREE.Vector3().fromBufferAttribute(basePosition, index);
    const worldPosition = vertex.clone().applyMatrix4(this.editedObject.matrixWorld);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 4,
      sizeAttenuation: false,
      depthTest: true,
      depthWrite: false,
      transparent: true
    });

    const point = new THREE.Points(geometry, material);
    this.editedObject.worldToLocal(worldPosition);
    point.position.copy(worldPosition);
    point.userData.isEditorOnly = true;
    point.name = '__SelectedVertex';
    point.userData.vertexIndex = index;
    this.editedObject.add(point);

    return point;
  }

  clearSelection() {
    if (!this.editedObject) return;

    this.editedObject.traverse((child) => {
      if (child.name === '__SelectedVertex') {
        child.parent?.remove(child);
        child.geometry?.dispose();
        child.material?.dispose();
      }
    });

    this.selectedPoint = null;
  }
}