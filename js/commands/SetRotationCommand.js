import * as THREE from 'three';
import { TransformUtils } from '../utils/TransformUtils.js';

export class SetRotationCommand {
  static type = 'SetRotationCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|THREE.Object3D[]} objects
   * @param {THREE.Quaternion|THREE.Quaternion[]} newQuaternions
   * @param {THREE.Quaternion|THREE.Quaternion[]} oldQuaternions
   * @constructor
   */
  constructor(editor, objects = [], newQuaternions = [], oldQuaternions = []) {
    this.editor = editor;
    this.name = 'Set Rotation';

    if (!Array.isArray(objects)) objects = [objects];
    if (!Array.isArray(newQuaternions)) newQuaternions = [newQuaternions];
    if (!Array.isArray(oldQuaternions)) oldQuaternions = [oldQuaternions];

    this.objectUuids = objects.map(o => o.uuid);

    this.oldQuaternions = oldQuaternions.map(r => r.clone());
    this.newQuaternions = newQuaternions.map(r => r.clone());
  }

  execute() {
    const objects = this.objectUuids.map(uuid => this.editor.objectByUuid(uuid));
    for (let i = 0; i < objects.length; i++) {
      TransformUtils.setWorldRotation(objects[i], this.newQuaternions[i]);
      objects[i].updateMatrixWorld(true);
    }
    this.editor.selection.select(objects, true);
  }

  undo() {
    const objects = this.objectUuids.map(uuid => this.editor.objectByUuid(uuid));
    for (let i = 0; i < objects.length; i++) {
      TransformUtils.setWorldRotation(objects[i], this.oldQuaternions[i]);
      objects[i].updateMatrixWorld(true);
    }
    this.editor.selection.select(objects, true);
  }

  toJSON() {
    return {
      type: SetRotationCommand.type,
      objectUuids: this.objectUuids,
      oldQuaternions: this.oldQuaternions.map(r => r.toArray()),
      newQuaternions: this.newQuaternions.map(r => r.toArray())
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetRotationCommand.type) return null;

    const command = new SetRotationCommand(editor);

    command.objectUuids = json.objectUuids;
    command.newQuaternions = json.newQuaternions.map(arr => new THREE.Quaternion().fromArray(arr));
    command.oldQuaternions = json.oldQuaternions.map(arr => new THREE.Quaternion().fromArray(arr));

    return command;
  }
}