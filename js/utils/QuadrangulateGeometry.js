import * as THREE from 'three';

function ensureIndexedGeometry(geometry) {
  if (!geometry.index) {
    const count = geometry.getAttribute('position').count;
    const idx = new Uint32Array(count);
    for (let i = 0; i < count; i++) idx[i] = i;
    geometry.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return geometry;
}

function v3FromAttr(attr, i, out) {
  out = out || new THREE.Vector3();
  return out.fromBufferAttribute(attr, i);
}

function faceNormal(a, b, c, out) {
  out = out || new THREE.Vector3();
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  return out.copy(ab.cross(ac)).normalize();
}

function dihedralAngle(n1, n2) {
  const d = THREE.MathUtils.clamp(n1.dot(n2), -1, 1);
  return Math.acos(d);
}

function edgeKey(i, j) {
  return i < j ? i + "_" + j : j + "_" + i;
}

function triangleList(geometry) {
  const index = geometry.index.array;
  const tris = [];
  for (let i = 0; i < index.length; i += 3) {
    tris.push([index[i], index[i + 1], index[i + 2]]);
  }
  return tris;
}

function buildEdgeMap(tris) {
  const map = new Map();
  for (let t = 0; t < tris.length; t++) {
    const [a, b, c] = tris[t];
    const edges = [[a, b], [b, c], [c, a]];
    for (const [u, v] of edges) {
      const k = edgeKey(u, v);
      let arr = map.get(k);
      if (!arr) { arr = []; map.set(k, arr); }
      arr.push(t);
    }
  }
  return map;
}

function quadShapeScore(quadPos) {
  const e = (i, j) => quadPos[i].distanceTo(quadPos[j]);
  const e01 = e(0,1), e12 = e(1,2), e23 = e(2,3), e30 = e(3,0);
  const opp1 = 1 / (1 + Math.abs(e01 - e23));
  const opp2 = 1 / (1 + Math.abs(e12 - e30));
  const d02 = e(0,2), d13 = e(1,3);
  const diagBal = 1 / (1 + Math.abs(d02 - d13));

  let angleQuality = 0;
  for (let i = 0; i < 4; i++) {
    const p = quadPos[(i + 3) % 4];
    const c = quadPos[i];
    const n = quadPos[(i + 1) % 4];
    const v1 = new THREE.Vector3().subVectors(p, c).normalize();
    const v2 = new THREE.Vector3().subVectors(n, c).normalize();
    const cos = THREE.MathUtils.clamp(v1.dot(v2), -1, 1);
    angleQuality += 1 - Math.abs(cos);
  }
  angleQuality /= 4;

  const score = 0.35 * ((opp1 + opp2) * 0.5) + 0.25 * diagBal + 0.40 * angleQuality;
  return score;
}

function computeCandidate(triA, triB, posAttr) {
  const setA = new Set(triA);
  const common = triB.filter(v => setA.has(v));
  if (common.length !== 2) return null;

  const shared = common;
  const uniqueA = triA.find(v => v !== shared[0] && v !== shared[1]);
  const uniqueB = triB.find(v => v !== shared[0] && v !== shared[1]);

  const v = i => new THREE.Vector3().fromBufferAttribute(posAttr, i);

  const candA = [uniqueA, shared[0], uniqueB, shared[1]];
  const candB = [uniqueA, shared[1], uniqueB, shared[0]];

  const quadApos = candA.map(v);
  const quadBpos = candB.map(v);

  const a0 = v(triA[0]), a1 = v(triA[1]), a2 = v(triA[2]);
  const b0 = v(triB[0]), b1 = v(triB[1]), b2 = v(triB[2]);
  const nA = faceNormal(a0, a1, a2);
  const nB = faceNormal(b0, b1, b2);

  const angle = dihedralAngle(nA, nB);
  const planarity = 1 - (angle / Math.PI);

  const shapeA = quadShapeScore(quadApos);
  const shapeB = quadShapeScore(quadBpos);

  const betterIsA = shapeA >= shapeB;
  const quad = betterIsA ? candA : candB;
  const shape = Math.max(shapeA, shapeB);

  return { triA: -1, triB: -1, quad, score: 0.55 * planarity + 0.45 * shape };
}

export function quadrangulateGeometry(geometry) {
  ensureIndexedGeometry(geometry);
  const posAttr = geometry.getAttribute('position');
  const tris = triangleList(geometry);
  const edgeMap = buildEdgeMap(tris);

  const candidates = [];
  for (const [, triIds] of edgeMap) {
    if (triIds.length !== 2) continue;
    const [tA, tB] = triIds;
    const cand = computeCandidate(tris[tA], tris[tB], posAttr);
    if (!cand) continue;
    cand.triA = tA;
    cand.triB = tB;
    candidates.push(cand);
  }
  
  candidates.sort((a, b) => b.score - a.score);

  const triUsed = new Uint8Array(tris.length);
  const quads = [];
  for (const c of candidates) {
    if (triUsed[c.triA] || triUsed[c.triB]) continue;
    const [q0,q1,q2,q3] = c.quad;
    const p0 = v3FromAttr(posAttr,q0);
    const p1 = v3FromAttr(posAttr,q1);
    const p2 = v3FromAttr(posAttr,q2);
    const p3 = v3FromAttr(posAttr,q3);
    const d1 = new THREE.Vector3().subVectors(p2, p0);
    const d2 = new THREE.Vector3().subVectors(p3, p1);
    const cross = new THREE.Vector3().crossVectors(d1, d2).length();
    if (cross < 1e-12) continue;

    quads.push(c.quad);
    triUsed[c.triA] = 1;
    triUsed[c.triB] = 1;
  }

  const leftoverTris = [];
  for (let i = 0; i < tris.length; i++) {
    if (!triUsed[i]) leftoverTris.push(tris[i]);
  }

  return { quads, triangles: leftoverTris };
}
