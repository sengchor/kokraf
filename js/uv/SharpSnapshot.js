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

    const current = SharpSnapshot.read(object);
    if (current.length === ids.length && ids.every(id => current.includes(id))) return;

    SharpSnapshot.write(object, ids);
    this.signals.sharpsChanged.dispatch(object);
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