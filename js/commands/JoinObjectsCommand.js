import * as THREE from 'three';
import { SeamSnapshot } from '../uv/SeamSnapshot.js';

export class JoinObjectsCommand {
  static type = 'JoinObjectsCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D[]} objects
   * @param {THREE.Object3D} joinedObject
   * @constructor
   */
  constructor(editor, objects = [], joinedObject = null) {
    this.editor = editor;
    this.name = 'Join Objects';

    this.joinedObjectUuid = joinedObject ? joinedObject.uuid : null;
    this.joinedObjectJSON = joinedObject ? joinedObject.toJSON() : null;
    this.joinedSeam = joinedObject ? SeamSnapshot.read(joinedObject) : null;

    // Store original objects state
    this.objectStates = objects.map(obj => ({
      uuid: obj.uuid,
      parentUuid: obj.parent ? obj.parent.uuid : null,
      index: obj.parent ? obj.parent.children.indexOf(obj) : -1,
      json: this.serializeObjectWithoutChildren(obj),
      childrenUuids: obj.children.map(child => child.uuid),
      seam: SeamSnapshot.read(obj)
    }));
  }

  execute() {
    const sceneManager = this.editor.sceneManager;
    const primaryState = this.objectStates[this.objectStates.length - 1];
    const primary = this.editor.objectByUuid(primaryState.uuid);
    if (!primary) return;

    let joined = this.editor.objectByUuid(this.joinedObjectUuid);
    if (!joined) {
      joined = new THREE.ObjectLoader().parse(this.joinedObjectJSON);
    }
    
    // set before the object enters the scene so helpers read a real Set
    if (this.joinedSeam) SeamSnapshot.write(joined, this.joinedSeam);

    for (let i = 0; i < this.objectStates.length - 1; i++) {
      const obj = this.editor.objectByUuid(this.objectStates[i].uuid);
      sceneManager.detachObject(obj);
    }

    // Replace primary object with joined
    sceneManager.replaceObject(joined, primary);

    for (let i = 0; i < this.objectStates.length - 1; i++) {
      const obj = this.editor.objectByUuid(this.objectStates[i].uuid);
      sceneManager.removeObject(obj);
    }

    this.editor.signals.seamsChanged.dispatch(joined);

    this.editor.selection.deselect();
    this.editor.selection.select(joined);
    this.editor.toolbar.updateTools();
  }

  undo() {
    const sceneManager = this.editor.sceneManager;
    const loader = new THREE.ObjectLoader();
    const joined = this.editor.objectByUuid(this.joinedObjectUuid);

    // Remove the joined result
    if (joined) {
      sceneManager.detachObject(joined);
      sceneManager.removeObject(joined);
    }

    // Re-instantiate all objects
    const restoredObjects = new Map();
    
    for (let i = 0; i < this.objectStates.length; i++) {
      const state = this.objectStates[i];
      const obj = loader.parse(state.json);
      obj.uuid = state.uuid;
      SeamSnapshot.write(obj, state.seam ?? []);
      restoredObjects.set(state.uuid, obj);
    }

    // Restore Hierarchy
    for (let i = 0; i < this.objectStates.length; i++) {
      const state = this.objectStates[i];
      const obj = restoredObjects.get(state.uuid);
      
      let parent = this.editor.objectByUuid(state.parentUuid) || restoredObjects.get(state.parentUuid);
      if (!parent) {
        parent = sceneManager.mainScene; 
      }

      sceneManager.addObject(obj, parent, state.index);
    }

    // Restore original children
    for (let i = 0; i < this.objectStates.length; i++) {
      const state = this.objectStates[i];
      if (state.childrenUuids.length > 0) {
        const obj = restoredObjects.get(state.uuid) || this.editor.objectByUuid(state.uuid);
        for (const childUuid of state.childrenUuids) {
          const child = this.editor.objectByUuid(childUuid);

          if (obj && child) {
            sceneManager.attachObject(child, obj);
          }
        }
      }
    }

    const objects = this.objectStates
      .map(s => this.editor.objectByUuid(s.uuid))
      .filter(Boolean);

    for (const obj of objects) this.editor.signals.seamsChanged.dispatch(obj);

    this.editor.selection.deselect();
    this.editor.selection.select(objects);
    this.editor.toolbar.updateTools();
  }
  
  toJSON() {
    return {
      type: JoinObjectsCommand.type,
      joinedObjectUuid: this.joinedObjectUuid,
      joinedObjectJSON: this.joinedObjectJSON,
      joinedSeam: this.joinedSeam,
      objectStates: this.objectStates
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== JoinObjectsCommand.type) return null;

    const cmd = new JoinObjectsCommand(editor);

    cmd.joinedObjectUuid = json.joinedObjectUuid;
    cmd.joinedObjectJSON = json.joinedObjectJSON;
    cmd.joinedSeam = json.joinedSeam ?? null;
    cmd.objectStates = json.objectStates;

    return cmd;
  }

  serializeObjectWithoutChildren(object) {
    const clone = object.clone(false);
    clone.children.length = 0;
    return clone.toJSON();
  }
}