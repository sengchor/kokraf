import * as THREE from 'three';

export class SetVisibilityCommand {
  static type = 'SetVisibilityCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D} object
   * @param {boolean} visible
   */
  constructor(editor, object = null, visible = true) {
    this.editor = editor;
    this.name = 'Set Visibility';

    this.objectUuid = object ? object.uuid : null;
    this.oldValue = object ? object.visible : null;
    this.newValue = visible;
  }

  execute() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this._apply(this.newValue);
  }

  undo() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this._apply(this.oldValue);
  }

  _apply(visible) {
    this.object.visible = visible;

    const helper = this.editor.sceneManager.helpers[this.object.id];
    if (helper) helper.visible = visible;

    this.editor.signals.objectChanged.dispatch();
  }

  toJSON() {
    return {
      type: SetVisibilityCommand.type,
      objectUuid: this.objectUuid,
      oldValue: this.oldValue,
      newValue: this.newValue
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetVisibilityCommand.type) return null;

    const command = new SetVisibilityCommand(editor, null, json.newValue);

    command.objectUuid = json.objectUuid;
    command.oldValue = json.oldValue;

    return command;
  }
}