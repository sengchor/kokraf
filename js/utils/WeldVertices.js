import * as THREE from 'three';

/**
 * Weld all vertices in a geometry by position.
 * 
 * @param {THREE.BufferGeometry} geometry
 * @param {number} tolerance
 * @param {THREE.BufferGeometry}
 */
export function weldVertices(geometry, tolerance = 1e-6) {
  const posAttr = geometry.getAttribute('position');
  const positions = [];
  for (let i = 0; i < posAttr.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(posAttr, i);
    positions.push(v);
  }

  const precision = 1 / tolerance;
  const vertexMap = new Map();
  const newPositions = [];
  const indexArray = [];
  let nextIndex = 0;

  for (let i = 0; i < positions.length; i++) {
    const v = positions[i];

    const key = `${Math.round(v.x * precision)}_${Math.round(v.y * precision)}_${Math.round(v.z * precision)}`;

    if (vertexMap.has(key)) {
      indexArray.push(vertexMap.get(key));
    } else {
      newPositions.push(v.x, v.y, v.z);
      vertexMap.set(key, nextIndex);
      indexArray.push(nextIndex);
      nextIndex++;
    }
  }

  const newGeometry = new THREE.BufferGeometry();
  newGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
  newGeometry.setIndex(indexArray);

  newGeometry.computeVertexNormals();
  newGeometry.computeBoundingSphere();
  newGeometry.computeBoundingBox();

  return newGeometry;
}