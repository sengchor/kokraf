import * as THREE from 'three';

export class SwitchModeCommand {
  static type = 'SwitchModeCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D} object
   * @param {string} newMode
   * @param {string} previousMode
   * @param {string} paintMap
   * @constructor
   */
  constructor(editor, object = null, newMode = null, previousMode = null, paintMap = null) {
    this.editor = editor;
    this.name = 'Switch Mode';
    this.objectUuid = object ? object.uuid : null;
    this.newMode = newMode;
    this.previousMode = previousMode;
    this.paintMap = paintMap;
  }

  execute() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this._switch(this.object, this.newMode);
  }

  undo() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this._switch(this.object, this.previousMode);
  }

  _switch(object, mode) {
    const viewportControls = this.editor.viewportControls;

    if (mode === 'object') {
      viewportControls.enterObjectMode();
      this.editor.signals.modeChanged.dispatch('object');
    } else if (mode === 'edit') {
      this.editor.selection.select(object);
      viewportControls.enterEditMode(object);
      this.editor.signals.modeChanged.dispatch('edit');
    } else if (mode === 'paint') {
      this.editor.selection.select(object);
      viewportControls.enterPaintMode(object, this.paintMap || 'map');
      this.editor.signals.modeChanged.dispatch('paint');
    }
  }

  toJSON() {
    return {
      type: SwitchModeCommand.type,
      objectUuid: this.objectUuid,
      newMode: this.newMode,
      previousMode: this.previousMode,
      paintMap: this.paintMap,
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SwitchModeCommand.type) return null;

    const command = new SwitchModeCommand(editor);

    command.objectUuid = json.objectUuid;
    command.previousMode = json.previousMode;
    command.newMode = json.newMode;
    command.paintMap = json.paintMap || 'map';

    return command;
  }
}