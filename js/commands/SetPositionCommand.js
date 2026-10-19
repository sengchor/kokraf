import * as THREE from 'three';
import { TransformUtils } from '../utils/TransformUtils.js';

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
    this.apply(this.newPositions);
  }

  undo() {
    this.apply(this.oldPositions);
  }

  apply(positions) {
    for (let i = 0; i < this.objectUuids.length; i++) {
      const object = this.editor.objectByUuid(this.objectUuids[i]);
      if (!object) continue;

      TransformUtils.setWorldPosition(object, positions[i]);
      object.updateMatrixWorld(true);
    }

    this.editor.selection.updatePivotHandle();
    this.editor.signals.objectChanged.dispatch();
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