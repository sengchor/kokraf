import * as THREE from 'three';

export default class Selection {
  constructor(scene) {
    this.box = new THREE.Box3();
    this.selectionBox = new THREE.Box3Helper(this.box, 0xffa500);
    this.selectionBox.material.depthTest = false;
    this.selectionBox.material.transparent = true;
    this.selectionBox.visible = false;

    scene.add(this.selectionBox);

    this.selectedObject = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
  }

  select(event, renderer, camera, scene) {
    const rect = renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, camera);
    const intersects = this.raycaster.intersectObjects(scene.children, true);

    const validHit = intersects.find(i => !i.object.userData.unselectable);

    if (validHit) {
      this.selectedObject = validHit.object;
      this.update();
      this.selectionBox.visible = true;
      this.selectionBox.updateMatrixWorld(true);
    } else {
      this.selectedObject = null;
      this.selectionBox.visible = false;
    }
  }

  update() {
    if (this.selectedObject) {
      this.box.setFromObject(this.selectedObject);
    }
  }

  getSelectedObject() {
    return this.selectedObject;
  }

  deselect() {
    this.selectedObject = null;
    this.selectionBox.visible = false;
  }
}