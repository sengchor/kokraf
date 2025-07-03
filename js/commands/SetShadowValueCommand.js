import * as THREE from 'three';

export class SetShadowValueCommand {
  static type = 'SetShadowValueCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Light} object
   * @param {string} attributeName
   * @param {number|string|boolean} newValue
   */
  constructor(editor, object = null, attributeName = '', newValue = null) {
    this.editor = editor;
    this.name = `Set Shadow Value: ${attributeName}`;

    this.attributeName = attributeName;
    this.objectUuid = object ? object.uuid : null;
    this.oldValue = object?.shadow?.[attributeName];
    this.newValue = newValue;
  }

  execute() {
    const light = this.editor.objectByUuid(this.objectUuid);
    if (!light || !light.shadow) return;

    this.object = light;
    this.object.shadow[this.attributeName] = this.newValue;
    this.editor.signals.objectChanged.dispatch();
  }

  undo() {
    const light = this.editor.objectByUuid(this.objectUuid);
    if (!light || !light.shadow) return;

    this.object = light;
    this.object.shadow[this.attributeName] = this.oldValue;
    this.editor.signals.objectChanged.dispatch();
  }

  toJSON() {
    return {
      type: SetShadowValueCommand.type,
      objectUuid: this.objectUuid,
      attributeName: this.attributeName,
      oldValue: this.oldValue,
      newValue: this.newValue
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetShadowValueCommand.type) return null;

    const command = new SetShadowValueCommand(editor, null, json.attributeName);
    command.objectUuid = json.objectUuid;
    command.oldValue = json.oldValue;
    command.newValue = json.newValue;

    return command;
  }
}
