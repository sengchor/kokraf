import * as THREE from 'three';

export class SetPositionCommand {
  static type = 'SetPositionCommand';

  /**
   * @param {Editor} editor 
   * @param {THREE.Object3D|null} object 
   * @param {THREE.Vector3|null} newPosition 
   * @param {THREE.Vector3|null} optionalOldPosition
   * @constructor 
   */
  constructor(editor, object, newPosition, optionalOldPosition) {
    this.editor = editor;
    this.name = 'Set Position';

    this.object = object;
    this.oldPosition = optionalOldPosition ? optionalOldPosition.clone() : object.position.clone();
    this.newPosition = newPosition.clone();
  }

  execute() {
    this.object.position.copy(this.newPosition);
    this.object.updateMatrixWorld(true);
  }

  undo() {
    this.object.position.copy(this.oldPosition);
    this.object.updateMatrixWorld(true);
  }

  toJSON() {
    return {
      type: SetPositionCommand.type,
      objectUuid: this.object.uuid,
      newPos: this.newPosition.toArray(),
      oldPos: this.oldPosition.toArray()
    }
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetPositionCommand.type) return null;

    const obj = editor.objectByUuid(json.objectUuid);
    const newPos = new THREE.Vector3().fromArray(json.newPos);
    const oldPos = new THREE.Vector3().fromArray(json.oldPos);

    return new SetPositionCommand(editor, obj, newPos, oldPos);
  }
}