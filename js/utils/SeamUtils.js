export class SeamUtils {
  static getSeamIds(object) {
    const seams = object?.userData?.seam;
    if (!seams) return null;

    const raw = SeamUtils.normalizeSeam(seams)

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

  static serializeSeams(objectJSON) {
    if (objectJSON.userData?.seam instanceof Set) {
      objectJSON.userData = { ...objectJSON.userData, seam: [...objectJSON.userData.seam] };
    }

    for (const child of objectJSON.children ?? []) {
      SeamUtils.serializeSeams(child);
    }
  }

  static rehydrateSeam(object) {
    const { seam } = object.userData;
    if (seam === undefined || seam instanceof Set) return;

    object.userData = { ...object.userData, seam: SeamUtils.normalizeSeam(seam) };
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