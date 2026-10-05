import * as THREE from 'three';
import { AutoUVUnwrap } from '../uv/AutoUVUnwrap.js';
import { SetSeamCommand } from '../commands/SetSeamCommand.js';
import { SetUVsCommand } from '../commands/SetUVsCommand.js';
import { UVUnwrap } from '../uv/UVUnwrap.js';

export class UVActions {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.editSelection = editor.editSelection;

    this.actions = {
      'mark-seam': () => this.setSeam(true),
      'clear-seam': () => this.setSeam(false),
      'uv-unwrap': () => this.uvUnwrap(),
      'clear-uv': () => this.clearUV(),
      'auto-uv-unwrap': () => this.autoUVUnwrap(),
    };

    this.setupListeners();
  }

  setupListeners() {
    this.signals.setSeam.add((value) => this.setSeam(value));
  }

  handleAction(action) {
    const handler = this.actions[action];
    if (!handler) {
      console.warn('Invalid action:', action);
      return;
    }
    return handler();
  }

  setSeam(value) {
    const object = this.editSelection.editedObject;
    if (!object) return;

    const selectedEdgeIds = this.editSelection.selectedEdgeIds;
    if (!selectedEdgeIds?.size) return;

    const command = new SetSeamCommand(this.editor, object, [...selectedEdgeIds], value);
    this.editor.execute(command);
  }

  uvUnwrap() {
    const object = this.editSelection.editedObject;
    if (!object) return;

    const meshData = object.userData.meshData;
    const seams = SetSeamCommand._getSeamSet(object);

    const oldUVs = SetUVsCommand.capture(meshData.uvs);

    const result = UVUnwrap.unwrap(meshData, seams, { margin: 0.002 });
    if (!result) {
      this._restore(meshData, oldUVs);
      throw new Error(`UV unwrap failed for "${object.name}".`);
    }

    const newUVs = SetUVsCommand.capture(meshData.uvs);
    this.editor.execute(new SetUVsCommand(this.editor, object, newUVs, oldUVs));
  }

  clearUV() {
    const object = this.editSelection.editedObject;
    if (!object) return;

    const meshData = object.userData.meshData;
    if (meshData.faces.size === 0 || meshData.uvs.size === 0) return;
    
    const oldUVs = SetUVsCommand.capture(meshData.uvs);
    meshData.uvs.clear();
    const newUVs = SetUVsCommand.capture(meshData.uvs);
    this.editor.execute(new SetUVsCommand(this.editor, object, newUVs, oldUVs));
  }

  async autoUVUnwrap() {
    const object = this.editSelection.editedObject;
    if (!object) return;

    const meshData = object.userData.meshData;
    const oldUVs = SetUVsCommand.capture(meshData.uvs);

    const { output } = await AutoUVUnwrap.unwrap(meshData);

    if (!output?.positions?.length || !output.indices.length) {
      this._restore(meshData, oldUVs);
      throw new Error(`UV unwrap failed for "${object.name}".`);
    }

    const newUVs = SetUVsCommand.capture(meshData.uvs);
    this.editor.execute(new SetUVsCommand(this.editor, object, newUVs, oldUVs));
  }

  _restore(meshData, uvs) {
    meshData.uvs.clear();
    for (const [faceId, corners] of uvs) meshData.uvs.set(faceId, corners);
  }
}