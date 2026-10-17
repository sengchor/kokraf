import { MeshDeltaCommand } from "./MeshDeltaCommand.js";

export class ApplyMirrorCommand extends MeshDeltaCommand {
  static type = 'ApplyMirrorCommand';

  constructor(editor, object, beforeDelta, afterDelta, mirrorSettings = null) {
    super(editor, object, beforeDelta, afterDelta, 'Apply Mirror');
    this.mirrorSettings = mirrorSettings ? structuredClone(mirrorSettings) : null;
  }

  execute() {
    super.execute();
    this.setMirror(this.mirrorSettings && { ...this.mirrorSettings, enabled: false });
  }

  undo() {
    super.undo();
    this.setMirror(this.mirrorSettings);
  }

  setMirror(settings) {
    const object = this.editor.objectByUuid(this.objectUuid);
    if (!object || !settings) return;

    object.userData.mirror = structuredClone(settings);
    this.editor.mirrorManager?.markDirty(object);
    this.signals.mirrorChanged?.dispatch(object);
  }

  toJSON() {
    return { ...super.toJSON(), mirrorSettings: this.mirrorSettings };
  }

  static fromJSON(editor, json) {
    const command = super.fromJSON(editor, json);
    if (command) command.mirrorSettings = json.mirrorSettings ?? null;
    return command;
  }
}