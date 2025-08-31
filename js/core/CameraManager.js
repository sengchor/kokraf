import * as THREE from 'three';

export default class CameraManager {
  constructor(editor) {
    this.editor = editor;

    this.camera = this.createDefaultCamera();
    this.cameras = {[this.camera.uuid]: this.camera};
  }

  createDefaultCamera({
    fov = 50,
    aspect = window.innerWidth / window.innerHeight,
    near = 0.1,
    far = 1000,
    initialPosition = new THREE.Vector3(3, 2, 5)
  } = {}) {
    const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    camera.name = 'CAMERA';
    camera.isDefault = true;
    camera.position.copy(initialPosition);
    camera.lookAt(new THREE.Vector3());
    return camera;
  }

  updateAspect(newAspect) {
    if (this.camera.isOrthographicCamera) {
      const frustumSize = 2;

      this.camera.left = (-frustumSize * newAspect) / 2;
      this.camera.right = (frustumSize * newAspect) / 2;
      this.camera.top = frustumSize / 2;
      this.camera.bottom = -frustumSize / 2;
    } else {
      this.camera.aspect = newAspect;
    }

    this.camera.updateProjectionMatrix();
  }

  setCamera(newCamera) {
    const oldUuid = this.camera.uuid;
    const newUuid = newCamera.uuid;

    this.camera.copy(newCamera);
    this.camera.uuid = newUuid;

    delete this.cameras?.[oldUuid];
    this.cameras = this.cameras || {};
    this.cameras[newUuid] = this.camera;
  }

  resetCamera() {
    const defaultCam = this.createDefaultCamera();
    this.setCamera(defaultCam);
  }
}