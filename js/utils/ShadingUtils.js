import { MeshRendererAdapter } from '../geometry/MeshRendererAdapter.js';

export class ShadingUtils {
  static applyShading(object, mode) {
    const meshData = object.userData.meshData;
    const { geometry, renderBuffer } = MeshRendererAdapter.toBufferGeometry(meshData, { mode });

    object.geometry.dispose();
    object.geometry = geometry;
    object.userData.renderBuffer = renderBuffer;
    object.userData.shading = mode;
  }
  
  static hasSharpEdges(faces, normals, vertices) {
    const map = new Map();

    for (const face of faces) {
      for (const fv of face) {
        if (fv.v == null || fv.n == null) continue;
        const key = vertices[fv.v].join(',');
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(normals[fv.n].join(','));
      }
    }

    for (const set of map.values()) {
      if (set.size > 1) return true;
    }

    return false;
  }

  static parseFace(parts) {
    return parts.slice(1).map(p => {
      const [v, , n] = p.split('/').map(x => (x ? parseInt(x) - 1 : null));
      return { v, n };
    });
  }
}