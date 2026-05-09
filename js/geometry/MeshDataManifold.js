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
        if (!areNestedLoops(loops, vertProperties)) {
          for (const loop of loops) {
            if (loop.length < 3) continue;
            const faceVerts = loop.map(idx => getVertex(idx));
            const unique = new Set(faceVerts.map(v => v.id));
            if (unique.size === faceVerts.length) {
              meshData.addFace(faceVerts);
            }
          }
          continue;
        }

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
  const halfEdge = new Map();

  for (const { a, b, c } of tris) {
    for (const [v1, v2] of [[a, b], [b, c], [c, a]]) {
      const key = v1 < v2 ? `${v1},${v2}` : `${v2},${v1}`;
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
      if (!halfEdge.has(key)) halfEdge.set(key, [v1, v2]);
    }
  }

  const adj = new Map();

  for (const [key, count] of edgeCount) {
    if (count === 1) {
      const [v1, v2] = halfEdge.get(key);
      if (!adj.has(v1)) adj.set(v1, []);
      adj.get(v1).push(v2);
    }
  }

  if (adj.size < 3) return [];

  const loops = [];
  const usedEdges = new Set();

  for (const [start, outgoing] of adj) {
    for (const firstStep of outgoing) {
      if (usedEdges.has(`${start}->${firstStep}`)) continue;

      const loop = [];
      let cur = start;
      let nxt = firstStep;
      let valid = true;

      while (true) {
        const edgeKey = `${cur}->${nxt}`;
        if (usedEdges.has(edgeKey)) { valid = nxt === start; break; }

        usedEdges.add(edgeKey);
        loop.push(cur);
        cur = nxt;

        if (cur === start) break;

        const nexts = adj.get(cur);
        if (!nexts) { valid = false; break; }

        const next = nexts.find(v => !usedEdges.has(`${cur}->${v}`));
        if (next === undefined) { valid = false; break; }
        nxt = next;
      }

      if (valid && loop.length >= 3) loops.push(loop);
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

function areNestedLoops(loops, vertProperties) {
  if (loops.length < 2) return false;

  // Project loops to 2D plane
  const projected = projectLoopsTo2D(loops, vertProperties);

  // Compute signed areas
  const areas = projected.map(loop => signedArea2D(loop));

  // Largest absolute area = outer loop
  let outerIndex = 0;
  let maxArea = 0;

  for (let i = 0; i < areas.length; i++) {
    const area = Math.abs(areas[i]);

    if (area > maxArea) {
      maxArea = area;
      outerIndex = i;
    }
  }

  const outer = projected[outerIndex];

  // Every other loop must be inside outer
  for (let i = 0; i < projected.length; i++) {
    if (i === outerIndex) continue;

    const centroid = polygonCentroid(projected[i]);

    if (!pointInPolygon2D(centroid, outer)) {
      return false;
    }
  }

  // Holes should not contain each other
  for (let i = 0; i < projected.length; i++) {
    if (i === outerIndex) continue;

    for (let j = 0; j < projected.length; j++) {
      if (i === j || j === outerIndex) continue;

      const centroid = polygonCentroid(projected[j]);

      if (pointInPolygon2D(centroid, projected[i])) {
        return false;
      }
    }
  }

  return true;
}

function signedArea2D(points) {
  let area = 0;

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];

    area += a.x * b.y - b.x * a.y;
  }

  return area * 0.5;
}

function polygonCentroid(points) {
  let x = 0;
  let y = 0;

  for (const p of points) {
    x += p.x;
    y += p.y;
  }

  return {
    x: x / points.length,
    y: y / points.length
  };
}

function pointInPolygon2D(point, polygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];

    const intersect =
      ((a.y > point.y) !== (b.y > point.y)) &&
      (point.x <
        (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x);

    if (intersect) inside = !inside;
  }

  return inside;
}

function projectLoopsTo2D(loops, vertProperties) {
  const first = loops[0];

  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < first.length; i++) {
    const a = getVec(first[i], vertProperties);
    const b = getVec(first[(i + 1) % first.length], vertProperties);
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }

  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  const ax = Math.abs(nx / len), ay = Math.abs(ny / len), az = Math.abs(nz / len);

  let drop = 'z';
  if (ax > ay && ax > az) drop = 'x';
  else if (ay > az) drop = 'y';

  return loops.map(loop =>
    loop.map(idx => {
      const v = getVec(idx, vertProperties);

      if (drop === 'x') return { x: v.y, y: v.z };
      if (drop === 'y') return { x: v.x, y: v.z };

      return { x: v.x, y: v.y };
    })
  );
}

function getVec(idx, verts) {
  return new THREE.Vector3(
    verts[idx * 3],
    verts[idx * 3 + 1],
    verts[idx * 3 + 2]
  );
}