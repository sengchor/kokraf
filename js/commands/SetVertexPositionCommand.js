import * as THREE from 'three';
import { VertexEditor } from '../tools/VertexEditor.js';

export class SetVertexPositionCommand {
  static type = 'SetVertexPositionCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {number|null} vertexIndex
   * @param {THREE.Vector3|null} newPosition
   * @param {THREE.Vector3|null} oldPosition
   */
  constructor(editor, object = null, vertexIndex = null, newPosition = null, oldPosition = null) {
    this.editor = editor;
    this.name = 'Set Vertex Position';

    this.objectUuid = object ? object.uuid : null;
    this.vertexIndex = vertexIndex;

    this.newPosition = newPosition ? newPosition.clone() : new THREE.Vector3();
    this.oldPosition = oldPosition ? oldPosition.clone() : new THREE.Vector3();
  }

  execute() {
    const object = this.editor.objectByUuid(this.objectUuid);

    const vertexEditor = new VertexEditor(this.editor, object);
    vertexEditor.setVertexWorldPosition(this.vertexIndex, this.newPosition);
  }

  undo() {
    const object = this.editor.objectByUuid(this.objectUuid);
    
    const vertexEditor = new VertexEditor(this.editor, object);
    vertexEditor.setVertexWorldPosition(this.vertexIndex, this.oldPosition);
  }

  toJSON() {
    return {
      type: SetVertexPositionCommand.type,
      objectUuid: this.objectUuid,
      vertexIndex: this.vertexIndex,
      newPosition: this.newPosition.toArray(),
      oldPosition: this.oldPosition.toArray()
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetVertexPositionCommand.type) return null;

    const command = new SetVertexPositionCommand(editor);

    command.objectUuid = json.objectUuid;
    command.vertexIndex = json.vertexIndex;
    command.newPosition = new THREE.Vector3().fromArray(json.newPosition);
    command.oldPosition = new THREE.Vector3().fromArray(json.oldPosition);

    return command;
  }
}