const emptySnapshot = () => ({ vertexIds: [], edgeIds: [], faceIds: [] });

const normalizeSnapshot = (s) => ({
  vertexIds: [...(s?.vertexIds ?? [])],
  edgeIds: [...(s?.edgeIds ?? [])],
  faceIds: [...(s?.faceIds ?? [])],
});

export class SetEditSelectionCommand {
  static type = 'SetEditSelectionCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {EditSelectionSnapshot} newState
   * @param {EditSelectionSnapshot|null} oldState
   */
  constructor(editor, object, newState = emptySnapshot(), oldState = null) {
    this.editor = editor;
    this.name = 'Set Edit Selection';
    this.objectUuid = object?.uuid ?? null;
    this.newState = normalizeSnapshot(newState);
    this.oldState = normalizeSnapshot(oldState ?? editor.editSelection.getSnapshot());
  }

  execute() {
    this.apply(this.newState);
  }

  undo() {
    this.apply(this.oldState);
  }

  apply(state) {
    const editSelection = this.editor.editSelection;
    const object = this.editor.objectByUuid(this.objectUuid);

    if (!object || object !== editSelection.editedObject) return;

    editSelection.setSelection(state);
  }

  toJSON() {
    return {
      type: SetEditSelectionCommand.type,
      objectUuid: this.objectUuid,
      newState: this.newState,
      oldState: this.oldState
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetEditSelectionCommand.type) return null;

    const command = new SetEditSelectionCommand(editor, null, emptySnapshot(), emptySnapshot());
    command.objectUuid = json.objectUuid ?? null;
    command.newState = normalizeSnapshot(json.newState);
    command.oldState = normalizeSnapshot(json.oldState);
    return command;
  }
}