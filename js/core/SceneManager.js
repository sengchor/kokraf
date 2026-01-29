import * as THREE from 'three';
import { GridHelper } from '../helpers/GridHelper.js';
import { Storage } from './Storage.js';
import { MeshData } from './MeshData.js';

export default class SceneManager {
  constructor(editor) {
    this.signals = editor.signals;
    this.cameraManager = editor.cameraManager;
    this.helpers = editor.helpers;
    this.objectFactory = editor.objectFactory;
    this.gridHelper = new GridHelper();
    this.history = editor.history;

    this.mainScene = new THREE.Scene();
    this.mainScene.background = new THREE.Color(0x3b3b3b);

    this.sceneEditorHelpers = new THREE.Scene();
    this.sceneEditorHelpers.background = null;

    this.sceneHelpers = new THREE.Scene();
    this.sceneHelpers.background = null;

    this.shadingMode = 'material';
    this.xrayMode = false;

    this.setupListeners();
  }
  
  emptyScene(scene) {
    while (scene.children.length > 0) {
      const obj = scene.children[0];
      this.removeObject(obj);

      if (obj.geometry) {
        obj.geometry.dispose?.();
      }

      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(mat => mat.dispose?.());
        } else {
          obj.material.dispose?.();
        }
      }

      if (obj.texture) {
        obj.texture.dispose?.();
      }
    }
  }

  async emptyAllScenes() {
    this.cameraManager.resetCamera();
    this.signals.emptyScene.dispatch();

    this.emptyScene(this.mainScene);
    this.emptyScene(this.sceneHelpers);
    await Storage.remove('scene');
    this.history.clear();
  }

  setScene(scene) {
    scene.traverse(obj => {
      MeshData.rehydrateMeshData(obj);
    });

    this.mainScene.uuid = scene.uuid;
    this.mainScene.name = scene.name;

    this.removeEditorOnlyObjects(scene);

    while (scene.children.length > 0) {
      this.addObject(scene.children[0]);
    }
  }

  addAmbientLight(color = 0xffffff, intensity = 0.5) {
    const light = new THREE.AmbientLight(color, intensity);
    this.mainScene.add(light);
  }

  addDemoObjects() {
    const cube = this.objectFactory.createGeometry('Cube');
    this.mainScene.add(cube);
  }
  
  addObject(object, parent, index) {
    if (!object) return;

    if (object.userData.meshData && !(object.userData.meshData instanceof MeshData)) {
      MeshData.rehydrateMeshData(object);
    }

    if (parent === undefined) {
      this.mainScene.add(object);
    } else {
      parent.children.splice(index, 0, object);
      object.parent = parent;
    }

    object.traverse((child) => {
      this.addHelper(child);
      this.addCamera(child);
    });

    this.signals.objectAdded.dispatch();
  }

  removeObject(object) {
    if (object.parent === null) return;

    object.traverse((child) => {
      this.removeHelper(child);
      this.removeCamera(child);
    });
    
    object.parent.remove(object);
    this.signals.objectRemoved.dispatch();
  }

  // Take an object out of any hierarchy and place it at root
  detachObject(object) {
    if (!object || !object.parent) return;

    const parent = object.parent;

    // Ensure world matrices are up to date
    parent.updateMatrixWorld(true);
    object.updateMatrixWorld(true);

    const childrenToPromote = [...object.children];

    // Promote children[0] to root
    childrenToPromote.forEach(child => {
      child.updateMatrixWorld(true);
      const worldMatrix = child.matrixWorld.clone();

      object.remove(child);
      this.mainScene.add(child);

      const rootInverse = this.mainScene.matrixWorld.clone().invert();
      child.matrix.copy(rootInverse.multiply(worldMatrix));
      child.matrix.decompose(child.position, child.quaternion, child.scale);
    });

    // Promote object to root
    const worldMatrixObject = object.matrixWorld.clone();
    parent.remove(object);
    this.mainScene.add(object);

    const rootInverse = this.mainScene.matrixWorld.clone().invert();
    object.matrix.copy(rootInverse.multiply(worldMatrixObject));
    object.matrix.decompose(object.position, object.quaternion, object.scale);

    this.signals.objectAdded.dispatch();
    this.signals.objectRemoved.dispatch();
  }

  attachObject(object, parent, index) {
    if (!object || !parent) return;

    // Ensure matrices are up to date
    this.mainScene.updateMatrixWorld(true);
    parent.updateMatrixWorld(true);
    object.updateMatrixWorld(true);

    // Compute object's matrix relative to new parent
    const parentInverse = parent.matrixWorld.clone().invert();
    const localMatrix = parentInverse.multiply(object.matrixWorld);

    // Remove from current parent
    if (object.parent) {
      object.parent.remove(object);
    }

    // Add to new parent
    if (index !== undefined && index >= 0) {
      parent.children.splice(index, 0, object);
      object.parent = parent;
    } else {
      parent.add(object);
    }

    // Apply local transform
    object.matrix.copy(localMatrix);
    object.matrix.decompose(object.position, object.quaternion, object.scale);
    object.updateMatrixWorld(true);

    this.signals.objectAdded.dispatch();
  }

  attachObjectLocal(object, parent, index) {
    if (!object || !parent) return;

    if (object.parent) {
        object.parent.remove(object);
    }

    if (index !== undefined && index >= 0) {
        parent.children.splice(index, 0, object);
        object.parent = parent;
    } else {
        parent.add(object);
    }

    object.updateMatrix();
    object.updateMatrixWorld(true);

    this.signals.objectAdded.dispatch();
  }

  replaceObject(oldObject, newObject) {
    if (!newObject || !oldObject) return;

    this.detachObject(oldObject);

    const parent = newObject.parent;
    if (!parent) return;

    const index = parent.children.indexOf(newObject);

    parent.updateMatrixWorld(true);
    newObject.updateMatrixWorld(true);

    // Match newObject transform to oldObject
    const parentInverse = parent.matrixWorld.clone().invert();
    oldObject.matrix.copy(parentInverse.multiply(newObject.matrixWorld));
    oldObject.matrix.decompose(
      oldObject.position,
      oldObject.quaternion,
      oldObject.scale
    );

    // Replace object
    parent.remove(newObject);
    parent.add(oldObject);

    // Restore original index
    const children = parent.children;
    const newIndex = children.indexOf(oldObject);
    children.splice(newIndex, 1);
    children.splice(index, 0, oldObject);

    oldObject.updateMatrixWorld(true);

    // Transfer children (WORLD preserved)
    while (newObject.children.length > 0) {
      const child = newObject.children[0];

      child.updateMatrixWorld(true);
      const worldMatrix = child.matrixWorld.clone();

      newObject.remove(child);
      oldObject.add(child);

      const newParentInverse = oldObject.matrixWorld.clone().invert();
      child.matrix.copy(newParentInverse.multiply(worldMatrix));
      child.matrix.decompose(
        child.position,
        child.quaternion,
        child.scale
      );
    }

    this.signals.objectRemoved.dispatch();
    this.signals.objectAdded.dispatch();
  }

  setupListeners() {
    this.signals.showHelpersChanged.add((states) => {
      this.gridHelper.visible = states.gridHelper;

      this.sceneHelpers.traverse((object) => {
        switch (object.type) {
          case 'CameraHelper':
            object.visible = states.cameraHelpers;
            break;

          case 'PointLightHelper':
          case 'DirectionalLightHelper':
          case 'SpotLightHelper':
          case 'HemisphereLightHelper':
            object.visible = states.lightHelpers;
            break;

          case 'SkeletonHelper':
            object.visible = states.skeletonHelpers;
            break;
        }
      });
    });

    this.signals.viewportShadingChanged.add((value) => {
      this.shadingMode = value;
      this.updateShadingMode(this.shadingMode, this.xrayMode);
    });

    this.signals.viewportXRayChanged.add((value) => {
      this.xrayMode = value;
      this.updateShadingMode(this.shadingMode, this.xrayMode);
    });
  }

  updateShadingMode(shadingMode, xrayMode) {
    let material = null;

    switch (shadingMode) {
      case 'material':
        material = null;
        break;
      case 'solid': {
        const matcapTexture = new THREE.TextureLoader().load('assets/textures/matcaps/040full.jpg');
        material = new THREE.MeshMatcapMaterial({
          matcap: matcapTexture,
          color: 0xcccccc,
          side: THREE.DoubleSide
        });
        break;
      }
      case 'normal':
        material = new THREE.MeshNormalMaterial();
        break;
      case 'wireframe':
        material = new THREE.MeshBasicMaterial({
          color: 0x000000,
          wireframe: true
        });
        break;
    }

    // Apply X-Ray properties
    if (xrayMode && material && shadingMode !== 'wireframe') {
      material = material.clone();
      material.transparent = true;
      material.opacity = 0.4;
      material.depthWrite = false;
      material.side = THREE.DoubleSide;
    }

    this.mainScene.overrideMaterial = material;
  }

  addHelper(object) {
    const helper = this.objectFactory.createHelper(object);
    if (helper) {
      this.sceneHelpers.add(helper);
      this.helpers[object.id] = helper;
    }
  }

  addCamera(object) {
    if (object.isCamera) {
      this.cameraManager.cameras[object.uuid] = object;
      this.signals.cameraAdded.dispatch(this.cameraManager.cameras);
    }
  }

  removeHelper(object) {
    const helper = this.helpers[object.id];
    if (helper && helper.parent) {
      helper.parent.remove(helper);
      delete this.helpers[object.id];
    }
  }

  removeCamera(object) {
    if (object.isCamera) {
      delete this.cameraManager.cameras[object.uuid];
      this.signals.cameraRemoved.dispatch(this.cameraManager.cameras);
    }
  }

  removeEditorOnlyObjects(scene) {
    const objectsToRemove = [];
    scene.traverse((child) => {
      if (child.userData.isEditorOnly) {
        objectsToRemove.push(child);
      }
    });

    for (const obj of objectsToRemove) {
      obj.parent?.remove(obj);
    }
  }
}