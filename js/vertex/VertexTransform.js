import * as THREE from "three";
import { MeshData } from "../core/MeshData.js";

const _inverseW = new THREE.Matrix4();
const _localPos = new THREE.Vector3();

export class VertexTransform {
  constructor(vertexEditor) {
    this.vertexEditor = vertexEditor;
    this.signals = vertexEditor.signals;
  }

  get geometry() {
    return this.object.geometry;
  }

  set geometry(value) {
    this.object.geometry = value;
  }

  get positionAttr() {
    return this.object.geometry?.attributes?.position;
  }

  get meshData() {
    return this.vertexEditor.meshData;
  }

  get object() {
    return this.vertexEditor.object;
  }

  get renderBuffer() {
    return this.vertexEditor.renderBuffer;
  }

  setVerticesWorldPositions(vertexIds, worldPositions) {
    if (!this.object || !this.positionAttr) return;

    const meshData = this.meshData;
    const vertexIdToBufferIndex = this.renderBuffer.vertexIdToBufferIndex;

    _inverseW.copy(this.object.matrixWorld).invert();

    const affectedVertices = new Set();
    const affectedEdges = new Set();
    const affectedFaces = new Set();

    for (let i = 0; i < vertexIds.length; i++) {
      const vertexId = vertexIds[i];
      const worldPos = worldPositions[i];

      if (!worldPos) continue;

      _localPos.copy(worldPos).applyMatrix4(_inverseW);

      const indices = vertexIdToBufferIndex.get(vertexId);
      if (!indices) continue;

      for (let j = 0; j < indices.length; j++) {
        this.positionAttr.setXYZ(indices[j], _localPos.x, _localPos.y, _localPos.z);
      }

      const v = meshData.getVertex(vertexId);
      if (v) {
        v.position.x = _localPos.x;
        v.position.y = _localPos.y;
        v.position.z = _localPos.z;

        affectedVertices.add(v.id);

        for (let edgeId of v.edgeIds) {
          affectedEdges.add(edgeId);
        }

        for (let faceId of v.faceIds) {
          affectedFaces.add(faceId);
        }
      }
    }

    this.positionAttr.needsUpdate = true;

    this.signals.vertexPositionsUpdated.dispatch(affectedVertices, affectedEdges, affectedFaces, meshData, this.object.matrixWorld);
  }

  getVertexPosition(vertexId) {
    if (!this.object || !this.positionAttr) return null;

    const vertexIdToBufferIndex = this.renderBuffer.vertexIdToBufferIndex;
    const indices = vertexIdToBufferIndex.get(vertexId);
    if (!indices || indices.length === 0) return null;

    const bufferIndex = indices[0];
    const localPos = new THREE.Vector3();
    localPos.fromBufferAttribute(this.positionAttr, bufferIndex);

    const worldPos = localPos.clone().applyMatrix4(this.object.matrixWorld);
    return worldPos;
  }

  getVertexPositions(vertexIds) {
    const positions = [];

    if (!this.object || !this.positionAttr || !vertexIds || vertexIds.length === 0) {
      return positions;
    }

    for (let vId of vertexIds) {
      const pos = this.getVertexPosition(vId);
      if (pos) positions.push(pos.clone());
    }

    return positions;
  }

  getVertexPositionsMeshData(vertexIds) {
    const positions = [];

    for (const vertexId of vertexIds) {
      const vertex = this.meshData.getVertex(vertexId);
      const position = new THREE.Vector3().copy(vertex.position);
      positions.push(position.applyMatrix4(this.object.matrixWorld));
    }

    return positions;
  }

  applyMeshData(newMeshData) {
    if (!this.object) return false;

    const cloned = structuredClone(newMeshData);
    this.object.userData.meshData = cloned;

    MeshData.rehydrateMeshData(this.object);
  }
}