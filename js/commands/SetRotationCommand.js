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
  constructor(editor, object, newRotation, optionalOldRotation) {
    this.editor = editor;
    this.name = 'Set Rotation';

    this.object = object;
    this.oldRotation = optionalOldRotation ? optionalOldRotation.clone() : object.rotation.clone();
    this.newRotation = newRotation.clone();
  }

  execute() {
    this.object.rotation.copy(this.newRotation);
    this.object.updateMatrixWorld(true);
  }

  undo() {
    this.object.rotation.copy(this.oldRotation);
    this.object.updateMatrixWorld(true);
  }

  toJSON() {
    return {
      type: SetRotationCommand.type,
      objectUuid: this.object.uuid,
      oldRotation: this.oldRotation.toArray(),
      newRotation: this.newRotation.toArray()
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetRotationCommand.type) return null;

    const obj = editor.objectByUuid(json.objectUuid);
    const newRot = new THREE.Euler().fromArray(json.newRotation);
    const oldRot = new THREE.Euler().fromArray(json.oldRotation);

    return new SetRotationCommand(editor, obj, newRot, oldRot);
  }
}