import * as THREE from 'three';

export class SwitchSubModeCommand {
  static type = 'SwitchSubModeCommand';

  /**
   * @param {Editor} editor 
   * @param {string} newMode ('vertex', 'edge', 'face')
   * @param {string} previousMode 
   * @constructor
   */
  constructor(editor, newMode = null, previousMode = null) {
    this.editor = editor;
    this.name = 'Switch Sub-Selection Mode';
    this.newMode = newMode;
    this.previousMode = previousMode;
  }

  execute() {
    const editSelection = this.editor.editSelection;
    editSelection.setSubSelectionMode(this.newMode);

    this.editor.signals.subSelectionModeChanged.dispatch(this.newMode);
  }

  undo() {
    const editSelection = this.editor.editSelection;
    editSelection.setSubSelectionMode(this.previousMode);

    this.editor.signals.subSelectionModeChanged.dispatch(this.previousMode);
  }

  toJSON() {
    return {
      type: SwitchSubModeCommand.type,
      newMode: this.newMode,
      previousMode: this.previousMode
    }
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SwitchSubModeCommand.type) return null;

    const command = new SwitchSubModeCommand(editor);

    command.previousMode = json.previousMode;
    command.newMode = json.newMode;

    return command;
  }
}