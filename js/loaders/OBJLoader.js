import * as THREE from 'three';
import { MeshData } from '../core/MeshData.js';

const parseIndex = (token, count) => {
  const i = parseInt(token, 10);
  if (!Number.isFinite(i) || i === 0) return null;
  return i > 0 ? i - 1 : count + i;
};

export default class OBJLoader {
  static fromOBJText(objText) {
    const globalPositions = [];
    const globalUVs = [];
    const globalNormals = [];

    const objects = [];
    let current = null;
    let sawObject = false;
    let smooth = false;

    const makeCurrent = (name) => ({
      name,
      faces: [],
      shading: smooth ? 'smooth' : 'flat',
    });

    const pushCurrent = () => {
      if (current && current.faces.length > 0) objects.push(current);
      current = null;
    };

    const lines = objText.replace(/\\\r?\n/g, ' ').split(/\r?\n/);

    for (const raw of lines) {
      const trimmed = raw.trim();
      if (!trimmed || trimmed[0] === '#') continue;

      const parts = trimmed.split(/\s+/);
      const keyword = parts[0];

      switch (keyword) {
        case 'o':
        case 'g': {
          if (keyword === 'o') sawObject = true;
          else if (sawObject) break;

          const name = parts.slice(1).join(' ');
          if (name === '' || name === 'default') break;
          pushCurrent();
          current = makeCurrent(name);
          break;
        }

        case 'v': {
          const x = parseFloat(parts[1]);
          const y = parseFloat(parts[2]);
          const z = parseFloat(parts[3]);
          globalPositions.push(
            isFinite(x) && isFinite(y) && isFinite(z)
              ? new THREE.Vector3(x, y, z)
              : null
          );
          break;
        }

        case 'vt': {
          const u = parseFloat(parts[1]);
          const v = parts.length >= 3 ? parseFloat(parts[2]) : 0;
          globalUVs.push(
            isFinite(u) && isFinite(v) ? { u, v } : null
          );
          break;
        }

        case 'vn': {
          const x = parseFloat(parts[1]);
          const y = parseFloat(parts[2]);
          const z = parseFloat(parts[3]);
          globalNormals.push(
            isFinite(x) && isFinite(y) && isFinite(z) ? { x, y, z } : null
          );
          break;
        }

        case 's': {
          const arg = (parts[1] || '').toLowerCase();
          smooth = !(arg === 'off' || arg === '0' || arg === '');
          if (current) current.shading = smooth ? 'smooth' : 'flat';
          break;
        }

        case 'f': {
          if (!current) current = makeCurrent('unnamed');
          
          const corners = [];
          for (let i = 1; i < parts.length; i++) {
            const segs = parts[i].split('/');
            const vIdx = parseIndex(segs[0], globalPositions.length);
            if (vIdx === null) continue;
            const vtIdx = (segs.length >= 2 && segs[1] !== '')
              ? parseIndex(segs[1], globalUVs.length) : null;
            const vnIdx = (segs.length >= 3 && segs[2] !== '')
              ? parseIndex(segs[2], globalNormals.length) : null;
            corners.push({ vIdx, vtIdx, vnIdx });
          }

          if (corners.length >= 3) current.faces.push(corners);
          break;
        }
      }
    }
    pushCurrent();

    return objects.map(({ name, faces, shading }) => {
      let mode = shading;
      if (mode === 'smooth') {
        const perVertex = new Map();
        let split = false;

        outer:
        for (const corners of faces) {
          for (const c of corners) {
            if (c.vnIdx === null || !globalNormals[c.vnIdx]) continue;
            const prev = perVertex.get(c.vIdx);
            if (prev === undefined) {
              perVertex.set(c.vIdx, c.vnIdx);
            } else if (prev !== c.vnIdx) {
              split = true;
              break outer;
            }
          }
        }
        if (split) mode = 'auto';
      }

      const meshData = new MeshData();
      const vertexCache = new Map();

      const getVertex = (globalIdx) => {
        if (vertexCache.has(globalIdx)) return vertexCache.get(globalIdx);
        const pos = globalPositions[globalIdx];
        if (!pos) return null;
        const v = meshData.addVertex(pos.clone());
        vertexCache.set(globalIdx, v);
        return v;
      };

      for (const corners of faces) {
        const resolved = [];
        const seen = new Set();

        for (const c of corners) {
          const vertex = getVertex(c.vIdx);
          if (!vertex) continue;
          if (seen.has(vertex.id)) continue;
          seen.add(vertex.id);
          resolved.push({ vertex, vtIdx: c.vtIdx });
        }

        if (resolved.length < 3) continue;

        const verts = resolved.map(c => c.vertex);
        const face = meshData.addFace(verts);
        if (!face) continue;

        const hasUVs = resolved.every(c => c.vtIdx !== null && globalUVs[c.vtIdx]);
        if (hasUVs) {
          const faceUVs = resolved.map(c => {
            const uv = globalUVs[c.vtIdx];
            return { u: uv.u, v: uv.v }; // flip below if needed: 1 - uv.v
          });
          meshData.uvs.set(face.id, faceUVs);
        }
      }

      return { name, meshData, shading: mode };
    });
  }
}