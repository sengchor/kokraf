export class SeamUtils {
  static getSeamIds(object) {
    const seam = object?.userData?.seam;
    if (!seam) return null;

    const raw = seam instanceof Set ? seam : new Set(seam);

    const meshData = object?.userData?.meshData;
    if (!meshData) return raw;
    
    const live = new Set();
    for (const id of raw) {
      if (meshData.edges.has(id)) live.add(id);
    }
    return live;
  }

  static normalizeSeam(seam) {
    if (seam instanceof Set) return seam;
    if (Array.isArray(seam)) return new Set(seam);
    return new Set();
  }

  static splitSeams(object, edgeIdMap, remainingMeshData) {
    const source = SeamUtils.normalizeSeam(object.userData.seam);

    const separated = new Set();
    const remaining = new Set();

    for (const oldId of source) {
      const newId = edgeIdMap.get(oldId);
      if (newId !== undefined) separated.add(newId);

      if (remainingMeshData.edges.has(oldId)) remaining.add(oldId);
    }

    return { separated, remaining };
  }

  static mergeSeams(objects, maps) {
    const merged = new Set();

    objects.forEach((object, i) => {
      const edgeIdMap = maps[i]?.edgeIdMap;
      if (!edgeIdMap) return;

      for (const oldId of SeamUtils.normalizeSeam(object.userData.seam)) {
        const newId = edgeIdMap.get(oldId);
        if (newId !== undefined) merged.add(newId);
      }
    });

    return merged;
  }
}