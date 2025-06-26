import * as THREE from 'three';

export class MoveObjectCommand {
  static type = 'MoveObjectCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {THREE.Object3D|null} newParent
   * @param {THREE.Object3D|null} oldParent
   * @constructor
   */
  constructor(editor, object = null, newParent = null, oldParent = null) {
    this.editor = editor;
    this.name = 'Move Object';

    this.objectUuid = object ? object.uuid : null;
    this.oldParentUuid = oldParent ? oldParent.uuid : (object && object.parent ? object.parent.uuid : null);
    this.newParentUuid = newParent ? newParent.uuid : null;
  }

  execute() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this.newParent = this.editor.objectByUuid(this.newParentUuid);
    this.newParent.attach(this.object);
    this.editor.signals.sceneGraphChanged.dispatch();
  }

  undo() {
    this.object = this.editor.objectByUuid(this.objectUuid);
    this.oldParent = this.editor.objectByUuid(this.oldParentUuid);
    this.oldParent.attach(this.object);
    this.editor.signals.sceneGraphChanged.dispatch();
  }

  toJSON() {
    return {
      type: MoveObjectCommand.type,
      objectUuid: this.objectUuid,
      oldParentUuid: this.oldParentUuid,
      newParentUuid: this.newParentUuid
    }
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== MoveObjectCommand.type) return null;

    const command = new MoveObjectCommand(editor);

    command.objectUuid = json.objectUuid;
    command.oldParentUuid = json.oldParentUuid;
    command.newParentUuid = json.newParentUuid;

    return command;
  }
}