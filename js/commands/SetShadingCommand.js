import { ShadingUtils } from "../utils/ShadingUtils.js";

export class SetShadingCommand {
  static type = 'SetShadingCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {"flat"|"smooth"|"auto"|"null"} newMode
   * @param {"flat"|"smooth"|"auto"|"null"} optionalOldMode
   * @constructor 
   */
  constructor(editor, object = null, newMode = null, optionalOldMode = null) {
    this.editor = editor;
    this.name = `Set Shading`;

    this.objectUuid = object ? object.uuid : null;

    this.newMode = newMode;
    this.oldMode = optionalOldMode !== null ? optionalOldMode : (object ? object.userData.shading : null);
  }

  execute() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this.object.userData.shading = this.newMode;
    ShadingUtils.applyShading(this.object, this.newMode);
  }

  undo() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this.object.userData.shading = this.oldMode;
    ShadingUtils.applyShading(this.object, this.oldMode);
  }

  toJSON() {
    return {
      type: SetShadingCommand.type,
      objectUuid: this.objectUuid,
      newMode: this.newMode,
      oldMode: this.oldMode
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetShadingCommand.type) return null;

    const command = new SetShadingCommand(editor);

    command.objectUuid = json.objectUuid;
    command.newMode = json.newMode;
    command.oldMode = json.oldMode;

    return command;
  }
}