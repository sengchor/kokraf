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
  constructor(editor, object = null, newPosition = null, optionalOldPosition = null) {
    this.editor = editor;
    this.name = 'Set Position';

    this.objectUuid = object ? object.uuid : null;

    this.newPosition = newPosition ? newPosition.clone() : new THREE.Vector3();
    this.oldPosition = optionalOldPosition ? optionalOldPosition.clone() : (object ? object.position.clone() : new THREE.Vector3());
  }

  execute() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this.object.position.copy(this.newPosition);
    this.object.updateMatrixWorld(true);
  }

  undo() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this.object.position.copy(this.oldPosition);
    this.object.updateMatrixWorld(true);
  }

  toJSON() {
    return {
      type: SetPositionCommand.type,
      objectUuid: this.objectUuid,
      newPosition: this.newPosition.toArray(),
      oldPosition: this.oldPosition.toArray()
    }
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetPositionCommand.type) return null;

    const command = new SetPositionCommand(editor);

    command.objectUuid = json.objectUuid;
    command.newPosition = new THREE.Vector3().fromArray(json.newPosition);
    command.oldPosition =  new THREE.Vector3().fromArray(json.oldPosition);

    return command;
  }
}