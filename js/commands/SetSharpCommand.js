export class SetSharpCommand {
  static type = 'SetSharpCommand';

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
      const sharpIds = SetSharpCommand._getSharpSet(object);
      this.oldState = {};
      for (const id of this.edgeIds) {
        this.oldState[id] = sharpIds.has(id);
      }
    } else {
      this.oldState = {};
    }
  }

  get name() {
    return this.value ? 'Mark Sharp' : 'Clear Sharp';
  }

  static _getSharpSet(object) {
    const sharps = object.userData.sharp;
    if (sharps instanceof Set) return sharps;
    if (Array.isArray(sharps)) {
      const set = new Set(sharps);
      object.userData.sharp = set;
      return set;
    }
    const set = new Set();
    object.userData.sharp = set;
    return set;
  }

  _apply(useValueFn) {
    this.object = this.editor.objectByUuid(this.objectUuid);
    if (!this.object) return;

    const sharpIds = SetSharpCommand._getSharpSet(this.object);

    for (const edgeId of this.edgeIds) {
      const shouldBeSharp = useValueFn(edgeId);
      if (shouldBeSharp) sharpIds.add(edgeId);
      else sharpIds.delete(edgeId);
    }

    this.editor.signals.sharpsChanged.dispatch(this.object);
  }

  execute() {
    this._apply(() => this.value);
  }

  undo() {
    this._apply((edgeId) => this.oldState[edgeId] ?? false);
  }

  toJSON() {
    return {
      type: SetSharpCommand.type,
      objectUuid: this.objectUuid,
      edgeIds: this.edgeIds,
      value: this.value,
      oldState: this.oldState
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetSharpCommand.type) return null;

    const command = new SetSharpCommand(editor);
    command.objectUuid = json.objectUuid;
    command.edgeIds = json.edgeIds;
    command.value = json.value;
    command.oldState = json.oldState;

    return command;
  }
}