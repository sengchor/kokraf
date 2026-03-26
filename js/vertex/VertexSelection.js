export class VertexSelection {
  constructor(vertexEditor) {
    this.vertexEditor = vertexEditor;
  }

  get meshData() {
    return this.vertexEditor.meshData;
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

    return boundaryEdges;
  }

  selectVertexLinked(meshData, startingVertexIds) {
    const visited = new Set(startingVertexIds);
    const stack = [...startingVertexIds];

    while (stack.length) {
      const vId = stack.pop();
      const vertex = meshData.getVertex(vId);
      if (!vertex) continue;

      for (const edgeId of vertex.edgeIds) {
        const edge = meshData.edges.get(edgeId);
        if (!edge) continue;

        const neighbors = [edge.v1Id, edge.v2Id];
        for (const nId of neighbors) {
          if (!visited.has(nId)) {
            visited.add(nId);
            stack.push(nId);
          }
        }
      }
    }

    return visited;
  }

  selectEdgeRings(meshData, startingEdgeIds) {
    const visited = new Set(startingEdgeIds);
    const stack = [...startingEdgeIds];

    while (stack.length) {
      const edgeId = stack.pop();
      const edge = meshData.edges.get(edgeId);
      if (!edge) continue;

      for (const faceId of edge.faceIds || []) {
        const face = meshData.faces.get(faceId);
        if (!face) continue;

        const oppositeEdgeId = this.findOppositeEdgeInFace(meshData, face, edge);
        if (oppositeEdgeId == null) continue;

        if (!visited.has(oppositeEdgeId)) {
          visited.add(oppositeEdgeId);
          stack.push(oppositeEdgeId);
        }
      }
    }

    return visited;
  }

  findOppositeEdgeInFace(meshData, face, edge) {
    if (face.edgeIds.size !== 4) return null;
    const { v1Id, v2Id } = edge;

    for (const eId of face.edgeIds) {
      if (eId === edge.id) continue;

      const e = meshData.edges.get(eId);
      if (!e) continue;

      const sharesVertex =
        e.v1Id === v1Id ||
        e.v1Id === v2Id ||
        e.v2Id === v1Id ||
        e.v2Id === v2Id;

      if (!sharesVertex) {
        return eId;
      }
    }

    return null;
  }

  selectEdgeLoops(meshData, startingEdgeIds) {
    const visited = new Set();
    const stack = [];

    for (const startId of startingEdgeIds) {
      const startEdge = meshData.edges.get(startId);
      if (!startEdge) continue;

      // Detect the "Mode" based on the starting edge
      const mode = this.determineLoopMode(meshData, startEdge);
      stack.push({ id: startId, mode: mode });
    }

    while (stack.length) {
      const { id: edgeId, mode } = stack.pop();
      if (visited.has(edgeId)) continue;

      visited.add(edgeId);
      const edge = meshData.edges.get(edgeId);
      
      // Pass the 'mode' to ensure we only look for the same kind of connection
      const nextEdges = [
        this.getNextEdgeInLoop(meshData, edge, edge.v1Id, mode),
        this.getNextEdgeInLoop(meshData, edge, edge.v2Id, mode)
      ];

      for (const nextEdgeId of nextEdges) {
        if (nextEdgeId != null && !visited.has(nextEdgeId)) {
          stack.push({ id: nextEdgeId, mode: mode });
        }
      }
    }
    return visited;
  }

  determineLoopMode(meshData, edge) {
    const faceCount = edge.faceIds ? edge.faceIds.size : 0;
    if (faceCount === 1) return 'BOUNDARY';
    
    if (faceCount === 2) {
      const faces = Array.from(edge.faceIds).map(id => meshData.faces.get(id));
      const hasNgon = faces.some(f => f.edgeIds.size > 4);
      const hasQuad = faces.some(f => f.edgeIds.size === 4);
      if (hasNgon && hasQuad) return 'NGON_RIM';
    }
    
    return 'STANDARD';
  }

  getNextEdgeInLoop(meshData, currentEdge, vertexId, mode) {
    const vertex = meshData.getVertex(vertexId);
    if (!vertex) return null;

    const connectedEdges = vertex.edgeIds;
    const candidates = [];
    for (const eId of connectedEdges) {
      if (eId !== currentEdge.id) {
        candidates.push(meshData.edges.get(eId));
      }
    }

    // --- MODE: NGON RIM ---
    if (mode === 'NGON_RIM' && candidates.length === 2 && currentEdge.faceIds.size === 2) {
      const faceArray = Array.from(currentEdge.faceIds);
      const fA = meshData.faces.get(faceArray[0]);
      const fB = meshData.faces.get(faceArray[1]);

      if ((fA.edgeIds.size > 4) !== (fB.edgeIds.size > 4)) {
        const nGonFaceId = fA.edgeIds.size > 4 ? fA.id : fB.id;
        const quadFaceId = fA.edgeIds.size > 4 ? fB.id : fA.id;

        for (const edge of candidates) {
          if (edge.faceIds.has(nGonFaceId) && !edge.faceIds.has(quadFaceId)) {
            return edge.id;
          }
        }
      }
    }

    // --- MODE: STANDARD (Quad Loop) ---
    if (mode === 'STANDARD' && candidates.length === 3) {
      for (const edge of candidates) {
        if (edge && !this.shareFace(currentEdge, edge)) {
          return edge.id;
        }
      }
    }

    // --- MODE: BOUNDARY ---
    if (mode === 'BOUNDARY' && currentEdge.faceIds.size === 1) {
      for (const edge of candidates) {
        if (edge.faceIds && edge.faceIds.size === 1) {
          return edge.id;
        }
      }
    }

    return null;
  }

  shareFace(edgeA, edgeB) {
    if (!edgeA.faceIds || !edgeB.faceIds) return false;

    for (const fId of edgeA.faceIds) {
      if (edgeB.faceIds.has(fId)) {
        return true;
      }
    }

    return false;
  }
}