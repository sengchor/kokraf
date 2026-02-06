import * as THREE from 'three';

export class VertexTopologyUtils {
  constructor(vertexEditor) {
    this.vertexEditor = vertexEditor;
  }

  get meshData() {
    return this.vertexEditor.meshData;
  }

  createFaceFromVertices(vertexIds) {
    if (!this.meshData || !vertexIds || vertexIds.length < 3) {
      return null;
    }

    const vertices = vertexIds.map(id => this.meshData.getVertex(id)).filter(v => v !== undefined);
    if (vertices.length < 3) return null;

    const newFace = this.meshData.addFace(vertices);

    return newFace ? newFace.id : null;
  }

  createEdgeFaceFromVertices(vertexIds) {
    if (!this.meshData || !Array.isArray(vertexIds)) {
      return null;
    }

    const vertices = vertexIds
      .map(id => this.meshData.getVertex(id))
      .filter(v => v !== null);

    if (vertices.length < 2) {
      return null;
    }

    if (vertices.length === 2) {
      const [v1, v2] = vertices;
      const edge = this.meshData.addEdge(v1, v2);
      return edge ? { edgeId: edge.id, faceId: null } : null;
    }

    const face = this.meshData.addFace(vertices);
    return face ? { edgeId: null, faceId: face.id } : null;
  }

  mergeVertices(vertexIds) {
    if (!Array.isArray(vertexIds) || vertexIds.length < 2) return null;

    const vertices = vertexIds
      .map((id) => this.meshData.getVertex(id))
      .filter((v) => v !== null);

    if (vertices.length < 2) return null;

    const target = vertices[0];
    const removedVertices = vertices.slice(1);
    const removedIds = new Set(removedVertices.map((v) => v.id));
    const allMergeIds = new Set(vertices.map((v) => v.id));

    // Centroid Calculation
    const center = new THREE.Vector3();
    for (const v of vertices) {
      center.add(new THREE.Vector3(v.position.x, v.position.y, v.position.z));
    }
    center.divideScalar(vertices.length);
    target.position = { x: center.x, y: center.y, z: center.z };

    // Collect Affected Faces
    const affectedFaceIds = new Set();
    vertices.forEach(v => v.faceIds.forEach(fid => affectedFaceIds.add(fid)));

    // Rewire and Clean Edges
    for (const v of removedVertices) {
      const edgesToProcess = [...v.edgeIds];

      for (const edgeId of edgesToProcess) {
        const edge = this.meshData.edges.get(edgeId);
        if (!edge) continue;

        // Find the vertex on the other side of the edge
        const neighborId = edge.v1Id === v.id ? edge.v2Id : edge.v1Id;

        // Case A: Edge is between merged vertices → remove it
        if (allMergeIds.has(neighborId)) {
          this.meshData.edges.delete(edge.id);
          const neighbor = this.meshData.getVertex(neighborId);
          if (neighbor) neighbor.edgeIds.delete(edge.id);
          continue;
        }

        // Case B: Edge goes outside the merge group
        const existingEdge = this.meshData.getEdge(target.id, neighborId);

        if (existingEdge) {
          // Duplicate edge → remove redundant one
          const neighbor = this.meshData.getVertex(neighborId);
          if (neighbor) neighbor.edgeIds.delete(edge.id);
          
          this.meshData.edges.delete(edge.id);
        } else {
          // Unique edge → reconnect it to target
          if (edge.v1Id === v.id) edge.v1Id = target.id;
          else edge.v2Id = target.id;

          target.edgeIds.add(edge.id);
        }
      }
    }

    // Update and Validate Faces
    for (const faceId of affectedFaceIds) {
      const face = this.meshData.faces.get(faceId);
      if (!face) continue;

      // Replace removed vertices with target
      const newVertexIds = face.vertexIds.map(vid => 
        removedIds.has(vid) ? target.id : vid
      );

      // Remove consecutive duplicates
      const uniqueIds = [];
      if (newVertexIds.length > 0) {
        uniqueIds.push(newVertexIds[0]);
        for (let i = 1; i < newVertexIds.length; i++) {
          if (newVertexIds[i] !== newVertexIds[i - 1]) {
            uniqueIds.push(newVertexIds[i]);
          }
        }
        if (uniqueIds.length > 1 && uniqueIds[0] === uniqueIds[uniqueIds.length - 1]) {
          uniqueIds.pop();
        }
      }

      // Delete face if it collapses to a line or point
      const uniqueSet = new Set(uniqueIds);
      if (uniqueSet.size < 3) {
        this.meshData.deleteFace(face);
        continue;
      }

      // Apply updated vertices
      face.vertexIds = uniqueIds;
      face.edgeIds.clear();

      // Rebuild face-edge links
      for (let i = 0; i < uniqueIds.length; i++) {
        const v1 = uniqueIds[i];
        const v2 = uniqueIds[(i + 1) % uniqueIds.length];
        
        const edge = this.meshData.getEdge(v1, v2);
        
        if (edge) {
          face.edgeIds.add(edge.id);
          edge.faceIds.add(face.id);
        }
      }
      
      target.faceIds.add(face.id);
    }

    // Remove merged vertices
    for (const v of removedVertices) {
      this.meshData.vertices.delete(v.id);
    }

    return target.id;
  }

  getBoundaryEdges(vertexIds, edgeIds, faceIds) {
    const selectedVertexSet = new Set(vertexIds);
    const selectedFaceSet = new Set(faceIds);

    // Map edgeKey -> count (how many selected faces reference this edge)
    const edgeCount = new Map();

    for (const faceId of selectedFaceSet) {
      const face = this.meshData.faces.get(faceId);
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
        const edge = this.meshData.getEdge(a, b);
        if (edge) boundaryEdges.push(edge);
      }
    }

    // Add remaining selected edges not part of any selected face
    if (edgeIds && edgeIds.length > 0) {
      for (const eId of edgeIds) {
        const edge = this.meshData.edges.get(eId);
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