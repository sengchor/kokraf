import * as THREE from 'three';

export default class CameraManager {
  constructor({ 
    fov = 50, 
    aspect = window.innerWidth / window.innerHeight, 
    near = 0.1, 
    far = 1000, 
    initialPosition = new THREE.Vector3(3, 2, 5),
  } = {}) {
    this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    this.camera.name = 'Camera';
    this.camera.position.copy(initialPosition);
    this.camera.lookAt(new THREE.Vector3());
  }

  updateAspect(newAspect) {
    this.camera.aspect = newAspect;
    this.camera.updateProjectionMatrix();
  }
}