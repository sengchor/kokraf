import * as THREE from 'three';
import { matrix, transpose, multiply, eigs } from 'mathjs';

export function getSortedVertexIds(meshData, vertexIds) {
  const positions = vertexIds.map(id => {
    const pos = meshData.getVertex(id).position;
    return new THREE.Vector3(pos.x, pos.y, pos.z);
  });

  const normal = computeBestFitPlaneNormal(positions);
  const sortedVertexIds = sortVerticesCCW(positions, vertexIds, normal);
  return { sortedVertexIds, normal };
}

export function computeBestFitPlaneNormal(positions) {
  if (!positions || positions.length < 3) {
    return new THREE.Vector3(0, 1, 0);
  }

  const points = positions.map(p => [p.x, p.y, p.z]);

  const centroidArr = [
    points.reduce((sum, p) => sum + p[0], 0) / points.length,
    points.reduce((sum, p) => sum + p[1], 0) / points.length,
    points.reduce((sum, p) => sum + p[2], 0) / points.length
  ];

  const centeredPoints = points.map(p => [
    p[0] - centroidArr[0],
    p[1] - centroidArr[1],
    p[2] - centroidArr[2]
  ]);

  const P = matrix(centeredPoints);
  const PT = transpose(P);
  let cov = multiply(PT, P);
  cov = multiply(1 / points.length, cov);

  const { values, eigenvectors } = eigs(cov);

  let minIndex = 0;
  let minValue = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] < minValue) {
        minValue = values[i];
        minIndex = i;
    }
  }

  const normalArr = eigenvectors[minIndex].vector.toArray();
  const normal = new THREE.Vector3(normalArr[0], normalArr[1], normalArr[2]).normalize();

  return normal;
}

export function sortVerticesCCW(positions, vertexIds, normal) {
  if (!positions || positions.length < 3) return vertexIds;

  const centroid = new THREE.Vector3();
  positions.forEach(p => centroid.add(p));
  centroid.divideScalar(positions.length);

  let u = new THREE.Vector3();
  if (Math.abs(normal.x) > 0.9) u.set(0, 1, 0);
  else u.set(1, 0, 0);
  u.cross(normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u);

  const angles = positions.map(p => {
    const relative = new THREE.Vector3().subVectors(p, centroid);
    const x = relative.dot(u);
    const y = relative.dot(v);
    return Math.atan2(y, x);
  });

  const sorted = vertexIds
    .map((id, i) => ({ id, angle: angles[i] }))
    .sort((a, b) => a.angle - b.angle)
    .map(o => o.id);

  return sorted;
}