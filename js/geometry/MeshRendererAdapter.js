import * as THREE from 'three';
import earcut from 'earcut';
import { computeFaceNormals } from './NormalCalculator.js';
import { computePlaneNormal, projectTo2D } from './TriangulationUtils.js';

export class MeshRendererAdapter {
  static toBufferGeometry(meshData, options = {}) {
    const {
      mode = "angle",
      angle = 60,
      useEarcut = true
    } = options;

    switch (mode) {
      case "flat":
        return this.generateFlatGeometry(meshData, useEarcut);
      case "smooth":
        return this.generateSmoothGeometry(meshData, useEarcut);
      case "auto":
        return this.generateAngleBasedGeometry(meshData, angle, useEarcut);
    }
  }

  static generateFlatGeometry(meshData, useEarcut) {
    const data = this.buildDuplicatedMeshData(meshData, useEarcut);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
    geometry.setIndex(data.indices);

    geometry.computeVertexNormals();

    return geometry;
  }

  static generateSmoothGeometry(meshData, useEarcut = true) {
    const data = this.buildDuplicatedMeshData(meshData, useEarcut);

    const smoothNormalsMap = this.calculateSmoothNormalsMap(meshData);

    const normals = [];
    for (let i = 0; i < data.positions.length / 3; i++) {
      const n = smoothNormalsMap.get(i);

      normals.push(n.x, n.y, n.z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
    geometry.setIndex(data.indices);

    return geometry;
  }

  static generateAngleBasedGeometry(meshData, angle = 60, useEarcut = true) {
    const data = this.buildDuplicatedMeshData(meshData, useEarcut);

    const angleBasedNormalsMap = this.calculateAngleBasedNormalsMap(meshData, angle);

    const normals = [];
    for (let i = 0; i < data.positions.length / 3; i++) {
      const n = angleBasedNormalsMap.get(i);

      normals.push(n.x, n.y, n.z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
    geometry.setIndex(data.indices);

    return geometry;
  }

  static buildDuplicatedMeshData(meshData, useEarcut = true) {
    const positions = [];
    const uvs = [];
    const indices = [];
    let currentIndex = 0;

    meshData.vertexIndexMap.clear();

    for (let f of meshData.faces.values()) {
      let verts = f.vertexIds.map(id => meshData.vertices.get(id));
      const faceUVs = meshData.uvs.get(f.id);

      const baseIndex = currentIndex;
      for (let i = 0; i < verts.length; i++) {
        let v = verts[i];

        positions.push(v.position.x, v.position.y, v.position.z);

        if (faceUVs && faceUVs[i]) {
          uvs.push(faceUVs[i].u, faceUVs[i].v);
        } else {
          uvs.push(0, 0);
        }

        if (!meshData.vertexIndexMap.has(v.id)) meshData.vertexIndexMap.set(v.id, []);
        meshData.vertexIndexMap.get(v.id).push(currentIndex);

        currentIndex++;
      }

      if (useEarcut) {
        const normal = computePlaneNormal(verts);
        const flatVertices = projectTo2D(verts, normal);
        const triangulated = earcut(flatVertices);

        for (let i = 0; i < triangulated.length; i += 3) {
          indices.push(
            baseIndex + triangulated[i],
            baseIndex + triangulated[i + 1],
            baseIndex + triangulated[i + 2]
          );
        }
      } else {
        for (let i = 1; i < verts.length - 1; i++) {
          indices.push(baseIndex, baseIndex + i, baseIndex + i + 1);
        }
      }
    }

    for (let v of meshData.vertices.values()) {
      if (!meshData.vertexIndexMap.has(v.id)) {
        positions.push(v.position.x, v.position.y, v.position.z);
        uvs.push(0, 0);
        meshData.vertexIndexMap.set(v.id, [currentIndex]);
        currentIndex++;
      }
    }

    meshData.bufferIndexToVertexId = new Map();
    for (let [logicalId, indicesArr] of meshData.vertexIndexMap) {
      for (let i of indicesArr) meshData.bufferIndexToVertexId.set(i, logicalId);
    }

    return { positions, uvs, indices };
  }

  static calculateSmoothNormalsMap(meshData) {
    const positions = [];
    const indices = [];

    const vertexIdToIndex = new Map();
    const indexToVertexId = new Map();
    let currentIndex = 0;

    // Build the strictly shared geometry arrays
    for (let v of meshData.vertices.values()) {
      positions.push(v.position.x, v.position.y, v.position.z);
      vertexIdToIndex.set(v.id, currentIndex);
      indexToVertexId.set(currentIndex, v.id);
      currentIndex++;
    }

    // Build indices
    for (let f of meshData.faces.values()) {
      let verts = f.vertexIds.map(id => meshData.vertices.get(id));

      const normal = computePlaneNormal(verts);
      const flatVertices = projectTo2D(verts, normal);
      const triangulated = earcut(flatVertices);

      for (let i = 0; i < triangulated.length; i += 3) {
        const a = vertexIdToIndex.get(verts[triangulated[i]].id);
        const b = vertexIdToIndex.get(verts[triangulated[i + 1]].id);
        const c = vertexIdToIndex.get(verts[triangulated[i + 2]].id);
        indices.push(a, b, c);
      }
    }

    // Let Three.js calculate the perfect smooth normals
    const tmpGeo = new THREE.BufferGeometry();
    tmpGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    tmpGeo.setIndex(indices);
    tmpGeo.computeVertexNormals();
    const computedNormals = tmpGeo.attributes.normal.array;

    // Map the results back to the original logical Vertex IDs
    const logicalNormalsMap = new Map();
    for (let i = 0; i < currentIndex; i++) {
      const logicalId = indexToVertexId.get(i);
      logicalNormalsMap.set(logicalId, new THREE.Vector3(
        computedNormals[i * 3],
        computedNormals[(i * 3) + 1],
        computedNormals[(i * 3) + 2]
      ));
    }

    tmpGeo.dispose();

    const normalsMap = new Map();
    for (const [bufferIdx, logicalId] of meshData.bufferIndexToVertexId) {
      normalsMap.set(bufferIdx, logicalNormalsMap.get(logicalId));
    }
    return normalsMap;
  }

  static calculateAngleBasedNormalsMap(meshData, angleDegree = 60) {
    const threshold = (angleDegree * Math.PI) / 180;
    const normalsMap = new Map();

    // Pre-calculate Face Normals and Adjacency
    const faceNormals = new Map();
    const vertexToFaces = new Map();

    for (const face of meshData.faces.values()) {
      const verts = face.vertexIds.map(id => meshData.vertices.get(id));
      const normal = computePlaneNormal(verts);
      faceNormals.set(face.id, normal);

      for (const vId of face.vertexIds) {
        if (!vertexToFaces.has(vId)) vertexToFaces.set(vId, new Set());
        vertexToFaces.get(vId).add(face.id);
      }
    }

    // Calculate Normals per Buffer Index
    let currentIndex = 0;
    for (const face of meshData.faces.values()) {
      let verts = face.vertexIds.map(id => meshData.vertices.get(id));

      const currentFaceNormal = faceNormals.get(face.id);

      for (const v of verts) {
        const averagedNormal = new THREE.Vector3(0, 0, 0);
        const neighborFaceIds = vertexToFaces.get(v.id);

        for (const neighborId of neighborFaceIds) {
          const neighborNormal = faceNormals.get(neighborId);
          const angle = currentFaceNormal.angleTo(neighborNormal);

          if (angle <= threshold) {
            averagedNormal.add(neighborNormal);
          }
        }

        averagedNormal.normalize();
        
        normalsMap.set(currentIndex, averagedNormal);
        currentIndex++;
      }
    }

    // Handle extra vertices
    for (const v of meshData.vertices.values()) {
      if (!meshData.vertexIndexMap.has(v.id)) {
        normalsMap.set(currentIndex, new THREE.Vector3(0, 1, 0));
        currentIndex++;
      }
    }

    return normalsMap;
  }

  static recomputeNormals(object) {
    const shading = object.userData.shading;
    const meshData = object.userData.meshData;

    if (shading === 'flat') {
      object.geometry.computeVertexNormals();
      return;
    }

    let normalsMap;

    if (shading === 'smooth') {
      normalsMap = this.calculateSmoothNormalsMap(meshData);
    } else if (shading === 'auto') {
      normalsMap = this.calculateAngleBasedNormalsMap(meshData);
    } else {
      return;
    }

    const normalAttr = object.geometry.attributes.normal;
    for (const [bufferIdx, n] of normalsMap) {
      normalAttr.setXYZ(bufferIdx, n.x, n.y, n.z);
    }
    normalAttr.needsUpdate = true;
  }
}