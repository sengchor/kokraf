import * as THREE from 'three';

export class SetRotationCommand {
  static type = 'SetRotationCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {THREE.Euler|null} newRotation
   * @param {THREE.Euler|null} optionalOldRotation
   * @constructor
   */
  constructor(editor, object = null, newRotation = null, optionalOldRotation = null) {
    this.editor = editor;
    this.name = 'Set Rotation';

    this.objectUuid = object ? object.uuid : null;

    this.newRotation = newRotation ? newRotation.clone() : new THREE.Euler();
    this.oldRotation = optionalOldRotation ? optionalOldRotation.clone() : (object ? object.rotation.clone() : new THREE.Euler());
  }

  execute() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this.object.rotation.copy(this.newRotation);
    this.object.updateMatrixWorld(true);
  }

  undo() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this.object.rotation.copy(this.oldRotation);
    this.object.updateMatrixWorld(true);
  }

  toJSON() {
    return {
      type: SetRotationCommand.type,
      objectUuid: this.objectUuid,
      oldRotation: this.oldRotation.toArray(),
      newRotation: this.newRotation.toArray()
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetRotationCommand.type) return null;

    const command = new SetRotationCommand(editor);

    command.objectUuid = json.objectUuid;
    command.newRotation = new THREE.Euler().fromArray(json.newRotation);
    command.oldRotation = new THREE.Euler().fromArray(json.oldRotation);

    return command;
  }
}