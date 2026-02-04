import * as THREE from 'three';
import { generateDuplicatedVertexGeometry, generateSharedVertexGeometry, generateAngleBasedGeometry
} from '../geometry/GeometryGenerator.js';

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
    this.vertexIndexMap = new Map();
    this.bufferIndexToVertexId = new Map();
    this.nextVertexId = 0;
    this.nextEdgeId = 0;
    this.nextFaceId = 0;
  }

  addVertex(position) {
    const v = new Vertex(this.nextVertexId++, position);
    this.vertices.set(v.id, v);
    return v;
  }

  addEdge(v1, v2) {
    const existingEdge = this.getEdge(v1.id, v2.id);
    if (existingEdge) return existingEdge;

    const e = new Edge(this.nextEdgeId++, v1.id, v2.id);
    this.edges.set(e.id, e);
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

    const len = vIds.length;
    for (let i = 0; i < len; i++) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % len];
      let e = this.getEdge(v1.id, v2.id);
      if (!e) e = this.addEdge(v1, v2);
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
    const v1 = this.vertices.get(v1Id);
    if (!v1) return null;

    for (let edgeId of v1.edgeIds) {
      const edge = this.edges.get(edgeId);
      if (!edge) continue;

      if ((edge.v1Id === v1Id && edge.v2Id === v2Id) ||
          (edge.v1Id === v2Id && edge.v2Id === v1Id)) {
        return edge;
      }
    }

    return null;
  }

  getFace(vertexIds) {
    if (!vertexIds || vertexIds.length === 0) return null;

    const firstVertex = this.getVertex(vertexIds[0]);
    if (!firstVertex) return null;

    let candidateFaceIds = new Set(firstVertex.faceIds);

    for (let i = 1; i < vertexIds.length; i++) {
      const v = this.getVertex(vertexIds[i]);
      if (!v) return null;

      candidateFaceIds = new Set(
        [...candidateFaceIds].filter(fid => v.faceIds.has(fid))
      );

      if (candidateFaceIds.size === 0) return null;
    }

    for (let fid of candidateFaceIds) {
      const face = this.faces.get(fid);
      if (!face || face.vertexIds.length !== vertexIds.length) continue;

      const faceSet = new Set(face.vertexIds);
      if (vertexIds.every(vId => faceSet.has(vId))) {
        return face;
      }
    }

    return null;
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

    for (let faceId of edge.faceIds) {
      const face = this.faces.get(faceId);
      if (face) {
        this.deleteFace(face);
      }
    }

    const v1 = this.getVertex(edge.v1Id);
    const v2 = this.getVertex(edge.v2Id);
    if (v1) v1.edgeIds.delete(edge.id);
    if (v2) v2.edgeIds.delete(edge.id);

    this.edges.delete(edge.id);
  }

  deleteFace(face) {
    if (!face || !this.faces.has(face.id)) return;

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
      vertexIndexMap: Array.from(this.vertexIndexMap.entries()),
      bufferIndexToVertexId: Array.from(this.bufferIndexToVertexId.entries()),
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

    meshData.vertexIndexMap = new Map(raw.vertexIndexMap);
    meshData.bufferIndexToVertexId = new Map(raw.bufferIndexToVertexId);
    meshData.nextVertexId = raw.nextVertexId;
    meshData.nextEdgeId = raw.nextEdgeId;
    meshData.nextFaceId = raw.nextFaceId;

    return meshData;
  }

  toDuplicatedVertexGeometry(useEarcut = true) {
    return generateDuplicatedVertexGeometry(this, useEarcut);
  }

  toSharedVertexGeometry(useEarcut = true) {
    return generateSharedVertexGeometry(this, useEarcut);
  }

  toAngleBasedGeometry(angleDegree = 60, useEarcut = true) {
    return generateAngleBasedGeometry(this, angleDegree, useEarcut);
  }
}