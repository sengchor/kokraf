import * as THREE from 'three';

export class SetValueCommand {
  static type = 'SetValueCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D||null} object
   * @param {string} attributeName
   * @param {number|string|boolean|object|null} newValue
   */
  constructor(editor, object = null, attributeName = '', newValue = null) {
    this.editor = editor;
    this.name = `Set Value: ${attributeName}`;

    this.attributeName = attributeName;
    this.objectUuid = object ? object.uuid : null;
    this.oldValue = (object !== null) ? object[attributeName] : null;
    this.newValue = newValue;
  }

  execute() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this.object[this.attributeName] = this.newValue;
    this.editor.signals.objectChanged.dispatch();
  }

  undo() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this.object[this.attributeName] = this.oldValue;
    this.editor.signals.objectChanged.dispatch();
  }

  toJSON() {
    return {
      type: SetValueCommand.type,
      objectUuid: this.objectUuid,
      attributeName: this.attributeName,
      oldValue: this.oldValue,
      newValue: this.newValue
    }
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetValueCommand.type) return null;

    const command = new SetValueCommand(editor, null, json.attributeName);

    command.objectUuid = json.objectUuid;
    command.oldValue = json.oldValue;
    command.newValue = json.newValue;

    return command;
  }
}