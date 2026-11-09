import { ShadingUtils } from "../utils/ShadingUtils.js";

export class SetShadingCommand {
  static type = 'SetShadingCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {{ mode?: 'flat'|'smooth'|'auto', angle?: number }} patch
   * @constructor 
   */
  constructor(editor, object = null, patch = {}) {
    this.editor = editor;
    this.signals = editor.signals;
    this.name = `Set Shading`;

    this.objectUuid = object ? object.uuid : null;

    this.oldState = object ? ShadingUtils.getShading(object) : null;
    this.newState = object ? ShadingUtils.normalize({ ...this.oldState, ...patch }) : null;
  }

  execute() {
    this._apply(this.newState);
  }

  undo() {
    this._apply(this.oldState);
  }

  _apply(state) {
    this.object = this.editor.objectByUuid(this.objectUuid);
    if (!this.object || !state) return;

    ShadingUtils.setShading(this.object, state);
    this.signals.objectShadingChanged.dispatch(this.object);
  }

  toJSON() {
    return {
      type: SetShadingCommand.type,
      objectUuid: this.objectUuid,
      oldState: this.oldState,
      newState: this.newState,
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetShadingCommand.type) return null;

    const command = new SetShadingCommand(editor);
    command.objectUuid = json.objectUuid;

    command.oldState = ShadingUtils.normalize(json.oldState ?? { mode: json.oldMode });
    command.newState = ShadingUtils.normalize(json.newState ?? { mode: json.newMode });

    return command;
  }
}