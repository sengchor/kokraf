export class SetSelectionCommand {
  static type = 'SetSelectionCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D[]} newObjects
   * @param {THREE.Object3D[]|null} oldObjects
   */
  constructor(editor, newObjects = [], oldObjects = null) {
    this.editor = editor;
    this.name = 'Set Selection';
    this.newUuids = newObjects.map(o => o.uuid);
    this.oldUuids = (oldObjects ?? editor.selection.selectedObject).map(o => o.uuid);
  }

  execute() {
    this.apply(this.newUuids);
  }

  undo() {
    this.apply(this.oldUuids);
  }

  apply(uuids) {
    const objects = uuids
      .map(uuid => this.editor.objectByUuid(uuid))
      .filter(Boolean);

    this.editor.selection.setSelection(objects);
    this.editor.toolbar.updateTools();
  }

  toJSON() {
    return {
      type: SetSelectionCommand.type,
      newUuids: this.newUuids,
      oldUuids: this.oldUuids
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetSelectionCommand.type) return null;

    const cmd = new SetSelectionCommand(editor, [], []);
    cmd.newUuids = json.newUuids ?? [];
    cmd.oldUuids = json.oldUuids ?? [];
    return cmd;
  }
}