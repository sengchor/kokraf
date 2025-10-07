import * as THREE from 'three';
import { VertexEditor } from '../tools/VertexEditor.js';

export class DeleteSelectionCommand {
  static type = 'DeleteSelectionCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {object|null} beforeMeshData
   * @param {object|null} afterMeshData
   * @constructor
   */
  constructor(editor, object = null, beforeMeshData = null, afterMeshData = null) {
    this.editor = editor;
    this.name = 'Delete Selection';
    this.objectUuid = object ? object.uuid : null;

    this.beforeMeshData = beforeMeshData ? structuredClone(beforeMeshData) : null;
    this.afterMeshData = afterMeshData ? structuredClone(afterMeshData) : null;
  }

  execute() {
    const object = this.editor.objectByUuid(this.objectUuid);
    if (!object) return;

    const vertexEditor = new VertexEditor(this.editor, object);
    vertexEditor.applyMeshData(this.afterMeshData);
    vertexEditor.updateGeometryAndHelpers();
  }

  undo() {
    const object = this.editor.objectByUuid(this.objectUuid);
    if (!object) return;

    const vertexEditor = new VertexEditor(this.editor, object);
    vertexEditor.applyMeshData(this.beforeMeshData);
    vertexEditor.updateGeometryAndHelpers();
  }

  toJSON() {
    return {
      type: DeleteSelectionCommand.type,
      objectUuid: this.objectUuid,
      beforeMeshData: this.beforeMeshData,
      afterMeshData: this.afterMeshData
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== DeleteSelectionCommand.type) return null;

    const command = new DeleteSelectionCommand(editor);

    command.objectUuid = json.objectUuid;
    command.beforeMeshData = json.beforeMeshData;
    command.afterMeshData = json.afterMeshData;

    return command;
  }
}