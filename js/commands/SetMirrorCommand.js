export class SetMirrorCommand {
  static type = 'SetMirrorCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {object|null} newSettings
   * @param {object|null} optionalOldSettings
   * @constructor
   */
  constructor(editor, object = null, newSettings = null, optionalOldSettings = null) {
    this.editor = editor;
    this.name = 'Set Mirror';

    this.objectUuid = object ? object.uuid : null;

    const oldSettings = optionalOldSettings ?? object?.userData?.mirror ?? null;
    this.newSettings = newSettings ? structuredClone(newSettings) : null;
    this.oldSettings = oldSettings ? structuredClone(oldSettings) : null;
  }

  execute() {
    this.applySettings(this.newSettings);
  }

  undo() {
    this.applySettings(this.oldSettings);
  }

  applySettings(settings) {
    const object = this.editor.objectByUuid(this.objectUuid);
    if (!object) return;

    if (settings) object.userData.mirror = structuredClone(settings);
    else delete object.userData.mirror;

    this.editor.mirrorManager?.markDirty(object);
    this.editor.signals.mirrorChanged?.dispatch(object);
  }

  toJSON() {
    return {
      type: SetMirrorCommand.type,
      objectUuid: this.objectUuid,
      newSettings: this.newSettings,
      oldSettings: this.oldSettings,
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetMirrorCommand.type) return null;

    const command = new SetMirrorCommand(editor);
    
    command.objectUuid = json.objectUuid;
    command.newSettings = json.newSettings;
    command.oldSettings = json.oldSettings;

    return command;
  }
}