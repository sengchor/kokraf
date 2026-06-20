import * as THREE from 'three';
import { VertexDuplicate } from "./VertexDuplicate.js";
import { VertexDelete } from "./VertexDelete.js";
import { VertexDissolve } from "./VertexDissolve.js";
import { VertexTopologyUtils } from "./VertexTopologyUtils.js";
import { VertexTransform } from "./VertexTransform.js";
import { VertexSubdivide } from "./VertexSubdivide.js";
import { VertexSelection } from "./VertexSelection.js";
import { MeshData } from '../core/MeshData.js';
import { MeshRenderBuffer } from '../geometry/MeshRenderBuffer.js';
import { MeshDataRegion } from '../core/MeshDataRegion.js';
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
    const renderBuffer = this.object.userData.renderBuffer;

    if (meshData && !(meshData instanceof MeshData)) {
      MeshData.rehydrateMeshData(this.object);
    }

    if (renderBuffer && !(renderBuffer instanceof MeshRenderBuffer)) {
      MeshRenderBuffer.rehydrateRenderBuffer(this.object);
    }
  }

  addFace(vertices) {
    const face = this.meshData.addFace(vertices);
    MeshRendererAdapter.addFace(this.meshData, this.renderBuffer, this.geometry, face.id);
    return face;
  }

  deleteFace(face, skipCompact = false) {
    MeshRendererAdapter.deleteFace(this.meshData, this.renderBuffer, this.geometry, face.id, skipCompact);
    this.meshData.deleteFace(face);
  }

  addVertex(position) {
    const vertex = this.meshData.addVertex(position); 
    MeshRendererAdapter.addVertex(this.meshData, this.renderBuffer, this.geometry, vertex.id);
    return vertex;
  }

  deleteVertex(vertex, skipCompact = false) {
    MeshRendererAdapter.deleteVertex(this.meshData, this.renderBuffer, this.geometry, vertex.id, skipCompact);
    this.meshData.deleteVertex(vertex);
  }
  
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

  applyDelta(delta) {
    if (!this.object || !delta) return;

    const meshData = this.meshData;
    const renderBuffer = this.renderBuffer;
    const geometry = this.geometry;

    const affectedFaces = new Set();
    const affectedVertices = new Set();

    for (const [key, data] of Object.entries(delta.faces)) {
      const id = Number(key);

      if (meshData.faces.has(id)) {
        MeshRendererAdapter.deleteFace(meshData, renderBuffer, geometry, id, true);
      }
    }

    for (const [key, data] of Object.entries(delta.vertices)) {
      const id = Number(key);
      if (data === null && meshData.vertices.has(id)) {
        MeshRendererAdapter.deleteVertex(meshData, renderBuffer, geometry, id, true);
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
    
    const box = new THREE.Box3();
    for (const id of meshData.vertices.keys()) {
      const slot = renderBuffer.vertexIdToBufferIndex.get(id)?.[0];
      if (slot === undefined) continue;
      box.expandByPoint(meshData.vertices.get(id).position);
    }
    geometry.boundingBox = box;

    MeshRendererAdapter.updateNormalsForAffectedFaces(meshData, renderBuffer, geometry, affectedFaces, affectedVertices);

    this.signals.editSelectionRefresh.dispatch();
  }
}