import * as THREE from 'three';

export default class Selection {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.keyHandler = editor.keyHandler;
    this.selectionBoxes = new Map();
    this.sceneManager = editor.sceneManager;

    this.multiSelectEnabled = false;
    this.selectedObjects = [];
    this.helpers = editor.helpers;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.enable = false;
    this.renderer = editor.renderer;
    this.camera = editor.cameraManager.camera;
    this.selectionBox = editor.selectionBox;

    this.pivotHandle = new THREE.Object3D();
    this.pivotHandle.name = '__PivotHandle';
    this.pivotHandle.visible = false;
    this.sceneManager.sceneEditorHelpers.add(this.pivotHandle);

    this.setupListeners();
  }

  setupListeners() {
    this.signals.emptyScene.add(() => {
      this.deselect();
    });

    this.signals.multiSelectChanged.add((shiftChanged) => {
      this.multiSelectEnabled = shiftChanged;
    });

    this.signals.transformDragStarted.add((mode) => {
      if (mode !== 'object') return;
      this.enable = false;
    });

    this.signals.transformDragEnded.add((mode) => {
      if (mode !== 'object') return;
      this.enable = true;
    });

    const dom = this.renderer.domElement;
    dom.addEventListener("mousedown", this.onMouseDown.bind(this));
    dom.addEventListener("mousemove", this.onMouseMove.bind(this));
    dom.addEventListener("mouseup", this.onMouseUp.bind(this));
  }

  onMouseDown(event) {
    if (!this.enable || event.button !== 0) return;
    if (!this.keyHandler.startInteraction('select')) return;

    this.dragging = false;
    this.mouseDownPos = { x: event.clientX, y: event.clientY };
  }

  onMouseMove(event) {
    if (!this.enable || !this.mouseDownPos) return;
    if (this.keyHandler.activeInteraction !== 'select') return;
    
    const dx = event.clientX - this.mouseDownPos.x;
    const dy = event.clientY - this.mouseDownPos.y;
    const dragThreshold = 1;

    if (!this.dragging && Math.hypot(dx, dy) > dragThreshold) {
      this.dragging = true;
      this.selectionBox.startSelection(event.clientX, event.clientY);
    }

    if (this.dragging) {
      this.selectionBox.updateSelection(event.clientX, event.clientY);
    }
  }

  onMouseUp(event) {
    if (!this.enable || event.button !== 0) return;
    this.keyHandler.endInteraction('select');

    this.selectionBox.finishSelection();

    if (this.dragging) {  
      const objects = this.getBoxSelectedObjects();
      if (objects === null || objects.length === 0) {
        this.deselect();
        return;
      }

      this.select(objects, true);
    } else {
      const object = this.getSingleSelectedObject(event);
      if (object === null) {
        this.deselect();
        return;
      }

      this.select(object);
    }

    this.dragging = false;
    this.mouseDownPos = null;
  }

  getSingleSelectedObject(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const objects = this.getPickableObjects();
    const intersects = this.raycaster.intersectObjects(objects, false);
    if (intersects.length === 0) return null;

    const object = intersects[0].object;
    const target = object.userData.object || object;

    return target;
  }

  getBoxSelectedObjects() {
    const frustum = this.selectionBox.computeFrustumFromSelection();
    if (!frustum) return null;

    const objects = this.getPickableObjects();
    const objectHits = this.selectionBox.getObjectsInFrustum(objects, frustum);
    if (!objectHits || objectHits.length === 0) return null;

    const selectedObjects = objectHits.map(h => h.object);
    return selectedObjects;
  }

  getPickableObjects() {
    const objects = [];

    this.sceneManager.mainScene.traverseVisible(child => {
      if (!child.visible) return;
      objects.push(child);
    });

    this.sceneManager.sceneHelpers.traverseVisible(child => {
      if (child.name === 'picker') {
        objects.push(child);
      }
    });

    return objects;
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
    this.updatePivotHandle();
    this.dragging = false;
    this.mouseDownPos = null;
    
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

  select(objects, isBoxSelection = false) {
    const isArray = Array.isArray(objects);
    if (!isArray) objects = [objects];

    objects = objects.filter(o => o);

    if (this.multiSelectEnabled) {

      if (isBoxSelection) {
        // Box selection: add only
        for (const obj of objects) {
          if (!this.selectedObjects.includes(obj)) {
            this.selectedObjects.push(obj);
            this.highlightObject(obj);
          }
        }
      } else {
        // Click selection: toggle
        for (const obj of objects) {
          const i = this.selectedObjects.indexOf(obj);

          if (i !== -1) {
            this.selectedObjects.splice(i, 1);
            this.unhighlightObject(obj);
          } else {
            this.selectedObjects.push(obj);
            this.highlightObject(obj);
          }
        }
      }

      // If everything got toggled off
      if (this.selectedObjects.length === 0) {
        this.deselect();
        return;
      }

      this.updatePivotHandle();
      this.signals.objectSelected.dispatch(this.selectedObjects);
      return;
    }

    // Click selection (no shift)
    this.clearHighlight();
    this.selectedObjects = [...objects];
    for (const obj of this.selectedObjects) {
      this.highlightObject(obj);
    }

    this.updatePivotHandle();
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

  updatePivotHandle() {
    if (!this.pivotHandle || this.selectedObjects.length === 0) {
      this.pivotHandle.visible = false;
      return;
    }
    const rootObjects = this.getRootSelectedObjects();

    const sum = new THREE.Vector3();
    const worldPos = new THREE.Vector3();

    for (const obj of rootObjects) {
      obj.getWorldPosition(worldPos);
      sum.add(worldPos);
    }

    sum.divideScalar(rootObjects.length);
    this.pivotHandle.position.copy(sum);
    this.pivotHandle.visible = true;
  }

  getRootSelectedObjects() {
    const objects = this.selectedObjects;
    const set = new Set(objects);

    return objects.filter(obj => {
      let p = obj.parent;
      while (p) {
        if (set.has(p)) return false;
        p = p.parent;
      }
      return true;
    });
  }

  getAffectedObjects() {
    const objects = this.selectedObjects;
    const set = new Set();

    for (const obj of objects) {
      obj.traverse(o => {
        set.add(o);
      });
    }

    return set;
  }
}