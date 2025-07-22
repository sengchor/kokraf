import * as THREE from 'three';

export default class EditSelection {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.viewportControls = editor.viewportControls;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.selectedPoint = null;
  }

  onMouseSelect(event, renderer, camera) {
    this.viewportControls = this.editor.viewportControls;

    const rect = renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, camera);
    const mesh = this.viewportControls.editedObject;

    const position = mesh.geometry.attributes.position;
    const objectMatrixWorld = mesh.matrixWorld;
    
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
    const mesh = this.viewportControls.editedObject;
    const basePosition = mesh.geometry.attributes.position;

    if (index === -1 || index == null || index < 0 || index >= basePosition.count) {
      return;
    }

    this.clearSelection();
    const vertex = new THREE.Vector3().fromBufferAttribute(basePosition, index);
    const worldPosition = vertex.clone().applyMatrix4(mesh.matrixWorld);

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
    mesh.worldToLocal(worldPosition);
    point.position.copy(worldPosition);
    point.name = '__SelectedVertex';
    point.userData.vertexIndex = index;
    mesh.add(point);

    return point;
  }

  addVertexPoints(selectedObject) {
    const pointMaterial = new THREE.PointsMaterial({
      color: 0x000000,
      size: 3.5,
      sizeAttenuation: false
    });

    const pointCloud = new THREE.Points(selectedObject.geometry, pointMaterial);
    pointCloud.name = '__VertexPoints';
    selectedObject.add(pointCloud);
  }

  clearSelection() {
    const mesh = this.viewportControls.editedObject;
    if (!mesh) return;

    const existing = mesh.getObjectByName('__SelectedVertex');
    if (existing) {
      mesh.remove(existing);
      if (existing.geometry) existing.geometry.dispose();
      if (existing.material) existing.material.dispose();
    }

    this.selectedPoint = null;
  }
}