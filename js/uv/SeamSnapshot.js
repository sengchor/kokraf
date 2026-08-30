export class SeamSnapshot {
  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   */
  constructor(editor, object = null) {
    this.editor = editor;
    this.signals = editor.signals;
    this.objectUuid = object ? object.uuid : null;

    this.before = object ? SeamSnapshot.read(object) : null;
    this.after = null;
  }

  static read(object) {
    const seam = object?.userData?.seam;
    return seam ? [...seam] : [];
  }

  static write(object, ids) {
    object.userData.seam = new Set(ids);
  }

  get object() {
    return this.editor.objectByUuid(this.objectUuid);
  }

  applyAfter() {
    const object = this.object;
    if (!object) return;

    if (this.after === null) {
      const meshData = object.userData.meshData;
      const before = this.before ?? SeamSnapshot.read(object);
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

    const current = SeamSnapshot.read(object);
    if (current.length === ids.length && ids.every(id => current.includes(id))) return;

    SeamSnapshot.write(object, ids);
    this.signals.seamsChanged.dispatch(object);
  }

  toJSON() {
    return { before: this.before, after: this.after };
  }

  static fromJSON(editor, json) {
    const snapshot = new SeamSnapshot(editor);
    snapshot.objectUuid = json?.objectUuid ?? null;
    snapshot.before = json?.seam?.before ?? null;
    snapshot.after = json?.seam?.after ?? null;
    return snapshot;
  }
}