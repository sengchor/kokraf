import * as THREE from 'three';
import { MeshData } from '../core/MeshData.js';

export default class OBJLoader {
  static fromOBJText(objText) {
    const lines = objText.split('\n');

    const globalPositions = [];
    const globalUVs = [];

    const objects = [];
    let current = null;

    const pushCurrent = () => {
      if (current && current.faces.length > 0) objects.push(current);
    };

    const makeCurrent = (name) => ({ name, faces: [], });

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed[0] === '#') continue;

      const parts = trimmed.split(/\s+/);

      switch (parts[0]) {
        case 'o':
        case 'g': {
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
          const v = parseFloat(parts[2]);
          globalUVs.push(
            isFinite(u) && isFinite(v) ? { u, v } : null
          );
          break;
        }

        case 'f': {
          if (!current) current = makeCurrent('unnamed');
          // Each corner is "v", "v/vt", "v//vn", or "v/vt/vn"
          const corners = parts.slice(1).map(token => {
            const segs = token.split('/');
            const vIdx = parseInt(segs[0], 10) - 1;
            const vtIdx = (segs.length >= 2 && segs[1] !== '')
              ? parseInt(segs[1], 10) - 1
              : null;
            return { vIdx, vtIdx };
          });
          current.faces.push(corners);
          break;
        }
      }
    }
    pushCurrent();

    return objects.map(({ name, faces }) => {
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
        const resolved = corners
          .map(c => ({ vertex: getVertex(c.vIdx), vtIdx: c.vtIdx }))
          .filter(c => c.vertex !== null && c.vertex !== undefined);

        if (resolved.length < 3) continue;

        const verts = resolved.map(c => c.vertex);
        const face = meshData.addFace(verts);

        const hasUVs = resolved.every(c => c.vtIdx !== null && globalUVs[c.vtIdx]);
        if (hasUVs) {
          const faceUVs = resolved.map(c => {
            const uv = globalUVs[c.vtIdx];
            return { u: uv.u, v: uv.v }; // flip below if needed: 1 - uv.v
          });
          meshData.uvs.set(face.id, faceUVs);
        }
      }

      return { name, meshData };
    });
  }
}