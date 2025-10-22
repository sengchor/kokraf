import * as THREE from 'three';
import { MeshData } from '../core/MeshData.js';

export default class OBJLoader {
  static fromOBJText(objText) {
    const lines = objText.split('\n');
    const objects = [];
    let current = { name: '', positions: [], faces: [], vertexOffset: 0 };

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length === 0) continue;

      switch (parts[0]) {
        case 'o':
        case 'g':
          if (current.faces.length > 0) {
            objects.push(current);
            current.vertexOffset += current.positions.length;
          }
          current = { 
            name: parts.slice(1).join(' '), 
            positions: [], 
            faces: [], 
            vertexOffset: current.vertexOffset 
          };
          break;

        case 'v':
          const x = parseFloat(parts[1]);
          const y = parseFloat(parts[2]);
          const z = parseFloat(parts[3]);

          if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
            current.positions.push(null);
          } else {
            current.positions.push([x, y, z]);
          }
          break;

        case 'f':
          const faceIndices = parts.slice(1).map(token => {
            const idx = parseInt(token.split('/')[0], 10) - 1 - current.vertexOffset;
            return idx;
          });
          current.faces.push(faceIndices);
          break;
      }
    }
    
    if (current.faces.length > 0) objects.push(current);

    return objects.map(obj => {
      const { positions, faces, name } = obj;
      const meshData = new MeshData();
      const verts = positions.map(p => p ? meshData.addVertex(new THREE.Vector3(...p)) : null);
      for (const face of faces) {
        const vertexArray = face.map(i => verts[i]).filter(v => v !== null && v !== undefined);
        if (vertexArray.length >= 3) meshData.addFace(vertexArray);
      }
      return { name, meshData };
    });
  }
}