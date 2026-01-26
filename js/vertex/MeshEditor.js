import * as THREE from 'three';
import { MeshData } from '../core/MeshData.js';

export class MeshEditor {
  constructor(editor) {
    this.editor = editor;
  }

  mergeMeshData(meshDataList, transforms = []) {
    const merged = new MeshData();

    for (let i = 0; i < meshDataList.length; i++) {
      const source = meshDataList[i];
      const transform = transforms[i] || new THREE.Matrix4();

      const vertexIdMap = new Map();

      for (const vertex of source.vertices.values()) {
        const pos = new THREE.Vector3(
          vertex.position.x,
          vertex.position.y,
          vertex.position.z
        );
        pos.applyMatrix4(transform);

        vertexIdMap.set(
          vertex.id,
          merged.addVertex({ x: pos.x, y: pos.y, z: pos.z })
        );
      }

      for (const face of source.faces.values()) {
        merged.addFace(
          face.vertexIds.map(id => vertexIdMap.get(id))
        );
      }
    }

    return merged;
  }
}