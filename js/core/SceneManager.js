import * as THREE from 'three';

export default class SceneManager {
  constructor() {
    this.mainScene = new THREE.Scene();
    this.mainScene.background = new THREE.Color(0x3b3b3b);

    this.sceneGridHelper = new THREE.Scene();
    this.sceneGridHelper.background = null;

    this.sceneHelpers = new THREE.Scene();
    this.sceneHelpers.background = null;
  }

  addAmbientLight(color = 0xffffff, intensity = 0.5) {
    const light = new THREE.AmbientLight(color, intensity);
    this.mainScene.add(light);
  }

  loaderMatcap() {
    return new THREE.TextureLoader().load('/assets/textures/matcaps/040full.jpg');
  }

  addDemoObjects() {
    const matcapTexture = this.loaderMatcap();
    
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshMatcapMaterial({ matcap: matcapTexture, color: 0xcccccc, side: THREE.DoubleSide })
    );
    cube.position.y = 0.0;
    this.mainScene.add(cube);

    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.2, 16, 100),
      new THREE.MeshMatcapMaterial({ matcap: matcapTexture, color: 0xcccccc, side: THREE.DoubleSide })
    );
    torus.position.set(1.5, 0, 0);
    this.mainScene.add(torus);
  }
}