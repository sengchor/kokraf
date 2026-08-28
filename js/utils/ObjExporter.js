import * as THREE from 'three';
import { computePerVertexNormals, computeFaceNormals, computeVertexNormalsWithAngle } from '../geometry/NormalCalculator.js';

const f6 = (n) => Number(n).toFixed(6);
const f4 = (n) => Number(n === 0 ? 0 : n).toFixed(4);

export function buildObj(objects, { autoSmoothAngle = 60 } = {}) {
  const lines = ['# Kokraf OBJ File', '# https://kokraf.com'];

  let totalVerts = 0;
  let totalUVs = 0;
  let totalNormals = 0;

  const globalNormals = new Map();
  let contextSmooth = null;

  for (const object of objects) {
    const meshData = object.userData?.meshData;
    if (!meshData || !meshData.vertices || !meshData.faces) continue;

    const shading = object.userData.shading || 'flat';
    const smooth = shading === 'smooth' || shading === 'auto';

    object.updateWorldMatrix(true, false);
    const world = object.matrixWorld;
    const normalMatrix = new THREE.Matrix3()
      .setFromMatrix4(world)
      .invert()
      .transpose();
    const mirrored = world.determinant() < 0;

    lines.push(`o ${object.name || object.uuid}`);

    // ---- v ------------------------------------------------------------
    const vertexIdToIndex = new Map();
    const p = new THREE.Vector3();
    for (const v of meshData.vertices.values()) {
      p.set(v.position.x, v.position.y, v.position.z).applyMatrix4(world);
      lines.push(`v ${f6(p.x)} ${f6(p.y)} ${f6(p.z)}`);
      vertexIdToIndex.set(v.id, ++totalVerts);
    }

    const faces = [];
    for (const face of meshData.faces.values()) {
      if (!face.vertexIds || face.vertexIds.length < 3) continue;
      const slots = face.vertexIds.map((_, i) => i);
      if (mirrored) slots.reverse();
      faces.push({ face, slots });
    }

    // ---- vt -----------------------------------------------------------
    const hasUVs = meshData.uvs && meshData.uvs.size > 0;
    const faceUVIndices = new Map();
    if (hasUVs) {
      const uvDict = new Map();
      let uvUniqueCount = 0;

      for (const { face, slots } of faces) {
        const faceUVs = meshData.uvs.get(face.id);
        const idxs = [];
        for (const slot of slots) {
          const uv = faceUVs ? faceUVs[slot] : null;
          const u = uv ? uv.u : 0;
          const v = uv ? uv.v : 0;
          const key = `${face.vertexIds[slot]}|${f4(u)}|${f4(v)}`;
          let idx = uvDict.get(key);
          if (idx === undefined) {
            idx = uvUniqueCount++;
            uvDict.set(key, idx);
            lines.push(`vt ${f6(u)} ${f6(v)}`);
          }
          idxs.push(totalUVs + idx + 1);
        }
        faceUVIndices.set(face.id, idxs);
      }
      totalUVs += uvUniqueCount;
    }

    // ---- vn -----------------------------------------------------------
    let lookup = null;
    if (shading === 'smooth') lookup = computePerVertexNormals(meshData);
    else if (shading === 'flat') lookup = computeFaceNormals(meshData);
    else if (shading === 'auto') lookup = computeVertexNormalsWithAngle(meshData, autoSmoothAngle);

    const localNormal = (face, vId) => {
      if (!lookup) return null;
      if (shading === 'flat') return lookup.get(face.id);
      if (shading === 'smooth') return lookup.get(vId);
      return lookup.get(`${face.id}_${vId}`);
    };

    const faceNormalIndices = new Map();
    if (lookup) {
      const n = new THREE.Vector3();
      for (const { face, slots } of faces) {
        const idxs = [];
        for (const slot of slots) {
          const local = localNormal(face, face.vertexIds[slot]);
          if (!local) {
            idxs.push(null);
            continue;
          }
          n.copy(local).applyMatrix3(normalMatrix).normalize();
          const x = f4(n.x), y = f4(n.y), z = f4(n.z);
          const key = `${x}|${y}|${z}`;
          let idx = globalNormals.get(key);
          if (idx === undefined) {
            idx = totalNormals++;
            globalNormals.set(key, idx);
            lines.push(`vn ${x} ${y} ${z}`);
          }
          idxs.push(idx + 1);
        }
        faceNormalIndices.set(face.id, idxs);
      }
    }

    // ---- s ------------------------------------------------------------
    if (contextSmooth !== smooth) {
      lines.push(smooth ? 's 1' : 's off');
      contextSmooth = smooth;
    }

    // ---- f ------------------------------------------------------------
    for (const { face, slots } of faces) {
      const uvIdxs = faceUVIndices.get(face.id);
      const nIdxs = faceNormalIndices.get(face.id);

      let line = 'f';
      for (let i = 0; i < slots.length; i++) {
        const vIdx = vertexIdToIndex.get(face.vertexIds[slots[i]]);
        if (vIdx === undefined) continue;
        const uvIdx = uvIdxs ? uvIdxs[i] : null;
        const nIdx = nIdxs ? nIdxs[i] : null;

        if (uvIdx != null && nIdx != null) line += ` ${vIdx}/${uvIdx}/${nIdx}`;
        else if (uvIdx != null) line += ` ${vIdx}/${uvIdx}`;
        else if (nIdx != null) line += ` ${vIdx}//${nIdx}`;
        else line += ` ${vIdx}`;
      }
      lines.push(line);
    }
  }

  return lines.join('\n') + '\n';
}