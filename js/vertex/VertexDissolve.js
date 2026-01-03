export class VertexDissolve {
  constructor(vertexEditor) {
    this.vertexEditor = vertexEditor;
    this.topology = vertexEditor.topology;
    this.delete = vertexEditor.delete;
  }

  get meshData() {
    return this.vertexEditor.meshData;
  }

  dissolveVertices(vertexIds) {
    const edgeVertices = [];
    const faceVertices = [];

    for (const vId of vertexIds) {
      const v = this.meshData.vertices.get(vId);
      if (!v) continue;

      if (v.edgeIds.size === 2) {
        edgeVertices.push(vId);
      } else {
        faceVertices.push(vId);
      }
    }

    this.dissolveEdgeVertices(edgeVertices);
    this.dissolveFaceVertices(faceVertices);
  }

  getEdgeOppositeVertices(v) {
    const edges = [...v.edgeIds].map(eId => this.meshData.edges.get(eId)).filter(Boolean);
    if (edges.length !== 2) return null;

    const [e1, e2] = edges;

    const a = e1.v1Id === v.id ? e1.v2Id : e1.v1Id;
    const b = e2.v1Id === v.id ? e2.v2Id : e2.v1Id;

    return [a, b, e1, e2];
  }

  dissolveEdgeVertices(vertexIds) {
    for (const vId of vertexIds) {
      const v = this.meshData.vertices.get(vId);
      if (!v) continue;

      if (v.edgeIds.size !== 2) continue;

      const result = this.getEdgeOppositeVertices(v);
      if (!result) continue;

      const [aId, bId, e1, e2] = result;
      if (aId === bId) continue;

      for (const faceId of v.faceIds) {
        const face = this.meshData.faces.get(faceId);
        if (!face) continue;

        const newVertexIds = face.vertexIds.filter(id => id !== vId);

        if (newVertexIds.length < 3) {
          this.meshData.deleteFace(face);
          continue;
        }

        this.meshData.deleteFace(face);
        this.topology.createFaceFromVertices(newVertexIds);
      }

      // Remove old edges and vertex
      this.meshData.deleteEdge(e1);
      this.meshData.deleteEdge(e2);
      this.meshData.deleteVertex(v);
    }
  }

  dissolveFaceVertices(vertexIds) {
    const vertexIslands = this.splitVertexIslands(vertexIds);

    for (const island of vertexIslands) {
      const candidateFaces = new Set();
      const candidateEdges = new Set();
      const candidateVertices = new Set();

      for (const vertexId of island) {
        const vertex = this.meshData.vertices.get(vertexId);
        if (!vertex) continue;

        for (const faceId of vertex.faceIds) {
          const face = this.meshData.faces.get(faceId);
          if (!face) continue;

          candidateFaces.add(faceId);
          face.vertexIds.forEach(v => candidateVertices.add(v));
          face.edgeIds.forEach(e => candidateEdges.add(e));
        }
      }

      const boundaryEdges = this.topology.getBoundaryEdges([...candidateVertices], [...candidateEdges], [...candidateFaces]);

      const orderedVertexIds = this.orderBoundaryLoop(boundaryEdges);
      this.topology.createFaceFromVertices(orderedVertexIds);
    }

    this.delete.deleteVertices(vertexIds);
  }

  splitVertexIslands(vertexIds) {
    const selected = new Set(vertexIds);
    const visited = new Set();
    const islands = [];

    for (const start of selected) {
      if (visited.has(start)) continue;

      const stack = [start];
      const island = new Set();

      while (stack.length) {
        const vId = stack.pop();
        if (visited.has(vId)) continue;

        visited.add(vId);
        island.add(vId);

        const v = this.meshData.vertices.get(vId);
        if (!v) continue;

        // Expand through edges
        for (const eId of v.edgeIds) {
          const e = this.meshData.edges.get(eId);
          if (!e) continue;

          const other =
            e.v1Id === vId ? e.v2Id : e.v1Id;

          if (selected.has(other) && !visited.has(other)) {
            stack.push(other);
          }
        }

        // Expand through faces
        for (const fId of v.faceIds) {
          const f = this.meshData.faces.get(fId);
          if (!f) continue;

          for (const fvId of f.vertexIds) {
            if (selected.has(fvId) && !visited.has(fvId)) {
              stack.push(fvId);
            }
          }
        }
      }

      islands.push([...island]);
    }

    return islands;
  }

  splitEdgeIslands(edgeIds) {
    const selected = new Set(edgeIds);
    const visited = new Set();
    const islands = [];

    for (const start of selected) {
      if (visited.has(start)) continue;

      const stack = [start];
      const island = new Set();

      while (stack.length) {
        const eId = stack.pop();
        if (visited.has(eId)) continue;

        visited.add(eId);
        island.add(eId);

        const e = this.meshData.edges.get(eId);
        if (!e) continue;

        // expand via vertices
        for (const vId of [e.v1Id, e.v2Id]) {
          const v = this.meshData.vertices.get(vId);
          if (!v) continue;

          for (const veId of v.edgeIds) {
            if (!selected.has(veId) || visited.has(veId)) continue;

            const ve = this.meshData.edges.get(veId);
            if (!ve) continue;

            // Check if they share at least one face
            const sharedFace = [...e.faceIds].some(faceId => ve.faceIds.has(faceId));
            if (sharedFace) {
              stack.push(veId);
            }
          }
        }
      }

      islands.push([...island]);
    }

    return islands;
  }

  orderBoundaryLoop(boundaryEdges) {
    if (!boundaryEdges || boundaryEdges.length === 0) return [];

    // Build adjacency
    const adjacency = new Map();

    for (const edge of boundaryEdges) {
      if (!adjacency.has(edge.v1Id)) adjacency.set(edge.v1Id, []);
      if (!adjacency.has(edge.v2Id)) adjacency.set(edge.v2Id, []);

      adjacency.get(edge.v1Id).push(edge.v2Id);
      adjacency.get(edge.v2Id).push(edge.v1Id);
    }

    // Find a start vertex (any boundary vertex)
    const startVertex = adjacency.keys().next().value;

    const ordered = [];
    let current = startVertex;
    let prev = null;

    while (true) {
      ordered.push(current);

      const neighbors = adjacency.get(current);
      if (!neighbors || neighbors.length === 0) break;

      // Choose the neighbor that is not the previous vertex
      const next = neighbors.find(v => v !== prev);
      if (next === undefined) break;

      prev = current;
      current = next;

      if (current === startVertex) break;
    }

    return ordered;
  }

  dissolveEdges(edgeIds) {
    const edgeIslands = this.splitEdgeIslands(edgeIds);

    const edgeVertices = [];
    for (const eId of edgeIds) {
      const edge = this.meshData.edges.get(eId);
      if (!edge || edge.faceIds.size !== 2) continue;

      edgeVertices.push(edge.v1Id);
      edgeVertices.push(edge.v2Id);
    }
    
    for (const island of edgeIslands) {
      this.dissolveEdgeIsland(island);
    }
    
    this.dissolveEdgeVertices(edgeVertices);
  }

  dissolveEdgeIsland(edgeIds) {
    const candidateFaces = new Set();
    const candidateEdges = new Set();
    const candidateVertices = new Set();

    // Only consider vertices of edges that are internal
    const selectedVertices = [];
    for (const eId of edgeIds) {
      const edge = this.meshData.edges.get(eId);
      if (!edge) continue;

      selectedVertices.push(edge.v1Id);
      selectedVertices.push(edge.v2Id);
    }

    for (const eId of edgeIds) {
      const edge = this.meshData.edges.get(eId);
      if (!edge) continue;

      candidateVertices.add(edge.v1Id);
      candidateVertices.add(edge.v2Id);

      candidateEdges.add(edge.id);

      for (const fId of edge.faceIds) {
        candidateFaces.add(fId);
        const f = this.meshData.faces.get(fId);
        if (!f) continue;

        for (const vId of f.vertexIds) {
          candidateVertices.add(vId);
        }

        for (const feId of f.edgeIds) {
          if (!candidateEdges.has(feId)) {
            candidateEdges.add(feId);
          }
        }
      }
    }

    const boundaryEdges = this.topology.getBoundaryEdges([...candidateVertices], [...candidateEdges], [...candidateFaces]);

    if (boundaryEdges.length < 3) return;

    const boundaryEdgeIds = new Set(boundaryEdges.map(e => e.id));
    let orderedVertexIds = this.orderBoundaryLoop(boundaryEdges);

    for (const fId of candidateFaces) {
      const face = this.meshData.faces.get(fId);
      if (face) this.meshData.deleteFace(face);
    }

    for (const eId of candidateEdges) {
      if (!boundaryEdgeIds.has(eId)) {
        const edge = this.meshData.edges.get(eId);
        if (edge) this.meshData.deleteEdge(edge);
      }
    }

    this.vertexEditor.delete.cleanupOrphanVertices(this.meshData, candidateVertices);
    orderedVertexIds = orderedVertexIds.filter(vId => this.meshData.vertices.get(vId));

    this.topology.createFaceFromVertices(orderedVertexIds);
  }
}