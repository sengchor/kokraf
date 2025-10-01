import * as THREE from 'three';
import { VertexEditor } from '../tools/VertexEditor.js';

export class SetVertexPositionCommand {
  static type = 'SetVertexPositionCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {number|null} vertexIndices
   * @param {THREE.Vector3|null} newPositions
   * @param {THREE.Vector3|null} oldPositions
   */
  constructor(editor, object = null, vertexIndices = null, newPositions = null, oldPositions = null) {
    this.editor = editor;
    this.name = 'Set Vertex Position';

    this.objectUuid = object ? object.uuid : null;
    this.vertexIndices = Array.isArray(vertexIndices) ? vertexIndices : [];

    this.newPositions = Array.isArray(newPositions) ? newPositions.map(p => p.clone()) : [];
    this.oldPositions = Array.isArray(oldPositions) ? oldPositions.map(p => p.clone()) : [];
  }

  execute() {
    const object = this.editor.objectByUuid(this.objectUuid);

    const vertexEditor = new VertexEditor(this.editor, object);
    vertexEditor.setVerticesWorldPositions(this.vertexIndices, this.newPositions);
    vertexEditor.updateGeometryAndHelpers();
  }

  undo() {
    const object = this.editor.objectByUuid(this.objectUuid);
    
    const vertexEditor = new VertexEditor(this.editor, object);
    vertexEditor.setVerticesWorldPositions(this.vertexIndices, this.oldPositions);
    vertexEditor.updateGeometryAndHelpers();
  }

  toJSON() {
    return {
      type: SetVertexPositionCommand.type,
      objectUuid: this.objectUuid,
      vertexIndices: this.vertexIndices,
      newPositions: this.newPositions.map(p => p.toArray()),
      oldPositions: this.oldPositions.map(p => p.toArray())
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetVertexPositionCommand.type) return null;

    const command = new SetVertexPositionCommand(editor);

    command.objectUuid = json.objectUuid;
    command.vertexIndices = json.vertexIndices || [];
    command.newPositions = (json.newPositions || []).map(arr => new THREE.Vector3().fromArray(arr));
    command.oldPositions = (json.oldPositions || []).map(arr => new THREE.Vector3().fromArray(arr));

    return command;
  }
}