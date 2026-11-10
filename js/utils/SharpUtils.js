import * as THREE from 'three';
import { computePlaneNormal } from '../geometry/TriangulationUtils.js';

const SAME_NORMAL_DOT = 0.9999;
const ANGLE_EPS = 1e-3;
const DEFAULT_PREFERRED_ANGLES = [60, 30];

export class SharpUtils {
  // ---------- Object-level sharp IDs ----------

  static getSharpIds(object) {
    const sharps = object?.userData?.sharp;
    if (!sharps) return null;

    const raw = sharps instanceof Set ? sharps : new Set(sharps);

    const meshData = object?.userData?.meshData;
    if (!meshData) return raw;

    const live = new Set();
    for (const id of raw) {
      if (meshData.edges.has(id)) live.add(id);
    }
    return live;
  }

  static normalizeSharp(sharp) {
    if (sharp instanceof Set) return sharp;
    if (Array.isArray(sharp)) return new Set(sharp);
    return new Set();
  }

  static splitSharps(object, edgeIdMap, remainingMeshData) {
    const source = SharpUtils.normalizeSharp(object.userData.sharp);

    const separated = new Set();
    const remaining = new Set();

    for (const oldId of source) {
      const newId = edgeIdMap.get(oldId);
      if (newId !== undefined) separated.add(newId);

      if (remainingMeshData.edges.has(oldId)) remaining.add(oldId);
    }

    return { separated, remaining };
  }

  static mergeSharps(objects, maps) {
    const merged = new Set();

    objects.forEach((object, i) => {
      const edgeIdMap = maps[i]?.edgeIdMap;
      if (!edgeIdMap) return;

      for (const oldId of SharpUtils.normalizeSharp(object.userData.sharp)) {
        const newId = edgeIdMap.get(oldId);
        if (newId !== undefined) merged.add(newId);
      }
    });

    return merged;
  }

  // ---------- Render-side sharp edge helpers ----------

  static edgeKey(a, b) {
    return a < b ? `${a}_${b}` : `${b}_${a}`;
  }

  static buildSharpKeyMap(meshData, sharps) {
    const map = new Map();
    if (!sharps) return map;
    for (const edgeId of sharps) {
      const edge = meshData.edges?.get(edgeId);
      if (!edge) continue;
      const a = edge.v1Id;
      const b = edge.v2Id;
      map.set(SharpUtils.edgeKey(a, b), [a, b]);
    }
    return map;
  }

  static setSharps(meshData, renderBuffer, sharps) {
    renderBuffer.sharpKeys = SharpUtils.buildSharpKeyMap(meshData, sharps);
    return renderBuffer.sharpKeys;
  }

  static getSharpKeys(renderBuffer) {
    if (!renderBuffer.sharpKeys) renderBuffer.sharpKeys = new Map();
    return renderBuffer.sharpKeys;
  }

  static getSharpVertices(renderBuffer) {
    const keys = SharpUtils.getSharpKeys(renderBuffer);
    if (renderBuffer._sharpVerticesSource !== keys) {
      const set = new Set();
      for (const [a, b] of keys.values()) { set.add(a); set.add(b); }
      renderBuffer.sharpVertices = set;
      renderBuffer._sharpVerticesSource = keys;
    }
    return renderBuffer.sharpVertices;
  }

  static diffSharpVertices(oldKeys, newKeys) {
    const affected = new Set();
    for (const [key, [a, b]] of newKeys) {
      if (!oldKeys.has(key)) { affected.add(a); affected.add(b); }
    }
    for (const [key, [a, b]] of oldKeys) {
      if (!newKeys.has(key)) { affected.add(a); affected.add(b); }
    }
    return affected;
  }

  // ---------- Import: rebuild shading + sharps from corner normals ----------

  static detectSharps(meshData, faceInfo, { preferredAngles = DEFAULT_PREFERRED_ANGLES } = {}) {
    const defaultAngle = preferredAngles[0];

    let anySmooth = false;
    for (const info of faceInfo.values()) {
      if (info.smooth || [...info.normals.values()].some(Boolean)) { anySmooth = true; break; }
    }
    if (!anySmooth) return { shading: 'flat', angle: defaultAngle, sharps: [] };

    const faceNormals = new Map();
    const getFaceNormal = (fId) => {
      let n = faceNormals.get(fId);
      if (!n) {
        const verts = meshData.faces.get(fId).vertexIds.map(id => meshData.vertices.get(id));
        n = computePlaneNormal(verts);
        faceNormals.set(fId, n);
      }
      return n;
    };

    const splits = []; // { edgeId, angle: smallest dihedral between its faces }
    let maxSmooth = 0; // largest dihedral any smooth edge spans
    let interiorEdges = 0;

    for (const [edgeId, edge] of meshData.edges) {
      const faceIds = [...edge.faceIds].filter(fId => faceInfo.has(fId));
      if (faceIds.length < 2) continue;
      interiorEdges++;

      const { min, max } = this._dihedralRange(faceIds, getFaceNormal);

      if (this._isSharpEdge(edge, faceIds, faceInfo)) {
        splits.push({ edgeId, angle: min });
      } else if (max > maxSmooth) {
        maxSmooth = max;
      }
    }

    if (splits.length === 0) {
      return { shading: 'smooth', angle: defaultAngle, sharps: [] };
    }
    if (splits.length === interiorEdges) {
      return { shading: 'flat', angle: defaultAngle, sharps: [] };
    }

    // Valid auto angles: [lo, hi). Anything >= lo keeps every smooth edge smooth;
    // staying below hi lets the angle (not a sharp) split every edge steeper than maxSmooth.
    const lo = maxSmooth + ANGLE_EPS;
    let hi = Infinity;
    for (const { angle } of splits) {
      if (angle > lo && angle < hi) hi = angle;
    }

    if (hi === Infinity) {
      // Every split edge is shallower than some smooth edge: a threshold can't help.
      return { shading: 'smooth', angle: defaultAngle, sharps: splits.map(s => s.edgeId) };
    }

    const angle = this._pickAngle(lo, hi, preferredAngles);
    const sharps = splits.filter(s => s.angle <= angle).map(s => s.edgeId);

    return { shading: 'auto', angle, sharps };
  }

  // Prefer a familiar angle (60, 30) if it fits, then a whole degree, then the midpoint.
  static _pickAngle(lo, hi, preferredAngles) {
    const limit = hi - ANGLE_EPS;
    for (const a of preferredAngles) {
      if (a >= lo && a < limit) return a;
    }
    const whole = Math.ceil(lo);
    if (whole < limit) return whole;
    return (lo + hi) / 2;
  }

  // Min/max angle (degrees) between face normals across an edge (pairwise for non-manifold edges)
  static _dihedralRange(faceIds, getFaceNormal) {
    let min = Infinity, max = 0;
    for (let a = 0; a < faceIds.length; a++) {
      for (let b = a + 1; b < faceIds.length; b++) {
        const deg = getFaceNormal(faceIds[a]).angleTo(getFaceNormal(faceIds[b])) * THREE.MathUtils.RAD2DEG;
        if (deg < min) min = deg;
        if (deg > max) max = deg;
      }
    }
    return { min, max };
  }

  static _isSharpEdge(edge, faceIds, faceInfo) {
    for (let a = 0; a < faceIds.length; a++) {
      for (let b = a + 1; b < faceIds.length; b++) {
        const A = faceInfo.get(faceIds[a]);
        const B = faceInfo.get(faceIds[b]);

        let compared = false;
        for (const vId of [edge.v1Id, edge.v2Id]) {
          const nA = A.normals.get(vId);
          const nB = B.normals.get(vId);
          if (!nA || !nB) continue;
          compared = true;
          if (nA !== nB && nA.dot(nB) < SAME_NORMAL_DOT) return true;
        }
        if (compared) continue;

        if (!A.smooth || !B.smooth) return true;
        if (A.group !== B.group) return true;
      }
    }
    return false;
  }
}