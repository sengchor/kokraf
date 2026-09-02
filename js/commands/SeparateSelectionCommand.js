import * as THREE from 'three';
import { SeamSnapshot } from '../uv/SeamSnapshot.js';

export class SeparateSelectionCommand {
  static type = 'SeparateSelectionCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {object|null} beforeSnapshot
   * @param {object|null} afterSnapshot
   * @param {object|null} newMeshData
   * @param {{before?: Set|Array, after?: Set|Array, separated?: Set|Array}} [seams]
   * @constructor
   */
  constructor(editor, object, beforeSnapshot, afterSnapshot, newMeshData, seams = {}) {
    this.editor = editor;
    this.name = 'Separate Selection';
    this.signals = editor.signals;
    this.vertexEditor = editor.vertexEditor;

    this.objectUuid = object ? object.uuid : null;

    this.beforeSnapshot = beforeSnapshot ?? null;
    this.afterSnapshot = afterSnapshot ?? null;
    this.newMeshData = newMeshData ?? null;

    this.beforeSeam = seams.before ? Array.from(seams.before) : [];
    this.afterSeam = seams.after ? Array.from(seams.after) : [];
    this.separatedSeam = seams.separated ? Array.from(seams.separated) : [];

    if (!object) return;
    this.parentUuid = object.parent ? object.parent.uuid : null;
    this.index = object.parent ? object.parent.children.indexOf(object) : -1;
    this.newObjectUuid = null;
  }

  execute() {
    this.editor.editSelection.clearSelection();

    this.applyDelta(this.afterSnapshot);

    const object = this.editor.objectByUuid(this.objectUuid);
    if (!object || !this.newMeshData) return;

    SeamSnapshot.write(object, this.afterSeam);
    this.signals.seamsChanged.dispatch(object);

    const newObject = this.editor.objectEditor.cloneObjectFromMeshData(this.newMeshData, object);

    if (!this.newObjectUuid) {
      this.newObjectUuid = newObject.uuid;
    } else {
      newObject.uuid = this.newObjectUuid;
    }

    SeamSnapshot.write(newObject, this.separatedSeam);

    const parent = this.editor.objectByUuid(this.parentUuid);
    this.editor.sceneManager.addObject(newObject, parent, this.index);

    this.editor.toolbar.updateTools();
  }

  undo() {
    this.editor.editSelection.clearSelection();

    this.applyDelta(this.beforeSnapshot);

    const object = this.editor.objectByUuid(this.objectUuid);
    if (object) {
      SeamSnapshot.write(object, this.beforeSeam);
      this.signals.seamsChanged.dispatch(object);
    }

    const newObject = this.editor.objectByUuid(this.newObjectUuid);
    if (newObject) {
      this.editor.sceneManager.detachObject(newObject);
      this.editor.sceneManager.removeObject(newObject);
    }

    this.editor.toolbar.updateTools();
  }

  applyDelta(delta) {
    const object = this.editor.objectByUuid(this.objectUuid);
    if (!object || !delta) return;

    this.vertexEditor.setObject(object);
    this.vertexEditor.applyDelta(delta);
  }

  toJSON() {
    return {
      type: SeparateSelectionCommand.type,
      objectUuid: this.objectUuid,
      beforeSnapshot: this.beforeSnapshot,
      afterSnapshot: this.afterSnapshot,
      newMeshData: this.newMeshData,
      parentUuid: this.parentUuid,
      index: this.index,
      newObjectUuid: this.newObjectUuid,
      beforeSeam: this.beforeSeam,
      afterSeam: this.afterSeam,
      separatedSeam: this.separatedSeam
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SeparateSelectionCommand.type) return null;

    const seams = {
      before: json.beforeSeam,
      after: json.afterSeam,
      separated: json.separatedSeam
    };

    const cmd = new SeparateSelectionCommand(editor, null, json.beforeSnapshot, json.afterSnapshot, json.newMeshData, seams);
    cmd.objectUuid = json.objectUuid;
    cmd.parentUuid = json.parentUuid;
    cmd.index = json.index;
    cmd.newObjectUuid = json.newObjectUuid;

    return cmd;
  }
}