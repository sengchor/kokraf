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

    this.setupListeners();
  }

  setupListeners() {
    this.signals.setSeam.add((value) => this.setSeam(value));
  }

  handleAction(action) {
    if (action === 'mark-seam') {
      return this.setSeam(true);
    }

    if (action === 'clear-seam') {
      return this.setSeam(false);
    }

    if (action === 'uv-unwrap') {
      this.uvUnwrap();
      return;
    }

    if (action === 'auto-uv-unwrap') {
      this.autoUVUnwrap();
      return;
    }

    console.log('Invalid action:', action);
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