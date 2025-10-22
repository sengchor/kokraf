import * as THREE from 'three';

/**
 * Compute per-vertex normals by averaging face normals of all faces touching the vertex
 */
export function computePerVertexNormals(meshData) {
  const normals = new Map();

  for (const [vid, v] of meshData.vertices) {
    normals.set(vid, new THREE.Vector3(0, 0, 0));
  }

  for (const [, f] of meshData.faces) {
    const vIds = f.vertexIds;
    if (vIds.length < 3) continue;

    const p0 = meshData.vertices.get(vIds[0]).position;
    const p1 = meshData.vertices.get(vIds[1]).position;
    const p2 = meshData.vertices.get(vIds[2]).position;

    const e1 = new THREE.Vector3().subVectors(p1, p0);
    const e2 = new THREE.Vector3().subVectors(p2, p0);
    const faceNormal = new THREE.Vector3().crossVectors(e1, e2);

    if (faceNormal.lengthSq() === 0) continue;
    faceNormal.normalize();

    for (const vid of vIds) {
      normals.get(vid).add(faceNormal);
    }
  }

  for (const [vid, n] of normals) {
    if (n.lengthSq() === 0) n.set(0, 0, 1);
    else n.normalize();
  }

  return normals;
}

/**
 * Compute normals for each face
 */
export function computeFaceNormals(meshData) {
  const faceNormals = new Map();

  for (let [fid, f] of meshData.faces) {
    if (f.vertexIds.length < 3) continue;

    const v0 = meshData.vertices.get(f.vertexIds[0]).position;
    const v1 = meshData.vertices.get(f.vertexIds[1]).position;
    const v2 = meshData.vertices.get(f.vertexIds[2]).position;

    const edge1 = new THREE.Vector3().subVectors(v1, v0);
    const edge2 = new THREE.Vector3().subVectors(v2, v0);
    const normal = new THREE.Vector3().crossVectors(edge1, edge2);

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
 * Compute vertex normals with angle-based smoothing
 */
export function computeVertexNormalsWithAngle(meshData, angleDeg = 60) {
  const angleLimit = THREE.MathUtils.degToRad(angleDeg);
  const cosLimit = Math.cos(angleLimit);

  const faceNormals = computeFaceNormals(meshData);
  const result = new Map();

  // Build adjacency: vertex → faces
  const vertexToFaces = new Map();
  for (const [fid, f] of meshData.faces) {
    for (const vid of f.vertexIds) {
      if (!vertexToFaces.has(vid)) vertexToFaces.set(vid, []);
      vertexToFaces.get(vid).push(fid);
    }
  }

  // Build face adjacency through edges
  const edgeToFaces = new Map();
  for (let e of meshData.edges.values()) {
    const edgeKey = e.v1Id < e.v2Id ? `${e.v1Id}_${e.v2Id}` : `${e.v2Id}_${e.v1Id}`;
    edgeToFaces.set(edgeKey, Array.from(e.faceIds));
  }

  // For each vertex, flood-fill connected faces into smoothing groups
  for (const [vid, faceIds] of vertexToFaces) {
    const unvisited = new Set(faceIds);
    while (unvisited.size > 0) {
      const groupFaces = [];
      const stack = [unvisited.values().next().value];
      const avgNormal = new THREE.Vector3();

      while (stack.length > 0) {
        const fid = stack.pop();
        if (!unvisited.has(fid)) continue;
        unvisited.delete(fid);

        const fn = faceNormals.get(fid);
        groupFaces.push(fid);
        avgNormal.add(fn);

        const face = meshData.faces.get(fid);
        for (let i = 0; i < face.vertexIds.length; i++) {
          const v1 = face.vertexIds[i];
          const v2 = face.vertexIds[(i + 1) % face.vertexIds.length];
          if (v1 !== vid && v2 !== vid) continue;

          const edgeKey = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
          const neighbors = edgeToFaces.get(edgeKey) || [];
          for (const nf of neighbors) {
            if (unvisited.has(nf)) {
              const dot = fn.dot(faceNormals.get(nf));
              if (dot >= cosLimit) stack.push(nf);
            }
          }
        }
      }

      avgNormal.normalize();
      for (const fid of groupFaces) {
        result.set(`${fid}_${vid}`, avgNormal.clone());
      }
    }
  }

  return result;
}
