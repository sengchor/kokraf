import * as THREE from 'three';
import { MeshData } from '../core/MeshData.js';

export class MeshEditor {
  constructor(editor) {
    this.editor = editor;
  }

  mergeMeshData(meshDataList, transforms = [], inverseWorld = new THREE.Matrix4()) {
    const merged = new MeshData();
    const maps = [];

    for (let i = 0; i < meshDataList.length; i++) {
      const source = meshDataList[i];
      const transform = transforms[i] || new THREE.Matrix4();

      const vertexIdMap = new Map();
      const edgeIdMap = new Map();
      const faceIdMap = new Map();
      const claimedFaceIds = new Set();

      for (const vertex of source.vertices.values()) {
        const pos = new THREE.Vector3(
          vertex.position.x,
          vertex.position.y,
          vertex.position.z
        );
        pos.applyMatrix4(transform).applyMatrix4(inverseWorld);

        vertexIdMap.set(vertex.id, merged.addVertex(pos));
      }

      for (const face of source.faces.values()) {
        const newVertices = face.vertexIds.map(id => vertexIdMap.get(id));
        if (newVertices.some(v => !v)) continue;

        const newFace = merged.addFace(newVertices);
        faceIdMap.set(face.id, newFace.id);

        // addFace dedupes on a sorted vertex key, so two source faces on the
        // same vertex set collapse into one. Only the first owns the UVs.
        const isFirstClaim = !claimedFaceIds.has(newFace.id);
        claimedFaceIds.add(newFace.id);

        const uv = source.uvs.get(face.id);
        if (isFirstClaim && Array.isArray(uv)) {
          merged.uvs.set(newFace.id, uv.map(c => ({ u: c.u, v: c.v })));
        }

        const len = face.vertexIds.length;
        for (let k = 0; k < len; k++) {
          const aId = face.vertexIds[k];
          const bId = face.vertexIds[(k + 1) % len];
          const oldEdge = source.getEdge(aId, bId);
          if (!oldEdge || edgeIdMap.has(oldEdge.id)) continue;

          const newEdge = merged.getEdge(
            vertexIdMap.get(aId).id,
            vertexIdMap.get(bId).id
          );
          if (newEdge) edgeIdMap.set(oldEdge.id, newEdge.id);
        }
      }

      for (const edge of source.edges.values()) {
        if (edgeIdMap.has(edge.id)) continue;
        const v1 = vertexIdMap.get(edge.v1Id);
        const v2 = vertexIdMap.get(edge.v2Id);
        if (v1 && v2) edgeIdMap.set(edge.id, merged.addEdge(v1, v2).id);
      }

      maps.push({ vertexIdMap, edgeIdMap, faceIdMap });
    }

    return { merged, maps };
  }

  extractMeshData(meshData, mode, selection) {
    const extracted = new MeshData();

    const selectedVertices = new Set(selection.selectedVertexIds);
    const selectedEdges = new Set(selection.selectedEdgeIds);
    const selectedFaces = new Set(selection.selectedFaceIds);

    const verticesToExtract = new Set();
    const edgesToExtract = new Set();
    const facesToExtract = new Set();

    if (mode === 'vertex') {
      selectedVertices.forEach(vId => verticesToExtract.add(vId));

      for (const edge of meshData.edges.values()) {
        if (
          verticesToExtract.has(edge.v1Id) &&
          verticesToExtract.has(edge.v2Id)
        ) {
          edgesToExtract.add(edge.id);
        }
      }

      for (const face of meshData.faces.values()) {
        if (face.vertexIds.every(vId => verticesToExtract.has(vId))) {
          facesToExtract.add(face.id);
        }
      }
    }

    if (mode === 'edge') {
      selectedEdges.forEach(eId => edgesToExtract.add(eId));

      for (const eId of edgesToExtract) {
        const e = meshData.edges.get(eId);
        verticesToExtract.add(e.v1Id);
        verticesToExtract.add(e.v2Id);
      }

      for (const face of meshData.faces.values()) {
        if ([...face.edgeIds].every(eId => edgesToExtract.has(eId))) {
          facesToExtract.add(face.id);
        }
      }
    }

    if (mode === 'face') {
      selectedFaces.forEach(fId => facesToExtract.add(fId));

      for (const fId of facesToExtract) {
        const f = meshData.faces.get(fId);
        f.vertexIds.forEach(vId => verticesToExtract.add(vId));
        [...f.edgeIds].forEach(eId => edgesToExtract.add(eId));
      }
    }

    const vertexIdMap = new Map();
    const edgeIdMap = new Map();
    const faceIdMap = new Map();
    const claimedFaceIds = new Set();

    for (const vId of verticesToExtract) {
      const v = meshData.getVertex(vId);
      vertexIdMap.set(vId, extracted.addVertex({
        x: v.position.x,
        y: v.position.y,
        z: v.position.z
      }));
    }

    for (const eId of edgesToExtract) {
      const e = meshData.edges.get(eId);
      const v1 = vertexIdMap.get(e.v1Id);
      const v2 = vertexIdMap.get(e.v2Id);
      if (v1 && v2) extracted.addEdge(v1, v2);
    }

    for (const fId of facesToExtract) {
      const f = meshData.faces.get(fId);
      const newVertices = f.vertexIds.map(vId => vertexIdMap.get(vId));
      if (newVertices.some(v => !v)) continue;

      const newFace = extracted.addFace(newVertices);
      faceIdMap.set(fId, newFace.id);

      const isFirstClaim = !claimedFaceIds.has(newFace.id);
      claimedFaceIds.add(newFace.id);

      const uv = meshData.uvs.get(fId);
      if (isFirstClaim && Array.isArray(uv)) {
        extracted.uvs.set(newFace.id, uv.map(c => ({ u: c.u, v: c.v })));
      }
    }

    for (const eId of edgesToExtract) {
      const e = meshData.edges.get(eId);
      const v1 = vertexIdMap.get(e.v1Id);
      const v2 = vertexIdMap.get(e.v2Id);
      if (!v1 || !v2) continue;
      const newEdge = extracted.getEdge(v1.id, v2.id);
      if (newEdge) edgeIdMap.set(eId, newEdge.id);
    }

    const map = { vertexIdMap, edgeIdMap, faceIdMap };

    return { extracted, map };
  }

  setOriginToGeometry(meshData) {
    if (!meshData || meshData.vertices.size === 0) return;

    const center = new THREE.Vector3();
    const vertex = new THREE.Vector3();

    for (const v of meshData.vertices.values()) {
      vertex.set(v.position.x, v.position.y, v.position.z);
      center.add(vertex);
    }

    center.divideScalar(meshData.vertices.size);

    for (const v of meshData.vertices.values()) {
      v.position.x -= center.x;
      v.position.y -= center.y;
      v.position.z -= center.z;
    }

    return center;
  }

  applyLocationToGeometry(meshData, offset) {
    if (!meshData || meshData.vertices.size === 0) return;

    for (const v of meshData.vertices.values()) {
      v.position.x += offset.x;
      v.position.y += offset.y;
      v.position.z += offset.z;
    }
  }

  applyRotationToGeometry(meshData, quaternion) {
    if (!meshData || meshData.vertices.size === 0) return;

    const v = new THREE.Vector3();

    for (const vert of meshData.vertices.values()) {
      v.set(vert.position.x, vert.position.y, vert.position.z);
      v.applyQuaternion(quaternion);

      vert.position.x = v.x;
      vert.position.y = v.y;
      vert.position.z = v.z;
    }
  }

  applyScaleToGeometry(meshData, scale) {
    if (!meshData || meshData.vertices.size === 0) return;

    for (const v of meshData.vertices.values()) {
      v.position.x *= scale.x;
      v.position.y *= scale.y;
      v.position.z *= scale.z;
    }
  }

  flipNormals(meshData, faceIds) {
    for (const fid of faceIds) {
      const face = meshData.faces.get(fid);
      if (!face) continue;

      face.vertexIds.reverse();

      for (let edgeId of face.edgeIds) {
        const edge = meshData.edges.get(edgeId);
        if (edge) edge.faceIds.delete(fid);
      }

      face.edgeIds.clear();
      const len = face.vertexIds.length;
      for (let i = 0; i < len; i++) {
        const v1Id = face.vertexIds[i];
        const v2Id = face.vertexIds[(i + 1) % len];

        const edge = meshData.getEdge(v1Id, v2Id);

        face.edgeIds.add(edge.id);
        edge.faceIds.add(fid);
      }
    }
  }
}