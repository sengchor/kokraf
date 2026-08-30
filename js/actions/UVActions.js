import * as THREE from 'three';
import { AutoUVUnwrap } from '../uv/AutoUVUnwrap.js';
import { SetSeamCommand } from '../commands/SetSeamCommand.js';

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

  async autoUVUnwrap() {
    const object = this.editSelection.editedObject;

    const { output } = await AutoUVUnwrap.unwrap(object.userData.meshData);

    if (!output?.positions?.length || !output.indices.length) {
      throw new Error(`UV unwrap failed for "${object.name}".`);
    }

    this.editor.vertexEditor.setObject(object);
    this.editor.vertexEditor.updateGeometry();

    this.signals.uvsChanged.dispatch(object);
  }
}