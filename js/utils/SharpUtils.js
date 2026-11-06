export class SharpUtils {
  static getSharpIds(object) {
    const sharps = object?.userData?.sharps;
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
}