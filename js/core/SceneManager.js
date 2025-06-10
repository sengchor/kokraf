import * as THREE from 'three';

export default class SceneManager {
  constructor(editor) {
    this.helpers = editor.helpers;
    this.objectFactory = editor.objectFactory;

    this.mainScene = new THREE.Scene();
    this.mainScene.background = new THREE.Color(0x3b3b3b);

    this.sceneEditorHelpers  = new THREE.Scene();
    this.sceneEditorHelpers.background = null;

    this.sceneHelpers = new THREE.Scene();
    this.sceneHelpers.background = null;
  }
  
  emptyScene(scene) {
    while (scene.children.length > 0) {
      const obj = scene.children[0];
      scene.remove(obj);

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

  emptyAllScenes() {
    this.emptyScene(this.mainScene);
    this.emptyScene(this.sceneHelpers);
  }

  setScene(scene) {
    while (scene.children.length > 0) {
      this.addObject(scene.children[0]);
    }
  }

  addAmbientLight(color = 0xffffff, intensity = 0.5) {
    const light = new THREE.AmbientLight(color, intensity);
    this.mainScene.add(light);
  }

  addDemoObjects() {
    const matcapTexture = new THREE.TextureLoader().load('/assets/textures/matcaps/040full.jpg');
    
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshMatcapMaterial({ matcap: matcapTexture, color: 0xcccccc, side: THREE.DoubleSide })
    );
    cube.position.set(3.5, 0, 0);
    this.mainScene.add(cube);

    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.2, 16, 100),
      new THREE.MeshMatcapMaterial({ matcap: matcapTexture, color: 0xcccccc, side: THREE.DoubleSide })
    );
    torus.position.set(1.5, 0, 0);
    this.mainScene.add(torus);
  }
  
  addObject(object) {
    this.mainScene.add(object);

    const helper = this.objectFactory.createHelper(object);
    if (helper) {
      this.sceneHelpers.add(helper);
      this.helpers[object.id] = helper;
    }
  }

  removeObject(object) {
    const helper = this.helpers[object.id];

    if (helper && helper.parent) {
      helper.parent.remove(helper);
      delete this.helpers[object.id];
    }

    if (object.parent) {
      object.parent.remove(object);
    }
  }
}