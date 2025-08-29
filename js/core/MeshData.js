import * as THREE from 'three';
import { weldVertices } from '../utils/WeldVertices.js';

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

  static rehydrateMeshData(object) {
    if (object.userData.meshData && !(object.userData.meshData instanceof MeshData)) {
      const raw = object.userData.meshData;
      const meshData = Object.assign(new MeshData(), raw);

      meshData.vertices = new Map(raw.vertices);
      meshData.edges = new Map(raw.edges);
      meshData.faces = new Map(raw.faces);

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
    const vertexIndexMap = new Map();

    for (let f of this.faces.values()) {
      const verts = f.vertexIds.map(id => this.vertices.get(id));

      const baseIndex = currentIndex;
      for (let v of verts) {
        positions.push(v.position.x, v.position.y, v.position.z);

        if (!vertexIndexMap.has(v.id)) vertexIndexMap.set(v.id, []);
        vertexIndexMap.get(v.id).push(currentIndex);

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

    return { geometry, vertexIndexMap };
  }

  static fromFBXGeometry(geometry) {
    geometry = weldVertices(geometry);

    if (!geometry.index) {
      const count = geometry.getAttribute('position').count;
      const idx = new Uint32Array(count);
      for (let i = 0; i < count; i++) idx[i] = i;
      geometry.setIndex(new THREE.BufferAttribute(idx, 1));
    }

    const meshData = new MeshData();
    const posAttr = geometry.getAttribute('position');
    const index = geometry.index.array;

    const verts = [];
    for (let i = 0; i < posAttr.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(posAttr, i);
      verts.push(meshData.addVertex(p));
    }

    for (let i = 0; i < index.length; i += 3) {
      const v0 = verts[index[i]];
      const v1 = verts[index[i + 1]];
      const v2 = verts[index[i + 2]];
      meshData.addFace([v0, v1, v2]);
    }

    return meshData;
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
          current.positions.push([
            parseFloat(parts[1]),
            parseFloat(parts[2]),
            parseFloat(parts[3])
          ]);
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
      const verts = positions.map(p => meshData.addVertex(new THREE.Vector3(...p)));
      for (const face of faces) {
        meshData.addFace(face.map(i => verts[i]));
      }
      return { name, meshData };
    });
  }

  toSharedVertexGeometry() {
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const indices = [];

    const vertexIdToIndex = new Map();
    let currentIndex = 0;

    for (let v of this.vertices.values()) {
      positions.push(v.position.x, v.position.y, v.position.z);
      vertexIdToIndex.set(v.id, currentIndex++);
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
    geometry.deleteAttribute('normal');
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }
}