import * as THREE from 'three';

export default class Selection {
  constructor(sceneManager) {
    this.box = new THREE.Box3();
    this.selectionBox = new THREE.Box3Helper(this.box, 0xffa500);
    this.selectionBox.material.depthTest = false;
    this.selectionBox.material.transparent = true;
    this.selectionBox.visible = false;

    this.sceneManager = sceneManager;
    this.sceneManager.sceneHelpers.add(this.selectionBox);

    this.selectedObject = null;
    this.lastHighlighted = null;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
  }

  onMouseSelect(event, renderer, camera, scene) {
    const rect = renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, camera);
    const intersects = this.getIntersects(this.raycaster);

    if (intersects.length > 0) {
      const object = intersects[0].object;

      if ( object.userData.object !== undefined ) {
        // helper
        this.select(object.userData.object);
        this.selectionBox.visible = false;
      } else {
        this.select(object);
      }
    } else {
      this.deselect();
    }
  }

  getIntersects(raycaster) {
    const objects = [];

    this.sceneManager.mainScene.traverseVisible( child => {
      objects.push(child);
    });

    this.sceneManager.sceneHelpers.traverseVisible( child => {
      if (child.name === 'picker') objects.push(child);
    });

    return raycaster.intersectObjects(objects, false);
  }

  update() {
    if (!this.selectedObject) return;
    this.box.setFromObject(this.selectedObject);

    const helper = this.selectedObject.userData.helper;

    if (helper) {
      helper.update();

      if (this.lastHighlighted === helper) {
        helper.traverse(child => {
          if (child.material && child.material.color) {
            child.material.color.set(0xffa500);
          }
        });
      }
    }
  }

  getSelectedObject() {
    return this.selectedObject;
  }

  deselect() {
    this.clearHighlight();
    this.selectedObject = null;
    this.selectionBox.visible = false;
  }

  clearHighlight() {
    if (this.lastHighlighted) {
      this.lastHighlighted.traverse(obj => {
        if (obj.material && obj.material.color) {
          obj.material.color.set(0xffffff);
        }
      });
      this.lastHighlighted = null;
    }
  }

  select(object) {
    this.clearHighlight();

    this.selectedObject = object;

    this.box.setFromObject(object);
    this.selectionBox.visible = true;
    this.selectionBox.updateMatrixWorld(true);

    const helper = object.userData.helper;
    if (helper) {
      helper.update();

      helper.traverse(child => {
        if (child.material && child.material.color) {
          child.material.color.set(0xffa500);
        }
      });

      this.lastHighlighted = helper;
    } else {
      this.lastHighlighted = null;
    }
  }
}