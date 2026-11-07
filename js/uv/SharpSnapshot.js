export class SharpSnapshot {
  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   */
  constructor(editor, object = null) {
    this.editor = editor;
    this.signals = editor.signals;
    this.objectUuid = object ? object.uuid : null;

    this.before = object ? SharpSnapshot.read(object) : null;
    this.after = null;
  }

  static read(object) {
    const sharp = object?.userData?.sharp;
    return sharp ? [...sharp] : [];
  }

  // Updates the existing Set in place so renderBuffer.sharpEdgeIds stays the live reference
  static write(object, ids) {
    let set = object.userData.sharp;
    if (!(set instanceof Set)) {
      set = new Set();
      object.userData.sharp = set;
    }
    set.clear();
    for (const id of ids) set.add(id);
  }

  get object() {
    return this.editor.objectByUuid(this.objectUuid);
  }

  static diff(object, ids) {
    const current = new Set(SharpSnapshot.read(object));
    const next = new Set(ids);

    const changed = [];
    for (const id of next) if (!current.has(id)) changed.push(id);
    for (const id of current) if (!next.has(id)) changed.push(id);
    return changed;
  }

  applyAfter() {
    const object = this.object;
    if (!object) return;

    if (this.after === null) {
      const meshData = object.userData.meshData;
      const before = this.before ?? SharpSnapshot.read(object);
      this.after = meshData ? before.filter(id => meshData.edges.has(id)) : [...before];
    }

    this.apply(this.after);
  }

  applyBefore() {
    this.apply(this.before);
  }

  apply(ids) {
    if (!ids) return;

    const object = this.object;
    if (!object) return;

    const current = new Set(SharpSnapshot.read(object));
    const next = new Set(ids);

    // Only edges whose state flips; normals change only at their endpoints
    const changed = [];
    for (const id of next) if (!current.has(id)) changed.push(id);
    for (const id of current) if (!next.has(id)) changed.push(id);
    if (changed.length === 0) return;

    SharpSnapshot.write(object, next);
    this.signals.sharpsChanged.dispatch(object, changed);
  }

  toJSON() {
    return { before: this.before, after: this.after };
  }

  static fromJSON(editor, json) {
    const snapshot = new SharpSnapshot(editor);
    snapshot.objectUuid = json?.objectUuid ?? null;
    snapshot.before = json?.sharp?.before ?? null;
    snapshot.after = json?.sharp?.after ?? null;
    return snapshot;
  }
}