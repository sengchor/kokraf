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

  selectLinked(meshData, startingVertexIds) {
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
}