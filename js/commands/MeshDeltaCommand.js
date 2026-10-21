import * as THREE from 'three';
import { SeamSnapshot } from '../uv/SeamSnapshot.js';

export class MeshDeltaCommand {
  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {object|null} beforeDelta
   * @param {object|null} afterDelta
   * @param {string} name
   */
  constructor(editor, object, beforeDelta, afterDelta, name = 'MeshDeltaCommand') {
    this.editor = editor;
    this.signals = editor.signals;
    this.vertexEditor = editor.vertexEditor;
    this.name = name;
    this.objectUuid = object ? object.uuid : null;

    this.beforeDelta = beforeDelta ? structuredClone(beforeDelta) : null;
    this.afterDelta = afterDelta ? structuredClone(afterDelta) : null;

    this.beforeSelection = null;
    this.afterSelection = null;

    this.seam = new SeamSnapshot(editor, object);

    if (object) {
      const renderBuffer = object.userData.renderBuffer;
      if (renderBuffer?.slotAllocator?.utilization < 0.25) {
        this.vertexEditor.setObject(object);
        this.vertexEditor.updateGeometryAndHelpers();
      }
    }
  }

  setSelectionStates(beforeSelection, afterSelection) {
    this.beforeSelection = beforeSelection ? structuredClone(beforeSelection) : null;
    this.afterSelection = afterSelection ? structuredClone(afterSelection) : null;
    return this;
  }

  execute() {
    this.apply(this.afterDelta, this.afterSelection, () => this.seam.applyAfter());
  }

  undo() {
    this.apply(this.beforeDelta, this.beforeSelection, () => this.seam.applyBefore());
  }

  apply(delta, selection, applySeam) {
    const editSelection = this.editor.editSelection;

    editSelection.clearSelection();

    const object = this.applyDelta(delta);
    applySeam();

    if (object && selection && editSelection.editedObject === object) {
      editSelection.setSelection(selection);
    }

    this.signals.objectChanged.dispatch(object);
  }

  applyDelta(delta) {
    const object = this.editor.objectByUuid(this.objectUuid);
    if (!object) return null;

    if (delta) {
      this.vertexEditor.setObject(object);
      this.vertexEditor.applyDelta(delta);
    }

    return object;
  }

  toJSON() {
    return {
      type: this.constructor.type,
      objectUuid: this.objectUuid,
      beforeDelta: this.beforeDelta,
      afterDelta: this.afterDelta,
      beforeSelection: this.beforeSelection,
      afterSelection: this.afterSelection,
      seam: this.seam.toJSON(),
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== this.type) return null;

    const command = new this(editor);
    command.objectUuid = json.objectUuid;
    command.beforeDelta = json.beforeDelta;
    command.afterDelta = json.afterDelta;
    command.beforeSelection = json.beforeSelection ?? null;
    command.afterSelection = json.afterSelection ?? null;
    command.seam = SeamSnapshot.fromJSON(editor, json);
    command.seam.objectUuid = json.objectUuid;
    return command;
  }
}