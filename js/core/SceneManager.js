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
      switch (value) {
        case 'material':
          this.mainScene.overrideMaterial = null;
          break;
        case 'solid':
          const matcapTexture = new THREE.TextureLoader().load('assets/textures/matcaps/040full.jpg');
          this.mainScene.overrideMaterial = new THREE.MeshMatcapMaterial({
            matcap: matcapTexture,
            color: 0xcccccc,
            side: THREE.DoubleSide
          });
          break;
        case 'normal':
          this.mainScene.overrideMaterial = new THREE.MeshNormalMaterial();
          break;
        case 'wireframe':
          this.mainScene.overrideMaterial = new THREE.MeshBasicMaterial({
            color: 0x000000,
            wireframe: true
          });
          break;
      }
    });
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