import * as THREE from 'three';

export class SetScaleCommand {
  static type = 'SetScaleCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {THREE.Euler|null} newScale
   * @param {THREE.Euler|null} optionalOldScale
   * @constructor
   */
  constructor(editor, object = null, objectUuid = null, newScale = null, optionalOldScale = null) {
    this.editor = editor;
    this.name = 'Set Scale';

    this.object = object;
    this.objectUuid = objectUuid;

    if (object != null) {
      this.oldScale = object.scale.clone();
    }
    this.newScale = newScale.clone();

    if (optionalOldScale !== null) {
      this.oldScale = optionalOldScale.clone();
    }
  }

  execute() {
    if (this.object == null) {
      this.object = this.editor.objectByUuid(this.objectUuid);
    }
    this.object.scale.copy(this.newScale);
    this.object.updateMatrixWorld(true);
  }

  undo() {
    if (this.object == null) {
      this.object = this.editor.objectByUuid(this.objectUuid);
    }
    this.object.scale.copy(this.oldScale);
    this.object.updateMatrixWorld(true);
  }

  toJSON() {
    return {
      type: SetScaleCommand.type,
      objectUuid: this.object ? this.object.uuid : this.objectUuid,
      oldScale: this.oldScale.toArray(),
      newScale: this.newScale.toArray()
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetScaleCommand.type) return null;

    const obj = editor.objectByUuid(json.objectUuid);
    const objUuid = json.objectUuid;
    const newScale = new THREE.Vector3().fromArray(json.newScale);
    const oldScale = new THREE.Vector3().fromArray(json.oldScale);

    return new SetScaleCommand(editor, obj, objUuid, newScale, oldScale);
  }
}