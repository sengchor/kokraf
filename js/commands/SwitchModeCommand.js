import * as THREE from 'three';
import { MODES } from '../core/ModeManager.js';

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
    const def = MODES[mode];
    if (!def) return;

    const modeManager = this.editor.modeManager;

    if (def.requiresMesh && !modeManager.isValidMesh(object)) {
      modeManager.setMode('object');
      return;
    }

    if (mode !== 'object') {
      this.editor.selection.select(object);
    }

    modeManager.setMode(mode, object, { paintMap: this.paintMap || 'map' });
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