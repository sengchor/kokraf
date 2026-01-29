import * as THREE from 'three';

export class DuplicateObjectCommand {
  static type = 'DuplicateObjectCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D[]} originals
   * @param {THREE.Object3D[]} duplicates
   * @constructor
   */
  constructor(editor, originals = [], duplicates = []) {
    this.editor = editor;
    this.name = 'Duplicate Objects';

    this.originalUuids = originals.map(object => object.uuid);

    this.duplicateStates = duplicates.map(duplicate => ({
      uuid: duplicate.uuid,
      json: duplicate.toJSON()
    }));
  }

  execute() {
    const sceneManager = this.editor.sceneManager;
    const loader = new THREE.ObjectLoader();
    const created = [];

    // Create all duplicates
    for (let i = 0; i < this.duplicateStates.length; i++) {
      const state = this.duplicateStates[i];
      const obj = loader.parse(state.json);
      obj.uuid = state.uuid;
      created[i] = obj;
    }

    // Attach with correct hierarchy
    for (let i = 0; i < this.originalUuids.length; i++) {
      const original = this.editor.objectByUuid(this.originalUuids[i]);
      if (!original) continue;

      const duplicate = created[i];
      if (!duplicate) continue;

      const originalParent = original.parent;
      let parent = sceneManager.mainScene;

      if (originalParent) {
        const parentIndex = this.originalUuids.indexOf(originalParent.uuid);
        parent = (parentIndex !== -1) ? created[parentIndex] : originalParent;
      }

      sceneManager.attachObjectLocal(duplicate, parent);
    }

    this.editor.selection.deselect();
    this.editor.selection.select(created);
    this.editor.toolbar.updateTools();
  }

  undo() {
    const sceneManager = this.editor.sceneManager;

    for (const { uuid } of this.duplicateStates) {
      const obj = this.editor.objectByUuid(uuid);
      if (obj) sceneManager.removeObject(obj);
    }

    this.editor.selection.deselect();
    this.editor.toolbar.updateTools();
  }

  toJSON() {
    return {
      type: DuplicateObjectCommand.type,
      originalUuids: this.originalUuids,
      duplicateStates: this.duplicateStates
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== DuplicateObjectCommand.type) return null;

    const cmd = new DuplicateObjectCommand(editor);
    cmd.originalUuids = json.originalUuids;
    cmd.duplicateStates = json.duplicateStates;

    return cmd;
  }
}