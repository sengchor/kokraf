import * as THREE from 'three';

export class MeshDeltaCommand {
  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {object|null} beforeDelta
   * @param {object|null} afterDelta
   * @param {string} name
   */
  constructor(editor, object, beforeDelta, afterDelta, name = 'MeshDeltaCommand') {
    this.editor = editor;
    this.signals = editor.signals;
    this.vertexEditor = editor.vertexEditor;
    this.name = name;
    this.objectUuid = object ? object.uuid : null;

    this.beforeDelta = beforeDelta ? structuredClone(beforeDelta) : null;
    this.afterDelta = afterDelta ? structuredClone(afterDelta) : null;
  }

  execute() {
    this.editor.editSelection.clearSelection();
    this.applyDelta(this.afterDelta);
  }

  undo() {
    this.editor.editSelection.clearSelection();
    this.applyDelta(this.beforeDelta);
  }

  applyDelta(delta) {
    const object = this.editor.objectByUuid(this.objectUuid);
    if (!object || !delta) return;

    this.vertexEditor.setObject(object);
    this.vertexEditor.applyDelta(delta);
  }

  toJSON() {
    return {
      type: this.constructor.type,
      objectUuid: this.objectUuid,
      beforeDelta: this.beforeDelta,
      afterDelta: this.afterDelta,
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== this.type) return null;

    const command = new this(editor);
    command.objectUuid = json.objectUuid;
    command.beforeDelta = json.beforeDelta;
    command.afterDelta = json.afterDelta;
    return command;
  }
}