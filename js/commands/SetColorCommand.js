import * as THREE from 'three';

export class SetColorCommand {
  static type = 'SetColorCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {string} attributeName
   * @param {number} newValue
   */
  constructor(editor, object = null, attributeName = '', newValue = 0xffffff) {
    this.editor = editor;
    this.name = `Set Color: ${attributeName}`;

    this.attributeName = attributeName;
    this.objectUuid = object ? object.uuid : null;

    this.oldValue = object ? object[attributeName].getHex() : null;
    this.newValue = newValue;
  }

  execute() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this.object[this.attributeName].setHex(this.newValue);
    this.editor.signals.objectChanged.dispatch(this.object);
  }

  undo() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this.object[this.attributeName].setHex(this.oldValue);
    this.editor.signals.objectChanged.dispatch(this.object);
  }

  toJSON() {
    return {
      type: SetColorCommand.type,
      objectUuid: this.objectUuid,
      attributeName: this.attributeName,
      oldValue: this.oldValue,
      newValue: this.newValue
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetColorCommand.type) return null;

    const command = new SetColorCommand(editor, null, json.attributeName, json.newValue);
    command.objectUuid = json.objectUuid;
    command.oldValue = json.oldValue;

    return command;
  }
}
