import ManifoldModule from 'manifold-3d';
import * as THREE from 'three';
import { MeshData } from '../core/MeshData.js';
import { repairMeshData } from './ManifoldRepair.js';

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
  const originalData = object.userData.meshData;

  let manifold;
  let faceIdMap;

  try {
    const result = createManifoldFromMeshData(wasm, originalData, object.matrixWorld, idOffset);
    manifold = result.manifold;
    faceIdMap = result.faceIdMap;

    if (manifold.status() !== 'NoError') {
      throw new Error("Manifold status is not NoError");
    }

  } catch (err) {
    const repairedData = repairMeshData(originalData);
    const result = createManifoldFromMeshData(wasm, repairedData, object.matrixWorld, idOffset);
    
    manifold = result.manifold;
    faceIdMap = result.faceIdMap;

    // Update the map to flag repaired faces
    for (const [faceId, face] of repairedData.faces) {
      if (!originalData.faces.has(faceId)) {
        faceIdMap.set(faceId + idOffset, 'repair');
      }
    }
  }

  return { manifold, faceIdMap };
}

function createManifoldFromMeshData(wasm, meshData, matrixWorld, idOffset) {
  const positions = [];
  const vertIndexMap = new Map();

  for (const [id, vertex] of meshData.vertices) {
    const world = new THREE.Vector3(
      vertex.position.x,
      vertex.position.y,
      vertex.position.z 
    ).applyMatrix4(matrixWorld);

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

    if (originalFace === 'repair') { continue; }

    if (originalFace) {
      // Known faceID
      const loops = getBoundaryLoops(tris);

      if (loops.length === 1) {
        // Single loop face - create single boundary face
        const faceVerts = loops[0].map(idx => getVertex(idx));
        const unique = new Set(faceVerts.map(v => v.id));

        if (unique.size === faceVerts.length) {
          meshData.addFace(faceVerts);
          continue;
        }
      } else if (loops.length > 1) {
        // Multi-loop face - stitch all loops into one polygon via bridge edges
        const stitched = stitchLoops(loops, vertProperties);
        if (stitched && stitched.length >= 3) {
          const faceVerts = stitched.map(idx => getVertex(idx));
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

function getBoundaryLoops(tris) {
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

  if (adj.size < 3) return [];

  const loops = [];
  const visited = new Set();

  for (const start of adj.keys()) {
    if (visited.has(start)) continue;

    const loop = [];
    let cur = start;
    let valid = true;

    while (!visited.has(cur)) {
      if (!adj.has(cur)) { valid = false; break; }
      visited.add(cur);
      loop.push(cur);
      cur = adj.get(cur);
    }

    if (valid && cur === start && loop.length >= 3) {
      loops.push(loop);
    }
  }

  return loops;
}

function stitchLoops(loops, vertProperties) {
  let merged = loops[0];

  for (let i = 1; i < loops.length; i++) {
    merged = bridgeTwoLoops(merged, loops[i], vertProperties);
    if (!merged) return null;
  }

  return merged;
}

function bridgeTwoLoops(loopA, loopB, vertProperties) {
  let minDist = Infinity;
  let bestI = 0;
  let bestJ = 0;

  for (let i = 0; i < loopA.length; i++) {
    const a = loopA[i];
    const ax = vertProperties[a * 3];
    const ay = vertProperties[a * 3 + 1];
    const az = vertProperties[a * 3 + 2];

    for (let j = 0; j < loopB.length; j++) {
      const b = loopB[j];
      const dx = ax - vertProperties[b* 3];
      const dy = ay - vertProperties[b * 3 + 1];
      const dz = az - vertProperties[b * 3 + 2];
      const dist = dx * dx + dy * dy + dz * dz;

      if (dist < minDist) {
        minDist = dist;
        bestI = i;
        bestJ = j;
      }
    }
  }

  const rotA = [...loopA.slice(bestI), ...loopA.slice(0, bestI)];
  const rotB = [...loopB.slice(bestJ), ...loopB.slice(0, bestJ)];

  return [...rotA, rotA[0], ...rotB, rotB[0]];
}