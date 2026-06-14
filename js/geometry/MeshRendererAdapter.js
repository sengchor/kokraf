import * as THREE from 'three';
import earcut from 'earcut';
import { computePlaneNormal, projectTo2D } from './TriangulationUtils.js';
import { SlotAllocator } from './SlotAllocator.js';
import { MeshRenderBuffer } from './MeshRenderBuffer.js';

export class MeshRendererAdapter {
  static toBufferGeometry(meshData, options = {}) {
    const { mode = "angle", angle = 60 } = options;

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
    const { positions, uvs, indices, renderBuffer } = this.buildDuplicatedMeshData(meshData);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    geometry.computeVertexNormals();

    return { geometry, renderBuffer };
  }

  static generateSmoothGeometry(meshData) {
    const { positions, uvs, indices, renderBuffer } = this.buildDuplicatedMeshData(meshData);

    const smoothNormalsMap = this.calculateSmoothNormalsMap(meshData, renderBuffer);

    const normals = [];
    for (let i = 0; i < positions.length / 3; i++) {
      const n = smoothNormalsMap.get(i);

      if (!n) {
        normals.push(0, 0, 0);
        continue;
      }
      normals.push(n.x, n.y, n.z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    return { geometry, renderBuffer };
  }

  static generateAngleBasedGeometry(meshData, angle = 60) {
    const { positions, uvs, indices, renderBuffer } = this.buildDuplicatedMeshData(meshData);

    const angleBasedNormalsMap = this.calculateAngleBasedNormalsMap(meshData, renderBuffer, angle);

    const normals = [];
    for (let i = 0; i < positions.length / 3; i++) {
      const n = angleBasedNormalsMap.get(i);

      if (!n) {
        normals.push(0, 0, 0);
        continue;
      }
      normals.push(n.x, n.y, n.z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    return { geometry, renderBuffer };
  }

  static buildDuplicatedMeshData(meshData) {
    console.log('rebuild');
    const renderBuffer = new MeshRenderBuffer();

    const positions = [];
    const uvs = [];
    const indices = [];
    let currentIndex = 0;

    for (let f of meshData.faces.values()) {
      let verts = f.vertexIds.map(id => meshData.vertices.get(id));
      const faceUVs = meshData.uvs.get(f.id);

      const baseIndex = currentIndex;
      const faceBufferIndices = [];

      for (let i = 0; i < verts.length; i++) {
        let v = verts[i];

        positions.push(v.position.x, v.position.y, v.position.z);
        uvs.push(faceUVs?.[i]?.u ?? 0, faceUVs?.[i]?.v ?? 0);

        if (!renderBuffer.vertexIdToBufferIndex.has(v.id)) 
          renderBuffer.vertexIdToBufferIndex.set(v.id, []);
        renderBuffer.vertexIdToBufferIndex.get(v.id).push(currentIndex);

        faceBufferIndices.push(baseIndex + i);

        currentIndex++;
      }
      renderBuffer.faceIdToBufferIndices.set(f.id, faceBufferIndices);

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

      renderBuffer.faceTriangleOffset.set(f.id, triOffset);
      renderBuffer.faceTriangleCount.set(f.id, triangulated.length);
    }

    for (let v of meshData.vertices.values()) {
      if (!renderBuffer.vertexIdToBufferIndex.has(v.id)) {
        positions.push(v.position.x, v.position.y, v.position.z);
        uvs.push(0, 0);
        renderBuffer.vertexIdToBufferIndex.set(v.id, [currentIndex]);
        currentIndex++;
      }
    }

    for (let [vertexId, bufferIndices] of renderBuffer.vertexIdToBufferIndex) {
      for (let bufferIndex of bufferIndices) {
        renderBuffer.bufferIndexToVertexId.set(bufferIndex, vertexId);
      }
    }

    const vertCapacity = Math.ceil(currentIndex * 2);
    const idxCapacity = Math.ceil(indices.length * 2);

    renderBuffer.slotAllocator = new SlotAllocator(vertCapacity);
    renderBuffer.slotAllocator.alloc(currentIndex);
    renderBuffer.indexSlotAllocator = new SlotAllocator(idxCapacity);
    renderBuffer.indexSlotAllocator.alloc(indices.length);

    const paddedPositions = new Float32Array(vertCapacity * 3);
    paddedPositions.set(positions);
    const paddedUVs = new Float32Array(vertCapacity * 2);
    paddedUVs.set(uvs);
    const paddedIndices = new Uint32Array(idxCapacity);
    paddedIndices.set(indices);

    return { positions: paddedPositions, uvs: paddedUVs, indices: paddedIndices, renderBuffer };
  }

  static addVertex(meshData, renderBuffer, geometry, vertexId) {
    const vertex = meshData.vertices.get(vertexId);
    if (!vertex) return;

    if (renderBuffer.vertexIdToBufferIndex.has(vertexId)) return;

    let slot = renderBuffer.slotAllocator.alloc(1);

    if (slot === -1) {
      this._growVertexBuffer(renderBuffer, geometry, 2);
      slot = renderBuffer.slotAllocator.alloc(1);
    }

    const posAttr = geometry.attributes.position;
    const uvAttr = geometry.attributes.uv;

    posAttr.setXYZ(slot, vertex.position.x, vertex.position.y, vertex.position.z);
    uvAttr.setXY(slot, 0, 0);

    renderBuffer.vertexIdToBufferIndex.set(vertexId, [slot]);
    renderBuffer.bufferIndexToVertexId.set(slot, vertexId);

    posAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;
  }

  static deleteVertex(meshData, renderBuffer, geometry, vertexId) {
    const bufferIndices = renderBuffer.vertexIdToBufferIndex.get(vertexId);

    if (!bufferIndices || bufferIndices.length === 0) return;

    // Safe only for standalone vertices.
    // Face vertices should be removed through deleteFace().
    if (bufferIndices.length > 1) return;

    const slot = bufferIndices[0];

    renderBuffer.slotAllocator.free(slot, 1);

    renderBuffer.vertexIdToBufferIndex.delete(vertexId);
    renderBuffer.bufferIndexToVertexId.delete(slot);

    if (renderBuffer.slotAllocator.utilization < 0.25) {
      this.compact(meshData, renderBuffer, geometry);
    }
  }

  static addFace(meshData, renderBuffer, geometry, faceId) {
    const face = meshData.faces.get(faceId);
    const verts = face.vertexIds.map(id => meshData.vertices.get(id));
    const faceUVs = meshData.uvs.get(faceId);

    let vertSlot = renderBuffer.slotAllocator.alloc(verts.length);
    if (vertSlot === -1) {
      this._growVertexBuffer(renderBuffer, geometry, verts.length * 2);
      vertSlot = renderBuffer.slotAllocator.alloc(verts.length);
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
      if (!renderBuffer.vertexIdToBufferIndex.has(v.id))
        renderBuffer.vertexIdToBufferIndex.set(v.id, []);
      renderBuffer.vertexIdToBufferIndex.get(v.id).push(slot);
      renderBuffer.bufferIndexToVertexId.set(slot, v.id);
    }

    renderBuffer.faceIdToBufferIndices.set(faceId, faceBufferIndices);

    const normal = computePlaneNormal(verts);
    const flat = projectTo2D(verts, normal);
    const tris = earcut(flat);
    if (tris.length === 0) {
      for (let i = 1; i < verts.length - 1; i++) {
        tris.push(0, i, i + 1);
      }
    }

    let idxSlot = renderBuffer.indexSlotAllocator.alloc(tris.length);
    if (idxSlot === -1) {
      this._growIndexBuffer(renderBuffer, geometry, tris.length * 2);
      idxSlot = renderBuffer.indexSlotAllocator.alloc(tris.length);
    }

    const indexAttr = geometry.index;
    for (let i = 0; i < tris.length; i++) {
      indexAttr.setX(idxSlot + i, vertSlot + tris[i]);
    }

    renderBuffer.faceTriangleOffset.set(faceId, idxSlot);
    renderBuffer.faceTriangleCount.set(faceId, tris.length);

    posAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;
    indexAttr.needsUpdate = true;
  }

  static deleteFace(meshData, renderBuffer, geometry, faceId) {
    const bufferIndices = renderBuffer.faceIdToBufferIndices.get(faceId);
    if (!bufferIndices) return;

    // Mask triangles as degenerate (all indices → same slot)
    const triOffset = renderBuffer.faceTriangleOffset.get(faceId);
    const triCount = renderBuffer.faceTriangleCount.get(faceId);
    const indexAttr = geometry.index;
    const degSlot = bufferIndices[0];

    for (let i = 0; i < triCount; i++) {
      indexAttr.setX(triOffset + i, degSlot);
    }

    renderBuffer.slotAllocator.free(bufferIndices[0], bufferIndices.length);
    renderBuffer.indexSlotAllocator.free(triOffset, triCount);

    for (const slot of bufferIndices) {
      const vertId = renderBuffer.bufferIndexToVertexId.get(slot);
      renderBuffer.bufferIndexToVertexId.delete(slot);
      if (vertId !== undefined) {
        const arr = renderBuffer.vertexIdToBufferIndex.get(vertId);
        if (arr) {
          const i = arr.indexOf(slot);
          if (i !== -1) arr.splice(i, 1);
          if (arr.length === 0) renderBuffer.vertexIdToBufferIndex.delete(vertId);
        }
      }
    }

    renderBuffer.faceIdToBufferIndices.delete(faceId);
    renderBuffer.faceTriangleOffset.delete(faceId);
    renderBuffer.faceTriangleCount.delete(faceId);

    indexAttr.needsUpdate = true;

    if (renderBuffer.slotAllocator.utilization < 0.25) {
      this.compact(meshData, renderBuffer, geometry);
    }
  }

  static _growVertexBuffer(renderBuffer, geometry, additionalSlots) {
    const posAttr = geometry.attributes.position;
    const uvAttr = geometry.attributes.uv;
    const oldCount = posAttr.count;
    const newCount = posAttr.count + additionalSlots;

    const newPos = new Float32Array(newCount * 3);
    newPos.set(posAttr.array);
    const newUV = new Float32Array(newCount * 2);
    newUV.set(uvAttr.array);

    geometry.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(newUV, 2));

    renderBuffer.slotAllocator.capacity += additionalSlots;
    renderBuffer.slotAllocator.freeBlocks.push({ start: oldCount, count: additionalSlots });
    renderBuffer.slotAllocator._mergeBlocks();
  }

  static _growIndexBuffer(renderBuffer, geometry, additionalSlots) {
    const idxAttr = geometry.index;
    const newCount = idxAttr.count + additionalSlots;
    
    const newIdx = new Uint32Array(newCount);
    newIdx.set(idxAttr.array);
    geometry.setIndex(new THREE.BufferAttribute(newIdx, 1));

    renderBuffer.indexSlotAllocator.capacity += additionalSlots;
    renderBuffer.indexSlotAllocator.freeBlocks.push({ start: idxAttr.count, count: additionalSlots });
    renderBuffer.indexSlotAllocator._mergeBlocks();
  }

  static compact(meshData, renderBuffer, geometry) {
    const { positions, uvs, indices, renderBuffer: fresh } = this.buildDuplicatedMeshData(meshData);

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();

    Object.assign(renderBuffer, fresh);
  }

  static calculateSmoothNormalsMap(meshData, renderBuffer) {
    const positions = [];
    const indices = [];

    const vertexIdToSharedIndex = new Map();
    const sharedIndexToVertexId = new Map();
    let currentIndex = 0;

    // Build the strictly shared geometry arrays
    for (let v of meshData.vertices.values()) {
      positions.push(v.position.x, v.position.y, v.position.z);
      vertexIdToSharedIndex.set(v.id, currentIndex);
      sharedIndexToVertexId.set(currentIndex, v.id);
      currentIndex++;
    }

    // Build indices
    for (let f of meshData.faces.values()) {
      let verts = f.vertexIds.map(id => meshData.vertices.get(id));

      const normal = computePlaneNormal(verts);
      const flatVertices = projectTo2D(verts, normal);
      const triangulated = earcut(flatVertices);

      for (let i = 0; i < triangulated.length; i += 3) {
        const a = vertexIdToSharedIndex.get(verts[triangulated[i]].id);
        const b = vertexIdToSharedIndex.get(verts[triangulated[i + 1]].id);
        const c = vertexIdToSharedIndex.get(verts[triangulated[i + 2]].id);
        indices.push(a, b, c);
      }
    }

    // Let Three.js calculate the perfect smooth normals
    const tmpGeo = new THREE.BufferGeometry();
    tmpGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    tmpGeo.setIndex(indices);
    tmpGeo.computeVertexNormals();
    const computedNormals = tmpGeo.attributes.normal.array;

    // Map the results back to the original Vertex IDs
    const vertexNormalsMap = new Map();
    for (let i = 0; i < currentIndex; i++) {
      const vertexId = sharedIndexToVertexId.get(i);
      vertexNormalsMap.set(vertexId, new THREE.Vector3(
        computedNormals[i * 3],
        computedNormals[(i * 3) + 1],
        computedNormals[(i * 3) + 2]
      ));
    }

    tmpGeo.dispose();

    const normalsMap = new Map();
    for (const [bufferIdx, vertexId] of renderBuffer.bufferIndexToVertexId) {
      normalsMap.set(bufferIdx, vertexNormalsMap.get(vertexId));
    }
    return normalsMap;
  }

  static calculateAngleBasedNormalsMap(meshData, renderBuffer, angleDegree = 60) {
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
    for (const face of meshData.faces.values()) {
      let verts = face.vertexIds.map(id => meshData.vertices.get(id));
      const faceBufferIndices = renderBuffer.faceIdToBufferIndices.get(face.id);
      const currentFaceNormal = faceNormals.get(face.id);

      for (let i = 0; i < verts.length; i++) {
        const averagedNormal = new THREE.Vector3();
        const neighborFaceIds = vertexToFaces.get(verts[i].id);

        for (const neighborId of neighborFaceIds) {
          const neighborNormal = faceNormals.get(neighborId);
          const angle = currentFaceNormal.angleTo(neighborNormal);

          if (angle <= threshold) {
            averagedNormal.add(neighborNormal);
          }
        }
        
        normalsMap.set(faceBufferIndices[i], averagedNormal.normalize());
      }
    }

    // Isolated vertices
    for (const v of meshData.vertices.values()) {
      if (vertexToFaces.has(v.id)) continue;
      for (const bufferIdx of renderBuffer.vertexIdToBufferIndex.get(v.id) ?? [])
        normalsMap.set(bufferIdx, new THREE.Vector3(0, 1, 0));
    }

    return normalsMap;
  }
}