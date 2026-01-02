export class VertexDuplicate {
  constructor(vertexEditor) {
    this.vertexEditor = vertexEditor;
  }

  get meshData() {
    return this.vertexEditor.meshData;
  }

  duplicateSelectionVertices(vertexIds) {
    const selectedVertices = new Set(vertexIds);
    const duplicatedVertices = new Map();
    const duplicatedEdges = new Map();
    const duplicatedFaces = new Map();

    // Duplicate vertices
    for (let vid of selectedVertices) {
      const oldVertex = this.meshData.getVertex(vid);
      if (!oldVertex) continue;

      const newPos = {
        x: oldVertex.position.x,
        y: oldVertex.position.y,
        z: oldVertex.position.z
      };

      const newVertex = this.meshData.addVertex(newPos);
      duplicatedVertices.set(oldVertex.id, newVertex);
    }

    // Find faces inside selection
    const facesToDuplicate = [];
    for (let face of this.meshData.faces.values()) {
      const faceVertices = new Set(face.vertexIds);
      const isInside = Array.from(faceVertices).every(vId => selectedVertices.has(vId));
      if (isInside) facesToDuplicate.push(face);
    }

    // Duplicate faces
    for (let oldFace of facesToDuplicate) {
      const newVertices = oldFace.vertexIds.map(vId => duplicatedVertices.get(vId));
      const newFace = this.meshData.addFace(newVertices);
      duplicatedFaces.set(oldFace.id, newFace);
    }

    // Handle Leftover edges
    for (let edge of this.meshData.edges.values()) {
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
            const newEdge = this.meshData.addEdge(v1, v2);
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
    const selectedEdges = new Set(edgeIds);
    const duplicatedVertices = new Map();
    const duplicatedEdges = new Map();
    const duplicatedFaces = new Map();

    // Duplicate vertices at the ends of selected edges
    for (let edgeId of selectedEdges) {
      const edge = this.meshData.edges.get(edgeId);
      if (!edge) continue;

      [edge.v1Id, edge.v2Id].forEach(vId => {
        if (!duplicatedVertices.has(vId)) {
          const oldVertex = this.meshData.getVertex(vId);
          if (!oldVertex) return;

          const newVertex = this.meshData.addVertex({
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
      const oldEdge = this.meshData.edges.get(edgeId);
      if (!oldEdge) continue;

      const v1 = duplicatedVertices.get(oldEdge.v1Id);
      const v2 = duplicatedVertices.get(oldEdge.v2Id);
      if (!v1 || !v2) continue;

      const newEdge = this.meshData.addEdge(v1, v2);
      duplicatedEdges.set(edgeId, newEdge);
    }

    // Duplicate faces where all edges are selected
    for (let face of this.meshData.faces.values()) {
      const allEdgesSelected = [...face.edgeIds].every(eid => selectedEdges.has(eid));
      if (allEdgesSelected) {
        const newVertices = face.vertexIds.map(vId => duplicatedVertices.get(vId));
        if (newVertices.every(v => v)) {
          const newFace = this.meshData.addFace(newVertices);
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
    const selectedFaces = new Set(faceIds);
    const duplicatedVertices = new Map();
    const duplicatedEdges = new Map();
    const duplicatedFaces = new Map();

    // Duplicate all vertices belonging to selected faces
    for (let faceId of selectedFaces) {
      const face = this.meshData.faces.get(faceId);
      if (!face) continue;

      for (let vId of face.vertexIds) {
        if (!duplicatedVertices.has(vId)) {
          const oldVertex = this.meshData.getVertex(vId);
          if (!oldVertex) continue;

          const newVertex = this.meshData.addVertex({
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
      const face = this.meshData.faces.get(faceId);
      if (!face) continue;

      for (let eId of face.edgeIds) {
        if (duplicatedEdges.has(eId)) continue;

        const oldEdge = this.meshData.edges.get(eId);
        if (!oldEdge) continue;

        const v1 = duplicatedVertices.get(oldEdge.v1Id);
        const v2 = duplicatedVertices.get(oldEdge.v2Id);

        if (!v1 || !v2) continue;

        const newEdge = this.meshData.addEdge(v1, v2);
        duplicatedEdges.set(eId, newEdge);
      }
    }

    // Duplicate the faces
    for (let faceId of selectedFaces) {
      const oldFace = this.meshData.faces.get(faceId);
      if (!oldFace) continue;

      const newVertices = oldFace.vertexIds.map(vId => duplicatedVertices.get(vId));

      if (!newVertices.every(v => v)) continue;

      const newFace = this.meshData.addFace(newVertices);
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
}