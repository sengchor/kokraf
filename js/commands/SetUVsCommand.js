export class SetUVsCommand {
  static type = 'SetUVsCommand';

  constructor(editor, object = null, newUVs = null, optionalOldUVs = null) {
    this.editor = editor;
    this.name = 'Set UVs';
    this.updatable = false;

    this.objectUuid = object ? object.uuid : null;

    const meshData = object ? object.userData.meshData : null;

    this.newUVs = newUVs !== null ? SetUVsCommand.capture(newUVs) : null;
    this.oldUVs = optionalOldUVs !== null
      ? SetUVsCommand.capture(optionalOldUVs) : (meshData ? SetUVsCommand.capture(meshData.uvs) : null);
  }

  static capture(uvs) {
    const copy = new Map();
    if (!uvs) return copy;

    for (const [faceId, corners] of uvs) {
      copy.set(faceId, corners.map((c) => ({ u: c.u, v: c.v })));
    }

    return copy;
  }

  execute() {
    this._apply(this.newUVs);
  }

  undo() {
    this._apply(this.oldUVs);
  }

  _apply(uvs) {
    this.object = this.editor.objectByUuid(this.objectUuid);
    if (!this.object || !uvs) return;

    const meshData = this.object.userData.meshData;
    if (!meshData) return;

    meshData.uvs.clear();
    for (const [faceId, corners] of uvs) {
      meshData.uvs.set(faceId, corners.map((c) => ({ u: c.u, v: c.v })));
    }

    const vertexEditor = this.editor.vertexEditor;
    if (vertexEditor) {
      vertexEditor.setObject(this.object);
      vertexEditor.updateGeometry();
    }

    this.editor.signals.uvsChanged.dispatch(this.object);
  }

  toJSON() {
    return {
      type: SetUVsCommand.type,
      objectUuid: this.objectUuid,
      newUVs: SetUVsCommand._serialize(this.newUVs),
      oldUVs: SetUVsCommand._serialize(this.oldUVs),
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetUVsCommand.type) return null;

    const command = new SetUVsCommand(editor);

    command.objectUuid = json.objectUuid;
    command.newUVs = SetUVsCommand._deserialize(json.newUVs);
    command.oldUVs = SetUVsCommand._deserialize(json.oldUVs);

    return command;
  }

  static _serialize(uvs) {
    if (!uvs) return null;

    const out = [];
    for (const [faceId, corners] of uvs) {
      const flat = new Array(corners.length * 2);
      for (let i = 0; i < corners.length; i++) {
        flat[i * 2] = corners[i].u;
        flat[i * 2 + 1] = corners[i].v;
      }
      out.push([faceId, flat]);
    }

    return out;
  }

  static _deserialize(entries) {
    if (!entries) return null;

    const uvs = new Map();
    for (const [faceId, flat] of entries) {
      const corners = new Array(flat.length / 2);
      for (let i = 0; i < corners.length; i++) {
        corners[i] = { u: flat[i * 2], v: flat[i * 2 + 1] };
      }
      uvs.set(faceId, corners);
    }

    return uvs;
  }
}