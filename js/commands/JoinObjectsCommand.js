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

    this.prevSelection = editor.selection.selectedObjects.map(o => o.uuid);
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

    // Keep non-joined selected objects, swap the sources for the result
    const sourceUuids = new Set(this.objectStates.map(s => s.uuid));
    const kept = this.resolve(this.prevSelection.filter(uuid => !sourceUuids.has(uuid)));

    this.editor.selection.setSelection([...kept, joined]);
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
      
      let parent = 
        this.editor.objectByUuid(state.parentUuid) ||
        restoredObjects.get(state.parentUuid) ||
        sceneManager.mainScene;

      sceneManager.addObject(obj, parent, state.index);
    }

    // Restore original children
    for (let i = 0; i < this.objectStates.length; i++) {
      const state = this.objectStates[i];
      if (state.childrenUuids.length) continue;

      const obj = restoredObjects.get(state.uuid) || this.editor.objectByUuid(state.uuid);
      for (const childUuid of state.childrenUuids) {
        const child = this.editor.objectByUuid(childUuid);
        if (obj && child) sceneManager.attachObject(child, obj);
      }
    }

    for (const state of this.objectStates) {
      const obj = this.editor.objectByUuid(state.uuid);
      if (obj) this.editor.signals.seamsChanged.dispatch(obj);
    }

    this.editor.selection.setSelection(this.resolve(this.prevSelection));
    this.editor.toolbar.updateTools();
  }

  resolve(uuids) {
    return uuids
      .map(uuid => this.editor.objectByUuid(uuid))
      .filter(Boolean);
  }
  
  toJSON() {
    return {
      type: JoinObjectsCommand.type,
      joinedObjectUuid: this.joinedObjectUuid,
      joinedObjectJSON: this.joinedObjectJSON,
      joinedSeam: this.joinedSeam,
      objectStates: this.objectStates,
      prevSelection: [...this.prevSelection]
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== JoinObjectsCommand.type) return null;

    const cmd = new JoinObjectsCommand(editor);

    cmd.joinedObjectUuid = json.joinedObjectUuid;
    cmd.joinedObjectJSON = json.joinedObjectJSON;
    cmd.joinedSeam = json.joinedSeam ?? null;
    cmd.objectStates = json.objectStates ?? [];
    cmd.prevSelection = json.prevSelection ?? [];

    return cmd;
  }

  serializeObjectWithoutChildren(object) {
    const clone = object.clone(false);
    clone.children.length = 0;
    return clone.toJSON();
  }
}