import * as THREE from 'three';

export class SetScaleCommand {
  static type = 'SetScaleCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {THREE.Vector3|null} newScale
   * @param {THREE.Vector3|null} optionalOldScale
   * @constructor
   */
  constructor(editor, object = null, newScale = null, optionalOldScale = null) {
    this.editor = editor;
    this.name = 'Set Scale';

    this.objectUuid = object ? object.uuid : null;

    this.newScale = newScale ? newScale.clone() : new THREE.Vector3();
    this.oldScale = optionalOldScale ? optionalOldScale.clone() : (object ? object.scale.clone() : new THREE.Vector3());
  }

  execute() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this.object.scale.copy(this.newScale);
    this.object.updateMatrixWorld(true);
  }

  undo() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this.object.scale.copy(this.oldScale);
    this.object.updateMatrixWorld(true);
  }

  toJSON() {
    return {
      type: SetScaleCommand.type,
      objectUuid: this.objectUuid,
      oldScale: this.oldScale.toArray(),
      newScale: this.newScale.toArray()
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetScaleCommand.type) return null;

    const command = new SetScaleCommand(editor);

    command.objectUuid = json.objectUuid;
    command.newScale = new THREE.Euler().fromArray(json.newScale);
    command.oldScale = new THREE.Euler().fromArray(json.oldScale);

    return command;
  }
}