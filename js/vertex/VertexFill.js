import * as THREE from 'three';

export class VertexFill {
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

    const newFace = this.vertexEditor.addFace(vertices);

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
      const edge = this.vertexEditor.addEdge(v1, v2);
      return edge ? { edgeId: edge.id, faceId: null } : null;
    }

    const face = this.vertexEditor.addFace(vertices);
    return face ? { edgeId: null, faceId: face.id } : null;
  }

  computeQuadFromVertex(vertex) {
    const v0 = vertex;

    const openEdges = [...v0.edgeIds]
      .map(eid => this.meshData.edges.get(eid))
      .filter(e => e && e.faceIds.size <= 1);
    
    if (openEdges.length !== 2) return null;

    const v1 = this.meshData.getVertex(
      openEdges[0].v1Id === v0.id ? openEdges[0].v2Id : openEdges[0].v1Id
    );

    const v2 = this.meshData.getVertex(
      openEdges[1].v1Id === v0.id ? openEdges[1].v2Id : openEdges[1].v1Id
    );

    if (!v1 || !v2) return null;

    const p0 = v0.position;
    const p1 = v1.position;
    const p2 = v2.position;

    const newPos = {
      x: p1.x + p2.x - p0.x,
      y: p1.y + p2.y - p0.y,
      z: p1.z + p2.z - p0.z
    }

    const v3 = this.vertexEditor.addVertex(newPos);

    const quadVertexIds = [v1.id, v0.id, v2.id, v3.id];
    const openEdgeIds = [openEdges[0].id, openEdges[1].id];

    return { quadVertexIds, openEdgeIds };
  }
}