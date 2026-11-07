export class SharpUtils {
  static getSharpIds(object) {
    const sharps = object?.userData?.sharp;
    if (!sharps) return null;

    const raw = sharps instanceof Set ? sharps : new Set(sharps);

    const meshData = object?.userData?.meshData;
    if (!meshData) return raw;

    const live = new Set();
    for (const id of raw) {
      if (meshData.edges.has(id)) live.add(id);
    }
    return live;
  }

  static normalizeSharp(sharp) {
    if (sharp instanceof Set) return sharp;
    if (Array.isArray(sharp)) return new Set(sharp);
    return new Set();
  }

  static splitSharps(object, edgeIdMap, remainingMeshData) {
    const source = SharpUtils.normalizeSharp(object.userData.sharp);

    const separated = new Set();
    const remaining = new Set();

    for (const oldId of source) {
      const newId = edgeIdMap.get(oldId);
      if (newId !== undefined) separated.add(newId);

      if (remainingMeshData.edges.has(oldId)) remaining.add(oldId);
    }

    return { separated, remaining };
  }

  static mergeSharps(objects, maps) {
    const merged = new Set();

    objects.forEach((object, i) => {
      const edgeIdMap = maps[i]?.edgeIdMap;
      if (!edgeIdMap) return;

      for (const oldId of SharpUtils.normalizeSharp(object.userData.sharp)) {
        const newId = edgeIdMap.get(oldId);
        if (newId !== undefined) merged.add(newId);
      }
    });

    return merged;
  }
}