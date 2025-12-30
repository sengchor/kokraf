import * as THREE from 'three';
import { ShadingUtils } from "../utils/ShadingUtils.js";
import { MeshData } from "../core/MeshData.js";

export class VertexEditor {
  constructor(editor, object3D) {
    this.editor = editor;
    this.object = object3D;
    this.sceneManager = editor.sceneManager;
    this.editHelpers = editor.editHelpers;
  }

  get geometry() {
    return this.object.geometry;
  }

  set geometry(value) {
    this.object.geometry = value;
  }

  get positionAttr() {
    return this.object.geometry.attributes.position;
  }

  setVerticesWorldPositions(logicalVertexIds, worldPositions) {
    if (!this.object || !this.positionAttr) return;

    const meshData = this.object.userData.meshData;
    const vertexIndexMap = meshData.vertexIndexMap;

    const inverseW = new THREE.Matrix4().copy(this.object.matrixWorld).invert();

    const affectedVertices = new Set();
    const affectedEdges = new Set();
    const affectedFaces = new Set();

    // Update vertex positions
    for (let i = 0; i < logicalVertexIds.length; i++) {
      const logicalId = logicalVertexIds[i];
      const worldPos = worldPositions[i];
      const localPos = worldPos.clone().applyMatrix4(inverseW);

      const indices = vertexIndexMap.get(logicalId);
      if (!indices) continue;

      for (let bufferIndex of indices) {
        this.positionAttr.setXYZ(bufferIndex, localPos.x, localPos.y, localPos.z);
      }

      const v = meshData.getVertex(logicalId);
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

  getVertexPosition(logicalVertexId) {
    if (!this.object || !this.positionAttr) return null;

    const meshData = this.object.userData.meshData;
    const vertexIndexMap = meshData.vertexIndexMap;
    const indices = vertexIndexMap.get(logicalVertexId);
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
    if (!this.object || !this.object.userData.meshData) return;

    const meshData = this.object.userData.meshData;

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

  duplicateSelectionVertices(vertexIds) {
    const meshData = this.object.userData.meshData;

    const selectedVertices = new Set(vertexIds);
    const duplicatedVertices = new Map();
    const duplicatedEdges = new Map();
    const duplicatedFaces = new Map();

    // Duplicate vertices
    for (let vid of selectedVertices) {
      const oldVertex = meshData.getVertex(vid);
      if (!oldVertex) continue;

      const newPos = {
        x: oldVertex.position.x,
        y: oldVertex.position.y,
        z: oldVertex.position.z
      };

      const newVertex = meshData.addVertex(newPos);
      duplicatedVertices.set(oldVertex.id, newVertex);
    }

    // Find faces inside selection
    const facesToDuplicate = [];
    for (let face of meshData.faces.values()) {
      const faceVertices = new Set(face.vertexIds);
      const isInside = Array.from(faceVertices).every(vId => selectedVertices.has(vId));
      if (isInside) facesToDuplicate.push(face);
    }

    // Duplicate faces
    for (let oldFace of facesToDuplicate) {
      const newVertices = oldFace.vertexIds.map(vId => duplicatedVertices.get(vId));
      const newFace = meshData.addFace(newVertices);
      duplicatedFaces.set(oldFace.id, newFace);
    }

    // Handle Leftover edges
    for (let edge of meshData.edges.values()) {
      const v1Selected = selectedVertices.has(edge.v1Id);
      const v2Selected = selectedVertices.has(edge.v2Id);

      if (v1Selected && v2Selected) {
        const allFacesDuplicated = Array.from(edge.faceIds).every(fid =>
          duplicatedFaces.has(fid)
        );

        if (!allFacesDuplicated) {
          const v1 = duplicatedVertices.get(edge.v1Id);
          const v2 = duplicatedVertices.get(edge.v2Id);

          if (v1 && v2) {
            const newEdge = meshData.addEdge(v1, v2);
            duplicatedEdges.set(edge.id, newEdge);
          }
        }
      }
    }

    const mappedVertexIds = {};
    for (let [oldId, newVertex] of duplicatedVertices.entries()) {
      mappedVertexIds[oldId] = newVertex.id;
    }

    const newVertexIds = Array.from(duplicatedVertices.values()).map(v => v.id);
    const newEdgeIds = Array.from(duplicatedEdges.values()).map(e => e.id);
    const newFaceIds = Array.from(duplicatedFaces.values()).map(f => f.id);
    return { mappedVertexIds, newVertexIds, newEdgeIds, newFaceIds };
  }

  duplicateSelectionEdges(edgeIds) {
    const meshData = this.object.userData.meshData;

    const selectedEdges = new Set(edgeIds);
    const duplicatedVertices = new Map();
    const duplicatedEdges = new Map();
    const duplicatedFaces = new Map();

    // Duplicate vertices at the ends of selected edges
    for (let edgeId of selectedEdges) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      [edge.v1Id, edge.v2Id].forEach(vId => {
        if (!duplicatedVertices.has(vId)) {
          const oldVertex = meshData.getVertex(vId);
          if (!oldVertex) return;

          const newVertex = meshData.addVertex({
            x: oldVertex.position.x,
            y: oldVertex.position.y,
            z: oldVertex.position.z
          });

          duplicatedVertices.set(vId, newVertex);
        }
      });
    }

    // Duplicate edges
    for (let edgeId of selectedEdges) {
      const oldEdge = meshData.edges.get(edgeId);
      if (!oldEdge) continue;

      const v1 = duplicatedVertices.get(oldEdge.v1Id);
      const v2 = duplicatedVertices.get(oldEdge.v2Id);
      if (!v1 || !v2) continue;

      const newEdge = meshData.addEdge(v1, v2);
      duplicatedEdges.set(edgeId, newEdge);
    }

    // Duplicate faces where all edges are selected
    for (let face of meshData.faces.values()) {
      const allEdgesSelected = [...face.edgeIds].every(eid => selectedEdges.has(eid));
      if (allEdgesSelected) {
        const newVertices = face.vertexIds.map(vId => duplicatedVertices.get(vId));
        if (newVertices.every(v => v)) {
          const newFace = meshData.addFace(newVertices);
          duplicatedFaces.set(face.id, newFace);
        }
      }
    }

    // Map old vertex IDs to new ones
    const mappedVertexIds = {};
    for (let [oldId, newVertex] of duplicatedVertices.entries()) {
      mappedVertexIds[oldId] = newVertex.id;
    }

    const newVertexIds = Array.from(duplicatedVertices.values()).map(v => v.id);
    const newEdgeIds = Array.from(duplicatedEdges.values()).map(e => e.id);
    const newFaceIds = Array.from(duplicatedFaces.values()).map(f => f.id);
    return { mappedVertexIds, newVertexIds, newEdgeIds, newFaceIds };
  }

  duplicateSelectionFaces(faceIds) {
    const meshData = this.object.userData.meshData;

    const selectedFaces = new Set(faceIds);
    const duplicatedVertices = new Map();
    const duplicatedEdges = new Map();
    const duplicatedFaces = new Map();

    // Duplicate all vertices belonging to selected faces
    for (let faceId of selectedFaces) {
      const face = meshData.faces.get(faceId);
      if (!face) continue;

      for (let vId of face.vertexIds) {
        if (!duplicatedVertices.has(vId)) {
          const oldVertex = meshData.getVertex(vId);
          if (!oldVertex) continue;

          const newVertex = meshData.addVertex({
            x: oldVertex.position.x,
            y: oldVertex.position.y,
            z: oldVertex.position.z
          });

          duplicatedVertices.set(vId, newVertex);
        }
      }
    }

    // Duplicate edges belonging only to selected faces
    for (let faceId of selectedFaces) {
      const face = meshData.faces.get(faceId);
      if (!face) continue;

      for (let eId of face.edgeIds) {
        if (duplicatedEdges.has(eId)) continue;

        const oldEdge = meshData.edges.get(eId);
        if (!oldEdge) continue;

        const v1 = duplicatedVertices.get(oldEdge.v1Id);
        const v2 = duplicatedVertices.get(oldEdge.v2Id);

        if (!v1 || !v2) continue;

        const newEdge = meshData.addEdge(v1, v2);
        duplicatedEdges.set(eId, newEdge);
      }
    }

    // Duplicate the faces
    for (let faceId of selectedFaces) {
      const oldFace = meshData.faces.get(faceId);
      if (!oldFace) continue;

      const newVertices = oldFace.vertexIds.map(vId => duplicatedVertices.get(vId));

      if (!newVertices.every(v => v)) continue;

      const newFace = meshData.addFace(newVertices);
      duplicatedFaces.set(faceId, newFace);
    }

    // Map old vertex IDs to new ones
    const mappedVertexIds = {};
    for (let [oldId, newVertex] of duplicatedVertices.entries()) {
      mappedVertexIds[oldId] = newVertex.id;
    }

    const newVertexIds = Array.from(duplicatedVertices.values()).map(v => v.id);
    const newEdgeIds = Array.from(duplicatedEdges.values()).map(e => e.id);
    const newFaceIds = Array.from(duplicatedFaces.values()).map(f => f.id);
    return { mappedVertexIds, newVertexIds, newEdgeIds, newFaceIds };
  }

  deleteVertices(vertexIds) {
    const meshData = this.object.userData.meshData;
    for (const vId of vertexIds) {
      const vertex = meshData.vertices.get(vId);
      if (!vertex) continue;
      meshData.deleteVertex(vertex);
    }
  }

  deleteEdgesAndFacesOnly(edgeIds) {
    const meshData = this.object.userData.meshData;
    for (const edgeId of edgeIds) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;
      meshData.deleteEdge(edge);
    }
  }

  deleteFacesOnly(faceIds) {
    const meshData = this.object.userData.meshData;
    for (const faceId of faceIds) {
      const face = meshData.faces.get(faceId);
      if (!face) continue;
      meshData.deleteFace(face);
    }
  }

  deleteEdges(edgeIds) {
    const meshData = this.object.userData.meshData;

    const candidateVertices = new Set();

    // Delete edges & track affected vertices
    for (const edgeId of edgeIds) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      candidateVertices.add(edge.v1Id);
      candidateVertices.add(edge.v2Id);

      meshData.deleteEdge(edge);
    }

    this.cleanupOrphanVertices(meshData, candidateVertices);
  }

  deleteFaces(faceIds) {
    const meshData = this.object.userData.meshData;

    const candidateEdges = new Set();
    const candidateVertices = new Set();

    // Delete faces & track affected vertices and edges
    for (const faceId of faceIds) {
      const face = meshData.faces.get(faceId);
      if (!face) continue;

      for (const edgeId of face.edgeIds) {
        candidateEdges.add(edgeId);
      }

      for (const vId of face.vertexIds) {
        candidateVertices.add(vId);
      }

      meshData.deleteFace(face);
    }

    this.cleanupOrphanEdges(meshData, candidateEdges);
    this.cleanupOrphanVertices(meshData, candidateVertices);
  }

  deleteSelectionVertices(vertexIds) {
    const meshData = this.object.userData.meshData;
    const selected = new Set(vertexIds);

    const deletedFaces = new Set();
    const candidateEdges = new Set();
    const candidateVertices = new Set();

    // Delete faces fully contained in the selection
    for (const face of [...meshData.faces.values()]) {
      const allVerticesInside = face.vertexIds.every(vId => selected.has(vId));

      if (allVerticesInside) {
        for (const edgeId of face.edgeIds) {
          candidateEdges.add(edgeId);
        }
        for (const vId of face.vertexIds) {
          candidateVertices.add(vId);
        }

        meshData.deleteFace(face);
        deletedFaces.add(face.id);
      }
    }

    const deletedEdges = this.cleanupOrphanEdges(meshData, candidateEdges);
    const deletedVertices = this.cleanupOrphanEdges(meshData, candidateVertices);

    return {
      deletedFaces: Array.from(deletedFaces),
      deletedEdges: Array.from(deletedEdges),
      deletedVertices: Array.from(deletedVertices)
    };
  }

  deleteSelectionEdges(edgeIds) {
    const meshData = this.object.userData.meshData;
    const selected = new Set(edgeIds);

    const deletedFaces = new Set();
    const candidateEdges = new Set();
    const candidateVertices = new Set();

    // Delete faces fully bounded by the selected edges
    for (const face of [...meshData.faces.values()]) {
      const allEdgesInside = [...face.edgeIds].every(eId => selected.has(eId));

      if (allEdgesInside) {
        for (const edgeId of face.edgeIds) {
          candidateEdges.add(edgeId);
        }
        for (const vId of face.vertexIds) {
          candidateVertices.add(vId);
        }

        meshData.deleteFace(face);
        deletedFaces.add(face.id);
      }
    }

    const deletedEdges = this.cleanupOrphanEdges(meshData, candidateEdges);
    const deletedVertices = this.cleanupOrphanEdges(meshData, candidateVertices);

    return {
      deletedFaces: [...deletedFaces],
      deletedEdges: [...deletedEdges],
      deletedVertices: [...deletedVertices]
    };
  }
  
  deleteSelectionFaces(faceIds) {
    const meshData = this.object.userData.meshData;
    const selected = new Set(faceIds);

    const deletedFaces = new Set();
    const candidateEdges = new Set();
    const candidateVertices = new Set();

    // Delete the selected faces
    for (const faceId of selected) {
      const face = meshData.faces.get(faceId);
      if (!face) continue;

      for (const edgeId of face.edgeIds) {
        candidateEdges.add(edgeId);
      }

      for (const vId of face.vertexIds) {
        candidateVertices.add(vId);
      }

      meshData.deleteFace(face);
      deletedFaces.add(faceId);
    }

    const deletedEdges = this.cleanupOrphanEdges(meshData, candidateEdges);
    const deletedVertices = this.cleanupOrphanEdges(meshData, candidateVertices);

    return {
      deletedFaces: Array.from(deletedFaces),
      deletedEdges: Array.from(deletedEdges),
      deletedVertices: Array.from(deletedVertices)
    };
  }

  // Delete edges that no longer belong to any face
  cleanupOrphanEdges(meshData, candidateEdges) {
    const deletedEdges = new Set();

    for (const edgeId of candidateEdges) {
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      if (edge.faceIds.size === 0) {
        meshData.deleteEdge(edge);
        deletedEdges.add(edgeId);
      }
    }

    return deletedEdges;
  }

  // Delete vertices that have no edges and no faces
  cleanupOrphanVertices(meshData, candidateVertices) {
    const deletedVertices = new Set();

    for (const vId of candidateVertices) {
      const vertex = meshData.vertices.get(vId);
      if (!vertex) continue;

      if (vertex.edgeIds.size === 0 && vertex.faceIds.size === 0) {
        meshData.deleteVertex(vertex);
        deletedVertices.add(vId);
      }
    }

    return deletedVertices;
  }

  createFaceFromVertices(vertexIds) {
    const meshData = this.object.userData.meshData;
    if (!meshData || !vertexIds || vertexIds.length < 3) {
      return null;
    }

    const vertices = vertexIds.map(id => meshData.getVertex(id)).filter(v => v !== undefined);
    if (vertices.length < 3) return null;

    const newFace = meshData.addFace(vertices);

    return newFace ? newFace.id : null;
  }

  getBoundaryEdges(meshData, vertexIds, edgeIds, faceIds) {
    const selectedVertexSet = new Set(vertexIds);
    const selectedFaceSet = new Set(faceIds);

    // Map edgeKey -> count (how many selected faces reference this edge)
    const edgeCount = new Map();

    for (const faceId of selectedFaceSet) {
      const face = meshData.faces.get(faceId);
      if (!face) continue;
      const vIds = face.vertexIds;

      for (let i = 0; i < vIds.length; i++) {
        const v1 = vIds[i];
        const v2 = vIds[(i + 1) % vIds.length];

        if (selectedVertexSet.has(v1) && selectedVertexSet.has(v2)) {
          const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
          edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
        }
      }
    }

    // Boundary edges from faces
    const boundaryEdges = [];
    for (const [key, count] of edgeCount) {
      if (count === 1) {
        const [a, b] = key.split("_").map(Number);
        const edge = meshData.getEdge(a, b);
        if (edge) boundaryEdges.push(edge);
      }
    }

    // Add remaining selected edges not part of any selected face
    if (edgeIds && edgeIds.length > 0) {
      for (const eId of edgeIds) {
        const edge = meshData.edges.get(eId);
        if (!edge) continue;

        const key = edge.v1Id < edge.v2Id ? `${edge.v1Id}_${edge.v2Id}` : `${edge.v2Id}_${edge.v1Id}`;
        if (!edgeCount.has(key)) {
          boundaryEdges.push(edge);
        }
      }
    }

    return boundaryEdges; // Array of Edge objects
  }
}