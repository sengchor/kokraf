import * as THREE from 'three';
import { MeshData } from '../core/MeshData.js';

export default class OBJLoader {
  static fromOBJText(objText) {
    const lines = objText.split('\n');

    const globalPositions = [];

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
          // Skip anonymous/default groups Maya emits before vertex blocks
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

        case 'f': {
          if (!current) current = makeCurrent('unnamed');
          const indices = parts.slice(1).map(
            token => parseInt(token.split('/')[0], 10) - 1
          );
          current.faces.push(indices);
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
        const id = meshData.addVertex(pos.clone());
        vertexCache.set(globalIdx, id);
        return id;
      };

      for (const face of faces) {
        const verts = face.map(getVertex).filter(v => v !== null && v !== undefined);
        if (verts.length >= 3) meshData.addFace(verts);
      }

      return { name, meshData };
    });
  }
}