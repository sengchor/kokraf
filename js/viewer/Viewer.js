import * as THREE from 'three';
import { QuaternionOrbitControls } from '/js/controls/QuaternionOrbitControls.js';

export default class Viewer {
  constructor(container) {
    this.container = container;
    this.running = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
    this.camera.position.set(3, 3, 3);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.container, antialias: true});
    this.renderer.setPixelRatio(window.devicePixelRatio);
    
    this.orbit = new QuaternionOrbitControls(this.camera, this.container);

    this.animate = this.animate.bind(this);
  }

  async fromJSON(json) {
    const loader = new THREE.ObjectLoader();
    this.scene = await loader.parseAsync(json.scene);
    this.camera = await loader.parseAsync(json.camera);

    this.initOrbitFromCamera(this.camera);

    this.updateShadingMode('solid');
  }

  animate() {
    if (this.disposed) return;
    requestAnimationFrame(this.animate);

    const { clientWidth, clientHeight } = this.container;

    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(clientWidth, clientHeight);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;

    this.scene.traverse(obj => {
      obj.geometry?.dispose();

      if (Array.isArray(obj.material)) {
        obj.material.forEach(mat => {
          mat.map?.dispose();
          mat.dispose();
        });
      } else if (obj.material) {
        obj.material.map?.dispose();
        obj.material.dispose();
      }
    });

    if (this.scene.overrideMaterial) {
      this.scene.overrideMaterial.dispose();
      this.scene.overrideMaterial = null;
    }

    this.orbit.dispose();
    this.renderer.clear();
    this.renderer.dispose();
  }

  updateShadingMode(shadingMode) {
    let material = null;

    switch (shadingMode) {
      case 'material':
        material = null;
        break;
      case 'solid': {
        const matcapTexture = new THREE.TextureLoader().load('/assets/textures/matcaps/040full.jpg');
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

    this.scene.overrideMaterial = material;
  }

  initOrbitFromCamera(camera) {
    const box = new THREE.Box3().setFromObject(this.scene);
    const center = box.getCenter(new THREE.Vector3());
    const distance = camera.position.distanceTo(center);

    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);

    this.orbit.camera = camera;
    this.orbit.target.copy(camera.position).addScaledVector(direction, distance);
    this.orbit.eye.subVectors(camera.position, this.orbit.target);

    this.orbit.updateFromState(false);
  }
}