import * as THREE from "three";
import { MeshData } from "../core/MeshData.js";
import { MeshRendererAdapter } from "../geometry/MeshRendererAdapter.js";

const _inverseW = new THREE.Matrix4();
const _localPos = new THREE.Vector3();

export class VertexTransform {
  constructor(vertexEditor) {
    this.vertexEditor = vertexEditor;
    this.signals = vertexEditor.signals;
  }

  get geometry() {
    return this.vertexEditor.geometry;
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

  setVertexPositions(vertexIds, worldPositions, retriangulate = false) {
    if (!this.object) return;

    const meshData = this.meshData;
    const vertexIdToBufferIndex = this.renderBuffer.vertexIdToBufferIndex;
    const positionAttr = this.geometry.attributes.position;

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
        positionAttr.setXYZ(indices[j], _localPos.x, _localPos.y, _localPos.z);
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

    positionAttr.needsUpdate = true;

    if (retriangulate) {
      MeshRendererAdapter.retriangulateFaces(meshData, this.renderBuffer, this.geometry, affectedFaces);
    }
    MeshRendererAdapter.updateNormalsForAffectedFaces(meshData, this.renderBuffer, this.geometry, affectedFaces, affectedVertices);

    this.signals.vertexPositionsUpdated.dispatch(affectedVertices, affectedEdges, affectedFaces, meshData, this.object.matrixWorld);
  }

  getVertexPosition(vertexId) {
    if (!this.object) return null;

    const vertex = this.meshData.getVertex(vertexId);
    if (!vertex) return null;

    return new THREE.Vector3()
      .copy(vertex.position)
      .applyMatrix4(this.object.matrixWorld);
  }

  getVertexPositions(vertexIds) {
    if (!this.object || !vertexIds?.length) return [];

    return vertexIds
      .map(id => this.getVertexPosition(id))
      .filter(Boolean);
  }
}