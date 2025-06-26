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
  constructor(editor, object = null, objectUuid = null, newPosition = null, optionalOldPosition = null) {
    this.editor = editor;
    this.name = 'Set Position';

    this.object = object;
    this.objectUuid = objectUuid;

    if (object != null) {
      this.oldPosition = object.position.clone();
    }
    this.newPosition = newPosition.clone();

    if (optionalOldPosition !== null) {
			this.oldPosition = optionalOldPosition.clone();
		}
  }

  execute() {
    if (this.object == null) {
      this.object = this.editor.objectByUuid(this.objectUuid);
    }
    this.object.position.copy(this.newPosition);
    this.object.updateMatrixWorld(true);
  }

  undo() {
    if (this.object == null) {
      this.object = this.editor.objectByUuid(this.objectUuid);
    }
    this.object.position.copy(this.oldPosition);
    this.object.updateMatrixWorld(true);
  }

  toJSON() {
    return {
      type: SetPositionCommand.type,
      objectUuid: this.object ? this.object.uuid : this.objectUuid,
      newPos: this.newPosition.toArray(),
      oldPos: this.oldPosition.toArray()
    }
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetPositionCommand.type) return null;

    const obj = editor.objectByUuid(json.objectUuid);
    const objUuid = json.objectUuid;
    const newPos = new THREE.Vector3().fromArray(json.newPos);
    const oldPos = new THREE.Vector3().fromArray(json.oldPos);

    return new SetPositionCommand(editor, obj, objUuid, newPos, oldPos);
  }
}