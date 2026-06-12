import * as THREE from 'three';
import earcut from 'earcut';
import { computePlaneNormal, projectTo2D } from './TriangulationUtils.js';
import { SlotAllocator } from './SlotAllocator.js';

export class MeshRendererAdapter {
  static toBufferGeometry(meshData, options = {}) {
    const {
      mode = "angle",
      angle = 60,
    } = options;

    switch (mode) {
      case "flat":
        return this.generateFlatGeometry(meshData);
      case "smooth":
        return this.generateSmoothGeometry(meshData);
      case "auto":
        return this.generateAngleBasedGeometry(meshData, angle);
    }
  }

  static generateFlatGeometry(meshData) {
    const data = this.buildDuplicatedMeshData(meshData);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));

    geometry.computeVertexNormals();

    return geometry;
  }

  static generateSmoothGeometry(meshData) {
    const data = this.buildDuplicatedMeshData(meshData);

    const smoothNormalsMap = this.calculateSmoothNormalsMap(meshData);

    const normals = [];
    for (let i = 0; i < data.positions.length / 3; i++) {
      const n = smoothNormalsMap.get(i);

      if (!n) {
        normals.push(0, 0, 0);
        continue;
      }
      normals.push(n.x, n.y, n.z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));

    return geometry;
  }

  static generateAngleBasedGeometry(meshData, angle = 60) {
    const data = this.buildDuplicatedMeshData(meshData);

    const angleBasedNormalsMap = this.calculateAngleBasedNormalsMap(meshData, angle);

    const normals = [];
    for (let i = 0; i < data.positions.length / 3; i++) {
      const n = angleBasedNormalsMap.get(i);

      if (!n) {
        normals.push(0, 0, 0);
        continue;
      }
      normals.push(n.x, n.y, n.z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));

    return geometry;
  }

  static buildDuplicatedMeshData(meshData) {
    console.log('Rebuild');
    const positions = [];
    const uvs = [];
    const indices = [];
    let currentIndex = 0;

    meshData.vertexIndexMap.clear();
    meshData.faceIndexMap.clear();
    meshData.faceTriangleOffset.clear();
    meshData.faceTriangleCount.clear();

    for (let f of meshData.faces.values()) {
      let verts = f.vertexIds.map(id => meshData.vertices.get(id));
      const faceUVs = meshData.uvs.get(f.id);

      const baseIndex = currentIndex;
      const faceBufferIndices = [];
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

        faceBufferIndices.push(baseIndex + i);

        currentIndex++;
      }
      meshData.faceIndexMap.set(f.id, faceBufferIndices);

      const normal = computePlaneNormal(verts);
      const flatVertices = projectTo2D(verts, normal);
      const triangulated = earcut(flatVertices);
      
      const triOffset = indices.length;
      if (triangulated.length > 0) {
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

      meshData.faceTriangleOffset.set(f.id, triOffset);
      meshData.faceTriangleCount.set(f.id, triangulated.length);
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

    const vertCapacity = Math.ceil(currentIndex * 2);
    const idxCapacity = Math.ceil(indices.length * 2);

    meshData.slotAllocator = new SlotAllocator(vertCapacity);
    meshData.slotAllocator.alloc(currentIndex);

    meshData.indexSlotAllocator = new SlotAllocator(idxCapacity);
    meshData.indexSlotAllocator.alloc(indices.length);

    const paddedPositions = new Float32Array(vertCapacity * 3);
    paddedPositions.set(positions);
    const paddedUVs = new Float32Array(vertCapacity * 2);
    paddedUVs.set(uvs);
    const paddedIndices = new Uint32Array(idxCapacity);
    paddedIndices.set(indices);

    return { positions: paddedPositions, uvs: paddedUVs, indices: paddedIndices };
  }

  static addFace(meshData, geometry, face) {
    const verts = face.vertexIds.map(id => meshData.vertices.get(id));
    const faceUVs = meshData.uvs.get(face.id);

    let vertSlot = meshData.slotAllocator.alloc(verts.length);
    if (vertSlot === -1) {
      this._growVertexBuffer(meshData, geometry, verts.length * 2);
      vertSlot = meshData.slotAllocator.alloc(verts.length);
    }

    const posAttr = geometry.attributes.position;
    const uvAttr = geometry.attributes.uv;
    const faceBufferIndices = [];

    for (let i = 0; i < verts.length; i++) {
      const slot = vertSlot + i;
      const v = verts[i];
      posAttr.setXYZ(slot, v.position.x, v.position.y, v.position.z);
      uvAttr.setXY(slot, faceUVs?.[i]?.u ?? 0, faceUVs?.[i]?.v ?? 0);

      faceBufferIndices.push(slot);
      if (!meshData.vertexIndexMap.has(v.id)) meshData.vertexIndexMap.set(v.id, []);
      meshData.vertexIndexMap.get(v.id).push(slot);
      meshData.bufferIndexToVertexId.set(slot, v.id);
    }

    meshData.faceIndexMap.set(face.id, faceBufferIndices);

    const normal = computePlaneNormal(verts);
    const flat = projectTo2D(verts, normal);
    const tris = earcut(flat);

    let idxSlot = meshData.indexSlotAllocator.alloc(tris.length);
    if (idxSlot === -1) {
      this._growIndexBuffer(meshData, geometry, tris.length * 2);
      idxSlot = meshData.indexSlotAllocator.alloc(tris.length);
    }

    const indexAttr = geometry.index;
    for (let i = 0; i < tris.length; i++) {
      indexAttr.setX(idxSlot + i, vertSlot + tris[i]);
    }

    meshData.faceTriangleOffset.set(face.id, idxSlot);
    meshData.faceTriangleCount.set(face.id, tris.length);

    posAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;
    indexAttr.needsUpdate = true;
  }

  static deleteFace(meshData, geometry, faceId) {
    console.log('deleteFace');
    const bufferIndices = meshData.faceIndexMap.get(faceId);
    if (!bufferIndices) return;

    // Mask triangles as degenerate (all indices → same slot)
    const triOffset = meshData.faceTriangleOffset.get(faceId);
    const triCount = meshData.faceTriangleCount.get(faceId);
    const indexAttr = geometry.index;
    const degSlot = bufferIndices[0];

    for (let i = 0; i < triCount; i++) {
      indexAttr.setX(triOffset + i, degSlot);
    }

    meshData.slotAllocator.free(bufferIndices[0], bufferIndices.length);
    meshData.indexSlotAllocator.free(triOffset, triCount);

    for (const slot of bufferIndices) {
      const vertId = meshData.bufferIndexToVertexId.get(slot);
      meshData.bufferIndexToVertexId.delete(slot);
      if (vertId !== undefined) {
        const arr = meshData.vertexIndexMap.get(vertId);
        if (arr) {
          const i = arr.indexOf(slot);
          if (i !== -1) arr.splice(i, 1);
          if (arr.length === 0) meshData.vertexIndexMap.delete(vertId);
        }
      }
    }

    meshData.faceIndexMap.delete(faceId);
    meshData.faceTriangleOffset.delete(faceId);
    meshData.faceTriangleCount.delete(faceId);

    indexAttr.needsUpdate = true;

    if (meshData.slotAllocator.utilization < 0.25) {
      this.compact(meshData, geometry);
    }
  }

  static _growVertexBuffer(meshData, geometry, additionalSlots) {
    const posAttr = geometry.attributes.position;
    const uvAttr = geometry.attributes.uv;
    const newCount = posAttr.count + additionalSlots;

    const newPos = new Float32Array(newCount * 3);
    newPos.set(posAttr.array);
    const newUV = new Float32Array(newCount * 2);
    newUV.set(uvAttr.array);

    geometry.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(newUV, 2));

    meshData.slotAllocator.capacity += additionalSlots;
    meshData.slotAllocator.freeBlocks.push({ start: posAttr.count, count: additionalSlots });
    meshData.slotAllocator._mergeBlocks();
  }

  static _growIndexBuffer(meshData, geometry, additionalSlots) {
    const idxAttr = geometry.index;
    const newCount = idxAttr.count + additionalSlots;
    
    const newIdx = new Uint32Array(newCount);
    newIdx.set(idxAttr.array);
    geometry.setIndex(new THREE.BufferAttribute(newIdx, 1));

    meshData.indexSlotAllocator.capacity += additionalSlots;
    meshData.indexSlotAllocator.freeBlocks.push({ start: idxAttr.count, count: additionalSlots });
    meshData.indexSlotAllocator._mergeBlocks();
  }

  static compact(meshData, geometry) {
    const { positions, uvs, indices } = this.buildDuplicatedMeshData(meshData);

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
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
    const seenVertexIds = new Set();
    let currentIndex = 0;
    
    for (const face of meshData.faces.values()) {
      let verts = face.vertexIds.map(id => meshData.vertices.get(id));

      const currentFaceNormal = faceNormals.get(face.id);

      for (const v of verts) {
        seenVertexIds.add(v.id);

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
      if (!seenVertexIds.has(v.id)) {
        normalsMap.set(currentIndex, new THREE.Vector3(0, 1, 0));
        currentIndex++;
      }
    }

    return normalsMap;
  }
}