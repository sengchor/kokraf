import * as THREE from "three";
import { ShadingUtils } from "../utils/ShadingUtils.js";
import { MeshData } from "../core/MeshData.js";

export class VertexTransform {
  constructor(vertexEditor) {
    this.vertexEditor = vertexEditor;
    this.editHelpers = vertexEditor.editor.editHelpers;
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

  setVerticesWorldPositions(vertexIds, worldPositions) {
    if (!this.object || !this.positionAttr) return;

    const meshData = this.meshData;
    const vertexIndexMap = meshData.vertexIndexMap;

    const inverseW = new THREE.Matrix4().copy(this.object.matrixWorld).invert();

    const affectedVertices = new Set();
    const affectedEdges = new Set();
    const affectedFaces = new Set();

    // Update vertex positions
    for (let i = 0; i < vertexIds.length; i++) {
      const vertexId = vertexIds[i];
      const worldPos = worldPositions[i];
      const localPos = worldPos.clone().applyMatrix4(inverseW);

      const indices = vertexIndexMap.get(vertexId);
      if (!indices) continue;

      for (let bufferIndex of indices) {
        this.positionAttr.setXYZ(bufferIndex, localPos.x, localPos.y, localPos.z);
      }

      const v = meshData.getVertex(vertexId);
      if (v) {
        v.position = { x: localPos.x, y: localPos.y, z: localPos.z };

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

    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();

    this.editHelpers.updateHelpersAfterMeshEdit(affectedVertices, affectedEdges, affectedFaces, meshData);
  }

  getVertexPosition(vertexId) {
    if (!this.object || !this.positionAttr) return null;

    const vertexIndexMap = this.meshData.vertexIndexMap;
    const indices = vertexIndexMap.get(vertexId);
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

  updateGeometryAndHelpers(useEarcut = true) {
    const meshData = this.meshData;
    if (!meshData) return;

    const shading = this.object.userData.shading;
    this.geometry = ShadingUtils.createGeometryWithShading(meshData, shading, useEarcut);
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();

    this.editHelpers.refreshHelpers();
  }

  applyMeshData(newMeshData) {
    if (!this.object) return false;

    const cloned = structuredClone(newMeshData);
    this.object.userData.meshData = cloned;

    MeshData.rehydrateMeshData(this.object);
  }
}