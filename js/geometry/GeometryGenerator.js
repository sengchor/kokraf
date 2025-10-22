import * as THREE from 'three';
import earcut from 'earcut';
import { computeFaceNormals } from './NormalCalculator.js';

/**
 * Generate geometry with duplicated vertices (each face has its own copies).
 */
export function generateDuplicatedVertexGeometry(meshData, useEarcut = true) {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const indices = [];
  let currentIndex = 0;

  meshData.vertexIndexMap.clear();

  for (let f of meshData.faces.values()) {
    let verts = f.vertexIds.map(id => meshData.vertices.get(id));
    if (useEarcut) {
      verts = removeCollinearVertices(verts);
    }

    const baseIndex = currentIndex;
    for (let v of verts) {
      positions.push(v.position.x, v.position.y, v.position.z);

      if (!meshData.vertexIndexMap.has(v.id)) meshData.vertexIndexMap.set(v.id, []);
      meshData.vertexIndexMap.get(v.id).push(currentIndex);

      currentIndex++;
    }

    if (useEarcut) {
      const normal = computePlaneNormal(verts);
      const flatVertices = projectTo2D(verts, normal);
      const triangulated = earcut(flatVertices);

      for (let i = 0; i < triangulated.length; i += 3) {
        indices.push(
          baseIndex + triangulated[i],
          baseIndex + triangulated[i + 1],
          baseIndex + triangulated[i + 2]
        );
      }
    } else {
      for (let i = 1; i < verts.length - 1; i++) {
        indices.push(baseIndex, baseIndex + i, baseIndex + i + 1);
      }
    }
  }

  for (let v of meshData.vertices.values()) {
    if (v.faceIds.size === 0) {
      positions.push(v.position.x, v.position.y, v.position.z);

      if (!meshData.vertexIndexMap.has(v.id)) meshData.vertexIndexMap.set(v.id, []);
      meshData.vertexIndexMap.get(v.id).push(currentIndex);

      currentIndex++;
    }
  }

  meshData.bufferIndexToVertexId = new Map();
  for (let [logicalId, indicesArr] of meshData.vertexIndexMap) {
    for (let i of indicesArr) meshData.bufferIndexToVertexId.set(i, logicalId);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

/**
 * Generate geometry that shares vertices (no duplicates between faces).
 */
export function generateSharedVertexGeometry(meshData, useEarcut = true) {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const indices = [];

  meshData.vertexIndexMap.clear();
  const vertexIdToIndex = new Map();
  let currentIndex = 0;

  for (let v of meshData.vertices.values()) {
    positions.push(v.position.x, v.position.y, v.position.z);
    vertexIdToIndex.set(v.id, currentIndex);

    meshData.vertexIndexMap.set(v.id, [currentIndex]);
    currentIndex++;
  }

  for (let f of meshData.faces.values()) {
    let verts = f.vertexIds.map(id => meshData.vertices.get(id));
    if (useEarcut) {
      verts = removeCollinearVertices(verts);
    }

    if (useEarcut) {
      const normal = computePlaneNormal(verts);
      const flatVertices = projectTo2D(verts, normal);
      const triangulated = earcut(flatVertices);

      for (let i = 0; i < triangulated.length; i += 3) {
        const a = vertexIdToIndex.get(verts[triangulated[i]].id);
        const b = vertexIdToIndex.get(verts[triangulated[i + 1]].id);
        const c = vertexIdToIndex.get(verts[triangulated[i + 2]].id);

        indices.push(a, b, c);
      }
    } else {
      const base = vertexIdToIndex.get(verts[0].id);
      for (let i = 1; i < verts.length - 1; i++) {
        const b = vertexIdToIndex.get(verts[i].id);
        const c = vertexIdToIndex.get(verts[i + 1].id);
        indices.push(base, b, c);
      }
    }
  }

  meshData.bufferIndexToVertexId = new Map();
  for (let [logicalId, indexArr] of meshData.vertexIndexMap) {
    for (let i of indexArr) {
      meshData.bufferIndexToVertexId.set(i, logicalId);
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

/**
 * Generate geometry with angle-based smoothing groups.
 */
export function generateAngleBasedGeometry(meshData, angleDegree = 60, useEarcut = true) {
  const threshold = Math.cos(THREE.MathUtils.degToRad(angleDegree));

  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const indices = [];
  meshData.vertexIndexMap.clear();

  const faceNormals = computeFaceNormals(meshData);

  // --- 1. Build edgeKey -> faceIds from existing edges ---
  const edgeToFaces = new Map();
  for (let e of meshData.edges.values()) {
    const edgeKey = e.v1Id < e.v2Id ? `${e.v1Id}_${e.v2Id}` : `${e.v2Id}_${e.v1Id}`;
    edgeToFaces.set(edgeKey, Array.from(e.faceIds));
  }

  // --- 2. Mark smooth vs sharp edges ---
  const smoothEdges = new Set();
  for (let [edgeKey, faces] of edgeToFaces) {
    if (faces.length === 2) {
      const [f1, f2] = faces;
      const n1 = faceNormals.get(f1);
      const n2 = faceNormals.get(f2);
      if (n1.dot(n2) >= threshold) smoothEdges.add(edgeKey);
    }
  }

  // --- 3. Build smoothing groups per vertex ---
  const vertexGroups = new Map();
  let currentIndex = 0;

  const getOrCreateGroup = (vId, faceId) => {
    if (!vertexGroups.has(vId)) vertexGroups.set(vId, []);

    for (let g of vertexGroups.get(vId)) {
      if (g.connectedFaces.has(faceId)) return g;
    }

    const v = meshData.vertices.get(vId);
    positions.push(v.position.x, v.position.y, v.position.z);

    const group = {
      index: currentIndex++,
      faces: new Set([faceId]),
      connectedFaces: new Set([faceId])
    };
    vertexGroups.get(vId).push(group);

    return group;
  };

  // --- 4. Assign vertex indices using smoothing groups ---
  for (let f of meshData.faces.values()) {
    let verts = f.vertexIds.map(id => meshData.vertices.get(id));
    if (useEarcut) verts = removeCollinearVertices(verts);

    const vertexIds = verts.map(v => v.id);
    const faceIndices = [];

    for (let vId of vertexIds) {
      let group = null;

      for (let i = 0; i < vertexIds.length; i++) {
        const v1 = vertexIds[i];
        const v2 = vertexIds[(i + 1) % vertexIds.length];
        if (v1 !== vId && v2 !== vId) continue;

        const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
        if (smoothEdges.has(edgeKey)) {
          const neighborFaces = edgeToFaces.get(edgeKey);
          for (let nf of neighborFaces) {
            if (nf !== f.id) {
              const groups = vertexGroups.get(vId) || [];
              group = groups.find(g => g.faces.has(nf));
              if (group) break;
            }
          }
        }
        if (group) break;
      }

      if (!group) group = getOrCreateGroup(vId, f.id);

      group.faces.add(f.id);
      group.connectedFaces.add(f.id);

      if (!meshData.vertexIndexMap.has(vId)) meshData.vertexIndexMap.set(vId, []);
      meshData.vertexIndexMap.get(vId).push(group.index);

      faceIndices.push(group.index);
    }

    // --- 4.5 Triangulate (Earcut or Fan) ---
    if (useEarcut) {
      const normal = computePlaneNormal(verts);
      const flatVertices2D = projectTo2D(verts, normal);
      const triangulated = earcut(flatVertices2D);

      for (let i = 0; i < triangulated.length; i += 3) {
        indices.push(faceIndices[triangulated[i]], faceIndices[triangulated[i + 1]], faceIndices[triangulated[i + 2]]);
      }
    } else {
      if (faceIndices.length >= 3) {
        const base = faceIndices[0];
        for (let i = 1; i < faceIndices.length - 1; i++) {
          indices.push(base, faceIndices[i], faceIndices[i + 1]);
        }
      }
    }
  }

  // --- 5. Add isolated vertices (not in any face) ---
  for (let v of meshData.vertices.values()) {
    if (v.faceIds.size === 0) {
      positions.push(v.position.x, v.position.y, v.position.z);

      if (!meshData.vertexIndexMap.has(v.id)) meshData.vertexIndexMap.set(v.id, []);
      meshData.vertexIndexMap.get(v.id).push(currentIndex);

      indices.push(currentIndex, currentIndex, currentIndex);
      currentIndex++;
    }
  }

  meshData.bufferIndexToVertexId = new Map();
  for (let [logicalId, indicesArr] of meshData.vertexIndexMap) {
    for (let i of indicesArr) meshData.bufferIndexToVertexId.set(i, logicalId);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

function computePlaneNormal(verts) {
  if (verts.length < 3) return new THREE.Vector3(0, 0, 1);
  const v0 = verts[0].position;
  const v1 = verts[1].position;
  const v2 = verts[2].position;

  const edge1 = new THREE.Vector3().subVectors(v1, v0);
  const edge2 = new THREE.Vector3().subVectors(v2, v0);

  const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
  return normal;
}

function projectTo2D(verts, normal) {
  verts = verts.filter(v => v !== undefined && v !== null);
  if (verts.length === 0) return [];

  let tangent = new THREE.Vector3(1, 0, 0);
  if (Math.abs(normal.dot(tangent)) > 0.99) tangent.set(0, 1, 0);

  const u = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();

  const origin = verts[0].position;
  const flat = [];

  for (let vert of verts) {
      const p = new THREE.Vector3().subVectors(vert.position, origin);
      flat.push(p.dot(u), p.dot(v));
  }

  return flat;
}

function removeCollinearVertices(verts, epsilon = 1e-6) {
  if (verts.length <= 3) return verts.slice();

  const toVec3 = v => new THREE.Vector3(v.position.x, v.position.y, v.position.z);
  const filtered = [];

  for (let i = 0; i < verts.length; i++) {
    const prev = toVec3(verts[(i - 1 + verts.length) % verts.length]);
    const curr = toVec3(verts[i]);
    const next = toVec3(verts[(i + 1) % verts.length]);

    const v1 = curr.clone().sub(prev);
    const v2 = next.clone().sub(curr);

    if (v1.clone().cross(v2).lengthSq() > epsilon) {
      filtered.push(verts[i]);
    }
  }

  return filtered;
}