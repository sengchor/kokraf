import * as THREE from 'three';

export class SetUserDataValueCommand {
  static type = 'SetUserDataValueCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {string} attributeName
   * @param {number|string|boolean|object|null} newValue
   */
  constructor(editor, object = null, attributeName = '', newValue = null) {
    this.editor = editor;
    this.name = `Set UserData: ${attributeName}`;

    this.attributeName = attributeName;
    this.objectUuid = object ? object.uuid : null;
    this.oldValue = (object !== null) ? object.userData[attributeName] : null;
    this.newValue = newValue;
  }

  execute() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this.object.userData[this.attributeName] = this.newValue;
    this.editor.signals.objectChanged.dispatch();
  }

  undo() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this.object.userData[this.attributeName] = this.oldValue;
    this.editor.signals.objectChanged.dispatch();
  }

  toJSON() {
    return {
      type: SetUserDataValueCommand.type,
      objectUuid: this.objectUuid,
      attributeName: this.attributeName,
      oldValue: this.oldValue,
      newValue: this.newValue
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetUserDataValueCommand.type) return null;

    const command = new SetUserDataValueCommand(editor, null, json.attributeName);

    command.objectUuid = json.objectUuid;
    command.oldValue = json.oldValue;
    command.newValue = json.newValue;

    return command;
  }
}