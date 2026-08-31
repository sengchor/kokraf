import * as THREE from 'three';
import earcut from 'earcut';
import { computePlaneNormal, projectTo2D } from '../geometry/TriangulationUtils.js';

const EPS = 1e-12;

// Minimum triangle height relative to its base.
const MIN_ASPECT = 1e-2;

// Prevent tiny triangles from dominating the LSCM weighting.
const MIN_AREA_RATIO = 1e-6;

// A face thinner than this cannot define a reliable plane. |Newell| is the
// polygon area, so comparing against perimeter squared is scale free.
const MIN_FACE_AREA_RATIO = 1e-5;

export class UVUnwrap {
  /**
   * @param {MeshData} meshData
   * @param {Set<number>|number[]} seams
   * @param {{margin?: number, preserveScale?: boolean, maxIterations?: number,
   *          rotateMethod?: 'auto'|'axis'|'minarea'|'none', alignToWorldUp?: boolean}} [options]
   * @returns {{islands: Array, wedges: Array}|null}
   */
  static unwrap(meshData, seams, options = {}) {
    const {
      margin = 0.004,
      preserveScale = true,
      maxIterations = 0,
      rotateMethod = 'auto',
      alignToWorldUp = true,
    } = options;

    if (!meshData || meshData.faces.size === 0) return null;

    const seamSet = this._toSet(seams);
    const { wedges, cornerWedge } = this._buildWedges(meshData, seamSet);
    const islands = this._buildIslands(meshData, seamSet);
    if (islands.length === 0) return null;

    for (const island of islands) {
      this._buildIslandGeometry(island, meshData, cornerWedge);
      this._parameterize(island, maxIterations);
      this._normalizeIsland(island, preserveScale, rotateMethod, alignToWorldUp);
    }

    this._packIslands(islands, margin);
    this._writeUVs(meshData, islands, cornerWedge);

    return { islands, wedges };
  }

  static _toSet(seams) {
    if (seams instanceof Set) return seams;
    if (Array.isArray(seams)) return new Set(seams);
    return new Set();
  }

  // ---------------------------------------------------------------- topology

  static _makeDSU(n) {
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;

    const find = (a) => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    };

    return { find, union: (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; } };
  }

  /**
   * Splits every vertex into wedges. Two faces sharing a vertex belong to the
   * same wedge only if they are reachable from each other through non-seam
   * edges incident to that vertex.
   */
  static _buildWedges(meshData, seamSet) {
    const wedges = [];
    const cornerWedge = new Map();

    for (const vertex of meshData.vertices.values()) {
      const faceIds = [...vertex.faceIds].filter(id => meshData.faces.has(id));
      if (faceIds.length === 0) continue;

      const localOf = new Map();
      faceIds.forEach((id, i) => localOf.set(id, i));
      const dsu = this._makeDSU(faceIds.length);

      for (const edgeId of vertex.edgeIds) {
        if (seamSet.has(edgeId)) continue;
        const edge = meshData.edges.get(edgeId);
        if (!edge) continue;

        let prev = -1;
        for (const faceId of edge.faceIds) {
          const li = localOf.get(faceId);
          if (li === undefined) continue;
          if (prev >= 0) dsu.union(prev, li);
          prev = li;
        }
      }

      const rootToWedge = new Map();
      for (const faceId of faceIds) {
        const root = dsu.find(localOf.get(faceId));
        let wedgeId = rootToWedge.get(root);
        if (wedgeId === undefined) {
          wedgeId = wedges.length;
          wedges.push({ vertexId: vertex.id });
          rootToWedge.set(root, wedgeId);
        }
        cornerWedge.set(`${faceId}|${vertex.id}`, wedgeId);
      }
    }

    return { wedges, cornerWedge };
  }

  /** Connected components of faces, crossing every edge except seams. */
  static _buildIslands(meshData, seamSet) {
    const faceIds = [...meshData.faces.keys()];
    const localOf = new Map();
    faceIds.forEach((id, i) => localOf.set(id, i));
    const dsu = this._makeDSU(faceIds.length);

    for (const edge of meshData.edges.values()) {
      if (seamSet.has(edge.id)) continue;

      let prev = -1;
      for (const faceId of edge.faceIds) {
        const li = localOf.get(faceId);
        if (li === undefined) continue;
        if (prev >= 0) dsu.union(prev, li);
        prev = li;
      }
    }

    const groups = new Map();
    faceIds.forEach((id, i) => {
      const root = dsu.find(i);
      let group = groups.get(root);
      if (!group) { group = []; groups.set(root, group); }
      group.push(id);
    });

    return [...groups.values()].map(faces => ({ faces }));
  }

  /**
   * Triangulates the island and builds its local wedge -> index mapping.
   *
   * Repeated corners inside a single face are folded away here (a face that
   * uses the same wedge twice contributes nothing but degenerate triangles),
   * while still registering every wedge so _writeUVs can resolve the face.
   * Also records the island's real polygon edges (`faceEdges`) with a use
   * count, so orientation can ignore triangulation diagonals.
   */
  static _buildIslandGeometry(island, meshData, cornerWedge) {
    const wedgeLocal = new Map();
    const positions = [];
    const tris = [];
    const edgeMap = new Map();
    let skipped = 0;

    for (const faceId of island.faces) {
      const face = meshData.faces.get(faceId);
      const verts = face.vertexIds.map(id => meshData.vertices.get(id));
      if (verts.some(v => !v)) { skipped++; continue; }

      const localIdx = [];
      const keptVerts = [];
      const seen = new Set();

      face.vertexIds.forEach((vId, slot) => {
        const wedgeId = cornerWedge.get(`${faceId}|${vId}`);
        let li = wedgeLocal.get(wedgeId);
        if (li === undefined) {
          li = positions.length;
          wedgeLocal.set(wedgeId, li);
          positions.push(verts[slot].position);
        }
        if (seen.has(li)) return;       // the face uses this wedge twice
        seen.add(li);
        localIdx.push(li);
        keptVerts.push(verts[slot]);
      });

      if (localIdx.length < 3) { skipped++; continue; }

      for (let k = 0; k < localIdx.length; k++) {
        const a = localIdx[k];
        const b = localIdx[(k + 1) % localIdx.length];
        if (a === b) continue;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const rec = edgeMap.get(key);
        if (rec) rec.count++;
        else edgeMap.set(key, { a, b, count: 1 });
      }

      const localTris = this._triangulateFace(keptVerts);
      for (let i = 0; i < localTris.length; i += 3) {
        tris.push(localIdx[localTris[i]], localIdx[localTris[i + 1]], localIdx[localTris[i + 2]]);
      }
    }

    island.wedgeLocal = wedgeLocal;
    island.positions = positions;
    island.tris = tris;
    island.faceEdges = [...edgeMap.values()];
    island.skippedFaces = skipped;
    island.diag = this._boundsDiagonal(positions);
    island.uv = new Float64Array(positions.length * 2);
  }

  /** Diagonal of the island's 3D bounds - the reference for every epsilon. */
  static _boundsDiagonal(positions) {
    if (positions.length === 0) return 0;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const p of positions) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

    const d = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
    return Number.isFinite(d) ? d : 0;
  }

  /** Newell normal - magnitude equals the polygon's area. */
  static _newellNormal(verts, out = new THREE.Vector3()) {
    out.set(0, 0, 0);
    const n = verts.length;

    for (let i = 0; i < n; i++) {
      const a = verts[i].position;
      const b = verts[(i + 1) % n].position;
      out.x += (a.y - b.y) * (a.z + b.z);
      out.y += (a.z - b.z) * (a.x + b.x);
      out.z += (a.x - b.x) * (a.y + b.y);
    }

    return out.multiplyScalar(0.5);
  }

  /**
   * LSCM builds every triangle's frame with y3 >= 0, so a triangle whose
   * indices are reversed relative to its neighbours cannot be satisfied except
   * by folding a shared vertex across the edge. Force the winding to agree
   * with the face normal before the solver ever sees it.
   */
  static _fixTriangleWinding(tris, verts, unitNormal) {
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const cross = new THREE.Vector3();

    for (let i = 0; i < tris.length; i += 3) {
      const a = verts[tris[i]].position;
      const b = verts[tris[i + 1]].position;
      const c = verts[tris[i + 2]].position;

      ab.subVectors(b, a);
      ac.subVectors(c, a);
      cross.crossVectors(ab, ac);

      if (cross.dot(unitNormal) < 0) {
        const t = tris[i + 1];
        tris[i + 1] = tris[i + 2];
        tris[i + 2] = t;
      }
    }

    return tris;
  }

  static _triangulateFace(verts) {
    const count = verts.length;
    if (count < 3) return [];
    if (count === 3) return [0, 1, 2];

    const fan = [];
    for (let i = 1; i < count - 1; i++) fan.push(0, i, i + 1);

    const normal = this._newellNormal(verts);
    const area = normal.length();

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();

    let perimeter = 0;
    for (let i = 0; i < count; i++) {
      perimeter += a.copy(verts[i].position).distanceTo(b.copy(verts[(i + 1) % count].position));
    }

    // Relative thinness test. An absolute epsilon lets a sliver through, and a
    // sliver's 2D projection self-intersects - earcut emits ears with mixed
    // winding for those. Fall back to the polygon-order fan instead.
    if (!(area > perimeter * perimeter * MIN_FACE_AREA_RATIO)) return fan;

    const planeNormal = computePlaneNormal(verts);
    if (!planeNormal || !Number.isFinite(planeNormal.x) || planeNormal.lengthSq() < 1e-24) return fan;

    const flat2D = projectTo2D(verts, planeNormal);
    if (!flat2D || flat2D.some(v => !Number.isFinite(v))) return fan;

    const tris = earcut(flat2D);
    if (tris.length < 3) return fan;

    // Covers both a mirrored projection (planeNormal sign is noise on a
    // near-degenerate face) and individually reversed ears.
    return this._fixTriangleWinding(tris, verts, normal.divideScalar(area));
  }

  // ------------------------------------------------------------------- LSCM

  static _parameterize(island, maxIterations) {
    const { positions, tris, uv } = island;

    const projected = this._projectToBestFitPlane(positions, tris);
    uv.set(projected);
    island.solved = false;

    if (positions.length < 3 || tris.length < 3) return;

    const prep = this._prepareTriangles(positions, tris, island.diag);
    island.touched = prep.touched;

    if (prep.triangles.length === 0) return;

    const pins = this._pickPins(projected, prep.touched);
    if (!pins) return;

    const solved = this._solveLSCM(positions, prep.triangles, pins, projected, maxIterations);
    if (solved && this._acceptSolution(solved, pins)) {
      uv.set(solved);
      island.solved = true;
    }

    this._repairUnconstrained(island);
    this._fixMirroring(island);
  }

  /**
   * Builds a per-triangle local frame and applies Blender's degeneracy policy:
   * clamp rather than discard. The base is the longest edge so the frame is as
   * well conditioned as the triangle allows, and the apex height is clamped so
   * a collinear triangle still constrains its apex onto the line instead of
   * leaving that wedge as an unconstrained free variable.
   */
  static _prepareTriangles(positions, tris, diag) {
    const minLen = Math.max(diag * 1e-9, 1e-15);
    const touched = new Uint8Array(positions.length);
    const raw = [];

    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();

    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const ex = new THREE.Vector3();
    const perp = new THREE.Vector3();

    let areaSum = 0;
    let areaCount = 0;

    for (let t = 0; t < tris.length; t += 3) {
      const i0 = tris[t], i1 = tris[t + 1], i2 = tris[t + 2];
      if (i0 === i1 || i1 === i2 || i0 === i2) continue;

      p0.copy(positions[i0]);
      p1.copy(positions[i1]);
      p2.copy(positions[i2]);

      const l0 = p0.distanceTo(p1);
      const l1 = p1.distanceTo(p2);
      const l2 = p2.distanceTo(p0);

      // Cyclic rotation keeps the winding while moving the longest edge to the base.
      let a = i0, b = i1, c = i2;
      if (l1 >= l0 && l1 >= l2) { a = i1; b = i2; c = i0; }
      else if (l2 >= l0 && l2 >= l1) { a = i2; b = i0; c = i1; }

      p0.copy(positions[a]);
      e1.subVectors(positions[b], p0);
      e2.subVectors(positions[c], p0);

      const x2 = e1.length();
      if (x2 < minLen) continue;              // the whole triangle is a point

      ex.copy(e1).divideScalar(x2);
      const x3 = e2.dot(ex);
      perp.copy(e2).addScaledVector(ex, -x3);

      let y3 = perp.length();
      const minHeight = x2 * MIN_ASPECT;
      const collinear = y3 < minHeight;
      if (collinear) y3 = minHeight;

      const area = 0.5 * x2 * y3;
      raw.push({ a, b, c, x2, x3, y3, area, weight: 0 });

      if (!collinear) { areaSum += area; areaCount++; }
      touched[a] = 1; touched[b] = 1; touched[c] = 1;
    }

    const refArea = areaCount > 0 ? areaSum / areaCount : 0;
    const floor = Math.max(diag * diag * 1e-14, 1e-24);
    const minArea = Math.max(refArea * MIN_AREA_RATIO, floor);

    for (const tri of raw) {
      tri.weight = 1 / Math.sqrt(Math.max(tri.area, minArea));
    }

    return { triangles: raw, touched };
  }

  static _projectToBestFitPlane(positions, tris) {
    const normal = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const cross = new THREE.Vector3();

    for (let i = 0; i < tris.length; i += 3) {
      const a = positions[tris[i]];
      const b = positions[tris[i + 1]];
      const c = positions[tris[i + 2]];
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      normal.add(cross.crossVectors(ab, ac));
    }

    if (normal.lengthSq() < EPS) normal.set(0, 0, 1);
    else normal.normalize();

    const ref = Math.abs(normal.z) < 0.9
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(1, 0, 0);

    const ex = new THREE.Vector3().crossVectors(ref, normal).normalize();
    const ey = new THREE.Vector3().crossVectors(normal, ex).normalize();

    const origin = positions[0];
    const out = new Float64Array(positions.length * 2);
    const d = new THREE.Vector3();

    for (let i = 0; i < positions.length; i++) {
      d.subVectors(positions[i], origin);
      out[i * 2] = d.dot(ex);
      out[i * 2 + 1] = d.dot(ey);
    }

    return out;
  }

  /**
   * Two far-apart vertices, pinned at their planar projection coordinates.
   * Only vertices touched by a usable triangle are eligible - pinning an
   * orphan from a dropped face anchors the whole solve to a stale coordinate.
   */
  static _pickPins(projected, touched) {
    const n = projected.length / 2;
    const usable = [];
    for (let i = 0; i < n; i++) if (!touched || touched[i]) usable.push(i);
    if (usable.length < 2) return null;

    let minU = usable[0], maxU = usable[0], minV = usable[0], maxV = usable[0];
    for (const i of usable) {
      if (projected[i * 2] < projected[minU * 2]) minU = i;
      if (projected[i * 2] > projected[maxU * 2]) maxU = i;
      if (projected[i * 2 + 1] < projected[minV * 2 + 1]) minV = i;
      if (projected[i * 2 + 1] > projected[maxV * 2 + 1]) maxV = i;
    }

    const candidates = [minU, maxU, minV, maxV];
    let best = null;
    let bestDist = -1;

    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i];
        const b = candidates[j];
        if (a === b) continue;
        const du = projected[a * 2] - projected[b * 2];
        const dv = projected[a * 2 + 1] - projected[b * 2 + 1];
        const dist = du * du + dv * dv;
        if (dist > bestDist) { bestDist = dist; best = [a, b]; }
      }
    }

    if (!best || bestDist < EPS) {
      return { a: usable[0], b: usable[1], au: 0, av: 0, bu: 1, bv: 0 };
    }

    const [a, b] = best;
    return {
      a, b,
      au: projected[a * 2], av: projected[a * 2 + 1],
      bu: projected[b * 2], bv: projected[b * 2 + 1],
    };
  }

  static _solveLSCM(positions, triangles, pins, initial, maxIterations) {
    const n = positions.length;

    const varOf = new Int32Array(n).fill(-1);
    let free = 0;
    for (let i = 0; i < n; i++) {
      if (i === pins.a || i === pins.b) continue;
      varOf[i] = free++;
    }
    if (free === 0) return null;

    const numVars = free * 2;
    const rowPtr = [0];
    const cols = [];
    const vals = [];
    const rhs = [];

    for (const tri of triangles) {
      const { x2, x3, y3, weight: s } = tri;
      const wx = [(x3 - x2) * s, -x3 * s, x2 * s];
      const wy = [y3 * s, -y3 * s, 0];
      const idx = [tri.a, tri.b, tri.c];

      // Real row and imaginary row of  sum_j W_j * U_j = 0
      const realCols = [], realVals = [];
      const imagCols = [], imagVals = [];
      let realRhs = 0;
      let imagRhs = 0;

      for (let j = 0; j < 3; j++) {
        const vi = idx[j];
        const v = varOf[vi];

        if (v >= 0) {
          realCols.push(v * 2, v * 2 + 1);
          realVals.push(wx[j], -wy[j]);
          imagCols.push(v * 2, v * 2 + 1);
          imagVals.push(wy[j], wx[j]);
        } else {
          const pu = vi === pins.a ? pins.au : pins.bu;
          const pv = vi === pins.a ? pins.av : pins.bv;
          realRhs -= wx[j] * pu - wy[j] * pv;
          imagRhs -= wy[j] * pu + wx[j] * pv;
        }
      }

      cols.push(...realCols); vals.push(...realVals); rhs.push(realRhs); rowPtr.push(cols.length);
      cols.push(...imagCols); vals.push(...imagVals); rhs.push(imagRhs); rowPtr.push(cols.length);
    }

    if (rhs.length === 0) return null;

    const x = new Float64Array(numVars);
    for (let i = 0; i < n; i++) {
      const v = varOf[i];
      if (v < 0) continue;
      x[v * 2] = initial[i * 2];
      x[v * 2 + 1] = initial[i * 2 + 1];
    }

    const iterations = maxIterations > 0 ? maxIterations : Math.min(numVars * 2 + 100, 4000);
    const ok = this._cgnr(
      new Int32Array(rowPtr), new Int32Array(cols), new Float64Array(vals),
      new Float64Array(rhs), numVars, x, iterations,
    );
    if (!ok) return null;

    const uv = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      if (i === pins.a) { uv[i * 2] = pins.au; uv[i * 2 + 1] = pins.av; continue; }
      if (i === pins.b) { uv[i * 2] = pins.bu; uv[i * 2 + 1] = pins.bv; continue; }
      const v = varOf[i];
      const u = x[v * 2];
      const w = x[v * 2 + 1];
      if (!Number.isFinite(u) || !Number.isFinite(w)) return null;
      uv[i * 2] = u;
      uv[i * 2 + 1] = w;
    }

    return uv;
  }

  /**
   * Rejects a solve that ran away. A near-singular system can converge to
   * coordinates orders of magnitude past the pin span, which surfaces as one
   * island swallowing the entire atlas.
   */
  static _acceptSolution(uv, pins) {
    const span = Math.hypot(pins.bu - pins.au, pins.bv - pins.av);
    const limit = (span > EPS ? span : 1) * 1e5;
    const cx = (pins.au + pins.bu) * 0.5;
    const cy = (pins.av + pins.bv) * 0.5;

    for (let i = 0; i < uv.length; i += 2) {
      const u = uv[i];
      const v = uv[i + 1];
      if (!Number.isFinite(u) || !Number.isFinite(v)) return false;
      if (Math.hypot(u - cx, v - cy) > limit) return false;
    }

    return true;
  }

  /**
   * Wedges that no usable triangle referenced are still sitting at their
   * best-fit-plane coordinate, which lives in a different frame from the LSCM
   * result - that mismatch is what made dropped faces overlap and blow up the
   * bounding box. Blender rebuilds collapsed vertices at the barycentre of
   * their neighbours; a few Laplacian sweeps over the real polygon edges do the
   * same, including for chains of adjacent degenerate faces.
   */
  static _repairUnconstrained(island) {
    const { uv, faceEdges, touched } = island;
    if (!touched) return;

    const n = uv.length / 2;
    let cx = 0, cy = 0, count = 0;
    for (let i = 0; i < n; i++) {
      if (!touched[i]) continue;
      cx += uv[i * 2];
      cy += uv[i * 2 + 1];
      count++;
    }

    if (count === n) return;
    if (count === 0) { uv.fill(0); return; }

    cx /= count;
    cy /= count;

    const adj = new Array(n);
    for (const e of faceEdges) {
      (adj[e.a] || (adj[e.a] = [])).push(e.b);
      (adj[e.b] || (adj[e.b] = [])).push(e.a);
    }

    for (let i = 0; i < n; i++) {
      if (touched[i]) continue;
      uv[i * 2] = cx;
      uv[i * 2 + 1] = cy;
    }

    for (let pass = 0; pass < 8; pass++) {
      for (let i = 0; i < n; i++) {
        if (touched[i]) continue;
        const nbr = adj[i];
        if (!nbr || nbr.length === 0) continue;

        let sx = 0, sy = 0;
        for (const j of nbr) { sx += uv[j * 2]; sy += uv[j * 2 + 1]; }
        uv[i * 2] = sx / nbr.length;
        uv[i * 2 + 1] = sy / nbr.length;
      }
    }
  }

  /** Conjugate gradient on the normal equations (A^T A x = A^T b). */
  static _cgnr(rowPtr, cols, vals, b, numVars, x, maxIter) {
    const numRows = b.length;
    const r = new Float64Array(numRows);
    const w = new Float64Array(numRows);
    const z = new Float64Array(numVars);
    const p = new Float64Array(numVars);

    const mul = (src, dst) => {
      for (let row = 0; row < numRows; row++) {
        let sum = 0;
        for (let k = rowPtr[row]; k < rowPtr[row + 1]; k++) sum += vals[k] * src[cols[k]];
        dst[row] = sum;
      }
    };

    const mulT = (src, dst) => {
      dst.fill(0);
      for (let row = 0; row < numRows; row++) {
        const rv = src[row];
        if (rv === 0) continue;
        for (let k = rowPtr[row]; k < rowPtr[row + 1]; k++) dst[cols[k]] += vals[k] * rv;
      }
    };

    mul(x, r);
    for (let i = 0; i < numRows; i++) r[i] = b[i] - r[i];

    mulT(r, z);
    p.set(z);

    let gamma = 0;
    for (let i = 0; i < numVars; i++) gamma += z[i] * z[i];
    const gamma0 = gamma;
    if (!Number.isFinite(gamma)) return false;
    if (gamma0 < 1e-30) return true;

    for (let iter = 0; iter < maxIter; iter++) {
      mul(p, w);

      let wDot = 0;
      for (let i = 0; i < numRows; i++) wDot += w[i] * w[i];
      if (wDot < 1e-30) break;

      const alpha = gamma / wDot;
      if (!Number.isFinite(alpha)) return false;

      for (let i = 0; i < numVars; i++) x[i] += alpha * p[i];
      for (let i = 0; i < numRows; i++) r[i] -= alpha * w[i];

      mulT(r, z);

      let newGamma = 0;
      for (let i = 0; i < numVars; i++) newGamma += z[i] * z[i];
      if (!Number.isFinite(newGamma)) return false;
      if (newGamma <= gamma0 * 1e-20) break;

      const beta = newGamma / gamma;
      for (let i = 0; i < numVars; i++) p[i] = z[i] + beta * p[i];
      gamma = newGamma;
    }

    for (let i = 0; i < numVars; i++) if (!Number.isFinite(x[i])) return false;
    return true;
  }

  /**
   * LSCM is defined up to a reflection - flip the island back if inverted.
   * Votes are weighted by 3D area, not UV area: a degenerate face has no
   * surface to speak for, and a sliver that landed with a large UV footprint
   * would otherwise outvote the rest of the island.
   */
  static _fixMirroring(island) {
    const { uv, tris, positions } = island;

    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const cross = new THREE.Vector3();
    let vote = 0;

    for (let t = 0; t < tris.length; t += 3) {
      const ia = tris[t], ib = tris[t + 1], ic = tris[t + 2];

      ab.subVectors(positions[ib], positions[ia]);
      ac.subVectors(positions[ic], positions[ia]);
      const area3D = 0.5 * cross.crossVectors(ab, ac).length();
      if (area3D <= EPS) continue;

      const a = ia * 2, b = ib * 2, c = ic * 2;
      const signed = (uv[b] - uv[a]) * (uv[c + 1] - uv[a + 1])
                   - (uv[c] - uv[a]) * (uv[b + 1] - uv[a + 1]);

      if (signed > 0) vote += area3D;
      else if (signed < 0) vote -= area3D;
    }

    if (vote < 0) {
      for (let i = 0; i < uv.length; i += 2) uv[i] = -uv[i];
    }
  }

  // -------------------------------------------------------------- orientation

  static _rotateUV(uv, angle) {
    if (Math.abs(angle) < 1e-9) return;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    for (let i = 0; i < uv.length; i += 2) {
      const u = uv[i];
      const v = uv[i + 1];
      uv[i] = u * c - v * s;
      uv[i + 1] = u * s + v * c;
    }
  }

  /** Translates the island so its bounding box starts at the origin. */
  static _rezero(uv) {
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (let i = 0; i < uv.length; i += 2) {
      if (uv[i] < minU) minU = uv[i];
      if (uv[i] > maxU) maxU = uv[i];
      if (uv[i + 1] < minV) minV = uv[i + 1];
      if (uv[i + 1] > maxV) maxV = uv[i + 1];
    }

    if (!Number.isFinite(minU)) return { width: 1e-6, height: 1e-6 };

    for (let i = 0; i < uv.length; i += 2) {
      uv[i] -= minU;
      uv[i + 1] -= minV;
    }

    return {
      width: Math.max(maxU - minU, 1e-6),
      height: Math.max(maxV - minV, 1e-6),
    };
  }

  /** Monotone chain hull over the island's UV points. Returns point indices. */
  static _convexHull(uv) {
    const n = uv.length / 2;
    if (n < 3) return [];

    const idx = new Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    idx.sort((a, b) => (uv[a * 2] - uv[b * 2]) || (uv[a * 2 + 1] - uv[b * 2 + 1]));

    const cross = (o, a, b) =>
      (uv[a * 2] - uv[o * 2]) * (uv[b * 2 + 1] - uv[o * 2 + 1]) -
      (uv[a * 2 + 1] - uv[o * 2 + 1]) * (uv[b * 2] - uv[o * 2]);

    const chain = (order) => {
      const stack = [];
      for (const i of order) {
        while (stack.length >= 2 &&
               cross(stack[stack.length - 2], stack[stack.length - 1], i) <= 0) stack.pop();
        stack.push(i);
      }
      stack.pop();
      return stack;
    };

    const lower = chain(idx);
    const upper = chain([...idx].reverse());
    return lower.concat(upper);
  }

  /**
   * Rotating calipers over the hull: returns the angle the island must be
   * rotated by so that its minimum-area bounding rectangle is axis aligned.
   */
  static _minAreaRectAngle(uv, hull) {
    let bestArea = Infinity;
    let bestAngle = 0;

    for (let i = 0; i < hull.length; i++) {
      const a = hull[i];
      const b = hull[(i + 1) % hull.length];
      const dx = uv[b * 2] - uv[a * 2];
      const dy = uv[b * 2 + 1] - uv[a * 2 + 1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-12) continue;

      const c = dx / len;
      const s = dy / len;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

      for (const h of hull) {
        const x = uv[h * 2] * c + uv[h * 2 + 1] * s;
        const y = -uv[h * 2] * s + uv[h * 2 + 1] * c;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      const area = (maxX - minX) * (maxY - minY);
      if (area < bestArea) {
        bestArea = area;
        bestAngle = Math.atan2(s, c);
      }
    }

    return -bestAngle;
  }

  /** Area of the island's bounding box after rotating by `angle`. */
  static _hullBoxArea(uv, hull, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (const h of hull) {
      const x = uv[h * 2] * c - uv[h * 2 + 1] * s;
      const y = uv[h * 2] * s + uv[h * 2 + 1] * c;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    return Math.max(maxX - minX, 1e-9) * Math.max(maxY - minY, 1e-9);
  }

  /**
   * Length-weighted histogram of *polygon* edge directions modulo 90 degrees,
   * refined to sub-bin precision with a doubled-angle circular mean.
   *
   * Triangulation diagonals are deliberately excluded: they are an artefact of
   * _triangulateFace, they get counted twice (once per triangle of a quad), and
   * on a tall cylinder they carry as much length as the real rails - which is
   * what tilted those islands by a few degrees.
   */
  static _dominantEdgeAngle(island, threshold = 0.30, boundaryWeight = 2) {
    const { uv, faceEdges } = island;
    if (!faceEdges || faceEdges.length === 0) return null;

    const SPAN = Math.PI / 2;
    const BINS = 360;                       // 0.25 degree buckets across 90
    const bins = new Float64Array(BINS);
    const samples = [];                     // [angle, weight, ...]
    let total = 0;

    for (const e of faceEdges) {
      const dx = uv[e.b * 2] - uv[e.a * 2];
      const dy = uv[e.b * 2 + 1] - uv[e.a * 2 + 1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-12) continue;

      const weight = len * (e.count === 1 ? boundaryWeight : 1);
      let angle = Math.atan2(dy, dx) % SPAN;
      if (angle < 0) angle += SPAN;

      bins[Math.min(BINS - 1, (angle / SPAN * BINS) | 0)] += weight;
      samples.push(angle, weight);
      total += weight;
    }

    if (total < 1e-12) return null;

    let best = 0;
    let bestWeight = -1;
    for (let i = 0; i < BINS; i++) {
      const weight = bins[(i - 1 + BINS) % BINS] + bins[i] + bins[(i + 1) % BINS];
      if (weight > bestWeight) { bestWeight = weight; best = i; }
    }

    if (bestWeight / total < threshold) return null;

    // Refine inside the winning window so the answer is not quantised to a bin.
    const center = ((best + 0.5) / BINS) * SPAN;
    const half = (2.5 / BINS) * SPAN;
    let cx = 0, cy = 0, wsum = 0;

    for (let i = 0; i < samples.length; i += 2) {
      const angle = samples[i];
      let delta = angle - center;
      delta -= SPAN * Math.round(delta / SPAN);
      if (Math.abs(delta) > half) continue;

      const weight = samples[i + 1];
      cx += weight * Math.cos(4 * angle);   // 4x keeps the 90 degree period
      cy += weight * Math.sin(4 * angle);
      wsum += weight;
    }

    if (wsum <= 0 || (cx * cx + cy * cy) < 1e-24) return center;

    const mean = Math.atan2(cy, cx) / 4;
    let delta = mean - center;
    delta -= SPAN * Math.round(delta / SPAN);
    return center + delta;
  }

  /**
   * Axis alignment only pins the island to a 90 degree lattice - which of the
   * four rotations you land on is arbitrary. Correlating UV-up against world-up
   * makes cylinders and other extrusions come out standing rather than lying
   * down, which is what makes the result feel like Blender's.
   */
  static _resolveQuadrant(island, coherence = 0.30) {
    const { uv, positions, faceEdges } = island;
    if (!faceEdges || faceEdges.length === 0) return;

    let ax = 0, ay = 0, mag = 0;

    for (const e of faceEdges) {
      const up = positions[e.b].y - positions[e.a].y;
      if (Math.abs(up) < 1e-12) continue;

      const dx = uv[e.b * 2] - uv[e.a * 2];
      const dy = uv[e.b * 2 + 1] - uv[e.a * 2 + 1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-12) continue;

      // Direction-invariant: reversing the edge flips both `up` and (dx, dy).
      const s = up / len;
      ax += dx * s;
      ay += dy * s;
      mag += Math.abs(up);
    }

    if (mag < 1e-12) return;
    if (Math.hypot(ax, ay) / mag < coherence) return;

    const phi = Math.atan2(ay, ax);
    const k = Math.round((Math.PI / 2 - phi) / (Math.PI / 2));
    if (((k % 4) + 4) % 4 !== 0) this._rotateUV(uv, k * Math.PI / 2);
  }

  /**
   * Rotates the island in place into a sensible orientation. Without this the
   * island keeps whatever arbitrary rotation LSCM produced, so a diagonal
   * strip gets a near-square bounding box and packs terribly.
   */
  static _orientIsland(island, rotateMethod, alignToWorldUp) {
    if (rotateMethod === 'none') return;

    const { uv } = island;
    if (uv.length < 6) return;

    const hull = this._convexHull(uv);

    const edgeAngle = (rotateMethod === 'auto' || rotateMethod === 'axis')
      ? this._dominantEdgeAngle(island)
      : null;

    const rectAngle = (rotateMethod !== 'axis' && hull.length >= 3)
      ? this._minAreaRectAngle(uv, hull)
      : null;

    let angle = edgeAngle !== null ? -edgeAngle : null;

    // Prefer the edge grain, but fall back to the calipers result when it gives
    // a meaningfully tighter box - organic islands have no grain to snap to.
    if (angle !== null && rectAngle !== null && hull.length >= 3) {
      const edgeArea = this._hullBoxArea(uv, hull, angle);
      const rectArea = this._hullBoxArea(uv, hull, rectAngle);
      if (rectArea < edgeArea * 0.92) angle = rectAngle;
    }

    if (angle === null) angle = rectAngle;
    if (angle === null) return;

    this._rotateUV(uv, angle);
    if (alignToWorldUp && rotateMethod !== 'minarea') this._resolveQuadrant(island);
  }

  // ------------------------------------------------------- scale and packing

  static _normalizeIsland(island, preserveScale, rotateMethod = 'auto', alignToWorldUp = true) {
    const { tris, positions, uv } = island;

    for (let i = 0; i < uv.length; i++) if (!Number.isFinite(uv[i])) uv[i] = 0;

    // Orientation first - the bounding box is only meaningful afterwards.
    this._orientIsland(island, rotateMethod, alignToWorldUp);

    let area3D = 0;
    let areaUV = 0;
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const cross = new THREE.Vector3();

    for (let t = 0; t < tris.length; t += 3) {
      const ia = tris[t], ib = tris[t + 1], ic = tris[t + 2];
      ab.subVectors(positions[ib], positions[ia]);
      ac.subVectors(positions[ic], positions[ia]);
      area3D += 0.5 * cross.crossVectors(ab, ac).length();

      const a = ia * 2, b = ib * 2, c = ic * 2;
      areaUV += Math.abs(
        (uv[b] - uv[a]) * (uv[c + 1] - uv[a + 1]) -
        (uv[c] - uv[a]) * (uv[b + 1] - uv[a + 1])
      ) * 0.5;
    }

    island.area3D = area3D;

    // An island with no surface area gets no atlas space - it would otherwise
    // reserve room for geometry that renders nothing.
    island.degenerate = !(area3D > EPS);

    let scale = 1;
    if (preserveScale && areaUV > EPS && area3D > EPS) {
      scale = Math.sqrt(area3D / areaUV);
    }
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;

    if (scale !== 1) {
      for (let i = 0; i < uv.length; i++) uv[i] *= scale;
    }

    const bounds = this._rezero(uv);
    island.width = bounds.width;
    island.height = bounds.height;

    if (!Number.isFinite(island.width) || !Number.isFinite(island.height)) {
      island.degenerate = true;
    }
  }

  /**
   * Bottom-left skyline placement. `nodes` is a list of {x, y, w} segments
   * sorted by x that together span [0, binSize]. Returns the lowest position
   * where a w x h box fits, or null.
   */
  static _skylineFit(nodes, w, h, binSize) {
    let best = null;

    for (let i = 0; i < nodes.length; i++) {
      const x = nodes[i].x;
      if (x + w > binSize + 1e-12) break;

      let y = nodes[i].y;
      let left = w;
      let j = i;
      let fits = true;

      while (left > 1e-12) {
        if (j >= nodes.length) { fits = false; break; }
        if (nodes[j].y > y) y = nodes[j].y;
        if (y + h > binSize + 1e-12) { fits = false; break; }
        left -= nodes[j].w;
        j++;
      }

      if (!fits) continue;

      if (!best || y < best.y - 1e-12 || (Math.abs(y - best.y) <= 1e-12 && x < best.x)) {
        best = { x, y };
      }
    }

    return best;
  }

  static _skylineAdd(nodes, x, y, w, h) {
    let i = 0;
    while (i < nodes.length && nodes[i].x < x - 1e-12) i++;
    nodes.splice(i, 0, { x, y: y + h, w });

    // Clip the segments the new node now covers.
    const right = x + w;
    for (let j = i + 1; j < nodes.length; j++) {
      const node = nodes[j];
      if (node.x >= right - 1e-12) break;

      const shrink = right - node.x;
      if (node.w - shrink <= 1e-12) {
        nodes.splice(j, 1);
        j--;
      } else {
        node.x += shrink;
        node.w -= shrink;
        break;
      }
    }

    // Merge neighbours at the same height.
    for (let j = 0; j < nodes.length - 1; j++) {
      if (Math.abs(nodes[j].y - nodes[j + 1].y) < 1e-12) {
        nodes[j].w += nodes[j + 1].w;
        nodes.splice(j + 1, 1);
        j--;
      }
    }
  }

  /**
   * Skyline packing with 90 degree rotation, over a binary search on the bin
   * size so the atlas is fitted rather than guessed at. Degenerate islands are
   * collapsed to a point and excluded - one runaway box used to drive the
   * search bound up and squeeze every real island to nothing.
   */
  static _packIslands(islands, margin) {
    const active = [];

    for (const island of islands) {
      if (island.degenerate) {
        island.uv.fill(margin);
        island.offsetX = margin;
        island.offsetY = margin;
        island.width = 0;
        island.height = 0;
        continue;
      }
      active.push(island);
    }

    if (active.length === 0) return;

    const boxes = active.map(island => ({ island, w: island.width, h: island.height }));

    let totalArea = 0;
    let maxSide = 0;
    for (const box of boxes) {
      totalArea += box.w * box.h;
      maxSide = Math.max(maxSide, box.w, box.h);
    }

    const pad = Math.sqrt(Math.max(totalArea, EPS)) * Math.max(margin, 0) * 2;

    const order = [...boxes].sort((a, b) =>
      (Math.max(b.w, b.h) - Math.max(a.w, a.h)) || (b.w * b.h - a.w * a.h));

    const attempt = (binSize) => {
      const nodes = [{ x: 0, y: 0, w: binSize }];
      const placed = [];

      for (const box of order) {
        const w = box.w + pad;
        const h = box.h + pad;

        let fit = this._skylineFit(nodes, w, h, binSize);
        let rotated = false;

        if (Math.abs(w - h) > 1e-12) {
          const alt = this._skylineFit(nodes, h, w, binSize);
          if (alt && (!fit || alt.y < fit.y - 1e-12 ||
                     (Math.abs(alt.y - fit.y) <= 1e-12 && alt.x < fit.x))) {
            fit = alt;
            rotated = true;
          }
        }

        if (!fit) return null;

        this._skylineAdd(nodes, fit.x, fit.y, rotated ? h : w, rotated ? w : h);
        placed.push({ box, x: fit.x, y: fit.y, rotated });
      }

      return placed;
    };

    let lo = Math.max(Math.sqrt(Math.max(totalArea, EPS)), maxSide + pad);
    let hi = lo;
    let placed = attempt(hi);

    for (let guard = 0; !placed && guard < 60; guard++) {
      lo = hi;
      hi *= 1.25;
      placed = attempt(hi);
    }

    if (!placed) return;

    for (let i = 0; i < 14 && hi - lo > hi * 1e-3; i++) {
      const mid = (lo + hi) * 0.5;
      const result = attempt(mid);
      if (result) { hi = mid; placed = result; } else { lo = mid; }
    }

    // Apply rotation, then measure the extent actually used so the atlas is
    // scaled to the real content rather than to the search bound.
    let extent = EPS;
    for (const entry of placed) {
      const { box } = entry;
      if (entry.rotated) {
        this._rotateUV(box.island.uv, Math.PI / 2);
        const bounds = this._rezero(box.island.uv);
        box.w = bounds.width;
        box.h = bounds.height;
      }
      extent = Math.max(extent, entry.x + box.w, entry.y + box.h);
    }

    const scale = (1 - 2 * margin) / extent;

    for (const entry of placed) {
      const island = entry.box.island;
      const { uv } = island;

      for (let i = 0; i < uv.length; i += 2) {
        uv[i] = margin + (uv[i] + entry.x) * scale;
        uv[i + 1] = margin + (uv[i + 1] + entry.y) * scale;
      }

      island.offsetX = entry.x * scale + margin;
      island.offsetY = entry.y * scale + margin;
      island.width = entry.box.w * scale;
      island.height = entry.box.h * scale;
    }
  }

  // ----------------------------------------------------------------- output

  static _writeUVs(meshData, islands, cornerWedge) {
    meshData.uvs.clear();

    for (const island of islands) {
      const { uv, wedgeLocal } = island;

      for (const faceId of island.faces) {
        const face = meshData.faces.get(faceId);
        if (!face) continue;

        const corners = face.vertexIds.map((vId) => {
          const wedgeId = cornerWedge.get(`${faceId}|${vId}`);
          const li = wedgeLocal.get(wedgeId);
          if (li === undefined) return null;
          return {
            u: this._clamp01(uv[li * 2]),
            v: this._clamp01(uv[li * 2 + 1]),
          };
        });

        // A corner with no wedge (broken topology) collapses onto a sibling
        // corner rather than snapping to the atlas origin.
        const anchor = corners.find(c => c !== null);
        meshData.uvs.set(
          faceId,
          corners.map(c => (c || (anchor ? { ...anchor } : { u: 0, v: 0 }))),
        );
      }
    }

    for (const face of meshData.faces.values()) {
      if (!meshData.uvs.has(face.id)) {
        meshData.uvs.set(face.id, face.vertexIds.map(() => ({ u: 0, v: 0 })));
      }
    }
  }

  static _clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return value < 0 ? 0 : (value > 1 ? 1 : value);
  }
}