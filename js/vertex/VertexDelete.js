export class VertexDelete {
  constructor(vertexEditor) {
    this.vertexEditor = vertexEditor;
  }

  get meshData() {
    return this.vertexEditor.meshData;
  }
  
  deleteVertices(vertexIds) {
    for (const vId of vertexIds) {
      const vertex = this.meshData.vertices.get(vId);
      if (!vertex) continue;
      this.meshData.deleteVertex(vertex);
    }
  }

  deleteEdgesAndFacesOnly(edgeIds) {
    for (const edgeId of edgeIds) {
      const edge = this.meshData.edges.get(edgeId);
      if (!edge) continue;
      this.meshData.deleteEdge(edge);
    }
  }

  deleteFacesOnly(faceIds) {
    for (const faceId of faceIds) {
      const face = this.meshData.faces.get(faceId);
      if (!face) continue;
      this.meshData.deleteFace(face);
    }
  }

  deleteEdges(edgeIds) {
    const candidateVertices = new Set();

    // Delete edges & track affected vertices
    for (const edgeId of edgeIds) {
      const edge = this.meshData.edges.get(edgeId);
      if (!edge) continue;

      candidateVertices.add(edge.v1Id);
      candidateVertices.add(edge.v2Id);

      this.meshData.deleteEdge(edge);
    }

    this.cleanupOrphanVertices(this.meshData, candidateVertices);
  }

  deleteFaces(faceIds) {
    const candidateEdges = new Set();
    const candidateVertices = new Set();

    // Delete faces & track affected vertices and edges
    for (const faceId of faceIds) {
      const face = this.meshData.faces.get(faceId);
      if (!face) continue;

      for (const edgeId of face.edgeIds) {
        candidateEdges.add(edgeId);
      }

      for (const vId of face.vertexIds) {
        candidateVertices.add(vId);
      }

      this.meshData.deleteFace(face);
    }

    this.cleanupOrphanEdges(this.meshData, candidateEdges);
    this.cleanupOrphanVertices(this.meshData, candidateVertices);
  }

  deleteSelectionVertices(vertexIds) {
    const selected = new Set(vertexIds);

    const deletedFaces = new Set();
    const candidateEdges = new Set();
    const candidateVertices = new Set();

    // Delete faces fully contained in the selection
    for (const face of [...this.meshData.faces.values()]) {
      const allVerticesInside = face.vertexIds.every(vId => selected.has(vId));

      if (allVerticesInside) {
        for (const edgeId of face.edgeIds) {
          candidateEdges.add(edgeId);
        }
        for (const vId of face.vertexIds) {
          candidateVertices.add(vId);
        }

        this.meshData.deleteFace(face);
        deletedFaces.add(face.id);
      }
    }

    const deletedEdges = this.cleanupOrphanEdges(this.meshData, candidateEdges);
    const deletedVertices = this.cleanupOrphanVertices(this.meshData, candidateVertices);

    return {
      deletedFaces: Array.from(deletedFaces),
      deletedEdges: Array.from(deletedEdges),
      deletedVertices: Array.from(deletedVertices)
    };
  }

  deleteSelectionEdges(edgeIds) {
    const selected = new Set(edgeIds);

    const deletedFaces = new Set();
    const candidateEdges = new Set();
    const candidateVertices = new Set();

    // Delete faces fully bounded by the selected edges
    for (const face of [...this.meshData.faces.values()]) {
      const allEdgesInside = [...face.edgeIds].every(eId => selected.has(eId));

      if (allEdgesInside) {
        for (const edgeId of face.edgeIds) {
          candidateEdges.add(edgeId);
        }
        for (const vId of face.vertexIds) {
          candidateVertices.add(vId);
        }

        this.meshData.deleteFace(face);
        deletedFaces.add(face.id);
      }
    }

    const deletedEdges = this.cleanupOrphanEdges(this.meshData, candidateEdges);
    const deletedVertices = this.cleanupOrphanVertices(this.meshData, candidateVertices);

    return {
      deletedFaces: [...deletedFaces],
      deletedEdges: [...deletedEdges],
      deletedVertices: [...deletedVertices]
    };
  }

  deleteSelectionFaces(faceIds) {
    const selected = new Set(faceIds);

    const deletedFaces = new Set();
    const candidateEdges = new Set();
    const candidateVertices = new Set();

    // Delete the selected faces
    for (const faceId of selected) {
      const face = this.meshData.faces.get(faceId);
      if (!face) continue;

      for (const edgeId of face.edgeIds) {
        candidateEdges.add(edgeId);
      }

      for (const vId of face.vertexIds) {
        candidateVertices.add(vId);
      }

      this.meshData.deleteFace(face);
      deletedFaces.add(faceId);
    }

    const deletedEdges = this.cleanupOrphanEdges(this.meshData, candidateEdges);
    const deletedVertices = this.cleanupOrphanVertices(this.meshData, candidateVertices);

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
}