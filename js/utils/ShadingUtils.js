export class ShadingUtils {
  static applyShading(object, mode) {
    const meshData = object.userData.meshData;
    const geometry = this.createGeometryWithShading(meshData, mode);

    object.geometry.dispose();
    object.geometry = geometry;
    object.userData.shading = mode;
  }

  static createGeometryWithShading(meshData, mode) {
    let geometry;
    if (mode === 'smooth') {
      geometry = meshData.toSharedVertexGeometry();
    } else if (mode === 'flat') {
      geometry = meshData.toDuplicatedVertexGeometry();
    }
    geometry.computeVertexNormals();
    return geometry;
  }

  static getShadingFromOBJ(objText) {
    const lines = objText.split('\n');
    const shadingObjects = [];
    let current = { shading: null, smoothCount: 0, flatCount: 0 };

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      const parts = line.split(/\s+/);

      switch (parts[0]) {
        case 'o':
        case 'g':
          if (current.smoothCount + current.flatCount > 0) {
            shadingObjects.push(
              current.smoothCount >= current.flatCount ? 'smooth' : 'flat'
            );
          }
          current = { shading: null, smoothCount: 0, flatCount: 0 };
          break;

        case 's':
          const flag = parts[1]?.toLowerCase();
          if (flag === 'off' || flag === '0') {
            current.flatCount++;
          } else {
            current.smoothCount++;
          }
          break;
      }
    }

    if (current.smoothCount + current.flatCount > 0) {
      shadingObjects.push(
        current.smoothCount >= current.flatCount ? 'smooth' : 'flat'
      );
    }

    return shadingObjects;
  }
}