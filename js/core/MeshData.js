class Vertex {
  constructor(id, position) {
    this.id = id;
    this.position = position;
    this.edgeIds = new Set();
    this.faceIds = new Set();
  }
}

class Edge {
  constructor(id, v1Id, v2Id) {
    this.id = id;
    this.v1Id = v1Id;
    this.v2Id = v2Id;
    this.faceIds = new Set();
  }
}

class Face {
  constructor(id, vertexIds) {
    this.id = id;
    this.vertexIds = vertexIds;
    this.edgeIds = new Set();
  }
}

export class MeshData {
  constructor() {
    this.vertices = new Map();
    this.edges = new Map();
    this.faces = new Map();

    this.nextVertexId = 0;
    this.nextEdgeId = 0;
    this.nextFaceId = 0;

    this.edgeKeyMap = new Map();
    this.faceKeyMap = new Map();

    this.uvs = new Map();

    this.vertexIdToBufferIndex = new Map();
    this.bufferIndexToVertexId = new Map();

    this.faceIdToBufferIndices = new Map();
    this.faceTriangleOffset = new Map();
    this.faceTriangleCount = new Map();

    this.slotAllocator = null;
    this.indexSlotAllocator = null;
  }

  _getEdgeKey(v1Id, v2Id) {
    return v1Id < v2Id ? `${v1Id}_${v2Id}` : `${v2Id}_${v1Id}`;
  }

  _getFaceKey(vertexIds) {
    return [...vertexIds].sort((a, b) => a - b).join('_');
  }

  addVertex(position) {
    const v = new Vertex(this.nextVertexId++, position);
    this.vertices.set(v.id, v);
    return v;
  }

  addEdge(v1, v2) {
    const key = this._getEdgeKey(v1.id, v2.id);
    if (this.edgeKeyMap.has(key)) return this.edgeKeyMap.get(key);

    const e = new Edge(this.nextEdgeId++, v1.id, v2.id);
    this.edges.set(e.id, e);
    this.edgeKeyMap.set(key, e);

    v1.edgeIds.add(e.id);
    v2.edgeIds.add(e.id);

    return e;
  }

  addFace(vertices) {
    const vIds = vertices.map(v => v.id);

    const existingFace = this.getFace(vIds);
    if (existingFace) return existingFace;

    const f = new Face(this.nextFaceId++, vIds);
    this.faces.set(f.id, f);
    this.faceKeyMap.set(this._getFaceKey(vIds), f);

    const len = vIds.length;
    for (let i = 0; i < len; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % len];
      const e = this.addEdge(v1, v2);
      f.edgeIds.add(e.id);
      e.faceIds.add(f.id);
    }
    for (let v of vertices) v.faceIds.add(f.id);

    return f;
  }

  getVertex(vId) {
    return this.vertices.get(vId) || null;
  }

  getEdge(v1Id, v2Id) {
    return this.edgeKeyMap.get(this._getEdgeKey(v1Id, v2Id)) || null;
  }

  getFace(vertexIds) {
    if (!vertexIds || vertexIds.length === 0) return null;
    return this.faceKeyMap.get(this._getFaceKey(vertexIds)) || null;
  }

  deleteVertex(vertex) {
    if (!vertex || !this.vertices.has(vertex.id)) return;

    for (const faceId of [...vertex.faceIds]) {
      const face = this.faces.get(faceId);
      if (face && face.vertexIds.includes(vertex.id)) {
        this.deleteFace(face);
      }
    }

    for (const edgeId of [...vertex.edgeIds]) {
      const edge = this.edges.get(edgeId);
      if (edge && (edge.v1Id === vertex.id || edge.v2Id === vertex.id)) {
        this.deleteEdge(edge);
      }
    }

    this.vertices.delete(vertex.id);
  }

  deleteEdge(edge) {
    if (!edge || !this.edges.has(edge.id)) return;

    this.edgeKeyMap.delete(this._getEdgeKey(edge.v1Id, edge.v2Id));

    for (let faceId of [...edge.faceIds]) {
      const face = this.faces.get(faceId);
      if (face) this.deleteFace(face);
    }

    const v1 = this.getVertex(edge.v1Id);
    const v2 = this.getVertex(edge.v2Id);
    if (v1) v1.edgeIds.delete(edge.id);
    if (v2) v2.edgeIds.delete(edge.id);

    this.edges.delete(edge.id);
  }

  deleteFace(face) {
    if (!face || !this.faces.has(face.id)) return;

    this.faceKeyMap.delete(this._getFaceKey(face.vertexIds));

    for (let i = 0; i < face.vertexIds.length; i++) {
      const v1Id = face.vertexIds[i];
      const v2Id = face.vertexIds[(i + 1) % face.vertexIds.length];
      const edge = this.getEdge(v1Id, v2Id);
      if (edge) edge.faceIds.delete(face.id);
    }

    for (let vId of face.vertexIds) {
      const vertex = this.vertices.get(vId);
      if (vertex) vertex.faceIds.delete(face.id);
    }

    this.faces.delete(face.id);
  }

  toJSON() {
    return {
      vertices: Array.from(this.vertices.entries()).map(([id, v]) => [
        id,
        {
          id: v.id,
          position: v.position,
          edgeIds: Array.from(v.edgeIds),
          faceIds: Array.from(v.faceIds)
        }
      ]),
      edges: Array.from(this.edges.entries()).map(([id, e]) => [
        id,
        {
          id: e.id,
          v1Id: e.v1Id,
          v2Id: e.v2Id,
          faceIds: Array.from(e.faceIds)
        }
      ]),
      faces: Array.from(this.faces.entries()).map(([id, f]) => [
        id,
        {
          id: f.id,
          vertexIds: f.vertexIds,
          edgeIds: Array.from(f.edgeIds)
        }
      ]),
      uvs: Array.from(this.uvs.entries()),
      vertexIdToBufferIndex: Array.from(this.vertexIdToBufferIndex.entries()),
      bufferIndexToVertexId: Array.from(this.bufferIndexToVertexId.entries()),
      faceIdToBufferIndices: Array.from(this.faceIdToBufferIndices.entries()),
      faceTriangleOffset: Array.from(this.faceTriangleOffset.entries()),
      faceTriangleCount: Array.from(this.faceTriangleCount.entries()),
      nextVertexId: this.nextVertexId,
      nextEdgeId: this.nextEdgeId,
      nextFaceId: this.nextFaceId
    };
  }

  static rehydrateMeshData(object) {
    if (object.userData?.meshData) {
      object.userData.meshData = this.getRehydratedMeshData(object.userData.meshData);
    }

    for (const child of object.children) {
      this.rehydrateMeshData(child);
    }
  }

  static getRehydratedMeshData(raw) {
    if (!raw || raw instanceof MeshData) return raw;

    const meshData = Object.assign(new MeshData(), raw);

    if (raw.vertices instanceof Map) {
      meshData.vertices = raw.vertices;
    } else if (Array.isArray(raw.vertices)) {
      meshData.vertices = new Map(
        raw.vertices.map(([id, v]) => {
          const vertex = Object.assign(new Vertex(v.id, v.position), v);
          vertex.edgeIds = new Set(v.edgeIds || []);
          vertex.faceIds = new Set(v.faceIds || []);
          return [id, vertex];
        })
      );
    }

    if (raw.edges instanceof Map) {
      meshData.edges = raw.edges;
    } else if (Array.isArray(raw.edges)) {
      meshData.edges = new Map(
        raw.edges.map(([id, e]) => {
          const edge = Object.assign(new Edge(e.id, e.v1Id, e.v2Id), e);
          edge.faceIds = new Set(e.faceIds || []);
          return [id, edge];
        })
      );
    }

    if (raw.faces instanceof Map) {
      meshData.faces = raw.faces;
    } else if (Array.isArray(raw.faces)) {
      meshData.faces = new Map(
        raw.faces.map(([id, f]) => {
          const face = Object.assign(new Face(f.id, f.vertexIds), f);
          face.edgeIds = new Set(f.edgeIds || []);
          return [id, face];
        })
      );
    }

    meshData.edgeKeyMap = new Map();
    for (const edge of meshData.edges.values()) {
      meshData.edgeKeyMap.set(meshData._getEdgeKey(edge.v1Id, edge.v2Id), edge);
    }

    meshData.faceKeyMap = new Map();
    for (const face of meshData.faces.values()) {
      meshData.faceKeyMap.set(meshData._getFaceKey(face.vertexIds), face);
    }

    meshData.uvs = new Map(raw.uvs);
    meshData.vertexIdToBufferIndex = new Map(raw.vertexIdToBufferIndex);
    meshData.bufferIndexToVertexId = new Map(raw.bufferIndexToVertexId);
    meshData.faceIdToBufferIndices = new Map(raw.faceIdToBufferIndices);
    meshData.faceTriangleOffset = new Map(raw.faceTriangleOffset);
    meshData.faceTriangleCount = new Map(raw.faceTriangleCount);
    meshData.nextVertexId = raw.nextVertexId;
    meshData.nextEdgeId = raw.nextEdgeId;
    meshData.nextFaceId = raw.nextFaceId;

    return meshData;
  }
}