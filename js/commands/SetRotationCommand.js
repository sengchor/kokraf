import * as THREE from 'three';

export class SetRotationCommand {
  static type = 'SetRotationCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|THREE.Object3D[]} objects
   * @param {THREE.Euler|THREE.Euler[]} newRotations
   * @param {THREE.Euler|THREE.Euler[]} oldRotations
   * @constructor
   */
  constructor(editor, objects = [], newRotations = [], oldRotations = []) {
    this.editor = editor;
    this.name = 'Set Rotation';

    if (!Array.isArray(objects)) objects = [objects];
    if (!Array.isArray(newRotations)) newRotations = [newRotations];
    if (!Array.isArray(oldRotations)) oldRotations = [oldRotations];

    this.objectUuids = objects.map(o => o.uuid);

    this.oldRotations = oldRotations.map(r => r.clone());
    this.newRotations = newRotations.map(r => r.clone());
  }

  execute() {
    const objects = this.objectUuids.map(uuid => this.editor.objectByUuid(uuid));
    for (let i = 0; i < objects.length; i++) {
      objects[i].rotation.copy(this.newRotations[i]);
      objects[i].updateMatrixWorld(true);
    }
  }

  undo() {
    const objects = this.objectUuids.map(uuid => this.editor.objectByUuid(uuid));
    for (let i = 0; i < objects.length; i++) {
      objects[i].rotation.copy(this.oldRotations[i]);
      objects[i].updateMatrixWorld(true);
    }
  }

  toJSON() {
    return {
      type: SetRotationCommand.type,
      objectUuids: this.objectUuids,
      oldRotations: this.oldRotations.map(r => r.toArray()),
      newRotations: this.newRotations.map(r => r.toArray())
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetRotationCommand.type) return null;

    const command = new SetRotationCommand(editor);

    command.objectUuids = json.objectUuids;
    command.newRotations = json.newRotations.map(arr => new THREE.Euler().fromArray(arr));
    command.oldRotations = json.oldRotations.map(arr => new THREE.Euler().fromArray(arr));

    return command;
  }
}