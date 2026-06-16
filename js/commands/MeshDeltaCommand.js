import { MeshDataRegion } from '../core/MeshDataRegion.js';
import { MeshRendererAdapter } from '../geometry/MeshRendererAdapter.js';

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
  }

  execute() {
    this.editor.editSelection.clearSelection();
    this.applyDelta(this.afterDelta);
  }

  undo() {
    this.editor.editSelection.clearSelection();
    this.applyDelta(this.beforeDelta);
  }

  applyDelta(delta) {
    const object = this.editor.objectByUuid(this.objectUuid);
    if (!object || !delta) return;

    this.vertexEditor.setObject(object);
    const meshData = this.vertexEditor.meshData;
    const renderBuffer = this.vertexEditor.renderBuffer;
    const geometry = this.vertexEditor.geometry;

    const affectedFaces = new Set();
    const affectedVertices = new Set();

    for (const [key, data] of Object.entries(delta.faces)) {
      const id = Number(key);

      if (meshData.faces.has(id)) {
        MeshRendererAdapter.deleteFace(meshData, renderBuffer, geometry, id);
      }
    }

    for (const [key, data] of Object.entries(delta.vertices)) {
      const id = Number(key);
      if (data === null && meshData.vertices.has(id)) {
        MeshRendererAdapter.deleteVertex(meshData, renderBuffer, geometry, id);
      }
    }

    MeshDataRegion.apply(meshData, delta);

    for (const [key, data] of Object.entries(delta.vertices)) {
      const id = Number(key);
      if (data !== null) {
        if (!renderBuffer.vertexIdToBufferIndex.has(id)) {
          MeshRendererAdapter.addVertex(meshData, renderBuffer, geometry, id);
        }

        const vertex = meshData.vertices.get(id);
        const slots = renderBuffer.vertexIdToBufferIndex.get(id) || [];

        for (const slot of slots) {
          geometry.attributes.position.setXYZ(slot, vertex.position.x, vertex.position.y, vertex.position.z);
        }
        affectedVertices.add(id);
      }
    }

    for (const [key, data] of Object.entries(delta.faces)) {
      const id = Number(key);
      if (data !== null) {
        MeshRendererAdapter.addFace(meshData, renderBuffer, geometry, id);
        affectedFaces.add(id);
      }
    }

    geometry.attributes.position.needsUpdate = true;

    MeshRendererAdapter.updateNormalsForAffectedFaces(meshData, renderBuffer, geometry, affectedFaces, affectedVertices);

    this.signals.editSelectionRefresh.dispatch();
  }

  toJSON() {
    return {
      type: this.constructor.type,
      objectUuid: this.objectUuid,
      beforeDelta: this.beforeDelta,
      afterDelta: this.afterDelta,
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== this.type) return null;

    const command = new this(editor);
    command.objectUuid = json.objectUuid;
    command.beforeDelta = json.beforeDelta;
    command.afterDelta = json.afterDelta;
    return command;
  }
}