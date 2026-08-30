export class SetSeamCommand {
  static type = 'SetSeamCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {number[]|null} edgeIds
   * @param {boolean|null} value
   * @param {Object<number, boolean>|null} optionalOldState
   * @constructor
   */
  constructor(editor, object = null, edgeIds = null, value = null, optionalOldState = null) {
    this.editor = editor;

    this.objectUuid = object ? object.uuid : null;
    this.edgeIds = edgeIds ? [...edgeIds] : [];
    this.value = value;

    if (optionalOldState !== null) {
      this.oldState = optionalOldState;
    } else if (object) {
      const seamIds = SetSeamCommand._getSeamSet(object);
      this.oldState = {};
      for (const id of this.edgeIds) {
        this.oldState[id] = seamIds.has(id);
      }
    } else {
      this.oldState = {};
    }
  }

  get name() {
    return this.value ? 'Mark Seam' : 'Clear Seam';
  }

  static _getSeamSet(object) {
    const seam = object.userData.seam;
    if (seam instanceof Set) return seam;
    if (Array.isArray(seam)) {
      const set = new Set(seam);
      object.userData.seam = set;
      return set;
    }
    const set = new Set();
    object.userData.seam = set;
    return set;
  }

  _apply(useValueFn) {
    this.object = this.editor.objectByUuid(this.objectUuid);
    if (!this.object) return;

    const seamIds = SetSeamCommand._getSeamSet(this.object);

    for (const edgeId of this.edgeIds) {
      const shouldBeSeam = useValueFn(edgeId);
      if (shouldBeSeam) seamIds.add(edgeId);
      else seamIds.delete(edgeId);
    }

    this.editor.signals.seamsChanged.dispatch(this.object);
  }

  execute() {
    this._apply(() => this.value);
  }

  undo() {
    this._apply((edgeId) => this.oldState[edgeId] ?? false);
  }

  toJSON() {
    return {
      type: SetSeamCommand.type,
      objectUuid: this.objectUuid,
      edgeIds: this.edgeIds,
      value: this.value,
      oldState: this.oldState
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetSeamCommand.type) return null;

    const command = new SetSeamCommand(editor);
    command.objectUuid = json.objectUuid;
    command.edgeIds = json.edgeIds;
    command.value = json.value;
    command.oldState = json.oldState;

    return command;
  }
}