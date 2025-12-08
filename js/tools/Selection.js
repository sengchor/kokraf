import * as THREE from 'three';

export default class Selection {
  constructor(editor) {
    this.signals = editor.signals;
    this.selectionBoxes = new Map();
    this.sceneManager = editor.sceneManager;

    this.multiSelectEnabled = false;
    this.selectedObjects = [];
    this.helpers = editor.helpers;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.enable = true;

    this.setupListeners();
  }

  setupListeners() {
    this.signals.emptyScene.add(() => {
      this.deselect();
    });

    this.signals.multiSelectChanged.add((shiftChanged) => {
      this.multiSelectEnabled = shiftChanged;
    });
  }

  onMouseSelect(event, renderer, camera) {
    if (!this.enable) return;
    const rect = renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, camera);
    const intersects = this.getIntersects(this.raycaster);

    if (intersects.length > 0) {
      const object = intersects[0].object;
      const target = object.userData.object || object;
      this.select(target);
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
    if (this.selectedObjects.length === 0) return;

    // Update each selected object
    for (const object of this.selectedObjects) {
      const helper = this.helpers[object.id];
      
      if (helper) {
        helper.update();

        // Highlight helper
        helper.traverse(child => {
          if (child.material?.color) {
            child.material.color.set(0xffa500);
          }
        });
      } else {
        // Normal mesh selection: update box helper
        let boxHelper = this.selectionBoxes.get(object.id);
        if (!boxHelper) {
          const box = new THREE.Box3();
          boxHelper = new THREE.Box3Helper(box, 0xffa500);
          boxHelper.material.depthTest = false;
          boxHelper.material.transparent = true;
          this.sceneManager.sceneEditorHelpers.add(boxHelper);
          this.selectionBoxes.set(object.id, boxHelper);
        }

        boxHelper.box.setFromObject(object);
        boxHelper.visible = true;
        boxHelper.updateMatrixWorld(true);
      }
    }

    // Hide any box helpers that are no longer selected
    for (const [id, boxHelper] of this.selectionBoxes) {
      if (!this.selectedObjects.find(obj => obj.id === id)) {
        boxHelper.visible = false;
      }
    }
  }

  getSelectedObject() {
    return this.selectedObjects;
  }

  deselect() {
    this.clearHighlight();
    this.selectedObjects = [];
    
    this.signals.objectSelected.dispatch([]);
  }

  clearHighlight() {
    for (const object of this.selectedObjects) {
      const helper = this.helpers[object.id];
      if (helper) {
        helper.traverse(child => {
          if (child.material && child.material.color) {
            child.material.color.set(object.userData.originalColor || 0xffffff);
          }
        });
      }

      const boxHelper = this.selectionBoxes.get(object.id);
      if (boxHelper) {
        boxHelper.visible = false;
      }
    }
  }

  select(object) {
    if (this.multiSelectEnabled) {
      // If already selected, toggle off
      const index = this.selectedObjects.indexOf(object);
      if (index !==  -1) {
        this.selectedObjects.splice(index, 1);
        this.unhighlightObject(object);

        if (this.selectedObjects.length === 0) {
          this.deselect();
        } else {
          this.signals.objectSelected.dispatch(this.selectedObjects);
        }
        return;
      }

      // Add new object
      this.selectedObjects.push(object);
      this.highlightObject(object);
      this.signals.objectSelected.dispatch(this.selectedObjects);
      return;
    }

    // Single select
    this.clearHighlight();
    this.selectedObjects = [object];
    this.highlightObject(object);
    this.signals.objectSelected.dispatch(this.selectedObjects);
  }

  highlightObject(object) {
    const helper = this.helpers[object.id];

    if (helper) {
      helper.update();
      helper.traverse(child => {
        if (child.material?.color) {
          child.material.color.set(0xffa500);
        }
      });
    } else {
      if (!this.selectionBoxes.has(object.id)) {
        const box = new THREE.Box3();
        const boxHelper = new THREE.Box3Helper(box, 0xffa500);
        boxHelper.material.depthTest = false;
        boxHelper.material.transparent = true;
        this.sceneManager.sceneEditorHelpers.add(boxHelper);
        this.selectionBoxes.set(object.id, boxHelper);
      }

      const boxHelper = this.selectionBoxes.get(object.id);
      boxHelper.box.setFromObject(object);
      boxHelper.visible = true;
      boxHelper.updateMatrixWorld(true);
    }
  }

  unhighlightObject(object) {
    const helper = this.helpers[object.id];
    if (helper) {
      helper.traverse(child => {
        if (child.material?.color) {
          child.material.color.set(0xffffff);
        }
      });
    }

    if (this.selectionBoxes.has(object.id)) {
      const boxHelper = this.selectionBoxes.get(object.id);
      boxHelper.visible = false;
    }
  }
}