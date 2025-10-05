export class ShadingUtils {
  static applyShading(object, mode) {
    const meshData = object.userData.meshData;
    const geometry = this.createGeometryWithShading(meshData, mode);

    object.geometry.dispose();
    object.geometry = geometry;
    object.userData.shading = mode;
  }

  static createGeometryWithShading(meshData, mode, useEarcut = true) {
    let geometry;
    if (mode === 'smooth') {
      geometry = meshData.toSharedVertexGeometry(useEarcut);
    } else if (mode === 'flat') {
      geometry = meshData.toDuplicatedVertexGeometry(useEarcut);
    } else if (mode === 'auto') {
      geometry = meshData.toAngleBasedGeometry(undefined, useEarcut);
    }
    geometry.computeVertexNormals();
    return geometry;
  }

  static getShadingFromOBJ(objText) {
    const lines = objText.split('\n');
    const shadingObjects = [];

    const vertices = [];
    const normals = [];

    let current = { smoothCount: 0, flatCount: 0, hasFlag: false, faces: [] };

    const finalize = () => {
      if (current.smoothCount > 0) {
        shadingObjects.push(
          this.hasSharpEdges(current.faces, normals, vertices) ? 'auto' : 'smooth'
        );
      } else {
        shadingObjects.push('flat');
      }
    };

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const parts = line.split(/\s+/);

      switch (parts[0]) {
        case 'o':
        case 'g':
          if (current.hasFlag) finalize();
          current = { smoothCount: 0, flatCount: 0, hasFlag: false, faces: [] };
          break;

        case 'v':
          vertices.push(parts.slice(1).map(Number));
          break;

        case 'vn':
          normals.push(parts.slice(1).map(Number));
          break;

        case 'f':
          current.faces.push(this.parseFace(parts));
          break;

        case 's':
          current.hasFlag = true;
          const flag = parts[1]?.toLowerCase();
          if (flag === 'off' || flag === '0') {
            current.flatCount++;
          } else {
            current.smoothCount++;
          }
          break;
      }
    }

    finalize();
    return shadingObjects;
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