import * as THREE from 'three';

export class SetPositionCommand {
  static type = 'SetPositionCommand';

  /**
   * @param {Editor} editor 
   * @param {THREE.Object3D|THREE.Object3D[]} objects 
   * @param {THREE.Vector3|THREE.Vector3[]} newPositions
   * @param {THREE.Vector3|THREE.Vector3[]} oldPositions
   * @constructor
   */
  constructor(editor, objects = [], newPositions = [], oldPositions = []) {
    this.editor = editor;
    this.name = 'Set Position';

    if (!Array.isArray(objects)) objects = [objects];
    if (!Array.isArray(newPositions)) newPositions = [newPositions];
    if (!Array.isArray(oldPositions)) oldPositions = [oldPositions];

    this.objectUuids = objects.map(o => o.uuid);

    this.oldPositions = oldPositions.map(p => p.clone());
    this.newPositions = newPositions.map(p => p.clone());
  }

  execute() {
    const objects = this.objectUuids.map(uuid => this.editor.objectByUuid(uuid));
    for (let i = 0; i < objects.length; i++) {
      objects[i].position.copy(this.newPositions[i]);
      objects[i].updateMatrixWorld(true);
    }
  }

  undo() {
    const objects = this.objectUuids.map(uuid => this.editor.objectByUuid(uuid));
    for (let i = 0; i < objects.length; i++) {
      objects[i].position.copy(this.oldPositions[i]);
      objects[i].updateMatrixWorld(true);
    }
  }

  toJSON() {
    return {
      type: SetPositionCommand.type,
      objectUuids: this.objectUuids,
      oldPositions: this.oldPositions.map(v => v.toArray()),
      newPositions: this.newPositions.map(v => v.toArray())
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetPositionCommand.type) return null;

    const command = new SetPositionCommand(editor);

    command.objectUuids = json.objectUuids;

    command.oldPositions = json.oldPositions.map(arr => new THREE.Vector3().fromArray(arr));
    command.newPositions = json.newPositions.map(arr => new THREE.Vector3().fromArray(arr));

    return command;
  }
}