export class SetUVPositionCommand {
  static type = 'SetUVPositionCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {Array<{faceId: *, corner: number}>|null} targets
   * @param {Array<{u: number, v: number}>|null} newUVs
   * @param {Array<{u: number, v: number}>|null} oldUVs
   */
  constructor(editor, object = null, targets = null, newUVs = null, oldUVs = null) {
    this.editor = editor;
    this.signals = editor.signals;
    this.name = 'Set UV Position';

    this.objectUuid = object ? object.uuid : null;

    const list = Array.isArray(targets) ? targets : [];
    this.faceIds = list.map(t => t.faceId);
    this.corners = Uint32Array.from(list, t => t.corner);

    this.newUVs = this._flatten(newUVs);
    this.oldUVs = this._flatten(oldUVs);
  }

  execute() {
    this._apply(this.newUVs);
  }

  undo() {
    this._apply(this.oldUVs);
  }

  _flatten(uvs) {
    if (!Array.isArray(uvs)) return new Float32Array(0);

    const out = new Float32Array(uvs.length * 2);
    for (let i = 0; i < uvs.length; i++) {
      out[i * 2] = uvs[i].u;
      out[i * 2 + 1] = uvs[i].v;
    }
    return out;
  }

  _apply(flat) {
    const object = this.editor.objectByUuid(this.objectUuid);
    const meshData = object?.userData?.meshData;
    if (!meshData) return;

    for (let i = 0; i < this.faceIds.length; i++) {
      const faceUVs = meshData.uvs.get(this.faceIds[i]);
      const uv = faceUVs?.[this.corners[i]];
      if (!uv) continue;

      uv.u = flat[i * 2];
      uv.v = flat[i * 2 + 1];
    }

    this._refresh(object);
  }

  _refresh(object) {
    const uvEditor = this.editor.uvEditor;

    if (uvEditor && uvEditor.editedObject === object) {
      uvEditor.invalidateAll();
      uvEditor.uvSelection.selectPointKeys(this._pointKeys(uvEditor));
      uvEditor.requestRender();
    }

    uvEditor?.syncObjectUVs?.(object);
    this.signals.objectChanged.dispatch(object);
  }

  _pointKeys(uvEditor) {
    const topo = uvEditor.uvSelection.buildTopology();
    const keys = new Set();

    for (let i = 0; i < this.faceIds.length; i++) {
      const key = topo.cornerToPointKey.get(`${this.faceIds[i]}_${this.corners[i]}`);
      if (key !== undefined) keys.add(key);
    }
    return keys;
  }

  toJSON() {
    return {
      type: SetUVPositionCommand.type,
      objectUuid: this.objectUuid,
      faceIds: this.faceIds,
      corners: Array.from(this.corners),
      newUVs: Array.from(this.newUVs),
      oldUVs: Array.from(this.oldUVs)
    }
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetUVPositionCommand.type) return null;

    const command = new SetUVPositionCommand(editor);

    command.objectUuid = json.objectUuid;
    command.faceIds = json.faceIds || [];
    command.corners = Uint32Array.from(json.corners || []);
    command.newUVs = Float32Array.from(json.newUVs || []);
    command.oldUVs = Float32Array.from(json.oldUVs || []);

    return command;
  }
}