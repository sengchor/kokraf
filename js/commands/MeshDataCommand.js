import { SeamSnapshot } from '../uv/SeamSnapshot.js';

export class MeshDataCommand {
  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {object|null} beforeMeshData
   * @param {object|null} afterMeshData
   * @param {string} name
   * @constructor
   */
  constructor(editor, object, beforeMeshData, afterMeshData, name = 'MeshDataCommand') {
    this.editor = editor;
    this.signals = editor.signals;
    this.vertexEditor = editor.vertexEditor;
    this.name = name;
    this.objectUuid = object ? object.uuid : null;

    this.beforeMeshData = beforeMeshData ? structuredClone(beforeMeshData) : null;
    this.afterMeshData = afterMeshData ? structuredClone(afterMeshData) : null;

    this.seam = new SeamSnapshot(editor, object);
  }

  execute() {
    this.editor.editSelection.clearSelection();
    this.applyMeshData(this.afterMeshData);
    this.seam.applyAfter();
  }

  undo() {
    this.editor.editSelection.clearSelection();
    this.applyMeshData(this.beforeMeshData);
    this.seam.applyBefore();
  }

  applyMeshData(meshData) {
    const object = this.editor.objectByUuid(this.objectUuid);
    if (!object || !meshData) return;

    this.vertexEditor.setObject(object);
    this.vertexEditor.applyMeshData(meshData);
  }

  toJSON() {
    return {
      type: this.constructor.type,
      objectUuid: this.objectUuid,
      beforeMeshData: this.beforeMeshData,
      afterMeshData: this.afterMeshData,
      seam: this.seam.toJSON(),
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== this.type) return null;

    const command = new this(editor);
    command.objectUuid = json.objectUuid;
    command.beforeMeshData = json.beforeMeshData;
    command.afterMeshData = json.afterMeshData;
    command.seam = SeamSnapshot.fromJSON(editor, json);
    command.seam.objectUuid = json.objectUuid;
    return command;
  }
}