import * as THREE from 'three';

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
    for (let edge of this.edges.values()) {
      if ((edge.v1Id === v1.id && edge.v2Id === v2.id) ||
          (edge.v1Id === v2.id && edge.v2Id === v1.id)) {
        return edge;
      }
    }
    const e = new Edge(this.nextEdgeId++, v1.id, v2.id);
    this.edges.set(e.id, e);
    v1.edgeIds.add(e.id);
    v2.edgeIds.add(e.id);
    return e;
  }

  addFace(vertexArray) {
    const vIds = vertexArray.map(v => v.id);
    const f = new Face(this.nextFaceId++, vIds);
    this.faces.set(f.id, f);

    const len = vIds.length;
    for (let i = 0; i < len; i++) {
      const v1Id = vIds[i];
      const v2Id = vIds[(i + 1) % len];
      const v1 = this.vertices.get(v1Id);
      const v2 = this.vertices.get(v2Id);
      const e = this.addEdge(v1, v2);
      f.edgeIds.add(e.id);
      e.faceIds.add(f.id);
    }

    for (let vId of vIds) {
      this.vertices.get(vId).faceIds.add(f.id);
    }

    return f;
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
      nextVertexId: this.nextVertexId,
      nextEdgeId: this.nextEdgeId,
      nextFaceId: this.nextFaceId
    };
  }

  static rehydrateMeshData(object) {
    if (object.userData.meshData && !(object.userData.meshData instanceof MeshData)) {
      const raw = object.userData.meshData;
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
      meshData.nextVertexId = raw.nextVertexId;
      meshData.nextEdgeId = raw.nextEdgeId;
      meshData.nextFaceId = raw.nextFaceId;

      object.userData.meshData = meshData;
    }

    for (const child of object.children) {
      this.rehydrateMeshData(child);
    }
  }

  toDuplicatedVertexGeometry() {
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const indices = [];
    let currentIndex = 0;
    
    this.vertexIndexMap.clear();

    for (let f of this.faces.values()) {
      const verts = f.vertexIds.map(id => this.vertices.get(id));

      const baseIndex = currentIndex;
      for (let v of verts) {
        positions.push(v.position.x, v.position.y, v.position.z);

        if (!this.vertexIndexMap.has(v.id)) this.vertexIndexMap.set(v.id, []);
        this.vertexIndexMap.get(v.id).push(currentIndex);

        currentIndex++;
      }

      for (let i = 1; i < verts.length - 1; i++) {
        indices.push(baseIndex, baseIndex + i, baseIndex + i + 1);
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }

  toSharedVertexGeometry() {
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const indices = [];

    this.vertexIndexMap.clear();
    const vertexIdToIndex = new Map();
    let currentIndex = 0;

    for (let v of this.vertices.values()) {
      positions.push(v.position.x, v.position.y, v.position.z);
      vertexIdToIndex.set(v.id, currentIndex);

      this.vertexIndexMap.set(v.id, [currentIndex]);
      currentIndex++;
    }

    for (let f of this.faces.values()) {
      const vIds = f.vertexIds;
      if (vIds.length === 3) {
        indices.push(
          vertexIdToIndex.get(vIds[0]),
          vertexIdToIndex.get(vIds[1]),
          vertexIdToIndex.get(vIds[2])
        );
      } else {
        for (let i = 1; i < vIds.length - 1; i++) {
          indices.push(
            vertexIdToIndex.get(vIds[0]),
            vertexIdToIndex.get(vIds[i]),
            vertexIdToIndex.get(vIds[i + 1])
          );
        }
      }
    }
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }

  static fromOBJText(objText) {
    const lines = objText.split('\n');
    const objects = [];
    let current = { name: '', positions: [], faces: [], vertexOffset: 0 };

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length === 0) continue;

      switch (parts[0]) {
        case 'o':
        case 'g':
          if (current.faces.length > 0) {
            objects.push(current);
            current.vertexOffset += current.positions.length;
          }
          current = { 
            name: parts.slice(1).join(' '), 
            positions: [], 
            faces: [], 
            vertexOffset: current.vertexOffset 
          };
          break;

        case 'v':
          const x = parseFloat(parts[1]);
          const y = parseFloat(parts[2]);
          const z = parseFloat(parts[3]);

          if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
            current.positions.push(null);
          } else {
            current.positions.push([x, y, z]);
          }
          break;

        case 'f':
          const faceIndices = parts.slice(1).map(token => {
            const idx = parseInt(token.split('/')[0], 10) - 1 - current.vertexOffset;
            return idx;
          });
          current.faces.push(faceIndices);
          break;
      }
    }
    
    if (current.faces.length > 0) objects.push(current);

    return objects.map(obj => {
      const { positions, faces, name } = obj;
      const meshData = new MeshData();
      const verts = positions.map(p => p ? meshData.addVertex(new THREE.Vector3(...p)) : null);
      for (const face of faces) {
        const vertexArray = face.map(i => verts[i]).filter(v => v !== null);
        if (vertexArray.length >= 3) meshData.addFace(vertexArray);
      }
      return { name, meshData };
    });
  }

  computePerVertexNormals() {
    const normals = new Map();

    for (const [vid, v] of this.vertices) {
      normals.set(vid, new THREE.Vector3(0, 0, 0));
    }

    for (const [, f] of this.faces) {
      const vIds = f.vertexIds;
      if (vIds.length < 3) continue;

      const p0 = this.vertices.get(vIds[0]).position;
      const p1 = this.vertices.get(vIds[1]).position;
      const p2 = this.vertices.get(vIds[2]).position;

      const e1 = new THREE.Vector3().subVectors(p1, p0);
      const e2 = new THREE.Vector3().subVectors(p2, p0);
      const faceNormal = new THREE.Vector3().crossVectors(e1, e2);

      if (faceNormal.lengthSq() === 0) continue;
      faceNormal.normalize();

      for (const vid of vIds) {
        normals.get(vid).add(faceNormal);
      }
    }

    for (const [vid, n] of normals) {
      if (n.lengthSq() === 0) n.set(0, 0, 1);
      else n.normalize();
    }

    return normals;
  }

  computeFaceNormals() {
    const faceNormals = new Map();

    for (let [fid, f] of this.faces) {
      if (f.vertexIds.length < 3) continue;

      const v0 = this.vertices.get(f.vertexIds[0]).position;
      const v1 = this.vertices.get(f.vertexIds[1]).position;
      const v2 = this.vertices.get(f.vertexIds[2]).position;

      const edge1 = new THREE.Vector3().subVectors(v1, v0);
      const edge2 = new THREE.Vector3().subVectors(v2, v0);
      const normal = new THREE.Vector3().crossVectors(edge1, edge2);

      if (normal.lengthSq() === 0) {
        normal.set(0, 0, 1);
      } else {
        normal.normalize();
      }

      faceNormals.set(fid, normal);
    }

    return faceNormals;
  }
}