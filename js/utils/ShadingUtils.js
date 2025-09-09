export class ShadingUtils {
  static applyShading(object, mode) {
    const meshData = object.userData.meshData;

    let geometry;
    if (mode === 'smooth') {
      geometry = meshData.toSharedVertexGeometry();
      geometry.computeVertexNormals();
    } else if (mode === 'flat') {
      geometry = meshData.toDuplicatedVertexGeometry();
      geometry.computeVertexNormals();
    }

    object.geometry.dispose();
    object.geometry = geometry;
    object.userData.shading = mode;
  }
}