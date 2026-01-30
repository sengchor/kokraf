import * as THREE from 'three';
import { TransformUtils } from '../utils/TransformUtils.js';

export class SetScaleCommand {
  static type = 'SetScaleCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|THREE.Object3D[]} objects
   * @param {THREE.Vector3|THREE.Vector3[]} newScales
   * @param {THREE.Vector3|THREE.Vector3[]} oldScales
   * @constructor
   */
  constructor(editor, objects = [], newScales = [], oldScales = []) {
    this.editor = editor;
    this.name = 'Set Scale';

    if (!Array.isArray(objects)) objects = [objects];
    if (!Array.isArray(newScales)) newScales = [newScales];
    if (!Array.isArray(oldScales)) oldScales = [oldScales];

    this.objectUuids = objects.map(o => o.uuid);

    this.newScales = newScales.map(s => s.clone());
    this.oldScales = oldScales.map(s => s.clone());
  }

  execute() {
    const objects = this.objectUuids.map(uuid => this.editor.objectByUuid(uuid));
    for (let i = 0; i < objects.length; i++) {
      TransformUtils.setWorldScale(objects[i], this.newScales[i]);
      objects[i].updateMatrixWorld(true);
    }
    this.editor.selection.select(objects, true);
  }

  undo() {
    const objects = this.objectUuids.map(uuid => this.editor.objectByUuid(uuid));
    for (let i = 0; i < objects.length; i++) {
      TransformUtils.setWorldScale(objects[i], this.oldScales[i]);
      objects[i].updateMatrixWorld(true);
    }
    this.editor.selection.select(objects, true);
  }

  toJSON() {
    return {
      type: SetScaleCommand.type,
      objectUuids: this.objectUuids,
      oldScales: this.oldScales.map(s => s.toArray()),
      newScales: this.newScales.map(s => s.toArray())
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetScaleCommand.type) return null;

    const command = new SetScaleCommand(editor);

    command.objectUuids = json.objectUuids;
    command.newScales = json.newScales.map(arr => new THREE.Vector3().fromArray(arr));
    command.oldScales = json.oldScales.map(arr => new THREE.Vector3().fromArray(arr));

    return command;
  }
}