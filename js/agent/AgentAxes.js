import * as THREE from 'three';

export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;

export function r(n, digits = 4) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export const vec = (v, digits = 4) => [r(v.x, digits), r(v.y, digits), r(v.z, digits)];

const ZUP_TO_THREE = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0)
  )
);
const THREE_TO_ZUP = ZUP_TO_THREE.clone().invert();

const EULER_ORDER = 'ZYX';

export const AXES_NOTE =
  'Kokraf axes: +X front, +Y right, +Z up (Z-up — NOT the three.js Y-up convention). ';

export function positionToThree([x, y, z]) {
  return [y, z, x];
}

export function positionFromThree(v) {
  return vec(new THREE.Vector3(v.z, v.x, v.y));
}

export function pivotToThree(pivot) {
  return Array.isArray(pivot) ? positionToThree(pivot) : pivot;
}

export function rotationToThree([x, y, z]) {
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(x * RAD, y * RAD, z * RAD, EULER_ORDER)
  );
  return ZUP_TO_THREE.clone().multiply(q).multiply(THREE_TO_ZUP);
}

export function rotationFromThree(quaternion) {
  const q = THREE_TO_ZUP.clone().multiply(quaternion).multiply(ZUP_TO_THREE);
  const e = new THREE.Euler().setFromQuaternion(q, EULER_ORDER);
  return [r(e.x * DEG, 2), r(e.y * DEG, 2), r(e.z * DEG, 2)];
}

export function scaleToThree(scale) {
  return typeof scale === 'number' ? scale : [scale[1], scale[2], scale[0]];
}

export function scaleFromThree(v) {
  return vec(new THREE.Vector3(v.z, v.x, v.y));
}