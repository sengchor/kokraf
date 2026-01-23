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
    this.vertexEditor = editor.vertexEditor;
    this.name = name;
    this.objectUuid = object ? object.uuid : null;

    this.beforeMeshData = beforeMeshData ? structuredClone(beforeMeshData) : null;
    this.afterMeshData = afterMeshData ? structuredClone(afterMeshData) : null;
  }

  execute() {
    this.editor.editSelection.clearSelection();
    this.applyMeshData(this.afterMeshData);
  }

  undo() {
    this.editor.editSelection.clearSelection();
    this.applyMeshData(this.beforeMeshData);
  }

  applyMeshData(meshData) {
    const object = this.editor.objectByUuid(this.objectUuid);
    if (!object || !meshData) return;

    this.vertexEditor.setObject(object);
    this.vertexEditor.transform.applyMeshData(meshData);
    this.vertexEditor.transform.updateGeometryAndHelpers();
  }

  toJSON() {
    return {
      type: this.constructor.type,
      objectUuid: this.objectUuid,
      beforeMeshData: this.beforeMeshData,
      afterMeshData: this.afterMeshData,
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== this.type) return null;

    const command = new this(editor);
    command.objectUuid = json.objectUuid;
    command.beforeMeshData = json.beforeMeshData;
    command.afterMeshData = json.afterMeshData;
    return command;
  }
}