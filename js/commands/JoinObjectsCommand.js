import * as THREE from 'three';

export class JoinObjectsCommand {
  static type = 'JoinObjectsCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D[]} objects
   * @param {THREE.Object3D} joinedObject
   * @constructor
   */
  constructor (editor, objects = [], joinedObject = null) {
    this.editor = editor;
    this.name = 'Join Objects';

    this.joinedObjectUuid = joinedObject ? joinedObject.uuid : null;
    this.joinedObjectJSON = joinedObject ? joinedObject.toJSON() : null;
    this.joinedParentUuid = objects[0]?.parent?.uuid || null;

    this.objectStates = objects.map(obj => ({
      uuid: obj.uuid,
      parentUuid: obj.parent?.uuid || null,
      index: obj.parent ? obj.parent.children.indexOf(obj) : -1,
      json: obj.toJSON()
    }));
  }

  execute() {
    const sceneManager = this.editor.sceneManager;

    this.objectStates.forEach(state => {
      const obj = this.editor.objectByUuid(state.uuid);
      if (obj) sceneManager.removeObject(obj);
    });

    let joined = this.editor.objectByUuid(this.joinedObjectUuid);
    if (!joined) {
      const loader = new THREE.ObjectLoader();
      joined = loader.parse(this.joinedObjectJSON);
    }

    sceneManager.addObject(joined, this.editor.objectByUuid(this.joinedParentUuid));

    this.editor.selection.deselect();
    this.editor.selection.select(joined);
    this.editor.toolbar.updateTools();
  }

  undo() {
    const sceneManager = this.editor.sceneManager;
    const loader = new THREE.ObjectLoader();

    const joined = this.editor.objectByUuid(this.joinedObjectUuid);
    if (joined) sceneManager.removeObject(joined);

    this.objectStates.forEach(state => {
      let obj = this.editor.objectByUuid(state.uuid);

      if (!obj) {
        obj = loader.parse(state.json);
      }

      const parent = this.editor.objectByUuid(state.parentUuid);
      sceneManager.addObject(obj, parent, state.index);
    });

    const objects = this.objectStates
      .map(s => this.editor.objectByUuid(s.uuid))
      .filter(Boolean);

    this.editor.selection.deselect();
    this.editor.selection.select(objects);
    this.editor.toolbar.updateTools();
  }

  toJSON() {
    return {
      type: JoinObjectsCommand.type,
      joinedObjectUuid: this.joinedObjectUuid,
      joinedObjectJSON: this.joinedObjectJSON,
      joinedParentUuid: this.joinedParentUuid,
      objectStates: this.objectStates
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== JoinObjectsCommand.type) return null;

    const cmd = new JoinObjectsCommand(editor);

    cmd.joinedObjectUuid = json.joinedObjectUuid;
    cmd.joinedObjectJSON = json.joinedObjectJSON;
    cmd.joinedParentUuid = json.joinedParentUuid;

    cmd.objectStates = json.objectStates;

    return cmd;
  }
}