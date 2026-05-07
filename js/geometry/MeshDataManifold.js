import ManifoldModule from 'manifold-3d';
import * as THREE from 'three';
import { MeshData } from '../core/MeshData.js';

let _wasm = null;

export async function getManifoldWasm() {
  if (!_wasm) {
    _wasm = await ManifoldModule();
    _wasm.setup();
  }
  return _wasm;
}

export async function toManifold(object, idOffset = 0) {
  const wasm = await getManifoldWasm();
  const meshData = object.userData.meshData;

  const positions = [];
  const vertIndexMap = new Map();

  for (const [id, vertex] of meshData.vertices) {
    const world = new THREE.Vector3(
      vertex.position.x,
      vertex.position.y,
      vertex.position.z 
    ).applyMatrix4(object.matrixWorld);

    vertIndexMap.set(id, positions.length / 3);
    positions.push(world.x, world.y, world.z);
  }

  const triVerts = [];
  const faceIDs = [];
  const faceIdMap = new Map();

  for (const [faceId, face] of meshData.faces) {
    const offsetId = faceId + idOffset;
    faceIdMap.set(offsetId, face);

    const vIds = face.vertexIds;
    for (let i = 1; i < vIds.length - 1; i++) {
      triVerts.push(
        vertIndexMap.get(vIds[0]),
        vertIndexMap.get(vIds[i]),
        vertIndexMap.get(vIds[i + 1])
      );
      faceIDs.push(offsetId);
    }
  }

  const mesh = new wasm.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(positions),
    triVerts: new Uint32Array(triVerts),
    faceID: new Uint32Array(faceIDs),
  });

  return { manifold: new wasm.Manifold(mesh), faceIdMap };
}

export function fromManifoldResult(resultMesh, faceIdMapA, faceIdMapB, primaryObject) {
  const { vertProperties, triVerts, faceID } = resultMesh;
  const numTris = triVerts.length / 3;

  const allFaceIdMap = new Map([...faceIdMapA, ...faceIdMapB]);
  const invWorld = primaryObject.matrixWorld.clone().invert();
  const meshData = new MeshData();

  // Weld output vertices by world-space position
  const PRECISION = 1e5;
  const weldCache = new Map();

  function getVertex(bufIdx) {
    const x = vertProperties[bufIdx * 3];
    const y = vertProperties[bufIdx * 3 + 1];
    const z = vertProperties[bufIdx * 3 + 2];
    const key = `${Math.round(x * PRECISION)},${Math.round(y * PRECISION)},${Math.round(z * PRECISION)}`;

    if (weldCache.has(key)) return weldCache.get(key);

    const local = new THREE.Vector3(x, y, z).applyMatrix4(invWorld);
    const v = meshData.addVertex(local);
    weldCache.set(key, v);
    return v;
  }

  // Group output triangles by faceID
  const groups = new Map();

  for (let t = 0; t < numTris; t++) {
    const id = faceID ? faceID[t] : -1;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push({
      a: triVerts[t * 3],
      b: triVerts[t * 3 + 1],
      c: triVerts[t * 3 + 2],
    });
  }

  for (const [id, tris] of groups) {
    const originalFace = allFaceIdMap.get(id);

    if (originalFace) {
      // Known faceID
      const loop = getBoundaryLoop(tris);

      if (loop && loop.length >= 3) {
        const faceVerts = loop.map(idx => getVertex(idx));
        const unique = new Set(faceVerts.map(v => v.id));

        if (unique.size === faceVerts.length) {
          meshData.addFace(faceVerts);
          continue;
        }
      }
    }

    // Unknown faceID
    for (const { a, b, c } of tris) {
      const va = getVertex(a);
      const vb = getVertex(b);
      const vc = getVertex(c);
      if (va === vb || vb === vc || va === vc) continue;
      meshData.addFace([va, vb, vc]);
    }
  }

  return meshData;
}

function getBoundaryLoop(tris) {
  const edgeCount = new Map();
  const directed = new Map();

  for (const { a, b, c } of tris) {
    for (const [v1, v2] of [[a, b], [b, c], [c, a]]) {
      const key = v1 < v2 ? `${v1},${v2}` : `${v2},${v1}`;
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
      if (!directed.has(key)) directed.set(key, [v1, v2]);
    }
  }

  const adj = new Map();

  for (const [key, count] of edgeCount) {
    if (count == 1) {
      const [v1, v2] = directed.get(key);
      adj.set(v1, v2);
    }
  }

  if (adj.size < 3) return null;

  // Walk the loop
  const start = adj.keys().next().value;
  const loop = [start];
  let cur = adj.get(start);

  while (cur !== start) {
    if (!adj.has(cur) || loop.length > adj.size) return null;
    loop.push(cur);
    cur = adj.get(cur);
  }

  return loop.length >= 3 ? loop : null;
}