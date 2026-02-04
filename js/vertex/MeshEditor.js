import * as THREE from 'three';
import { MeshData } from '../core/MeshData.js';

export class MeshEditor {
  constructor(editor) {
    this.editor = editor;
  }

  mergeMeshData(meshDataList, transforms = [], inverseWorld) {
    const merged = new MeshData();

    for (let i = 0; i < meshDataList.length; i++) {
      const source = meshDataList[i];
      const transform = transforms[i] || new THREE.Matrix4();

      const vertexIdMap = new Map();

      for (const vertex of source.vertices.values()) {
        const pos = new THREE.Vector3(
          vertex.position.x,
          vertex.position.y,
          vertex.position.z
        );
        pos.applyMatrix4(transform).applyMatrix4(inverseWorld);

        vertexIdMap.set(
          vertex.id,
          merged.addVertex({ x: pos.x, y: pos.y, z: pos.z })
        );
      }

      for (const face of source.faces.values()) {
        merged.addFace(
          face.vertexIds.map(id => vertexIdMap.get(id))
        );
      }
    }

    return merged;
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

    for (const vId of verticesToExtract) {
      const v = meshData.getVertex(vId);
      const newId = extracted.addVertex({
        x: v.position.x,
        y: v.position.y,
        z: v.position.z
      });
      vertexIdMap.set(vId, newId);
    }

    for (const eId of edgesToExtract) {
      const e = meshData.edges.get(eId);
      extracted.addEdge(
        vertexIdMap.get(e.v1Id),
        vertexIdMap.get(e.v2Id)
      );
    }

    for (const fId of facesToExtract) {
      const f = meshData.faces.get(fId);
      extracted.addFace(
        f.vertexIds.map(vId => vertexIdMap.get(vId))
      );
    }

    return extracted;
  }
}