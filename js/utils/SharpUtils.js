export class SharpUtils {
  // ---------- Object-level sharp IDs ----------

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

  // ---------- Render-side sharp edge helpers ----------

  static edgeKey(a, b) {
    return a < b ? `${a}_${b}` : `${b}_${a}`;
  }

  static buildSharpKeyMap(meshData, sharps) {
    const map = new Map();
    if (!sharps) return map;
    for (const edgeId of sharps) {
      const edge = meshData.edges?.get(edgeId);
      if (!edge) continue;
      const a = edge.v1Id;
      const b = edge.v2Id;
      map.set(SharpUtils.edgeKey(a, b), [a, b]);
    }
    return map;
  }

  static setSharps(meshData, renderBuffer, sharps) {
    renderBuffer.sharpKeys = SharpUtils.buildSharpKeyMap(meshData, sharps);
    return renderBuffer.sharpKeys;
  }

   static getSharpKeys(renderBuffer) {
     if (!renderBuffer.sharpKeys) renderBuffer.sharpKeys = new Map();
     return renderBuffer.sharpKeys;
   }

  static getSharpVertices(renderBuffer) {
    const keys = SharpUtils.getSharpKeys(renderBuffer);
    if (renderBuffer._sharpVerticesSource !== keys) {
      const set = new Set();
      for (const [a, b] of keys.values()) { set.add(a); set.add(b); }
      renderBuffer.sharpVertices = set;
      renderBuffer._sharpVerticesSource = keys;
    }
    return renderBuffer.sharpVertices;
  }

  static diffSharpVertices(oldKeys, newKeys) {
    const affected = new Set();
    for (const [key, [a, b]] of newKeys) {
      if (!oldKeys.has(key)) { affected.add(a); affected.add(b); }
    }
    for (const [key, [a, b]] of oldKeys) {
      if (!newKeys.has(key)) { affected.add(a); affected.add(b); }
    }
    return affected;
  }
}