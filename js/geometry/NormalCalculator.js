import * as THREE from 'three';
import { computePlaneNormal } from './TriangulationUtils.js';

const toSet = (s) => (s instanceof Set ? s : new Set(s ?? []));

/**
 * Compute normals for each face
 */
export function computeFaceNormals(meshData) {
  const faceNormals = new Map();

  for (let [fid, f] of meshData.faces) {
    if (f.vertexIds.length < 3) continue;

    const verts = f.vertexIds.map(id => meshData.vertices.get(id));
    const normal = computePlaneNormal(verts).clone();

    if (normal.lengthSq() === 0) {
      normal.set(0, 0, 1);
    } else {
      normal.normalize();
    }

    faceNormals.set(fid, normal);
  }

  return faceNormals;
}

/**
 * Compute per-vertex normals by averaging face normals of all faces touching the vertex
 */
export function computePerVertexNormals(meshData) {
  const faceNormals = computeFaceNormals(meshData);
  const normals = new Map();

  for (const vid of meshData.vertices.keys()) {
    normals.set(vid, new THREE.Vector3());
  }

  for (const [fid, f] of meshData.faces) {
    const fn = faceNormals.get(fid);
    if (!fn) continue;
    for (const vid of f.vertexIds) normals.get(vid)?.add(fn);
  }

  for (const n of normals.values()) {
    if (n.lengthSq() === 0) n.set(0, 0, 1);
    else n.normalize();
  }

  return normals;
}

export function computeCornerNormals(meshData, { angleDeg = 180, sharpEdges = null } = {}) {
  const angleSplit = angleDeg < 180;
  const cosLimit = angleSplit ? Math.cos(THREE.MathUtils.degToRad(angleDeg)) : -Infinity;
  const sharp = toSet(sharpEdges);
 
  const faceNormals = computeFaceNormals(meshData);
  const result = new Map();
 
  // Vertex -> faces
  const vertexToFaces = new Map();
  for (const [fid, f] of meshData.faces) {
    if (!faceNormals.has(fid)) continue;
    for (const vid of f.vertexIds) {
      if (!vertexToFaces.has(vid)) vertexToFaces.set(vid, []);
      vertexToFaces.get(vid).push(fid);
    }
  }
 
  // Edge adjacency. Sharp edges are left out, so smoothing never crosses them
  // (they behave exactly like boundary edges).
  const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const edgeToFaces = new Map();
  const sharpVertices = new Set();
 
  for (const [eid, e] of meshData.edges) {
    if (sharp.has(eid)) {
      sharpVertices.add(e.v1Id);
      sharpVertices.add(e.v2Id);
      continue;
    }
    const fids = [...e.faceIds].filter(fid => faceNormals.has(fid));
    if (fids.length >= 2) edgeToFaces.set(edgeKey(e.v1Id, e.v2Id), fids);
  }
 
  for (const [vid, faceIds] of vertexToFaces) {
    // Smooth mode, vertex not on a sharp edge: one shared normal (matches the renderer)
    if (!angleSplit && !sharpVertices.has(vid)) {
      const avg = new THREE.Vector3();
      for (const fid of faceIds) avg.add(faceNormals.get(fid));
      if (avg.lengthSq() === 0) avg.copy(faceNormals.get(faceIds[0]));
      avg.normalize();
      for (const fid of faceIds) result.set(`${fid}_${vid}`, avg);
      continue;
    }
 
    // Flood-fill the faces around this vertex into smoothing groups
    const unvisited = new Set(faceIds);
    while (unvisited.size > 0) {
      const first = unvisited.values().next().value;
      const stack = [first];
      const groupFaces = [];
      const avgNormal = new THREE.Vector3();
 
      while (stack.length > 0) {
        const fid = stack.pop();
        if (!unvisited.has(fid)) continue;
        unvisited.delete(fid);
 
        const fn = faceNormals.get(fid);
        groupFaces.push(fid);
        avgNormal.add(fn);
 
        const ids = meshData.faces.get(fid).vertexIds;
        for (let i = 0; i < ids.length; i++) {
          const v1 = ids[i];
          const v2 = ids[(i + 1) % ids.length];
          if (v1 !== vid && v2 !== vid) continue;
 
          for (const nf of edgeToFaces.get(edgeKey(v1, v2)) ?? []) {
            if (unvisited.has(nf) && fn.dot(faceNormals.get(nf)) >= cosLimit) stack.push(nf);
          }
        }
      }
 
      if (avgNormal.lengthSq() === 0) avgNormal.copy(faceNormals.get(first));
      avgNormal.normalize();
      for (const fid of groupFaces) result.set(`${fid}_${vid}`, avgNormal);
    }
  }
 
  return result;
}
 
/**
 * Compute vertex normals with angle-based smoothing (kept for existing callers).
 */
export function computeVertexNormalsWithAngle(meshData, angleDeg = 60, sharpEdges = null) {
  return computeCornerNormals(meshData, { angleDeg, sharpEdges });
}