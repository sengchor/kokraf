import * as THREE from 'three';
import { MeshData } from '../core/MeshData.js';

export function repairMeshData(meshData, options = {}) {
  const opts = {
    weldEpsilon: 1e-6,
    fixWinding: true,
    fillHoles: true,
    maxHoleFillEdges: 128,
    ...options,
  };

  const report = {
    weldedVerts: 0,
    removedFaces: 0,
    splitVerts: 0,
    flippedFaces: 0,
    filledHoles: 0,
    skippedHoles: 0,
    warnings: [],
  };

  let verts = [];
  let faces = [];

  const vidToIdx = new Map();
  for (const [id, v] of meshData.vertices) {
    vidToIdx.set(id, verts.length);
    verts.push({ x: v.position.x, y: v.position.y, z: v.position.z });
  }
  for (const [faceId, face] of meshData.faces) {
    faces.push({ id: faceId, vids: face.vertexIds.map(id => vidToIdx.get(id)) });
  }

  // Weld
  const remap = weldVertices(verts, opts.weldEpsilon);
  for (let i = 0; i < remap.length; i++) if (remap[i] !== i) report.weldedVerts++;
  faces = faces.map(f => ({ id: f.id, vids: f.vids.map(i => remap[i]) }));

  // Degenerate / duplicate faces
  const beforeDedup = faces.length;
  faces = removeDegenerateFaces(faces);
  faces = removeDuplicateFaces(faces);
  report.removedFaces += beforeDedup - faces.length;

  // Non-manifold edges
  const beforeNME = faces.length;
  faces = resolveNonManifoldEdges(faces, report);
  report.removedFaces += beforeNME - faces.length;

  // Non-manifold vertices
  ({ verts, faces } = resolveNonManifoldVertices(verts, faces, report));

  // Winding
  if (opts.fixWinding) faces = fixWindingConsistency(verts, faces, report);

  // Hole fill
  if (opts.fillHoles) faces = fillHoles(verts, faces, opts.maxHoleFillEdges, report);

  // Compact & rebuild MeshData
  const usedSet = new Set(faces.flatMap(f => f.vids));
  const compact = new Map();
  const finalVerts = [];
  for (const idx of usedSet) { compact.set(idx, finalVerts.length); finalVerts.push(verts[idx]); }
  faces = faces.map(f => ({ id: f.id, vids: f.vids.map(i => compact.get(i)) }));

  const result = new MeshData();
  const vertObjs = finalVerts.map(v => 
    result.addVertex(new THREE.Vector3(v.x, v.y, v.z))
  );
  for (const f of faces) result.addFace(f.vids.map(i => vertObjs[i]));

  // Determine safe IDs for brand new "repair" faces to avoid collisions
  let maxOriginalId = -1;
  for (const f of faces) {
    if (f.id !== -1 && f.id > maxOriginalId) maxOriginalId = f.id;
  }

  let nextRepairId = maxOriginalId + 1;

  for (const f of faces) {
    const newFace = result.addFace(f.vids.map(i => vertObjs[i]));
    
    result.faces.delete(newFace.id);
    
    if (f.id !== -1 && f.id !== undefined) {
      newFace.id = f.id;
    } else {
      newFace.id = nextRepairId++;
      newFace.isRepairFace = true;
    }
    
    result.faces.set(newFace.id, newFace);
  }

  result.repairReport = report;
  return result;
}

function weldVertices(verts, epsilon) {
  const remap = verts.map((_, i) => i);
  const inv = 1 / epsilon;
  const grid = new Map();

  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    const gx = Math.round(v.x * inv);
    const gy = Math.round(v.y * inv);
    const gz = Math.round(v.z * inv);

    let found = -1;
    outer: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(`${gx+dx},${gy+dy},${gz+dz}`);
          if (!bucket) continue;
          for (const j of bucket) {
            const u = verts[j];
            if ((v.x-u.x)**2 + (v.y-u.y)**2 + (v.z-u.z)**2 <= epsilon * epsilon) {
              found = j; break outer;
            }
          }
        }
      }
    }

    if (found >= 0) {
      remap[i] = remap[found];
    } else {
      const key = `${gx},${gy},${gz}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
  }

  for (let i = 0; i < remap.length; i++) {
    let r = remap[i];
    while (remap[r] !== r) r = remap[r];
    remap[i] = r;
  }

  return remap;
}

function removeDegenerateFaces(faces) {
  return faces.filter(f => {
    if (f.vids.length < 3) return false;
    return new Set(f.vids).size === f.vids.length;
  });
}

function canonicalFaceKey(vids) {
  const n = vids.length;
  let mi = 0;
  for (let i = 1; i < n; i++) if (vids[i] < vids[mi]) mi = i;
  const fwd = [...vids.slice(mi), ...vids.slice(0, mi)];
  const rev = [fwd[0], ...fwd.slice(1).reverse()];
  const kf = fwd.join(','), kr = rev.join(',');
  return kf < kr ? kf : kr;
}

function removeDuplicateFaces(faces) {
  const seen = new Set();
  return faces.filter(f => {
    const k = canonicalFaceKey(f.vids);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function resolveNonManifoldEdges(faces, report) {
  const edgeMap = new Map();
  for (let fi = 0; fi < faces.length; fi++) {
    const vids = faces[fi].vids, n = vids.length;
    for (let i = 0; i < n; i++) {
      const a = vids[i], b = vids[(i+1) % n];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push({ fi, fwd: a < b });
    }
  }

  const remove = new Set();

  for (const [, entries] of edgeMap) {
    if (entries.length <= 2) continue;

    const fwd = entries.filter(e => e.fwd);
    const bwd = entries.filter(e => !e.fwd);

    for (let i = 1; i < fwd.length; i++) remove.add(fwd[i].fi);
    for (let i = 1; i < bwd.length; i++) remove.add(bwd[i].fi);

    if (fwd.length === 0) for (let i = 1; i < bwd.length; i++) remove.add(bwd[i].fi);
    if (bwd.length === 0) for (let i = 1; i < fwd.length; i++) remove.add(fwd[i].fi);
  }

  if (remove.size > 0)
    report.warnings.push(`Removed ${remove.size} faces to fix non-manifold edges`);

  return faces.filter((_, i) => !remove.has(i));
}

function resolveNonManifoldVertices(verts, faces, report) {
  const vertFaces = new Map();
  for (let fi = 0; fi < faces.length; fi++)
    for (const vi of faces[fi].vids) {
      if (!vertFaces.has(vi)) vertFaces.set(vi, []);
      vertFaces.get(vi).push(fi);
    }

  const newVerts = [...verts];
  
  const newFaces = faces.map(f => ({ id: f.id, vids: [...f.vids] }));

  for (const [vi, fis] of vertFaces) {
    if (fis.length < 2) continue;
    const comps = vertexFanComponents(vi, fis, newFaces);
    if (comps.length <= 1) continue;

    for (let c = 1; c < comps.length; c++) {
      const newIdx = newVerts.length;
      newVerts.push({ ...newVerts[vi] });
      for (const fi of comps[c])
        newFaces[fi].vids = newFaces[fi].vids.map(v => v === vi ? newIdx : v);
      report.splitVerts++;
    }
  }

  return { verts: newVerts, faces: newFaces };
}

function vertexFanComponents(vi, fis, faces) {
  const adj = new Map(fis.map(fi => [fi, []]));

  for (let i = 0; i < fis.length; i++) {
    for (let j = i + 1; j < fis.length; j++) {
      if (shareEdgeThroughVert(vi, fis[i], fis[j], faces)) {
        adj.get(fis[i]).push(fis[j]);
        adj.get(fis[j]).push(fis[i]);
      }
    }
  }

  const visited = new Set();
  const comps = [];
  for (const fi of fis) {
    if (visited.has(fi)) continue;
    const comp = [], q = [fi];
    visited.add(fi);
    while (q.length) {
      const cur = q.shift();
      comp.push(cur);
      for (const nb of adj.get(cur)) {
        if (!visited.has(nb)) { visited.add(nb); q.push(nb); }
      }
    }
    comps.push(comp);
  }
  return comps;
}

function shareEdgeThroughVert(vi, fiA, fiB, faces) {
  const va = faces[fiA].vids, vb = faces[fiB].vids;
  const nbA = new Set();
  for (let i = 0; i < va.length; i++) {
    if (va[i] !== vi) continue;
    nbA.add(va[(i - 1 + va.length) % va.length]);
    nbA.add(va[(i + 1) % va.length]);
  }

  for (let i = 0; i < vb.length; i++) {
    if (vb[i] !== vi) continue;
    if (nbA.has(vb[(i - 1 + vb.length) % vb.length])) return true;
    if (nbA.has(vb[(i + 1) % vb.length])) return true;
  }
  return false;
}

function fixWindingConsistency(verts, faces, report) {
  const edgeAdj = new Map();
  for (let fi = 0; fi < faces.length; fi++) {
    const vids = faces[fi].vids, n = vids.length;
    for (let i = 0; i < n; i++) {
      const a = vids[i], b = vids[(i+1) % n];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!edgeAdj.has(key)) edgeAdj.set(key, []);
      edgeAdj.get(key).push({ fi, fwd: a < b });
    }
  }

  const faceNb = Array.from({ length: faces.length }, () => []);
  for (const [, entries] of edgeAdj) {
    if (entries.length !== 2) continue;
    const [e0, e1] = entries;
    const shouldFlip = (e0.fwd === e1.fwd);
    faceNb[e0.fi].push({ nb: e1.fi, shouldFlip });
    faceNb[e1.fi].push({ nb: e0.fi, shouldFlip });
  }

  const visited = new Set();
  const toFlip = new Set();

  for (let seed = 0; seed < faces.length; seed++) {
    if (visited.has(seed)) continue;
    visited.add(seed);
    const componentFaces = [seed];
    const q = [seed];

    while (q.length) {
      const fi = q.shift();
      const fiFlipped = toFlip.has(fi);
      for (const { nb, shouldFlip } of faceNb[fi]) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        componentFaces.push(nb);
        if (fiFlipped ? !shouldFlip : shouldFlip) toFlip.add(nb);
        q.push(nb);
      }
    }

    const meshCentroid = componentCentroid(verts, faces, componentFaces);
    let score = 0;
    for (const fi of componentFaces) {
      const n = faceNormal(verts, faces[fi].vids);
      const fc = faceCentroid(verts, faces[fi].vids);
      const toFace = new THREE.Vector3(
        fc.x - meshCentroid.x,
        fc.y - meshCentroid.y,
        fc.z - meshCentroid.z,
      );
      score += (toFlip.has(fi) ? -1 : 1) * n.dot(toFace);
    }

    if (score < 0) {
      for (const fi of componentFaces) {
        if (toFlip.has(fi)) toFlip.delete(fi); else toFlip.add(fi);
      }
    }
  }

  report.flippedFaces = toFlip.size;
  return faces.map((f, i) =>
    toFlip.has(i) ? { id: f.id, vids: [...f.vids].reverse() } : f
  );
}

function fillHoles(verts, faces, maxEdges, report) {
  const edgeCount = new Map();
  const edgeDirMap = new Map();

  for (let fi = 0; fi < faces.length; fi++) {
    const vids = faces[fi].vids, n = vids.length;
    for (let i = 0; i < n; i++) {
      const a = vids[i], b = vids[(i+1) % n];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
      edgeDirMap.set(key, { a, b });
    }
  }

  const bAdj = new Map();
  for (const [key, count] of edgeCount) {
    if (count !== 1) continue;
    const { a, b } = edgeDirMap.get(key);
    bAdj.set(b, a);
  }

  const holes = [];
  const visited = new Set();
  for (const start of bAdj.keys()) {
    if (visited.has(start)) continue;
    const loop = [];
    let cur = start;
    while (!visited.has(cur) && bAdj.has(cur)) {
      visited.add(cur);
      loop.push(cur);
      cur = bAdj.get(cur);
    }
    if (cur === start && loop.length >= 3) holes.push(loop);
  }

  const extra = [];
  for (const loop of holes) {
    if (loop.length > maxEdges) {
      report.skippedHoles++;
      report.warnings.push(`Skipped hole with ${loop.length} boundary edges (limit: ${maxEdges})`);
      continue;
    }
    const tris = earClip(verts, loop);
    for (const tri of tris) extra.push({ id: -1, vids: tri });
    report.filledHoles++;
  }

  return [...faces, ...extra];
}

function earClip(verts, loop) {
  if (loop.length === 3) return [[loop[0], loop[1], loop[2]]];
  if (loop.length === 4) return [[loop[0], loop[1], loop[2]], [loop[0], loop[2], loop[3]]];

  const normal = loopNormal(verts, loop);
  const { uAxis, vAxis } = orthoBasis(normal);

  const pts = loop.map(vi => {
    const { x, y, z } = verts[vi];
    return { u: x * uAxis.x + y * uAxis.y + z * uAxis.z,
             v: x * vAxis.x + y * vAxis.y + z * vAxis.z };
  });

  const result = [];
  const rem = loop.map((_, i) => i);

  let guard = rem.length * rem.length;
  while (rem.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < rem.length; i++) {
      const ip = (i - 1 + rem.length) % rem.length;
      const in_ = (i + 1) % rem.length;
      const [a, b, c] = [pts[rem[ip]], pts[rem[i]], pts[rem[in_]]];

      if (cross2d(a, b, c) <= 0) continue;

      let blocked = false;
      for (let j = 0; j < rem.length; j++) {
        if (j === ip || j === i || j === in_) continue;
        if (pointInTri2d(pts[rem[j]], a, b, c)) { blocked = true; break; }
      }
      if (blocked) continue;

      result.push([loop[rem[ip]], loop[rem[i]], loop[rem[in_]]]);
      rem.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }

  for (let i = 1; i < rem.length - 1; i++)
    result.push([loop[rem[0]], loop[rem[i]], loop[rem[i + 1]]]);

  return result;
}

// Geometry Helper
function faceNormal(verts, vids) {
  const n = new THREE.Vector3();
  const a = v3(verts[vids[0]]);
  for (let i = 1; i < vids.length - 1; i++) {
    const ab = v3(verts[vids[i]]).sub(a);
    const ac = v3(verts[vids[i+1]]).sub(a);
    n.add(new THREE.Vector3().crossVectors(ab, ac));
  }
  return n.normalize();
}

function faceCentroid(verts, vids) {
  const c = new THREE.Vector3();
  for (const vi of vids) c.add(v3(verts[vi]));
  return c.divideScalar(vids.length);
}

function componentCentroid(verts, faces, fis) {
  const c = new THREE.Vector3();
  let count = 0;
  for (const fi of fis) { c.add(faceCentroid(verts, faces[fi].vids)); count++; }
  return count > 0 ? c.divideScalar(count) : c;
}

function loopNormal(verts, loop) {
  const n = new THREE.Vector3();
  const o = v3(verts[loop[0]]);
  for (let i = 1; i < loop.length - 1; i++) {
    const ab = v3(verts[loop[i]]).sub(o);
    const ac = v3(verts[loop[i+1]]).sub(o);
    n.add(new THREE.Vector3().crossVectors(ab, ac));
  }
  return n.normalize();
}

function orthoBasis(normal) {
  const uAxis = new THREE.Vector3();
  const ref = Math.abs(normal.y) < 0.9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  uAxis.crossVectors(normal, ref).normalize();
  const vAxis = new THREE.Vector3().crossVectors(normal, uAxis).normalize();
  return { uAxis, vAxis };
}

function cross2d(a, b, c) {
  return (b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u);
}

function pointInTri2d(p, a, b, c) {
  const d1 = cross2d(p, a, b);
  const d2 = cross2d(p, b, c);
  const d3 = cross2d(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function v3({ x, y, z }) { return new THREE.Vector3(x, y, z); }