import * as THREE from 'three';

export const TransformUtils = {
  setWorldPosition(object, worldPos) {
    if (!object.parent) {
      object.position.copy(worldPos);
    } else {
      object.parent.updateMatrixWorld(true);
      const localPos = worldPos.clone()
        .applyMatrix4(object.parent.matrixWorld.clone().invert());
      object.position.copy(localPos);
    }
  },

  setWorldRotation(object, worldQuat) {
    if (!object.parent) {
      object.quaternion.copy(worldQuat);
    } else {
      object.parent.updateMatrixWorld(true);
      const parentWorldQuat = object.parent.getWorldQuaternion(new THREE.Quaternion());
      const localQuat = parentWorldQuat.invert().multiply(worldQuat);
      object.quaternion.copy(localQuat);
    }
  },

  setWorldScale(object, worldScale) {
    if (!object.parent) {
      object.scale.copy(worldScale);
    } else {
      object.parent.updateMatrixWorld(true);
      const parentWorldScale = object.parent.getWorldScale(new THREE.Vector3());
      object.scale.set(
        worldScale.x / parentWorldScale.x,
        worldScale.y / parentWorldScale.y,
        worldScale.z / parentWorldScale.z
      );
    }
  }
};
