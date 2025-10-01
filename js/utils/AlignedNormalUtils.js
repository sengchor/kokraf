import * as THREE from 'three';

export function getNeighborFaces(meshData, edgeIds) {
  if (!edgeIds || edgeIds.length === 0) return [];

  const result = [];

  for (let eId of edgeIds) {
    const edge = meshData.edges.get(eId);
    if (!edge) continue;

    for (let fId of edge.faceIds) {
      const face = meshData.faces.get(fId);
      if (!face) continue;

      result.push({ face: face, edge: edge });
    }
  }

  return result;
}

export function calculateFaceNormal(meshData, face) {
  if (!face || !face.vertexIds || face.vertexIds.length < 3) return new THREE.Vector3(0, 0, 0);

  const vIds = face.vertexIds;
  const positions = vIds.map(id => meshData.getVertex(id).position);

  const normal = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < positions.length; i++) {
    const current = positions[i];
    const next = positions[(i + 1) % positions.length];
    normal.x += (current.y - next.y) * (current.z + next.z);
    normal.y += (current.z - next.z) * (current.x + next.x);
    normal.z += (current.x - next.x) * (current.y + next.y);
  }

  return normal.normalize();
}

export function getCentroidFromVertices(vertexIds, meshData) {
  if (!vertexIds || vertexIds.length === 0) return new THREE.Vector3();

  const centroid = new THREE.Vector3();

  for (let vId of vertexIds) {
    const vertex = meshData.getVertex(vId);
    if (!vertex) continue;
    centroid.add(vertex.position);
  }

  centroid.divideScalar(vertexIds.length);

  return centroid;
}

export function getEdgeMidpoint(edge, meshData) {
  if (!edge || !meshData) return null;

  const v1 = meshData.getVertex(edge.v1Id);
  const v2 = meshData.getVertex(edge.v2Id);
  if (!v1 || !v2) return null;

  const midpoint = new THREE.Vector3().addVectors(v1.position, v2.position).multiplyScalar(0.5);
  return midpoint;
}

export function computeAlignedNeighborNormal(meshData, candidateVertexIds, neighbor) {
  const neighborNormal = calculateFaceNormal(meshData, neighbor.face);

  const candidateCentroid = getCentroidFromVertices(candidateVertexIds, meshData);
  const neighborCentroid = getCentroidFromVertices(neighbor.face.vertexIds, meshData);

  const edgeMidpoint = getEdgeMidpoint(neighbor.edge, meshData);

  const vCandidate = new THREE.Vector3().subVectors(candidateCentroid, edgeMidpoint);
  const vNeighbor = new THREE.Vector3().subVectors(neighborCentroid, edgeMidpoint);

  const edgeDir = new THREE.Vector3().subVectors(
    meshData.getVertex(neighbor.edge.v2Id).position,
    meshData.getVertex(neighbor.edge.v1Id).position
  ).normalize();

  const projCandidate = vCandidate.clone().projectOnPlane(edgeDir);
  const projNeighbor = vNeighbor.clone().projectOnPlane(edgeDir);

  const angle = projNeighbor.angleTo(projCandidate);

  const cross = new THREE.Vector3().crossVectors(projNeighbor, projCandidate);
  const sign = cross.dot(edgeDir) < 0 ? -1 : 1;

  const quaternion = new THREE.Quaternion().setFromAxisAngle(edgeDir, sign * angle);
  const alignedNeighborNormal = neighborNormal.clone().applyQuaternion(quaternion);

  return alignedNeighborNormal;
}

export function shouldFlipNormal(meshData, sortedVertexIds, candidateNormal, neighbors) {
  let reverseScore = 0;

  for (let i = 0; i < neighbors.length; i++) {
    const alignedNeighborNormal = computeAlignedNeighborNormal(meshData, sortedVertexIds, neighbors[i]);

    const dotProduct = candidateNormal.dot(alignedNeighborNormal);

    if (dotProduct > 0) {
      reverseScore++;
    } else if (dotProduct < 0) {
      reverseScore--;
    }
  }

  return reverseScore > 0;
}