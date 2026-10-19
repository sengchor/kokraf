import * as THREE from 'three';

export class RemoveObjectCommand {
  static type = 'RemoveObjectCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D} object
   * @constructor
   */
  constructor(editor, object = null) {
    this.editor = editor;
    this.name = 'Remove Object';
    this.prevSelection = [];
    if (!object) return;

    this.objectUuid = object.uuid;
    this.parentUuid = object.parent ? object.parent.uuid : null;
    this.index = object.parent ? object.parent.children.indexOf(object) : -1;
    this.childrenUuids = object.children.map(child => child.uuid);
    this.objectJSON = this.serializeObjectWithoutChildren(object);
    this.prevSelection = editor.selection.selectedObjects.map(o => o.uuid);
  }

  execute() {
    const sceneManager = this.editor.sceneManager;
    const object = this.editor.objectByUuid(this.objectUuid);
    if (!object) return;
    
    sceneManager.detachObject(object);
    sceneManager.removeObject(object);

    const remaining = this.resolve(
      this.prevSelection.filter(uuid => uuid !== this.objectUuid)
    );
    this.editor.selection.setSelection(remaining);
    this.editor.toolbar.updateTools();
  }

  undo() {
    const sceneManager = this.editor.sceneManager;
    const loader = new THREE.ObjectLoader();

    const object = loader.parse(this.objectJSON);
    object.uuid = this.objectUuid;

    const parent = this.editor.objectByUuid(this.parentUuid) || sceneManager.mainScene;
    sceneManager.addObject(object, parent, this.index);

    for (const childUuid of this.childrenUuids) {
      const child = this.editor.objectByUuid(childUuid);

      if (child) sceneManager.attachObject(child, object);
    }

    this.editor.selection.setSelection(this.resolve(this.prevSelection));
    this.editor.toolbar.updateTools();
  }

  resolve(uuids) {
    return uuids
      .map(uuid => this.editor.objectByUuid(uuid)).filter(Boolean);
  }

  toJSON() {
    return {
      type: RemoveObjectCommand.type,
      objectUuid: this.objectUuid,
      objectJSON: this.objectJSON,
      parentUuid: this.parentUuid,
      index: this.index,
      childrenUuids: this.childrenUuids,
      prevSelection: [...this.prevSelection]
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== RemoveObjectCommand.type) return null;

    const cmd = new RemoveObjectCommand(editor);
    cmd.objectUuid = json.objectUuid;
    cmd.index = json.index;
    cmd.parentUuid = json.parentUuid;
    cmd.childrenUuids = json.childrenUuids ?? [];
    cmd.objectJSON = json.objectJSON;
    cmd.prevSelection = json.prevSelection ?? [];

    return cmd;
  }

  serializeObjectWithoutChildren(object) {
    const clone = object.clone(false);
    clone.children.length = 0;
    return clone.toJSON();
  }
}