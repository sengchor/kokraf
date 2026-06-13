import { VertexDuplicate } from "./VertexDuplicate.js";
import { VertexDelete } from "./VertexDelete.js";
import { VertexDissolve } from "./VertexDissolve.js";
import { VertexTopologyUtils } from "./VertexTopologyUtils.js";
import { VertexTransform } from "./VertexTransform.js";
import { VertexSubdivide } from "./VertexSubdivide.js";
import { VertexSelection } from "./VertexSelection.js";
import { MeshData } from '../core/MeshData.js';
import { MeshRendererAdapter } from "../geometry/MeshRendererAdapter.js";

export class VertexEditor {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.object = null;

    this.selection = new VertexSelection(this);
    this.topology = new VertexTopologyUtils(this);
    this.transform = new VertexTransform(this);
    this.duplicate = new VertexDuplicate(this);
    this.delete = new VertexDelete(this);
    this.dissolve = new VertexDissolve(this);
    this.subdivide = new VertexSubdivide(this);
  }

  get meshData() {
    return this.object.userData.meshData;
  }

  set meshData(value) {
    this.object.userData.meshData = value;
  }

  get geometry() {
    return this.object.geometry;
  }

  set geometry(value) {
    this.object.geometry = value;
  }

  get renderBuffer() {
    return this.object.userData.renderBuffer;
  }

  set renderBuffer(value) {
    this.object.userData.renderBuffer = value;
  }

  setObject(object3D) {
    this.object = object3D || null;

    if (!this.object) return;

    const meshData = this.object.userData.meshData;

    if (meshData && !(meshData instanceof MeshData)) {
      MeshData.rehydrateMeshData(this.object);
    }
  }

  addFace(vertices) {
    const face = this.meshData.addFace(vertices);
    MeshRendererAdapter.addFace(this.meshData, this.renderBuffer, this.geometry, face.id);
    return face;
  }

  deleteFace(face) {
    MeshRendererAdapter.deleteFace(this.meshData, this.renderBuffer, this.geometry, face.id);
    this.meshData.deleteFace(face);
  }

  addVertex(position) { return this.meshData.addVertex(position); }
  deleteVertex(vertex) { return this.meshData.deleteVertex(vertex); }
  addEdge(v1, v2) { return this.meshData.addEdge(v1, v2); }
  deleteEdge(edge) { return this.meshData.deleteEdge(edge); }

  updateGeometryAndHelpers() {
    const shading = this.object.userData.shading;
    
    const { geometry, renderBuffer } = MeshRendererAdapter.toBufferGeometry(this.meshData, { mode: shading });
    this.geometry = geometry;
    this.renderBuffer = renderBuffer;
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();

    this.signals.editSelectionRefresh.dispatch();
  }

  applyMeshData(newMeshData) {
    if (!this.object) return;

    this.meshData = newMeshData;
    MeshData.rehydrateMeshData(this.object);
    this.updateGeometryAndHelpers();
  }
}