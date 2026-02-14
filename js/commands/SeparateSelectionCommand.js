import * as THREE from 'three';

export class SeparateSelectionCommand {
  static type = 'SeparateSelectionCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {object|null} beforeMeshData
   * @param {object|null} afterMeshData
   * @param {object|null} newMeshData
   * @constructor
   */
  constructor(editor, object, beforeMeshData, afterMeshData, newMeshData) {
    this.editor = editor;
    this.name = 'Separate Selection';
    this.vertexEditor = editor.vertexEditor;

    this.objectUuid = object ? object.uuid : null;

    this.beforeMeshData = beforeMeshData ? structuredClone(beforeMeshData) : null;
    this.afterMeshData = afterMeshData ? structuredClone(afterMeshData) : null;
    this.newMeshData = newMeshData ? structuredClone(newMeshData) : null;

    if (!object) return;
    this.parentUuid = object.parent ? object.parent.uuid : null;
    this.index = object.parent ? object.parent.children.indexOf(object) : -1;
    this.newObjectUuid = null;
  }

  execute() {
    this.editor.editSelection.clearSelection();

    this.applyMeshData(this.afterMeshData);

    const object = this.editor.objectByUuid(this.objectUuid);
    if (!object || !this.newMeshData) return;

    const newObject = this.editor.objectEditor.cloneObjectFromMeshData(this.newMeshData, object);

    if (!this.newObjectUuid) {
      this.newObjectUuid = newObject.uuid;
    } else {
      newObject.uuid = this.newObjectUuid;
    }

    const parent = this.editor.objectByUuid(this.parentUuid);
    this.editor.sceneManager.addObject(newObject, parent, this.index);

    this.editor.toolbar.updateTools();
  }

  undo() {
    this.editor.editSelection.clearSelection();

    this.applyMeshData(this.beforeMeshData);

    const newObject = this.editor.objectByUuid(this.newObjectUuid);
    if (newObject) {
      this.editor.sceneManager.detachObject(newObject);
      this.editor.sceneManager.removeObject(newObject);
    }

    this.editor.toolbar.updateTools();
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
      type: SeparateSelectionCommand.type,
      objectUuid: this.objectUuid,
      beforeMeshData: this.beforeMeshData,
      afterMeshData: this.afterMeshData,
      newMeshData: this.newMeshData,
      parentUuid: this.parentUuid,
      index: this.index,
      newObjectUuid: this.newObjectUuid
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SeparateSelectionCommand.type) return null;

    const cmd = new SeparateSelectionCommand(editor, null, json.beforeMeshData, json.afterMeshData, json.newMeshData);
    cmd.objectUuid = json.objectUuid;
    cmd.parentUuid = json.parentUuid;
    cmd.index = json.index;
    cmd.newObjectUuid = json.newObjectUuid;

    return cmd;
  }
}